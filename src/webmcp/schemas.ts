import { MAX_SIMULATION_REVISION } from '../domain'

const revisionFields = {
  expectedRevision: {
    type: 'integer', minimum: 0, maximum: MAX_SIMULATION_REVISION,
    description: 'Optional optimistic-concurrency guard. Use the latest revision returned by the most recent allowed read or mutation; a stale value rejects the entire mutation.',
  },
  requestId: {
    type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]*$',
    description: 'Page-session retry key cached for 100 successes; conflicting reuse is rejected while cached. After reload, import, or eviction, use expectedRevision.',
  },
} as const

const entityId = {
  type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]*$',
} as const

const vec3 = {
  type: 'array', minItems: 3, maxItems: 3,
  items: { type: 'number' },
  description: 'Exactly three finite numeric components. The containing field states whether these are XYZ metres, XYZ degrees, or an axis/direction.',
} as const

const workspaceVec3 = {
  type: 'array', minItems: 3, maxItems: 3,
  items: { type: 'number', minimum: -20, maximum: 20 },
  description: 'World-space [x, y, z] in metres, right-handed and Z-up.',
} as const

const transform = {
  type: 'object',
  description: 'Rigid pose using right-handed Z-up coordinates and XYZ Euler rotation.',
  properties: {
    positionM: { ...workspaceVec3, description: 'Local or world [x, y, z] translation in metres, limited to +/-20 m on each axis.' },
    rotationDeg: { ...vec3, description: 'XYZ Euler rotation in degrees.' },
  },
  required: ['positionM', 'rotationDeg'],
  additionalProperties: false,
} as const

const parent = {
  description: 'Attach to the world or to a current robot link ID.',
  oneOf: [
    { type: 'object', properties: { type: { const: 'world' } }, required: ['type'], additionalProperties: false },
    {
      type: 'object',
      properties: { type: { const: 'link' }, linkId: { type: 'string', minLength: 1, maxLength: 80 } },
      required: ['type', 'linkId'], additionalProperties: false,
    },
  ],
} as const

const projectionProperties = {
  model: { const: 'ideal-pinhole', description: 'Analytic ideal-pinhole projection; no lens or sensor effects.' },
  widthPx: { type: 'integer', minimum: 1, maximum: 16384, description: 'Reference image width in pixels.' },
  heightPx: { type: 'integer', minimum: 1, maximum: 16384, description: 'Reference image height in pixels.' },
  horizontalFovDeg: { type: 'number', minimum: 1, maximum: 179, description: 'Horizontal field of view in degrees.' },
  verticalFovDeg: { type: 'number', minimum: 1, maximum: 179, description: 'Vertical field of view in degrees.' },
  nearM: { type: 'number', exclusiveMinimum: 0, maximum: 1000, description: 'Near visibility plane in metres.' },
  farM: { type: 'number', exclusiveMinimum: 0, maximum: 10000, description: 'Far visibility plane in metres; must exceed nearM.' },
} as const

const limits = {
  type: 'object',
  description: 'Inclusive joint range in degrees for revolute joints or metres for prismatic joints.',
  properties: { min: { type: 'number' }, max: { type: 'number' } },
  required: ['min', 'max'],
  additionalProperties: false,
} as const

const jointFull = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    type: { enum: ['fixed', 'revolute', 'continuous', 'prismatic'] },
    axis: { ...vec3, description: 'Non-zero joint-frame motion axis [x, y, z]; it is normalized by the simulator.' },
    origin: { ...transform, description: 'Pose of this joint relative to the preceding link frame.' },
    position: { type: 'number', description: 'Initial angle in degrees for revolute/continuous, extension in metres for prismatic, or 0 for fixed.' },
    limits,
  },
  required: ['name', 'type', 'axis', 'origin', 'position'],
  additionalProperties: false,
} as const

const jointPatch = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    type: { enum: ['fixed', 'revolute', 'continuous', 'prismatic'] },
    axis: vec3,
    origin: transform,
    position: { type: 'number' },
    limits: { oneOf: [limits, { type: 'null' }] },
  },
  minProperties: 1,
  additionalProperties: false,
} as const

const linkProperties = {
  id: { type: 'string', minLength: 1, maxLength: 80 },
  name: { type: 'string', minLength: 1, maxLength: 100 },
  lengthM: { type: 'number', minimum: 0, maximum: 10, description: 'Primitive link length in metres.' },
  radiusM: { type: 'number', minimum: 0.001, maximum: 2, description: 'Rendered link radius in metres.' },
  color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
  direction: { ...vec3, description: 'Non-zero link-frame direction [x, y, z]. The link extends lengthM along its normalized direction.' },
} as const

