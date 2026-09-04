# RAI native WebMCP evidence

**Status:** Evidence is dated by build below. Earlier analytic-camera trials are historical and do not prove the new rendered-image implementation. Public hosting checks and local browser experiments are separate.

## September 4 reliability update

The camera contract now returns rendered JPEG pixels, not analytic detections. Release now performs instant vertical support settling. Neither change is a physical dynamics solver.

Local browser checks used the page's native WebMCP tools:

- **Camera / bounded output:** 39.8 seconds, seven events. Observed a 640 × 343 JPEG; read joint telemetry; changed base and wrist targets and closed the empty gripper; inspected a second image showing the changed viewpoint; opened and ended. No task success was claimed.
- **Controlled release fixture:** 20.5 seconds, six events. Build preparation placed a 20 mm-radius sphere at the gripper. Operate close reported holding, a wrist output carried it, open released it, and the image showed it on the bench. Only after End, a Build audit confirmed centre Z = 0.02 m and no grasp. This was a prepared mechanics check, not autonomous visual acquisition or a can-tip success.
- **Replay:** original elapsed timestamps, 1× playback, pause held at 6.9 seconds, Next advanced to the next real event at 12.29 seconds, switching attempts reset the displayed timeline, and all four saved local attempts survived reload.
- **Browser errors:** no error-level console entries after reload. The dependency's `THREE.Clock` deprecation warning remains.

Regression tests cover truncated-frame anchors, storage conflicts and quota failure, default and 32-object six-run JSON round trips, legacy camera choice, stale/aborted camera capture, image-size limits, and release supports. The complete gate is `npm run check`; counts in older sections are historical.

Recordings are browser-local, not shared globally with every visitor. The image-response integration was explicitly decoded and inspected in the compatible browser host; other hosts must support displaying image content.

## September 3 camera and replay update

