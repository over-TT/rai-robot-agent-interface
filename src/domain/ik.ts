import { computeForwardKinematics } from './kinematics'
import { cloneSerializable, transformPoint } from './math'
import type { RobotJoint, RobotModel, Vec3 } from './types'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const ANGULAR_STEP_RAD = 0.5 * DEG_TO_RAD
const PRISMATIC_STEP_M = 0.001
const MAX_ANGULAR_STEP_RAD = 15 * DEG_TO_RAD
const MAX_PRISMATIC_STEP_M = 0.025
const MAX_ITERATIONS_PER_SEED = 96
const MAX_STALLED_ITERATIONS = 12
const MAX_SEED_ATTEMPTS = 16
const DAMPING = 0.02
const LINE_SEARCH = [1, 0.5, 0.25, 0.125] as const
const HALTON_BASES = [2, 3, 5, 7, 11, 13, 17, 19] as const

interface ActiveCoordinate {
  index: number
  angular: boolean
  min: number
  max: number
  current: number
}

export interface PositionIkResult {
  converged: boolean
  targetPositionM: Vec3
  achievedPositionM: Vec3
  residualM: number
  jointPositions: Array<{ jointId: string; value: number }>
  iterations: number
  attempts: number
  evaluations: number
  solver: 'dls-position-v1'
  orientationConstrained: false
  collisionChecked: false
  dynamicsSimulated: false
}

function coordinateValue(joint: RobotJoint): number {
  return joint.type === 'prismatic' ? joint.position : joint.position * DEG_TO_RAD
}

function modelValue(coordinate: ActiveCoordinate, value: number): number {
  return coordinate.angular ? value * RAD_TO_DEG : value
}

function activeCoordinates(robot: RobotModel): ActiveCoordinate[] {
  const fallbackPrismaticRange = Math.max(0.5, robot.metadata.nominalReachM ?? 0)
  return robot.joints.flatMap((joint, index): ActiveCoordinate[] => {
    if (joint.type === 'fixed') return []
    const angular = joint.type !== 'prismatic'
    const current = coordinateValue(joint)
    const explicitMin = joint.limits?.min
    const explicitMax = joint.limits?.max
    return [{
      index,
      angular,
      current,
      min: explicitMin === undefined
        ? current - (angular ? Math.PI : fallbackPrismaticRange)
        : angular ? explicitMin * DEG_TO_RAD : explicitMin,
      max: explicitMax === undefined
        ? current + (angular ? Math.PI : fallbackPrismaticRange)
        : angular ? explicitMax * DEG_TO_RAD : explicitMax,
    }]
  })
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function setCoordinates(robot: RobotModel, coordinates: ActiveCoordinate[], values: number[]): void {
  coordinates.forEach((coordinate, index) => {
    robot.joints[coordinate.index].position = modelValue(coordinate, values[index])
  })
}

function pointForRobot(robot: RobotModel, controlPointM: Vec3): Vec3 {
  return transformPoint(computeForwardKinematics(robot).endEffector.matrix, controlPointM)
}

function errorVector(target: Vec3, actual: Vec3): Vec3 {
  return [target[0] - actual[0], target[1] - actual[1], target[2] - actual[2]]
}

function magnitude(vector: Vec3): number {
  return Math.hypot(...vector)
}

/** Pivoted Gaussian elimination for a damped 3x3 system. */
function solve3x3(matrix: number[][], vector: Vec3): Vec3 | null {
  const rows = matrix.map((row, index) => [...row, vector[index]])
  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const divisor = rows[column][column]
    for (let entry = column; entry < 4; entry += 1) rows[column][entry] /= divisor
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let entry = column; entry < 4; entry += 1) rows[row][entry] -= factor * rows[column][entry]
    }
  }
  return [rows[0][3], rows[1][3], rows[2][3]]
}

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

function seedValues(coordinates: ActiveCoordinate[], seedIndex: number): number[] {
  if (seedIndex === 0) return coordinates.map((coordinate) => coordinate.current)
  if (seedIndex === 1) return coordinates.map((coordinate) => (coordinate.min + coordinate.max) / 2)
  return coordinates.map((coordinate, index) => {
    const fraction = radicalInverse(seedIndex - 1, HALTON_BASES[index])
    return coordinate.min + (coordinate.max - coordinate.min) * fraction
  })
}

function normalizedMovement(values: number[], coordinates: ActiveCoordinate[]): number {
  return Math.sqrt(values.reduce((sum, value, index) => {
    const span = Math.max(coordinates[index].max - coordinates[index].min, 1e-9)
    return sum + ((value - coordinates[index].current) / span) ** 2
  }, 0))
}

