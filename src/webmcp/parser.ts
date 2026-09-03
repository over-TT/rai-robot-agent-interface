import type {
  CameraParent,
  CameraProjection,
  CustomRobotSegment,
  RobotChainOperation,
  RobotJoint,
  RobotLink,
  SceneGeometry,
  SceneObject,
  SceneObjectOperation,
  SimulationCommand,
  SimulationGoal,
  Transform,
  Vec3,
} from '../domain'
import {
  assertFiniteNumber,
  assertNoUnknownKeys,
  assertRecord,
  assertString,
  MAX_SIMULATION_REVISION,
  SimulationError,
} from '../domain'

function optionalRevision(input: Record<string, unknown>) {
  const result: { expectedRevision?: number; requestId?: string } = {}
  if (input.expectedRevision !== undefined) {
    assertFiniteNumber(input.expectedRevision, 'expectedRevision', 0, MAX_SIMULATION_REVISION)
    if (!Number.isInteger(input.expectedRevision)) throw new SimulationError('INVALID_INPUT', 'expectedRevision must be an integer.')
    result.expectedRevision = input.expectedRevision
  }
  if (input.requestId !== undefined) {
    result.requestId = parseId(input.requestId, 'requestId')
  }
  return result
}

function parseId(value: unknown, label: string): string {
  assertString(value, label, 80)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
    throw new SimulationError('INVALID_INPUT', `${label} may contain only letters, numbers, dot, underscore, and dash.`)
  }
  return value
}

function booleanOrUndefined(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new SimulationError('INVALID_INPUT', `${label} must be a boolean.`)
  return value
}

function numberOrUndefined(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  assertFiniteNumber(value, label)
  return value
}

function stringOrUndefined(value: unknown, label: string, maxLength = 100): string | undefined {
  if (value === undefined) return undefined
  assertString(value, label, maxLength)
  return value
}

function parseVec3(value: unknown, label: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new SimulationError('INVALID_INPUT', `${label} must contain three numbers.`)
  value.forEach((component, index) => assertFiniteNumber(component, `${label}[${index}]`))
  return [...value] as Vec3
}

function parseWorkspaceVec3(value: unknown, label: string): Vec3 {
  const result = parseVec3(value, label)
  result.forEach((component, index) => assertFiniteNumber(component, `${label}[${index}]`, -20, 20))
  return result
}

function parseTransform(value: unknown, label: string): Transform {
  assertRecord(value, label)
  assertNoUnknownKeys(value, ['positionM', 'rotationDeg'], label)
  return { positionM: parseVec3(value.positionM, `${label}.positionM`), rotationDeg: parseVec3(value.rotationDeg, `${label}.rotationDeg`) }
}

function parseLimits(value: unknown, label: string) {
  if (value === undefined) return undefined
  assertRecord(value, label)
  assertNoUnknownKeys(value, ['min', 'max'], label)
  assertFiniteNumber(value.min, `${label}.min`)
  assertFiniteNumber(value.max, `${label}.max`)
  return { min: value.min, max: value.max }
}

type JointAddFields = Omit<RobotJoint, 'id'> & { id?: string }
type JointPatchFields = NonNullable<Extract<RobotChainOperation, { action: 'update' }>['joint']>

