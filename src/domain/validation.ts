import type {
  CameraProjection,
  CameraSensor,
  JointType,
  Matrix4,
  RobotJoint,
  RobotLink,
  RobotModel,
  SceneGeometry,
  SceneObject,
  SimulationCommand,
  SimulationGoal,
  SimulationScene,
  SimulationState,
  Transform,
  Vec3,
} from './types'
import { computeForwardKinematics } from './kinematics'
import { multiplyMatrices, transformMatrix } from './math'

const RIGID_MATRIX_TOLERANCE = 1e-5
const GRASP_POSE_TOLERANCE = 1e-4
const WORKSPACE_POSITION_LIMIT_M = 20
/** Roughly 31 years of continuous one-mutation-per-second use. */
export const MAX_SIMULATION_REVISION = 1_000_000_000

export type SimulationErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PHASE_LOCKED'
  | 'LIMIT_EXCEEDED'
  | 'REVISION_CONFLICT'
  | 'REQUEST_ID_REUSED'
  | 'NOTHING_TO_UNDO'
  | 'NOTHING_TO_REDO'
  | 'IK_DID_NOT_CONVERGE'
  | 'GRASP_OUT_OF_RANGE'
  | 'ABORTED'

export class SimulationError extends Error {
  readonly code: SimulationErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: SimulationErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'SimulationError'
    this.code = code
    this.details = details
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new SimulationError('INVALID_INPUT', `${label} must be an object.`)
}

export function assertNoUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new SimulationError('INVALID_INPUT', `${label} contains unsupported fields: ${unknown.join(', ')}.`)
  }
}

export function assertString(value: unknown, label: string, maxLength = 100): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new SimulationError('INVALID_INPUT', `${label} must be a non-empty string of at most ${maxLength} characters.`)
  }
}

export function assertFiniteNumber(
  value: unknown,
  label: string,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new SimulationError('INVALID_INPUT', `${label} must be a finite number between ${minimum} and ${maximum}.`)
  }
}

export function nextSimulationRevision(current: number): number {
  assertFiniteNumber(current, 'state.revision', 0, MAX_SIMULATION_REVISION)
  if (!Number.isInteger(current)) {
    throw new SimulationError('INVALID_INPUT', 'state.revision must be an integer.')
  }
  if (current >= MAX_SIMULATION_REVISION) {
    throw new SimulationError(
      'LIMIT_EXCEEDED',
      `The simulation revision ceiling of ${MAX_SIMULATION_REVISION} has been reached; export a backup and start a fresh project before making more changes.`,
    )
  }
  return current + 1
}

export function assertVec3(value: unknown, label: string): asserts value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new SimulationError('INVALID_INPUT', `${label} must contain exactly three numbers.`)
  }
  value.forEach((component, index) => assertFiniteNumber(component, `${label}[${index}]`))
}

function assertNormalizableVec3(value: unknown, label: string): asserts value is Vec3 {
  assertVec3(value, label)
  const magnitude = Math.hypot(...value)
  if (!Number.isFinite(magnitude) || magnitude < 1e-9) {
    throw new SimulationError('INVALID_INPUT', `${label} must have a finite, non-zero magnitude.`)
  }
}

function assertWorkspaceVec3(value: unknown, label: string): asserts value is Vec3 {
  assertVec3(value, label)
  value.forEach((component, index) => assertFiniteNumber(
    component,
    `${label}[${index}]`,
    -WORKSPACE_POSITION_LIMIT_M,
    WORKSPACE_POSITION_LIMIT_M,
  ))
}

function assertBoundedVec3(value: unknown, label: string, minimum: number, maximum: number): asserts value is Vec3 {
  assertVec3(value, label)
  value.forEach((component, index) => assertFiniteNumber(component, `${label}[${index}]`, minimum, maximum))
}

export function validateTransform(value: Transform, label: string): void {
  assertRecord(value, label)
  assertNoUnknownKeys(value, ['positionM', 'rotationDeg'], label)
  assertWorkspaceVec3(value.positionM, `${label}.positionM`)
  assertVec3(value.rotationDeg, `${label}.rotationDeg`)
}

