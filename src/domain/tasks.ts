import { computeSceneKinematics } from './kinematics'
import {
  inverseRigidMatrix,
  multiplyMatrices,
  transformFromMatrix,
  transformMatrix,
  transformPoint,
} from './math'
import type {
  KinematicGrasp,
  SceneGeometry,
  SceneObject,
  SimulationGoal,
  SimulationGoalEvaluation,
  SimulationScene,
  Vec3,
} from './types'
import { SimulationError } from './validation'

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function surfaceDistanceLocal(point: Vec3, geometry: SceneGeometry): number {
  if (geometry.type === 'sphere') return Math.max(0, Math.hypot(...point) - geometry.radiusM)
  if (geometry.type === 'box') {
    const outside = point.map((value, index) => Math.max(Math.abs(value) - geometry.sizeM[index] / 2, 0)) as Vec3
    return Math.hypot(...outside)
  }
  if (geometry.type === 'cylinder') {
    const radial = Math.hypot(point[0], point[1]) - geometry.radiusM
    const vertical = Math.abs(point[2]) - geometry.heightM / 2
    return Math.hypot(Math.max(radial, 0), Math.max(vertical, 0))
  }
  return Number.POSITIVE_INFINITY
}

/** Tilt of a cylinder's local +Z longitudinal axis away from world vertical. */
export function cylinderTiltDeg(object: SceneObject): number {
  if (object.geometry.type !== 'cylinder') {
    throw new SimulationError('CONFLICT', `Object ${object.id} must be a cylinder to evaluate tipping.`)
  }
  const matrix = transformMatrix(object.pose)
  const verticalAlignment = Math.max(0, Math.min(1, Math.abs(matrix[10])))
  return Math.acos(verticalAlignment) * 180 / Math.PI
}

export function endEffectorToObjectSurfaceDistance(scene: SimulationScene, object: SceneObject): number {
  const endEffector = computeSceneKinematics(scene).endEffector.positionM
  const pointInObject = transformPoint(inverseRigidMatrix(transformMatrix(object.pose)), endEffector)
  return surfaceDistanceLocal(pointInObject, object.geometry)
}

export function createKinematicGrasp(
  scene: SimulationScene,
  objectId: string,
  captureDistanceM: number,
): KinematicGrasp {
  if (scene.grasp) throw new SimulationError('CONFLICT', `Object ${scene.grasp.objectId} is already grasped.`)
  const object = scene.objects.find((candidate) => candidate.id === objectId)
  if (!object) throw new SimulationError('NOT_FOUND', `Object ${objectId} does not exist.`)
  if (object.geometry.type === 'plane' || object.movable !== true) {
    throw new SimulationError('CONFLICT', `Object ${objectId} is not a movable graspable primitive.`)
  }
  const surfaceDistanceM = endEffectorToObjectSurfaceDistance(scene, object)
  if (surfaceDistanceM > captureDistanceM) {
    throw new SimulationError(
      'GRASP_OUT_OF_RANGE',
      `Object ${objectId} is ${surfaceDistanceM.toFixed(4)} m from the virtual tool surface, beyond the ${captureDistanceM.toFixed(4)} m capture distance.`,
      { objectId, surfaceDistanceM, captureDistanceM },
    )
  }
  const endEffectorMatrix = computeSceneKinematics(scene).endEffector.matrix
  return {
    objectId,
    endEffectorToObjectMatrix: multiplyMatrices(
      inverseRigidMatrix(endEffectorMatrix),
      transformMatrix(object.pose),
    ),
  }
}

/** Materialize the currently grasped object's rigid world pose after a robot move. */
export function syncGraspedObjectPose(scene: SimulationScene): string | undefined {
  if (!scene.grasp) return undefined
  const object = scene.objects.find((candidate) => candidate.id === scene.grasp?.objectId)
  if (!object) throw new SimulationError('NOT_FOUND', `Grasped object ${scene.grasp.objectId} no longer exists.`)
  const endEffectorMatrix = computeSceneKinematics(scene).endEffector.matrix
  object.pose = transformFromMatrix(multiplyMatrices(endEffectorMatrix, scene.grasp.endEffectorToObjectMatrix))
  return object.id
}

export function graspedObjectControlPoint(scene: SimulationScene): Vec3 {
  if (!scene.grasp) throw new SimulationError('CONFLICT', 'No object is currently grasped.')
  const matrix = scene.grasp.endEffectorToObjectMatrix
  return [matrix[3], matrix[7], matrix[11]]
}