function parseJoint(value: unknown, partial: boolean): JointAddFields | JointPatchFields {
  assertRecord(value, 'joint')
  assertNoUnknownKeys(value, partial ? ['name', 'type', 'axis', 'origin', 'position', 'limits'] : ['id', 'name', 'type', 'axis', 'origin', 'position', 'limits'], 'joint')
  const result: Record<string, unknown> = {}
  if (!partial && value.id !== undefined) result.id = parseId(value.id, 'joint.id')
  if (value.name !== undefined) result.name = stringOrUndefined(value.name, 'joint.name')
  if (value.type !== undefined) {
    if (!['fixed', 'revolute', 'continuous', 'prismatic'].includes(String(value.type))) throw new SimulationError('INVALID_INPUT', 'joint.type is unsupported.')
    result.type = value.type
  }
  if (value.axis !== undefined) result.axis = parseVec3(value.axis, 'joint.axis')
  if (value.origin !== undefined) result.origin = parseTransform(value.origin, 'joint.origin')
  if (value.position !== undefined) result.position = numberOrUndefined(value.position, 'joint.position')
  if (value.limits !== undefined) {
    if (partial && value.limits === null) result.limits = null
    else result.limits = parseLimits(value.limits, 'joint.limits')
  }
  if (!partial) {
    for (const key of ['name', 'type', 'axis', 'origin', 'position']) {
      if (result[key] === undefined) throw new SimulationError('INVALID_INPUT', `joint.${key} is required.`)
    }
  } else if (Object.keys(result).length === 0) {
    throw new SimulationError('INVALID_INPUT', 'joint patch cannot be empty.')
  }
  return result as JointAddFields | JointPatchFields
}

function parseLink(value: unknown, partial: boolean): (Omit<RobotLink, 'id'> & { id?: string }) | Partial<Omit<RobotLink, 'id'>> {
  assertRecord(value, 'link')
  assertNoUnknownKeys(value, partial ? ['name', 'lengthM', 'radiusM', 'color', 'direction'] : ['id', 'name', 'lengthM', 'radiusM', 'color', 'direction'], 'link')
  const result: Record<string, unknown> = {}
  if (!partial && value.id !== undefined) result.id = parseId(value.id, 'link.id')
  if (value.name !== undefined) result.name = stringOrUndefined(value.name, 'link.name')
  if (value.lengthM !== undefined) result.lengthM = numberOrUndefined(value.lengthM, 'link.lengthM')
  if (value.radiusM !== undefined) result.radiusM = numberOrUndefined(value.radiusM, 'link.radiusM')
  if (value.color !== undefined) result.color = stringOrUndefined(value.color, 'link.color', 32)
  if (value.direction !== undefined) result.direction = parseVec3(value.direction, 'link.direction')
  if (!partial) {
    for (const key of ['name', 'lengthM', 'radiusM', 'color', 'direction']) {
      if (result[key] === undefined) throw new SimulationError('INVALID_INPUT', `link.${key} is required.`)
    }
  } else if (Object.keys(result).length === 0) {
    throw new SimulationError('INVALID_INPUT', 'link patch cannot be empty.')
  }
  return result as (Omit<RobotLink, 'id'> & { id?: string }) | Partial<Omit<RobotLink, 'id'>>
}

function parsePositionTargets(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new SimulationError('INVALID_INPUT', `${label} must contain 1 to 12 targets.`)
  return value.map((target, index) => {
    assertRecord(target, `${label}[${index}]`)
    assertNoUnknownKeys(target, ['jointId', 'value'], `${label}[${index}]`)
    assertString(target.jointId, `${label}[${index}].jointId`, 80)
    assertFiniteNumber(target.value, `${label}[${index}].value`)
    return { jointId: target.jointId, value: target.value }
  })
}

function parseParent(value: unknown): CameraParent {
  assertRecord(value, 'parent')
  if (value.type === 'world') {
    assertNoUnknownKeys(value, ['type'], 'parent')
    return { type: 'world' }
  }
  if (value.type === 'link') {
    assertNoUnknownKeys(value, ['type', 'linkId'], 'parent')
    assertString(value.linkId, 'parent.linkId', 80)
    return { type: 'link', linkId: value.linkId }
  }
  throw new SimulationError('INVALID_INPUT', 'parent.type must be world or link.')
}

function parseProjection(value: unknown): Partial<CameraProjection> {
  assertRecord(value, 'projection')
  assertNoUnknownKeys(value, ['model', 'widthPx', 'heightPx', 'horizontalFovDeg', 'verticalFovDeg', 'nearM', 'farM'], 'projection')
  const result: Partial<CameraProjection> = {}
  if (value.model !== undefined) {
    if (value.model !== 'ideal-pinhole') throw new SimulationError('INVALID_INPUT', 'projection.model must be ideal-pinhole.')
    result.model = value.model
  }
  for (const key of ['widthPx', 'heightPx', 'horizontalFovDeg', 'verticalFovDeg', 'nearM', 'farM'] as const) {
    const parsed = numberOrUndefined(value[key], `projection.${key}`)
    if (parsed !== undefined) result[key] = parsed
  }
  if (Object.keys(result).length === 0) throw new SimulationError('INVALID_INPUT', 'projection cannot be empty.')
  return result
}

