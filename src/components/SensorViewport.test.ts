import { describe, expect, it } from 'vitest'
import { sensorPerspectiveFromFov } from '../lib/sensorProjection'

describe('sensor viewport projection', () => {
  it('derives Three.js aspect from both horizontal and vertical FOV', () => {
    const projection = sensorPerspectiveFromFov(90, 60)
    expect(projection.verticalFovDeg).toBe(60)
    expect(projection.aspect).toBeCloseTo(Math.tan(Math.PI / 4) / Math.tan(Math.PI / 6), 8)
  })

  it('bounds malformed or extreme projection inputs to finite camera values', () => {
    expect(sensorPerspectiveFromFov(Number.POSITIVE_INFINITY, Number.NaN)).toEqual({
      verticalFovDeg: 45,
      aspect: expect.any(Number),
    })
    const extreme = sensorPerspectiveFromFov(179, 1)
    expect(Number.isFinite(extreme.aspect)).toBe(true)
    expect(extreme.aspect).toBeLessThanOrEqual(100)
    expect(extreme.aspect).toBeGreaterThanOrEqual(0.01)
  })
})
