import { describe, expect, it } from 'vitest'
import {
  cloneSerializable,
  computeForwardKinematics,
  createDefaultSimulationState,
  createSimulationStore,
  cylinderTiltDeg,
  evaluateSimulationGoal,
  SimulationError,
  type SimulationCommand,
  validateScene,
} from './index'

function addPayloadAtTool(
  store: ReturnType<typeof createSimulationStore>,
  objectId = 'payload',
): void {
  const endEffector = store.getComputedState().endEffector.positionM
  store.dispatch({
    type: 'edit_scene_objects',
    operations: [{
      action: 'add',
      object: {
        id: objectId,
        name: 'Payload',
        movable: true,
        color: '#fb7185',
        pose: { positionM: [...endEffector], rotationDeg: [5, 10, 15] },
        geometry: { type: 'sphere', radiusM: 0.02 },
      },
    }],
  })
}

describe('agent construction and kinematic manipulation', () => {
  it('atomically creates a provenance-safe custom robot and clears dangling link cameras', () => {
    const store = createSimulationStore({ storage: null })
    const result = store.dispatch({
      type: 'create_custom_robot',
      name: 'Agent delta test arm',
      keepObjects: true,
      keepWorldCameras: true,
      segments: [
        {
          joint: { id: 'custom-yaw', name: 'Yaw', type: 'revolute', axis: [0, 0, 1], origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0, limits: { min: -180, max: 180 } },
          link: { id: 'custom-upper', name: 'Upper', lengthM: 0.2, radiusM: 0.02, color: '#74aee0', direction: [1, 0, 0] },
        },
        {
          joint: { id: 'custom-elbow', name: 'Elbow', type: 'prismatic', axis: [1, 0, 0], origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0.02, limits: { min: 0, max: 0.1 } },
          link: { id: 'custom-tool', name: 'Tool', lengthM: 0.1, radiusM: 0.012, color: '#a8cfee', direction: [1, 0, 0] },
        },
      ],
    })
    const scene = store.getSnapshot().scene
    expect(result.revision).toBe(1)
    expect(scene.robot).toMatchObject({
      name: 'Agent delta test arm',
      // 0.30 m of rigid links plus the prismatic joint's 0.10 m extension.
      metadata: { accuracy: 'custom', nominalReachM: 0.4 },
    })
    expect(scene.robot.metadata.presetId).toBeUndefined()
    expect(scene.cameras).toEqual([])
    expect(scene.objects.some((object) => object.id === 'arm-101-can')).toBe(true)
  })

  it('uses the validated bound for an unbounded custom prismatic reach envelope', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({
      type: 'create_custom_robot',
      name: 'Unbounded slider',
      segments: [{
        joint: {
          name: 'Slide', type: 'prismatic', axis: [1, 0, 0],
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0,
        },
        link: { name: 'Tool', lengthM: 0.1, radiusM: 0.01, color: '#38bdf8', direction: [1, 0, 0] },
      }],
    })
    expect(store.getSnapshot().scene.robot.metadata.nominalReachM).toBe(10.1)
  })

  it('moves a generic 2R end effector to a reachable target and leaves unreachable attempts atomic', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({ type: 'load_robot_preset', presetId: 'generic-2r' })
    const targetRobot = cloneSerializable(store.getSnapshot().scene.robot)
    targetRobot.joints[0].position = 70
    targetRobot.joints[1].position = -85
    const targetPositionM = computeForwardKinematics(targetRobot).endEffector.positionM

    const moved = store.dispatch({ type: 'move_end_effector', targetPositionM, toleranceM: 0.001 })
    expect(moved.data).toMatchObject({ converged: true, collisionChecked: false, orientationConstrained: false })
    expect((moved.data?.residualM as number)).toBeLessThanOrEqual(0.001)

    const revision = store.getSnapshot().revision
    const sceneBefore = cloneSerializable(store.getSnapshot().scene)
    expect(() => store.dispatch({ type: 'move_end_effector', targetPositionM: [2, 0, 0], toleranceM: 0.001 }))
      .toThrowError(SimulationError)
    expect(store.getSnapshot().revision).toBe(revision)
    expect(store.getSnapshot().scene).toEqual(sceneBefore)
  })

  it('grasps without snapping, carries with the robot, releases frozen, and evaluates a delivery goal', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({ type: 'load_robot_preset', presetId: 'generic-2r' })
    const endEffector = store.getComputedState().endEffector.positionM
    store.dispatch({
      type: 'edit_scene_objects',
      operations: [{
        action: 'add',
        object: {
          id: 'payload', name: 'Payload', movable: true, color: '#fb7185',
          pose: { positionM: [endEffector[0] + 0.03, endEffector[1], endEffector[2]], rotationDeg: [5, 10, 15] },
          geometry: { type: 'box', sizeM: [0.04, 0.04, 0.04] },
        },
      }],
    })
    const poseBefore = cloneSerializable(store.getSnapshot().scene.objects.find((object) => object.id === 'payload')!.pose)
    store.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'payload', captureDistanceM: 0.04 })
    expect(store.getSnapshot().scene.objects.find((object) => object.id === 'payload')!.pose).toEqual(poseBefore)

    store.dispatch({ type: 'set_joint_positions', positions: [{ jointId: '2r-j1', value: 55 }] })
    const carriedPose = cloneSerializable(store.getSnapshot().scene.objects.find((object) => object.id === 'payload')!.pose)
    expect(carriedPose.positionM).not.toEqual(poseBefore.positionM)

    store.dispatch({ type: 'control_grasp', action: 'release' })
    store.dispatch({ type: 'set_joint_positions', positions: [{ jointId: '2r-j1', value: 5 }] })
    expect(store.getSnapshot().scene.objects.find((object) => object.id === 'payload')!.pose).toEqual(carriedPose)

    store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: { name: 'Deliver payload', type: 'object-at-position', objectId: 'payload', targetPositionM: carriedPose.positionM, toleranceM: 0.001 },
    })
    expect(evaluateSimulationGoal(store.getSnapshot().scene)).toMatchObject({ succeeded: true, type: 'object-at-position' })
    store.dispatch({ type: 'undo' })
    expect(store.getSnapshot().scene.goal).toBeNull()
    store.dispatch({ type: 'redo' })
    expect(store.getSnapshot().scene.goal?.name).toBe('Deliver payload')
  })

  it('tips an upright can with the Arm Alliance chain and derives success only after release', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({ type: 'load_robot_preset', presetId: 'arm-alliance' })
    store.dispatch({
      type: 'edit_scene_objects',
      operations: [{
        action: 'add',
        object: {
          id: 'demo-can', name: 'Demo can', movable: true, color: '#ef8354',
          pose: { positionM: [0.26, 0, 0.055], rotationDeg: [0, 0, 0] },
          geometry: { type: 'cylinder', radiusM: 0.032, heightM: 0.11 },
        },
      }],
    })
    store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: {
        name: 'Tip the can', type: 'object-tipped', objectId: 'demo-can',
        minimumTiltDeg: 80, requireReleased: true,
      },
    })
    expect(evaluateSimulationGoal(store.getSnapshot().scene)).toMatchObject({
      type: 'object-tipped', succeeded: false, tiltDeg: 0, released: true,
    })

    store.dispatch({ type: 'move_end_effector', targetPositionM: [0.228, 0, 0.055], toleranceM: 0.001 })
    store.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'demo-can', captureDistanceM: 0.005 })
    store.dispatch({ type: 'move_end_effector', targetPositionM: [0.228, 0, 0.064], toleranceM: 0.001 })
    const current = store.getSnapshot().scene.robot.joints.map((joint) => ({ jointId: joint.id, value: joint.position }))
    const tipped = current.map((target) => target.jointId === 'aa-camera' ? { ...target, value: 72 } : target)
    store.dispatch({
      type: 'run_joint_sequence',
      waypoints: [{ positions: current }, { positions: tipped, durationMs: 900 }],
    })

    const heldEvaluation = evaluateSimulationGoal(store.getSnapshot().scene)
    expect(heldEvaluation).toMatchObject({
      type: 'object-tipped', succeeded: false, released: false, minimumTiltDeg: 80,
    })
    if (heldEvaluation.type !== 'object-tipped') throw new Error('Expected a tipped-object evaluation.')
    expect(heldEvaluation.tiltDeg).toBeGreaterThan(89)
    const heldOptionalRelease = evaluateSimulationGoal({
      ...cloneSerializable(store.getSnapshot().scene),
      goal: {
        name: 'Tip without release', type: 'object-tipped', objectId: 'demo-can',
        minimumTiltDeg: 80, requireReleased: false,
      },
    })
    expect(heldOptionalRelease).toMatchObject({ type: 'object-tipped', succeeded: true, released: false })
    expect(heldOptionalRelease.summary).not.toContain('released')

    const release = store.dispatch({ type: 'control_grasp', action: 'release' })
    expect(release.data?.goalEvaluation).toMatchObject({
      type: 'object-tipped', succeeded: true, released: true,
    })
    const can = store.getSnapshot().scene.objects.find((object) => object.id === 'demo-can')!
    expect(cylinderTiltDeg(can)).toBeGreaterThan(89)
    expect(can.pose.positionM[2]).toBeCloseTo(0.032, 3)

    store.dispatch({ type: 'undo' })
    store.dispatch({ type: 'undo' })
    const restored = store.getSnapshot().scene.objects.find((object) => object.id === 'demo-can')!
    expect(cylinderTiltDeg(restored)).toBeLessThan(3)
    expect(evaluateSimulationGoal(store.getSnapshot().scene)).toMatchObject({ type: 'object-tipped', succeeded: false })
  })

  it('rejects far and fixed grasp attempts without changing the scene revision', () => {
    const store = createSimulationStore({ storage: null })
    const revision = store.getSnapshot().revision
    expect(() => store.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'arm-101-bench' })).toThrow(/not a movable/)
    expect(store.getSnapshot().revision).toBe(revision)
    expect(() => store.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'arm-101-can', captureDistanceM: 0.001 })).toThrow(/beyond/)
    expect(store.getSnapshot().revision).toBe(revision)
  })

  it('rejects non-rigid and pose-inconsistent grasp state during import', () => {
    const source = createSimulationStore({ storage: null })
    addPayloadAtTool(source)
    source.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'payload', captureDistanceM: 0.001 })
    const exported = JSON.parse(source.exportState()) as any

    const nonRigid = cloneSerializable(exported)
    nonRigid.scene.grasp.endEffectorToObjectMatrix[0] = 2
    expect(() => validateScene(nonRigid.scene)).toThrow(/orthonormal/)

    const reflected = cloneSerializable(exported)
    for (const index of [0, 1, 2]) {
      reflected.scene.grasp.endEffectorToObjectMatrix[index] *= -1
    }
    expect(() => validateScene(reflected.scene)).toThrow(/determinant must be \+1/)

    const recipient = createSimulationStore({ storage: null })
    const recipientBefore = cloneSerializable(recipient.getSnapshot())
    expect(() => recipient.importState(JSON.stringify(nonRigid))).toThrow(/does not match schema version 1/)
    expect(recipient.getSnapshot()).toEqual(recipientBefore)

    const inconsistent = cloneSerializable(exported)
    const payload = inconsistent.scene.objects.find((object: { id: string }) => object.id === 'payload')
    payload.pose.positionM[0] += 0.05
    expect(() => validateScene(inconsistent.scene)).toThrow(/inconsistent with its end-effector attachment/)
    expect(() => recipient.importState(JSON.stringify(inconsistent))).toThrow(/does not match schema version 1/)
    expect(recipient.getSnapshot()).toEqual(recipientBefore)
  })

  it('clears goals when referenced objects, cameras, links, or replacement scenes remove them', () => {
    const store = createSimulationStore({ storage: null })
    const target = store.getSnapshot().scene.objects.find((object) => object.id === 'arm-101-can')!
    store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: {
        name: 'Remove target cleanup', type: 'object-at-position', objectId: target.id,
        targetPositionM: target.pose.positionM, toleranceM: 0.01,
      },
    })
    store.dispatch({ type: 'edit_scene_objects', operations: [{ action: 'remove', objectId: target.id }] })
    expect(store.getSnapshot().scene.goal).toBeNull()

    const linkedCamera = store.getSnapshot().scene.cameras.find((camera) => camera.parent.type === 'link')
    expect(linkedCamera).toBeDefined()
    if (!linkedCamera || linkedCamera.parent.type !== 'link') throw new Error('Expected a link-mounted reference camera.')
    store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: {
        name: 'Link camera cleanup', type: 'camera-sees-object', cameraId: linkedCamera.id,
        objectId: 'arm-101-bench', minimumVisibility: 'partial',
      },
    })
    const linkedCameraParentId = linkedCamera.parent.linkId
    const linkedIndex = store.getSnapshot().scene.robot.links.findIndex((link) => link.id === linkedCameraParentId)
    store.dispatch({
      type: 'edit_robot_chain',
      operations: [{ action: 'remove', jointId: store.getSnapshot().scene.robot.joints[linkedIndex].id }],
    })
    expect(store.getSnapshot().scene.cameras.some((camera) => camera.id === linkedCamera.id)).toBe(false)
    expect(store.getSnapshot().scene.goal).toBeNull()

    const worldCameraResult = store.dispatch({
      type: 'configure_camera', action: 'add', parent: { type: 'world' }, cameraId: 'goal-camera',
    })
    expect(worldCameraResult.changedIds).toContain('goal-camera')
    store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: {
        name: 'World camera cleanup', type: 'camera-sees-object', cameraId: 'goal-camera',
        objectId: 'arm-101-bench', minimumVisibility: 'partial',
      },
    })
    store.dispatch({ type: 'configure_camera', action: 'remove', cameraId: 'goal-camera' })
    expect(store.getSnapshot().scene.goal).toBeNull()

    store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: {
        name: 'Replacement cleanup', type: 'object-at-position', objectId: 'arm-101-bench',
        targetPositionM: [0, 0, 0], toleranceM: 0.1,
      },
    })
    store.dispatch({
      type: 'create_custom_robot', name: 'Replacement robot', keepObjects: false,
      segments: [{
        joint: {
          name: 'Fixed root', type: 'fixed', axis: [0, 0, 1],
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, position: 0,
        },
        link: { name: 'Tool', lengthM: 0.1, radiusM: 0.01, color: '#74aee0', direction: [1, 0, 0] },
      }],
    })
    expect(store.getSnapshot().scene.objects).toEqual([])
    expect(store.getSnapshot().scene.goal).toBeNull()
  })

  it('restores a grasped snapshot coherently and continues carrying after restore', () => {
    const store = createSimulationStore({ storage: null })
    store.dispatch({ type: 'load_robot_preset', presetId: 'generic-2r' })
    addPayloadAtTool(store)
    store.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'payload', captureDistanceM: 0.001 })
    const savedScene = cloneSerializable(store.getSnapshot().scene)
    const saved = store.dispatch({ type: 'save_simulation_snapshot', name: 'Holding payload' })
    const snapshotId = saved.data?.snapshotId as string

    store.dispatch({ type: 'control_grasp', action: 'release' })
    store.dispatch({ type: 'set_joint_positions', positions: [{ jointId: '2r-j1', value: 5 }] })
    store.dispatch({ type: 'restore_simulation_snapshot', snapshotId })
    expect(store.getSnapshot().scene.grasp).toEqual(savedScene.grasp)
    expect(store.getSnapshot().scene.objects.find((object) => object.id === 'payload')?.pose)
      .toEqual(savedScene.objects.find((object) => object.id === 'payload')?.pose)

    const poseBeforeMove = cloneSerializable(store.getSnapshot().scene.objects.find((object) => object.id === 'payload')!.pose)
    store.dispatch({ type: 'set_joint_positions', positions: [{ jointId: '2r-j1', value: 55 }] })
    expect(store.getSnapshot().scene.objects.find((object) => object.id === 'payload')?.pose)
      .not.toEqual(poseBeforeMove)
  })

  it('round-trips grasp and goal state and migrates legacy movability conservatively', () => {
    const source = createSimulationStore({ storage: null })
    addPayloadAtTool(source)
    source.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'payload', captureDistanceM: 0.001 })
    source.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: { name: 'Hold payload', type: 'object-grasped', objectId: 'payload' },
    })

    const restored = createSimulationStore({ storage: null })
    restored.importState(source.exportState())
    expect(restored.getSnapshot().scene.grasp?.objectId).toBe('payload')
    expect(restored.getSnapshot().scene.goal).toEqual(source.getSnapshot().scene.goal)
    expect(evaluateSimulationGoal(restored.getSnapshot().scene)).toMatchObject({
      type: 'object-grasped', succeeded: true, graspedObjectId: 'payload',
    })

    const legacy = createDefaultSimulationState()
    legacy.scene.objects.forEach((object) => { delete object.movable })
    legacy.scene.objects.push({
      id: 'legacy-fixture', name: 'Legacy fixture', color: '#334455',
      pose: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] },
      geometry: { type: 'box', sizeM: [0.1, 0.1, 0.1] },
    })
    const migrated = createSimulationStore({ storage: null })
    migrated.importState(JSON.stringify(legacy))
    expect(migrated.getSnapshot().scene.objects.find((object) => object.id === 'arm-101-can')?.movable).toBe(true)
    expect(migrated.getSnapshot().scene.objects.find((object) => object.id === 'arm-101-bench')?.movable).toBe(false)
    expect(migrated.getSnapshot().scene.objects.find((object) => object.id === 'legacy-fixture')?.movable).toBe(false)
  })

  it('enforces action payloads and goal feasibility in the shared command executor', () => {
    const store = createSimulationStore({ storage: null })
    expect(() => store.dispatch({
      type: 'control_grasp', action: 'release', objectId: 'arm-101-can',
    } as unknown as SimulationCommand)).toThrow(/unsupported fields: objectId/)
    expect(() => store.dispatch({
      type: 'control_grasp', action: 'grab',
    } as unknown as SimulationCommand)).toThrow(/objectId must be a non-empty string/)
    expect(() => store.dispatch({
      type: 'set_simulation_goal', action: 'clear', goal: { name: 'Ignored', type: 'object-grasped', objectId: 'arm-101-can' },
    } as unknown as SimulationCommand)).toThrow(/unsupported fields: goal/)
    expect(() => store.dispatch({
      type: 'set_simulation_goal', action: 'set',
    } as unknown as SimulationCommand)).toThrow(/goal is required/)
    expect(() => store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: { name: 'Impossible grasp', type: 'object-grasped', objectId: 'arm-101-bench' },
    })).toThrow(/movable non-plane primitive/)
    expect(() => store.dispatch({
      type: 'set_simulation_goal', action: 'set',
      goal: {
        name: 'Outside workspace', type: 'end-effector-at-position',
        targetPositionM: [21, 0, 0], toleranceM: 0.01,
      },
    })).toThrow(/between -20 and 20/)
    expect(store.getSnapshot().revision).toBe(0)
  })
})