const linkFull = {
  type: 'object', properties: linkProperties,
  required: ['name', 'lengthM', 'radiusM', 'color', 'direction'], additionalProperties: false,
} as const

const linkPatch = {
  type: 'object',
  properties: {
    name: linkProperties.name,
    lengthM: linkProperties.lengthM,
    radiusM: linkProperties.radiusM,
    color: linkProperties.color,
    direction: linkProperties.direction,
  },
  minProperties: 1, additionalProperties: false,
} as const

const geometry = {
  oneOf: [
    {
      type: 'object', properties: { type: { const: 'box' }, sizeM: vec3 },
      required: ['type', 'sizeM'], additionalProperties: false,
    },
    {
      type: 'object', properties: { type: { const: 'sphere' }, radiusM: { type: 'number', minimum: 0.001, maximum: 100 } },
      required: ['type', 'radiusM'], additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { const: 'cylinder' }, radiusM: { type: 'number', minimum: 0.001, maximum: 100 },
        heightM: { type: 'number', minimum: 0.001, maximum: 100 },
      },
      required: ['type', 'radiusM', 'heightM'], additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { const: 'plane' },
        sizeM: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: 0.001 } },
      },
      required: ['type', 'sizeM'], additionalProperties: false,
    },
  ],
} as const

const objectFull = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 80 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    pose: transform,
    geometry,
    color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
    movable: { type: 'boolean', default: true },
  },
  required: ['name', 'pose', 'geometry', 'color'], additionalProperties: false,
} as const

const objectPatch = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    pose: transform,
    geometry,
    color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
    movable: { type: 'boolean' },
  },
  minProperties: 1, additionalProperties: false,
} as const

const positionTarget = {
  type: 'object',
  properties: {
    jointId: { type: 'string', minLength: 1, maxLength: 80, description: 'ID of a joint on the active robot.' },
    value: { type: 'number', description: 'Degrees for revolute/continuous joints or metres for prismatic joints.' },
  },
  required: ['jointId', 'value'], additionalProperties: false,
} as const

const customRobotSegment = {
  type: 'object',
  properties: { joint: jointFull, link: linkFull },
  required: ['joint', 'link'],
  additionalProperties: false,
} as const

const positionMoveProperties = {
  targetPositionM: { ...workspaceVec3, description: 'Desired world-space XYZ position in metres. For move_grasped_object this targets the grasped object origin.' },
  toleranceM: { type: 'number', minimum: 0.0001, maximum: 0.05, default: 0.002, description: 'Maximum accepted position residual in metres. Failure leaves the scene unchanged.' },
  ...revisionFields,
} as const

const simulationGoal = {
  oneOf: [
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        type: { const: 'object-at-position' },
        objectId: entityId,
        targetPositionM: workspaceVec3,
        toleranceM: { type: 'number', minimum: 0.0001, maximum: 1 },
      },
      required: ['name', 'type', 'objectId', 'targetPositionM', 'toleranceM'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        type: { const: 'end-effector-at-position' },
        targetPositionM: workspaceVec3,
        toleranceM: { type: 'number', minimum: 0.0001, maximum: 1 },
      },
      required: ['name', 'type', 'targetPositionM', 'toleranceM'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        type: { const: 'camera-sees-object' },
        cameraId: entityId,
        objectId: entityId,
        minimumVisibility: { enum: ['partial', 'full'] },
      },
      required: ['name', 'type', 'cameraId', 'objectId', 'minimumVisibility'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        type: { const: 'object-grasped' },
        objectId: entityId,
      },
      required: ['name', 'type', 'objectId'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 100 },
        type: { const: 'object-tipped' },
        objectId: entityId,
        minimumTiltDeg: { type: 'number', minimum: 1, maximum: 90, default: 80 },
        requireReleased: { type: 'boolean', default: true },
      },
      required: ['name', 'type', 'objectId', 'minimumTiltDeg'],
      additionalProperties: false,
    },
  ],
} as const