- Automated gate: **73 tests in 13 files**, TypeScript, and production build (**615 modules**) passed.
- Repaired stretched sensor rendering, aligned the visible image with the published +Y-image-right observation convention, and shared domain quaternions for compound object rotations. Observation math and historical tool responses were not rewritten.
- Replay now holds recorded scene states after completion, exposes clickable event timestamps and Next, and includes the camera at its recorded pose. Ended does not imply success. Home shows actual local recordings or an empty state, not a fictional receipt.
- Retained local attempt: **18 WebMCP events, 188.2 seconds**. Timestamp seeking, Next, and replay were exercised in the browser. Screenshots: [workbench](docs/media/workbench.jpg), [attempt timeline](docs/media/agent-run.jpg).
- Public site: [RAI on ChatGPT Sites](https://arm-lab-camera-robot.overtt.chatgpt.site). First public deployment succeeded from source `a4c1818f057f3a14328d75a76a562cd050f8d54b`; anonymous HTTP returned 200 with the RAI document. A Permissions-Policy response header was not observed; native hosted discovery is checked separately from header presence.

Historical trial receipts below retain their original test counts and observations.

This file separates current evidence from older product directions. Do not copy forward old test counts, module counts, revisions, physics results, or demo timings.

## Evidence summary

- **Proven locally:** the in-app Browser discovered 19 native tools at `http://127.0.0.1:4199/`; an agent completed the Arm 101 trial through the restricted observation/action interface; the human UI showed a successful released-can result and a 25-event Run timeline; direct native negative calls proved the Build-state read and an out-of-range output leave revision 15 unchanged.
- **Proven by the current automated gate:** TypeScript passed; 68/68 tests passed in 12/12 files; the production build passed with 613 transformed modules.
- **Not yet proven:** the exact submitted commit, public HTTPS behavior, signed-out access, or physical robot movement.

## Build identity

| Field | Current receipt |
| --- | --- |
| Git commit | **[PENDING]** |
| Public source repository | [over-TT/RAI](https://github.com/over-TT/RAI) |
| Verification date/time and zone | September 3, 2026 at 18:26 CEST (UTC+02:00) |
| URL | `http://127.0.0.1:4199/` — local loopback, not hosted proof |
| Browser/app | In-app Browser; exact version **[PENDING]** |
| Selected model | **[PENDING]** |
| Starting state | Arm 101 load committed at revision 1; storage-reset method **[PENDING]** |

## Automated gate

Run `npm run check` on the final source and paste exact output-derived facts.

| Check | Result |
| --- | --- |
| TypeScript | Passed (`tsc -b`) |
| Tests | Passed: 68/68 tests in 12/12 files |
| Production build | Passed (`vite build`) |
| Transformed modules | 613 |
| Warnings | None from the final `npm run check` gate |

## Native discovery

Source expectation: **19 registered tools**.

| Check | Local runtime result |
| --- | --- |
| Native WebMCP discovery | Passed in the in-app Browser at the local URL |
| Discovered tool count | **19** |
| All expected names individually retained | Passed in the clean local production bundle at `http://127.0.0.1:4203/` |
| Unexpected names | None |

Expected Build-usable tools:

`list_robotics_presets`, `get_simulation_state`, `load_robot_preset`, `create_custom_robot`, `edit_robot_chain`, `set_joint_positions`, `move_end_effector`, `configure_camera`, `edit_scene_objects`, `control_grasp`, `move_grasped_object`, `set_simulation_goal`, `run_joint_sequence`, `save_simulation_snapshot`, `begin_arm_trial`.

Expected Operate-usable tools:

`observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, `end_arm_trial`.

## Current local Arm 101 receipt

The successful trial used native WebMCP at the local URL. The trial ID was `arm-trial-2`.

| Revision | Agent step | Retained result |
| --- | --- | --- |
| 1 | `load_robot_preset` | Arm 101 loaded successfully. |
| 2 | `begin_arm_trial` | Entered Operate as `arm-trial-2`. |
| 2 | `observe_arm_camera` | One full cylinder detection; normalized center `[0.528067, 0.524458]`; camera-frame `longAxisAngleDeg` `96.393273`. |
| 2 | `get_arm_telemetry` | Returned the allowed joint and gripper telemetry only; the read did not advance the revision. |
| 3 | `set_arm_outputs` | Direct joint-output approach accepted. |
| 4 | `set_arm_outputs` | Gripper close accepted; `holding: true`. |
| 5 | `set_arm_outputs` | Wrist target set to 60 degrees while holding the primitive. |
| 6 | `set_arm_outputs` | Gripper release accepted. |
| 7–13 | `set_arm_outputs` with camera observations | The agent retracted and adjusted the camera viewpoint through bounded joint outputs and observation-driven retries. No Build tool or semantic task action was used. |
| 13 | `observe_arm_camera` | Full cylinder detection at normalized center `[0.136198, 0.747425]`; camera-frame `longAxisAngleDeg` `41.017427`. |
| 14 | `end_arm_trial` | Returned to Build. The tool response ended the trial without exposing hidden world state. |

Human-visible result at the end:

- Goal state: **Done**.
- Can tilt: **79.6 degrees**.
- Gripper: released.
- Visible Run timeline: **25 events**.

The camera angles above are image-plane orientation observations, not world poses. In the current API, 0 degrees is image-horizontal and 90 degrees is image-vertical; `longAxisLengthNormalized` supplies the corresponding normalized projected length. The length values were not retained in this run summary and are not reconstructed here. The UI goal and 79.6-degree tilt are human-visible simulator state; they were not supplied to the operating agent as a success oracle.

## Timed run and 1× replay receipt

The current UI pass was exercised through the in-app Browser's native WebMCP capability at the same local URL. Trial `arm-trial-19` recorded **18 agent events** over **3:08.2** of real wall-clock time, including the external agent's reasoning gaps between completed calls.

| Evidence | Local result |
| --- | --- |
| Initial camera observation | Partial cylinder detection; `longAxisAngleDeg` **145.936262**. |
| Grasp telemetry | `holding: true` after the bounded close output. |
| Released result | Gripper returned `holding: false`; post-run goal audit reported **79.583793°** tilt and `succeeded: true`. |
| Final camera observation | Partial cylinder detection from the restored evidence pose; `longAxisAngleDeg` **37.763551**. |
| Camera-only orientation change | **71.827°** using the undirected 0–180° long-axis convention. |
| Recording UI | Live `REC` clock advanced during WebMCP calls; every event retained its exact offset. |
| Replay UI | Scrubbed to **18.8s**, resumed at **1×**, and at **23.3s** the viewport switched to the recorded first-output scene while the active event changed from Sense to Act. Pause also held the recorded frame. |

The per-event offsets are intentionally labelled as elapsed wall-clock positions, not tool execution durations. The run recorder persists milestone scenes at Start, each successful output, and End; replay never mutates the live simulator state.

## 12-seed Operate-only reliability sweep

A separate sweep repeated the constrained policy across 12 deterministic seeds. After each trial began, arm operation used only the permitted camera, telemetry, output, and end contract.

| Measure | Result |
| --- | --- |
| First-try gripper capture | **12/12** |
| Camera-confirmed tip | **12/12** |
| Post-end hidden goal audit | **12/12** |
| Camera long-axis change | **39.5°–42.6°** |
| Mean direct output calls | **8 per trial** |

The centered final view was visually ambiguous: projection could not reliably distinguish the tipped state from that viewpoint. The policy therefore made a **±35° side-view retry** and used that new camera frame to confirm all 12 tips. The post-end hidden goal check was a separate audit after control ended; it was never available to the operating agent as an input or success oracle.

## Closed-loop audit

- [x] The agent used `observe_arm_camera` for camera evidence.
- [x] The agent used `get_arm_telemetry` for joint and gripper state.
- [x] After the trial began, mutations used `set_arm_outputs` until `end_arm_trial`.
- [x] The retained camera evidence used normalized image coordinates and image-plane orientation, not world coordinates or distances.
- [x] The retained telemetry was limited to the allowed joint and gripper fields.
- [x] No inverse-kinematics call, scene edit, named-object grasp, goal query, or semantic outcome action was used during Operate.
- [x] The agent observed again and made bounded retraction/viewpoint corrections before ending.
- [ ] Retain the complete raw native response payloads with the final submitted commit.

## Phase-boundary and negative controls

After the successful run, a second native audit entered Operate at revision 15 without repositioning the can. Its camera-only observation again returned a full cylinder detection with `longAxisAngleDeg: 41.017427`.

| Check | Expected result | Runtime receipt |
| --- | --- | --- |
| Build state read during Operate | `PHASE_LOCKED`, no hidden payload, no revision change | **Passed natively at revision 15.** Response contained only `ok: false`, revision 15, and the `PHASE_LOCKED` error. |
| Build IK during Operate | `PHASE_LOCKED`, no solution payload, no revision change | **[PENDING]** |
| Scene edit during Operate | `PHASE_LOCKED`, scene unchanged | **[PENDING]** |
| Invalid joint output | Validation error, no revision change | **Passed natively at revision 15.** Wrist target 999 was rejected with `LIMIT_EXCEEDED`, limits `[-90, 90]`, and no revision change. |
| Stale expected revision | Revision conflict, no mutation | **[PENDING]** |
| Repeated successful request ID | Deduplicated result, no duplicate action | **[PENDING]** |
| Operate-only read after trial end | Phase conflict, no trial data leaked | **[PENDING]** |

## Human-visible proof

- [x] The Run timeline retained 25 visible agent events.
- [x] The timeline showed observation, telemetry, output, retry, and end steps from the native run.
- [x] The human-facing goal showed Done after the released can reached 79.6 degrees of tilt.
- [x] The final camera evidence remained a full detection after the agent's retraction and viewpoint retries.
- [ ] Capture final-submission screenshots or video frames from the exact submitted commit.
- [x] Build controls visibly unlocked after ending the native trial.
- [x] The clean local production bundle logged no console errors. One upstream `THREE.Clock` deprecation warning remained.

## Hosted proof

| Check | Result |
| --- | --- |
| Public HTTPS URL | [Public ChatGPT Sites page](https://arm-lab-camera-robot.overtt.chatgpt.site) |
| HTTP 200 while signed out | **Passed September 3, 2026** using an anonymous HTTP request |
| Native discovery reports 19 tools | **[PENDING]** |
| Required security/feature headers | **[PENDING]** |
| Full constrained trial completes | **[PENDING]** |
| Narrow viewport remains usable | **[PENDING]** |
| Public source repository | [over-TT/RAI](https://github.com/over-TT/RAI) |
| Public YouTube video, audio, captions, under 3 minutes | **[PENDING]** |

## Evidence boundary

The trial receipts prove local in-app-Browser WebMCP behavior. Public hosting and anonymous HTTP checks are separate; they do not establish a complete hosted trial or physical movement.

Arm 101 is a synthetic simulator teaching rig, not a physical twin. `observe_arm_camera` returns analytic ideal-pinhole projections of simulated primitives rather than rendered pixels, learned detections, or physical camera data. The simulated gripper captures within a bounded kinematic envelope and carries, rotates, or releases an attached primitive. It does not model collision response, contact forces, friction, gravity, motor torque, or sim-to-real arrival.

## Sign-off

- **Verifier:** **[PENDING]**
- **Submitted commit matches verified commit:** **[PENDING]**
- **Hosted bundle matches submitted source:** **[PENDING]**
- **Video shows the verified hosted flow:** **[PENDING]**
