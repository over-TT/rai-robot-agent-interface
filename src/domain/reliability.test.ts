import { describe, expect, it } from 'vitest'
import { createSimulationStore, createDefaultSimulationState, DEFAULT_STORAGE_KEY, type StorageLike } from './index'
import { timelineFrameAt } from '../lib/runTimeline'

function storage(): StorageLike {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } }
}

describe('recording reliability regressions', () => {
  it('keeps the last pose before a truncated observation window', () => {
    let tick = 0
    const store = createSimulationStore({ storage: null, now: () => new Date(1_700_000_000_000 + tick++ * 10).toISOString() })
    store.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
    store.dispatch({ type: 'set_arm_outputs', jointTargets: [{ jointId: 'a101-base', value: 25 }] })
    for (let n = 0; n < 130; n++) store.logActivity({ source: 'webmcp', action: 'observe_arm_camera', status: 'ok', summary: 'Observed.' })
    store.dispatch({ type: 'end_arm_trial' })
    const run = store.getSnapshot().recordings[0]
    expect(run.events.length).toBeLessThanOrEqual(120)
    const observation = run.events.find((event) => event.action === 'observe_arm_camera')!
    expect(timelineFrameAt(run, observation.elapsedMs).scene.robot.joints[0].position).toBe(25)
    expect(() => createSimulationStore({ storage: null }).importState(store.exportState())).not.toThrow()
  })

  it('round-trips six full default-arm recordings within the import budget', () => {
    const store = createSimulationStore({ storage: null })
    for (let run = 0; run < 6; run++) {
      store.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
      for (let n = 0; n < 118; n++) store.dispatch({ type: 'set_arm_outputs', jointTargets: [{ jointId: 'a101-base', value: n % 90 }] })
      store.dispatch({ type: 'end_arm_trial' })
    }
    expect(() => createSimulationStore({ storage: null }).importState(store.exportState())).not.toThrow()
  })

  it('does not let a stale tab overwrite another tab’s recording', () => {
    const shared = storage()
    const first = createSimulationStore({ storage: shared })
    const stale = createSimulationStore({ storage: shared })
    first.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
    first.dispatch({ type: 'end_arm_trial' })
    const saved = shared.getItem(DEFAULT_STORAGE_KEY)
    stale.logActivity({ source: 'system', action: 'webmcp_register', status: 'ok', summary: 'Registered.' })
    expect(shared.getItem(DEFAULT_STORAGE_KEY)).toBe(saved)
    expect(stale.getPersistenceStatus()).toBe('conflict')
    stale.clearPersistence()
    expect(shared.getItem(DEFAULT_STORAGE_KEY)).toBe(saved)
    expect(first.getPersistenceStatus()).toBe('saved')
  })

  it('round-trips a custom 32-object scene with six full recordings', () => {
    const state = createDefaultSimulationState()
    for (let n = 0; n < 30; n++) state.scene.objects.push({
      id: `custom-${n}`, name: `Custom object ${n}`, color: '#aaaaaa', movable: false,
      pose: { positionM: [n / 10, 1, 0.1], rotationDeg: [0, 0, 0] },
      geometry: { type: 'sphere', radiusM: 0.02 },
    })
    const store = createSimulationStore({ initialState: state, storage: null })
    for (let run = 0; run < 6; run++) {
      store.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
      for (let n = 0; n < 118; n++) store.dispatch({ type: 'set_arm_outputs', jointTargets: [{ jointId: 'a101-base', value: n % 90 }] })
      store.dispatch({ type: 'end_arm_trial' })
    }
    const exported = store.exportState()
    expect(new TextEncoder().encode(exported).byteLength).toBeGreaterThan(5 * 1024 * 1024)
    const restored = createSimulationStore({ storage: null })
    restored.importState(exported)
    expect(restored.getSnapshot().recordings).toEqual(store.getSnapshot().recordings)
    expect(restored.getSnapshot().scene.objects).toHaveLength(32)
  })

  it('keeps an exportable recording when browser storage fills up', () => {
    const fullStorage: StorageLike = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded') }, removeItem: () => {} }
    const store = createSimulationStore({ storage: fullStorage })
    store.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
    store.dispatch({ type: 'end_arm_trial' })
    expect(store.getPersistenceStatus()).toBe('error')
    const restored = createSimulationStore({ storage: null })
    restored.importState(store.exportState())
    expect(restored.getSnapshot().recordings).toHaveLength(1)
    expect(restored.getSnapshot().recordings[0].cameraId).toBe(store.getSnapshot().scene.cameras[0].id)
    expect(restored.getPersistenceStatus()).toBe('unavailable')
  })
})
