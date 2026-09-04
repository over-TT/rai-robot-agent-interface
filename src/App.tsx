import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  CAMERA_PRESETS,
  computeSceneKinematics,
  createRobotUrdfExport,
  endEffectorToObjectSurfaceDistance,
  evaluateSimulationGoal,
  ROBOT_PRESETS,
  simulationStore,
  type CameraProjection,
  type CameraSensor,
  type CommandResult,
  type RobotChainOperation,
  type RobotJoint,
  type RecordedRun,
  type RecordedRunEvent,
  type SceneObject,
  type SimulationCommand,
  type Transform,
  type Vec3,
} from './domain'
import { installWebMcpTools, WEBMCP_TOOL_NAMES } from './webmcp'
import { Icon, type IconName } from './components/Icon'
import { AgentSetupDialog } from './components/AgentSetupDialog'
import { RobotViewport, type ViewPreset } from './components/RobotScene'
import { SensorViewport } from './components/SensorViewport'
import { AgentCameraCapture } from './components/AgentCameraCapture'
import { compactTime, degrees, mm, vectorMm } from './lib/format'
import { formatRunDuration, recordingCameraId, timelineEntryAt, timelineFrameAt } from './lib/runTimeline'
import { readSimulationImportFile } from './lib/simulationImport'
import { RAI_REPOSITORY_URL } from './lib/agentHandoff'

type Selection =
  | { kind: 'robot'; id: string }
  | { kind: 'joint'; id: string }
  | { kind: 'camera'; id: string }
  | { kind: 'object'; id: string }

type CommandDispatcher = (command: SimulationCommand) => CommandResult | undefined
type JointPatch = NonNullable<Extract<RobotChainOperation, { action: 'update' }>['joint']>
type DockTab = 'pose' | 'camera' | 'activity'
type WebMcpStatus = 'unavailable' | 'registering' | 'ready' | 'error'
type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'complete'

const AGENT_RUN_PROMPT = 'Use this page\u2019s WebMCP tools to inspect the current robot and task. You may build or load a robot, configure its joints, cameras, and scene, then start a camera-guided run with begin_arm_trial. Preserve existing work unless I ask to replace it. During the run, use only observe_arm_camera, get_arm_telemetry, set_arm_outputs, and end_arm_trial. Display and inspect the rendered image returned by observe_arm_camera. Work from those pixels and joint telemetry, make bounded joint or gripper outputs, and observe again after each change. End when the observations support a conclusion or further progress is not useful. Do not read hidden goal state or use task shortcuts. Report what the observations establish and what remains uncertain.'

function downloadTextFile(contents: string, mimeType: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.hidden = true
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }
}

function IconButton({ icon, label, disabled, onClick }: { icon: IconName; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button className="icon-button" type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  )
}