function parseGeometry(value: unknown): SceneGeometry {
  assertRecord(value, 'geometry')
  if (value.type === 'box') {
    assertNoUnknownKeys(value, ['type', 'sizeM'], 'geometry')
    return { type: 'box', sizeM: parseVec3(value.sizeM, 'geometry.sizeM') }
  }
  if (value.type === 'sphere') {
    assertNoUnknownKeys(value, ['type', 'radiusM'], 'geometry')
    assertFiniteNumber(value.radiusM, 'geometry.radiusM')
    return { type: 'sphere', radiusM: value.radiusM }
  }
  if (value.type === 'cylinder') {
    assertNoUnknownKeys(value, ['type', 'radiusM', 'heightM'], 'geometry')
    assertFiniteNumber(value.radiusM, 'geometry.radiusM')
    assertFiniteNumber(value.heightM, 'geometry.heightM')
    return { type: 'cylinder', radiusM: value.radiusM, heightM: value.heightM }
  }
  if (value.type === 'plane') {
    assertNoUnknownKeys(value, ['type', 'sizeM'], 'geometry')
    if (!Array.isArray(value.sizeM) || value.sizeM.length !== 2) throw new SimulationError('INVALID_INPUT', 'geometry.sizeM must contain two numbers.')
    value.sizeM.forEach((component, index) => assertFiniteNumber(component, `geometry.sizeM[${index}]`))
    return { type: 'plane', sizeM: [value.sizeM[0] as number, value.sizeM[1] as number] }
  }
  throw new SimulationError('INVALID_INPUT', 'geometry.type is unsupported.')
}

function parseObjectFields(
  value: unknown,
  partial: boolean,
): (Omit<SceneObject, 'id'> & { id?: string }) | Partial<Omit<SceneObject, 'id'>> {
  assertRecord(value, partial ? 'patch' : 'object')
  assertNoUnknownKeys(value, partial ? ['name', 'pose', 'geometry', 'color', 'movable'] : ['id', 'name', 'pose', 'geometry', 'color', 'movable'], partial ? 'patch' : 'object')
  const result: Record<string, unknown> = {}
  if (!partial && value.id !== undefined) result.id = parseId(value.id, 'object.id')
  if (value.name !== undefined) result.name = stringOrUndefined(value.name, 'object.name')
  if (value.pose !== undefined) result.pose = parseTransform(value.pose, 'object.pose')
  if (value.geometry !== undefined) result.geometry = parseGeometry(value.geometry)
  if (value.color !== undefined) result.color = stringOrUndefined(value.color, 'object.color', 32)
  if (value.movable !== undefined) result.movable = booleanOrUndefined(value.movable, 'object.movable')
  if (!partial) {
    for (const key of ['name', 'pose', 'geometry', 'color']) {
      if (result[key] === undefined) throw new SimulationError('INVALID_INPUT', `object.${key} is required.`)
    }
  } else if (Object.keys(result).length === 0) throw new SimulationError('INVALID_INPUT', 'object patch cannot be empty.')
  return result as (Omit<SceneObject, 'id'> & { id?: string }) | Partial<Omit<SceneObject, 'id'>>
}

function parseMotionTarget(input: Record<string, unknown>) {
  const toleranceM = numberOrUndefined(input.toleranceM, 'toleranceM')
  if (toleranceM !== undefined) assertFiniteNumber(toleranceM, 'toleranceM', 0.0001, 0.05)
  return {
    targetPositionM: parseWorkspaceVec3(input.targetPositionM, 'targetPositionM'),
    ...(toleranceM !== undefined ? { toleranceM } : {}),
  }
}

