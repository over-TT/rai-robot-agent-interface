import { computeForwardKinematics } from './kinematics'
import { solvePositionIk } from './ik'
import { cloneSerializable } from './math'
import { settleReleasedObject } from './settling'
import { getCameraPreset, getRobotPreset, ROBOT_BASE_HEIGHT_M } from './presets'
import {
  createKinematicGrasp,
  endEffectorToObjectSurfaceDistance,
  evaluateSimulationGoal,
  goalReferencesExist,
  graspedObjectControlPoint,
  syncGraspedObjectPose,
} from './tasks'
import type {
  CameraPreset,
  CameraSensor,
  CommandResult,
  CustomRobotSegment,
  RobotChainOperation,
  RobotJoint,
  RobotLink,
  RobotModel,
  SceneObject,
  SimulationCommand,
  SimulationScene,
  SimulationState,
  Transform,
} from './types'
import {
  assertFiniteNumber,
  assertNoUnknownKeys,
  assertString,
  nextSimulationRevision,
  SimulationError,
  validateCamera,
  validateCommandEnvelope,
  validateJointPosition,
  validateRobot,
  validateScene,
  validateSceneObject,
  validateSimulationGoal,
  validateTransform,
} from './validation'

const HISTORY_LIMIT = 50
const SNAPSHOT_LIMIT = 30
const UNLIMITED_PRISMATIC_BOUND_M = 10
export const ARM_GRIPPER_CAPTURE_DISTANCE_M = 0.045

function nextId(prefix: string, usedIds: Iterable<string>): string {
  const used = new Set(usedIds)
  let counter = 1
  while (used.has(`${prefix}-${counter}`)) counter += 1
  return `${prefix}-${counter}`
}

function allSceneIds(scene: SimulationScene): string[] {
  return [
    scene.robot.id,
    ...scene.robot.joints.map((joint) => joint.id),
    ...scene.robot.links.map((link) => link.id),
    ...scene.cameras.map((camera) => camera.id),
    ...scene.objects.map((object) => object.id),
  ]
}

function success(
  state: SimulationState,
  command: SimulationCommand,
  summary: string,
  changedIds: string[],
  warnings: string[] = [],
  data?: Record<string, unknown>,
): CommandResult {
  return {
    ok: true,
    revision: state.revision,
    changedIds: [...new Set(changedIds)],
    warnings,
    summary,
    ...(command.requestId ? { requestId: command.requestId } : {}),
    ...(data ? { data } : {}),
  }
}

function commitScene(
  previous: SimulationState,
  scene: SimulationScene,
  label: string,
): SimulationState {
  validateScene(scene)
  return {
    ...previous,
    revision: nextSimulationRevision(previous.revision),
    scene,
    history: {
      undo: [
        ...previous.history.undo,
        { revision: previous.revision, label, scene: cloneSerializable(previous.scene) },
      ].slice(-HISTORY_LIMIT),
      redo: [],
    },
  }
}

function requireJoint(scene: SimulationScene, jointId: string): { joint: RobotJoint; index: number } {
  const index = scene.robot.joints.findIndex((joint) => joint.id === jointId)
  if (index < 0) throw new SimulationError('NOT_FOUND', `Joint ${jointId} does not exist.`)
  return { joint: scene.robot.joints[index], index }
}

function applyPositionSet(
  robot: SimulationScene['robot'],
  positions: Array<{ jointId: string; value: number }>,
): string[] {
  if (!Array.isArray(positions) || positions.length < 1 || positions.length > 12) {
    throw new SimulationError('INVALID_INPUT', 'positions must contain between 1 and 12 targets.')
  }
  const ids = positions.map((target) => target.jointId)
  if (new Set(ids).size !== ids.length) throw new SimulationError('CONFLICT', 'Each joint may appear only once per target set.')
  const validated = positions.map((target) => {
    assertString(target.jointId, 'jointId', 80)
    const joint = robot.joints.find((candidate) => candidate.id === target.jointId)
    if (!joint) throw new SimulationError('NOT_FOUND', `Joint ${target.jointId} does not exist.`)
    validateJointPosition(joint, target.value)
    return { joint, value: target.value }
  })
  validated.forEach(({ joint, value }) => { joint.position = value })
  return ids
}

function isStructuralOrGeometryEdit(operation: RobotChainOperation): boolean {
  if (operation.action !== 'update') return true
  const jointKeys = operation.joint ? Object.keys(operation.joint) : []
  const linkKeys = operation.link ? Object.keys(operation.link) : []
  return jointKeys.some((key) => ['type', 'axis', 'origin', 'limits'].includes(key))
    || linkKeys.some((key) => ['lengthM', 'radiusM', 'direction'].includes(key))
}

function markRobotGeometryCustom(robot: RobotModel): void {
  delete robot.metadata.presetId
  delete robot.metadata.sourceUrl
  delete robot.metadata.license
  robot.metadata.accuracy = 'custom'
  robot.metadata.nominalReachM = reachEnvelopeM(robot.joints, robot.links)
  robot.metadata.note = 'Custom serial-chain geometry. Reach envelope is the conservative sum of link lengths and configured prismatic limits, or the validated 10 m bound when limits are omitted.'
}

