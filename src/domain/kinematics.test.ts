import { describe, expect, it } from 'vitest'
import {
  computeCameraVisibility,
  computeForwardKinematics,
  getCameraPreset,
  getRobotPreset,
  identityMatrix,
  ROBOT_BASE_HEIGHT_M,
  type CameraSensor,
  type RobotModel,
  type SceneObject,
} from './index'

describe('serial forward kinematics', () => {
  it('solves a known two-link planar arm in metres and degrees', () => {
    const robot = getRobotPreset('generic-2r')!.robot
    robot.joints[0].position = 0
    robot.joints[1].position = 0
    expect(computeForwardKinematics(robot).endEffector.positionM).toEqual([0.45, 0, ROBOT_BASE_HEIGHT_M])

    robot.joints[0].position = 90
    const ninety = computeForwardKinematics(robot).endEffector.positionM
    expect(ninety[0]).toBeCloseTo(0, 10)
    expect(ninety[1]).toBeCloseTo(0.45, 10)
    expect(ninety[2]).toBeCloseTo(ROBOT_BASE_HEIGHT_M, 10)

    robot.joints[0].position = 0
    robot.joints[1].position = 90
    const elbow = computeForwardKinematics(robot).endEffector.positionM
    expect(elbow[0]).toBeCloseTo(0.25, 10)
    expect(elbow[1]).toBeCloseTo(0.2, 10)
    expect(elbow[2]).toBeCloseTo(ROBOT_BASE_HEIGHT_M, 10)
  })

  it('applies fixed origins and prismatic positions along normalized axes', () => {
    const robot: RobotModel = {
      id: 'linear-test', name: 'Linear test',
      basePose: { positionM: [1, 2, 3], rotationDeg: [0, 0, 0] },
      joints: [
        {
          id: 'fixed', name: 'Fixed', type: 'fixed', axis: [0, 0, 1], position: 0,
          origin: { positionM: [0, 0, 0.5], rotationDeg: [0, 0, 0] },
        },
        {
          id: 'slide', name: 'Slide', type: 'prismatic', axis: [2, 0, 0], position: 0.2,
          limits: { min: 0, max: 0.4 }, origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] },
        },
      ],
      links: [
        { id: 'fixed-link', name: 'Fixed link', lengthM: 0.1, radiusM: 0.01, color: '#ffffff', direction: [0, 0, 1] },
        { id: 'slide-link', name: 'Slide link', lengthM: 0.3, radiusM: 0.01, color: '#ffffff', direction: [1, 0, 0] },
      ],
      metadata: { accuracy: 'synthetic-reference', note: 'test' },
    }
    expect(computeForwardKinematics(robot).endEffector.positionM).toEqual([1.5, 2, 3.6])
  })
})

describe('ideal pinhole visibility', () => {
  const projection = getCameraPreset('generic-pinhole')!.projection
  const camera: CameraSensor = {
    id: 'camera', name: 'Camera', parent: { type: 'world' },
    pose: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] },
    projection, note: 'test',
  }
  const sphere = (id: string, positionM: [number, number, number]): SceneObject => ({
    id, name: id, color: '#ffffff', pose: { positionM, rotationDeg: [0, 0, 0] },
    geometry: { type: 'sphere', radiusM: 0.05 },
  })

  it('centres an object on camera-local +X', () => {
    const result = computeCameraVisibility(camera, identityMatrix(), sphere('front', [1, 0, 0]))
    expect(result.visibility).toBe('full')
    expect(result.centerNormalized?.[0]).toBeCloseTo(0.5)
    expect(result.centerNormalized?.[1]).toBeCloseTo(0.5)
  })

  it('reports behind-camera and outside-frustum objects', () => {
    expect(computeCameraVisibility(camera, identityMatrix(), sphere('back', [-1, 0, 0])).reason).toBe('behind-camera')
    const outside = computeCameraVisibility(camera, identityMatrix(), sphere('side', [1, 3, 0]))
    expect(outside.visibility).toBe('none')
    expect(outside.reason).toBe('outside-frustum')
  })
})
