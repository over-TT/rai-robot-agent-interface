import type { Matrix4, Quaternion, Transform, Vec3, WorldPose } from './types'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

export const IDENTITY_TRANSFORM: Transform = {
  positionM: [0, 0, 0],
  rotationDeg: [0, 0, 0],
}

export function identityMatrix(): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function multiplyMatrices(a: Matrix4, b: Matrix4): Matrix4 {
  const result = new Array<number>(16).fill(0)
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let index = 0; index < 4; index += 1) {
        result[row * 4 + column] += a[row * 4 + index] * b[index * 4 + column]
      }
    }
  }
  return result as Matrix4
}

export function translationMatrix([x, y, z]: Vec3): Matrix4 {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]
}

export function axisRotationMatrix(axis: Vec3, angleDeg: number): Matrix4 {
  const [x, y, z] = normalizeVector(axis)
  const angle = angleDeg * DEG_TO_RAD
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const oneMinusCosine = 1 - cosine
  return [
    cosine + x * x * oneMinusCosine,
    x * y * oneMinusCosine - z * sine,
    x * z * oneMinusCosine + y * sine,
    0,
    y * x * oneMinusCosine + z * sine,
    cosine + y * y * oneMinusCosine,
    y * z * oneMinusCosine - x * sine,
    0,
    z * x * oneMinusCosine - y * sine,
    z * y * oneMinusCosine + x * sine,
    cosine + z * z * oneMinusCosine,
    0,
    0, 0, 0, 1,
  ]
}

/** Matrix for intrinsic XYZ Euler degrees, represented as Rz * Ry * Rx. */
export function eulerMatrix([x, y, z]: Vec3): Matrix4 {
  return multiplyMatrices(
    multiplyMatrices(axisRotationMatrix([0, 0, 1], z), axisRotationMatrix([0, 1, 0], y)),
    axisRotationMatrix([1, 0, 0], x),
  )
}

export function transformMatrix(transform: Transform): Matrix4 {
  return multiplyMatrices(translationMatrix(transform.positionM), eulerMatrix(transform.rotationDeg))
}

/** Inverse of transformMatrix for rigid matrices using the same Rz * Ry * Rx convention. */
export function transformFromMatrix(matrix: Matrix4): Transform {
  const sinY = Math.max(-1, Math.min(1, -matrix[8]))
  const y = Math.asin(sinY)
  const cosY = Math.cos(y)
  let x: number
  let z: number
  if (Math.abs(cosY) > 1e-8) {
    x = Math.atan2(matrix[9], matrix[10])
    z = Math.atan2(matrix[4], matrix[0])
  } else {
    // Deterministic gimbal-lock branch: preserve the combined X/Z rotation in X.
    x = sinY >= 0 ? Math.atan2(matrix[1], matrix[5]) : Math.atan2(-matrix[1], matrix[5])
    z = 0
  }
  return {
    positionM: [matrix[3], matrix[7], matrix[11]],
    rotationDeg: [x * RAD_TO_DEG, y * RAD_TO_DEG, z * RAD_TO_DEG],
  }
}

export function transformPoint(matrix: Matrix4, [x, y, z]: Vec3): Vec3 {
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
  ]
}

export function inverseRigidMatrix(matrix: Matrix4): Matrix4 {
  const x = matrix[3]
  const y = matrix[7]
  const z = matrix[11]
  return [
    matrix[0], matrix[4], matrix[8], -(matrix[0] * x + matrix[4] * y + matrix[8] * z),
    matrix[1], matrix[5], matrix[9], -(matrix[1] * x + matrix[5] * y + matrix[9] * z),
    matrix[2], matrix[6], matrix[10], -(matrix[2] * x + matrix[6] * y + matrix[10] * z),
    0, 0, 0, 1,
  ]
}

export function normalizeVector(vector: Vec3): Vec3 {
  const magnitude = Math.hypot(...vector)
  if (!Number.isFinite(magnitude) || magnitude < 1e-9) {
    throw new Error('Axis and direction vectors must be non-zero and finite.')
  }
  return vector.map((component) => component / magnitude) as Vec3
}

export function quaternionFromMatrix(matrix: Matrix4): Quaternion {
  const trace = matrix[0] + matrix[5] + matrix[10]
  let x: number
  let y: number
  let z: number
  let w: number
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2
    w = 0.25 * scale
    x = (matrix[9] - matrix[6]) / scale
    y = (matrix[2] - matrix[8]) / scale
    z = (matrix[4] - matrix[1]) / scale
  } else if (matrix[0] > matrix[5] && matrix[0] > matrix[10]) {
    const scale = Math.sqrt(1 + matrix[0] - matrix[5] - matrix[10]) * 2
    w = (matrix[9] - matrix[6]) / scale
    x = 0.25 * scale
    y = (matrix[1] + matrix[4]) / scale
    z = (matrix[2] + matrix[8]) / scale
  } else if (matrix[5] > matrix[10]) {
    const scale = Math.sqrt(1 + matrix[5] - matrix[0] - matrix[10]) * 2
    w = (matrix[2] - matrix[8]) / scale
    x = (matrix[1] + matrix[4]) / scale
    y = 0.25 * scale
    z = (matrix[6] + matrix[9]) / scale
  } else {
    const scale = Math.sqrt(1 + matrix[10] - matrix[0] - matrix[5]) * 2
    w = (matrix[4] - matrix[1]) / scale
    x = (matrix[2] + matrix[8]) / scale
    y = (matrix[6] + matrix[9]) / scale
    z = 0.25 * scale
  }
  return [x, y, z, w]
}

export function worldPose(matrix: Matrix4): WorldPose {
  return {
    positionM: [matrix[3], matrix[7], matrix[11]],
    quaternionXyzw: quaternionFromMatrix(matrix),
    matrix,
  }
}

export function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function vectorScale(vector: Vec3, scale: number): Vec3 {
  return vector.map((component) => component * scale) as Vec3
}
