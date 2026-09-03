import { describe, expect, it } from 'vitest'
import {
  cloneSerializable,
  computeForwardKinematics,
  getRobotPreset,
  ROBOT_PRESETS,
  ROBOT_BASE_HEIGHT_M,
  solvePositionIk,
} from './index'

const SAMPLE_BASES = [2, 3, 5, 7, 11, 13, 17, 19] as const

function radicalInverse(index: number, base: number): number {
  let fraction = 1 / base
  let result = 0
  while (index > 0) {
    result += (index % base) * fraction
    index = Math.floor(index / base)
    fraction /= base
  }
  return result
}

describe('bounded position IK', () => {
  it('reaches a valid alternate branch of the generic 2R workspace', () => {
    const robot = getRobotPreset('generic-2r')!.robot
    const targetPositionM: [number, number, number] = [
      -0.2028460801597932,
      -0.1487278677530472,
      ROBOT_BASE_HEIGHT_M,
    ]

    const result = solvePositionIk(robot, targetPositionM, 0.001)
    const repeated = solvePositionIk(robot, targetPositionM, 0.001)

    expect(result.converged).toBe(true)
    expect(result.residualM).toBeLessThanOrEqual(0.001)
    expect(repeated).toEqual(result)
  })

  it('returns a deterministic bounded failure without mutating the source robot', () => {
    const robot = getRobotPreset('generic-2r')!.robot
    const original = cloneSerializable(robot)

    const result = solvePositionIk(robot, [2, 0, 0], 0.001)
    const repeated = solvePositionIk(robot, [2, 0, 0], 0.001)

    expect(result.converged).toBe(false)
    expect(repeated).toEqual(result)
    expect(result.attempts).toBeLessThanOrEqual(16)
    expect(result.iterations).toBeLessThanOrEqual(16 * 96)
    expect(result.evaluations).toBeLessThanOrEqual(1 + 16 * (1 + 96 * (2 * 2 + 4)))
    expect(robot).toEqual(original)
  })

  it('reaches a deterministic corpus of positions sampled from every bundled robot', () => {
    const failures: Array<{ presetId: string; sample: number; residualM: number }> = []
    const successes: Record<string, number> = {}

    for (const preset of ROBOT_PRESETS) {
      successes[preset.id] = 0
      for (let sample = 1; sample <= 20; sample += 1) {
        const targetRobot = cloneSerializable(preset.robot)
        targetRobot.joints.forEach((joint, index) => {
          if (joint.type === 'fixed') return
          const fallback = joint.type === 'prismatic' ? preset.robot.metadata.nominalReachM ?? 0.5 : 180
          const minimum = joint.limits?.min ?? joint.position - fallback
          const maximum = joint.limits?.max ?? joint.position + fallback
          joint.position = minimum + (maximum - minimum) * radicalInverse(sample, SAMPLE_BASES[index])
        })
        const targetPositionM = computeForwardKinematics(targetRobot).endEffector.positionM
        const result = solvePositionIk(preset.robot, targetPositionM, 0.001)
        if (result.converged) successes[preset.id] += 1
        else failures.push({ presetId: preset.id, sample, residualM: result.residualM })
      }
    }

    expect({ successes, failures }).toEqual({
      successes: Object.fromEntries(ROBOT_PRESETS.map((preset) => [preset.id, 20])),
      failures: [],
    })
  })
})