function SectionTitle({ icon, title, count }: { icon: IconName; title: string; count?: number }) {
  return (
    <div className="section-title">
      <Icon name={icon} size={14} />
      <span>{title}</span>
      {count === undefined ? null : <b>{count}</b>}
    </div>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button className="add-row" type="button" onClick={onClick}><Icon name="plus" size={14} />{label}</button>
}

function ConfirmRemoveButton({
  label,
  itemName,
  disabled,
  onConfirm,
}: {
  label: string
  itemName: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <>
      <button className="danger-button" type="button" disabled={disabled} onClick={() => setOpen(true)}><Icon name="trash" size={14} />{label}</button>
      <dialog ref={dialogRef} className="agent-task-dialog reset-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)}>
        <form method="dialog">
          <div className="agent-task-dialog-heading">
            <span className="agent-challenge-mark reset-mark"><Icon name="warning" size={14} /></span>
            <span><small>Reversible scene change</small><h2 id={titleId}>Remove {itemName}?</h2></span>
          </div>
          <p>This removes the item from the current scene. You can restore it with Undo.</p>
          <div className="agent-task-dialog-actions">
            <button type="submit">Keep {itemName}</button>
            <button className="danger-action" type="button" onClick={() => { onConfirm(); setOpen(false) }}>Remove {itemName}</button>
          </div>
        </form>
      </dialog>
    </>
  )
}

function SceneTree({
  selection,
  onSelect,
  dispatch,
}: {
  selection: Selection
  onSelect: (selection: Selection) => void
  dispatch: CommandDispatcher
}) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const { robot, cameras, objects } = state.scene

  const addJoint = () => {
    const count = robot.joints.length + 1
    const result = dispatch({
      type: 'edit_robot_chain',
      operations: [{
        action: 'add',
        joint: {
          name: `Joint ${count}`,
          type: 'revolute',
          axis: [0, 1, 0],
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] },
          position: 0,
          limits: { min: -120, max: 120 },
        },
        link: {
          name: `Link ${count}`,
          lengthM: 0.12,
          radiusM: 0.016,
          color: '#74aee0',
          direction: [1, 0, 0],
        },
      }],
    })
    if (result?.changedIds[0]) onSelect({ kind: 'joint', id: result.changedIds[0] })
  }

  const addCamera = () => {
    const result = dispatch({ type: 'configure_camera', action: 'add', presetId: 'generic-pinhole' })
    if (result?.changedIds[0]) onSelect({ kind: 'camera', id: result.changedIds[0] })
  }

  const addObject = () => {
    const result = dispatch({
      type: 'edit_scene_objects',
      operations: [{
        action: 'add',
        object: {
          name: `Target ${objects.length + 1}`,
          color: '#f3a45f',
          pose: { positionM: [0.34, -0.08, 0.035], rotationDeg: [0, 0, 0] },
          geometry: { type: 'box', sizeM: [0.07, 0.07, 0.07] },
        },
      }],
    })
    if (result?.changedIds[0]) onSelect({ kind: 'object', id: result.changedIds[0] })
  }

  return (
    <div className="scene-tree">
      <button
        className={`tree-row tree-root ${selection.kind === 'robot' ? 'is-selected' : ''}`}
        type="button"
        aria-pressed={selection.kind === 'robot'}
        onClick={() => onSelect({ kind: 'robot', id: robot.id })}
      >
        <span className="tree-icon robot"><Icon name="arm" size={15} /></span>
        <span><strong>{robot.name}</strong><small>{robot.joints.length}-joint serial arm</small></span>
        <Icon name="chevron" size={13} />
      </button>

      <div className="tree-group">
        <SectionTitle icon="joint" title="Arm joints" count={robot.joints.length} />
        {robot.joints.map((joint, index) => (
          <button
            className={`tree-row ${selection.kind === 'joint' && selection.id === joint.id ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={selection.kind === 'joint' && selection.id === joint.id}
            key={joint.id}
            onClick={() => onSelect({ kind: 'joint', id: joint.id })}
          >
            <span className="tree-index">J{index + 1}</span>
            <span><strong>{joint.name}</strong><small>{robot.links[index].name} · {joint.type}</small></span>
            <em>{joint.type === 'prismatic' ? mm(joint.position) : degrees(joint.position)}</em>
          </button>
        ))}
        <AddButton label="Add joint" onClick={addJoint} />
      </div>

      <div className="tree-group">
        <SectionTitle icon="camera" title="Cameras" count={cameras.length} />
        {cameras.map((camera) => (
          <button
            className={`tree-row ${selection.kind === 'camera' && selection.id === camera.id ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={selection.kind === 'camera' && selection.id === camera.id}
            key={camera.id}
            onClick={() => onSelect({ kind: 'camera', id: camera.id })}
          >
            <span className="tree-icon"><Icon name="camera" size={14} /></span>
            <span><strong>{camera.name}</strong><small>{camera.projection.horizontalFovDeg}° × {camera.projection.verticalFovDeg}°</small></span>
          </button>
        ))}
        <AddButton label="Add camera" onClick={addCamera} />
      </div>

      <div className="tree-group">
        <SectionTitle icon="cube" title="Objects" count={objects.length} />
        {objects.map((object) => (
          <button
            className={`tree-row ${selection.kind === 'object' && selection.id === object.id ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={selection.kind === 'object' && selection.id === object.id}
            key={object.id}
            onClick={() => onSelect({ kind: 'object', id: object.id })}
          >
            <span className="color-dot" style={{ background: object.color }} />
            <span><strong>{object.name}</strong><small>{state.scene.grasp?.objectId === object.id ? 'Grasped' : object.movable === false ? 'Fixed' : 'Movable'} · {object.geometry.type}</small></span>
          </button>
        ))}
        <AddButton label="Add object" onClick={addObject} />
      </div>
    </div>
  )
}

function PresetLibrary({ dispatch, onSelect }: { dispatch: CommandDispatcher; onSelect: (selection: Selection) => void }) {
  const loadRobot = (presetId: string) => {
    const result = dispatch({ type: 'load_robot_preset', presetId, keepObjects: presetId !== 'arm-101' })
    const state = simulationStore.getSnapshot()
    if (result) onSelect({ kind: 'robot', id: state.scene.robot.id })
  }

  const addCamera = (presetId: string) => {
    const result = dispatch({ type: 'configure_camera', action: 'add', presetId })
    if (result?.changedIds[0]) onSelect({ kind: 'camera', id: result.changedIds[0] })
  }

  const createBlankRobot = () => {
    const result = dispatch({
      type: 'create_custom_robot',
      name: 'Custom 3-axis arm',
      keepObjects: true,
      keepWorldCameras: true,
      segments: [
        {
          joint: { name: 'Base yaw', type: 'revolute', axis: [0, 0, 1], origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0, limits: { min: -180, max: 180 } },
          link: { name: 'Upper link', lengthM: 0.16, radiusM: 0.018, color: '#74aee0', direction: [1, 0, 0] },
        },
        {
          joint: { name: 'Shoulder', type: 'revolute', axis: [0, 1, 0], origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 25, limits: { min: -120, max: 120 } },
          link: { name: 'Forearm', lengthM: 0.14, radiusM: 0.015, color: '#8ec0e8', direction: [1, 0, 0] },
        },
        {
          joint: { name: 'Elbow', type: 'revolute', axis: [0, 1, 0], origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: -45, limits: { min: -145, max: 145 } },
          link: { name: 'Tool link', lengthM: 0.08, radiusM: 0.012, color: '#a8cfee', direction: [1, 0, 0] },
        },
      ],
    })
    if (result) onSelect({ kind: 'robot', id: simulationStore.getSnapshot().scene.robot.id })
  }

  return (
    <div className="preset-library">
      <SectionTitle icon="arm" title="Start here" />
      <div className="preset-stack">
        <button className="preset-card custom-builder-card" type="button" onClick={() => loadRobot('arm-101')}>
          <span className="preset-glyph"><Icon name="spark" /></span>
          <span><strong>Arm 101 demo</strong><small>Camera + gripper starter task</small></span>
          <Icon name="chevron" size={14} />
        </button>
        <button className="preset-card custom-builder-card" type="button" onClick={createBlankRobot}>
          <span className="preset-glyph"><Icon name="plus" /></span>
          <span><strong>New 3-joint arm</strong><small>Editable starter</small></span>
          <Icon name="chevron" size={14} />
        </button>
      </div>
      <SectionTitle icon="layers" title="Arm references" />
      <div className="preset-stack compact">
        {ROBOT_PRESETS.filter((preset) => preset.id !== 'arm-101').map((preset) => (
          <button className="preset-card" type="button" key={preset.id} onClick={() => loadRobot(preset.id)}>
            <span className="preset-glyph"><Icon name="arm" /></span>
            <span><strong>{preset.name}</strong><small>{preset.description}</small></span>
            <Icon name="chevron" size={14} />
          </button>
        ))}
      </div>
      <SectionTitle icon="camera" title="Cameras" />
      <div className="preset-stack compact">
        {CAMERA_PRESETS.map((preset) => (
          <button className="preset-card" type="button" key={preset.id} onClick={() => addCamera(preset.id)}>
            <span className="preset-glyph camera"><Icon name="camera" /></span>
            <span><strong>{preset.name}</strong><small>{preset.projection.horizontalFovDeg}° × {preset.projection.verticalFovDeg}° · {preset.projection.widthPx} × {preset.projection.heightPx}</small></span>
            <Icon name="plus" size={14} />
          </button>
        ))}
      </div>
    </div>
  )
}

function PropertyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="property-group"><h3>{title}</h3>{children}</section>
}

function InspectorDetails({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="inspector-details">
      <summary><span>{summary}</span><Icon name="chevron" size={13} /></summary>
      <div className="inspector-details-content">{children}</div>
    </details>
  )
}

function TextProperty({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  return (
    <label className="property-row">
      <span>{label}</span>
      <input key={value} type="text" defaultValue={value} onBlur={(event) => {
        const next = event.currentTarget.value.trim()
        if (next && next !== value) onCommit(next)
      }} />
    </label>
  )
}

function NumberProperty({
  label,
  value,
  unit,
  scale = 1,
  min,
  max,
  step,
  onCommit,
}: {
  label: string
  value: number
  unit?: string
  scale?: number
  min?: number
  max?: number
  step?: number
  onCommit: (value: number) => void
}) {
  const shown = Math.round(value * scale * 1000) / 1000
  return (
    <label className="property-row">
      <span>{label}</span>
      <span className="number-input">
        <input
          key={`${shown}-${min}-${max}`}
          type="number"
          defaultValue={shown}
          min={min}
          max={max}
          step={step ?? 1}
          onBlur={(event) => {
            const parsed = Number(event.currentTarget.value)
            if (Number.isFinite(parsed) && parsed !== shown) onCommit(parsed / scale)
          }}
        />
        {unit ? <em>{unit}</em> : null}
      </span>
    </label>
  )
}

function VectorProperty({ label, value, scale, unit, onCommit }: { label: string; value: Vec3; scale: number; unit: string; onCommit: (value: Vec3) => void }) {
  const axes = ['X', 'Y', 'Z'] as const
  return (
    <div className="vector-property">
      <span>{label}</span>
      <div>
        {axes.map((axis, index) => (
          <label key={axis}>
            <b>{axis}</b>
            <input
              key={`${axis}-${value[index]}`}
              type="number"
              defaultValue={Math.round(value[index] * scale * 1000) / 1000}
              step={scale === 1 ? 1 : 5}
              aria-label={`${label} ${axis} in ${unit}`}
              onBlur={(event) => {
                const parsed = Number(event.currentTarget.value)
                if (!Number.isFinite(parsed)) return
                const next = [...value] as Vec3
                next[index] = parsed / scale
                if (next[index] !== value[index]) onCommit(next)
              }}
            />
          </label>
        ))}
        <em>{unit}</em>
      </div>
    </div>
  )
}

function JointInspector({ joint, index, dispatch, onDeleted }: { joint: RobotJoint; index: number; dispatch: CommandDispatcher; onDeleted: () => void }) {
  const state = simulationStore.getSnapshot()
  const link = state.scene.robot.links[index]
  const update = (jointPatch?: JointPatch, linkPatch?: Partial<typeof link>) => dispatch({
    type: 'edit_robot_chain',
    operations: [{ action: 'update', jointId: joint.id, ...(jointPatch ? { joint: jointPatch } : {}), ...(linkPatch ? { link: linkPatch } : {}) }],
  })
  const positionUnit = joint.type === 'prismatic' ? 'mm' : 'deg'
  const positionScale = joint.type === 'prismatic' ? 1000 : 1

  return (
    <>
      <div className="inspector-heading">
        <span className="entity-badge">J{index + 1}</span>
        <div><h2>{joint.name}</h2><p>{joint.id}</p></div>
      </div>
      <PropertyGroup title="Joint">
        <TextProperty label="Name" value={joint.name} onCommit={(name) => update({ name })} />
        <label className="property-row"><span>Type</span><select value={joint.type} onChange={(event) => {
          const type = event.currentTarget.value as RobotJoint['type']
          const limits = type === 'continuous' || type === 'fixed'
            ? null
            : type === 'prismatic'
              ? { min: -0.1, max: 0.1 }
              : { min: -180, max: 180 }
          update({ type, position: 0, limits })
        }}>
          <option value="revolute">Revolute</option><option value="continuous">Continuous</option><option value="prismatic">Prismatic</option><option value="fixed">Fixed</option>
        </select></label>
        <div className="property-row"><span>Axis</span><div className="segment-control mini" aria-label="Joint axis">
          {([['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]] as const).map(([axis, vector]) => (
            <button aria-pressed={joint.axis.join() === vector.join()} className={joint.axis.join() === vector.join() ? 'active' : ''} type="button" key={axis} onClick={() => update({ axis: [...vector] })}>{axis}</button>
          ))}
        </div></div>
        {joint.type === 'revolute' || joint.type === 'prismatic' ? <>
          <NumberProperty label="Minimum" value={joint.limits?.min ?? (joint.type === 'prismatic' ? -0.1 : -180)} scale={positionScale} unit={positionUnit} onCommit={(min) => update({ limits: { min, max: joint.limits?.max ?? (joint.type === 'prismatic' ? 0.1 : 180) } })} />
          <NumberProperty label="Maximum" value={joint.limits?.max ?? (joint.type === 'prismatic' ? 0.1 : 180)} scale={positionScale} unit={positionUnit} onCommit={(max) => update({ limits: { min: joint.limits?.min ?? (joint.type === 'prismatic' ? -0.1 : -180), max } })} />
        </> : null}
      </PropertyGroup>
      <PropertyGroup title="Link geometry">
        <TextProperty label="Name" value={link.name} onCommit={(name) => update(undefined, { name })} />
        <NumberProperty label="Length" value={link.lengthM} scale={1000} unit="mm" min={0} max={1000} step={5} onCommit={(lengthM) => update(undefined, { lengthM })} />
        <NumberProperty label="Radius" value={link.radiusM} scale={1000} unit="mm" min={4} max={100} step={1} onCommit={(radiusM) => update(undefined, { radiusM })} />
        <label className="property-row"><span>Color</span><span className="color-input"><input type="color" value={link.color} aria-label="Link color" onChange={(event) => update(undefined, { color: event.currentTarget.value })} /><code>{link.color}</code></span></label>
        <div className="property-row"><span>Direction</span><div className="segment-control mini" aria-label="Link direction">
          {([['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]] as const).map(([axis, vector]) => (
            <button aria-pressed={link.direction.join() === vector.join()} className={link.direction.join() === vector.join() ? 'active' : ''} type="button" key={axis} onClick={() => update(undefined, { direction: [...vector] })}>{axis}</button>
          ))}
        </div></div>
      </PropertyGroup>
      <ConfirmRemoveButton label="Remove joint and link" itemName={`${joint.name} and ${link.name}`} disabled={state.scene.robot.joints.length <= 1} onConfirm={() => {
        const result = dispatch({ type: 'edit_robot_chain', operations: [{ action: 'remove', jointId: joint.id }] })
        if (result) onDeleted()
      }} />
    </>
  )
}

function CameraInspector({ camera, dispatch, onDeleted }: { camera: CameraSensor; dispatch: CommandDispatcher; onDeleted: () => void }) {
  const state = simulationStore.getSnapshot()
  const update = (patch: Omit<Partial<CameraSensor>, 'id' | 'projection'> & { presetId?: string; projection?: Partial<CameraProjection> }) => dispatch({
    type: 'configure_camera', action: 'update', cameraId: camera.id, ...patch,
  })
  const updatePose = (posePatch: Partial<Transform>) => update({ pose: { ...camera.pose, ...posePatch } })

  return (
    <>
      <div className="inspector-heading">
        <span className="entity-badge camera"><Icon name="camera" size={16} /></span>
        <div><h2>{camera.name}</h2><p>{camera.id}</p></div>
      </div>
      <PropertyGroup title="Camera">
        <TextProperty label="Name" value={camera.name} onCommit={(name) => update({ name })} />
        <label className="property-row"><span>Reference</span><select value={camera.presetId ?? ''} onChange={(event) => {
          const presetId = event.currentTarget.value
          if (!presetId) return
          const preset = CAMERA_PRESETS.find((candidate) => candidate.id === presetId)
          update({ presetId, ...(preset ? { name: preset.name } : {}) })
        }}>
          <option value="">Custom projection</option>
          {CAMERA_PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
        </select></label>
        <label className="property-row"><span>Mounted to</span><select value={camera.parent.type === 'world' ? 'world' : camera.parent.linkId} onChange={(event) => update({ parent: event.currentTarget.value === 'world' ? { type: 'world' } : { type: 'link', linkId: event.currentTarget.value } })}>
          <option value="world">World</option>
          {state.scene.robot.links.map((link) => <option value={link.id} key={link.id}>{link.name}</option>)}
        </select></label>
      </PropertyGroup>
      <PropertyGroup title="Field of view">
        <NumberProperty label="Horizontal FOV" value={camera.projection.horizontalFovDeg} unit="deg" min={10} max={170} onCommit={(horizontalFovDeg) => update({ projection: { horizontalFovDeg } })} />
        <NumberProperty label="Vertical FOV" value={camera.projection.verticalFovDeg} unit="deg" min={10} max={150} onCommit={(verticalFovDeg) => update({ projection: { verticalFovDeg } })} />
      </PropertyGroup>
      <InspectorDetails summary="Advanced camera settings">
        <PropertyGroup title="Clipping & resolution">
          <NumberProperty label="Near plane" value={camera.projection.nearM} scale={1000} unit="mm" min={1} max={1000} onCommit={(nearM) => update({ projection: { nearM } })} />
          <NumberProperty label="Far plane" value={camera.projection.farM} unit="m" min={0.1} max={100} step={0.1} onCommit={(farM) => update({ projection: { farM } })} />
          <div className="property-row static"><span>Native array</span><strong>{camera.projection.widthPx} × {camera.projection.heightPx}</strong></div>
        </PropertyGroup>
        <PropertyGroup title="Mount transform">
          <VectorProperty label="Position" value={camera.pose.positionM} scale={1000} unit="mm" onCommit={(positionM) => updatePose({ positionM })} />
          <VectorProperty label="Rotation" value={camera.pose.rotationDeg} scale={1} unit="deg" onCommit={(rotationDeg) => updatePose({ rotationDeg })} />
        </PropertyGroup>
        <div className="truth-note"><Icon name="info" size={14} /><p>{camera.note}</p></div>
        <ConfirmRemoveButton label="Remove camera" itemName={camera.name} onConfirm={() => {
          const result = dispatch({ type: 'configure_camera', action: 'remove', cameraId: camera.id })
          if (result) onDeleted()
        }} />
      </InspectorDetails>
    </>
  )
}

function geometryForType(type: SceneObject['geometry']['type']): SceneObject['geometry'] {
  if (type === 'sphere') return { type, radiusM: 0.04 }
  if (type === 'cylinder') return { type, radiusM: 0.035, heightM: 0.08 }
  if (type === 'plane') return { type, sizeM: [0.5, 0.5] }
  return { type: 'box', sizeM: [0.07, 0.07, 0.07] }
}

function restingCenterZ(geometry: SceneObject['geometry']): number {
  if (geometry.type === 'sphere') return geometry.radiusM
  if (geometry.type === 'cylinder') return geometry.heightM / 2
  if (geometry.type === 'box') return geometry.sizeM[2] / 2
  return 0
}

function ObjectInspector({ object, dispatch, onDeleted }: { object: SceneObject; dispatch: CommandDispatcher; onDeleted: () => void }) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const update = (patch: Partial<Omit<SceneObject, 'id'>>) => dispatch({ type: 'edit_scene_objects', operations: [{ action: 'update', objectId: object.id, patch }] })
  const [goalTarget, setGoalTarget] = useState<Vec3>([object.pose.positionM[0], object.pose.positionM[1] - 0.15, object.pose.positionM[2]])
  const [goalToleranceMm, setGoalToleranceMm] = useState(20)
  const isGrasped = state.scene.grasp?.objectId === object.id
  const toolOccupied = Boolean(state.scene.grasp && !isGrasped)
  const surfaceDistanceM = object.geometry.type === 'plane'
    ? Number.POSITIVE_INFINITY
    : endEffectorToObjectSurfaceDistance(state.scene, object)

  useEffect(() => {
    setGoalTarget([object.pose.positionM[0], object.pose.positionM[1] - 0.15, object.pose.positionM[2]])
  }, [object.id])

  return (
    <>
      <div className="inspector-heading">
        <span className="entity-badge object" style={{ background: object.color }}><Icon name="cube" size={16} /></span>
        <div><h2>{object.name}</h2><p>{object.id}</p></div>
      </div>
      <PropertyGroup title="Object">
        <TextProperty label="Name" value={object.name} onCommit={(name) => update({ name })} />
        <label className="property-row"><span>Primitive</span><select value={object.geometry.type} onChange={(event) => {
          const type = event.currentTarget.value as SceneObject['geometry']['type']
          const geometry = geometryForType(type)
          update({
            geometry,
            pose: { ...object.pose, positionM: [object.pose.positionM[0], object.pose.positionM[1], restingCenterZ(geometry)] },
            ...(type === 'plane' ? { movable: false } : {}),
          })
        }}>
          <option value="box">Box</option><option value="sphere">Sphere</option><option value="cylinder">Cylinder</option><option value="plane">Plane</option>
        </select></label>
        <label className="property-row"><span>Color</span><span className="color-input"><input type="color" value={object.color} aria-label="Object color" onChange={(event) => update({ color: event.currentTarget.value })} /><code>{object.color}</code></span></label>
        <label className="property-row"><span>Manipulation</span><select value={object.movable === true ? 'movable' : 'fixed'} disabled={isGrasped || object.geometry.type === 'plane'} onChange={(event) => update({ movable: event.currentTarget.value === 'movable' })}>
          <option value="movable">Movable</option><option value="fixed">Fixed in world</option>
        </select></label>
      </PropertyGroup>
      <PropertyGroup title="Transform">
        <VectorProperty label="Position" value={object.pose.positionM} scale={1000} unit="mm" onCommit={(positionM) => update({ pose: { ...object.pose, positionM } })} />
        <VectorProperty label="Rotation" value={object.pose.rotationDeg} scale={1} unit="deg" onCommit={(rotationDeg) => update({ pose: { ...object.pose, rotationDeg } })} />
      </PropertyGroup>
      <PropertyGroup title="Dimensions">
        {object.geometry.type === 'box' ? <VectorProperty label="Size" value={object.geometry.sizeM} scale={1000} unit="mm" onCommit={(sizeM) => update({ geometry: { type: 'box', sizeM } })} /> : null}
        {object.geometry.type === 'sphere' ? <NumberProperty label="Radius" value={object.geometry.radiusM} scale={1000} unit="mm" min={1} max={1000} onCommit={(radiusM) => update({ geometry: { type: 'sphere', radiusM } })} /> : null}
        {object.geometry.type === 'cylinder' ? <>
          <NumberProperty label="Radius" value={object.geometry.radiusM} scale={1000} unit="mm" min={1} max={1000} onCommit={(radiusM) => update({ geometry: { type: 'cylinder', radiusM, heightM: object.geometry.type === 'cylinder' ? object.geometry.heightM : 0.08 } })} />
          <NumberProperty label="Height" value={object.geometry.heightM} scale={1000} unit="mm" min={1} max={1000} onCommit={(heightM) => update({ geometry: { type: 'cylinder', radiusM: object.geometry.type === 'cylinder' ? object.geometry.radiusM : 0.035, heightM } })} />
        </> : null}
        {object.geometry.type === 'plane' ? <>
          <NumberProperty label="Width" value={object.geometry.sizeM[0]} scale={1000} unit="mm" min={1} max={10000} onCommit={(widthM) => update({ geometry: { type: 'plane', sizeM: [widthM, object.geometry.type === 'plane' ? object.geometry.sizeM[1] : 0.5] } })} />
          <NumberProperty label="Depth" value={object.geometry.sizeM[1]} scale={1000} unit="mm" min={1} max={10000} onCommit={(depthM) => update({ geometry: { type: 'plane', sizeM: [object.geometry.type === 'plane' ? object.geometry.sizeM[0] : 0.5, depthM] } })} />
        </> : null}
      </PropertyGroup>
      <PropertyGroup title="Actions">
        <div className="property-row static"><span>Tool clearance</span><strong>{Number.isFinite(surfaceDistanceM) ? mm(surfaceDistanceM) : 'Not graspable'}</strong></div>
        <div className="inline-actions">
          {isGrasped
            ? <button className="action-button" type="button" onClick={() => dispatch({ type: 'control_grasp', action: 'release' })}><Icon name="cube" size={14} />Release object</button>
            : <button className="action-button" type="button" disabled={toolOccupied || object.movable !== true || object.geometry.type === 'plane'} onClick={() => dispatch({ type: 'control_grasp', action: 'grab', objectId: object.id, captureDistanceM: 0.04 })}><Icon name="focus" size={14} />Grasp at tool</button>}
        </div>
      </PropertyGroup>
      <PropertyGroup title="Goal">
        {object.geometry.type === 'cylinder' && object.movable === true ? <button className="action-button" type="button" onClick={() => dispatch({
          type: 'set_simulation_goal', action: 'set',
          goal: { name: `Tip ${object.name}`, type: 'object-tipped', objectId: object.id, minimumTiltDeg: 80, requireReleased: true },
        })}><Icon name="focus" size={14} />Set tip goal</button> : null}
        <VectorProperty label="Target" value={goalTarget} scale={1000} unit="mm" onCommit={setGoalTarget} />
        <NumberProperty label="Tolerance" value={goalToleranceMm / 1000} scale={1000} unit="mm" min={1} max={1000} step={1} onCommit={(value) => setGoalToleranceMm(value * 1000)} />
        <button className="action-button" type="button" onClick={() => dispatch({
          type: 'set_simulation_goal', action: 'set',
          goal: { name: `Deliver ${object.name}`, type: 'object-at-position', objectId: object.id, targetPositionM: goalTarget, toleranceM: goalToleranceMm / 1000 },
        })}><Icon name="focus" size={14} />Set delivery goal</button>
      </PropertyGroup>
      <ConfirmRemoveButton label="Remove object" itemName={object.name} onConfirm={() => {
        const result = dispatch({ type: 'edit_scene_objects', operations: [{ action: 'remove', objectId: object.id }] })
        if (result) onDeleted()
      }} />
    </>
  )
}

function ToolTargetControl({ positionM, dispatch }: { positionM: Vec3; dispatch: CommandDispatcher }) {
  const [targetPositionM, setTargetPositionM] = useState<Vec3>([...positionM])
  useEffect(() => setTargetPositionM([...positionM]), [positionM])
  return (
    <PropertyGroup title="Position IK">
      <VectorProperty label="Tool target" value={targetPositionM} scale={1000} unit="mm" onCommit={setTargetPositionM} />
      <button className="action-button" type="button" onClick={() => dispatch({ type: 'move_end_effector', targetPositionM, toleranceM: 0.003 })}>
        <Icon name="focus" size={14} />Move tool to target
      </button>
      <p className="property-helper">Position only · 3 mm tolerance</p>
    </PropertyGroup>
  )
}

function RobotInspector({ dispatch }: { dispatch: CommandDispatcher }) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const computed = useMemo(() => simulationStore.getComputedState(), [state])
  const { robot } = state.scene
  return (
    <>
      <div className="inspector-heading">
        <span className="entity-badge robot"><Icon name="arm" size={17} /></span>
        <div><h2>{robot.name}</h2></div>
      </div>
      <PropertyGroup title="Robot">
        <div className="stat-grid">
          <div><span>Joints</span><strong>{robot.joints.length}</strong></div>
          <div><span>Links</span><strong>{robot.links.length}</strong></div>
          <div><span>Cameras</span><strong>{state.scene.cameras.length}</strong></div>
          <div><span>Objects</span><strong>{state.scene.objects.length}</strong></div>
        </div>
        <div className="property-row static"><span>End effector</span><strong>{vectorMm(computed.endEffector.positionM)} mm</strong></div>
      </PropertyGroup>
      {state.phase === 'build' ? <ToolTargetControl key={robot.id} positionM={computed.endEffector.positionM} dispatch={dispatch} /> : null}
      <InspectorDetails summary="Model details & snapshots">
        <div className="evidence-banner"><Icon name="check" size={14} /><span><strong>Browser simulation</strong><small>Deterministic arm kinematics · revision {state.revision}</small></span></div>
        <PropertyGroup title="Model metadata">
          <div className="property-row static"><span>{robot.metadata.accuracy === 'custom' ? 'Reach envelope' : 'Nominal reach'}</span><strong>{robot.metadata.nominalReachM ? mm(robot.metadata.nominalReachM) : 'Custom'}</strong></div>
          <div className="property-row static"><span>Accuracy</span><strong>{robot.metadata.accuracy.replaceAll('-', ' ')}</strong></div>
        </PropertyGroup>
        <div className="truth-note"><Icon name="info" size={14} /><p>{robot.metadata.note}</p></div>
        {robot.metadata.sourceUrl ? <a className="source-link" href={robot.metadata.sourceUrl} target="_blank" rel="noreferrer">Open reference source <Icon name="chevron" size={13} /></a> : null}
        <PropertyGroup title="Saved snapshots">
          {state.snapshots.length === 0 ? <p className="empty-copy">No snapshots yet.</p> : state.snapshots.slice().reverse().slice(0, 5).map((snapshot) => (
            <button className="snapshot-row" type="button" key={snapshot.id} onClick={() => dispatch({ type: 'restore_simulation_snapshot', snapshotId: snapshot.id })}>
              <span><strong>{snapshot.name}</strong><small>From revision {snapshot.sourceRevision}</small></span><Icon name="chevron" size={13} />
            </button>
          ))}
        </PropertyGroup>
      </InspectorDetails>
    </>
  )
}

function Inspector({ selection, dispatch, onFallback }: { selection: Selection; dispatch: CommandDispatcher; onFallback: () => void }) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const jointIndex = selection.kind === 'joint' ? state.scene.robot.joints.findIndex((joint) => joint.id === selection.id) : -1
  const camera = selection.kind === 'camera' ? state.scene.cameras.find((candidate) => candidate.id === selection.id) : undefined
  const object = selection.kind === 'object' ? state.scene.objects.find((candidate) => candidate.id === selection.id) : undefined
  return (
    <div className="inspector-scroll">
      {selection.kind === 'robot' ? <RobotInspector dispatch={dispatch} /> : null}
      {jointIndex >= 0 ? <JointInspector joint={state.scene.robot.joints[jointIndex]} index={jointIndex} dispatch={dispatch} onDeleted={onFallback} /> : null}
      {camera ? <CameraInspector camera={camera} dispatch={dispatch} onDeleted={onFallback} /> : null}
      {object ? <ObjectInspector object={object} dispatch={dispatch} onDeleted={onFallback} /> : null}
    </div>
  )
}

function JointControls({ dispatch }: { dispatch: CommandDispatcher }) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const joints = state.scene.robot.joints
  const operating = state.phase === 'operate'

  const setHome = () => dispatch({
    type: 'set_joint_positions',
    positions: joints.map((joint) => ({ jointId: joint.id, value: Math.max(joint.limits?.min ?? 0, Math.min(joint.limits?.max ?? 0, 0)) })),
  })

  const runDemo = () => {
    const current = joints.map((joint) => ({ jointId: joint.id, value: joint.position }))
    const posed = joints.map((joint, index) => {
      if (joint.type === 'fixed') return { jointId: joint.id, value: joint.position }
      const min = joint.limits?.min ?? (joint.type === 'prismatic' ? -0.1 : -180)
      const max = joint.limits?.max ?? (joint.type === 'prismatic' ? 0.1 : 180)
      const span = max - min
      return { jointId: joint.id, value: min + span * (index % 2 === 0 ? 0.58 : 0.42) }
    })
    dispatch({ type: 'run_joint_sequence', waypoints: [{ positions: current, durationMs: 0 }, { positions: posed, durationMs: 900 }] })
  }

  const jointSliderList = (
    <div className="joint-sliders">
      {joints.map((joint, index) => {
        const isPrismatic = joint.type === 'prismatic'
        const scale = isPrismatic ? 1000 : 1
        const min = (joint.limits?.min ?? (isPrismatic ? -0.1 : -180)) * scale
        const max = (joint.limits?.max ?? (isPrismatic ? 0.1 : 180)) * scale
        return (
          <label className="joint-slider" key={joint.id}>
            <span><b>J{index + 1}</b><strong>{joint.name}</strong><em>{joint.type === 'fixed' ? 'fixed' : isPrismatic ? mm(joint.position) : degrees(joint.position)}</em></span>
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={joint.position * scale}
              disabled={joint.type === 'fixed'}
              aria-label={`${joint.name} position`}
              onChange={(event) => {
                const value = Number(event.currentTarget.value) / scale
                dispatch(operating
                  ? { type: 'set_arm_outputs', jointTargets: [{ jointId: joint.id, value }], gripper: 'unchanged' }
                  : { type: 'set_joint_positions', positions: [{ jointId: joint.id, value }] })
              }}
            />
          </label>
        )
      })}
    </div>
  )

  return (
    <div className="motion-panel">
      <div className="dock-heading">
        <span><Icon name="joint" size={15} /><strong>Joints</strong></span>
        <div><button type="button" disabled={operating} onClick={setHome}>Zero pose</button><button type="button" disabled={operating} onClick={runDemo}>Demo pose</button></div>
      </div>
      {jointSliderList}
      <div className="gripper-control">
        <span><Icon name="focus" size={14} /><strong>Gripper</strong><small>{state.scene.grasp ? 'Holding an object' : state.operation?.gripper === 'closed' ? 'Closed · empty' : 'Open'}</small></span>
        <div>
          <button type="button" disabled={!operating || state.operation?.gripper === 'open'} onClick={() => dispatch({ type: 'set_arm_outputs', gripper: 'open' })}>Open</button>
          <button type="button" disabled={!operating || state.operation?.gripper === 'closed'} onClick={() => dispatch({ type: 'set_arm_outputs', gripper: 'close' })}>Close</button>
        </div>
      </div>
    </div>
  )
}

function CameraDock({ activeCameraId, setActiveCameraId }: { activeCameraId?: string; setActiveCameraId: (id: string) => void }) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const computed = useMemo(() => simulationStore.getComputedState(), [state])
  const camera = state.scene.cameras.find((candidate) => candidate.id === activeCameraId) ?? state.scene.cameras[0]

  return (
    <div className="camera-dock">
      <div className="dock-heading sensor-heading">
        <span><Icon name="eye" size={15} /><strong>Camera view</strong></span>
        {state.scene.cameras.length ? <select aria-label="Active sensor camera" value={camera?.id} onChange={(event) => setActiveCameraId(event.currentTarget.value)}>{state.scene.cameras.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select> : null}
      </div>
      <SensorViewport scene={state.scene} computed={computed} cameraId={camera?.id} gripperClosed={state.operation?.gripper === 'closed'} />
      <div className="camera-sensor-note"><Icon name="info" size={13} /><span><strong>Agent sensor</strong><small>Ideal pinhole observation · no world coordinates</small></span></div>
    </div>
  )
}

function AgentTaskPanel({ dispatch }: { dispatch: CommandDispatcher }) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const evaluation = useMemo(() => evaluateSimulationGoal(state.scene), [state])
  const operating = state.phase === 'operate'
  return (
    <section className="task-panel" aria-label="Agent task state" aria-live="polite">
      <div className="task-panel-heading">
        <SectionTitle icon="focus" title="Agent run" />
        <span className={operating ? 'goal-pending' : 'goal-empty'}>{operating ? 'Running' : 'Build mode'}</span>
      </div>
      <div className="task-panel-body">
        <span className={`task-state-mark ${evaluation.succeeded ? 'success' : ''}`}><Icon name={evaluation.succeeded ? 'check' : 'focus'} size={14} /></span>
        <span><strong>{state.scene.goal?.name ?? 'Current objective'}</strong><small>{operating ? 'Camera + joint state in. Bounded controls out.' : 'Build any robot, then run the visible task.'}</small></span>
      </div>
      <div className="trial-actions">
        {operating
          ? <button className="trial-stop" type="button" onClick={() => dispatch({ type: 'end_arm_trial' })}><Icon name="close" size={13} />End run</button>
          : <button className="action-button" type="button" onClick={() => dispatch({ type: 'begin_arm_trial', randomizeCan: true })}><Icon name="eye" size={13} />Start agent run</button>}
      </div>
      <div className="grasp-status"><span>Visible result</span><strong>{state.scene.goal ? evaluation.succeeded ? 'Goal complete' : operating ? 'In progress' : 'Ready' : 'No goal set'}</strong></div>
    </section>
  )
}

function ViewportGoalChip({ onOpen }: { onOpen: () => void }) {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const evaluation = useMemo(() => evaluateSimulationGoal(state.scene), [state])
  const status = state.scene.goal ? evaluation.succeeded ? 'success' : 'pending' : 'empty'
  return (
    <button className={`viewport-goal-chip ${status}`} type="button" onClick={onOpen} aria-label={`Open goal panel. ${state.scene.goal ? evaluation.summary : 'No goal set.'}`}>
      <Icon name={evaluation.succeeded ? 'check' : 'focus'} size={13} />
      <span><small>Goal</small><strong>{state.scene.goal?.name ?? 'Not set'}</strong></span>
      <em>{state.scene.goal ? evaluation.succeeded ? 'Done' : 'Pending' : 'Open'}</em>
    </button>
  )
}

function activityStage(action: string, status: 'ok' | 'error' | 'cancelled'):
  { label: string; className: string; icon: IconName } {
  if (status === 'error') return { label: 'Blocked', className: 'error', icon: 'warning' }
  if (status === 'cancelled') return { label: 'Stopped', className: 'retry', icon: 'close' }
  if (action === 'observe_arm_camera') return { label: 'Observe', className: 'observe', icon: 'eye' }
  if (action === 'get_arm_telemetry') return { label: 'Sense', className: 'sense', icon: 'activity' }
  if (action === 'set_arm_outputs') return { label: 'Act', className: 'act', icon: 'joint' }
  if (action === 'begin_arm_trial') return { label: 'Start', className: 'start', icon: 'spark' }
  if (action === 'end_arm_trial') return { label: 'Ended', className: 'result', icon: 'close' }
  return { label: 'Build', className: 'build', icon: 'layers' }
}

function AgentRunPanel({
  run,
  runs,
  onSelectRun,
  elapsedMs,
  playbackStatus,
  onPlayPause,
  onRestart,
  onSeek,
}: {
  run?: RecordedRun
  runs: RecordedRun[]
  onSelectRun: (id: string) => void
  elapsedMs: number
  playbackStatus: PlaybackStatus
  onPlayPause: () => void
  onRestart: () => void
  onSeek: (elapsedMs: number) => void
}) {
  const entries = (run?.events ?? []).map((entry) => ({ entry, stage: activityStage(entry.action, entry.status) }))
  const agentCount = entries.filter(({ entry }) => entry.source === 'webmcp').length
  const durationMs = run?.durationMs ?? Math.max(run?.events.at(-1)?.elapsedMs ?? 0, elapsedMs)
  const recording = Boolean(run && !run.finishedAt)
  const currentEvent = run ? timelineEntryAt(run, elapsedMs) : undefined
  const playLabel = playbackStatus === 'playing'
    ? 'Pause replay'
    : playbackStatus === 'paused' && elapsedMs < durationMs
      ? 'Resume replay'
      : 'Replay at 1× speed'
  return (
    <div className="agent-run-panel">
      {runs.length > 1 ? <label className="run-picker">Attempt <select aria-label="Recorded attempt" value={run?.id ?? ''} disabled={recording} onChange={(event) => onSelectRun(event.target.value)}>{runs.map((item, index) => <option key={item.id} value={item.id}>{`Attempt ${index + 1} · ${new Date(item.startedAt).toLocaleString()} · ${item.finishedAt ? formatRunDuration(item.durationMs ?? 0) : 'Recording'}`}</option>)}</select></label> : null}
      <div className="activity-heading"><SectionTitle icon="activity" title="Attempt timeline" count={agentCount} /><span>{recording ? 'Recording tool calls' : run ? `${formatRunDuration(durationMs)} elapsed` : 'No attempt recorded'}</span></div>
      {run ? (
        <div className="run-transport">
          <span className={`run-clock ${recording ? 'recording' : playbackStatus}`}><i />{recording ? 'REC' : playbackStatus === 'playing' ? 'PLAYING 1×' : 'REPLAY'}<strong>{formatRunDuration(elapsedMs)}<small> / {formatRunDuration(durationMs)}</small></strong></span>
          <input
            type="range"
            min="0"
            max={Math.max(durationMs, 1)}
            step="50"
            value={Math.min(elapsedMs, Math.max(durationMs, 1))}
            disabled={recording}
            aria-label="Replay position"
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
          />
          {!recording ? <span className="run-playback-actions">
            <button type="button" onClick={onPlayPause} aria-label={playLabel} title={playLabel}><Icon name={playbackStatus === 'playing' ? 'pause' : 'play'} size={13} /><span>{playbackStatus === 'playing' ? 'Pause' : elapsedMs > 0 && elapsedMs < durationMs ? 'Resume' : 'Replay 1×'}</span></button>
            <button type="button" onClick={onRestart} aria-label="Restart replay" title="Restart replay"><Icon name="redo" size={13} /></button>
            <button type="button" onClick={() => onSeek(entries.find(({ entry }) => entry.elapsedMs > elapsedMs)?.entry.elapsedMs ?? durationMs)} aria-label="Next recorded event" title="Skip to next event">Next</button>
          </span> : null}
        </div>
      ) : null}
      {run ? <p className="run-evidence-note">Actual tool events · 1× keeps the original pauses · click a step to jump{run.events.length >= 120 ? ' · 120-event limit: earlier steps may be omitted' : ''}</p> : null}
      {entries.length === 0 ? (
        <div className="activity-empty"><span className="activity-empty-icon"><Icon name="activity" size={16} /></span><span><strong>No run yet</strong><small>Start an agent run to watch every attempt.</small></span></div>
      ) : (
        <div className="activity-list" aria-label="Agent and human action timeline">
          {entries.map(({ entry, stage }) => {
            const revealed = recording || entry.elapsedMs <= elapsedMs
            const current = currentEvent?.id === entry.id
            return (
              <button type="button" disabled={recording} onClick={() => onSeek(entry.elapsedMs)} className={`activity-row ${entry.status} ${revealed ? 'is-revealed' : 'is-future'} ${current ? 'is-current' : ''}`} key={entry.id} aria-current={current ? 'step' : undefined} aria-label={`Jump to ${stage.label} at ${formatRunDuration(entry.elapsedMs)}`}>
                <span className={`run-stage ${stage.className}`}><Icon name={stage.icon} size={12} />{stage.label}</span>
                <span><strong>{entry.summary}</strong><small>{entry.source === 'webmcp' ? 'WebMCP' : entry.source === 'system' ? 'System' : 'Human'} · {compactTime(entry.at)} · r{entry.revision}</small></span>
                <time dateTime={`PT${entry.elapsedMs / 1_000}S`}>+{formatRunDuration(entry.elapsedMs)}</time>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AgentRunHud({ run, current, elapsedMs, playbackStatus, onOpen }: {
  run?: RecordedRun
  current?: RecordedRunEvent
  elapsedMs: number
  playbackStatus: PlaybackStatus
  onOpen: () => void
}) {
  const stage = current ? activityStage(current.action, current.status) : undefined
  const recording = Boolean(run && !run.finishedAt)
  const status = recording ? 'REC' : playbackStatus === 'playing' ? 'REPLAY 1×' : stage?.label ?? 'READY'
  return (
    <button className={`run-hud ${stage?.className ?? 'idle'} ${recording ? 'is-recording' : ''}`} type="button" onClick={onOpen} aria-label={current ? `Open agent run. Current step: ${stage?.label}. ${current.summary}` : 'Open agent run. Ready to record.'}>
      <span className={`run-hud-icon ${stage?.className ?? 'idle'}`} aria-hidden="true"><Icon name={stage?.icon ?? 'activity'} size={15} /></span>
      <span className="run-hud-copy"><strong>{current?.summary ?? 'Agent ready'}</strong><small>{status} · {current ? `${current.source === 'webmcp' ? 'Agent' : current.source === 'system' ? 'System' : 'Human'} step` : 'Run activity appears here'}</small></span>
      <time dateTime={`PT${elapsedMs / 1_000}S`}>{formatRunDuration(elapsedMs)}</time>
    </button>
  )
}

function OperationInspector() {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const camera = state.scene.cameras.find((candidate) => candidate.id === state.operation?.cameraId) ?? state.scene.cameras[0]
  const evaluation = useMemo(() => evaluateSimulationGoal(state.scene), [state])
  return (
    <div className="inspector-scroll operation-inspector">
      <div className="inspector-heading">
        <span className="entity-badge robot"><Icon name="eye" size={17} /></span>
        <div><h2>Agent run</h2><p>Camera-guided control</p></div>
      </div>
      <div className="restriction-banner"><span><Icon name="info" size={14} /><strong>World editing is locked</strong></span><p>The agent cannot read object positions or call a task shortcut.</p></div>
      <PropertyGroup title="Agent loop">
        <div className="property-row static"><span>Input</span><strong>Camera + joint telemetry</strong></div>
        <div className="property-row static"><span>Output</span><strong>Joint targets + gripper</strong></div>
        <div className="property-row static"><span>Camera</span><strong>{camera?.name ?? 'Unavailable'}</strong></div>
      </PropertyGroup>
      <PropertyGroup title="Live state">
        <div className="stat-grid">
          <div><span>Joints</span><strong>{state.scene.robot.joints.length}</strong></div>
          <div><span>Gripper</span><strong>{state.operation?.gripper ?? 'open'}</strong></div>
          <div><span>Holding</span><strong>{state.scene.grasp ? 'yes' : 'no'}</strong></div>
          <div><span>Visible result</span><strong>{evaluation.succeeded ? 'complete' : 'pending'}</strong></div>
        </div>
      </PropertyGroup>
    </div>
  )
}

function HomeScreen({ onOpen, onWatch, webMcpStatus, run }: { onOpen: () => void; onWatch: () => void; webMcpStatus: WebMcpStatus; run?: RecordedRun }) {
  const [setupOpen, setSetupOpen] = useState(() => new URLSearchParams(window.location.search).get('setup') === '1')
  const toolState = webMcpStatus === 'ready'
    ? `${WEBMCP_TOOL_NAMES.length} tools ready`
    : webMcpStatus === 'registering'
      ? 'Connecting tools'
      : webMcpStatus === 'error'
        ? 'Tool connection error'
        : 'Human mode ready'
  return (
    <main className="home-screen">
      <nav className="home-nav" aria-label="RAI home">
        <span className="home-brand"><span className="home-brand-mark"><Icon name="arm" size={15} /></span><strong>RAI</strong><span>Robot Agent Interface</span></span>
        <a href={RAI_REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub ↗</a>
      </nav>
      <section className="home-hero">
        <div className="home-copy">
          <p className="home-kicker">WebMCP robotics workbench</p>
          <h2>Build the robot.<br />Watch the agent work.</h2>
          <p className="home-lede">Build an arm, mount a camera, and set a task. Give an agent joint and gripper controls, then watch its attempts and replay them at their real pace.</p>
          <div className="home-actions">
            <button type="button" onClick={onOpen}>Open workbench</button>
            <button type="button" onClick={() => setSetupOpen(true)}>Set up with AI</button>
          </div>
          <div className="home-proof" aria-label="Product capabilities">
            <span>{toolState}</span><span>Camera-limited runs</span><span>Timed 1× replay</span>
          </div>
        </div>
        <div className="home-agent-card" aria-label="RAI attempt recording">
          <span className="home-agent-status"><em><i />{run ? run.finishedAt ? 'Saved in this browser' : 'Run in progress' : 'No agent run yet'}</em><strong>{run ? 'Your latest attempt.' : 'Watch what the agent actually does.'}</strong><small>Tool calls and scene states, with their original timing. Not a scripted animation.</small></span>
          <div className="home-run-clock"><span>{run ? `${run.events.length} EVENTS` : 'OBSERVE → ACT → CHECK'}</span><strong>{run ? formatRunDuration(run.durationMs ?? run.events.at(-1)?.elapsedMs ?? 0) : 'Your turn.'}</strong><em>{run ? '1×' : 'REC'}</em></div>
          <div className="home-mini-run" aria-label="Agent loop">
            {run ? run.events.slice(-3).map((entry) => <div key={entry.id}><span>{activityStage(entry.action, entry.status).label}</span><strong>{entry.summary}</strong><time>+{formatRunDuration(entry.elapsedMs)}</time></div>) : <div><span>Start</span><strong>Connect an agent to record an attempt.</strong></div>}
          </div>
          {run ? <button type="button" className="home-watch-run" onClick={onWatch}>{run.finishedAt ? 'Watch this attempt' : 'Watch live'} →</button> : null}
        </div>
      </section>
      <footer className="home-footer"><span>Simulation only · no physical hardware control</span><nav aria-label="Project links"><a href={RAI_REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub ↗</a><button type="button" onClick={() => setSetupOpen(true)}>Agent setup ↗</button></nav></footer>
      <AgentSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />
    </main>
  )
}

function WorkbenchApp() {
  const state = useSyncExternalStore(simulationStore.subscribe, simulationStore.getSnapshot, simulationStore.getSnapshot)
  const operating = state.phase === 'operate'
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const newestRun = state.recordings.at(-1)
  const latestRun = operating ? newestRun : state.recordings.find((run) => run.id === selectedRunId) ?? newestRun
  const persistenceStatus = simulationStore.getPersistenceStatus()
  const recording = Boolean(latestRun && !latestRun.finishedAt)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('idle')
  const [playbackElapsedMs, setPlaybackElapsedMs] = useState(0)
  const playbackAnchor = useRef(0)
  const [selection, setSelection] = useState<Selection>({ kind: 'robot', id: state.scene.robot.id })
  const [leftTab, setLeftTab] = useState<'scene' | 'library'>('scene')
  const [view, setView] = useState<ViewPreset>('iso')
  const [cameraView, setCameraView] = useState({ yawDeg: 0, pitchDeg: 0, distanceScale: 1 })
  const [activeCameraId, setActiveCameraId] = useState<string | undefined>(state.scene.cameras[0]?.id)
  const [dockTab, setDockTab] = useState<DockTab>('pose')
  const [dockOpen, setDockOpen] = useState(false)
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string }>()
  const [agentBriefOpen, setAgentBriefOpen] = useState(false)
  const [agentSetupOpen, setAgentSetupOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [webMcpStatus, setWebMcpStatus] = useState<WebMcpStatus>('registering')
  const [homeOpen, setHomeOpen] = useState(() => window.location.hash !== '#workbench')
  const importInput = useRef<HTMLInputElement>(null)
  const agentBriefDialog = useRef<HTMLDialogElement>(null)
  const resetDialog = useRef<HTMLDialogElement>(null)
  const initialAgentActivityId = useRef(state.activity.slice().reverse().find((entry) => entry.source === 'webmcp')?.id)

  useEffect(() => { setSelectedRunId(undefined) }, [newestRun?.id])

  useEffect(() => {
    setPlaybackStatus('idle')
    setPlaybackElapsedMs(0)
  }, [latestRun?.id])

  useEffect(() => {
    if (!recording) return
    setClockNow(Date.now())
    const interval = window.setInterval(() => setClockNow(Date.now()), 100)
    return () => window.clearInterval(interval)
  }, [latestRun?.id, recording])

  useEffect(() => {
    if (playbackStatus !== 'playing' || !latestRun?.finishedAt) return
    const durationMs = latestRun.durationMs ?? latestRun.events.at(-1)?.elapsedMs ?? 0
    let frame = 0
    let lastDisplayedTenth = -1
    const tick = (now: number) => {
      const nextElapsedMs = Math.min(durationMs, Math.max(0, now - playbackAnchor.current))
      const tenth = Math.floor(nextElapsedMs / 100)
      if (tenth !== lastDisplayedTenth || nextElapsedMs >= durationMs) {
        setPlaybackElapsedMs(nextElapsedMs)
        lastDisplayedTenth = tenth
      }
      if (nextElapsedMs >= durationMs) {
        setPlaybackStatus('complete')
        return
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [latestRun?.durationMs, latestRun?.finishedAt, latestRun?.id, playbackStatus])

  const runDurationMs = latestRun?.durationMs ?? latestRun?.events.at(-1)?.elapsedMs ?? 0
  const liveElapsedMs = recording && latestRun
    ? Math.max(runDurationMs, clockNow - new Date(latestRun.startedAt).valueOf())
    : runDurationMs
  const replaying = Boolean(latestRun?.finishedAt && (playbackStatus === 'playing' || playbackStatus === 'paused'))
  const runReviewFocused = Boolean(latestRun?.finishedAt && dockOpen && dockTab === 'activity')
  const replayFocused = replaying || runReviewFocused
  const visibleRunElapsedMs = replaying ? playbackElapsedMs : liveElapsedMs
  const currentRunEvent = latestRun ? timelineEntryAt(latestRun, visibleRunElapsedMs) : undefined
  const playbackFrame = replayFocused && latestRun?.finishedAt ? timelineFrameAt(latestRun, visibleRunElapsedMs) : undefined
  const displayScene = playbackFrame?.scene ?? state.scene
  const computed = useMemo(() => computeSceneKinematics(displayScene), [displayScene])
  const runFocused = operating || replayFocused

  useEffect(() => {
    const registration = installWebMcpTools()
    let current = true
    if (!registration.supported) {
      setWebMcpStatus('unavailable')
      return () => { current = false; registration.dispose() }
    }
    setWebMcpStatus('registering')
    void registration.ready.then(
      () => { if (current) setWebMcpStatus('ready') },
      () => { if (current) setWebMcpStatus('error') },
    )
    return () => { current = false; registration.dispose() }
  }, [])

  useEffect(() => {
    if (activeCameraId && state.scene.cameras.some((camera) => camera.id === activeCameraId)) return
    setActiveCameraId(state.scene.cameras[0]?.id)
  }, [activeCameraId, state.scene.cameras])

  const firstCameraId = state.scene.cameras[0]?.id

  useEffect(() => {
    if (!operating) return
    setActiveCameraId(state.operation?.cameraId ?? firstCameraId)
    setDockTab('camera')
    setDockOpen(true)
  }, [firstCameraId, operating, state.operation?.cameraId])

  useEffect(() => {
    const exists = selection.kind === 'robot'
      ? selection.id === state.scene.robot.id
      : selection.kind === 'joint'
        ? state.scene.robot.joints.some((joint) => joint.id === selection.id)
        : selection.kind === 'camera'
          ? state.scene.cameras.some((camera) => camera.id === selection.id)
          : state.scene.objects.some((object) => object.id === selection.id)
    if (!exists) setSelection({ kind: 'robot', id: state.scene.robot.id })
  }, [selection, state.scene])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(undefined), 3200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    const dialog = agentBriefDialog.current
    if (!dialog) return
    if (agentBriefOpen && !dialog.open) dialog.showModal()
    else if (!agentBriefOpen && dialog.open) dialog.close()
  }, [agentBriefOpen])

  useEffect(() => {
    const latestAgentEntry = state.activity.slice().reverse().find((entry) => entry.source === 'webmcp')
    if (!latestAgentEntry || latestAgentEntry.id === initialAgentActivityId.current) return
    initialAgentActivityId.current = latestAgentEntry.id
    setHomeOpen(false)
    window.history.replaceState(null, '', '#workbench')
  }, [state.activity])

  useEffect(() => {
    const dialog = resetDialog.current
    if (!dialog) return
    if (resetOpen && !dialog.open) dialog.showModal()
    else if (!resetOpen && dialog.open) dialog.close()
  }, [resetOpen])

  const dispatch: CommandDispatcher = (command) => {
    try {
      const result = simulationStore.dispatch(command, { source: 'ui' })
      setNotice({ type: 'ok', text: result.summary })
      return result
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'The simulation command failed.' })
      return undefined
    }
  }

  const fallbackSelection = () => setSelection({ kind: 'robot', id: simulationStore.getSnapshot().scene.robot.id })

  const chooseView = (preset: ViewPreset) => {
    setView(preset)
    setCameraView({ yawDeg: 0, pitchDeg: 0, distanceScale: 1 })
  }

  const adjustCameraView = (patch: Partial<typeof cameraView>) => {
    setCameraView((current) => ({ ...current, ...patch }))
  }

  const saveSnapshot = () => dispatch({ type: 'save_simulation_snapshot', name: `${state.scene.robot.name} ${state.snapshots.length + 1}` })

  const copyAgentBrief = async () => {
    if (!window.navigator.clipboard?.writeText) {
      setNotice({ type: 'error', text: 'Clipboard access is unavailable in this browser.' })
      return
    }
    try {
      await window.navigator.clipboard.writeText(AGENT_RUN_PROMPT)
      setNotice({ type: 'ok', text: 'Agent brief copied.' })
    } catch {
      setNotice({ type: 'error', text: 'Could not copy the agent brief.' })
    }
  }

  const openWorkbench = () => {
    setHomeOpen(false)
    window.history.replaceState(null, '', '#workbench')
  }

  const openHome = () => {
    if (playbackStatus === 'playing') setPlaybackStatus('paused')
    setHomeOpen(true)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }

  const startFresh = () => {
    setResetOpen(true)
  }

  const confirmFresh = () => {
    simulationStore.clearPersistence()
    window.location.reload()
  }

  const exportProject = () => {
    downloadTextFile(
      simulationStore.exportState(),
      'application/json',
      `${state.scene.robot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'robot'}-scene.json`,
    )
    simulationStore.logActivity({ source: 'ui', action: 'export_state', status: 'ok', summary: 'Exported the current simulation scene.' })
    setNotice({ type: 'ok', text: 'Simulation JSON exported.' })
  }

  const exportUrdf = () => {
    try {
      const exported = createRobotUrdfExport(state.scene.robot)
      downloadTextFile(exported.xml, exported.mimeType, exported.filename)
      simulationStore.logActivity({ source: 'ui', action: 'export_urdf', status: 'ok', summary: 'Exported the robot as primitive visual URDF.' })
      setNotice({ type: 'ok', text: 'Primitive visual URDF exported.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'URDF export failed.' })
    }
  }

  const importProject = async (file?: File) => {
    if (!file) return
    try {
      const result = simulationStore.importState(await readSimulationImportFile(file))
      fallbackSelection()
      setNotice(result.persisted
        ? { type: 'ok', text: 'Simulation JSON imported.' }
        : { type: 'error', text: 'Simulation JSON imported for this page, but browser storage could not save it.' })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'Import failed.' })
    } finally {
      if (importInput.current) importInput.current.value = ''
    }
  }

  const openDock = (tab: DockTab) => {
    setDockTab(tab)
    setDockOpen(true)
  }

  const playPauseRun = () => {
    if (!latestRun?.finishedAt) return
    if (playbackStatus === 'playing') {
      setPlaybackStatus('paused')
      return
    }
    const startAt = playbackElapsedMs >= runDurationMs ? 0 : playbackElapsedMs
    playbackAnchor.current = performance.now() - startAt
    setPlaybackElapsedMs(startAt)
    setPlaybackStatus('playing')
    openDock('activity')
  }

  const restartRun = () => {
    if (!latestRun?.finishedAt) return
    playbackAnchor.current = performance.now()
    setPlaybackElapsedMs(0)
    setPlaybackStatus('playing')
    openDock('activity')
  }

  const seekRun = (elapsedMs: number) => {
    if (!latestRun?.finishedAt) return
    setPlaybackElapsedMs(Math.min(runDurationMs, Math.max(0, elapsedMs)))
    setPlaybackStatus('paused')
  }

  if (homeOpen) return <HomeScreen onOpen={openWorkbench} onWatch={() => { openWorkbench(); openDock('activity'); if (latestRun?.finishedAt) restartRun() }} webMcpStatus={webMcpStatus} run={latestRun} />

  return (
    <main className={`app-shell ${dockOpen ? 'dock-open' : 'dock-collapsed'} ${runFocused ? 'is-operating' : ''} ${replaying ? 'is-replaying' : ''} ${dockOpen && dockTab === 'camera' ? 'camera-focused' : ''}`}>
      <a className="skip-link" href="#workbench-viewport">Skip to RAI simulator</a>
      <header className="app-header">
        <div className="brand-block">
          <button className="brand-mark" type="button" onClick={openHome} aria-label="Open RAI home" title="Home"><Icon name="arm" size={19} /></button>
          <div className="brand-copy"><h1 aria-label="RAI, Robot Agent Interface">RAI</h1><small aria-hidden="true">Robot Agent Interface</small></div>
          <span className={`phase-badge ${runFocused ? 'operate' : 'build'}`}>{replayFocused ? 'SIM · REPLAY' : operating ? 'SIM · RUN' : 'SIM · BUILD'}</span>
        </div>
        <div className="header-actions">
          <a className="header-github-link" href={RAI_REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="RAI on GitHub">GitHub ↗</a>
          <span aria-live="polite" className={`webmcp-badge ${webMcpStatus === 'ready' ? 'connected' : webMcpStatus === 'error' ? 'error' : 'fallback'}`} title={webMcpStatus === 'ready' ? `${WEBMCP_TOOL_NAMES.length} WebMCP tools are registered for this page.` : webMcpStatus === 'error' ? 'The browser exposed WebMCP, but registration failed.' : webMcpStatus === 'registering' ? 'Registering this page’s WebMCP tools.' : 'The full human interface works; open in a WebMCP-capable browser for agent tools.'}>
            <i />
            <span className="webmcp-label-full">{webMcpStatus === 'ready' ? 'Agent tools ready' : webMcpStatus === 'registering' ? 'Connecting' : webMcpStatus === 'error' ? 'WebMCP error' : 'Human mode'}</span>
            <span className="webmcp-label-compact">{webMcpStatus === 'ready' ? 'Ready' : webMcpStatus === 'registering' ? 'Connecting' : webMcpStatus === 'error' ? 'Error' : 'Human'}</span>
          </span>
          <button className="agent-task-button" type="button" onClick={() => setAgentBriefOpen(true)}><Icon name="spark" size={14} /><span>Agent brief</span></button>
          <IconButton icon="undo" label="Undo" disabled={runFocused || !state.history.undo.length} onClick={() => dispatch({ type: 'undo' })} />
          <IconButton icon="redo" label="Redo" disabled={runFocused || !state.history.redo.length} onClick={() => dispatch({ type: 'redo' })} />
          <details className="header-menu">
            <summary aria-label="File and scene actions" title="File and scene actions"><Icon name="more" size={16} /></summary>
            <div className="header-menu-popover">
              <button type="button" disabled={runFocused} onClick={(event) => { saveSnapshot(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="save" size={14} />Save snapshot</button>
              <button type="button" disabled={runFocused} onClick={(event) => { importInput.current?.click(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="upload" size={14} />Import JSON</button>
              <button type="button" onClick={(event) => { exportProject(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="download" size={14} />Export JSON</button>
              <button type="button" onClick={(event) => { exportUrdf(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="download" size={14} />Export URDF</button>
              <button type="button" disabled={runFocused} onClick={(event) => { startFresh(); event.currentTarget.closest('details')?.removeAttribute('open') }}><Icon name="trash" size={14} />Start fresh</button>
            </div>
          </details>
          <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importProject(event.currentTarget.files?.[0])} />
        </div>
      </header>

      {!runFocused ? <aside className="left-panel panel-frame" aria-label="Robot scene and component library">
        <div className="panel-tabs" role="group" aria-label="Workbench browser">
          <button aria-pressed={leftTab === 'scene'} className={leftTab === 'scene' ? 'active' : ''} type="button" onClick={() => setLeftTab('scene')}><Icon name="layers" size={14} />Scene</button>
          <button aria-pressed={leftTab === 'library'} className={leftTab === 'library' ? 'active' : ''} type="button" onClick={() => setLeftTab('library')}><Icon name="spark" size={14} />Add</button>
        </div>
        <fieldset className="panel-lock-fieldset">
          <legend className="visually-hidden">Scene editing controls</legend>
          <div className="panel-scroll">
            {leftTab === 'scene' ? <SceneTree selection={selection} onSelect={setSelection} dispatch={dispatch} /> : <PresetLibrary dispatch={dispatch} onSelect={setSelection} />}
          </div>
        </fieldset>
      </aside> : null}

      <section id="workbench-viewport" className="viewport-panel" aria-label="Interactive robot scene" tabIndex={-1}>
        <p className="visually-hidden" role="status">
          {replayFocused
            ? `${displayScene.robot.name}, replay at ${formatRunDuration(visibleRunElapsedMs)}.`
            : operating
              ? `${state.scene.robot.name}, agent run active, revision ${state.revision}, ${state.scene.robot.joints.length} controllable joints.`
              : `${state.scene.robot.name}, build mode, revision ${state.revision}, ${state.scene.robot.joints.length} degrees of freedom. End effector at ${vectorMm(computed.endEffector.positionM)} millimetres.`}
        </p>
        <RobotViewport
          scene={displayScene}
          computed={computed}
          selectedId={selection.id}
          view={view}
          cameraView={cameraView}
          gripperClosed={playbackFrame?.gripperClosed ?? state.operation?.gripper === 'closed'}
          onSelect={(kind, id) => setSelection({ kind, id } as Selection)}
        />
        <AgentRunHud run={latestRun} current={currentRunEvent} elapsedMs={visibleRunElapsedMs} playbackStatus={playbackStatus} onOpen={() => openDock('activity')} />
        {runFocused && dockTab === 'activity' ? <div className="run-camera-preview"><span>{replayFocused ? 'Recorded camera pose' : 'Arm camera'} · simulated view</span><SensorViewport scene={displayScene} computed={computed} cameraId={replayFocused && latestRun ? recordingCameraId(latestRun) : state.operation?.cameraId ?? activeCameraId} gripperClosed={playbackFrame?.gripperClosed ?? state.operation?.gripper === 'closed'} /></div> : null}
        {!replayFocused ? <ViewportGoalChip onOpen={() => openDock('pose')} /> : null}
        <div className="viewport-meta"><span><i className="live-dot" />{replayFocused ? `RECORDED RUN · 1×` : operating ? `AGENT RUN · CAMERA-GUIDED` : `ARM SIM · ${state.scene.robot.joints.length} DOF`}</span></div>
        <div className="view-switcher">
          <div role="group" aria-label="Viewport orientation">
            {(['iso', 'front', 'top'] as ViewPreset[]).map((preset) => <button type="button" title={preset === 'top' ? 'Top view hides height' : `${preset} view`} aria-pressed={view === preset && cameraView.yawDeg === 0 && cameraView.pitchDeg === 0} className={view === preset && cameraView.yawDeg === 0 && cameraView.pitchDeg === 0 ? 'active' : ''} key={preset} onClick={() => chooseView(preset)}>{preset}</button>)}
          </div>
          <div role="group" aria-label="Viewport camera adjustment">
            <button type="button" aria-label="Rotate camera left" title="Rotate left" onClick={() => adjustCameraView({ yawDeg: cameraView.yawDeg - 15 })}><Icon name="undo" size={13} /></button>
            <button type="button" aria-label="Rotate camera right" title="Rotate right" onClick={() => adjustCameraView({ yawDeg: cameraView.yawDeg + 15 })}><Icon name="redo" size={13} /></button>
            <button type="button" aria-label="Tilt camera up" title="Tilt up" onClick={() => adjustCameraView({ pitchDeg: Math.min(65, cameraView.pitchDeg + 10) })}><Icon name="chevron" size={13} className="icon-up" /></button>
            <button type="button" aria-label="Tilt camera down" title="Tilt down" onClick={() => adjustCameraView({ pitchDeg: Math.max(-65, cameraView.pitchDeg - 10) })}><Icon name="chevron" size={13} className="icon-down" /></button>
            <button type="button" aria-label="Zoom camera out" title="Zoom out" onClick={() => adjustCameraView({ distanceScale: Math.min(1.8, cameraView.distanceScale + 0.15) })}><Icon name="minus" size={13} /></button>
            <button type="button" aria-label="Zoom camera in" title="Zoom in" onClick={() => adjustCameraView({ distanceScale: Math.max(0.55, cameraView.distanceScale - 0.15) })}><Icon name="plus" size={13} /></button>
          </div>
        </div>
        <div className="axis-key" aria-hidden="true"><span className="x">X</span><span className="y">Y</span><span className="z">Z</span></div>
      </section>

      {!runFocused ? <aside className="right-panel panel-frame" aria-label="Selection properties">
        <div className="right-panel-title"><span>Properties</span></div>
        <Inspector selection={selection} dispatch={dispatch} onFallback={fallbackSelection} />
      </aside> : null}

      <section className={`bottom-dock panel-frame ${dockOpen ? 'is-open' : 'is-collapsed'}`} aria-label="Workbench controls">
        <div className="drawer-bar">
          <div className="drawer-tabs" role="tablist" aria-label="Workbench control panels">
            {([
              ['pose', 'joint', 'Control'],
              ['camera', 'camera', 'Camera'],
              ['activity', 'activity', 'Run'],
            ] as const).map(([tab, icon, label]) => (
              <button
                id={`drawer-tab-${tab}`}
                role="tab"
                aria-selected={dockTab === tab}
                aria-controls="drawer-panel"
                className={dockTab === tab ? 'active' : ''}
                type="button"
                key={tab}
                disabled={replaying && tab !== 'activity'}
                onClick={() => openDock(tab)}
              >
                <Icon name={icon} size={14} />{label}
                {tab === 'activity' && (latestRun?.events.length || state.activity.length) ? <b>{latestRun?.events.filter((entry) => entry.source === 'webmcp').length || state.activity.filter((entry) => entry.source === 'webmcp').length || state.activity.length}</b> : null}
              </button>
            ))}
          </div>
          <button className="drawer-toggle" type="button" aria-expanded={dockOpen} aria-controls="drawer-panel" aria-label={dockOpen ? 'Collapse control drawer' : 'Expand control drawer'} title={dockOpen ? 'Collapse drawer' : 'Expand drawer'} onClick={() => setDockOpen((open) => !open)}>
            <Icon name="chevron" size={14} />
          </button>
        </div>
        <div id="drawer-panel" className="drawer-content" role="tabpanel" aria-labelledby={`drawer-tab-${dockTab}`} hidden={!dockOpen}>
          {dockTab === 'pose' && !replaying ? <div className="pose-drawer-panel"><JointControls dispatch={dispatch} /><AgentTaskPanel dispatch={dispatch} /></div> : null}
          {dockTab === 'camera' && !replaying ? <CameraDock activeCameraId={activeCameraId} setActiveCameraId={setActiveCameraId} /> : null}
          {dockTab === 'activity' ? <AgentRunPanel run={latestRun} runs={state.recordings} onSelectRun={setSelectedRunId} elapsedMs={visibleRunElapsedMs} playbackStatus={playbackStatus} onPlayPause={playPauseRun} onRestart={restartRun} onSeek={seekRun} /> : null}
        </div>
      </section>

      <dialog ref={agentBriefDialog} className="agent-task-dialog agent-brief-dialog" aria-labelledby="agent-task-dialog-title" onClose={() => setAgentBriefOpen(false)}>
        <form method="dialog">
          <div className="agent-task-dialog-heading">
            <span className="agent-challenge-mark"><Icon name="spark" size={14} /></span>
            <span><small>Agent handoff</small><h2 id="agent-task-dialog-title">Run the current task</h2></span>
          </div>
          <p>Copy one brief into a WebMCP-capable agent. It can build any supported robot; camera-limited runs stay visible and replayable here.</p>
          <div className="agent-brief-flow" aria-label="Agent workflow">
            <span><b>1</b><strong>Build</strong><small>Robot + sensors</small></span>
            <span><b>2</b><strong>Run</strong><small>Camera + outputs</small></span>
            <span><b>3</b><strong>Replay</strong><small>Every attempt</small></span>
          </div>
          <div className="agent-task-dialog-actions">
            <button type="button" onClick={() => { agentBriefDialog.current?.close(); setAgentSetupOpen(true) }}>Agent setup</button>
            <button type="button" onClick={() => void copyAgentBrief()}>Copy agent brief</button>
            <button type="submit">Close</button>
          </div>
        </form>
      </dialog>

      <AgentSetupDialog open={agentSetupOpen} onClose={() => setAgentSetupOpen(false)} />

      <dialog ref={resetDialog} className="agent-task-dialog reset-dialog" aria-labelledby="reset-dialog-title" onClose={() => setResetOpen(false)}>
        <form method="dialog">
          <div className="agent-task-dialog-heading">
            <span className="agent-challenge-mark reset-mark"><Icon name="warning" size={14} /></span>
            <span><small>Saved browser state</small><h2 id="reset-dialog-title">Start a fresh workbench?</h2></span>
          </div>
          <p>This clears the scene, run log, history, activity, and snapshots stored in this browser. The reset cannot be undone.</p>
          <div className="agent-task-dialog-actions">
            <button type="submit">Keep current scene</button>
            <button className="danger-action" type="button" onClick={confirmFresh}>Clear and restart</button>
          </div>
        </form>
      </dialog>

      {persistenceStatus !== 'saved' ? <div className="storage-warning" role="alert">{persistenceStatus === 'conflict' ? 'Another tab has newer saved work. This tab will not overwrite it.' : 'Browser saving is unavailable.'} Export JSON to keep this tab’s work before reloading.</div> : null}
      {notice ? <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}><Icon name={notice.type === 'ok' ? 'check' : 'warning'} size={15} />{notice.text}</div> : null}
    </main>
  )
}

export default function App() {
  return <><AgentCameraCapture /><WorkbenchApp /></>
}