function reachEnvelopeM(joints: RobotJoint[], links: RobotLink[]): number {
  const linkLengthM = links.reduce((total, link) => total + link.lengthM, 0)
  const prismaticExtensionM = joints.reduce((total, joint) => {
    if (joint.type !== 'prismatic') return total
    const extension = joint.limits
      ? Math.max(Math.abs(joint.limits.min), Math.abs(joint.limits.max))
      : UNLIMITED_PRISMATIC_BOUND_M
    return total + extension
  }, 0)
  return Number((linkLengthM + prismaticExtensionM).toFixed(6))
}

function applyCameraPreset(camera: CameraSensor, preset: CameraPreset): void {
  camera.projection = cloneSerializable(preset.projection)
  camera.presetId = preset.id
  camera.note = preset.note
}

function hasProjectionEdit(projection: Partial<CameraSensor['projection']> | undefined): boolean {
  return projection !== undefined && Object.keys(projection).length > 0
}

function markCameraProjectionCustom(camera: CameraSensor): void {
  delete camera.presetId
  camera.note = 'Custom ideal-pinhole projection; preset provenance was cleared after manual projection edits.'
}

function reconcileGoal(scene: SimulationScene, warnings: string[]): void {
  if (scene.goal && !goalReferencesExist(scene, scene.goal)) {
    warnings.push(`Cleared goal ${scene.goal.name} because one of its referenced entities was removed.`)
    scene.goal = null
  }
}

function buildCustomRobot(
  scene: SimulationScene,
  input: {
    robotId?: string
    name: string
    basePose?: Transform
    segments: CustomRobotSegment[]
    keepObjects?: boolean
    keepWorldCameras?: boolean
  },
): { scene: SimulationScene; warnings: string[] } {
  assertString(input.name, 'robot name', 100)
  if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 8) {
    throw new SimulationError('LIMIT_EXCEEDED', 'segments must contain between 1 and 8 joint/link pairs.')
  }
  if (input.basePose) validateTransform(input.basePose, 'basePose')
  const objects = input.keepObjects === false ? [] : cloneSerializable(scene.objects)
  const cameras = input.keepWorldCameras === false
    ? []
    : cloneSerializable(scene.cameras.filter((camera) => camera.parent.type === 'world'))
  const used = new Set<string>([
    ...objects.map((object) => object.id),
    ...cameras.map((camera) => camera.id),
  ])
  const robotId = input.robotId ?? nextId('custom-robot', used)
  used.add(robotId)
  const joints: RobotJoint[] = []
  const links: RobotLink[] = []
  input.segments.forEach((segment, index) => {
    const jointId = segment.joint.id ?? nextId(`joint-${index + 1}`, used)
    used.add(jointId)
    const linkId = segment.link.id ?? nextId(`link-${index + 1}`, used)
    used.add(linkId)
    joints.push({ ...cloneSerializable(segment.joint), id: jointId } as RobotJoint)
    links.push({ ...cloneSerializable(segment.link), id: linkId } as RobotLink)
  })
  const robot: RobotModel = {
    id: robotId,
    name: input.name.trim(),
    basePose: cloneSerializable(input.basePose ?? { positionM: [0, 0, ROBOT_BASE_HEIGHT_M], rotationDeg: [0, 0, 0] }),
    joints,
    links,
    metadata: {
      accuracy: 'custom',
      nominalReachM: reachEnvelopeM(joints, links),
      note: 'Custom agent-authored serial chain. Reach envelope includes configured prismatic limits, or the validated 10 m bound when limits are omitted. Browser kinematics only; no collision, dynamics, torque, or payload model.',
    },
  }
  validateRobot(robot)
  const nextScene: SimulationScene = {
    robot,
    cameras,
    objects,
    grasp: null,
    goal: cloneSerializable(scene.goal ?? null),
  }
  const warnings: string[] = []
  reconcileGoal(nextScene, warnings)
  return { scene: nextScene, warnings }
}

function validateIkTarget(targetPositionM: unknown, toleranceM: number | undefined): number {
  if (!Array.isArray(targetPositionM) || targetPositionM.length !== 3) {
    throw new SimulationError('INVALID_INPUT', 'targetPositionM must contain exactly three numbers.')
  }
  targetPositionM.forEach((value, index) => assertFiniteNumber(value, `targetPositionM[${index}]`, -20, 20))
  const tolerance = toleranceM ?? 0.002
  assertFiniteNumber(tolerance, 'toleranceM', 0.0001, 0.05)
  return tolerance
}

