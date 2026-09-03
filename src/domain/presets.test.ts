import { describe, expect, it } from 'vitest'
import { CAMERA_PRESETS, ROBOT_BASE_HEIGHT_M, ROBOT_PRESETS, getRobotPreset } from './index'

describe('robot and camera presets', () => {
  it('keeps the verified Arm Alliance geometry and auxiliary camera joint', () => {
    const preset = getRobotPreset('arm-alliance')!
    expect(preset.robot.links.map((link) => link.lengthM)).toEqual([0.06, 0.18, 0.22, 0])
    expect(preset.robot.joints.map((joint) => joint.name)).toEqual(['Base', 'Shoulder', 'Elbow', 'Camera (auxiliary)'])
    expect(preset.robot.metadata.accuracy).toBe('exact-project-geometry')
    expect(preset.bundledCameras?.[0].presetId).toBe('rpi-camera-module-3-wide')
  })

  it('publishes the required bounded preset catalog without third-party meshes', () => {
    expect(ROBOT_PRESETS.map((preset) => preset.id)).toEqual([
      'arm-101', 'arm-alliance', 'generic-2r', 'openmanipulator-x-simplified', 'cobot-6axis-850mm-simplified',
    ])
    expect(ROBOT_PRESETS.every((preset) => preset.robot.joints.length <= 8)).toBe(true)
    expect(getRobotPreset('openmanipulator-x-simplified')?.robot.metadata.nominalReachM).toBe(0.38)
    expect(getRobotPreset('cobot-6axis-850mm-simplified')?.robot.metadata.nominalReachM).toBe(0.85)
  })

  it('includes a complete Arm 101 camera, gripper-ready tool, bench, can, and tipped goal workspace', () => {
    const preset = getRobotPreset('arm-101')!
    const bench = preset.bundledObjects?.find((object) => object.id === 'arm-101-bench')!
    const can = preset.bundledObjects?.find((object) => object.id === 'arm-101-can')!
    expect(preset.robot.joints.map((joint) => joint.name)).toEqual([
      'Base yaw', 'Shoulder', 'Elbow', 'Wrist / gripper mount',
    ])
    expect(preset.robot.links.at(-1)?.name).toContain('gripper')
    expect(preset.bundledCameras?.[0]).toMatchObject({ presetId: 'rpi-camera-module-3-wide' })
    expect(can.geometry).toMatchObject({ type: 'cylinder', heightM: 0.12 })
    expect(bench.geometry).toMatchObject({ type: 'box', sizeM: [0.9, 0.7, 0.025] })
    expect(can.pose.positionM[2]).toBe(0.06)
    expect(preset.bundledGoal).toMatchObject({ type: 'object-tipped', objectId: 'arm-101-can', minimumTiltDeg: 60 })
  })

  it('keeps every preset starting pose inside its declared joint limits', () => {
    for (const preset of ROBOT_PRESETS) {
      expect(preset.robot.basePose.positionM[2], `${preset.id} mounted base`).toBe(ROBOT_BASE_HEIGHT_M)
      for (const joint of preset.robot.joints) {
        if (!joint.limits) continue
        expect(joint.position, `${preset.id}/${joint.id} lower limit`).toBeGreaterThanOrEqual(joint.limits.min)
        expect(joint.position, `${preset.id}/${joint.id} upper limit`).toBeLessThanOrEqual(joint.limits.max)
      }
    }
  })

  it('matches the requested camera native arrays and nominal FOVs', () => {
    const byId = Object.fromEntries(CAMERA_PRESETS.map((preset) => [preset.id, preset.projection]))
    expect(byId['rpi-camera-module-3-standard']).toMatchObject({ widthPx: 4608, heightPx: 2592, horizontalFovDeg: 66, verticalFovDeg: 41 })
    expect(byId['rpi-camera-module-3-wide']).toMatchObject({ widthPx: 4608, heightPx: 2592, horizontalFovDeg: 102, verticalFovDeg: 67 })
    expect(byId['oak-d-lite-color']).toMatchObject({ horizontalFovDeg: 69, verticalFovDeg: 54 })
  })
})
