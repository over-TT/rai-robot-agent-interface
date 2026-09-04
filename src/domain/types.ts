export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]
export type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

export type JointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic'
export type ActivitySource = 'ui' | 'webmcp' | 'system'

/** Euler angles are XYZ degrees. Distances are metres throughout the public API. */
export interface Transform {
  positionM: Vec3
  rotationDeg: Vec3
}

export interface JointLimit {
  min: number
  max: number
}

/** A serial joint followed by the link at the same array index. */
export interface RobotJoint {
  id: string
  name: string
  type: JointType
  axis: Vec3
  origin: Transform
  /** Degrees for revolute/continuous joints, metres for prismatic joints. */
  position: number
  /** Degrees for revolute joints, metres for prismatic joints. */
  limits?: JointLimit
}

export interface RobotLink {
  id: string
  name: string
  lengthM: number
  radiusM: number
  color: string
  /** Link direction in its joint's local frame. */
  direction: Vec3
}

export interface RobotMetadata {
  presetId?: string
  sourceUrl?: string
  license?: string
  accuracy: 'exact-project-geometry' | 'synthetic-reference' | 'simplified-reference' | 'custom'
  note: string
  nominalReachM?: number
}

export interface RobotModel {
  id: string
  name: string
  basePose: Transform
  joints: RobotJoint[]
  links: RobotLink[]
  metadata: RobotMetadata
}

export interface CameraProjection {
  model: 'ideal-pinhole'
  widthPx: number
  heightPx: number
  horizontalFovDeg: number
  verticalFovDeg: number
  nearM: number
  farM: number
}

export type CameraParent =
  | { type: 'world' }
  | { type: 'link'; linkId: string }

export interface CameraSensor {
  id: string
  name: string
  parent: CameraParent
  pose: Transform
  projection: CameraProjection
  presetId?: string
  note: string
}

export type SceneGeometry =
  | { type: 'box'; sizeM: Vec3 }
  | { type: 'sphere'; radiusM: number }
  | { type: 'cylinder'; radiusM: number; heightM: number }
  | { type: 'plane'; sizeM: [number, number] }

export interface SceneObject {
  id: string
  name: string
  pose: Transform
  geometry: SceneGeometry
  color: string
  /** Only movable non-plane primitives can be attached to the virtual tool. */
  movable?: boolean
}

export interface KinematicGrasp {
  objectId: string
  /** Rigid transform from the end-effector frame to the object frame. */
  endEffectorToObjectMatrix: Matrix4
}

export type SimulationGoal =
  | {
      name: string
      type: 'object-at-position'
      objectId: string
      targetPositionM: Vec3
      toleranceM: number
    }
  | {
      name: string
      type: 'end-effector-at-position'
      targetPositionM: Vec3
      toleranceM: number
    }
  | {
      name: string
      type: 'camera-sees-object'
      cameraId: string
      objectId: string
      minimumVisibility: 'partial' | 'full'
    }
  | {
      name: string
      type: 'object-grasped'
      objectId: string
    }
  | {
      name: string
      type: 'object-tipped'
      objectId: string
      minimumTiltDeg: number
      /** When true, a held object remains pending until the virtual tool releases it. */
      requireReleased?: boolean
    }

export type SimulationGoalEvaluation =
  | {
      type: 'none'
      succeeded: false
      summary: string
    }
  | {
      type: 'object-at-position' | 'end-effector-at-position'
      succeeded: boolean
      distanceM: number
      toleranceM: number
      targetPositionM: Vec3
      actualPositionM: Vec3
      summary: string
    }
  | {
      type: 'camera-sees-object'
      succeeded: boolean
      visibility: CameraVisibility['visibility']
      minimumVisibility: 'partial' | 'full'
      summary: string
    }
  | {
      type: 'object-grasped'
      succeeded: boolean
      graspedObjectId: string | null
      summary: string
    }
  | {
      type: 'object-tipped'
      succeeded: boolean
      objectId: string
      tiltDeg: number
      minimumTiltDeg: number
      released: boolean
      requireReleased: boolean
      summary: string
    }

export interface SimulationScene {
  robot: RobotModel
  cameras: CameraSensor[]
  objects: SceneObject[]
  /** One reversible rigid attachment; omitted in legacy v1 files. */
  grasp?: KinematicGrasp | null
  /** One visible objective; evaluation is always derived, never stored. */
  goal?: SimulationGoal | null
}

export interface HistoryFrame {
  revision: number
  label: string
  scene: SimulationScene
}

export interface SimulationSnapshot {
  id: string
  name: string
  createdAt: string
  sourceRevision: number
  scene: SimulationScene
}

export interface ActivityEntry {
  id: string
  at: string
  source: ActivitySource
  action: string
  status: 'ok' | 'error' | 'cancelled'
  summary: string
  revision: number
  requestId?: string
}

/** A renderable simulator checkpoint captured at a state-changing run event. */
export interface RecordedRunFrame {
  scene: SimulationScene
  gripperClosed: boolean
}

/** One visible activity entry positioned on the run's real wall-clock timeline. */
export interface RecordedRunEvent extends ActivityEntry {
  elapsedMs: number
  frame?: RecordedRunFrame
}

/** A bounded, locally persisted recording of one camera-guided agent run. */
export interface RecordedRun {
  id: string
  /** Captured trial camera, independent of later human camera selection. */
  cameraId?: string
  startedAt: string
  finishedAt?: string
  durationMs?: number
  events: RecordedRunEvent[]
}

