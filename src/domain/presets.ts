import { cloneSerializable } from './math'
import type { CameraPreset, CameraSensor, RobotModel, RobotPreset, SceneObject, Transform, Vec3 } from './types'

const zeroPose = (): Transform => ({ positionM: [0, 0, 0], rotationDeg: [0, 0, 0] })

/** Default height of the robot's first joint above the Z=0 work surface. */
export const ROBOT_BASE_HEIGHT_M = 0.045

const mountedBasePose = (): Transform => ({
  positionM: [0, 0, ROBOT_BASE_HEIGHT_M],
  rotationDeg: [0, 0, 0],
})

function revolute(
  id: string,
  name: string,
  axis: Vec3,
  position = 0,
  limits = { min: -180, max: 180 },
) {
  return { id, name, type: 'revolute' as const, axis, origin: zeroPose(), position, limits }
}

function link(id: string, name: string, lengthM: number, radiusM: number, color: string, direction: Vec3) {
  return { id, name, lengthM, radiusM, color, direction }
}

export const CAMERA_PRESETS: readonly CameraPreset[] = Object.freeze([
  {
    id: 'generic-pinhole',
    name: 'Generic Pinhole Camera',
    projection: {
      model: 'ideal-pinhole', widthPx: 1280, heightPx: 720,
      horizontalFovDeg: 70, verticalFovDeg: 43, nearM: 0.01, farM: 25,
    },
    note: 'Ideal pinhole/frustum reference; no distortion, exposure, focus, rolling shutter, depth, or sensor noise.',
  },
  {
    id: 'rpi-camera-module-3-standard',
    name: 'Raspberry Pi Camera Module 3 Standard',
    projection: {
      model: 'ideal-pinhole', widthPx: 4608, heightPx: 2592,
      horizontalFovDeg: 66, verticalFovDeg: 41, nearM: 0.01, farM: 25,
    },
    note: 'Native array and manufacturer nominal FOV; ideal pinhole only.',
  },
  {
    id: 'rpi-camera-module-3-wide',
    name: 'Raspberry Pi Camera Module 3 Wide',
    projection: {
      model: 'ideal-pinhole', widthPx: 4608, heightPx: 2592,
      horizontalFovDeg: 102, verticalFovDeg: 67, nearM: 0.01, farM: 25,
    },
    note: 'Native array and manufacturer nominal FOV; ideal pinhole only.',
  },
  {
    id: 'oak-d-lite-color',
    name: 'OAK-D Lite Color Camera',
    projection: {
      model: 'ideal-pinhole', widthPx: 1920, heightPx: 1080,
      horizontalFovDeg: 69, verticalFovDeg: 54, nearM: 0.01, farM: 25,
    },
    note: 'Simplified color-camera FOV reference; no stereo, depth, calibration, distortion, or neural inference.',
  },
])

const armAlliance: RobotModel = {
  id: 'robot-arm-alliance',
  name: 'Arm Alliance',
  basePose: mountedBasePose(),
  joints: [
    revolute('aa-base', 'Base', [0, 0, 1], 0, { min: -180, max: 180 }),
    revolute('aa-shoulder', 'Shoulder', [0, 1, 0], -35, { min: -90, max: 45 }),
    revolute('aa-elbow', 'Elbow', [0, 1, 0], 70, { min: -90, max: 135 }),
    revolute('aa-camera', 'Camera (auxiliary)', [0, 1, 0], -20, { min: -90, max: 90 }),
  ],
  links: [
    link('aa-base-pivot', 'Base pivot', 0.06, 0.035, '#67e8f9', [0, 0, 1]),
    link('aa-upper', 'Upper arm', 0.18, 0.022, '#22d3ee', [0, 0, 1]),
    link('aa-elbow-tip', 'Elbow to camera/tool tip', 0.22, 0.019, '#06b6d4', [0, 0, 1]),
    link('aa-camera-mount', 'Camera mount', 0, 0.024, '#a5f3fc', [1, 0, 0]),
  ],
  metadata: {
    presetId: 'arm-alliance',
    accuracy: 'exact-project-geometry',
    nominalReachM: 0.4,
    note: 'Verified project geometry: 60 mm base pivot, 180 mm upper arm, and 220 mm elbow-to-tip. Camera is auxiliary and does not add reach.',
  },
}

const armCamera: CameraSensor = {
  id: 'camera-arm-alliance-wide',
  name: 'Arm Alliance Camera Module 3 Wide',
  parent: { type: 'link', linkId: 'aa-camera-mount' },
  pose: zeroPose(),
  projection: cloneSerializable(CAMERA_PRESETS[2].projection),
  presetId: CAMERA_PRESETS[2].id,
  note: 'Ideal pinhole stand-in for the physical Camera Module 3 Wide; local +X is the optical forward axis.',
}