function validateId(value: unknown, label: string): asserts value is string {
  assertString(value, label, 80)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new SimulationError('INVALID_INPUT', `${label} may contain only letters, numbers, dot, underscore, and dash.`)
  }
}

function validateColor(value: unknown, label: string): asserts value is string {
  assertString(value, label, 32)
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
    throw new SimulationError('INVALID_INPUT', `${label} must be a six-digit hex color such as #22d3ee.`)
  }
}

function validateHttpUrl(value: unknown, label: string): asserts value is string {
  assertString(value, label, 500)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new SimulationError('INVALID_INPUT', `${label} must be an absolute HTTP or HTTPS URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SimulationError('INVALID_INPUT', `${label} must use the http or https scheme.`)
  }
}

export function validateJoint(joint: RobotJoint, label = 'joint'): void {
  assertRecord(joint, label)
  assertNoUnknownKeys(joint, ['id', 'name', 'type', 'axis', 'origin', 'position', 'limits'], label)
  validateId(joint.id, `${label}.id`)
  assertString(joint.name, `${label}.name`)
  const types: JointType[] = ['fixed', 'revolute', 'continuous', 'prismatic']
  if (!types.includes(joint.type)) throw new SimulationError('INVALID_INPUT', `${label}.type is unsupported.`)
  assertNormalizableVec3(joint.axis, `${label}.axis`)
  validateTransform(joint.origin, `${label}.origin`)
  const valueBound = joint.type === 'prismatic' ? 10 : 100000
  assertFiniteNumber(joint.position, `${label}.position`, -valueBound, valueBound)
  if (joint.type === 'fixed' && joint.position !== 0) {
    throw new SimulationError('INVALID_INPUT', `${label}.position must be zero for a fixed joint.`)
  }
  if (joint.limits !== undefined) {
    assertRecord(joint.limits, `${label}.limits`)
    assertNoUnknownKeys(joint.limits, ['min', 'max'], `${label}.limits`)
    assertFiniteNumber(joint.limits.min, `${label}.limits.min`)
    assertFiniteNumber(joint.limits.max, `${label}.limits.max`)
    if (joint.limits.min > joint.limits.max) {
      throw new SimulationError('INVALID_INPUT', `${label}.limits.min cannot exceed max.`)
    }
    if (joint.type === 'continuous') {
      throw new SimulationError('INVALID_INPUT', `${label} is continuous and must not define position limits.`)
    }
    if (joint.position < joint.limits.min || joint.position > joint.limits.max) {
      throw new SimulationError('LIMIT_EXCEEDED', `${label}.position is outside its limits.`)
    }
  }
}

export function validateLink(link: RobotLink, label = 'link'): void {
  assertRecord(link, label)
  assertNoUnknownKeys(link, ['id', 'name', 'lengthM', 'radiusM', 'color', 'direction'], label)
  validateId(link.id, `${label}.id`)
  assertString(link.name, `${label}.name`)
  assertFiniteNumber(link.lengthM, `${label}.lengthM`, 0, 10)
  assertFiniteNumber(link.radiusM, `${label}.radiusM`, 0.001, 2)
  validateColor(link.color, `${label}.color`)
  assertNormalizableVec3(link.direction, `${label}.direction`)
}

export function validateRobot(robot: RobotModel): void {
  assertRecord(robot, 'robot')
  assertNoUnknownKeys(robot, ['id', 'name', 'basePose', 'joints', 'links', 'metadata'], 'robot')
  validateId(robot.id, 'robot.id')
  assertString(robot.name, 'robot.name')
  validateTransform(robot.basePose, 'robot.basePose')
  if (!Array.isArray(robot.joints) || !Array.isArray(robot.links)) {
    throw new SimulationError('INVALID_INPUT', 'robot.joints and robot.links must be arrays.')
  }
  if (robot.joints.length !== robot.links.length) {
    throw new SimulationError('INVALID_INPUT', 'A serial robot requires one link per joint.')
  }
  if (robot.joints.length < 1 || robot.joints.length > 8) {
    throw new SimulationError('LIMIT_EXCEEDED', 'A serial robot must have between 1 and 8 joints.')
  }
  robot.joints.forEach((joint, index) => validateJoint(joint, `robot.joints[${index}]`))
  robot.links.forEach((link, index) => validateLink(link, `robot.links[${index}]`))
  const ids = [...robot.joints.map((joint) => joint.id), ...robot.links.map((link) => link.id)]
  if (new Set(ids).size !== ids.length) {
    throw new SimulationError('CONFLICT', 'Joint and link IDs must be unique within a robot.')
  }
  assertRecord(robot.metadata, 'robot.metadata')
  assertNoUnknownKeys(robot.metadata, ['presetId', 'sourceUrl', 'license', 'accuracy', 'note', 'nominalReachM'], 'robot.metadata')
  if (!['exact-project-geometry', 'synthetic-reference', 'simplified-reference', 'custom'].includes(String(robot.metadata.accuracy))) {
    throw new SimulationError('INVALID_INPUT', 'robot.metadata.accuracy is unsupported.')
  }
  if (robot.metadata.presetId !== undefined) validateId(robot.metadata.presetId, 'robot.metadata.presetId')
  if (robot.metadata.sourceUrl !== undefined) validateHttpUrl(robot.metadata.sourceUrl, 'robot.metadata.sourceUrl')
  if (robot.metadata.license !== undefined) assertString(robot.metadata.license, 'robot.metadata.license', 500)
  if (robot.metadata.nominalReachM !== undefined) assertFiniteNumber(robot.metadata.nominalReachM, 'robot.metadata.nominalReachM', 0, 100)
  assertString(robot.metadata.note, 'robot.metadata.note', 500)
}

export function validateProjection(projection: CameraProjection, label = 'projection'): void {
  assertRecord(projection, label)
  assertNoUnknownKeys(projection, ['model', 'widthPx', 'heightPx', 'horizontalFovDeg', 'verticalFovDeg', 'nearM', 'farM'], label)
  if (projection.model !== 'ideal-pinhole') {
    throw new SimulationError('INVALID_INPUT', `${label}.model must be ideal-pinhole.`)
  }
  assertFiniteNumber(projection.widthPx, `${label}.widthPx`, 1, 16384)
  assertFiniteNumber(projection.heightPx, `${label}.heightPx`, 1, 16384)
  if (!Number.isInteger(projection.widthPx) || !Number.isInteger(projection.heightPx)) {
    throw new SimulationError('INVALID_INPUT', `${label} pixel dimensions must be integers.`)
  }
  assertFiniteNumber(projection.horizontalFovDeg, `${label}.horizontalFovDeg`, 1, 179)
  assertFiniteNumber(projection.verticalFovDeg, `${label}.verticalFovDeg`, 1, 179)
  assertFiniteNumber(projection.nearM, `${label}.nearM`, 0.0001, 1000)
  assertFiniteNumber(projection.farM, `${label}.farM`, 0.0002, 10000)
  if (projection.farM <= projection.nearM) {
    throw new SimulationError('INVALID_INPUT', `${label}.farM must be greater than nearM.`)
  }
}

export function validateCamera(camera: CameraSensor, robot: RobotModel): void {
  assertRecord(camera, 'camera')
  assertNoUnknownKeys(camera, ['id', 'name', 'parent', 'pose', 'projection', 'presetId', 'note'], 'camera')
  validateId(camera.id, 'camera.id')
  assertString(camera.name, 'camera.name')
  assertRecord(camera.parent, 'camera.parent')
  if (camera.parent.type === 'link') {
    assertNoUnknownKeys(camera.parent, ['type', 'linkId'], 'camera.parent')
    const parentLinkId = camera.parent.linkId
    validateId(parentLinkId, 'camera.parent.linkId')
    if (!robot.links.some((link) => link.id === parentLinkId)) {
      throw new SimulationError('NOT_FOUND', `Camera parent link ${parentLinkId} does not exist.`)
    }
  } else if (camera.parent.type !== 'world') {
    throw new SimulationError('INVALID_INPUT', 'camera.parent.type must be world or link.')
  } else {
    assertNoUnknownKeys(camera.parent, ['type'], 'camera.parent')
  }
  validateTransform(camera.pose, 'camera.pose')
  validateProjection(camera.projection, 'camera.projection')
  if (camera.presetId !== undefined) validateId(camera.presetId, 'camera.presetId')
  assertString(camera.note, 'camera.note', 500)
}

export function validateGeometry(geometry: SceneGeometry, label = 'geometry'): void {
  assertRecord(geometry, label)
  if (geometry.type === 'box') {
    assertNoUnknownKeys(geometry, ['type', 'sizeM'], label)
    assertVec3(geometry.sizeM, `${label}.sizeM`)
    geometry.sizeM.forEach((value, index) => assertFiniteNumber(value, `${label}.sizeM[${index}]`, 0.001, 100))
  } else if (geometry.type === 'sphere') {
    assertNoUnknownKeys(geometry, ['type', 'radiusM'], label)
    assertFiniteNumber(geometry.radiusM, `${label}.radiusM`, 0.001, 100)
  } else if (geometry.type === 'cylinder') {
    assertNoUnknownKeys(geometry, ['type', 'radiusM', 'heightM'], label)
    assertFiniteNumber(geometry.radiusM, `${label}.radiusM`, 0.001, 100)
    assertFiniteNumber(geometry.heightM, `${label}.heightM`, 0.001, 100)
  } else if (geometry.type === 'plane') {
    assertNoUnknownKeys(geometry, ['type', 'sizeM'], label)
    if (!Array.isArray(geometry.sizeM) || geometry.sizeM.length !== 2) {
      throw new SimulationError('INVALID_INPUT', `${label}.sizeM must contain two numbers.`)
    }
    geometry.sizeM.forEach((value, index) => assertFiniteNumber(value, `${label}.sizeM[${index}]`, 0.001, 1000))
  } else {
    throw new SimulationError('INVALID_INPUT', `${label}.type is unsupported.`)
  }
}

export function validateSceneObject(object: SceneObject): void {
  assertRecord(object, 'object')
  assertNoUnknownKeys(object, ['id', 'name', 'pose', 'geometry', 'color', 'movable'], 'object')
  validateId(object.id, 'object.id')
  assertString(object.name, 'object.name')
  validateTransform(object.pose, 'object.pose')
  validateGeometry(object.geometry, 'object.geometry')
  validateColor(object.color, 'object.color')
  if (object.movable !== undefined && typeof object.movable !== 'boolean') {
    throw new SimulationError('INVALID_INPUT', 'object.movable must be a boolean.')
  }
}

function validateMatrix4(value: unknown, label: string): asserts value is Matrix4 {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new SimulationError('INVALID_INPUT', `${label} must contain exactly 16 numbers.`)
  }
  value.forEach((entry, index) => assertFiniteNumber(entry, `${label}[${index}]`))
  if (Math.abs(value[12]) > 1e-8 || Math.abs(value[13]) > 1e-8 || Math.abs(value[14]) > 1e-8 || Math.abs(value[15] - 1) > 1e-8) {
    throw new SimulationError('INVALID_INPUT', `${label} must be a rigid affine matrix.`)
  }
  const rows = [
    [value[0], value[1], value[2]],
    [value[4], value[5], value[6]],
    [value[8], value[9], value[10]],
  ]
  const dot = (left: number[], right: number[]) => left.reduce((sum, entry, index) => sum + entry * right[index], 0)
  for (let row = 0; row < 3; row += 1) {
    if (Math.abs(dot(rows[row], rows[row]) - 1) > RIGID_MATRIX_TOLERANCE) {
      throw new SimulationError('INVALID_INPUT', `${label} rotation must be orthonormal.`)
    }
    for (let other = row + 1; other < 3; other += 1) {
      if (Math.abs(dot(rows[row], rows[other])) > RIGID_MATRIX_TOLERANCE) {
        throw new SimulationError('INVALID_INPUT', `${label} rotation must be orthonormal.`)
      }
    }
  }
  const determinant =
    value[0] * (value[5] * value[10] - value[6] * value[9])
    - value[1] * (value[4] * value[10] - value[6] * value[8])
    + value[2] * (value[4] * value[9] - value[5] * value[8])
  if (Math.abs(determinant - 1) > RIGID_MATRIX_TOLERANCE) {
    throw new SimulationError('INVALID_INPUT', `${label} rotation determinant must be +1.`)
  }
}

export function validateSimulationGoal(goal: SimulationGoal, scene: Pick<SimulationScene, 'objects' | 'cameras'>): void {
  assertRecord(goal, 'goal')
  assertString(goal.name, 'goal.name', 100)
  if (goal.type === 'object-at-position') {
    assertNoUnknownKeys(goal, ['name', 'type', 'objectId', 'targetPositionM', 'toleranceM'], 'goal')
    validateId(goal.objectId, 'goal.objectId')
    assertWorkspaceVec3(goal.targetPositionM, 'goal.targetPositionM')
    assertFiniteNumber(goal.toleranceM, 'goal.toleranceM', 0.0001, 1)
    if (!scene.objects.some((object) => object.id === goal.objectId)) throw new SimulationError('NOT_FOUND', `Goal object ${goal.objectId} does not exist.`)
    return
  }
  if (goal.type === 'end-effector-at-position') {
    assertNoUnknownKeys(goal, ['name', 'type', 'targetPositionM', 'toleranceM'], 'goal')
    assertWorkspaceVec3(goal.targetPositionM, 'goal.targetPositionM')
    assertFiniteNumber(goal.toleranceM, 'goal.toleranceM', 0.0001, 1)
    return
  }
  if (goal.type === 'camera-sees-object') {
    assertNoUnknownKeys(goal, ['name', 'type', 'cameraId', 'objectId', 'minimumVisibility'], 'goal')
    validateId(goal.cameraId, 'goal.cameraId')
    validateId(goal.objectId, 'goal.objectId')
    if (!['partial', 'full'].includes(String(goal.minimumVisibility))) throw new SimulationError('INVALID_INPUT', 'goal.minimumVisibility must be partial or full.')
    if (!scene.cameras.some((camera) => camera.id === goal.cameraId)) throw new SimulationError('NOT_FOUND', `Goal camera ${goal.cameraId} does not exist.`)
    if (!scene.objects.some((object) => object.id === goal.objectId)) throw new SimulationError('NOT_FOUND', `Goal object ${goal.objectId} does not exist.`)
    return
  }
  if (goal.type === 'object-grasped') {
    assertNoUnknownKeys(goal, ['name', 'type', 'objectId'], 'goal')
    validateId(goal.objectId, 'goal.objectId')
    const object = scene.objects.find((candidate) => candidate.id === goal.objectId)
    if (!object) throw new SimulationError('NOT_FOUND', `Goal object ${goal.objectId} does not exist.`)
    if (object.geometry.type === 'plane' || object.movable !== true) {
      throw new SimulationError('CONFLICT', `Goal object ${goal.objectId} must be a movable non-plane primitive to be grasped.`)
    }
    return
  }
  if (goal.type === 'object-tipped') {
    assertNoUnknownKeys(goal, ['name', 'type', 'objectId', 'minimumTiltDeg', 'requireReleased'], 'goal')
    validateId(goal.objectId, 'goal.objectId')
    assertFiniteNumber(goal.minimumTiltDeg, 'goal.minimumTiltDeg', 1, 90)
    if (goal.requireReleased !== undefined && typeof goal.requireReleased !== 'boolean') {
      throw new SimulationError('INVALID_INPUT', 'goal.requireReleased must be a boolean.')
    }
    const object = scene.objects.find((candidate) => candidate.id === goal.objectId)
    if (!object) throw new SimulationError('NOT_FOUND', `Goal object ${goal.objectId} does not exist.`)
    if (object.geometry.type !== 'cylinder' || object.movable !== true) {
      throw new SimulationError('CONFLICT', `Goal object ${goal.objectId} must be a movable cylinder to be tipped.`)
    }
    return
  }
  throw new SimulationError('INVALID_INPUT', 'goal.type is unsupported.')
}

export function validateScene(scene: SimulationScene): void {
  assertRecord(scene, 'scene')
  assertNoUnknownKeys(scene, ['robot', 'cameras', 'objects', 'grasp', 'goal'], 'scene')
  validateRobot(scene.robot)
  if (!Array.isArray(scene.cameras) || scene.cameras.length > 16) {
    throw new SimulationError('LIMIT_EXCEEDED', 'A scene may contain at most 16 cameras.')
  }
  if (!Array.isArray(scene.objects) || scene.objects.length > 128) {
    throw new SimulationError('LIMIT_EXCEEDED', 'A scene may contain at most 128 objects.')
  }
  scene.cameras.forEach((camera) => validateCamera(camera, scene.robot))
  scene.objects.forEach(validateSceneObject)
  if (scene.grasp !== undefined && scene.grasp !== null) {
    assertRecord(scene.grasp, 'scene.grasp')
    assertNoUnknownKeys(scene.grasp, ['objectId', 'endEffectorToObjectMatrix'], 'scene.grasp')
    validateId(scene.grasp.objectId, 'scene.grasp.objectId')
    validateMatrix4(scene.grasp.endEffectorToObjectMatrix, 'scene.grasp.endEffectorToObjectMatrix')
    const grasped = scene.objects.find((object) => object.id === scene.grasp?.objectId)
    if (!grasped) throw new SimulationError('NOT_FOUND', `Grasped object ${scene.grasp.objectId} does not exist.`)
    if (grasped.geometry.type === 'plane' || grasped.movable !== true) {
      throw new SimulationError('CONFLICT', `Grasped object ${scene.grasp.objectId} must remain movable and non-plane.`)
    }
    const expectedObjectMatrix = multiplyMatrices(
      computeForwardKinematics(scene.robot).endEffector.matrix,
      scene.grasp.endEffectorToObjectMatrix,
    )
    const actualObjectMatrix = transformMatrix(grasped.pose)
    const maximumPoseError = Math.max(
      ...expectedObjectMatrix.slice(0, 12).map((entry, index) => Math.abs(entry - actualObjectMatrix[index])),
    )
    if (maximumPoseError > GRASP_POSE_TOLERANCE) {
      throw new SimulationError(
        'INVALID_INPUT',
        `Grasped object ${scene.grasp.objectId} pose is inconsistent with its end-effector attachment.`,
        { objectId: scene.grasp.objectId, maximumPoseError },
      )
    }
  }
  if (scene.goal !== undefined && scene.goal !== null) validateSimulationGoal(scene.goal, scene)
  const ids = [scene.robot.id, ...scene.robot.joints.map((joint) => joint.id), ...scene.robot.links.map((link) => link.id), ...scene.cameras.map((camera) => camera.id), ...scene.objects.map((object) => object.id)]
  if (new Set(ids).size !== ids.length) throw new SimulationError('CONFLICT', 'Every scene entity ID must be unique.')
}

export function validateStoredState(value: unknown): value is SimulationState {
  try {
    assertRecord(value, 'state')
    assertNoUnknownKeys(value, ['schema', 'schemaVersion', 'revision', 'scene', 'history', 'snapshots', 'activity', 'phase', 'operation'], 'state')
    if (value.schema !== 'webmcp-robot-sim-state' || value.schemaVersion !== 1) return false
    assertFiniteNumber(value.revision, 'state.revision', 0, MAX_SIMULATION_REVISION)
    if (!Number.isInteger(value.revision)) return false
    if (value.phase !== 'build' && value.phase !== 'operate') return false
    if (value.phase === 'build') {
      if (value.operation !== null) return false
    } else {
      assertRecord(value.operation, 'state.operation')
      assertNoUnknownKeys(value.operation, ['trialId', 'startedAt', 'cameraId', 'gripper'], 'state.operation')
      validateId(value.operation.trialId, 'state.operation.trialId')
      assertString(value.operation.startedAt, 'state.operation.startedAt', 50)
      validateId(value.operation.cameraId, 'state.operation.cameraId')
      if (value.operation.gripper !== 'open' && value.operation.gripper !== 'closed') return false
    }
    validateScene(value.scene as SimulationScene)
    if (!isRecord(value.history) || !Array.isArray(value.history.undo) || !Array.isArray(value.history.redo)) return false
    assertNoUnknownKeys(value.history, ['undo', 'redo'], 'state.history')
    if (value.history.undo.length > 50 || value.history.redo.length > 50) return false
    for (const [stackName, frames] of [['undo', value.history.undo], ['redo', value.history.redo]] as const) {
      for (const [index, frame] of frames.entries()) {
        assertRecord(frame, `state.history.${stackName}[${index}]`)
        assertNoUnknownKeys(frame, ['revision', 'label', 'scene'], `state.history.${stackName}[${index}]`)
        assertFiniteNumber(frame.revision, `state.history.${stackName}[${index}].revision`, 0, MAX_SIMULATION_REVISION)
        if (!Number.isInteger(frame.revision)) return false
        assertString(frame.label, `state.history.${stackName}[${index}].label`, 100)
        validateScene(frame.scene as SimulationScene)
      }
    }
    if (!Array.isArray(value.snapshots) || !Array.isArray(value.activity)) return false
    if (value.snapshots.length > 30 || value.activity.length > 120) return false
    for (const [index, snapshot] of value.snapshots.entries()) {
      assertRecord(snapshot, `state.snapshots[${index}]`)
      assertNoUnknownKeys(snapshot, ['id', 'name', 'createdAt', 'sourceRevision', 'scene'], `state.snapshots[${index}]`)
      validateId(snapshot.id, `state.snapshots[${index}].id`)
      assertString(snapshot.name, `state.snapshots[${index}].name`, 80)
      assertString(snapshot.createdAt, `state.snapshots[${index}].createdAt`, 50)
      assertFiniteNumber(snapshot.sourceRevision, `state.snapshots[${index}].sourceRevision`, 0, MAX_SIMULATION_REVISION)
      if (!Number.isInteger(snapshot.sourceRevision)) return false
      validateScene(snapshot.scene as SimulationScene)
    }
    for (const [index, activity] of value.activity.entries()) {
      assertRecord(activity, `state.activity[${index}]`)
      assertNoUnknownKeys(activity, ['id', 'at', 'source', 'action', 'status', 'summary', 'revision', 'requestId'], `state.activity[${index}]`)
      validateId(activity.id, `state.activity[${index}].id`)
      assertString(activity.at, `state.activity[${index}].at`, 50)
      if (!['ui', 'webmcp', 'system'].includes(String(activity.source))) return false
      assertString(activity.action, `state.activity[${index}].action`, 100)
      if (!['ok', 'error', 'cancelled'].includes(String(activity.status))) return false
      assertString(activity.summary, `state.activity[${index}].summary`, 500)
      assertFiniteNumber(activity.revision, `state.activity[${index}].revision`, 0, MAX_SIMULATION_REVISION)
      if (!Number.isInteger(activity.revision)) return false
      if (activity.requestId !== undefined) validateId(activity.requestId, `state.activity[${index}].requestId`)
    }
    if (value.phase === 'operate' && !(value.scene as SimulationScene).cameras.some((camera) => camera.id === (value.operation as Record<string, unknown>).cameraId)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export function validateCommandEnvelope(value: unknown): asserts value is SimulationCommand {
  assertRecord(value, 'command')
  assertString(value.type, 'command.type', 64)
  if (value.expectedRevision !== undefined) {
    assertFiniteNumber(value.expectedRevision, 'command.expectedRevision', 0, MAX_SIMULATION_REVISION)
    if (!Number.isInteger(value.expectedRevision)) throw new SimulationError('INVALID_INPUT', 'expectedRevision must be an integer.')
  }
  if (value.requestId !== undefined) validateId(value.requestId, 'command.requestId')
}

export function validateJointPosition(joint: RobotJoint, value: number): void {
  const bound = joint.type === 'prismatic' ? 10 : 100000
  assertFiniteNumber(value, `position for ${joint.id}`, -bound, bound)
  if (joint.type === 'fixed' && value !== 0) {
    throw new SimulationError('INVALID_INPUT', `Fixed joint ${joint.id} cannot move.`)
  }
  if (joint.limits && (value < joint.limits.min || value > joint.limits.max)) {
    throw new SimulationError(
      'LIMIT_EXCEEDED',
      `${joint.id} target ${value} is outside [${joint.limits.min}, ${joint.limits.max}].`,
      { jointId: joint.id, value, limits: joint.limits },
    )
  }
}
