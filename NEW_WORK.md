# Hackathon work provenance

RAI — Robot Agent Interface — was created for the OpenAI WebMCP Challenge on September 2–3, 2026, during the official August 25–September 3 submission period.

Its Arm Alliance reference dimensions were documented elsewhere in the surrounding private robotics workspace. No prior web application, renderer, simulator state, WebMCP adapter, or interface code was copied into this folder. The browser product is new challenge-period work.

## Current submission scope

The submitted product is arm-only. Its current work includes:

- A serializable robot, camera, primitive-scene, grasp, goal, and trial model with runtime validation.
- Serial-chain forward kinematics and analytic ideal-pinhole camera projection.
- The synthetic Arm 101 teaching preset with a wide camera, simulated parallel gripper, practice can, and visible tip goal.
- Agent-authored 1–8 joint serial arms with fixed, revolute, continuous, and prismatic joints.
- Build-mode robot, chain, camera, object, goal, pose, sequence, grasp-test, and snapshot authoring.
- A hard transition from broad Build access to blind Operate access.
- A fixed 19-tool `document.modelContext.registerTool` catalog: 15 Build-usable tools and exactly four Operate-usable tools.
- Operate-mode camera observations without object IDs or world coordinates, plus basic joint/gripper telemetry and direct joint/gripper outputs.
- Kinematic capture, carry, rotation, and release for eligible primitive objects.
- A shared revisioned command store with local persistence, undo/redo, snapshots, optimistic concurrency, retry deduplication, and cancellation handling.
- A procedural Three.js arm scene, simulated camera viewport, human controls, visible goal state, and Agent run timeline.
- Primitive visual URDF and JSON export through the human interface.
- Automated domain, store, and WebMCP tests.
- Challenge research, licensing, deployment headers, submission copy, narration, captions, and evidence templates.

RAI is a browser simulation, not a physical robot controller. Its camera tool returns structured analytic projection data rather than rendered or physical pixels. Its gripper behavior is deterministic kinematics rather than contact dynamics, gravity, torque, or physical proof.

## Superseded development path

Earlier challenge-period iterations explored a broader legged-robot direction. That work included branched four-leg kinematics, configurable 12-degree-of-freedom morphology, fixed-step Rapier chassis and ground experiments, walk/trot control, contact and stability telemetry, retained run records, trajectory replay, gait-focused interfaces, and four-branch visual URDF export.

Those experiments are part of the dated development provenance, but they were deliberately removed from the current submission. They are **not shipped RAI capabilities** and must not be presented as current source, runtime, build, browser, or hosted evidence. Older references to a 16-tool catalog, gait results, physics results, test counts, module counts, or demo timings are likewise superseded.

The refocus makes one WebMCP story easier to judge: the agent can build an arm experiment broadly, then must operate it through a constrained Observe → Sense → Act → Observe → Retry → Result loop that the person can watch.

## Public provenance handoff

The final submitted commit should preserve this file and the dated Git history. Before submission, record the exact commit, current automated checks, native 19-tool discovery, blind Arm 101 trial, and public deployment in [NATIVE_WEBMCP_EVIDENCE.md](./NATIVE_WEBMCP_EVIDENCE.md). The public repository should use this folder as its root.