export const WEBMCP_INPUT_SCHEMAS = Object.freeze({
  list_robotics_presets: {
    type: 'object',
    properties: {
      detailed: { type: 'boolean', default: false, description: 'Return joint lists, full camera projections, notes, capabilities, and limitations. Default false keeps discovery compact.' },
    },
    additionalProperties: false,
  },
  get_simulation_state: {
    type: 'object',
    properties: {
      includeVisibility: { type: 'boolean', default: false, description: 'Include analytic per-camera object visibility. Opt in because it can be large.' },
      includeActivity: { type: 'boolean', default: false, description: 'Include up to 20 recent visible human, WebMCP, and system activity entries.' },
      detailed: { type: 'boolean', default: false, description: 'Include full robot/link modeling data, camera configuration, grasp transform, and snapshot records. Default false returns the compact action state.' },
    },
    additionalProperties: false,
  },
  load_robot_preset: {
    type: 'object',
    properties: {
      presetId: { type: 'string', enum: ['arm-101', 'arm-alliance', 'generic-2r', 'openmanipulator-x-simplified', 'cobot-6axis-850mm-simplified'] },
      keepObjects: { type: 'boolean', default: false }, ...revisionFields,
    },
    required: ['presetId'], additionalProperties: false,
  },
  create_custom_robot: {
    type: 'object',
    properties: {
      robotId: entityId,
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'Human-readable custom robot name.' },
      basePose: { ...transform, description: 'Optional robot base pose in world coordinates. Defaults to [0, 0, 0.045] m so the root clears the Z=0 work surface.' },
      segments: { type: 'array', minItems: 1, maxItems: 8, items: customRobotSegment, description: 'Ordered serial chain. Each joint is followed by exactly one rendered link.' },
      keepObjects: { type: 'boolean', default: true, description: 'Retain current scene objects while replacing the robot.' },
      keepWorldCameras: { type: 'boolean', default: true, description: 'Retain world-attached cameras; link-attached cameras are removed with the old robot.' },
      ...revisionFields,
    },
    required: ['name', 'segments'], additionalProperties: false,
  },
  edit_robot_chain: {
    type: 'object',
    properties: {
      operations: {
        type: 'array', minItems: 1, maxItems: 16,
        items: {
          oneOf: [
            {
              type: 'object',
              properties: { action: { const: 'add' }, index: { type: 'integer', minimum: 0, maximum: 8 }, joint: jointFull, link: linkFull },
              required: ['action', 'joint', 'link'], additionalProperties: false,
            },
            {
              type: 'object',
              properties: { action: { const: 'update' }, jointId: { type: 'string' }, joint: jointPatch, link: linkPatch },
              required: ['action', 'jointId'], anyOf: [{ required: ['joint'] }, { required: ['link'] }], additionalProperties: false,
            },
            {
              type: 'object', properties: { action: { const: 'remove' }, jointId: { type: 'string' } },
              required: ['action', 'jointId'], additionalProperties: false,
            },
          ],
        },
      },
      ...revisionFields,
    },
    required: ['operations'], additionalProperties: false,
  },
  set_joint_positions: {
    type: 'object',
    properties: {
      positions: { type: 'array', minItems: 1, maxItems: 12, items: positionTarget },
      ...revisionFields,
    },
    required: ['positions'], additionalProperties: false,
  },
  configure_camera: {
    type: 'object',
    properties: {
      action: { enum: ['add', 'update', 'remove'], description: 'Add a new camera, update an existing camera, or remove one.' },
      cameraId: { type: 'string', minLength: 1, maxLength: 80, description: 'Existing camera ID for update/remove, or optional desired ID for add.' },
      presetId: { enum: ['generic-pinhole', 'rpi-camera-module-3-standard', 'rpi-camera-module-3-wide', 'oak-d-lite-color'], description: 'Optional reference projection. Add defaults to generic-pinhole.' },
      name: { type: 'string', minLength: 1, maxLength: 100, description: 'Human-readable camera name.' },
      parent,
      pose: { ...transform, description: 'Camera pose relative to its parent frame.' },
      projection: { type: 'object', properties: projectionProperties, minProperties: 1, additionalProperties: false, description: 'Partial ideal-pinhole projection override.' },
      ...revisionFields,
    },
    required: ['action'],
    oneOf: [
      { properties: { action: { const: 'add' } }, required: ['action'] },
      {
        properties: { action: { const: 'update' } }, required: ['action', 'cameraId'],
        anyOf: [{ required: ['presetId'] }, { required: ['name'] }, { required: ['parent'] }, { required: ['pose'] }, { required: ['projection'] }],
      },
      {
        properties: { action: { const: 'remove' } }, required: ['action', 'cameraId'],
        not: { anyOf: [{ required: ['presetId'] }, { required: ['name'] }, { required: ['parent'] }, { required: ['pose'] }, { required: ['projection'] }] },
      },
    ],
    additionalProperties: false,
  },
  edit_scene_objects: {
    type: 'object',
    properties: {
      operations: {
        type: 'array', minItems: 1, maxItems: 32,
        items: {
          oneOf: [
            {
              type: 'object', properties: { action: { const: 'add' }, object: objectFull },
              required: ['action', 'object'], additionalProperties: false,
            },
            {
              type: 'object', properties: { action: { const: 'update' }, objectId: { type: 'string' }, patch: objectPatch },
              required: ['action', 'objectId', 'patch'], additionalProperties: false,
            },
            {
              type: 'object', properties: { action: { const: 'remove' }, objectId: { type: 'string' } },
              required: ['action', 'objectId'], additionalProperties: false,
            },
          ],
        },
      },
      ...revisionFields,
    },
    required: ['operations'], additionalProperties: false,
  },
  move_end_effector: {
    type: 'object',
    properties: positionMoveProperties,
    required: ['targetPositionM'], additionalProperties: false,
  },
  control_grasp: {
    type: 'object',
    properties: {
      action: { enum: ['grab', 'release'] },
      objectId: entityId,
      captureDistanceM: { type: 'number', minimum: 0.001, maximum: 0.1, default: 0.04 },
      ...revisionFields,
    },
    required: ['action'],
    oneOf: [
      { properties: { action: { const: 'grab' } }, required: ['objectId'] },
      {
        properties: { action: { const: 'release' } },
        not: { anyOf: [{ required: ['objectId'] }, { required: ['captureDistanceM'] }] },
      },
    ],
    additionalProperties: false,
  },
  move_grasped_object: {
    type: 'object',
    properties: positionMoveProperties,
    required: ['targetPositionM'], additionalProperties: false,
  },
  set_simulation_goal: {
    type: 'object',
    properties: {
      action: { enum: ['set', 'clear'] },
      goal: simulationGoal,
      ...revisionFields,
    },
    required: ['action'],
    oneOf: [
      { properties: { action: { const: 'set' } }, required: ['goal'] },
      { properties: { action: { const: 'clear' } }, not: { required: ['goal'] } },
    ],
    additionalProperties: false,
  },
  run_joint_sequence: {
    type: 'object',
    properties: {
      waypoints: {
        type: 'array', minItems: 2, maxItems: 64,
        items: {
          type: 'object',
          properties: {
            positions: { type: 'array', minItems: 1, maxItems: 12, items: positionTarget },
            durationMs: { type: 'number', minimum: 0, maximum: 60000 },
          },
          required: ['positions'], additionalProperties: false,
        },
      },
      includeAllSamples: { type: 'boolean', default: false, description: 'Return every waypoint sample. Default false returns at most five evenly spaced samples plus an omitted count.' },
      ...revisionFields,
    },
    required: ['waypoints'], additionalProperties: false,
  },
  begin_arm_trial: {
    type: 'object',
    properties: {
      seed: { type: 'integer', minimum: 0, maximum: 2147483647, description: 'Deterministic placement seed for repeatable tests.' },
      randomizeCan: { type: 'boolean', default: true, description: 'Place the starter can upright inside the reachable, camera-visible trial region.' },
      ...revisionFields,
    },
    additionalProperties: false,
  },
  observe_arm_camera: {
    type: 'object', properties: {}, additionalProperties: false,
  },
  get_arm_telemetry: {
    type: 'object', properties: {}, additionalProperties: false,
  },
  set_arm_outputs: {
    type: 'object',
    properties: {
      jointTargets: { type: 'array', minItems: 1, maxItems: 8, items: positionTarget, description: 'Bounded joint targets from the latest telemetry.' },
      gripper: { enum: ['open', 'close', 'unchanged'], description: 'Parallel gripper output. Closing captures only an eligible object inside the fixed jaw envelope.' },
      ...revisionFields,
    },
    anyOf: [{ required: ['jointTargets'] }, { required: ['gripper'] }],
    additionalProperties: false,
  },
  end_arm_trial: {
    type: 'object', properties: revisionFields, additionalProperties: false,
  },
  save_simulation_snapshot: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 }, ...revisionFields,
    },
    required: ['name'], additionalProperties: false,
  },
})