const arm101: RobotModel = {
  id: 'robot-arm-101',
  name: 'Arm 101',
  basePose: mountedBasePose(),
  joints: [
    revolute('a101-base', 'Base yaw', [0, 0, 1], 0, { min: -180, max: 180 }),
    revolute('a101-shoulder', 'Shoulder', [0, 1, 0], 80, { min: -90, max: 90 }),
    revolute('a101-elbow', 'Elbow', [0, 1, 0], -72, { min: -120, max: 120 }),
    revolute('a101-wrist', 'Wrist / gripper mount', [0, 1, 0], -8, { min: -90, max: 90 }),
  ],
  links: [
    link('a101-base-rise', 'Base column', 0.06, 0.035, '#475569', [0, 0, 1]),
    link('a101-upper', 'Upper arm', 0.18, 0.022, '#38bdf8', [0, 0, 1]),
    link('a101-forearm', 'Forearm', 0.20, 0.019, '#0ea5e9', [0, 0, 1]),
    link('a101-tool', 'Parallel gripper mount', 0.045, 0.024, '#cbd5e1', [1, 0, 0]),
  ],
  metadata: {
    presetId: 'arm-101',
    accuracy: 'synthetic-reference',
    nominalReachM: 0.425,
    note: 'A clear four-axis teaching arm with a wrist camera and gripper-ready tool flange. Primitive geometry and kinematic attachment only.',
  },
}

const arm101Camera: CameraSensor = {
  id: 'camera-arm-101-wide',
  name: 'Arm 101 Raspberry Pi Camera Module 3 Wide',
  parent: { type: 'link', linkId: 'a101-tool' },
  pose: { positionM: [0, 0, 0], rotationDeg: [0, 70, 0] },
  projection: cloneSerializable(CAMERA_PRESETS[2].projection),
  presetId: CAMERA_PRESETS[2].id,
  note: 'Ideal-pinhole stand-in for Camera Module 3 Wide. Mounted at the wrist and aimed toward the starter can.',
}

const arm101Objects: SceneObject[] = [
  {
    id: 'arm-101-bench', name: 'Bench', color: '#182231',
    pose: { positionM: [0.25, 0, -0.0125], rotationDeg: [0, 0, 0] },
    geometry: { type: 'box', sizeM: [0.9, 0.7, 0.025] },
    movable: false,
  },
  {
    id: 'arm-101-can', name: 'Can', color: '#fb7185',
    pose: { positionM: [0.34, 0.02, 0.06], rotationDeg: [0, 0, 0] },
    geometry: { type: 'cylinder', radiusM: 0.033, heightM: 0.12 },
    movable: true,
  },
]

const generic2R: RobotModel = {
  id: 'robot-generic-2r',
  name: 'Generic 2R Planar Arm',
  basePose: mountedBasePose(),
  joints: [
    revolute('2r-j1', 'Joint 1', [0, 0, 1], 25),
    revolute('2r-j2', 'Joint 2', [0, 0, 1], -50),
  ],
  links: [
    link('2r-l1', 'Link 1', 0.25, 0.02, '#8b5cf6', [1, 0, 0]),
    link('2r-l2', 'Link 2', 0.2, 0.018, '#a78bfa', [1, 0, 0]),
  ],
  metadata: {
    presetId: 'generic-2r', accuracy: 'synthetic-reference', nominalReachM: 0.45,
    note: 'Synthetic two-revolute-joint planar reference intended for learning and deterministic FK tests.',
  },
}

const openManipulator: RobotModel = {
  id: 'robot-openmanipulator-x-reference',
  name: 'OpenMANIPULATOR-X (simplified)',
  basePose: mountedBasePose(),
  joints: [
    revolute('omx-j1', 'Joint 1', [0, 0, 1], 0),
    revolute('omx-j2', 'Joint 2', [0, 1, 0], -35, { min: -117, max: 90 }),
    revolute('omx-j3', 'Joint 3', [0, 1, 0], 65, { min: -90, max: 68 }),
    revolute('omx-j4', 'Joint 4', [0, 1, 0], -35, { min: -103, max: 90 }),
  ],
  links: [
    link('omx-l1', 'Base rise', 0.077, 0.025, '#94a3b8', [0, 0, 1]),
    link('omx-l2', 'Shoulder link', 0.13, 0.018, '#60a5fa', [1, 0, 0]),
    link('omx-l3', 'Forearm link', 0.124, 0.016, '#3b82f6', [1, 0, 0]),
    link('omx-l4', 'Tool link', 0.049, 0.014, '#2563eb', [1, 0, 0]),
  ],
  metadata: {
    presetId: 'openmanipulator-x-simplified',
    sourceUrl: 'https://emanual.robotis.com/docs/en/platform/openmanipulator_x/specification/',
    license: 'Primitive geometry authored for this app; no vendor meshes included.',
    accuracy: 'simplified-reference', nominalReachM: 0.38,
    note: 'Simplified primitive serial-chain reference sized to the published 380 mm class envelope; not a calibrated or collision-faithful vendor model.',
  },
}

