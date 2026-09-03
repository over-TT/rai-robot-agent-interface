# RAI — OpenAI WebMCP Challenge scorecard

This scorecard separates implementation visible in the current source from results that still need a clean run. A checked source item is not a claim that the final browser, production bundle, or hosted URL has already been verified.

## Product thesis

**RAI lets an AI author a synthetic arm experiment, then removes its privileged scene access so a person can watch it learn through camera observations and direct control.**

The submission should make one loop unmistakable:

```text
Build Arm 101 → Begin trial → Observe → Sense → Act → Observe → Retry → End / Result
```

## Criterion map

### WebMCP Leverage

- [x] The top-level page registers a fixed 19-tool imperative catalog in source.
- [x] Fifteen broad authoring tools are usable in Build.
- [x] `begin_arm_trial` creates an explicit transition into Operate.
- [x] Only four tools are usable in Operate: camera observation, basic arm telemetry, direct arm output, and trial end.
- [x] The other 15 tools remain discoverable but return `PHASE_LOCKED` without hidden state.
- [x] Operate observation omits object IDs, world positions, endpoint position, goal state, and inverse-kinematics output.
- [x] Human and agent actions reach the same visible scene and activity timeline.
- [x] Local in-app Browser discovered exactly 19 tools.
- [x] A local native trial completed the restricted observe/sense/act/retry loop.
- [x] A 12-seed Operate-only sweep produced 12/12 first-try grasps, 12/12 camera-confirmed tips, and 12/12 post-end hidden goal checks.
- [x] A direct native `PHASE_LOCKED` negative-call receipt retained revision 15 and returned no hidden state.
- [ ] Repeat discovery and the trial on the final public deployment.

**Demo emphasis:** Show a Build-only read or edit becoming locked immediately after the trial starts, then complete the next decision using only the four Operate tools.

### Execution

- [x] Synthetic Arm 101 teaching preset with serial joints, camera, gripper, practice object, and goal.
- [x] Robot and scene authoring through structured Build tools.
- [x] Analytic ideal-pinhole camera observation with normalized image-space detections.
- [x] Basic joint and gripper telemetry.
- [x] Direct joint/gripper outputs with validation and revision handling.
- [x] Kinematic object capture, carry, rotation, and release.
- [x] Visible phase, attempt stages, shared camera/scene, and human-facing result.
- [x] Human controls remain available when native WebMCP is unavailable.
- [x] Current TypeScript check passes (`tsc -b`).
- [x] Current automated tests pass: 61/61 in 10/10 files.
- [x] Current production build passes with 612 transformed modules.
- [x] Current clean local production bundle loads without application-console errors.
- [ ] 390 px viewport acceptance check completed.

**Demo emphasis:** Keep the scene, camera, phase, and timeline on screen. The person should understand what happened without reading raw JSON.

### Potential Impact

- [x] Clear user: robotics learners, makers, and researchers studying agent control loops.
- [x] Lightweight browser entry point before a heavyweight simulator is justified.
- [x] Broad Build mode supports more than one fixed pose or canned animation.
- [x] Blind Operate mode creates a useful research constraint rather than an unrestricted scene editor.
- [x] Attempts and corrections remain visible to the person.
- [x] Local native run retained a bounded multi-observation correction: camera-frame long-axis angle changed from 96.393° to 41.017°.
- [ ] Validate that a first-time viewer can explain the loop after the demo without extra narration.

**Claim discipline:** Arm 101 is a synthetic teaching rig. It is not a digital twin of the user's physical Arm Alliance hardware, whose installed hardware may differ.

### Creativity & Ambition

- [x] Tool permissions change with the experiment phase.
- [x] The restriction is enforced in the product, not only in a prompt.
- [x] The AI's intermediate attempts are treated as the experience, not hidden implementation detail.
- [x] The same page combines experiment authoring, constrained control, visual playback, and a human-readable trace.
- [x] Local native trial captured a visible observation-driven retry and a 25-event human timeline.
- [x] Reliability sweep exposed an honest visual ambiguity: the centered final frame was inconclusive, and a ±35° side-view retry confirmed all 12 tips.

