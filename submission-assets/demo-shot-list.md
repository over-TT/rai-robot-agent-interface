# RAI demo shot list — 2:18 target

Record one clean 1280 × 720 or larger take. Keep the 3D arm, camera view, phase badge, and Run timeline readable. Show native WebMCP calls; do not simulate the agent by clicking human controls.

| Time | Picture and live action | Proof the viewer should notice |
| --- | --- | --- |
| 0:00–0:10 | Open on the RAI title and Arm 101 scene. Brief push toward the arm and can. | Name and hook: the agent will lose privileged scene access. |
| 0:10–0:29 | Show native discovery at 19 tools. Invoke `load_robot_preset` for Arm 101; briefly reveal joints, camera, gripper, can, and goal. | Broad authoring is real and updates the shared scene. |
| 0:29–0:48 | Invoke `begin_arm_trial` with the recording seed. Hold on Build → Operate and the can reset. | The experiment changes capabilities, not merely prompt wording. |
| 0:48–1:08 | Invoke one `get_simulation_state` call and show its concise `PHASE_LOCKED` response. Then call `observe_arm_camera` and `get_arm_telemetry`. | Locked call leaks no hidden state; allowed inputs contain image-space evidence and arm state only. |
| 1:08–1:22 | Highlight the first camera receipt: `longAxisAngleDeg: 96.393273`. Invoke bounded joint outputs, close, wrist rotation, and release through `set_arm_outputs`. | Nearly upright starting evidence and direct actuator-style commands—no `tip_can`. |
| 1:22–1:40 | Show that the centered final view is ambiguous, then make a ±35° side-view retry. Finish on `longAxisAngleDeg: 41.017427`. | The agent changes viewpoint to obtain decisive camera evidence. |
| 1:40–1:58 | Hold the shared Run timeline. Show human result: Done, released, 79.6° tilt. | The person can inspect the attempt; the human result was not an agent oracle. |
| 1:58–2:06 | Invoke `end_arm_trial`; show return to Build while the result remains visible. | The restricted phase ends cleanly. |
| 2:06–2:18 | End card: RAI name, final tagline, live URL, repository URL, “Kinematic research sandbox.” | Honest boundary and paths to try the project. |

## Recording prompt

> Use only this page's WebMCP tools. Load Arm 101, then begin a blind can-tip trial. After the trial begins, use only `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, and `end_arm_trial`. Do not use world coordinates, scene state, inverse kinematics, hidden goal state, or a semantic task shortcut. Observe, send one bounded output, observe the consequence, and visibly correct the next attempt. Try to leave the can on its side, then end when camera evidence is convincing or further progress is not useful.

## Capture rules

- Record the deployed build and exact submitted commit after both are verified.
- Use one deliberate `PHASE_LOCKED` call; do not waste the video on error cases.
- Never show object world coordinates, tokens, repository settings, debug storage, or unrelated tabs.
- Keep the first and final camera angles visible long enough to read.
- Do not cut away between the first consequence and the retry.
- Regenerate narration, measure its actual duration, and retime captions before export.
- Export below 3:00, upload publicly to YouTube, and test audio, captions, and playback while signed out.
