import { describe, expect, it } from 'vitest'
import { createDefaultSimulationState, createSimulationStore, computeSceneKinematics, type SceneObject } from './index'
import { settleReleasedObject, verticalHalfExtent } from './settling'

describe('bounded release settling', () => {
  it.each([0, 30, 80, 90])('places a %s-degree cylinder on the actual bench without penetration', (tilt) => {
    const scene = createDefaultSimulationState().scene
    const can = scene.objects.find((object) => object.movable)!
    can.pose.positionM[2] = 0.4
    can.pose.rotationDeg = [0, tilt, 0]
    settleReleasedObject(scene, can.id)
    expect(can.pose.positionM[2]).toBeCloseTo(verticalHalfExtent(can), 9)
  })
  it('uses a raised horizontal support, ignores an overhead shelf, and falls to ground outside it', () => {
    const scene = createDefaultSimulationState().scene
    const can = scene.objects.find((object) => object.movable)!
    const bench = scene.objects[0]
    bench.pose.positionM[2] = 0.1
    can.pose.positionM[2] = 0.4
    scene.objects.push({ ...structuredClone(bench), id: 'overhead', pose: { positionM: [0.25, 0, 1], rotationDeg: [0, 0, 0] } })
    settleReleasedObject(scene, can.id)
    expect(can.pose.positionM[2]).toBeCloseTo(0.1125 + 0.06)
    can.pose.positionM = [3, 0, 0.4]
    settleReleasedObject(scene, can.id)
    expect(can.pose.positionM[2]).toBeCloseTo(0.06)
  })
  it('uses the same release path for human Build and trial outputs and records the settled pose', () => {
    for (const trial of [false, true]) {
      const store = createSimulationStore({ storage: null })
      const position = computeSceneKinematics(store.getSnapshot().scene).endEffector.positionM
      const payload: SceneObject = { id: 'payload', name: 'Payload', movable: true, color: '#fb7185', geometry: { type: 'sphere', radiusM: 0.02 }, pose: { positionM: position, rotationDeg: [0, 0, 0] } }
      store.dispatch({ type: 'edit_scene_objects', operations: [{ action: 'add', object: payload }] })
      if (trial) {
        store.dispatch({ type: 'begin_arm_trial', randomizeCan: false })
        store.dispatch({ type: 'set_arm_outputs', gripper: 'close' })
        expect(store.getSnapshot().scene.grasp?.objectId).toBe('payload')
        store.dispatch({ type: 'set_arm_outputs', gripper: 'open' })
        expect(store.getSnapshot().recordings[0].events.at(-1)?.frame?.scene.objects.find((item) => item.id === 'payload')?.pose.positionM[2]).toBeCloseTo(0.02)
      } else {
        store.dispatch({ type: 'control_grasp', action: 'grab', objectId: 'payload' })
        store.dispatch({ type: 'control_grasp', action: 'release' })
      }
      expect(store.getSnapshot().scene.objects.find((item) => item.id === 'payload')?.pose.positionM[2]).toBeCloseTo(0.02)
    }
  })
})
