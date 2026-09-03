import {
  CAMERA_PRESETS,
  assertNoUnknownKeys,
  assertRecord,
  computeProjectedCylinderAxis,
  computeSceneKinematics,
  evaluateSimulationGoal,
  ROBOT_PRESETS,
  SimulationError,
  simulationStore,
  type CommandResult,
  type SimulationStore,
} from '../domain'
import { parseStateQuery, parseToolCommand } from './parser'
import { WEBMCP_INPUT_SCHEMAS } from './schemas'
import type { WebMcpExecutionOptions, WebMcpToolDefinition } from './types'

const NEVER_ABORTED_SIGNAL = new AbortController().signal

function errorResult(error: unknown, revision: number) {
  if (error instanceof SimulationError) {
    return {
      ok: false,
      revision,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    }
  }
  return {
    ok: false,
    revision,
    error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Unknown simulator error.' },
  }
}

function executionSignal(options?: WebMcpExecutionOptions): AbortSignal {
  return options?.signal ?? NEVER_ABORTED_SIGNAL
}

function throwIfAborted(options?: WebMcpExecutionOptions): void {
  executionSignal(options).throwIfAborted()
}

function mutationExecute(store: SimulationStore, toolName: string): WebMcpToolDefinition['execute'] {
  return async (input, options) => {
    try {
      throwIfAborted(options)
    } catch (error) {
      store.logActivity({ source: 'webmcp', action: toolName, status: 'cancelled', summary: `Cancelled ${toolName} before execution.` })
      throw error
    }

    let command
    let includeAllSequenceSamples = false
    try {
      let commandInput = input
      if (toolName === 'run_joint_sequence') {
        assertRecord(input, 'input')
        if (input.includeAllSamples !== undefined && typeof input.includeAllSamples !== 'boolean') {
          throw new SimulationError('INVALID_INPUT', 'includeAllSamples must be a boolean.')
        }
        includeAllSequenceSamples = input.includeAllSamples === true
        commandInput = { ...input }
        delete commandInput.includeAllSamples
      }
      command = parseToolCommand(toolName, commandInput)
    } catch (error) {
      store.logActivity({
        source: 'webmcp', action: toolName, status: 'error',
        summary: error instanceof Error ? error.message : `Invalid ${toolName} input.`,
      })
      return errorResult(error, store.getSnapshot().revision)
    }

    try {
      throwIfAborted(options)
      const result = await store.dispatchAsync(command, { source: 'webmcp' })
      return toolName === 'run_joint_sequence' && !includeAllSequenceSamples
        ? compactSequenceResult(result)
        : result
    } catch (error) {
      if (executionSignal(options).aborted) {
        store.logActivity({
          source: 'webmcp', action: toolName, status: 'cancelled',
          summary: `Cancelled ${toolName}.`, requestId: command.requestId,
        })
        throw error
      }
      return errorResult(error, store.getSnapshot().revision)
    }
  }
}

const MAX_COMPACT_SEQUENCE_SAMPLES = 5

function evenlySpacedSamples<T>(items: T[], maximum: number): T[] {
  if (items.length <= maximum) return items
  return Array.from({ length: maximum }, (_, sampleIndex) => (
    items[Math.round(sampleIndex * (items.length - 1) / (maximum - 1))]
  ))
}