export interface SimulationState {
  schema: 'webmcp-robot-sim-state'
  schemaVersion: 1
  revision: number
  scene: SimulationScene
  history: {
    undo: HistoryFrame[]
    redo: HistoryFrame[]
  }
  snapshots: SimulationSnapshot[]
  activity: ActivityEntry[]
  recordings: RecordedRun[]
  /** Build exposes scene-authoring tools; operate exposes only camera/telemetry/outputs. */
  phase: SimulationPhase
  operation: ArmOperationState | null
}

export type SimulationPhase = 'build' | 'operate'

export interface ArmOperationState {
  trialId: string
  startedAt: string
  cameraId: string
  gripper: 'open' | 'closed'
}

export interface WorldPose {
  positionM: Vec3
  quaternionXyzw: Quaternion
  matrix: Matrix4
}

export interface JointWorldFrame {
  jointId: string
  pose: WorldPose
}

export interface LinkWorldFrame {
  linkId: string
  startPose: WorldPose
  centerPose: WorldPose
  endPose: WorldPose
}

export interface CameraWorldFrame {
  cameraId: string
  pose: WorldPose
}

export interface ForwardKinematicsResult {
  joints: JointWorldFrame[]
  links: LinkWorldFrame[]
  cameras: CameraWorldFrame[]
  endEffector: WorldPose
}

export interface CameraVisibility {
  cameraId: string
  objectId: string
  visibility: 'full' | 'partial' | 'none'
  distanceM: number
  /** Clipped [left, top, right, bottom], in normalized image coordinates. */
  normalizedBounds: [number, number, number, number] | null
  centerNormalized: [number, number] | null
  reason?: 'behind-camera' | 'near-or-far-clipped' | 'outside-frustum'
}

export interface RobotPreset {
  id: string
  name: string
  description: string
  robot: RobotModel
  bundledCameras?: CameraSensor[]
  bundledObjects?: SceneObject[]
  bundledGoal?: SimulationGoal
}

export interface CameraPreset {
  id: string
  name: string
  projection: CameraProjection
  note: string
}

export interface CommandBase {
  expectedRevision?: number
  requestId?: string
}

export type RobotChainOperation =
  | {
      action: 'add'
      index?: number
      joint: Omit<RobotJoint, 'id'> & { id?: string }
      link: Omit<RobotLink, 'id'> & { id?: string }
    }
  | {
      action: 'update'
      jointId: string
      joint?: Partial<Omit<RobotJoint, 'id' | 'limits'>> & { limits?: JointLimit | null }
      link?: Partial<Omit<RobotLink, 'id'>>
    }
  | { action: 'remove'; jointId: string }

export type SceneObjectOperation =
  | { action: 'add'; object: Omit<SceneObject, 'id'> & { id?: string } }
  | { action: 'update'; objectId: string; patch: Partial<Omit<SceneObject, 'id'>> }
  | { action: 'remove'; objectId: string }

export interface CustomRobotSegment {
  joint: Omit<RobotJoint, 'id'> & { id?: string }
  link: Omit<RobotLink, 'id'> & { id?: string }
}

export type SimulationCommand =
  | ({ type: 'load_robot_preset'; presetId: string; keepObjects?: boolean } & CommandBase)
  | ({
      type: 'create_custom_robot'
      robotId?: string
      name: string
      basePose?: Transform
      segments: CustomRobotSegment[]
      keepObjects?: boolean
      keepWorldCameras?: boolean
    } & CommandBase)
  | ({ type: 'edit_robot_chain'; operations: RobotChainOperation[] } & CommandBase)
  | ({
      type: 'set_joint_positions'
      positions: Array<{ jointId: string; value: number }>
    } & CommandBase)
  | ({
      type: 'configure_camera'
      action: 'add' | 'update' | 'remove'
      cameraId?: string
      presetId?: string
      name?: string
      parent?: CameraParent
      pose?: Transform
      projection?: Partial<CameraProjection>
    } & CommandBase)
  | ({ type: 'edit_scene_objects'; operations: SceneObjectOperation[] } & CommandBase)
  | ({
      type: 'move_end_effector'
      targetPositionM: Vec3
      toleranceM?: number
    } & CommandBase)
  | ({
      type: 'control_grasp'
      action: 'grab'
      objectId: string
      captureDistanceM?: number
    } & CommandBase)
  | ({
      type: 'control_grasp'
      action: 'release'
    } & CommandBase)
  | ({
      type: 'move_grasped_object'
      targetPositionM: Vec3
      toleranceM?: number
    } & CommandBase)
  | ({
      type: 'set_simulation_goal'
      action: 'set'
      goal: SimulationGoal
    } & CommandBase)
  | ({
      type: 'set_simulation_goal'
      action: 'clear'
    } & CommandBase)
  | ({
      type: 'run_joint_sequence'
      waypoints: Array<{
        positions: Array<{ jointId: string; value: number }>
        durationMs?: number
      }>
    } & CommandBase)
  | ({ type: 'begin_arm_trial'; seed?: number; randomizeCan?: boolean } & CommandBase)
  | ({
      type: 'set_arm_outputs'
      jointTargets?: Array<{ jointId: string; value: number }>
      gripper?: 'open' | 'close' | 'unchanged'
    } & CommandBase)
  | ({ type: 'end_arm_trial' } & CommandBase)
  | ({ type: 'save_simulation_snapshot'; name: string } & CommandBase)
  | ({ type: 'restore_simulation_snapshot'; snapshotId: string } & CommandBase)
  | ({ type: 'undo' } & CommandBase)
  | ({ type: 'redo' } & CommandBase)

export interface CommandResult {
  ok: true
  revision: number
  changedIds: string[]
  warnings: string[]
  summary: string
  requestId?: string
  deduplicated?: boolean
  data?: Record<string, unknown>
}

export interface DispatchOptions {
  source?: ActivitySource
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
