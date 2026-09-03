import {
  axisRotationMatrix,
  identityMatrix,
  inverseRigidMatrix,
  multiplyMatrices,
  normalizeVector,
  transformMatrix,
  transformPoint,
  translationMatrix,
  vectorScale,
  worldPose,
} from './math'
import type {
  CameraSensor,
  CameraVisibility,
  ForwardKinematicsResult,
  Matrix4,
  RobotModel,
  SceneGeometry,
  SceneObject,
  SimulationScene,
  Vec3,
} from './types'

function jointMotionMatrix(joint: RobotModel['joints'][number]): Matrix4 {
  if (joint.type === 'revolute' || joint.type === 'continuous') {
    return axisRotationMatrix(joint.axis, joint.position)
  }
  if (joint.type === 'prismatic') {
    return translationMatrix(vectorScale(normalizeVector(joint.axis), joint.position))
  }
  return identityMatrix()
}

export function computeForwardKinematics(
  robot: RobotModel,
  cameras: readonly CameraSensor[] = [],
): ForwardKinematicsResult {
  if (robot.joints.length !== robot.links.length) {
    throw new Error('A serial robot must have exactly one link for each joint.')
  }

  let endpoint = transformMatrix(robot.basePose)
  const joints: ForwardKinematicsResult['joints'] = []
  const links: ForwardKinematicsResult['links'] = []
  const linkEndpoints = new Map<string, Matrix4>()

  robot.joints.forEach((joint, index) => {
    const link = robot.links[index]
    const jointAtZero = multiplyMatrices(endpoint, transformMatrix(joint.origin))
    const linkStart = multiplyMatrices(jointAtZero, jointMotionMatrix(joint))
    const direction = normalizeVector(link.direction)
    const center = multiplyMatrices(linkStart, translationMatrix(vectorScale(direction, link.lengthM / 2)))
    endpoint = multiplyMatrices(linkStart, translationMatrix(vectorScale(direction, link.lengthM)))
    joints.push({ jointId: joint.id, pose: worldPose(linkStart) })
    links.push({
      linkId: link.id,
      startPose: worldPose(linkStart),
      centerPose: worldPose(center),
      endPose: worldPose(endpoint),
    })
    linkEndpoints.set(link.id, endpoint)
  })

  const cameraFrames = cameras.map((camera) => {
    const parentLinkId = camera.parent.type === 'link' ? camera.parent.linkId : undefined
    const parent = parentLinkId === undefined ? identityMatrix() : linkEndpoints.get(parentLinkId)
    if (!parent) {
      throw new Error(`Camera ${camera.id} references missing link ${parentLinkId}.`)
    }
    return {
      cameraId: camera.id,
      pose: worldPose(multiplyMatrices(parent, transformMatrix(camera.pose))),
    }
  })

  return { joints, links, cameras: cameraFrames, endEffector: worldPose(endpoint) }
}

