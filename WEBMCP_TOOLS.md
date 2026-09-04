# RAI WebMCP tool contract

RAI registers one fixed **19-tool** catalog through the current imperative `document.modelContext.registerTool()` API. The catalog stays discoverable across both phases, but the usable tools change when an arm trial begins.

This phase boundary is the central product contract:

- **Build mode:** 15 tools can inspect and author the robot, camera, scene, goal, and saved state.
- **Operate mode:** exactly four tools can observe the arm camera, read bounded arm telemetry, apply joint/gripper outputs, or end the trial.
- Every other tool returns `PHASE_LOCKED` during Operate mode without returning its usual state.

Human controls and WebMCP commands use the same validated store, revision, history, and visible activity trail. There is no agent-only simulation.

## Build-mode catalog

| Tool | Purpose |
|---|---|
| `list_robotics_presets` | List serial-arm, camera, joint-type, primitive, unit, capability, and limitation references. |
| `get_simulation_state` | Read detailed robot, camera, object, grasp, goal, snapshot, and optional activity state while building. Locked during a trial. |
| `load_robot_preset` | Load Arm 101 or another built-in serial-arm reference. |
| `create_custom_robot` | Create an agent-authored 1–8 joint serial arm from joint/link segments. |
| `edit_robot_chain` | Atomically add, update, or remove joint-and-link pairs. |
| `set_joint_positions` | Set a build/test pose by joint ID. |
| `move_end_effector` | Use bounded position-only inverse kinematics as a Build-mode authoring aid. |
| `configure_camera` | Add, update, attach, remove, or retune an ideal-pinhole camera. |
| `edit_scene_objects` | Add, update, or remove bounded box, sphere, cylinder, or plane primitives. |
| `control_grasp` | Attach or release a named nearby object while testing a build. |
| `move_grasped_object` | Use Build-mode inverse kinematics to move a named attached object. |
| `set_simulation_goal` | Set or clear a human-visible derived objective while building. |
| `run_joint_sequence` | Validate and apply a 2–64 waypoint kinematic sequence while building. |
| `save_simulation_snapshot` | Save the current scene under a local name. |
| `begin_arm_trial` | Freeze construction, optionally move the practice can to a seeded position, and enter Operate mode. |

These tools provide broad authoring without weakening the trial. `begin_arm_trial` moves the practice can **after** the broad state read becomes unavailable when `randomizeCan` is true. A supplied `seed` makes the placement repeatable for testing without revealing it to the operating agent.

## Operate-mode catalog

### `observe_arm_camera`

Input: an empty object.

Returns:

- current revision, phase, and trial ID;
- camera model, actual image resolution, and horizontal/vertical field of view;
- `content: [{ type: "image", mimeType: "image/jpeg", data: "<base64>" }]`, containing the rendered simulated camera image, bounded to a 640-pixel longest edge.

Inspect the returned image using the host's image-content support. Pixels include depth occlusion but omit world axes, camera frustums, selection highlights, and goal annotations. The tool does **not** return object IDs, names, world positions, distances, goal coordinates, goal results, or analytic detections. It is rendered ideal-pinhole simulation, not physical camera data or calibrated optics. If capture is unavailable or the scene/trial changes during capture, the call fails with `CAMERA_UNAVAILABLE` rather than returning stale or synthetic evidence.

Every successful observation is added to the visible Agent run timeline without changing the simulation revision.

### `get_arm_telemetry`

Input: an empty object.

Returns:

- current revision, phase, and trial ID;
- joint ID, name, type, current position, unit, and optional limits;
- gripper state and whether its fixed capture envelope currently holds an object.

It does **not** return the end-effector pose, object state, task state, goal result, or any world coordinate. Every successful read appears as a Sense step in the shared timeline.

### `set_arm_outputs`

Applies one bounded output command. Provide at least one of:

```json
{
  "jointTargets": [
    { "jointId": "a101-base", "value": 12 },
    { "jointId": "a101-shoulder", "value": 38 }
  ],
  "gripper": "unchanged",
  "expectedRevision": 4,
  "requestId": "trial-1-act-2"
}
```

```json
{
  "gripper": "close",
  "expectedRevision": 5,
  "requestId": "trial-1-close"
}
```

- `jointTargets` accepts 1–8 joint ID/value pairs. Revolute and continuous values use degrees; prismatic values use metres. Existing joint limits remain authoritative.
- `gripper` is `open`, `close`, or `unchanged`.
- The command accepts no object ID, Cartesian target, camera target, goal, or semantic task action.
- Closing captures only the nearest eligible primitive inside the fixed 45 mm surface-clearance envelope. Opening releases the current rigid attachment.

