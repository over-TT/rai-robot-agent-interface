import { describe, expect, it } from 'vitest'
import { createSimulationStore, cylinderTiltDeg, evaluateSimulationGoal } from '../domain'
import { createWebMcpToolDefinitions as definitions, WEBMCP_INPUT_SCHEMAS, WEBMCP_TOOL_NAMES } from './index'

// Fake image bytes test dispatch contracts only, never autonomous visual success.
const createWebMcpToolDefinitions = (store: ReturnType<typeof createSimulationStore>) => definitions(store, async (request) => ({ revision: request.revision, trialId: request.trialId, width: 640, height: 344, data: '/9j/AA==' }))

function signal() { return new AbortController().signal }

function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)])
}

describe('WebMCP arm tool definitions', () => {
  it('publishes an arm-only static catalog with strict schemas', () => {
    const tools = createWebMcpToolDefinitions(createSimulationStore({ storage: null }))
    expect(tools.map((tool) => tool.name)).toEqual([...WEBMCP_TOOL_NAMES])
    expect(tools).toHaveLength(19)
    expect(tools.map((tool) => tool.name).join(' ')).not.toMatch(/quadruped|gait/i)
    expect(Object.keys(WEBMCP_INPUT_SCHEMAS).join(' ')).not.toMatch(/quadruped|gait/i)
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.annotations).toHaveProperty('readOnlyHint')
    }
    expect(WEBMCP_INPUT_SCHEMAS.load_robot_preset.properties.presetId.enum).toContain('arm-101')
    expect(WEBMCP_INPUT_SCHEMAS.set_arm_outputs).toMatchObject({
      anyOf: [{ required: ['jointTargets'] }, { required: ['gripper'] }],
      additionalProperties: false,
    })
  })

  it('keeps detailed build functionality and serial-arm creation available', async () => {
    const store = createSimulationStore({ storage: null })
    const tools = new Map(createWebMcpToolDefinitions(store).map((tool) => [tool.name, tool]))
    const state = await tools.get('get_simulation_state')!.execute({ detailed: true }, { signal: signal() }) as Record<string, any>
    expect(state).toMatchObject({
      ok: true,
      phase: 'build',
      robot: { metadata: { presetId: 'arm-101' }, joints: expect.any(Array), links: expect.any(Array) },
      goal: { type: 'object-tipped', objectId: 'arm-101-can' },
    })

    const custom = await tools.get('create_custom_robot')!.execute({
      name: 'One joint arm', keepObjects: false, keepWorldCameras: false,
      segments: [{
        joint: {
          id: 'turn', name: 'Turn', type: 'revolute', axis: [0, 0, 1], position: 0,
          origin: { positionM: [0, 0, 0], rotationDeg: [0, 0, 0] }, limits: { min: -90, max: 90 },
        },
        link: { id: 'reach', name: 'Reach', lengthM: 0.2, radiusM: 0.02, color: '#22d3ee', direction: [1, 0, 0] },
      }],
    }, { signal: signal() }) as Record<string, any>
    expect(custom).toMatchObject({ ok: true, revision: 1 })
    expect(store.getSnapshot().scene.robot.joints).toHaveLength(1)
  })

  it('locks privileged reads and mutations atomically during operate phase', async () => {
    const store = createSimulationStore({ storage: null })
    const tools = new Map(createWebMcpToolDefinitions(store).map((tool) => [tool.name, tool]))
    const begin = await tools.get('begin_arm_trial')!.execute({ seed: 42, requestId: 'begin-42' }, { signal: signal() }) as Record<string, any>
    expect(begin).toMatchObject({ ok: true, revision: 1, requestId: 'begin-42', data: { phase: 'operate' } })
    const before = structuredClone(store.getSnapshot().scene)

    const read = await tools.get('get_simulation_state')!.execute({}, { signal: signal() }) as Record<string, any>
    const mutate = await tools.get('edit_scene_objects')!.execute({
      operations: [{ action: 'remove', objectId: 'arm-101-can' }],
    }, { signal: signal() }) as Record<string, any>
    expect(read).toMatchObject({ ok: false, revision: 1, error: { code: 'PHASE_LOCKED' } })
    expect(mutate).toMatchObject({ ok: false, revision: 1, error: { code: 'PHASE_LOCKED' } })
    expect(store.getSnapshot().scene).toEqual(before)
    expect(store.getSnapshot().revision).toBe(1)

    const end = await tools.get('end_arm_trial')!.execute({ expectedRevision: 1 }, { signal: signal() }) as Record<string, any>
    expect(end).toMatchObject({ ok: true, revision: 2, data: { phase: 'build' } })
  })

  it('supports observe -> output -> observe without exposing privileged world state', async () => {
    const store = createSimulationStore({ storage: null })
    const tools = new Map(createWebMcpToolDefinitions(store).map((tool) => [tool.name, tool]))
    await tools.get('begin_arm_trial')!.execute({ seed: 9 }, { signal: signal() })
    const first = await tools.get('observe_arm_camera')!.execute({}, { signal: signal() }) as Record<string, any>
    const telemetry = await tools.get('get_arm_telemetry')!.execute({}, { signal: signal() }) as Record<string, any>
    const output = await tools.get('set_arm_outputs')!.execute({
      expectedRevision: first.revision,
      jointTargets: [{ jointId: 'a101-base', value: 8 }],
      gripper: 'open',
      requestId: 'look-step-1',
    }, { signal: signal() }) as Record<string, any>
    const second = await tools.get('observe_arm_camera')!.execute({}, { signal: signal() }) as Record<string, any>

    expect(first).toMatchObject({ ok: true, phase: 'operate', content: [{ type: 'image', mimeType: 'image/jpeg', data: '/9j/AA==' }] })
    expect(first).not.toHaveProperty('detections')
    expect(telemetry).toMatchObject({
      ok: true, joints: expect.any(Array), gripper: { state: 'open', holding: false },
    })
    expect(output).toMatchObject({
      ok: true, revision: 2, requestId: 'look-step-1',
      data: { appliedJointTargets: [{ jointId: 'a101-base', value: 8 }], gripper: { state: 'open', holding: false } },
    })
    expect(second.revision).toBe(2)
    const privilegedKeys = ['positionM', 'worldPose', 'distanceM', 'objectId', 'endEffector', 'goal', 'targetPositionM', 'actualPositionM', 'matrix']
    expect(allKeys(first).filter((key) => privilegedKeys.includes(key))).toEqual([])
    expect(allKeys(telemetry).filter((key) => privilegedKeys.includes(key))).toEqual([])
    expect(allKeys(output).filter((key) => privilegedKeys.includes(key))).toEqual([])
  })

  it('regresses the deterministic grasp/rotate/release tool route with a mocked image provider', async () => {
    const store = createSimulationStore({ storage: null })
    const tools = new Map(createWebMcpToolDefinitions(store).map((tool) => [tool.name, tool]))
    await tools.get('begin_arm_trial')!.execute({ randomizeCan: false }, { signal: signal() })
    const firstObservation = await tools.get('observe_arm_camera')!.execute({}, { signal: signal() }) as Record<string, any>
    const telemetry = await tools.get('get_arm_telemetry')!.execute({}, { signal: signal() }) as Record<string, any>

    expect(firstObservation.content).toHaveLength(1)
    expect(telemetry.joints).toHaveLength(4)
    await tools.get('set_arm_outputs')!.execute({
      jointTargets: [
        { jointId: 'a101-base', value: 3.814038458379129 },
        { jointId: 'a101-shoulder', value: 53.02786896121302 },
        { jointId: 'a101-elbow', value: 70.16330764109397 },
        { jointId: 'a101-wrist', value: -19.583793099799696 },
      ],
    }, { signal: signal() })

    const close = await tools.get('set_arm_outputs')!.execute({ gripper: 'close' }, { signal: signal() }) as Record<string, any>
    expect(close).toMatchObject({ data: { gripper: { state: 'closed', holding: true } } })
    expect(close.summary).toContain('gripper closed (holding)')
    expect(close.data).not.toHaveProperty('grasp')
    expect(store.getSnapshot().scene.grasp?.objectId).toBe('arm-101-can')

    await tools.get('set_arm_outputs')!.execute({
      jointTargets: [{ jointId: 'a101-wrist', value: 60 }],
    }, { signal: signal() })
    const opened = await tools.get('set_arm_outputs')!.execute({ gripper: 'open' }, { signal: signal() }) as Record<string, any>
    await tools.get('set_arm_outputs')!.execute({
      jointTargets: [
        { jointId: 'a101-base', value: 60 },
        { jointId: 'a101-shoulder', value: 80 },
        { jointId: 'a101-elbow', value: -72 },
        { jointId: 'a101-wrist', value: 15 },
      ],
    }, { signal: signal() })
    const tippedObservation = await tools.get('observe_arm_camera')!.execute({}, { signal: signal() }) as Record<string, any>
    expect(tippedObservation.content[0].type).toBe('image')
    await tools.get('end_arm_trial')!.execute({}, { signal: signal() })
    const can = store.getSnapshot().scene.objects.find((object) => object.id === 'arm-101-can')!
    expect(opened).toMatchObject({ data: { gripper: { state: 'open', holding: false } } })
    expect(store.getSnapshot().scene.grasp).toBeNull()
    expect(cylinderTiltDeg(can)).toBeGreaterThan(60)
    expect(evaluateSimulationGoal(store.getSnapshot().scene)).toMatchObject({
      type: 'object-tipped', succeeded: true, released: true,
    })
  })

  it('preserves revision conflicts, retry deduplication, cancellation, and visible agent activity', async () => {
    const store = createSimulationStore({ storage: null })
    const tools = new Map(createWebMcpToolDefinitions(store).map((tool) => [tool.name, tool]))
    await tools.get('begin_arm_trial')!.execute({ requestId: 'begin-once' }, { signal: signal() })
    const stale = await tools.get('set_arm_outputs')!.execute({
      expectedRevision: 0, jointTargets: [{ jointId: 'a101-base', value: 2 }],
    }, { signal: signal() }) as Record<string, any>
    expect(stale).toMatchObject({ ok: false, revision: 1, error: { code: 'REVISION_CONFLICT' } })

    const first = await tools.get('set_arm_outputs')!.execute({
      expectedRevision: 1, requestId: 'agent-output-1', jointTargets: [{ jointId: 'a101-base', value: 2 }],
    }, { signal: signal() }) as Record<string, any>
    const retry = await tools.get('set_arm_outputs')!.execute({
      expectedRevision: 1, requestId: 'agent-output-1', jointTargets: [{ jointId: 'a101-base', value: 2 }],
    }, { signal: signal() }) as Record<string, any>
    expect(first).toMatchObject({ ok: true, revision: 2 })
    expect(retry).toMatchObject({ ok: true, revision: 2, deduplicated: true })

    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled test', 'AbortError'))
    await expect(tools.get('set_arm_outputs')!.execute({ gripper: 'open' }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(store.getSnapshot().revision).toBe(2)
    expect(store.getSnapshot().activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'webmcp', action: 'set_arm_outputs', status: 'ok' }),
      expect.objectContaining({ source: 'webmcp', action: 'set_arm_outputs', status: 'cancelled' }),
    ]))
  })
})
