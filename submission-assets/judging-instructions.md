# RAI judging instructions

## Links

- **Live app:** `[PENDING — verified public HTTPS URL]`
- **Public source:** https://github.com/over-TT/rai-robot-agent-interface
- **Video:** `[PENDING — public YouTube URL]`
- **Verified commit:** `[PENDING]`

## Fast path — about two minutes

1. Open the live URL in a WebMCP-capable ChatGPT browser session. The page should report WebMCP ready and open in **Build**.
2. Discover the site tools. Expected count: **19**.
3. Ask the agent to load **Arm 101**, then call `begin_arm_trial` with a seed and `randomizeCan: true`.
4. During Operate, call `get_simulation_state` once. Expected: `PHASE_LOCKED`, no hidden scene payload, and no revision change.
5. Use only `observe_arm_camera`, `get_arm_telemetry`, and `set_arm_outputs`. The camera response should expose normalized image-space detections—not object IDs, world coordinates, distances, inverse-kinematics results, or hidden goal state.
6. Make a bounded arm or gripper output, observe again, and make one visible correction from the new frame.
7. Call `end_arm_trial`. Expected: return to Build; the already-visible human result and Run timeline remain inspectable.

## Known-good local reference

- 19 native tools discovered.
- 15 Build tools; exactly 4 Operate tools.
- Camera-frame can angle: **96.393° upright → 41.017° tipped**.
- Human-visible final result: **released, 79.6°, Done**.
- 12-seed Operate-only sweep: **12/12 first-try grasps**, **12/12 camera-confirmed tips**, **12/12 post-end hidden goal checks**, **39.5–42.6° camera-axis change**, and **8 output calls on average**.
- Automated gate: TypeScript passed; **61/61 tests in 10 files**; production build passed with **612 transformed modules**.

The centered final view was ambiguous during the sweep, so each camera confirmation used a **±35° side-view retry**. The hidden goal check happened only after the trial ended and was not available to the operating agent. Hosted behavior must be compared against this reference after deployment; these local receipts are not a claim that the pending public URL has already passed.

## Scope

RAI demonstrates an inspectable WebMCP observation/action loop in a deterministic browser simulator. It does not claim rigid-body physics, calibrated camera behavior, a physical-robot run, or sim-to-real transfer.