function compactSequenceResult(result: CommandResult): CommandResult {
  const samples = result.data?.samples
  if (!Array.isArray(samples)) return result
  const compactSamples = evenlySpacedSamples(samples, MAX_COMPACT_SEQUENCE_SAMPLES)
  return {
    ...result,
    data: {
      ...result.data,
      samples: compactSamples,
      samplesComplete: compactSamples.length === samples.length,
      omittedSampleCount: samples.length - compactSamples.length,
    },
  }
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function roundedTuple(values: readonly number[]) {
  return values.map(rounded)
}

function requireBuildRead(store: SimulationStore, toolName: string): void {
  if (store.getSnapshot().phase === 'operate') {
    throw new SimulationError(
      'PHASE_LOCKED',
      `${toolName} is unavailable during an arm trial. Use observe_arm_camera, get_arm_telemetry, set_arm_outputs, or end_arm_trial.`,
    )
  }
}

function requireOperateRead(store: SimulationStore, toolName: string): void {
  if (store.getSnapshot().phase !== 'operate') {
    throw new SimulationError('CONFLICT', `${toolName} requires an active arm trial.`)
  }
}

function listPresetsResult(detailed: boolean) {
  return {
    ok: true,
    units: { revolute: 'degrees', continuous: 'degrees', prismatic: 'metres', lengths: 'metres' },
    robotPresets: ROBOT_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      jointCount: preset.robot.joints.length,
      nominalReachM: preset.robot.metadata.nominalReachM,
      accuracy: preset.robot.metadata.accuracy,
      ...(detailed ? {
        description: preset.description,
        joints: preset.robot.joints.map((joint) => ({ id: joint.id, name: joint.name, type: joint.type })),
        linkLengthsM: preset.robot.links.map((link) => link.lengthM),
        note: preset.robot.metadata.note,
      } : {}),
    })),
    cameraPresets: CAMERA_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      resolutionPx: [preset.projection.widthPx, preset.projection.heightPx],
      fovDeg: [preset.projection.horizontalFovDeg, preset.projection.verticalFovDeg],
      ...(detailed ? { projection: preset.projection, note: preset.note } : {}),
    })),
    supportedJointTypes: ['fixed', 'revolute', 'continuous', 'prismatic'],
    supportedRobotTopologies: ['serial'],
    supportedScenePrimitives: ['box', 'sphere', 'cylinder', 'plane'],
    ...(detailed ? {
      capabilities: [
        'custom 1-to-8 joint serial chains',
        'Arm 101 camera-and-gripper trial workspace',
        'position-only IK during build',
        'deterministic kinematic grasp and carry',
        'camera-observation-only operation trials',
      ],
      limitations: [
        'one active serial robot only',
        'ideal pinhole cameras only; observations are analytic detections, not rendered pixels',
        'position-only IK; end-effector orientation is unconstrained',
        'kinematic grasp only; no contact force, payload, or grasp-stability model',
        'no physical robot or backend APIs',
      ],
    } : { simulationOnly: true }),
  }
}

