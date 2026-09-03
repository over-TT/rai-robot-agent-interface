# RAI — Robot Agent Interface

> **Build the arm. Then take away the map.**

RAI is a browser robotics interface where a person can watch an AI build and operate a camera-equipped arm. Its **Arm 101** scene includes a synthetic serial arm, a wide camera, a parallel gripper, a practice can, and a visible task result.

The WebMCP surface has two deliberate phases:

- **Build mode** exposes broad WebMCP authoring tools for serial arms, joints, links, cameras, primitive objects, goals, poses, and snapshots. JSON and URDF export remain human interface actions.
- **Operate mode** begins with `begin_arm_trial`. The can is moved to a seeded, repeatable position after the broad scene read is locked. Exactly four tools remain usable: `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, and `end_arm_trial`.

This makes the attempt inspectable without giving the agent a semantic shortcut. During a trial it cannot read object coordinates, query the goal state, call inverse kinematics, edit the scene, name an object to grasp, or invoke an outcome-specific action. The person sees the same arm, camera view, and visible Observe → Sense → Act → Observe → Retry → Result trail.

This folder is isolated from the physical Arm Alliance stack. It does **not** contact a Raspberry Pi, send servo commands, or prove anything about the desk arm.

## Current verified proof

- Native WebMCP discovery found all **19 registered tools**.
- Build exposes **15 authoring tools**; Operate permits exactly **4 constrained tools**.
- A local native-WebMCP trial changed the can's camera-frame long-axis angle from **96.393° upright to 41.017° tipped**.
- The human-visible result showed the can **released at 79.6°** with the goal marked **Done**.
- A 12-seed Operate-only sweep achieved **12/12 first-try grasps**, **12/12 camera-confirmed tips**, and **12/12 post-end hidden goal checks**, averaging **8 output calls**. The camera-axis change ranged from **39.5° to 42.6°**.
- The automated gate passed **68/68 tests in 12 files**, TypeScript, and a production build of **613 transformed modules**.

The centered final camera view was ambiguous across the reliability sweep, so the agent used a **±35° side-view retry** to confirm each tip. These are local receipts, not hosted or physical-robot proof. The public source repository is [over-TT/RAI](https://github.com/over-TT/RAI). Hosted verification remains pending.

## Run locally

Requirements: Node.js `^20.19.0` or `>=22.12.0`. Node 22.12.0 is pinned for CI and hosting builds.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:4176`.

Run the complete local gate:

```powershell
npm run check
```

Inspect the production bundle locally:

```powershell
npm run preview -- --host 127.0.0.1 --port 4177
```

Open `http://127.0.0.1:4177`. Development, preview, and the included hosting configuration set the WebMCP feature headers. When this folder becomes a standalone repository root, its GitHub Actions workflow runs `npm ci` and `npm run check` on pushes and pull requests.

## What it includes

- The ready-to-run Arm 101 scene: serial arm, mounted wide camera, parallel gripper, upright practice can, and a human-visible tip goal
- Agent-authored 1–8 joint serial robots using fixed, revolute, continuous, and prismatic joints
- Editable joint limits, axes, origins, positions, link directions, lengths, radii, colors, and base pose
- Camera references for a generic pinhole camera, Raspberry Pi Camera Module 3 Standard/Wide, and OAK-D Lite
- Editable camera mount, field of view, clipping range, and reference resolution
- Primitive scene authoring for boxes, spheres, cylinders, and planes
- Human joint and gripper controls that use the same validated command path as WebMCP
- Multi-waypoint joint sequences, undo/redo, local persistence, named snapshots, JSON export/import, and primitive visual URDF export
- A live agent trail with an exact run clock, clearly labeled steps, and persisted 1× scene replay using the original wall-clock gaps
- A focused home screen and compact agent handoff that frame Arm 101 as one starter demo, not the limit of the workbench
- Phase-aware WebMCP registration with strict schemas, runtime validation, optimistic revision checks, retry deduplication, and cancellation handling

Reference robots and cameras are simplified primitives. They do not include vendor CAD meshes, calibrated optics, or hardware behavior.

## Arm 101 loop