The result reports only the applied targets and gripper/holding state. It does not reveal which scene object was captured or where that object is.

### `end_arm_trial`

Ends the trial and returns to Build mode. It accepts optional `expectedRevision` and `requestId`, but no task-result input. Its result exposes the new phase only; it does not return hidden world or goal state.

The person can see the human-facing task result throughout the run. The operating agent must base its decision on the allowed camera observation and telemetry.

## Arm 101 trial sequence

1. Call `load_robot_preset` with `presetId: "arm-101"`.
2. Optionally use Build tools to inspect or change the arm, camera, scene, or starting pose. Arm 101 already includes a simulated gripper; Build mode can test a named grasp but does not configure gripper hardware.
3. Call `begin_arm_trial`:

```json
{
  "randomizeCan": true,
  "seed": 101,
  "expectedRevision": 1,
  "requestId": "arm-101-trial-1"
}
```

4. Call `observe_arm_camera` and `get_arm_telemetry`.
5. Apply one bounded `set_arm_outputs` command.
6. Observe again before correcting the next joint or gripper output.
7. Continue the visible Observe → Sense → Act → Observe loop.
8. Call `end_arm_trial` when the camera evidence is convincing or further progress is not useful.

During the trial there is no semantic task action, scene edit, object-coordinate read, inverse-kinematics shortcut, named grasp, goal query, or separate visibility oracle.

## Phase behavior

| Request | Build mode | Operate mode |
|---|---|---|
| 14 authoring/read tools | Usable | `PHASE_LOCKED`; no normal payload |
| `begin_arm_trial` | Usable | `PHASE_LOCKED`; trial already active |
| `observe_arm_camera` | `CONFLICT`; trial required | Usable |
| `get_arm_telemetry` | `CONFLICT`; trial required | Usable |
| `set_arm_outputs` | `CONFLICT`; trial required | Usable |
| `end_arm_trial` | `CONFLICT`; trial required | Usable |

## Shared mutation contract

Every top-level schema rejects unknown fields. The command layer validates again at runtime.

Mutations may include:

- `expectedRevision`: reject the command if another human or agent action changed the scene first.
- `requestId`: deduplicate a matching successful retry while it remains in the current page session's bounded cache. Conflicting reuse is rejected. Pair it with `expectedRevision` after reload, import, or eviction.

Successful mutations return `ok`, the new `revision`, changed IDs where relevant, warnings, a concise summary, and operation-specific data. Validation, phase, stale-revision, range, and unreachable-target failures leave the scene unchanged.

The browser invocation signal is checked before parsing and immediately before dispatch. Aborted reads and mutations are recorded as stopped or cancelled in the shared activity trail.

## Human-visible evidence

The interface keeps the 3D scene, selected camera view, task result, joint/gripper controls, and Agent run timeline in one page. The timeline labels Build, Start, Observe, Sense, Act, Retry, Blocked, Stopped, and Result steps with source, time, summary, and revision. Human inputs use the same command path and are labelled Human.

The human-visible result is deliberately richer than the Operate tool response. It lets a judge see whether the can is tipped while preserving the agent's sensor-limited loop.

## Honest limits

- Serial arms use deterministic kinematics; no motor torque, velocity loop, backlash, elasticity, or electrical behavior is modeled.
- The trial camera returns rendered ideal-pinhole images, not physical camera frames. Lens distortion, exposure, noise, and learned detection are not modeled.
- Closing the gripper creates a rigid kinematic attachment only when a primitive falls inside the fixed envelope. There is no finger contact solving, force closure, friction cone, payload limit, or grasp-stability model.
- The attached object follows the end-effector pose and can rotate with it. Release keeps its orientation and instantly settles vertically onto a horizontal fixed support beneath its centre, or the floor. Falling dynamics, bounce, rolling, and angular settling are not modeled.
- General robot/object collision and contact-force response are not modeled.
- A visible success is browser-simulation evidence only. It is not proof of safe, accurate, or successful physical-arm behavior.

## Browser lifecycle

`installWebMcpTools()` feature-detects `document.modelContext`. Registration uses one abort controller so cleanup removes the complete static catalog. The full human interface remains usable when WebMCP is unavailable.

See [NATIVE_WEBMCP_EVIDENCE.md](./NATIVE_WEBMCP_EVIDENCE.md) for the local 19-tool discovery and Arm 101 trial receipt. Final-build and hosted verification remain pending.
