# RAI submission handoff

RAI — Robot Agent Interface — is ready to present as one focused story: an AI builds **Arm 101**, starts a blind manipulation trial, and learns from what its camera and joint telemetry reveal. Publishing, public-repository creation, video upload, and the final Devpost submission remain owner-controlled actions.

## Submission identity

- **Public name:** RAI — Robot Agent Interface
- **Tagline:** Build the arm. Then take away the map.
- **Public source repository:** [over-TT/rai-robot-agent-interface](https://github.com/over-TT/rai-robot-agent-interface)

## Current proof snapshot

- Local native discovery: **19 tools**.
- Capability split: **15 Build tools / exactly 4 Operate tools**.
- Restricted camera trial: **96.393° upright → 41.017° tipped** in image space.
- Human-visible result: **released at 79.6°; Done**.
- 12-seed Operate-only sweep: **12/12 first-try grasps**, **12/12 camera-confirmed tips**, **12/12 post-end hidden goal checks**, **39.5–42.6° camera-axis change**, and **8 output calls on average**.
- Automated gate: TypeScript passed; **61/61 tests in 10 files**; production build passed with **612 transformed modules**.

The centered final view was ambiguous in the sweep; a **±35° side-view retry** supplied the camera confirmation. Hosted and public-video proof remain pending.

## What must be submitted

Submit before **September 3, 2026 at 1:00 PM PDT / 22:00 Europe/Zurich**:

- A working public live URL. ChatGPT Sites is an allowed hosting option.
- A public GitHub, GitLab, or Bitbucket repository with complete source, setup instructions, assets, and a visible open-source license.
- A public YouTube video under three minutes with explanatory audio.
- An English project description covering the experience, implementation, WebMCP use, and what WebMCP newly enables.
- Dated evidence that the project is new during the challenge period or received meaningful WebMCP work after August 25, 2026.

Keep the app free through judging, which ends **September 21, 2026 at 5:00 PM PDT**. Do not edit the submitted entry after the deadline. Tagging the submitted commit and doing later work on a separate branch or fork is a useful evidence-preservation practice.

## Owner checklist

- [x] Set the public name to **RAI — Robot Agent Interface**.
- [x] Confirm the final tagline.
- [x] Run the final `npm run check` gate and copy its exact TypeScript, test, and build results into [NATIVE_WEBMCP_EVIDENCE.md](./NATIVE_WEBMCP_EVIDENCE.md).
- [x] Complete a local native-WebMCP Arm 101 trial through only the four Operate tools.
- [ ] Repeat the evidence run on the final submitted commit and public deployment.
- [x] Publish this folder as the public repository root and confirm anonymous HTTP access to both the repository and MIT license.
- [ ] Confirm `NEW_WORK.md` and dated Git history provide challenge-period provenance.
- [ ] Confirm the repository's verification workflow passes from a locked `npm ci` install.
- [ ] Deploy the production build to public HTTPS. ChatGPT Sites is allowed; another static host is also acceptable.
- [ ] Open the deployed URL through the actual judging browser path.
- [x] Confirm local native discovery reports 19 tools in the in-app Browser.
- [ ] Repeat 19-tool discovery against the final public deployment.
- [ ] Confirm all 15 Build tools work before a trial and become safely locked during a trial.
- [x] Confirm locally that the four Operate tools work during a trial: `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, and `end_arm_trial`.
- [x] Record a local visible observation, correction, and result without using hidden coordinates or a semantic shortcut.
- [ ] Test reload persistence and a 390 px narrow viewport on the deployed URL.
- [x] Regenerate narration from the frozen script and measure it at **1:54.895**.
- [ ] Record the demo and retime the draft captions to the final audio.
- [ ] Upload the video publicly to YouTube and verify signed-out playback, speech audio, captions, and duration under three minutes.
- [ ] Add the live URL, public repository, video, and English description to Devpost.
- [ ] Recheck all three public links while signed out.
- [ ] Confirm challenge registration and entrant eligibility.
- [ ] Submit before the deadline.

No local build command publishes or mutates a remote service.

## Recommended demo — exact 2:18 cut

Use [submission-assets/demo-shot-list.md](./submission-assets/demo-shot-list.md) as the canonical timeline, [submission-assets/narration.txt](./submission-assets/narration.txt) for voiceover, and [submission-assets/captions.srt](./submission-assets/captions.srt) for the caption draft. The cut shows discovery, Build, the capability lock, restricted observation and telemetry, direct outputs, an observation-driven correction, the released result, and the honest kinematic boundary.

### Copy-ready agent task

> Use only this page’s WebMCP tools. In Build mode, load the Arm 101 preset and inspect the available arm, camera, and gripper authoring tools. Then call begin_arm_trial to start a blind can-tip trial. From that point onward, use only observe_arm_camera, get_arm_telemetry, set_arm_outputs, and end_arm_trial. Do not use object coordinates, scene state, inverse kinematics, or a semantic task shortcut. Observe the simulated camera, make one bounded joint or gripper output, observe again, and visibly correct your next attempt. Try to leave the practice can resting on its side. End the trial when the camera evidence is convincing or when further progress is no longer useful, and clearly state what the camera actually proved.

## Copy-ready project description

### What it does

RAI turns a browser tab into a shared robot-arm experiment. In Build mode, a person or WebMCP agent can start from Arm 101, create or edit a supported serial chain, configure its camera, author primitive scene objects, set a goal, test named grasps and poses, run joint sequences, and save a snapshot. Arm 101 includes a simulated gripper output; Build mode does not configure gripper hardware.

Starting a trial changes the rules. The can is reset to an unknown reachable placement, scene authoring locks, and the agent must operate from the same limited evidence a robot controller would receive: an ideal-pinhole camera observation plus basic arm telemetry. It can send joint and gripper outputs, observe the consequence, and retry. The person watches the same scene and a visible Observe → Sense → Act → Observe → Retry → Result timeline.

### Why WebMCP matters

Without WebMCP, an agent would have to guess screen coordinates or keep a second, hidden copy of the scene. RAI instead registers a fixed 19-tool imperative catalog in the top-level page and routes every valid action through the same revisioned store as the human interface.

The catalog is intentionally phase-aware. Fifteen broad authoring tools are usable in Build. Once the agent calls `begin_arm_trial`, only four Operate tools are usable: `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, and `end_arm_trial`. The other tools remain discoverable but return `PHASE_LOCKED` without leaking hidden state. This makes the constraint inspectable rather than relying on prompt obedience.

### What WebMCP newly enables

The useful artifact is not just the final arm pose; it is the visible attempt history. A user can watch an AI assemble an experiment, lose access to privileged authoring state, interpret its camera, make an attempt, notice the result, and correct itself. The agent gets stable structured controls while the person retains context and oversight in the same interface.

### How it was built

React and Three.js render original primitive geometry from a versioned scene model. Forward kinematics drive supported serial chains. Build tools author robots, cameras, objects, goals, poses, sequences, and snapshots. Trial tools expose a deliberately reduced observation/action contract. Camera observations use an analytic ideal-pinhole projection of simulated primitives. Grasping uses a bounded kinematic capture rule, then carries and rotates the captured primitive with the gripper until release. The WebMCP adapter registers all 19 tools with `document.modelContext.registerTool` and validates phase, input, revision, cancellation, and retry behavior before state changes reach the shared interface.

### Honest boundary

RAI is Isaac-Sim-inspired, not a browser replacement for Isaac Sim and not a physical robot controller. Arm 101 is a synthetic teaching preset, not a digital twin of the physical Arm Alliance hardware. The camera output is structured analytic projection data, not rendered pixels, learned perception, or physical camera evidence. Manipulation is deterministic kinematics with a bounded capture envelope, not rigid-body contact, friction, gravity, torque, collision, or sim-to-real proof. A successful browser trial demonstrates the WebMCP control loop only.

## Final proof to capture

- Public HTTPS URL and native WebMCP-ready state.
- Exactly 19 tools discovered.
- Arm 101 visibly loaded and instrumented in Build.
- The transition into the blind trial.
- A Build-only call returning `PHASE_LOCKED` during Operate without hidden state.
- Camera output with normalized detections only.
- Telemetry containing joints and gripper state only.
- At least one direct output command followed by a new observation.
- A visible correction or retry driven by that evidence.
- The shared scene/camera and Observe → Sense → Act → Observe → Retry → Result timeline.
- `end_arm_trial` returning to Build while the already-visible human-facing result remains on screen.
- Final automated gate results recorded without rounding or stale counts.
- Public repository, visible license, public video under three minutes, and signed-out access to every submitted link.