1. In Build mode, load Arm 101 or create a custom serial arm.
2. Edit its joints and links, mount a camera, and prepare the scene. Arm 101 already includes a simulated gripper; Build mode can test a named grasp but does not configure gripper hardware.
3. Call `begin_arm_trial` with `randomizeCan: true`. The simulator moves the can using a deterministic seed and locks every Build-mode read and mutation.
4. Call `observe_arm_camera`. It returns camera-frame structured detections from an ideal-pinhole projection, without object IDs, world positions, distances, or goal coordinates. For can-like cylinders it also reports the projected long-axis angle and normalized length; 0 degrees is image-horizontal and 90 degrees is image-vertical.
5. Call `get_arm_telemetry`. It returns joint positions and limits plus gripper state, without environment or goal state.
6. Call `set_arm_outputs` with bounded joint targets and/or `open`, `close`, or `unchanged` gripper output. It does not accept an object ID or Cartesian target.
7. Observe again. The person sees the same camera and the complete action trail while the agent corrects its next output.
8. Call `end_arm_trial` when the visual evidence is sufficient or further progress is not useful. This unlocks Build mode without returning hidden task state.

## WebMCP catalog

The page registers a fixed catalog of **19 tools** through the current imperative `document.modelContext.registerTool()` API. All 19 remain discoverable in both phases so the boundary is explicit rather than hidden.

Build mode has 15 usable tools:

- `list_robotics_presets`
- `get_simulation_state`
- `load_robot_preset`
- `create_custom_robot`
- `edit_robot_chain`
- `set_joint_positions`
- `move_end_effector`
- `configure_camera`
- `edit_scene_objects`
- `control_grasp`
- `move_grasped_object`
- `set_simulation_goal`
- `run_joint_sequence`
- `save_simulation_snapshot`
- `begin_arm_trial`

Operate mode has exactly four usable tools:

- `observe_arm_camera`
- `get_arm_telemetry`
- `set_arm_outputs`
- `end_arm_trial`

The other 15 return `PHASE_LOCKED` during a trial without returning their usual state. See [WEBMCP_TOOLS.md](./WEBMCP_TOOLS.md) for the exact contract and [NATIVE_WEBMCP_EVIDENCE.md](./NATIVE_WEBMCP_EVIDENCE.md) for the current verification template.

## Testing WebMCP

Use the latest ChatGPT desktop app and open the site in its built-in browser. ChatGPT Work and Codex can discover site tools. Select GPT-5.6 Sol or GPT-5.6 Terra; GPT-5.6 Luna currently has WebMCP disabled. Site tools are unavailable in Enterprise and Edu workspaces, and availability depends on rollout.

As a fallback, use Chrome 149 or later, enable `chrome://flags/#enable-webmcp-testing`, restart Chrome, and open the app over `localhost` or HTTPS. Browser availability changes independently of this repository, so the page badge is the source of truth for the current session.

These environment constraints were checked against the [official OpenAI Site Tools guide](https://learn.chatgpt.com/docs/webmcp), the [OpenAI challenge page](https://openai.com/webmcp-challenge/), and the [official Devpost rules](https://webmcp.devpost.com/rules) on September 3, 2026.

## Honest simulation boundary

RAI is inspired by the workflow of a robotics simulator; it is not an Isaac Sim replacement. Serial arms use deterministic forward kinematics. Build mode also offers bounded position-only inverse kinematics as an authoring aid, but that tool is locked during a blind trial.

`observe_arm_camera` returns structured detections computed from ideal-pinhole projection of simulated primitives. It is not a rendered camera image, learned perception, calibrated optics, or physical sensor evidence. Camera distortion, exposure, autofocus, depth, rolling shutter, and noise are not modeled.

Closing the trial gripper captures only the nearest eligible primitive inside a fixed 45 mm surface-clearance envelope. A captured object is rigidly attached to the virtual tool, rotates with it, and remains at its simulated pose when released. This is kinematic grasp/rotate/release—not general collision response, contact force, gravity-driven settling, payload dynamics, or grasp-stability proof.

A successful visible result proves only the state of this browser simulation. Arm 101 is a synthetic teaching preset, not a digital twin of the physical Arm Alliance hardware; the physical rig currently has no installed gripper/tool actuator matching this simulated one. It does not prove actuator torque, collision-free motion, physical arrival, camera performance, or control of a real robot.

URDF export preserves supported serial-chain primitive visuals, joint axes, origins, and limits in metres/radians. It omits cameras, scene objects, current joint positions, meshes, collision geometry, inertial data, transmissions, and actuator claims.

See [HACKATHON_RESEARCH.md](./HACKATHON_RESEARCH.md) for sources, [HACKATHON_SCORECARD.md](./HACKATHON_SCORECARD.md) for the criteria map, [NEW_WORK.md](./NEW_WORK.md) for challenge-period provenance, and [SUBMISSION.md](./SUBMISSION.md) for the launch checklist. The copy-ready Devpost entry, exact demo cut, narration, captions, and judging instructions live in [submission-assets](./submission-assets/README.md).
