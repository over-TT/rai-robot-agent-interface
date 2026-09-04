const MIN_PERSPECTIVE_FOV_DEG = 1
const MAX_PERSPECTIVE_FOV_DEG = 179
const MIN_PERSPECTIVE_ASPECT = 0.01
const MAX_PERSPECTIVE_ASPECT = 100

// Published sensor coordinates use local +Y as image-right; Three lookAt uses -Y.
export const SENSOR_HORIZONTAL_SCALE = -1

export function sensorCaptureSize(aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  return {
    width: Math.max(1, Math.round(Math.min(640, 640 * safeAspect))),
    height: Math.max(1, Math.round(Math.min(640, 640 / safeAspect))),
  }
}

/** Contain the complete sensor image without stretching or cropping it. */
export function fitSensorFrame(width: number, height: number, aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const fittedWidth = Math.max(0, Math.min(width, height * safeAspect))
  return { width: fittedWidth, height: fittedWidth / safeAspect }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function safeFov(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return clamp(value, MIN_PERSPECTIVE_FOV_DEG, MAX_PERSPECTIVE_FOV_DEG)
}

/** Three.js takes vertical FOV + aspect, so derive aspect from both declared FOVs. */
export function sensorPerspectiveFromFov(horizontalFovDeg: number, verticalFovDeg: number) {
  const horizontal = safeFov(horizontalFovDeg, 60)
  const vertical = safeFov(verticalFovDeg, 45)
  const degreesToRadians = Math.PI / 180
  const horizontalTangent = Math.tan((horizontal / 2) * degreesToRadians)
  const verticalTangent = Math.tan((vertical / 2) * degreesToRadians)
  const derivedAspect = horizontalTangent / verticalTangent
  return {
    verticalFovDeg: vertical,
    aspect: clamp(
      Number.isFinite(derivedAspect) && derivedAspect > 0 ? derivedAspect : 1,
      MIN_PERSPECTIVE_ASPECT,
      MAX_PERSPECTIVE_ASPECT,
    ),
  }
}