const cobot6Axis: RobotModel = {
  id: 'robot-cobot-6axis-850',
  name: '6-axis 850 mm Cobot Reference',
  basePose: mountedBasePose(),
  joints: [
    revolute('cobot-j1', 'Base', [0, 0, 1], 0, { min: -360, max: 360 }),
    revolute('cobot-j2', 'Shoulder', [0, 1, 0], -55, { min: -180, max: 180 }),
    revolute('cobot-j3', 'Elbow', [0, 1, 0], 105, { min: -180, max: 180 }),
    revolute('cobot-j4', 'Wrist 1', [1, 0, 0], -50, { min: -360, max: 360 }),
    revolute('cobot-j5', 'Wrist 2', [0, 1, 0], 0, { min: -360, max: 360 }),
    revolute('cobot-j6', 'Wrist 3', [1, 0, 0], 0, { min: -360, max: 360 }),
  ],
  links: [
    link('cobot-l1', 'Base column', 0.16, 0.055, '#d6d3d1', [0, 0, 1]),
    link('cobot-l2', 'Upper arm', 0.30, 0.045, '#f5f5f4', [1, 0, 0]),
    link('cobot-l3', 'Forearm', 0.27, 0.04, '#e7e5e4', [1, 0, 0]),
    link('cobot-l4', 'Wrist offset 1', 0.06, 0.032, '#a8a29e', [0, 0, 1]),
    link('cobot-l5', 'Wrist offset 2', 0.035, 0.028, '#78716c', [1, 0, 0]),
    link('cobot-l6', 'Tool flange', 0.025, 0.032, '#57534e', [1, 0, 0]),
  ],
  metadata: {
    presetId: 'cobot-6axis-850mm-simplified',
    license: 'Primitive geometry authored for this app; no third-party meshes included.',
    accuracy: 'simplified-reference', nominalReachM: 0.85,
    note: 'Illustrative six-axis collaborative-arm topology with an 850 mm summed envelope. Not a vendor model, calibrated unit, or dynamics simulation.',
  },
}

export const ROBOT_PRESETS: readonly RobotPreset[] = Object.freeze([
  {
    id: 'arm-101', name: 'Arm 101',
    description: 'One-click camera-and-gripper bench trial with an upright movable can.',
    robot: arm101, bundledCameras: [arm101Camera], bundledObjects: arm101Objects,
    bundledGoal: {
      name: 'Tip and release the can',
      type: 'object-tipped',
      objectId: 'arm-101-can',
      minimumTiltDeg: 60,
      requireReleased: true,
    },
  },
  {
    id: 'arm-alliance', name: 'Arm Alliance',
    description: 'Verified 60/180/220 mm desk camera-arm geometry with an auxiliary camera joint.',
    robot: armAlliance, bundledCameras: [armCamera],
  },
  {
    id: 'generic-2r', name: 'Generic 2R Planar Arm',
    description: 'Deterministic two-joint planar learning reference.', robot: generic2R,
  },
  {
    id: 'openmanipulator-x-simplified', name: 'OpenMANIPULATOR-X (simplified)',
    description: 'Primitive-only four-axis reference with a 380 mm class envelope.', robot: openManipulator,
  },
  {
    id: 'cobot-6axis-850mm-simplified', name: '6-axis 850 mm Cobot Reference',
    description: 'Primitive-only six-axis cobot topology with an 850 mm summed envelope.', robot: cobot6Axis,
  },
])

export function getRobotPreset(id: string): RobotPreset | undefined {
  const preset = ROBOT_PRESETS.find((candidate) => candidate.id === id)
  return preset ? cloneSerializable(preset) : undefined
}

export function getCameraPreset(id: string): CameraPreset | undefined {
  const preset = CAMERA_PRESETS.find((candidate) => candidate.id === id)
  return preset ? cloneSerializable(preset) : undefined
}