function parseSimulationGoal(value: unknown): SimulationGoal {
  assertRecord(value, 'goal')
  assertString(value.name, 'goal.name', 100)
  if (value.type === 'object-at-position') {
    assertNoUnknownKeys(value, ['name', 'type', 'objectId', 'targetPositionM', 'toleranceM'], 'goal')
    const toleranceM = numberOrUndefined(value.toleranceM, 'goal.toleranceM')
    if (toleranceM === undefined) throw new SimulationError('INVALID_INPUT', 'goal.toleranceM is required.')
    assertFiniteNumber(toleranceM, 'goal.toleranceM', 0.0001, 1)
    return {
      name: value.name,
      type: value.type,
      objectId: parseId(value.objectId, 'goal.objectId'),
      targetPositionM: parseWorkspaceVec3(value.targetPositionM, 'goal.targetPositionM'),
      toleranceM,
    }
  }
  if (value.type === 'end-effector-at-position') {
    assertNoUnknownKeys(value, ['name', 'type', 'targetPositionM', 'toleranceM'], 'goal')
    const toleranceM = numberOrUndefined(value.toleranceM, 'goal.toleranceM')
    if (toleranceM === undefined) throw new SimulationError('INVALID_INPUT', 'goal.toleranceM is required.')
    assertFiniteNumber(toleranceM, 'goal.toleranceM', 0.0001, 1)
    return {
      name: value.name,
      type: value.type,
      targetPositionM: parseWorkspaceVec3(value.targetPositionM, 'goal.targetPositionM'),
      toleranceM,
    }
  }
  if (value.type === 'camera-sees-object') {
    assertNoUnknownKeys(value, ['name', 'type', 'cameraId', 'objectId', 'minimumVisibility'], 'goal')
    if (value.minimumVisibility !== 'partial' && value.minimumVisibility !== 'full') {
      throw new SimulationError('INVALID_INPUT', 'goal.minimumVisibility must be partial or full.')
    }
    return {
      name: value.name,
      type: value.type,
      cameraId: parseId(value.cameraId, 'goal.cameraId'),
      objectId: parseId(value.objectId, 'goal.objectId'),
      minimumVisibility: value.minimumVisibility,
    }
  }
  if (value.type === 'object-grasped') {
    assertNoUnknownKeys(value, ['name', 'type', 'objectId'], 'goal')
    return { name: value.name, type: value.type, objectId: parseId(value.objectId, 'goal.objectId') }
  }
  if (value.type === 'object-tipped') {
    assertNoUnknownKeys(value, ['name', 'type', 'objectId', 'minimumTiltDeg', 'requireReleased'], 'goal')
    assertFiniteNumber(value.minimumTiltDeg, 'goal.minimumTiltDeg', 1, 90)
    return {
      name: value.name,
      type: value.type,
      objectId: parseId(value.objectId, 'goal.objectId'),
      minimumTiltDeg: value.minimumTiltDeg,
      ...(value.requireReleased !== undefined
        ? { requireReleased: booleanOrUndefined(value.requireReleased, 'goal.requireReleased') }
        : {}),
    }
  }
  throw new SimulationError('INVALID_INPUT', 'goal.type is unsupported.')
}

export interface StateQueryInput { includeVisibility: boolean; includeActivity: boolean; detailed: boolean }

export function parseStateQuery(input: unknown): StateQueryInput {
  assertRecord(input, 'input')
  assertNoUnknownKeys(input, ['includeVisibility', 'includeActivity', 'detailed'], 'input')
  return {
    includeVisibility: booleanOrUndefined(input.includeVisibility, 'includeVisibility') ?? false,
    includeActivity: booleanOrUndefined(input.includeActivity, 'includeActivity') ?? false,
    detailed: booleanOrUndefined(input.detailed, 'detailed') ?? false,
  }
}

