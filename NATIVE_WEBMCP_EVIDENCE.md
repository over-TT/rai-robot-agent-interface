# RAI native WebMCP evidence

**Status:** A successful local native-WebMCP Arm 101 trial and final automated gate are recorded below. Submitted-commit, public-hosting, and signed-out receipts remain pending.

This file separates current evidence from older product directions. Do not copy forward old test counts, module counts, revisions, physics results, or demo timings.

## Evidence summary

- **Proven locally:** the in-app Browser discovered 19 native tools at `http://127.0.0.1:4199/`; an agent completed the Arm 101 trial through the restricted observation/action interface; the human UI showed a successful released-can result and a 25-event Run timeline; direct native negative calls proved the Build-state read and an out-of-range output leave revision 15 unchanged.
- **Not yet proven:** the final automated build, exact submitted commit, public HTTPS behavior, signed-out access, or physical robot movement.

## Build identity

| Field | Current receipt |
| --- | --- |
| Git commit | **[PENDING]** |
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
| Tests | Passed: 61/61 tests in 10/10 files |
| Production build | Passed (`vite build`) |
| Transformed modules | 612 |
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
| Public HTTPS URL | **[PENDING]** |
| HTTP 200 while signed out | **[PENDING]** |
| Native discovery reports 19 tools | **[PENDING]** |
| Required security/feature headers | **[PENDING]** |
| Full constrained trial completes | **[PENDING]** |
| Narrow viewport remains usable | **[PENDING]** |
| Public repository and license visible | **[PENDING]** |
| Public YouTube video, audio, captions, under 3 minutes | **[PENDING]** |

## Evidence boundary

This receipt proves a local in-app-Browser WebMCP run only. It does not prove the final production build, public hosting, signed-out access, or physical robot movement.

Arm 101 is a synthetic simulator teaching rig, not a physical twin. `observe_arm_camera` returns analytic ideal-pinhole projections of simulated primitives rather than rendered pixels, learned detections, or physical camera data. The simulated gripper captures within a bounded kinematic envelope and carries, rotates, or releases an attached primitive. It does not model collision response, contact forces, friction, gravity, motor torque, or sim-to-real arrival.

## Sign-off

- **Verifier:** **[PENDING]**
- **Submitted commit matches verified commit:** **[PENDING]**
- **Hosted bundle matches submitted source:** **[PENDING]**
- **Video shows the verified hosted flow:** **[PENDING]**