function moveControlPoint(
  state: SimulationState,
  command: Extract<SimulationCommand, { type: 'move_end_effector' | 'move_grasped_object' }>,
  controlPointM: [number, number, number],
  label: string,
) {
  const toleranceM = validateIkTarget(command.targetPositionM, command.toleranceM)
  const solution = solvePositionIk(state.scene.robot, command.targetPositionM, toleranceM, controlPointM)
  if (!solution.converged) {
    throw new SimulationError(
      'IK_DID_NOT_CONVERGE',
      `${label} did not converge; best residual was ${(solution.residualM * 1000).toFixed(2)} mm. The scene was not changed.`,
      { ...solution },
    )
  }
  const scene = cloneSerializable(state.scene)
  const changed = solution.jointPositions
    .filter((target, index) => Math.abs(target.value - scene.robot.joints[index].position) > 1e-9)
    .map((target) => target.jointId)
  solution.jointPositions.forEach((target, index) => { scene.robot.joints[index].position = target.value })
  const graspedObjectId = syncGraspedObjectPose(scene)
  if (graspedObjectId) changed.push(graspedObjectId)
  const next = commitScene(state, scene, label)
  return {
    state: next,
    result: success(next, command, `${label} converged with ${(solution.residualM * 1000).toFixed(2)} mm residual.`, changed, [
      'Position-only IK; orientation is unconstrained and collision/dynamics are not simulated.',
    ], { ...solution, goalEvaluation: evaluateSimulationGoal(scene) }),
  }
}

function editRobotChain(state: SimulationState, command: Extract<SimulationCommand, { type: 'edit_robot_chain' }>) {
  if (!Array.isArray(command.operations) || command.operations.length < 1 || command.operations.length > 16) {
    throw new SimulationError('INVALID_INPUT', 'operations must contain between 1 and 16 edits.')
  }
  const scene = cloneSerializable(state.scene)
  const changed: string[] = []
  const warnings: string[] = []
  const changesGeometry = command.operations.some(isStructuralOrGeometryEdit)
  if (scene.grasp && changesGeometry) {
    throw new SimulationError('CONFLICT', `Release ${scene.grasp.objectId} before changing robot structure or geometry.`)
  }

  for (const operation of command.operations) {
    if (operation.action === 'add') {
      if (scene.robot.joints.length >= 8) throw new SimulationError('LIMIT_EXCEEDED', 'A serial chain may contain at most 8 joints.')
      const used = allSceneIds(scene)
      const jointId = operation.joint.id ?? nextId('joint', used)
      const linkId = operation.link.id ?? nextId('link', [...used, jointId])
      const joint = { ...cloneSerializable(operation.joint), id: jointId } as RobotJoint
      const link = { ...cloneSerializable(operation.link), id: linkId } as RobotLink
      const index = operation.index ?? scene.robot.joints.length
      if (!Number.isInteger(index) || index < 0 || index > scene.robot.joints.length) {
        throw new SimulationError('INVALID_INPUT', 'Add index is outside the serial chain.')
      }
      scene.robot.joints.splice(index, 0, joint)
      scene.robot.links.splice(index, 0, link)
      changed.push(jointId, linkId)
    } else if (operation.action === 'update') {
      const { index, joint } = requireJoint(scene, operation.jointId)
      if (!operation.joint && !operation.link) {
        throw new SimulationError('INVALID_INPUT', 'An update needs a joint patch, a link patch, or both.')
      }
      if (operation.joint) {
        const jointPatch = cloneSerializable(operation.joint)
        if (jointPatch.limits === null) {
          delete joint.limits
          delete jointPatch.limits
        }
        Object.assign(joint, jointPatch)
      }
      if (operation.link) Object.assign(scene.robot.links[index], cloneSerializable(operation.link))
      changed.push(joint.id, scene.robot.links[index].id)
    } else if (operation.action === 'remove') {
      if (scene.robot.joints.length <= 1) throw new SimulationError('LIMIT_EXCEEDED', 'A robot must retain at least one joint.')
      const { index, joint } = requireJoint(scene, operation.jointId)
      const [removedLink] = scene.robot.links.splice(index, 1)
      scene.robot.joints.splice(index, 1)
      const removedCameras = scene.cameras.filter((camera) => camera.parent.type === 'link' && camera.parent.linkId === removedLink.id)
      scene.cameras = scene.cameras.filter((camera) => !removedCameras.includes(camera))
      if (removedCameras.length) warnings.push(`Removed ${removedCameras.length} camera(s) attached to ${removedLink.id}.`)
      changed.push(joint.id, removedLink.id, ...removedCameras.map((camera) => camera.id))
    } else {
      throw new SimulationError('INVALID_INPUT', 'Robot-chain action must be add, update, or remove.')
    }
  }
  if (changesGeometry) {
    markRobotGeometryCustom(scene.robot)
    changed.push(scene.robot.id)
    warnings.push('Robot geometry changed; preset provenance was cleared and nominal reach was recomputed.')
  }
  const graspedObjectId = syncGraspedObjectPose(scene)
  if (graspedObjectId) changed.push(graspedObjectId)
  reconcileGoal(scene, warnings)
  validateRobot(scene.robot)
  const next = commitScene(state, scene, 'Edit robot chain')
  return { state: next, result: success(next, command, `Applied ${command.operations.length} robot-chain edit(s).`, changed, warnings) }
}

