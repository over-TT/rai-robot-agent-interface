import { SimulationError } from '../domain'

export interface CameraCaptureRequest {
  revision: number
  trialId: string
  cameraId: string
  signal: AbortSignal
}
export interface CameraImage {
  revision: number
  trialId: string
  width: number
  height: number
  data: string
}
export type CameraCapture = (request: CameraCaptureRequest) => Promise<CameraImage>

let provider: CameraCapture | undefined
export function registerCameraCapture(capture: CameraCapture): () => void {
  provider = capture
  return () => { if (provider === capture) provider = undefined }
}
export const captureLiveCamera: CameraCapture = async (request) => {
  request.signal.throwIfAborted()
  if (!provider) throw new SimulationError('CAMERA_UNAVAILABLE', 'Camera renderer is not ready. Retry the observation; no synthetic detections were substituted.')
  return provider(request)
}
