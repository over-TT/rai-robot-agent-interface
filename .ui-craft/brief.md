# RAI product brief

## Product purpose

RAI is a browser robotics interface where a person watches a WebMCP agent author a camera-equipped serial arm, then operate it through a constrained observation-and-action loop.

## Primary user

A robotics builder, student, researcher, or hackathon judge using a desktop browser to inspect how an AI designs and controls a simulated arm without installing heavyweight robotics software.

## Product principles

1. **The map disappears when the trial starts.** Build may expose broad robot, camera, scene, and goal authoring, but Operate permits only camera observation, basic arm telemetry, direct arm and gripper outputs, and trial end.
2. **Attempts are the product.** Observe, Sense, Act, Retry, and Result stay visible so a person can understand what evidence the agent had and how its behavior changed.
3. **Simulation truth over spectacle.** Every result is labelled as deterministic browser kinematics or idealized optics; no screen implies physical, contact-dynamic, or calibrated-camera proof.
4. **One model, two operators.** Human controls and WebMCP tools use the same validated command path, revision, persistence, and visible activity trail.
5. **Geometry first, chrome second.** The arm, camera view, current phase, outputs, and evidence dominate; decorative texture and explanatory text earn their space.

## Success metric for the surface

Within two minutes, a first-time viewer can load Arm 101, begin a blind trial, watch the agent use only the four Operate tools, identify at least one observation-driven correction, and read the final can state from the shared scene and run timeline.

## Out of scope

- Real robot, servo, Raspberry Pi, ROS, or network-hardware control
- General collision response, contact force, friction, gravity, payload, torque, or sim-to-real claims
- Calibrated optics, rendered or physical camera frames, learned perception, lens distortion, autofocus, exposure, rolling shutter, or sensor noise
- Vendor CAD meshes, vendor-accurate digital twins, arbitrary mesh import, or arbitrary URDF import
- Closed-chain mechanisms, multi-robot worlds, or general-purpose robotics simulation