function simulationStateResult(store: SimulationStore, includeVisibility: boolean, includeActivity: boolean, detailed: boolean) {
  const state = store.getSnapshot()
  const computed = computeSceneKinematics(state.scene)
  const goalEvaluation = evaluateSimulationGoal(state.scene)
  if (!detailed) {
    return {
      ok: true,
      revision: state.revision,
      phase: state.phase,
      units: { angularPosition: 'degrees', linearPosition: 'metres' },
      robot: {
        id: state.scene.robot.id,
        joints: state.scene.robot.joints.map((joint) => ({
          id: joint.id, type: joint.type, position: joint.position,
          ...(joint.limits ? { limits: joint.limits } : {}),
        })),
        endEffector: {
          positionM: roundedTuple(computed.endEffector.positionM),
          quaternionXyzw: roundedTuple(computed.endEffector.quaternionXyzw),
        },
      },
      cameras: state.scene.cameras.map((camera, index) => ({
        id: camera.id,
        parent: camera.parent,
        fovDeg: [camera.projection.horizontalFovDeg, camera.projection.verticalFovDeg],
        worldPose: {
          positionM: roundedTuple(computed.cameras[index].pose.positionM),
          quaternionXyzw: roundedTuple(computed.cameras[index].pose.quaternionXyzw),
        },
        ...(includeVisibility ? { objectVisibility: computed.cameraVisibility[index].objects } : {}),
      })),
      objects: state.scene.objects.map((object) => ({ id: object.id, pose: object.pose, geometry: object.geometry, movable: object.movable })),
      grasp: state.scene.grasp ? { objectId: state.scene.grasp.objectId } : null,
      goal: state.scene.goal ?? null,
      goalEvaluation,
      history: { undoCount: state.history.undo.length, redoCount: state.history.redo.length, snapshotCount: state.snapshots.length },
      ...(includeActivity ? { recentActivity: state.activity.slice(-20) } : {}),
      simulationOnly: true,
    }
  }
  return {
    ok: true,
    revision: state.revision,
    phase: state.phase,
    units: { angularJointPosition: 'degrees', prismaticJointPosition: 'metres', distance: 'metres' },
    robot: {
      id: state.scene.robot.id,
      name: state.scene.robot.name,
      metadata: state.scene.robot.metadata,
      basePose: state.scene.robot.basePose,
      joints: state.scene.robot.joints.map((joint, index) => ({
        id: joint.id, name: joint.name, type: joint.type, axis: joint.axis,
        position: joint.position, limits: joint.limits, worldPositionM: computed.joints[index].pose.positionM,
      })),
      links: state.scene.robot.links.map((link, index) => ({
        id: link.id, name: link.name, lengthM: link.lengthM, radiusM: link.radiusM,
        color: link.color, direction: link.direction,
        startPositionM: computed.links[index].startPose.positionM,
        endPositionM: computed.links[index].endPose.positionM,
      })),
      endEffector: { positionM: computed.endEffector.positionM, quaternionXyzw: computed.endEffector.quaternionXyzw },
    },
    cameras: state.scene.cameras.map((camera, index) => ({
      id: camera.id, name: camera.name, parent: camera.parent, pose: camera.pose,
      projection: camera.projection, presetId: camera.presetId,
      worldPose: {
        positionM: computed.cameras[index].pose.positionM,
        quaternionXyzw: computed.cameras[index].pose.quaternionXyzw,
      },
      ...(includeVisibility ? { objectVisibility: computed.cameraVisibility[index].objects } : {}),
    })),
    objects: state.scene.objects,
    grasp: state.scene.grasp ?? null,
    goal: state.scene.goal ?? null,
    goalEvaluation,
    snapshots: state.snapshots.map((snapshot) => ({
      id: snapshot.id, name: snapshot.name, createdAt: snapshot.createdAt, sourceRevision: snapshot.sourceRevision,
    })),
    history: { undoCount: state.history.undo.length, redoCount: state.history.redo.length },
    ...(includeActivity ? { recentActivity: state.activity.slice(-20) } : {}),
    simulationOnly: true,
  }
}

function visualClass(type: 'box' | 'sphere' | 'cylinder' | 'plane'): string {
  if (type === 'cylinder') return 'can-like cylinder'
  return `${type} primitive`
}

function operateActivitySummary(name: 'observe_arm_camera' | 'get_arm_telemetry', result: Record<string, unknown>): string {
  if (name === 'get_arm_telemetry') {
    const joints = Array.isArray(result.joints) ? result.joints : []
    const gripper = result.gripper as { state?: string } | undefined
    return `Read ${joints.length} joint position${joints.length === 1 ? '' : 's'} · gripper ${gripper?.state ?? 'unknown'}.`
  }
  const detections = Array.isArray(result.detections) ? result.detections as Array<Record<string, unknown>> : []
  if (detections.length === 0) return 'Observed 0 movable shapes in the camera frame.'
  const primary = detections[0]
  const center = primary.centerNormalized as number[] | undefined
  const horizontal = !center ? 'unknown' : center[0] < 0.4 ? 'left' : center[0] > 0.6 ? 'right' : 'center'
  const vertical = !center ? 'unknown' : center[1] < 0.4 ? 'high' : center[1] > 0.6 ? 'low' : 'middle'
  const axis = typeof primary.longAxisAngleDeg === 'number' ? ` · axis ${primary.longAxisAngleDeg.toFixed(1)}°` : ''
  return `Observed ${detections.length} movable shape${detections.length === 1 ? '' : 's'} · ${horizontal}/${vertical}/${String(primary.visibility ?? 'unknown')}${axis}.`
}

