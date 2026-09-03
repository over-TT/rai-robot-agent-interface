import { describe, expect, it } from 'vitest'
import {
  createSimulationStore,
  DEFAULT_STORAGE_KEY,
  MAX_RECORDED_RUN_EVENTS,
  MAX_RECORDED_RUNS,
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

describe('agent run recordings', () => {
  it('records exact event timing and only captures render frames at state-changing milestones', () => {
    const instants = [
      '2026-09-03T10:00:00.000Z',
      '2026-09-03T10:00:00.100Z',
      '2026-09-03T10:00:01.350Z',
      '2026-09-03T10:00:02.000Z',
      '2026-09-03T10:00:02.900Z',
      '2026-09-03T10:00:03.100Z',
      '2026-09-03T10:00:04.000Z',
      '2026-09-03T10:00:05.000Z',
      '2026-09-03T10:00:05.600Z',
    ]
    let instantIndex = 0
    const store = createSimulationStore({ storage: null, now: () => instants[instantIndex++] })

    store.dispatch({ type: 'begin_arm_trial', seed: 7 }, { source: 'webmcp' })
    store.logActivity({ source: 'webmcp', action: 'observe_arm_camera', status: 'ok', summary: 'Observed camera.' })
    store.logActivity({ source: 'webmcp', action: 'get_arm_telemetry', status: 'error', summary: 'Telemetry retry.' })
    store.dispatch({
      type: 'set_arm_outputs',
      jointTargets: [{ jointId: 'a101-base', value: 20 }],
      gripper: 'close',
    }, { source: 'webmcp' })
    store.logActivity({ source: 'webmcp', action: 'get_arm_telemetry', status: 'ok', summary: 'Read telemetry.' })
    store.dispatch({ type: 'end_arm_trial' }, { source: 'webmcp' })

    const recording = store.getSnapshot().recordings[0]
    expect(recording).toMatchObject({
      id: 'arm-trial-1',
      startedAt: '2026-09-03T10:00:00.100Z',
      finishedAt: '2026-09-03T10:00:05.600Z',
      durationMs: 5_500,
    })
    expect(recording.events.map((event) => [event.action, event.status, event.elapsedMs])).toEqual([
      ['begin_arm_trial', 'ok', 0],
      ['observe_arm_camera', 'ok', 1_250],
      ['get_arm_telemetry', 'error', 1_900],
      ['set_arm_outputs', 'ok', 3_000],
      ['get_arm_telemetry', 'ok', 3_900],
      ['end_arm_trial', 'ok', 5_500],
    ])
    expect(recording.events.map((event) => Boolean(event.frame))).toEqual([true, false, false, true, false, true])
    expect(recording.events[0].frame?.gripperClosed).toBe(false)
    expect(recording.events[0].frame?.scene.robot.joints[0].position).toBe(0)
    expect(recording.events[3].frame?.gripperClosed).toBe(true)
    expect(recording.events[3].frame?.scene.robot.joints[0].position).toBe(20)
    expect(recording.events[5].frame?.gripperClosed).toBe(true)
  })

  it('normalizes legacy stored and imported v1 states while rejecting malformed recordings', () => {
    const source = createSimulationStore({ storage: null })
    const legacy = JSON.parse(source.exportState())
    delete legacy.recordings

    const storage = memoryStorage()
    storage.setItem(DEFAULT_STORAGE_KEY, JSON.stringify(legacy))
    expect(createSimulationStore({ storage }).getSnapshot().recordings).toEqual([])

    const recipient = createSimulationStore({ storage: null })
    recipient.importState(JSON.stringify(legacy))
    expect(recipient.getSnapshot().recordings).toEqual([])

    source.dispatch({ type: 'begin_arm_trial', seed: 11 })
    source.logActivity({ source: 'webmcp', action: 'observe_arm_camera', status: 'ok', summary: 'Observed camera.' })
    source.dispatch({ type: 'end_arm_trial' })
    const recordedState = source.exportState()
    const recordedRecipient = createSimulationStore({ storage: null })
    expect(() => recordedRecipient.importState(recordedState)).not.toThrow()
    expect(recordedRecipient.getSnapshot().recordings).toHaveLength(1)

    const malformed = JSON.parse(recordedState)
    malformed.recordings[0].events[1].elapsedMs += 1

    const before = recipient.getSnapshot()
    expect(() => recipient.importState(JSON.stringify(malformed))).toThrow(/does not match schema version 1/)
    expect(recipient.getSnapshot()).toBe(before)
  })

  it.each(['missing', 'empty'])('resumes an active legacy trial with %s recordings from its current scene', (recordingsField) => {
    const startedAt = '2026-09-03T11:00:00.000Z'
    const source = createSimulationStore({ storage: null, now: () => startedAt })
    source.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
    source.dispatch({
      type: 'set_arm_outputs',
      jointTargets: [{ jointId: 'a101-base', value: 17 }],
      gripper: 'close',
    })
    const legacy = JSON.parse(source.exportState())
    if (recordingsField === 'missing') delete legacy.recordings
    else legacy.recordings = []
    const storage = memoryStorage()
    storage.setItem(DEFAULT_STORAGE_KEY, JSON.stringify(legacy))

    const resumed = createSimulationStore({ storage, now: () => '2026-09-03T11:00:05.000Z' })
    const recording = resumed.getSnapshot().recordings[0]
    expect(resumed.getSnapshot().phase).toBe('operate')
    expect(recording).toMatchObject({ id: 'arm-trial-1', startedAt })
    expect(recording.finishedAt).toBeUndefined()
    expect(recording.events).toHaveLength(1)
    expect(recording.events[0]).toMatchObject({
      source: 'system', action: 'begin_arm_trial', status: 'ok', elapsedMs: 0,
      summary: expect.stringContaining('earlier steps were not recorded'),
      frame: { gripperClosed: true },
    })
    expect(recording.events[0].frame?.scene.robot.joints[0].position).toBe(17)

    resumed.logActivity({ source: 'webmcp', action: 'observe_arm_camera', status: 'ok', summary: 'Observed camera.' })
    resumed.dispatch({ type: 'set_arm_outputs', jointTargets: [{ jointId: 'a101-base', value: 18 }] }, { source: 'webmcp' })
    const events = resumed.getSnapshot().recordings[0].events
    expect(events.map((event) => [event.action, event.elapsedMs])).toEqual([
      ['begin_arm_trial', 0], ['observe_arm_camera', 5_000], ['set_arm_outputs', 5_000],
    ])
    expect(events[1].frame).toBeUndefined()
    expect(events[2].frame?.scene.robot.joints[0].position).toBe(18)
    expect(createSimulationStore({ storage }).getSnapshot().recordings[0].events).toHaveLength(3)
  })

  it('bounds retained runs and events while preserving the start and latest run evidence', () => {
    let tick = Date.parse('2026-09-03T12:00:00.000Z')
    const store = createSimulationStore({
      storage: null,
      now: () => new Date(tick += 10).toISOString(),
    })

    for (let runIndex = 0; runIndex < MAX_RECORDED_RUNS + 1; runIndex += 1) {
      store.dispatch({ type: 'begin_arm_trial', seed: runIndex })
      if (runIndex === MAX_RECORDED_RUNS) {
        for (let eventIndex = 0; eventIndex < MAX_RECORDED_RUN_EVENTS + 8; eventIndex += 1) {
          store.logActivity({
            source: 'webmcp',
            action: eventIndex % 2 === 0 ? 'observe_arm_camera' : 'get_arm_telemetry',
            status: 'ok',
            summary: `Observation ${eventIndex}.`,
          })
        }
      }
      store.dispatch({ type: 'end_arm_trial' })
    }

    const recordings = store.getSnapshot().recordings
    expect(recordings).toHaveLength(MAX_RECORDED_RUNS)
    expect(recordings[0].id).toBe('arm-trial-3')
    const latest = recordings.at(-1)!
    expect(latest.events).toHaveLength(MAX_RECORDED_RUN_EVENTS)
    expect(latest.events[0]).toMatchObject({ action: 'begin_arm_trial', elapsedMs: 0 })
    expect(latest.events.at(-1)).toMatchObject({ action: 'end_arm_trial', status: 'ok' })
  })
})
