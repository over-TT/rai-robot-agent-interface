import { describe, expect, it } from 'vitest'
import { fitSensorFrame, SENSOR_HORIZONTAL_SCALE, sensorPerspectiveFromFov } from '../lib/sensorProjection'
import * as THREE from 'three'
import { computeCameraVisibility, createDefaultSimulationState, identityMatrix, transformMatrix, transformPoint, worldPose } from '../domain'

describe('sensor viewport projection', () => {
  it('letterboxes wide and portrait containers without distorting the sensor', () => {
    for (const [width, height] of [[840, 150], [200, 600], [0, 0]]) {
      const fitted = fitSensorFrame(width, height, 1.866)
      expect(fitted.width).toBeLessThanOrEqual(width)
      expect(fitted.height).toBeLessThanOrEqual(height)
      if (width) expect(fitted.width / fitted.height).toBeCloseTo(1.866)
    }
  })

  it('renders local +Y to the same image side as the published observation', () => {
    const scene = createDefaultSimulationState().scene
    const sensor = { ...scene.cameras[0], projection: { ...scene.cameras[0].projection, horizontalFovDeg: 90, verticalFovDeg: 60, nearM: 0.001, farM: 10 } }
    const object = { ...scene.objects[0], pose: { positionM: [1, 0.2, 0.1] as [number, number, number], rotationDeg: [0, 0, 0] as [number, number, number] } }
    const observed = computeCameraVisibility(sensor, identityMatrix(), object).centerNormalized!
    const perspective = sensorPerspectiveFromFov(90, 60)
    const camera = new THREE.PerspectiveCamera(60, perspective.aspect, 0.001, 10)
    camera.up.set(0, 1, 0)
    camera.lookAt(1, 0, 0)
    camera.updateMatrixWorld()
    const ndc = new THREE.Vector3(1, 0.1, -0.2).project(camera)
    expect((ndc.x * SENSOR_HORIZONTAL_SCALE + 1) / 2).toBeCloseTo(observed[0], 8)
    expect((1 - ndc.y) / 2).toBeCloseTo(observed[1], 8)
  })

  it('uses the domain compound-rotation quaternion for rendered objects', () => {
    const matrix = transformMatrix({ positionM: [0, 0, 0], rotationDeg: [30, 45, 60] })
    const rendered = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(...worldPose(matrix).quaternionXyzw))
    const expected = transformPoint(matrix, [0, 0, 1])
    rendered.toArray().forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 8))
  })
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