**Demo emphasis:** The hook is “the AI loses privileged access and has to look again,” not “the page has many controls.”

## Current source contract

### Build-usable tools — 15

1. `list_robotics_presets`
2. `get_simulation_state`
3. `load_robot_preset`
4. `create_custom_robot`
5. `edit_robot_chain`
6. `set_joint_positions`
7. `move_end_effector`
8. `configure_camera`
9. `edit_scene_objects`
10. `control_grasp`
11. `move_grasped_object`
12. `set_simulation_goal`
13. `run_joint_sequence`
14. `save_simulation_snapshot`
15. `begin_arm_trial`

### Operate-usable tools — 4

1. `observe_arm_camera`
2. `get_arm_telemetry`
3. `set_arm_outputs`
4. `end_arm_trial`

The 15 Build tools remain registered during Operate but must return `PHASE_LOCKED`. The four Operate tools must not expose privileged state or accept semantic task-level commands.

## Final acceptance sequence

Run this sequence in a fresh judging-browser origin and copy exact receipts into [NATIVE_WEBMCP_EVIDENCE.md](./NATIVE_WEBMCP_EVIDENCE.md):

1. Confirm the visible phase is Build and native discovery shows 19 registered tools.
2. Load Arm 101 and inspect the human-facing scene.
3. Configure the camera, verify the included simulated gripper, author the practice object, and set the visible task.
4. Start a seeded trial for reproducibility; record the seed without exposing the randomized placement to the agent.
5. Attempt a Build-only read such as `get_simulation_state`; confirm `PHASE_LOCKED` and no hidden state in the response.
6. Call `observe_arm_camera`; retain revision/phase/trial identity, camera metadata, and normalized visual detections only.
7. Call `get_arm_telemetry`; retain revision/phase/trial identity plus joint and gripper state only.
8. Call `set_arm_outputs` with direct targets, then observe again.
9. Make at least one evidence-driven correction and show the new Result/Retry entries in the human timeline.
10. End the trial and confirm Build unlocks.
11. Verify a stale-revision or invalid-output request fails without mutating the scene.
12. Reload and confirm the intended persisted state and 19-tool discovery.

## Submission package

| Deliverable | Current status | Required proof |
| --- | --- | --- |
| Public live app | Pending | HTTPS URL works through judging path and while signed out |
| Native WebMCP | Passed locally; hosted repeat pending | 19 discovered tools, correct phase behavior, completed constrained trial |
| Public source repository | Public URL available | [over-TT/rai-robot-agent-interface](https://github.com/over-TT/rai-robot-agent-interface) |
| Automated gate | Passed locally | TypeScript passed; 61/61 tests in 10 files; production build passed with 612 transformed modules |
| Video | Exact shot list, narration, and caption draft present | Public YouTube, audio, captions, under three minutes |
| English description | Copy-ready | Paste from `submission-assets/devpost-copy.md` after filling public URLs |
| Challenge-period provenance | Present in project; public check pending | `NEW_WORK.md` and dated public history |
| Free access through judging | Pending | Hosting remains available through September 21, 2026 at 5:00 PM PDT |

## Honest evidence boundary

- The camera tool returns analytic ideal-pinhole projections of simulated primitives. It is not rendered-pixel, learned-perception, or physical-camera evidence.
- The gripper uses a bounded kinematic capture rule and deterministic attachment. It does not simulate collision response, friction, gravity, motor torque, or compliant contact.
- Rotating or releasing a captured object demonstrates stateful browser kinematics, not a physical push, tip, or grasp.
- The trial proves that the WebMCP agent operated within the declared observation/action contract. It does not prove physical-arm arrival or sim-to-real transfer.

## Highest-value final checks

1. Run the merged `npm run check`; record exact, current results.
2. Complete one clean native-browser trial from revision zero.
3. Inspect every locked response for accidental coordinates, goal state, endpoint data, or other leakage.
4. Capture a visible first attempt and correction.
5. Show why the centered view is ambiguous, then use the ±35° side view as camera evidence.
6. Deploy the exact verified commit and repeat the short acceptance flow on public HTTPS.
7. Record the final video and retime captions to its audio.
8. Verify every link while signed out before submission.