export function parseToolCommand(toolName: string, input: unknown): SimulationCommand {
  assertRecord(input, 'input')
  const revision = optionalRevision(input)
  if (toolName === 'load_robot_preset') {
    assertNoUnknownKeys(input, ['presetId', 'keepObjects', 'expectedRevision', 'requestId'], 'input')
    assertString(input.presetId, 'presetId', 80)
    return { type: 'load_robot_preset', presetId: input.presetId, keepObjects: booleanOrUndefined(input.keepObjects, 'keepObjects'), ...revision }
  }
  if (toolName === 'create_custom_robot') {
    assertNoUnknownKeys(input, ['robotId', 'name', 'basePose', 'segments', 'keepObjects', 'keepWorldCameras', 'expectedRevision', 'requestId'], 'input')
    assertString(input.name, 'name', 100)
    if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 8) {
      throw new SimulationError('INVALID_INPUT', 'segments must contain 1 to 8 joint/link pairs.')
    }
    const segments = input.segments.map((segment, index): CustomRobotSegment => {
      assertRecord(segment, `segments[${index}]`)
      assertNoUnknownKeys(segment, ['joint', 'link'], `segments[${index}]`)
      return {
        joint: parseJoint(segment.joint, false) as CustomRobotSegment['joint'],
        link: parseLink(segment.link, false) as CustomRobotSegment['link'],
      }
    })
    return {
      type: 'create_custom_robot',
      ...(input.robotId !== undefined ? { robotId: parseId(input.robotId, 'robotId') } : {}),
      name: input.name,
      ...(input.basePose !== undefined ? { basePose: parseTransform(input.basePose, 'basePose') } : {}),
      segments,
      ...(input.keepObjects !== undefined ? { keepObjects: booleanOrUndefined(input.keepObjects, 'keepObjects') } : {}),
      ...(input.keepWorldCameras !== undefined ? { keepWorldCameras: booleanOrUndefined(input.keepWorldCameras, 'keepWorldCameras') } : {}),
      ...revision,
    }
  }
  if (toolName === 'set_joint_positions') {
    assertNoUnknownKeys(input, ['positions', 'expectedRevision', 'requestId'], 'input')
    return { type: 'set_joint_positions', positions: parsePositionTargets(input.positions, 'positions'), ...revision }
  }
  if (toolName === 'edit_robot_chain') {
    assertNoUnknownKeys(input, ['operations', 'expectedRevision', 'requestId'], 'input')
    if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 16) throw new SimulationError('INVALID_INPUT', 'operations must contain 1 to 16 edits.')
    const operations = input.operations.map((value, index): RobotChainOperation => {
      assertRecord(value, `operations[${index}]`)
      if (value.action === 'add') {
        assertNoUnknownKeys(value, ['action', 'index', 'joint', 'link'], `operations[${index}]`)
        const addIndex = numberOrUndefined(value.index, `operations[${index}].index`)
        if (addIndex !== undefined && !Number.isInteger(addIndex)) throw new SimulationError('INVALID_INPUT', 'Add index must be an integer.')
        return { action: 'add', ...(addIndex !== undefined ? { index: addIndex } : {}), joint: parseJoint(value.joint, false) as JointAddFields, link: parseLink(value.link, false) as Omit<RobotLink, 'id'> & { id?: string } }
      }
      if (value.action === 'update') {
        assertNoUnknownKeys(value, ['action', 'jointId', 'joint', 'link'], `operations[${index}]`)
        assertString(value.jointId, `operations[${index}].jointId`, 80)
        if (value.joint === undefined && value.link === undefined) throw new SimulationError('INVALID_INPUT', 'Update requires joint or link.')
        return { action: 'update', jointId: value.jointId, ...(value.joint !== undefined ? { joint: parseJoint(value.joint, true) as JointPatchFields } : {}), ...(value.link !== undefined ? { link: parseLink(value.link, true) as Partial<Omit<RobotLink, 'id'>> } : {}) }
      }
      if (value.action === 'remove') {
        assertNoUnknownKeys(value, ['action', 'jointId'], `operations[${index}]`)
        assertString(value.jointId, `operations[${index}].jointId`, 80)
        return { action: 'remove', jointId: value.jointId }
      }
      throw new SimulationError('INVALID_INPUT', `operations[${index}].action is unsupported.`)
    })
    return { type: 'edit_robot_chain', operations, ...revision }
  }
  if (toolName === 'configure_camera') {
    assertNoUnknownKeys(input, ['action', 'cameraId', 'presetId', 'name', 'parent', 'pose', 'projection', 'expectedRevision', 'requestId'], 'input')
    if (!['add', 'update', 'remove'].includes(String(input.action))) throw new SimulationError('INVALID_INPUT', 'action must be add, update, or remove.')
    if (input.action === 'remove') {
      assertNoUnknownKeys(input, ['action', 'cameraId', 'expectedRevision', 'requestId'], 'input')
      return { type: 'configure_camera', action: 'remove', cameraId: parseId(input.cameraId, 'cameraId'), ...revision }
    }
    if (input.action === 'update') {
      parseId(input.cameraId, 'cameraId')
      if (['presetId', 'name', 'parent', 'pose', 'projection'].every((key) => input[key] === undefined)) {
        throw new SimulationError('INVALID_INPUT', 'Camera update requires at least one changed field.')
      }
    }
    return {
      type: 'configure_camera', action: input.action as 'add' | 'update' | 'remove',
      ...(input.cameraId !== undefined ? { cameraId: stringOrUndefined(input.cameraId, 'cameraId', 80) } : {}),
      ...(input.presetId !== undefined ? { presetId: stringOrUndefined(input.presetId, 'presetId', 80) } : {}),
      ...(input.name !== undefined ? { name: stringOrUndefined(input.name, 'name') } : {}),
      ...(input.parent !== undefined ? { parent: parseParent(input.parent) } : {}),
      ...(input.pose !== undefined ? { pose: parseTransform(input.pose, 'pose') } : {}),
      ...(input.projection !== undefined ? { projection: parseProjection(input.projection) } : {}),
      ...revision,
    }
  }
  if (toolName === 'edit_scene_objects') {
    assertNoUnknownKeys(input, ['operations', 'expectedRevision', 'requestId'], 'input')
    if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 32) throw new SimulationError('INVALID_INPUT', 'operations must contain 1 to 32 edits.')
    const operations = input.operations.map((value, index): SceneObjectOperation => {
      assertRecord(value, `operations[${index}]`)
      if (value.action === 'add') {
        assertNoUnknownKeys(value, ['action', 'object'], `operations[${index}]`)
        return { action: 'add', object: parseObjectFields(value.object, false) as Omit<SceneObject, 'id'> & { id?: string } }
      }
      if (value.action === 'update') {
        assertNoUnknownKeys(value, ['action', 'objectId', 'patch'], `operations[${index}]`)
        assertString(value.objectId, `operations[${index}].objectId`, 80)
        return { action: 'update', objectId: value.objectId, patch: parseObjectFields(value.patch, true) as Partial<Omit<SceneObject, 'id'>> }
      }
      if (value.action === 'remove') {
        assertNoUnknownKeys(value, ['action', 'objectId'], `operations[${index}]`)
        assertString(value.objectId, `operations[${index}].objectId`, 80)
        return { action: 'remove', objectId: value.objectId }
      }
      throw new SimulationError('INVALID_INPUT', `operations[${index}].action is unsupported.`)
    })
    return { type: 'edit_scene_objects', operations, ...revision }
  }
  if (toolName === 'move_end_effector' || toolName === 'move_grasped_object') {
    assertNoUnknownKeys(input, ['targetPositionM', 'toleranceM', 'expectedRevision', 'requestId'], 'input')
    return { type: toolName, ...parseMotionTarget(input), ...revision }
  }
  if (toolName === 'control_grasp') {
    if (input.action === 'grab') {
      assertNoUnknownKeys(input, ['action', 'objectId', 'captureDistanceM', 'expectedRevision', 'requestId'], 'input')
      const captureDistanceM = numberOrUndefined(input.captureDistanceM, 'captureDistanceM')
      if (captureDistanceM !== undefined) assertFiniteNumber(captureDistanceM, 'captureDistanceM', 0.001, 0.1)
      return {
        type: 'control_grasp', action: 'grab', objectId: parseId(input.objectId, 'objectId'),
        ...(captureDistanceM !== undefined ? { captureDistanceM } : {}), ...revision,
      }
    }
    if (input.action === 'release') {
      assertNoUnknownKeys(input, ['action', 'expectedRevision', 'requestId'], 'input')
      return { type: 'control_grasp', action: 'release', ...revision }
    }
    throw new SimulationError('INVALID_INPUT', 'action must be grab or release.')
  }
  if (toolName === 'set_simulation_goal') {
    if (input.action === 'set') {
      assertNoUnknownKeys(input, ['action', 'goal', 'expectedRevision', 'requestId'], 'input')
      return { type: 'set_simulation_goal', action: 'set', goal: parseSimulationGoal(input.goal), ...revision }
    }
    if (input.action === 'clear') {
      assertNoUnknownKeys(input, ['action', 'expectedRevision', 'requestId'], 'input')
      return { type: 'set_simulation_goal', action: 'clear', ...revision }
    }
    throw new SimulationError('INVALID_INPUT', 'action must be set or clear.')
  }
  if (toolName === 'run_joint_sequence') {
    assertNoUnknownKeys(input, ['waypoints', 'expectedRevision', 'requestId'], 'input')
    if (!Array.isArray(input.waypoints) || input.waypoints.length < 2 || input.waypoints.length > 64) throw new SimulationError('INVALID_INPUT', 'waypoints must contain 2 to 64 items.')
    const waypoints = input.waypoints.map((value, index) => {
      assertRecord(value, `waypoints[${index}]`)
      assertNoUnknownKeys(value, ['positions', 'durationMs'], `waypoints[${index}]`)
      const durationMs = numberOrUndefined(value.durationMs, `waypoints[${index}].durationMs`)
      return { positions: parsePositionTargets(value.positions, `waypoints[${index}].positions`), ...(durationMs !== undefined ? { durationMs } : {}) }
    })
    return { type: 'run_joint_sequence', waypoints, ...revision }
  }
  if (toolName === 'begin_arm_trial') {
    assertNoUnknownKeys(input, ['seed', 'randomizeCan', 'expectedRevision', 'requestId'], 'input')
    if (input.seed !== undefined) {
      assertFiniteNumber(input.seed, 'seed', 0, 0x7fff_ffff)
      if (!Number.isInteger(input.seed)) throw new SimulationError('INVALID_INPUT', 'seed must be an integer.')
    }
    return {
      type: 'begin_arm_trial',
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
      ...(input.randomizeCan !== undefined ? { randomizeCan: booleanOrUndefined(input.randomizeCan, 'randomizeCan') } : {}),
      ...revision,
    }
  }
  if (toolName === 'set_arm_outputs') {
    assertNoUnknownKeys(input, ['jointTargets', 'gripper', 'expectedRevision', 'requestId'], 'input')
    if (input.gripper !== undefined && !['open', 'close', 'unchanged'].includes(String(input.gripper))) {
      throw new SimulationError('INVALID_INPUT', 'gripper must be open, close, or unchanged.')
    }
    return {
      type: 'set_arm_outputs',
      ...(input.jointTargets !== undefined ? { jointTargets: parsePositionTargets(input.jointTargets, 'jointTargets') } : {}),
      ...(input.gripper !== undefined ? { gripper: input.gripper as 'open' | 'close' | 'unchanged' } : {}),
      ...revision,
    }
  }
  if (toolName === 'end_arm_trial') {
    assertNoUnknownKeys(input, ['expectedRevision', 'requestId'], 'input')
    return { type: 'end_arm_trial', ...revision }
  }
  if (toolName === 'save_simulation_snapshot') {
    assertNoUnknownKeys(input, ['name', 'expectedRevision', 'requestId'], 'input')
    assertString(input.name, 'name', 80)
    return { type: 'save_simulation_snapshot', name: input.name, ...revision }
  }
  throw new SimulationError('INVALID_INPUT', `No command parser exists for ${toolName}.`)
}