export function goalReferencesExist(scene: SimulationScene, goal: SimulationGoal): boolean {
  if ('objectId' in goal && !scene.objects.some((object) => object.id === goal.objectId)) return false
  if (goal.type === 'camera-sees-object' && !scene.cameras.some((camera) => camera.id === goal.cameraId)) return false
  return true
}

export function evaluateSimulationGoal(scene: SimulationScene): SimulationGoalEvaluation {
  const goal = scene.goal
  if (!goal) return { type: 'none', succeeded: false, summary: 'No simulation goal is active.' }
  const computed = computeSceneKinematics(scene)
  if (goal.type === 'object-at-position') {
    const object = scene.objects.find((candidate) => candidate.id === goal.objectId)
    if (!object) return { type: 'none', succeeded: false, summary: `Goal object ${goal.objectId} is missing.` }
    const distanceM = distance(object.pose.positionM, goal.targetPositionM)
    const succeeded = distanceM <= goal.toleranceM
    return {
      type: goal.type,
      succeeded,
      distanceM,
      toleranceM: goal.toleranceM,
      targetPositionM: goal.targetPositionM,
      actualPositionM: object.pose.positionM,
      summary: succeeded
        ? `${goal.name} succeeded; ${goal.objectId} is within ${(goal.toleranceM * 1000).toFixed(1)} mm.`
        : `${goal.name} is pending; ${goal.objectId} is ${(distanceM * 1000).toFixed(1)} mm from target.`,
    }
  }
  if (goal.type === 'end-effector-at-position') {
    const distanceM = distance(computed.endEffector.positionM, goal.targetPositionM)
    const succeeded = distanceM <= goal.toleranceM
    return {
      type: goal.type,
      succeeded,
      distanceM,
      toleranceM: goal.toleranceM,
      targetPositionM: goal.targetPositionM,
      actualPositionM: computed.endEffector.positionM,
      summary: succeeded
        ? `${goal.name} succeeded; the end effector reached tolerance.`
        : `${goal.name} is pending; the end effector is ${(distanceM * 1000).toFixed(1)} mm from target.`,
    }
  }
  if (goal.type === 'object-grasped') {
    const graspedObjectId = scene.grasp?.objectId ?? null
    const succeeded = graspedObjectId === goal.objectId
    return {
      type: goal.type,
      succeeded,
      graspedObjectId,
      summary: succeeded ? `${goal.name} succeeded; ${goal.objectId} is grasped.` : `${goal.name} is pending; ${goal.objectId} is not grasped.`,
    }
  }
  if (goal.type === 'object-tipped') {
    const object = scene.objects.find((candidate) => candidate.id === goal.objectId)
    if (!object) return { type: 'none', succeeded: false, summary: `Goal object ${goal.objectId} is missing.` }
    const tiltDeg = cylinderTiltDeg(object)
    const requireReleased = goal.requireReleased ?? true
    const released = scene.grasp?.objectId !== goal.objectId
    const tipped = tiltDeg + 1e-8 >= goal.minimumTiltDeg
    const succeeded = tipped && (!requireReleased || released)
    const releaseSummary = requireReleased && !released ? ' Release it to finish.' : ''
    return {
      type: goal.type,
      succeeded,
      objectId: goal.objectId,
      tiltDeg,
      minimumTiltDeg: goal.minimumTiltDeg,
      released,
      requireReleased,
      summary: succeeded
        ? `${goal.name} succeeded; ${goal.objectId} is tilted ${tiltDeg.toFixed(1)}°${released ? ' and released' : ''}.`
        : `${goal.name} is pending; tilt ${tiltDeg.toFixed(1)}° / ${goal.minimumTiltDeg.toFixed(1)}°.${releaseSummary}`,
    }
  }
  const report = computed.cameraVisibility.find((camera) => camera.cameraId === goal.cameraId)
  const visibility = report?.objects.find((object) => object.objectId === goal.objectId)?.visibility ?? 'none'
  const succeeded = goal.minimumVisibility === 'full' ? visibility === 'full' : visibility !== 'none'
  return {
    type: goal.type,
    succeeded,
    visibility,
    minimumVisibility: goal.minimumVisibility,
    summary: succeeded
      ? `${goal.name} succeeded; ${goal.objectId} is ${visibility} in ${goal.cameraId}.`
      : `${goal.name} is pending; ${goal.objectId} visibility is ${visibility}.`,
  }
}