export function solvePositionIk(
  sourceRobot: RobotModel,
  targetPositionM: Vec3,
  toleranceM: number,
  controlPointM: Vec3 = [0, 0, 0],
): PositionIkResult {
  const coordinates = activeCoordinates(sourceRobot)
  const currentRobot = cloneSerializable(sourceRobot)
  const currentActual = pointForRobot(currentRobot, controlPointM)
  let evaluations = 1
  const currentResidual = magnitude(errorVector(targetPositionM, currentActual))
  if (currentResidual <= toleranceM) {
    return {
      converged: true,
      targetPositionM,
      achievedPositionM: currentActual,
      residualM: currentResidual,
      jointPositions: sourceRobot.joints.map((joint) => ({ jointId: joint.id, value: joint.position })),
      iterations: 0,
      attempts: 1,
      evaluations,
      solver: 'dls-position-v1',
      orientationConstrained: false,
      collisionChecked: false,
      dynamicsSimulated: false,
    }
  }

  let best = {
    values: coordinates.map((coordinate) => coordinate.current),
    actual: currentActual,
    residual: currentResidual,
    converged: false,
    movement: 0,
    seed: 0,
  }
  let totalIterations = 0

  for (let seed = 0; seed < MAX_SEED_ATTEMPTS; seed += 1) {
    const robot = cloneSerializable(sourceRobot)
    let values = seedValues(coordinates, seed)
    setCoordinates(robot, coordinates, values)
    let actual = pointForRobot(robot, controlPointM)
    evaluations += 1
    let residual = magnitude(errorVector(targetPositionM, actual))
    let stalled = 0

    for (let iteration = 0; iteration < MAX_ITERATIONS_PER_SEED && stalled < MAX_STALLED_ITERATIONS; iteration += 1) {
      totalIterations += 1
      if (residual <= toleranceM) break
      const jacobianColumns: Vec3[] = []
      for (let column = 0; column < coordinates.length; column += 1) {
        const coordinate = coordinates[column]
        const delta = coordinate.angular ? ANGULAR_STEP_RAD : PRISMATIC_STEP_M
        const plus = clamp(values[column] + delta, coordinate.min, coordinate.max)
        const minus = clamp(values[column] - delta, coordinate.min, coordinate.max)
        if (plus === minus) {
          jacobianColumns.push([0, 0, 0])
          continue
        }
        const plusValues = [...values]
        plusValues[column] = plus
        setCoordinates(robot, coordinates, plusValues)
        const plusPoint = pointForRobot(robot, controlPointM)
        const minusValues = [...values]
        minusValues[column] = minus
        setCoordinates(robot, coordinates, minusValues)
        const minusPoint = pointForRobot(robot, controlPointM)
        evaluations += 2
        const denominator = plus - minus
        jacobianColumns.push([
          (plusPoint[0] - minusPoint[0]) / denominator,
          (plusPoint[1] - minusPoint[1]) / denominator,
          (plusPoint[2] - minusPoint[2]) / denominator,
        ])
      }
      setCoordinates(robot, coordinates, values)
      const normal = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => (
        jacobianColumns.reduce((sum, jacobian) => sum + jacobian[row] * jacobian[column], row === column ? DAMPING ** 2 : 0)
      )))
      const solved = solve3x3(normal, errorVector(targetPositionM, actual))
      if (!solved) break
      const delta = jacobianColumns.map((column, index) => {
        const raw = column[0] * solved[0] + column[1] * solved[1] + column[2] * solved[2]
        const cap = coordinates[index].angular ? MAX_ANGULAR_STEP_RAD : MAX_PRISMATIC_STEP_M
        return clamp(raw, -cap, cap)
      })

      let accepted = false
      for (const scale of LINE_SEARCH) {
        const candidate = values.map((value, index) => clamp(value + delta[index] * scale, coordinates[index].min, coordinates[index].max))
        setCoordinates(robot, coordinates, candidate)
        const candidateActual = pointForRobot(robot, controlPointM)
        const candidateResidual = magnitude(errorVector(targetPositionM, candidateActual))
        evaluations += 1
        if (candidateResidual + 1e-10 < residual) {
          values = candidate
          actual = candidateActual
          residual = candidateResidual
          accepted = true
          stalled = 0
          break
        }
      }
      if (!accepted) stalled += 1
    }

    const converged = residual <= toleranceM
    const movement = normalizedMovement(values, coordinates)
    const preferred = converged
      ? !best.converged || movement < best.movement - 1e-10 || (Math.abs(movement - best.movement) <= 1e-10 && residual < best.residual)
      : !best.converged && residual < best.residual
    if (preferred) best = { values, actual, residual, converged, movement, seed }
  }

  const solvedRobot = cloneSerializable(sourceRobot)
  setCoordinates(solvedRobot, coordinates, best.values)
  return {
    converged: best.converged,
    targetPositionM,
    achievedPositionM: best.actual,
    residualM: best.residual,
    jointPositions: solvedRobot.joints.map((joint) => ({ jointId: joint.id, value: joint.position })),
    iterations: totalIterations,
    attempts: MAX_SEED_ATTEMPTS,
    evaluations,
    solver: 'dls-position-v1',
    orientationConstrained: false,
    collisionChecked: false,
    dynamicsSimulated: false,
  }
}