function geometryBoundingRadius(geometry: SceneGeometry): number {
  switch (geometry.type) {
    case 'sphere': return geometry.radiusM
    case 'cylinder': return Math.hypot(geometry.radiusM, geometry.heightM / 2)
    case 'plane': return Math.hypot(geometry.sizeM[0], geometry.sizeM[1]) / 2
    case 'box': return Math.hypot(...geometry.sizeM) / 2
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function projectWorldPointNormalized(
  camera: CameraSensor,
  inverseCamera: Matrix4,
  worldPoint: Vec3,
): [number, number] | null {
  const [depth, lateral, vertical] = transformPoint(inverseCamera, worldPoint)
  if (depth <= 1e-9) return null

  const halfWidthAtDepth = depth * Math.tan(camera.projection.horizontalFovDeg * Math.PI / 360)
  const halfHeightAtDepth = depth * Math.tan(camera.projection.verticalFovDeg * Math.PI / 360)
  return [
    0.5 + lateral / Math.max(2 * halfWidthAtDepth, 1e-9),
    0.5 - vertical / Math.max(2 * halfHeightAtDepth, 1e-9),
  ]
}

/**
 * Image-space cylinder-axis feature derived from the same ideal camera model as
 * visibility. It deliberately returns no world pose: 0deg is image-horizontal
 * and 90deg is image-vertical, matching what a vision system could estimate
 * from a segmented silhouette.
 */
export function computeProjectedCylinderAxis(
  camera: CameraSensor,
  cameraWorldMatrix: Matrix4,
  object: SceneObject,
): { longAxisAngleDeg: number; longAxisLengthNormalized: number } | null {
  if (object.geometry.type !== 'cylinder') return null

  const inverseCamera = inverseRigidMatrix(cameraWorldMatrix)
  const objectWorldMatrix = transformMatrix(object.pose)
  const halfHeight = object.geometry.heightM / 2
  const first = projectWorldPointNormalized(
    camera,
    inverseCamera,
    transformPoint(objectWorldMatrix, [0, 0, -halfHeight]),
  )
  const second = projectWorldPointNormalized(
    camera,
    inverseCamera,
    transformPoint(objectWorldMatrix, [0, 0, halfHeight]),
  )
  if (!first || !second) return null

  const deltaX = second[0] - first[0]
  const deltaY = second[1] - first[1]
  const length = Math.hypot(deltaX, deltaY)
  if (length <= 1e-9) return null

  const rawAngle = Math.atan2(deltaY, deltaX) * 180 / Math.PI
  return {
    longAxisAngleDeg: ((rawAngle % 180) + 180) % 180,
    longAxisLengthNormalized: length,
  }
}

/**
 * Ideal pinhole visibility using a conservative bounding sphere per primitive.
 * Camera optical forward is local +X, image-right is +Y, and image-up is +Z.
 */
export function computeCameraVisibility(
  camera: CameraSensor,
  cameraWorldMatrix: Matrix4,
  object: SceneObject,
): CameraVisibility {
  const inverseCamera = inverseRigidMatrix(cameraWorldMatrix)
  const objectWorld = transformPoint(transformMatrix(object.pose), [0, 0, 0])
  const [depth, lateral, vertical] = transformPoint(inverseCamera, objectWorld)
  const distanceM = Math.hypot(depth, lateral, vertical)
  const radius = geometryBoundingRadius(object.geometry)

  if (depth + radius <= 0) {
    return {
      cameraId: camera.id, objectId: object.id, visibility: 'none',
      distanceM, normalizedBounds: null, centerNormalized: null, reason: 'behind-camera',
    }
  }

  const { nearM, farM, horizontalFovDeg, verticalFovDeg } = camera.projection
  if (depth + radius < nearM || depth - radius > farM) {
    return {
      cameraId: camera.id, objectId: object.id, visibility: 'none',
      distanceM, normalizedBounds: null, centerNormalized: null, reason: 'near-or-far-clipped',
    }
  }

  const safeDepth = Math.max(depth, 1e-9)
  const halfWidthAtDepth = safeDepth * Math.tan(horizontalFovDeg * Math.PI / 360)
  const halfHeightAtDepth = safeDepth * Math.tan(verticalFovDeg * Math.PI / 360)
  const centerX = 0.5 + lateral / (2 * halfWidthAtDepth)
  const centerY = 0.5 - vertical / (2 * halfHeightAtDepth)
  const radiusX = radius / Math.max(2 * halfWidthAtDepth, 1e-9)
  const radiusY = radius / Math.max(2 * halfHeightAtDepth, 1e-9)
  const raw: [number, number, number, number] = [
    centerX - radiusX, centerY - radiusY, centerX + radiusX, centerY + radiusY,
  ]

  if (raw[2] < 0 || raw[0] > 1 || raw[3] < 0 || raw[1] > 1) {
    return {
      cameraId: camera.id, objectId: object.id, visibility: 'none', distanceM,
      normalizedBounds: null, centerNormalized: [centerX, centerY], reason: 'outside-frustum',
    }
  }

  const depthIsFull = depth - radius >= nearM && depth + radius <= farM
  const imageIsFull = raw.every((value) => value >= 0 && value <= 1)
  return {
    cameraId: camera.id,
    objectId: object.id,
    visibility: depthIsFull && imageIsFull ? 'full' : 'partial',
    distanceM,
    normalizedBounds: [clamp01(raw[0]), clamp01(raw[1]), clamp01(raw[2]), clamp01(raw[3])],
    centerNormalized: [centerX, centerY],
  }
}

export function computeSceneKinematics(scene: SimulationScene) {
  const kinematics = computeForwardKinematics(scene.robot, scene.cameras)
  const cameraVisibility = scene.cameras.map((camera) => {
    const frame = kinematics.cameras.find((candidate) => candidate.cameraId === camera.id)
    if (!frame) throw new Error(`Missing computed frame for camera ${camera.id}.`)
    return {
      cameraId: camera.id,
      objects: scene.objects.map((object) => computeCameraVisibility(camera, frame.pose.matrix, object)),
    }
  })
  return { ...kinematics, cameraVisibility }
}

export function endEffectorPosition(robot: RobotModel): Vec3 {
  return computeForwardKinematics(robot).endEffector.positionM
}