function configureCamera(state: SimulationState, command: Extract<SimulationCommand, { type: 'configure_camera' }>) {
  const scene = cloneSerializable(state.scene)
  const warnings: string[] = []
  let camera: CameraSensor | undefined
  let changedId = command.cameraId
  if (command.action === 'remove') {
    assertString(command.cameraId, 'cameraId', 80)
    const index = scene.cameras.findIndex((candidate) => candidate.id === command.cameraId)
    if (index < 0) throw new SimulationError('NOT_FOUND', `Camera ${command.cameraId} does not exist.`)
    camera = scene.cameras.splice(index, 1)[0]
  } else if (command.action === 'add') {
    if (scene.cameras.length >= 16) throw new SimulationError('LIMIT_EXCEEDED', 'A scene may contain at most 16 cameras.')
    const preset = command.presetId ? getCameraPreset(command.presetId) : getCameraPreset('generic-pinhole')
    if (!preset) throw new SimulationError('NOT_FOUND', `Camera preset ${command.presetId} does not exist.`)
    changedId = command.cameraId ?? nextId('camera', allSceneIds(scene))
    camera = {
      id: changedId,
      name: command.name ?? preset.name,
      parent: command.parent ?? { type: 'link', linkId: scene.robot.links.at(-1)!.id },
      pose: command.pose ?? { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] },
      projection: cloneSerializable(preset.projection),
      presetId: preset.id,
      note: preset.note,
    }
    if (hasProjectionEdit(command.projection)) {
      camera.projection = { ...camera.projection, ...cloneSerializable(command.projection) }
      markCameraProjectionCustom(camera)
    }
    validateCamera(camera, scene.robot)
    scene.cameras.push(camera)
  } else if (command.action === 'update') {
    assertString(command.cameraId, 'cameraId', 80)
    const index = scene.cameras.findIndex((candidate) => candidate.id === command.cameraId)
    if (index < 0) throw new SimulationError('NOT_FOUND', `Camera ${command.cameraId} does not exist.`)
    camera = scene.cameras[index]
    if (command.presetId) {
      const preset = getCameraPreset(command.presetId)
      if (!preset) throw new SimulationError('NOT_FOUND', `Camera preset ${command.presetId} does not exist.`)
      applyCameraPreset(camera, preset)
    }
    if (command.name !== undefined) camera.name = command.name
    if (command.parent !== undefined) camera.parent = cloneSerializable(command.parent)
    if (command.pose !== undefined) camera.pose = cloneSerializable(command.pose)
    if (hasProjectionEdit(command.projection)) {
      camera.projection = { ...camera.projection, ...cloneSerializable(command.projection) }
      markCameraProjectionCustom(camera)
    }
    validateCamera(camera, scene.robot)
  } else {
    throw new SimulationError('INVALID_INPUT', 'Camera action must be add, update, or remove.')
  }
  reconcileGoal(scene, warnings)
  const next = commitScene(state, scene, `${command.action} camera`)
  return {
    state: next,
    result: success(next, command, `${command.action === 'remove' ? 'Removed' : 'Configured'} camera ${camera!.name}.`, [changedId!], warnings),
  }
}

function editSceneObjects(state: SimulationState, command: Extract<SimulationCommand, { type: 'edit_scene_objects' }>) {
  if (!Array.isArray(command.operations) || command.operations.length < 1 || command.operations.length > 32) {
    throw new SimulationError('INVALID_INPUT', 'operations must contain between 1 and 32 object edits.')
  }
  const scene = cloneSerializable(state.scene)
  const changed: string[] = []
  const warnings: string[] = []
  for (const operation of command.operations) {
    if (operation.action === 'add') {
      if (scene.objects.length >= 128) throw new SimulationError('LIMIT_EXCEEDED', 'A scene may contain at most 128 objects.')
      const source = cloneSerializable(operation.object)
      const object = {
        ...source,
        id: operation.object.id ?? nextId('object', allSceneIds(scene)),
        movable: source.movable ?? source.geometry.type !== 'plane',
      } as SceneObject
      validateSceneObject(object)
      scene.objects.push(object)
      changed.push(object.id)
    } else if (operation.action === 'update') {
      if (scene.grasp?.objectId === operation.objectId) {
        throw new SimulationError('CONFLICT', `Release ${operation.objectId} before editing its world object definition.`)
      }
      const object = scene.objects.find((candidate) => candidate.id === operation.objectId)
      if (!object) throw new SimulationError('NOT_FOUND', `Object ${operation.objectId} does not exist.`)
      Object.assign(object, cloneSerializable(operation.patch))
      validateSceneObject(object)
      changed.push(object.id)
    } else if (operation.action === 'remove') {
      if (scene.grasp?.objectId === operation.objectId) {
        throw new SimulationError('CONFLICT', `Release ${operation.objectId} before removing it.`)
      }
      const index = scene.objects.findIndex((candidate) => candidate.id === operation.objectId)
      if (index < 0) throw new SimulationError('NOT_FOUND', `Object ${operation.objectId} does not exist.`)
      changed.push(scene.objects.splice(index, 1)[0].id)
    } else {
      throw new SimulationError('INVALID_INPUT', 'Scene-object action must be add, update, or remove.')
    }
  }
  reconcileGoal(scene, warnings)
  const next = commitScene(state, scene, 'Edit scene objects')
  return { state: next, result: success(next, command, `Applied ${command.operations.length} scene-object edit(s).`, changed, warnings) }
}

