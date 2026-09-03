# Robot Workbench product brief

## Purpose

Create a browser-only robotics experiment workbench where a person and a WebMCP-capable agent share one visible scene: they can build serial arms or quadrupeds, operate them, inspect results, correct a design, and retain comparable evidence from every attempt.

## Primary user

A robotics builder, student, or hackathon judge working on a desktop browser who wants to turn a natural-language robot idea into an inspectable articulated model without installing a heavyweight simulator.

## Product principles

1. **Simulation truth over spectacle.** Every result is labelled as browser kinematics or idealized optics. The interface never implies actuator, collision, camera-calibration, or physical-world proof.
2. **One model, two operators.** Human controls and WebMCP tools use the same validated command path, state revision, undo history, and visible activity log.
3. **Robot semantics, not generic shapes.** Links, joint types, axes, limits, cameras, fields of view, targets, and trajectories are first-class objects.
4. **Inspect before changing.** IDs, limits, camera visibility, end-effector pose, and the current revision are easy for both a person and an agent to read before mutation.
5. **Dense evidence, quiet chrome.** The workbench prioritizes the scene, numbers, provenance, and actions over decorative UI.
6. **Closed-loop agent work.** Robot creation, world authoring, end-effector targeting, grasp/release, and goal checks remain narrow, reversible actions with visible outcomes and explicit residuals.
7. **Kinematic manipulation is labelled.** A carried object is rigidly attached to the virtual end effector. It is not evidence of collision, friction, gravity, payload, contact force, or grasp stability.
8. **One intentional instrument theme.** The hackathon surface is a dark, desktop simulator cockpit rather than a general consumer site. Its dark surfaces are authored directly; a second light theme is deferred so the submission can prioritize legible geometry, evidence, and control density.
9. **Attempts remain watchable.** Quadruped physics runs become bounded experiment records. The UI replays the retained telemetry over 1.8–3.2 seconds, labels it “Measured replay,” and preserves earlier morphologies and results side by side. Reduced-motion users see the final measured frame without spatial animation.
10. **Simple geometry reads fastest.** The quadruped uses one matte trunk, a thin front marker, plain links, single-piece joint motors, and contact-colored feet. Motion and evidence carry the hierarchy; decorative armor and faux hardware do not.

## Success measure

Within two minutes, a first-time user or browser agent can run one weaker quadruped attempt, correct its morphology, visibly replay the improved run, compare both measured results, and save proof. The same page also supports a serial-arm move, grasp, delivery goal, camera visibility check, and reversible edits.

## Out of scope for the hackathon build

- Real robot, servo, Raspberry Pi, ROS, or network-hardware control
- Torque-accurate actuators, dynamic articulated legs, uneven terrain, full collision planning, payload, friction, or physical-world claims. Rapier drives a rigid chassis against a flat ground plane while leg articulation is kinematic.
- Calibrated lens distortion, autofocus, exposure, rolling shutter, or sensor noise
- Vendor meshes, logos, or claims that simplified presets are CAD-accurate
- Closed-chain mechanisms and arbitrary mesh/URDF imports
- A second visual theme for the hackathon release
