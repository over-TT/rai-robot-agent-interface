import { describe, expect, it, vi } from 'vitest'
import {
  computeSceneKinematics,
  createSimulationStore,
  DEFAULT_STORAGE_KEY,
  getCameraPreset,
  MAX_SIMULATION_IMPORT_BYTES,
  MAX_SIMULATION_REVISION,
  SimulationError,
  type StorageLike,
} from './index'

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

describe('simulation store', () => {
  it('shares one revisioned dispatcher with subscribers and idempotent request IDs', () => {
    const store = createSimulationStore({ storage: null, now: () => '2026-09-02T00:00:00.000Z' })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const result = store.dispatch({
      type: 'set_joint_positions', expectedRevision: 0, requestId: 'set-once',
      positions: [{ jointId: 'a101-base', value: 20 }],
    }, { source: 'ui' })
    expect(result.revision).toBe(1)
    expect(store.getSnapshot().scene.robot.joints[0].position).toBe(20)
    expect(store.getSnapshot().activity.at(-1)?.source).toBe('ui')

    const retry = store.dispatch({
      type: 'set_joint_positions', expectedRevision: 0, requestId: 'set-once',
      positions: [{ jointId: 'a101-base', value: 20 }],
    }, { source: 'webmcp' })
    expect(retry.deduplicated).toBe(true)
    expect(store.getSnapshot().revision).toBe(1)
    expect(() => store.dispatch({
      type: 'set_joint_positions', requestId: 'set-once',
      positions: [{ jointId: 'a101-base', value: 21 }],
    })).toThrowError(SimulationError)
    unsubscribe()
    expect(listener).toHaveBeenCalled()
  })

  it('bounds request ID deduplication to the 100 most recent successful commands in one store', () => {
    const store = createSimulationStore({ storage: null })
    const original = {
      type: 'save_simulation_snapshot' as const,
      name: 'Oldest cached request',
      requestId: 'cache-boundary-0',
    }
    store.dispatch(original)
    for (let index = 1; index <= 100; index += 1) {
      store.dispatch({
        type: 'save_simulation_snapshot',
        name: `Cache boundary ${index}`,
        requestId: `cache-boundary-${index}`,
      })
    }

    const revisionBeforeRetry = store.getSnapshot().revision
    const retry = store.dispatch(original)

    expect(retry.deduplicated).toBeUndefined()
    expect(store.getSnapshot().revision).toBe(revisionBeforeRetry + 1)
  })

  it('rejects stale revisions and joint-limit violations atomically', () => {
    const store = createSimulationStore({ storage: null })
    expect(() => store.dispatch({
      type: 'set_joint_positions', expectedRevision: 2,
      positions: [{ jointId: 'a101-base', value: 20 }],
    })).toThrow(/Expected revision 2/)
    expect(() => store.dispatch({
      type: 'set_joint_positions', positions: [
        { jointId: 'a101-base', value: 20 },
        { jointId: 'a101-shoulder', value: 100 },
      ],
    })).toThrow(/outside/)
    expect(store.getSnapshot().scene.robot.joints[0].position).toBe(0)
    expect(store.getSnapshot().revision).toBe(0)
  })

  it('reaches the practical revision ceiling once and then rejects further mutations atomically', () => {
    const store = createSimulationStore({ storage: null })
    const imported = JSON.parse(store.exportState())
    imported.revision = MAX_SIMULATION_REVISION - 1
    store.importState(JSON.stringify(imported))

    store.dispatch({
      type: 'set_joint_positions',
      expectedRevision: MAX_SIMULATION_REVISION - 1,
      positions: [{ jointId: 'a101-base', value: 1 }],
    })
    expect(store.getSnapshot().revision).toBe(MAX_SIMULATION_REVISION)
    expect(store.getSnapshot().scene.robot.joints[0].position).toBe(1)

    expect(() => store.dispatch({
      type: 'set_joint_positions',
      expectedRevision: MAX_SIMULATION_REVISION,
      positions: [{ jointId: 'a101-base', value: 2 }],
    })).toThrow(/revision ceiling/)
    expect(store.getSnapshot().revision).toBe(MAX_SIMULATION_REVISION)
    expect(store.getSnapshot().scene.robot.joints[0].position).toBe(1)
  })

  it('rejects joint axes that cannot be safely normalized without committing the robot', () => {
    const store = createSimulationStore({ storage: null })
    const originalRobotId = store.getSnapshot().scene.robot.id

    expect(() => store.dispatch({
      type: 'create_custom_robot',
      name: 'Overflow axis robot',
      segments: [{
        joint: {
          name: 'Overflow axis', type: 'revolute', axis: [1.1e308, 1.1e308, 1.1e308],
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0,
        },
        link: {
          name: 'Safe link', lengthM: 0.1, radiusM: 0.01,
          color: '#ffffff', direction: [1, 0, 0],
        },
      }],
    })).toThrow(/axis must have a finite, non-zero magnitude/)

    expect(store.getSnapshot().revision).toBe(0)
    expect(store.getSnapshot().scene.robot.id).toBe(originalRobotId)
  })

  it('rejects link directions that cannot be safely normalized without committing the robot', () => {
    const store = createSimulationStore({ storage: null })
    const originalRobotId = store.getSnapshot().scene.robot.id

    expect(() => store.dispatch({
      type: 'create_custom_robot',
      name: 'Overflow direction robot',
      segments: [{
        joint: {
          name: 'Safe axis', type: 'revolute', axis: [0, 0, 1],
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0,
        },
        link: {
          name: 'Overflow direction', lengthM: 0.1, radiusM: 0.01,
          color: '#ffffff', direction: [1.1e308, 1.1e308, 1.1e308],
        },
      }],
    })).toThrow(/direction must have a finite, non-zero magnitude/)

    expect(store.getSnapshot().revision).toBe(0)
    expect(store.getSnapshot().scene.robot.id).toBe(originalRobotId)
  })

  it('rejects custom robot transforms outside the 20 metre workspace without committing', () => {
    const store = createSimulationStore({ storage: null })
    const originalRobotId = store.getSnapshot().scene.robot.id

    expect(() => store.dispatch({
      type: 'create_custom_robot',
      name: 'Overflow transform robot',
      basePose: { positionM: [1.1e308, 0, 0], rotationDeg: [0, 0, 0] },
      segments: [{
        joint: {
          name: 'Safe axis', type: 'revolute', axis: [0, 0, 1],
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0,
        },
        link: {
          name: 'Safe link', lengthM: 0.1, radiusM: 0.01,
          color: '#ffffff', direction: [1, 0, 0],
        },
      }],
    })).toThrow(/basePose\.positionM\[0\].*between -20 and 20/)

    expect(store.getSnapshot().revision).toBe(0)
    expect(store.getSnapshot().scene.robot.id).toBe(originalRobotId)
  })

  it('rejects imported transforms outside the 20 metre workspace without replacing state', () => {
    const store = createSimulationStore({ storage: null })
    const originalState = store.getSnapshot()
    const imported = JSON.parse(store.exportState())
    imported.scene.cameras[0].pose.positionM = [0, -1.1e308, 0]

    expect(() => store.importState(JSON.stringify(imported))).toThrow(/does not match schema version 1/)
    expect(store.getSnapshot()).toBe(originalState)
    expect(store.getSnapshot().revision).toBe(0)
  })

  it('rejects imported robot source links outside HTTP and HTTPS', () => {
    const store = createSimulationStore({ storage: null })
    const originalState = store.getSnapshot()
    const imported = JSON.parse(store.exportState())
    imported.scene.robot.metadata.sourceUrl = 'javascript:alert(document.domain)'

    expect(() => store.importState(JSON.stringify(imported))).toThrow(/does not match schema version 1/)
    expect(store.getSnapshot()).toBe(originalState)
  })

  it('rejects oversized simulation JSON before parsing or replacing state', () => {
    const store = createSimulationStore({ storage: null })
    const originalState = store.getSnapshot()

    expect(() => store.importState(' '.repeat(MAX_SIMULATION_IMPORT_BYTES + 1))).toThrow(/exceeds the 5 MiB import limit/)
    expect(store.getSnapshot()).toBe(originalState)
  })

  it('supports undo, redo, named snapshots, and restore', () => {
    const store = createSimulationStore({ storage: null, now: () => '2026-09-02T00:00:00.000Z' })
    store.dispatch({ type: 'set_joint_positions', positions: [{ jointId: 'a101-base', value: 35 }] })
    store.dispatch({ type: 'undo' })
    expect(store.getSnapshot().scene.robot.joints[0].position).toBe(0)
    store.dispatch({ type: 'redo' })
    expect(store.getSnapshot().scene.robot.joints[0].position).toBe(35)
    const saved = store.dispatch({ type: 'save_simulation_snapshot', name: 'Inspection pose' })
    const snapshotId = saved.data?.snapshotId as string
    store.dispatch({ type: 'set_joint_positions', positions: [{ jointId: 'a101-base', value: 10 }] })
    store.dispatch({ type: 'restore_simulation_snapshot', snapshotId })
    expect(store.getSnapshot().scene.robot.joints[0].position).toBe(35)
  })

  it('persists and hydrates plain JSON state', () => {
    const storage = memoryStorage()
    const first = createSimulationStore({ storage })
    first.dispatch({ type: 'set_joint_positions', positions: [{ jointId: 'a101-base', value: 42 }] })
    expect(storage.values.has(DEFAULT_STORAGE_KEY)).toBe(true)
    const second = createSimulationStore({ storage })
    expect(second.getSnapshot().scene.robot.joints[0].position).toBe(42)
    expect(JSON.parse(second.exportState()).schemaVersion).toBe(1)
  })

  it('reports an import that succeeded in memory but could not be persisted', () => {
    const source = createSimulationStore({ storage: null })
    source.dispatch({ type: 'set_joint_positions', positions: [{ jointId: 'a101-base', value: 42 }] })
    const failingStorage: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') },
      removeItem: () => undefined,
    }
    const recipient = createSimulationStore({ storage: failingStorage })

    const result = recipient.importState(source.exportState())

    expect(result).toEqual({ persisted: false })
    expect(recipient.getSnapshot().scene.robot.joints[0].position).toBe(42)
  })

  it('ignores structurally corrupted persisted history instead of breaking startup', () => {
    const storage = memoryStorage()
    const invalid = createSimulationStore({ storage: null }).getSnapshot()
    const serialized = JSON.stringify({ ...invalid, history: { undo: [null], redo: [] } })
    storage.setItem(DEFAULT_STORAGE_KEY, serialized)
    const store = createSimulationStore({ storage })
    expect(store.getSnapshot().revision).toBe(0)
    expect(store.getSnapshot().history.undo).toEqual([])
  })

  it('edits a chain and runs a validated multi-waypoint kinematic sequence', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({ type: 'load_robot_preset', presetId: 'generic-2r' })
    store.dispatch({
      type: 'edit_robot_chain',
      operations: [{
        action: 'add',
        joint: {
          id: 'slide', name: 'Slide', type: 'prismatic', axis: [1, 0, 0],
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0,
          limits: { min: 0, max: 0.2 },
        },
        link: { id: 'tool', name: 'Tool', lengthM: 0.05, radiusM: 0.01, color: '#ffffff', direction: [1, 0, 0] },
      }],
    })
    const result = store.dispatch({
      type: 'run_joint_sequence',
      waypoints: [
        { positions: [{ jointId: '2r-j1', value: 0 }, { jointId: 'slide', value: 0.1 }], durationMs: 100 },
        { positions: [{ jointId: '2r-j1', value: 45 }, { jointId: 'slide', value: 0.2 }], durationMs: 200 },
      ],
    })
    expect(result.data).toMatchObject({ waypointCount: 2, totalDurationMs: 300 })
    expect(store.getSnapshot().scene.robot.joints.find((joint) => joint.id === 'slide')?.position).toBe(0.2)
  })

  it('can change a limited revolute joint to continuous by explicitly clearing limits', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({
      type: 'edit_robot_chain',
      operations: [{ action: 'update', jointId: 'a101-base', joint: { type: 'continuous', limits: null } }],
    })
    expect(store.getSnapshot().scene.robot.joints[0]).toMatchObject({ type: 'continuous', position: 0 })
    expect(store.getSnapshot().scene.robot.joints[0].limits).toBeUndefined()
  })

  it('clears stale robot provenance and recomputes reach after geometry edits', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({ type: 'load_robot_preset', presetId: 'cobot-6axis-850mm-simplified' })
    store.dispatch({
      type: 'edit_robot_chain',
      operations: [{ action: 'update', jointId: 'cobot-j2', link: { lengthM: 0.31 } }],
    })

    const metadata = store.getSnapshot().scene.robot.metadata
    expect(metadata).toMatchObject({
      accuracy: 'custom',
      nominalReachM: 0.86,
      note: expect.stringContaining('Custom serial-chain geometry'),
    })
    expect(metadata.presetId).toBeUndefined()
    expect(metadata.sourceUrl).toBeUndefined()
    expect(metadata.license).toBeUndefined()
  })

  it('clears camera preset provenance for projection edits and restores it for an explicit preset', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({
      type: 'configure_camera', action: 'update', cameraId: 'camera-arm-101-wide',
      projection: { horizontalFovDeg: 95 },
    })
    let camera = store.getSnapshot().scene.cameras[0]
    expect(camera.projection.horizontalFovDeg).toBe(95)
    expect(camera.presetId).toBeUndefined()
    expect(camera.note).toContain('preset provenance was cleared')

    store.dispatch({
      type: 'configure_camera', action: 'update', cameraId: camera.id,
      presetId: 'rpi-camera-module-3-standard',
    })
    camera = store.getSnapshot().scene.cameras[0]
    const preset = getCameraPreset('rpi-camera-module-3-standard')!
    expect(camera.presetId).toBe(preset.id)
    expect(camera.projection).toEqual(preset.projection)
    expect(camera.note).toBe(preset.note)
  })

  it('freezes ordinary scene commands during an arm trial and unlocks them afterward', () => {
    const store = createSimulationStore({ storage: null })
    const started = store.dispatch({ type: 'begin_arm_trial', seed: 7, requestId: 'trial-start' })
    expect(started).toMatchObject({ revision: 1, requestId: 'trial-start' })
    expect(store.getSnapshot()).toMatchObject({ phase: 'operate', operation: { gripper: 'open' } })

    const before = structuredClone(store.getSnapshot())
    expect(() => store.dispatch({
      type: 'edit_scene_objects',
      operations: [{ action: 'remove', objectId: 'arm-101-can' }],
    })).toThrow(/unavailable during an arm trial/i)
    expect(store.getSnapshot().scene).toEqual(before.scene)
    expect(store.getSnapshot().revision).toBe(before.revision)

    store.dispatch({ type: 'end_arm_trial', expectedRevision: 1 })
    expect(store.getSnapshot()).toMatchObject({ phase: 'build', operation: null, revision: 2 })
  })

  it('keeps deterministic can placement above the bench surface', () => {
    const first = createSimulationStore({ storage: null })
    const second = createSimulationStore({ storage: null })
    first.dispatch({ type: 'begin_arm_trial', seed: 2026 })
    second.dispatch({ type: 'begin_arm_trial', seed: 2026 })
    const firstCan = first.getSnapshot().scene.objects.find((object) => object.id === 'arm-101-can')!
    const secondCan = second.getSnapshot().scene.objects.find((object) => object.id === 'arm-101-can')!
    expect(firstCan.pose).toEqual(secondCan.pose)
    expect(firstCan.pose.positionM[2]).toBe(0.06)
    expect(firstCan.pose.rotationDeg).toEqual([0, 0, 0])
  })

  it('keeps seeded trial placements inside the arm envelope and wrist-camera view', () => {
    for (const seed of [0, 1, 7, 42, 2026, 0x7fff_ffff]) {
      const store = createSimulationStore({ storage: null })
      store.dispatch({ type: 'begin_arm_trial', seed })
      const state = store.getSnapshot()
      const can = state.scene.objects.find((object) => object.id === 'arm-101-can')!
      const cameraId = state.operation!.cameraId
      const computed = computeSceneKinematics(state.scene)
      const visibility = computed.cameraVisibility
        .find((camera) => camera.cameraId === cameraId)!
        .objects.find((object) => object.objectId === can.id)!
      const [baseX, baseY, baseZ] = state.scene.robot.basePose.positionM
      const [canX, canY, canZ] = can.pose.positionM
      const baseToCanM = Math.hypot(canX - baseX, canY - baseY, canZ - baseZ)

      expect(baseToCanM, `seed ${seed} arm envelope`).toBeLessThan(state.scene.robot.metadata.nominalReachM!)
      expect(visibility.visibility, `seed ${seed} camera visibility`).not.toBe('none')
    }
  })
})