function seededUnit(seed: number): number {
  let value = seed | 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  return (value >>> 0) / 0x1_0000_0000
}

function trialCan(scene: SimulationScene): SceneObject | undefined {
  return scene.objects.find((object) => (
    object.movable === true
    && object.geometry.type === 'cylinder'
    && object.name.toLowerCase().includes('can')
  )) ?? scene.objects.find((object) => object.movable === true && object.geometry.type === 'cylinder')
}

function randomizeTrialCan(scene: SimulationScene, seed: number): boolean {
  const can = trialCan(scene)
  if (!can || can.geometry.type !== 'cylinder') return false
  const xUnit = seededUnit(seed ^ 0x6d2b79f5)
  const yUnit = seededUnit(seed ^ 0x1b873593)
  can.pose = {
    positionM: [0.30 + xUnit * 0.08, -0.07 + yUnit * 0.14, can.geometry.heightM / 2],
    rotationDeg: [0, 0, 0],
  }
  return true
}

function operationCamera(scene: SimulationScene): CameraSensor | undefined {
  return scene.cameras.find((camera) => camera.presetId === 'rpi-camera-module-3-wide') ?? scene.cameras[0]
}

function nearestGraspableObject(scene: SimulationScene): SceneObject | undefined {
  return scene.objects
    .filter((object) => object.movable === true && object.geometry.type !== 'plane')
    .map((object) => ({ object, distanceM: endEffectorToObjectSurfaceDistance(scene, object) }))
    .filter(({ distanceM }) => distanceM <= ARM_GRIPPER_CAPTURE_DISTANCE_M)
    .sort((left, right) => left.distanceM - right.distanceM)[0]?.object
}

function requirePhase(current: SimulationState, command: SimulationCommand): void {
  const operateCommand = command.type === 'set_arm_outputs' || command.type === 'end_arm_trial'
  if (current.phase === 'operate' && !operateCommand) {
    throw new SimulationError(
      'PHASE_LOCKED',
      `${command.type} is unavailable during an arm trial. Use camera observation, arm telemetry, bounded arm outputs, or end the trial.`,
    )
  }
  if (current.phase === 'build' && operateCommand) {
    throw new SimulationError('CONFLICT', `${command.type} requires an active arm trial.`)
  }
  if (current.phase === 'operate' && command.type === 'begin_arm_trial') {
    throw new SimulationError('CONFLICT', 'An arm trial is already active.')
  }
}