function operateReadDefinition(
  store: SimulationStore,
  name: 'observe_arm_camera' | 'get_arm_telemetry',
  title: string,
  description: string,
  read: () => Record<string, unknown>,
): WebMcpToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: WEBMCP_INPUT_SCHEMAS[name],
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, options) {
      try {
        throwIfAborted(options)
        assertRecord(input, 'input')
        assertNoUnknownKeys(input, [], 'input')
        requireOperateRead(store, name)
        const result = read()
        store.logActivity({ source: 'webmcp', action: name, status: 'ok', summary: operateActivitySummary(name, result) })
        return result
      } catch (error) {
        if (executionSignal(options).aborted) {
          store.logActivity({ source: 'webmcp', action: name, status: 'cancelled', summary: `Cancelled ${name}.` })
          throw error
        }
        store.logActivity({ source: 'webmcp', action: name, status: 'error', summary: error instanceof Error ? error.message : `${name} failed.` })
        return errorResult(error, store.getSnapshot().revision)
      }
    },
  }
}

export function createWebMcpToolDefinitions(store: SimulationStore = simulationStore): WebMcpToolDefinition[] {
  const mutation = (name: keyof typeof WEBMCP_INPUT_SCHEMAS, title: string, description: string): WebMcpToolDefinition => ({
    name, title, description,
    inputSchema: WEBMCP_INPUT_SCHEMAS[name],
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: mutationExecute(store, name),
  })

  return [
    {
      name: 'list_robotics_presets', title: 'List robotics presets',
      description: 'List the built-in serial-arm, camera, joint-type, and primitive catalogs available while building.',
      inputSchema: WEBMCP_INPUT_SCHEMAS.list_robotics_presets,
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input, options) {
        try {
          throwIfAborted(options)
          requireBuildRead(store, 'list_robotics_presets')
          assertRecord(input, 'input')
          assertNoUnknownKeys(input, ['detailed'], 'input')
          if (input.detailed !== undefined && typeof input.detailed !== 'boolean') throw new SimulationError('INVALID_INPUT', 'detailed must be a boolean.')
          return listPresetsResult(input.detailed === true)
        } catch (error) {
          if (executionSignal(options).aborted) throw error
          return errorResult(error, store.getSnapshot().revision)
        }
      },
    },
    {
      name: 'get_simulation_state', title: 'Get build-state details',
      description: 'Read detailed robot, camera, object, grasp, and goal state while building. Locked during arm trials.',
      inputSchema: WEBMCP_INPUT_SCHEMAS.get_simulation_state,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input, options) {
        try {
          throwIfAborted(options)
          requireBuildRead(store, 'get_simulation_state')
          const query = parseStateQuery(input)
          return simulationStateResult(store, query.includeVisibility, query.includeActivity, query.detailed)
        } catch (error) {
          if (executionSignal(options).aborted) throw error
          return errorResult(error, store.getSnapshot().revision)
        }
      },
    },
    mutation('load_robot_preset', 'Load serial-arm preset', 'Load Arm 101 or another built-in serial-arm preset.'),
    mutation('create_custom_robot', 'Create custom serial arm', 'Create an agent-authored 1-to-8 joint serial robot while building.'),
    mutation('edit_robot_chain', 'Edit robot chain', 'Atomically add, update, or remove joints and links while building.'),
    mutation('set_joint_positions', 'Set build pose', 'Set joint positions while arranging and testing the build.'),
    mutation('move_end_effector', 'Move end effector', 'Use bounded position-only IK while building.'),
    mutation('configure_camera', 'Configure camera', 'Add, update, attach, remove, or retune an ideal-pinhole camera while building.'),
    mutation('edit_scene_objects', 'Edit scene objects', 'Add, update, or remove bounded scene primitives while building.'),
    mutation('control_grasp', 'Build-mode grasp control', 'Attach or release a named nearby object while testing the build; locked during trials.'),
    mutation('move_grasped_object', 'Move grasped object', 'Use build-mode IK to move a named grasped object; locked during trials.'),
    mutation('set_simulation_goal', 'Set build objective', 'Set or clear a visible derived objective while building; hidden from trial agents.'),
    mutation('run_joint_sequence', 'Run build sequence', 'Validate and apply a kinematic joint sequence while building.'),
    mutation('save_simulation_snapshot', 'Save build snapshot', 'Save a named local scene snapshot while building.'),
    mutation('begin_arm_trial', 'Begin camera-only arm trial', 'Freeze construction and begin a repeatable trial. The agent then receives only camera observations, basic telemetry, and bounded outputs.'),
    operateReadDefinition(store, 'observe_arm_camera', 'Observe arm camera', 'Read ideal-pinhole normalized visual detections without object IDs, world poses, distances, or goal coordinates.', () => {
      const state = store.getSnapshot()
      const operation = state.operation!
      const camera = state.scene.cameras.find((candidate) => candidate.id === operation.cameraId)!
      const computed = computeSceneKinematics(state.scene)
      const cameraFrame = computed.cameras.find((candidate) => candidate.cameraId === operation.cameraId)!
      const visibility = computed.cameraVisibility.find((candidate) => candidate.cameraId === operation.cameraId)!
      const detections = visibility.objects.flatMap((report) => {
        if (report.visibility === 'none' || !report.normalizedBounds || !report.centerNormalized) return []
        const object = state.scene.objects.find((candidate) => candidate.id === report.objectId)!
        if (!object || object.movable !== true) return []
        const cylinderAxis = computeProjectedCylinderAxis(camera, cameraFrame.pose.matrix, object)
        return [{
          visualClass: visualClass(object.geometry.type),
          visibility: report.visibility,
          normalizedBounds: roundedTuple(report.normalizedBounds),
          centerNormalized: roundedTuple(report.centerNormalized),
          ...(cylinderAxis ? {
            longAxisAngleDeg: rounded(cylinderAxis.longAxisAngleDeg),
            longAxisLengthNormalized: rounded(cylinderAxis.longAxisLengthNormalized),
          } : {}),
        }]
      })
      return {
        ok: true,
        revision: state.revision,
        phase: 'operate',
        trialId: operation.trialId,
        camera: {
          model: camera.projection.model,
          resolutionPx: [camera.projection.widthPx, camera.projection.heightPx],
          fovDeg: [camera.projection.horizontalFovDeg, camera.projection.verticalFovDeg],
          featureConvention: 'normalized image coordinates; cylinder long-axis is 0deg horizontal and 90deg vertical',
        },
        detections,
        source: 'Analytic ideal-pinhole projection of simulated primitives; not rendered pixels, learned perception, or physical camera data.',
      }
    }),
    operateReadDefinition(store, 'get_arm_telemetry', 'Get arm telemetry', 'Read joint and gripper telemetry without end-effector, object, goal, or world coordinates.', () => {
      const state = store.getSnapshot()
      const operation = state.operation!
      return {
        ok: true,
        revision: state.revision,
        phase: 'operate',
        trialId: operation.trialId,
        joints: state.scene.robot.joints.map((joint) => ({
          id: joint.id,
          name: joint.name,
          type: joint.type,
          position: joint.position,
          unit: joint.type === 'prismatic' ? 'metres' : 'degrees',
          ...(joint.limits ? { limits: joint.limits } : {}),
        })),
        gripper: { state: operation.gripper, holding: Boolean(state.scene.grasp) },
      }
    }),
    mutation('set_arm_outputs', 'Set bounded arm outputs', 'Set joint targets and/or open or close the gripper. Closing auto-captures only inside the fixed jaw envelope; no object ID is accepted.'),
    mutation('end_arm_trial', 'End arm trial', 'Return to build mode without exposing hidden world-state details in the result.'),
  ]
}

export const WEBMCP_TOOL_NAMES = Object.freeze([
  'list_robotics_presets',
  'get_simulation_state',
  'load_robot_preset',
  'create_custom_robot',
  'edit_robot_chain',
  'set_joint_positions',
  'move_end_effector',
  'configure_camera',
  'edit_scene_objects',
  'control_grasp',
  'move_grasped_object',
  'set_simulation_goal',
  'run_joint_sequence',
  'save_simulation_snapshot',
  'begin_arm_trial',
  'observe_arm_camera',
  'get_arm_telemetry',
  'set_arm_outputs',
  'end_arm_trial',
] as const)
