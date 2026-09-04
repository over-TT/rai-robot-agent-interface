import { expect, it } from 'vitest'
import { sensorCaptureSize, sensorPerspectiveFromFov } from './sensorProjection'

it('bounds capture dimensions for extreme supported fields of view', () => {
  for (const [horizontal, vertical] of [[1, 179], [179, 1], [102, 67], [60, 60]]) {
    const { aspect } = sensorPerspectiveFromFov(horizontal, vertical)
    const { width, height } = sensorCaptureSize(aspect)
    expect(width).toBeGreaterThanOrEqual(1)
    expect(height).toBeGreaterThanOrEqual(1)
    expect(Math.max(width, height)).toBe(640)
    expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true)
  }
})