export function executeSimulationCommand(
  current: SimulationState,
  command: SimulationCommand,
  now = new Date().toISOString(),
): { state: SimulationState; result: CommandResult } {
  validateCommandEnvelope(command)
  if (command.expectedRevision !== undefined && command.expectedRevision !== current.revision) {
    throw new SimulationError(
      'REVISION_CONFLICT',
      `Expected revision ${command.expectedRevision}, but current revision is ${current.revision}.`,
      { expectedRevision: command.expectedRevision, currentRevision: current.revision },
    )
  }
  requirePhase(current, command)

  if (command.type === 'begin_arm_trial') {
    const commandRecord = command as unknown as Record<string, unknown>
    assertNoUnknownKeys(commandRecord, ['type', 'seed', 'randomizeCan', 'expectedRevision', 'requestId'], 'begin_arm_trial command')
    const seed = command.seed ?? current.revision + 1
    assertFiniteNumber(seed, 'seed', 0, 0x7fff_ffff)
    if (!Number.isInteger(seed)) throw new SimulationError('INVALID_INPUT', 'seed must be an integer.')
    if (command.randomizeCan !== undefined && typeof command.randomizeCan !== 'boolean') {
      throw new SimulationError('INVALID_INPUT', 'randomizeCan must be a boolean.')
    }
    const camera = operationCamera(current.scene)
    if (!camera) throw new SimulationError('CONFLICT', 'An arm trial requires at least one configured camera.')
    const scene = cloneSerializable(current.scene)
    scene.grasp = null
    const randomized = command.randomizeCan !== false && randomizeTrialCan(scene, seed)
    const committed = commitScene(current, scene, 'Begin arm trial')
    const next: SimulationState = {
      ...committed,
      phase: 'operate',
      operation: {
        trialId: `arm-trial-${committed.revision}`,
        startedAt: now,
        cameraId: camera.id,
        gripper: 'open',
      },
    }
    return {
      state: next,
      result: success(next, command, `Trial started · camera ready${randomized ? ' · can placement randomized' : ''}.`, [], [
        'Camera observations contain rendered simulator images, not physical sensor data.',
      ], { phase: next.phase, trialId: next.operation!.trialId, gripper: { state: 'open', holding: false } }),
    }
  }

  if (command.type === 'set_arm_outputs') {
    const commandRecord = command as unknown as Record<string, unknown>
    assertNoUnknownKeys(commandRecord, ['type', 'jointTargets', 'gripper', 'expectedRevision', 'requestId'], 'set_arm_outputs command')
    if (command.gripper !== undefined && !['open', 'close', 'unchanged'].includes(command.gripper)) {
      throw new SimulationError('INVALID_INPUT', 'gripper must be open, close, or unchanged.')
    }
    const targets = command.jointTargets ?? []
    if (!Array.isArray(targets) || targets.length > 8) {
      throw new SimulationError('INVALID_INPUT', 'jointTargets must contain at most 8 targets.')
    }
    if (targets.length === 0 && (command.gripper === undefined || command.gripper === 'unchanged')) {
      throw new SimulationError('INVALID_INPUT', 'Provide at least one joint target or a gripper open/close output.')
    }
    const scene = cloneSerializable(current.scene)
    const changedJointIds = targets.length ? applyPositionSet(scene.robot, targets) : []
    syncGraspedObjectPose(scene)
    let gripperState = current.operation!.gripper
    if (command.gripper === 'open') {
      const releasedId = scene.grasp?.objectId
      scene.grasp = null
      if (releasedId) settleReleasedObject(scene, releasedId)
      gripperState = 'open'
    } else if (command.gripper === 'close') {
      if (!scene.grasp) {
        const object = nearestGraspableObject(scene)
        if (object) scene.grasp = createKinematicGrasp(scene, object.id, ARM_GRIPPER_CAPTURE_DISTANCE_M)
      }
      gripperState = 'closed'
    }
    const committed = commitScene(current, scene, 'Apply arm outputs')
    const next: SimulationState = {
      ...committed,
      operation: { ...current.operation!, gripper: gripperState },
    }
    const jointSummary = targets.map((target) => {
      const joint = scene.robot.joints.find((candidate) => candidate.id === target.jointId)!
      const suffix = joint.type === 'prismatic' ? ' m' : '°'
      return `${joint.name} ${Number(target.value.toFixed(4))}${suffix}`
    }).join(', ')
    const gripperSummary = command.gripper && command.gripper !== 'unchanged'
      ? `gripper ${gripperState}${scene.grasp ? ' (holding)' : ''}`
      : ''
    const outputSummary = jointSummary
      ? [`Set ${jointSummary}`, gripperSummary].filter(Boolean).join('; ')
      : `Set ${gripperSummary}`
    return {
      state: next,
      result: success(next, command, `${outputSummary}.`, changedJointIds, [
        'Kinematic joints and instant vertical release settling only; no motor torque, collision forces, friction, or grasp stability.',
      ], {
        phase: next.phase,
        appliedJointTargets: targets.map((target) => ({ jointId: target.jointId, value: target.value })),
        gripper: { state: gripperState, holding: Boolean(scene.grasp) },
      }),
    }
  }

  if (command.type === 'end_arm_trial') {
    const commandRecord = command as unknown as Record<string, unknown>
    assertNoUnknownKeys(commandRecord, ['type', 'expectedRevision', 'requestId'], 'end_arm_trial command')
    const next: SimulationState = {
      ...current,
      revision: nextSimulationRevision(current.revision),
      phase: 'build',
      operation: null,
    }
    return {
      state: next,
      result: success(next, command, 'Trial ended · build tools unlocked.', [], [], { phase: next.phase }),
    }
  }

  if (command.type === 'load_robot_preset') {
    if (current.scene.grasp) {
      throw new SimulationError('CONFLICT', `Release ${current.scene.grasp.objectId} before replacing the robot.`)
    }
    const preset = getRobotPreset(command.presetId)
    if (!preset) throw new SimulationError('NOT_FOUND', `Robot preset ${command.presetId} does not exist.`)
    const scene: SimulationScene = {
      robot: preset.robot,
      cameras: preset.bundledCameras ?? [],
      objects: command.keepObjects
        ? cloneSerializable(current.scene.objects)
        : cloneSerializable(preset.bundledObjects ?? []),
      grasp: null,
      goal: cloneSerializable(preset.bundledGoal ?? current.scene.goal ?? null),
    }
    const warnings: string[] = []
    reconcileGoal(scene, warnings)
    const next = commitScene(current, scene, `Load ${preset.name}`)
    return { state: next, result: success(next, command, `Loaded ${preset.name}.`, allSceneIds(scene), warnings) }
  }

  if (command.type === 'create_custom_robot') {
    if (current.scene.grasp) {
      throw new SimulationError('CONFLICT', `Release ${current.scene.grasp.objectId} before replacing the robot.`)
    }
    const custom = buildCustomRobot(current.scene, command)
    const scene = custom.scene
    const removedLinkCameras = current.scene.cameras.filter((camera) => camera.parent.type === 'link').length
    const warnings = [
      ...custom.warnings,
      ...(removedLinkCameras > 0
        ? [`Removed ${removedLinkCameras} link-mounted camera(s); attach cameras to the new robot explicitly.`]
        : []),
    ]
    const next = commitScene(current, scene, `Create ${scene.robot.name}`)
    return {
      state: next,
      result: success(next, command, `Created custom ${scene.robot.joints.length}-joint robot ${scene.robot.name}.`, allSceneIds(scene), warnings),
    }
  }

  if (command.type === 'edit_robot_chain') return editRobotChain(current, command)

  if (command.type === 'set_joint_positions') {
    const scene = cloneSerializable(current.scene)
    const changed = applyPositionSet(scene.robot, command.positions)
    const graspedObjectId = syncGraspedObjectPose(scene)
    if (graspedObjectId) changed.push(graspedObjectId)
    const next = commitScene(current, scene, 'Set joint positions')
    return {
      state: next,
      result: success(next, command, `Set ${command.positions.length} joint position(s).`, changed, [], {
        goalEvaluation: evaluateSimulationGoal(scene),
      }),
    }
  }

  if (command.type === 'configure_camera') return configureCamera(current, command)
  if (command.type === 'edit_scene_objects') return editSceneObjects(current, command)

  if (command.type === 'move_end_effector') {
    return moveControlPoint(current, command, [0, 0, 0], 'Move end effector')
  }

  if (command.type === 'control_grasp') {
    const commandRecord = command as unknown as Record<string, unknown>
    const scene = cloneSerializable(current.scene)
    if (command.action === 'grab') {
      assertNoUnknownKeys(
        commandRecord,
        ['type', 'action', 'objectId', 'captureDistanceM', 'expectedRevision', 'requestId'],
        'control_grasp command',
      )
      assertString(command.objectId, 'objectId', 80)
      const captureDistanceM = command.captureDistanceM ?? 0.04
      assertFiniteNumber(captureDistanceM, 'captureDistanceM', 0.001, 0.1)
      scene.grasp = createKinematicGrasp(scene, command.objectId, captureDistanceM)
      const next = commitScene(current, scene, `Grasp ${command.objectId}`)
      return {
        state: next,
        result: success(next, command, `Kinematically grasped ${command.objectId} without snapping it.`, [command.objectId], [
          'Virtual rigid attachment only; contact force, friction, payload, and grasp stability are not simulated.',
        ], { grasp: scene.grasp, goalEvaluation: evaluateSimulationGoal(scene) }),
      }
    }
    if (command.action === 'release') {
      assertNoUnknownKeys(
        commandRecord,
        ['type', 'action', 'expectedRevision', 'requestId'],
        'control_grasp command',
      )
      if (!scene.grasp) throw new SimulationError('CONFLICT', 'No object is currently grasped.')
      const objectId = scene.grasp.objectId
      scene.grasp = null
      settleReleasedObject(scene, objectId)
      const next = commitScene(current, scene, `Release ${objectId}`)
      return {
        state: next,
        result: success(next, command, `Released ${objectId}; settled vertically onto the support beneath it.`, [objectId], [
          'Instant support settling approximation only; no falling animation, friction, bounce, or angular dynamics.',
        ], { goalEvaluation: evaluateSimulationGoal(scene) }),
      }
    }
    throw new SimulationError('INVALID_INPUT', 'Grasp action must be grab or release.')
  }

  if (command.type === 'move_grasped_object') {
    return moveControlPoint(current, command, graspedObjectControlPoint(current.scene), 'Move grasped object')
  }

  if (command.type === 'set_simulation_goal') {
    const commandRecord = command as unknown as Record<string, unknown>
    const scene = cloneSerializable(current.scene)
    if (command.action === 'clear') {
      assertNoUnknownKeys(
        commandRecord,
        ['type', 'action', 'expectedRevision', 'requestId'],
        'set_simulation_goal command',
      )
      if (!scene.goal) throw new SimulationError('CONFLICT', 'No simulation goal is active.')
      const clearedName = scene.goal.name
      scene.goal = null
      const next = commitScene(current, scene, `Clear goal ${clearedName}`)
      return { state: next, result: success(next, command, `Cleared simulation goal ${clearedName}.`, []) }
    }
    if (command.action === 'set') {
      assertNoUnknownKeys(
        commandRecord,
        ['type', 'action', 'goal', 'expectedRevision', 'requestId'],
        'set_simulation_goal command',
      )
      if (!commandRecord.goal) throw new SimulationError('INVALID_INPUT', 'goal is required when action is set.')
      validateSimulationGoal(command.goal, scene)
      scene.goal = cloneSerializable(command.goal)
      const evaluation = evaluateSimulationGoal(scene)
      const next = commitScene(current, scene, `Set goal ${scene.goal.name}`)
      return {
        state: next,
        result: success(next, command, `Set simulation goal ${scene.goal.name}.`, [], [], { goal: scene.goal, evaluation }),
      }
    }
    throw new SimulationError('INVALID_INPUT', 'Goal action must be set or clear.')
  }

  if (command.type === 'run_joint_sequence') {
    if (!Array.isArray(command.waypoints) || command.waypoints.length < 2 || command.waypoints.length > 64) {
      throw new SimulationError('INVALID_INPUT', 'A sequence must contain between 2 and 64 waypoints.')
    }
    const scene = cloneSerializable(current.scene)
    const touched = new Set<string>()
    const samples = command.waypoints.map((waypoint, index) => {
      if (waypoint.durationMs !== undefined && (!Number.isFinite(waypoint.durationMs) || waypoint.durationMs < 0 || waypoint.durationMs > 60000)) {
        throw new SimulationError('INVALID_INPUT', `Waypoint ${index} durationMs must be between 0 and 60000.`)
      }
      applyPositionSet(scene.robot, waypoint.positions).forEach((id) => touched.add(id))
      const graspedObjectId = syncGraspedObjectPose(scene)
      if (graspedObjectId) touched.add(graspedObjectId)
      return {
        index,
        durationMs: waypoint.durationMs ?? 0,
        endEffectorPositionM: computeForwardKinematics(scene.robot).endEffector.positionM,
        ...(graspedObjectId ? {
          graspedObjectPositionM: scene.objects.find((object) => object.id === graspedObjectId)?.pose.positionM,
        } : {}),
      }
    })
    const next = commitScene(current, scene, 'Run joint sequence')
    const totalDurationMs = samples.reduce((sum, sample) => sum + sample.durationMs, 0)
    return {
      state: next,
      result: success(next, command, `Applied ${samples.length}-waypoint kinematic sequence.`, [...touched], [
        'Sequence timing is descriptive; this MVP applies the validated final pose without dynamics or physical motion.',
      ], { waypointCount: samples.length, totalDurationMs, samples, goalEvaluation: evaluateSimulationGoal(scene) }),
    }
  }

  if (command.type === 'save_simulation_snapshot') {
    assertString(command.name, 'snapshot name', 80)
    const snapshotId = nextId('snapshot', current.snapshots.map((snapshot) => snapshot.id))
    const next: SimulationState = {
      ...current,
      revision: nextSimulationRevision(current.revision),
      snapshots: [
        ...current.snapshots,
        {
          id: snapshotId,
          name: command.name.trim(),
          createdAt: now,
          sourceRevision: current.revision,
          scene: cloneSerializable(current.scene),
        },
      ].slice(-SNAPSHOT_LIMIT),
    }
    return { state: next, result: success(next, command, `Saved snapshot ${command.name.trim()}.`, [snapshotId], [], { snapshotId }) }
  }

  if (command.type === 'restore_simulation_snapshot') {
    const snapshot = current.snapshots.find((candidate) => candidate.id === command.snapshotId)
    if (!snapshot) throw new SimulationError('NOT_FOUND', `Snapshot ${command.snapshotId} does not exist.`)
    const next = commitScene(current, cloneSerializable(snapshot.scene), `Restore ${snapshot.name}`)
    return { state: next, result: success(next, command, `Restored snapshot ${snapshot.name}.`, allSceneIds(next.scene)) }
  }

  if (command.type === 'undo') {
    const frame = current.history.undo.at(-1)
    if (!frame) throw new SimulationError('NOTHING_TO_UNDO', 'There is no scene edit to undo.')
    const next: SimulationState = {
      ...current,
      revision: nextSimulationRevision(current.revision),
      scene: cloneSerializable(frame.scene),
      history: {
        undo: current.history.undo.slice(0, -1),
        redo: [
          ...current.history.redo,
          { revision: current.revision, label: frame.label, scene: cloneSerializable(current.scene) },
        ].slice(-HISTORY_LIMIT),
      },
    }
    return { state: next, result: success(next, command, `Undid: ${frame.label}.`, allSceneIds(next.scene)) }
  }

  if (command.type === 'redo') {
    const frame = current.history.redo.at(-1)
    if (!frame) throw new SimulationError('NOTHING_TO_REDO', 'There is no scene edit to redo.')
    const next: SimulationState = {
      ...current,
      revision: nextSimulationRevision(current.revision),
      scene: cloneSerializable(frame.scene),
      history: {
        undo: [
          ...current.history.undo,
          { revision: current.revision, label: frame.label, scene: cloneSerializable(current.scene) },
        ].slice(-HISTORY_LIMIT),
        redo: current.history.redo.slice(0, -1),
      },
    }
    return { state: next, result: success(next, command, `Redid: ${frame.label}.`, allSceneIds(next.scene)) }
  }

  throw new SimulationError('INVALID_INPUT', `Unsupported command type ${(command as { type: string }).type}.`)
}

export async function executeAsyncSimulationCommand(
  current: SimulationState,
  command: SimulationCommand,
  now = new Date().toISOString(),
): Promise<{ state: SimulationState; result: CommandResult }> {
  return executeSimulationCommand(current, command, now)
}
