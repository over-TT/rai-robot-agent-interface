import type { RecordedRun, RecordedRunEvent, RecordedRunFrame } from '../domain'

export function recordingCameraId(run: RecordedRun): string | undefined {
  if (run.cameraId) return run.cameraId
  const cameras = run.events[0].frame?.scene.cameras ?? []
  // Older recordings predate cameraId; reproduce the trial's selection rule
  // using its recorded scene, never a camera from the current live build.
  return (cameras.find((camera) => camera.presetId === 'rpi-camera-module-3-wide') ?? cameras[0])?.id
}

export function timelineEntryAt(run: RecordedRun, elapsedMs: number): RecordedRunEvent {
  let selected = run.events[0]
  for (const candidate of run.events) {
    if (candidate.elapsedMs > elapsedMs) break
    selected = candidate
  }
  return selected
}

export function timelineFrameAt(run: RecordedRun, elapsedMs: number): RecordedRunFrame {
  let selected = run.events[0].frame
  for (const candidate of run.events) {
    if (candidate.elapsedMs > elapsedMs) break
    if (candidate.frame) selected = candidate.frame
  }
  if (!selected) throw new Error('A recorded run must start with a render frame.')
  return selected
}

export function formatRunDuration(durationMs: number): string {
  const safeMs = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0)
  const totalTenths = Math.floor(safeMs / 100)
  const tenths = totalTenths % 10
  const totalSeconds = Math.floor(totalTenths / 10)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes === 0) return `${seconds}.${tenths}s`
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
}
