import type { RecordedRun, RecordedRunEvent, RecordedRunFrame, SimulationScene } from '../domain'
import { createDefaultSimulationState } from '../domain'
import { describe, expect, it } from 'vitest'
import { formatRunDuration, timelineEntryAt, timelineFrameAt } from './runTimeline'

function event(id: string, action: string, elapsedMs: number, frame?: RecordedRunFrame): RecordedRunEvent {
  return {
    id,
    action,
    elapsedMs,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, elapsedMs)).toISOString(),
    revision: elapsedMs,
    source: 'webmcp',
    status: 'ok',
    summary: action,
    ...(frame ? { frame } : {}),
  }
}

function frame(scene: SimulationScene, gripperClosed = false): RecordedRunFrame {
  return { scene, gripperClosed }
}

describe('run timeline', () => {
  it('selects the event and last render frame at a captured time', () => {
    const sceneA = createDefaultSimulationState().scene
    const sceneB = structuredClone(sceneA)
    sceneB.robot.name = 'Moved robot'
    const run: RecordedRun = {
      id: 'run-1',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:02.500Z',
      durationMs: 2_500,
      events: [
        event('start', 'begin_arm_trial', 0, frame(sceneA)),
        event('observe', 'observe_arm_camera', 350),
        event('act', 'set_arm_outputs', 1_200, frame(sceneB, true)),
        event('end', 'end_arm_trial', 2_500, frame(sceneB, true)),
      ],
    }

    expect(timelineEntryAt(run, 1_000).id).toBe('observe')
    expect(timelineEntryAt(run, 1_200).id).toBe('act')
    expect(timelineFrameAt(run, 1_000).scene.robot.name).toBe(sceneA.robot.name)
    expect(timelineFrameAt(run, 1_200)).toMatchObject({ gripperClosed: true, scene: { robot: { name: 'Moved robot' } } })
    // Completed review holds the recorded final state even if the live scene changes.
    sceneA.robot.name = 'Live build changed afterwards'
    expect(timelineFrameAt(run, 2_500).scene.robot.name).toBe('Moved robot')
    expect(timelineFrameAt(run, 9_000).scene.robot.name).toBe('Moved robot')
  })

  it('formats short and minute-scale run durations', () => {
    expect(formatRunDuration(12_349)).toBe('12.3s')
    expect(formatRunDuration(72_980)).toBe('1:12.9')
    expect(formatRunDuration(Number.NaN)).toBe('0.0s')
  })
})
