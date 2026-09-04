import { describe, expect, it, vi } from 'vitest'
import { createSimulationStore } from '../domain'
import { createWebMcpToolDefinitions } from './tools'
import type { CameraCapture, CameraCaptureRequest } from './cameraCapture'

const image = (request: CameraCaptureRequest) => ({ revision: request.revision, trialId: request.trialId, width: 640, height: 344, data: '/9j/AA==' })
function setup(capture?: CameraCapture) {
  const store = createSimulationStore({ storage: null })
  store.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
  const observe = createWebMcpToolDefinitions(store, capture).find((tool) => tool.name === 'observe_arm_camera')!
  return { store, observe }
}
describe('camera image boundary', () => {
  it('fails closed without a renderer instead of falling back to analytic detections', async () => {
    const { observe } = setup()
    const result = await observe.execute({})
    expect(result).toMatchObject({ ok: false, error: { code: 'CAMERA_UNAVAILABLE' } })
    expect(result).not.toHaveProperty('detections')
    expect(result).not.toHaveProperty('content')
  })
  it('binds the encoded image and dimensions to the live trial revision', async () => {
    const capture = vi.fn(async (request: CameraCaptureRequest) => image(request))
    const { store, observe } = setup(capture)
    expect(await observe.execute({})).toMatchObject({ ok: true, revision: 1, camera: { resolutionPx: [640, 344] }, content: [{ type: 'image', mimeType: 'image/jpeg' }] })
    expect(capture.mock.calls[0][0].cameraId).toBe(store.getSnapshot().operation?.cameraId)
    expect(store.getSnapshot().recordings[0].cameraId).toBe(store.getSnapshot().operation?.cameraId)
  })
  it.each(['move', 'end', 'wrong-frame'])('discards stale captures after %s', async (change) => {
    const { store, observe } = setup(async (request) => {
      if (change === 'move') store.dispatch({ type: 'set_arm_outputs', gripper: 'open' })
      if (change === 'end') store.dispatch({ type: 'end_arm_trial' })
      return { ...image(request), ...(change === 'wrong-frame' ? { trialId: 'old-trial' } : {}) }
    })
    const result = await observe.execute({})
    expect(result).toMatchObject({ ok: false, error: { code: 'CAMERA_UNAVAILABLE' } })
    expect(result).not.toHaveProperty('content')
  })
  it('honours cancellation during capture without logging a successful image', async () => {
    const controller = new AbortController()
    const { store, observe } = setup(async (request) => { controller.abort(); return image(request) })
    await expect(observe.execute({}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.getSnapshot().activity.at(-1)).toMatchObject({ status: 'cancelled' })
  })
  it('rejects oversized frames', async () => {
    const { observe } = setup(async (request) => ({ ...image(request), width: 4000 }))
    expect(await observe.execute({})).toMatchObject({ ok: false, error: { code: 'CAMERA_UNAVAILABLE' } })
  })
})
