# RAI — OpenAI WebMCP Challenge research

Research checked on September 3, 2026 against the official challenge page, Devpost overview, rules and resources, OpenAI's current Site Tools guidance, Chrome's WebMCP documentation, and the WebMCP Community Group draft.

## What the challenge rewards

The challenge asks entrants to make a website meaningfully operable by an AI agent through WebMCP while a person remains in the experience. The strongest interpretation is not a chatbot beside an ordinary app. It is a web product where native tools let the agent understand a task, take useful action, and make that work visible to the person.

RAI fits through one legible arm experiment:

1. In **Build**, the agent uses broad authoring tools to prepare the synthetic Arm 101 teaching rig, camera, objects, goal, and starting pose. The preset already includes a simulated gripper.
2. `begin_arm_trial` resets the practice can to an unknown reachable placement and enters **Operate**.
3. During Operate, the agent gets only an ideal-pinhole camera observation, basic joint/gripper telemetry, direct joint/gripper output, and the ability to end the trial.
4. The person sees the same scene and camera plus a visible Observe → Sense → Act → Observe → Retry → Result timeline.

The constrained loop is enforced by tools, not by asking the model to ignore privileged data.

## Judging criteria

Devpost lists four equally weighted criteria. **WebMCP Leverage** is the first tie-breaker.

### WebMCP Leverage

The top-level page registers a fixed 19-tool catalog through the imperative `document.modelContext.registerTool` API. Fifteen tools are usable while building. Once a trial starts, only `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, and `end_arm_trial` are usable. The remaining tools stay discoverable but return `PHASE_LOCKED` without hidden scene state.

This matters because the agent cannot read object coordinates, request the end-effector position, solve inverse kinematics, edit the scene, or call an outcome-specific action during the trial. It must close the loop through observation and direct outputs. Every accepted command updates the same visible state and timeline the person sees.

### Execution

The focused product includes:

- A synthetic Arm 101 starter rig with editable serial joints and links.
- Broad robot, camera, gripper, object, goal, pose, sequence, and snapshot authoring in Build.
- A hard Build-to-Operate transition.
- Analytic ideal-pinhole camera detections with normalized image bounds.
- Basic joint and gripper telemetry.
- Direct joint and gripper outputs with revision-aware validation.
- Kinematic capture, carry, rotate, and release for primitive scene objects.
- A shared 3D scene, camera view, trial status, and visible attempt timeline.
- A human-usable interface when WebMCP is unavailable.

Final browser discovery, automated checks, production build output, and hosted acceptance remain evidence tasks. [NATIVE_WEBMCP_EVIDENCE.md](./NATIVE_WEBMCP_EVIDENCE.md) intentionally leaves those results pending until they are rerun on the merged source.

### Potential Impact

The primary audience is robotics learners, makers, and researchers exploring how an agent behaves under a controlled observation/action contract. They can prototype an arm and its experiment without first installing a heavyweight simulator, then watch where the agent looks, what it commands, whether it succeeds, and how it corrects itself.

The synthetic Arm 101 preset is a teaching rig, not a digital twin of the user's physical Arm Alliance hardware. Its simulated gripper and camera make the browser experiment useful without implying that the same hardware exists or moved in the real world. The physical rig currently has no installed gripper/tool actuator matching the simulated one.

### Creativity & Ambition

RAI combines a broad authoring surface with a deliberately narrow execution surface. The agent can design the experiment, but once it begins, its privileges collapse to perception, telemetry, actuation, and termination. The person sees the AI's attempts rather than only a polished final state. That makes failure and retry part of the product's evidence.

## Submission requirements

- **Deadline:** September 3, 2026 at 1:00 PM PDT (20:00 UTC / 22:00 Europe/Zurich).
- A consistently runnable public URL reachable through the judging browser path. ChatGPT Sites is listed as an allowed host.
- Native use of the imperative `document.modelContext.registerTool` API in the top-level page.
- A public GitHub, GitLab, or Bitbucket repository containing source, assets, setup instructions, and a clearly visible open-source license.
- A public YouTube demonstration under three minutes with explanatory audio and no unlicensed music or unauthorized third-party marks.
- An English project description explaining why WebMCP fits, how it improves the experience, what the person and agent do together, and how the project was implemented.
- A new project built during the submission period, or meaningful WebMCP work created after August 25, 2026 with dated evidence.
- Free public access through judging, which ends September 21, 2026 at 5:00 PM PDT.
- No edits to the submitted entry after the deadline.

Publishing, hosting, repository creation, video upload, and Devpost submission are owner-controlled actions. Local development commands do not perform them.

## Current browser API constraints

The Community Group draft exposes the imperative API at `document.modelContext`. A tool is registered with a name, description, JSON Schema input, annotations, and an `execute` callback. Registration can be cleaned up through the supplied `AbortSignal`, and each invocation can carry its own cancellation signal.

Current ChatGPT guidance requires imperative tools in the top-level document; declarative HTML tools and tools registered inside iframes are not supported there. The API is experimental, secure-context-only, and must be feature-detected. RAI therefore remains usable by a person when WebMCP is unavailable. It returns concise JSON-safe values and performs its own runtime validation rather than assuming schema enforcement is sufficient.

For current ChatGPT testing, use the latest desktop app and its built-in browser with a supported model and rollout. The official fallback is a current WebMCP-capable Chrome build with its WebMCP testing feature enabled. Recheck the live official guidance immediately before the final recording because product availability can change.

## Product decision

The challenge build is intentionally arm-only. Its main path is:

```text
Build Arm 101 → Begin blind trial → Observe → Sense → Act → Observe → Retry → End / Result
```

Build retains the broad foundry value: an agent can start from a preset, create another supported serial robot, edit its chain, configure a camera, author primitive objects and a goal, try poses and sequences, manipulate objects, and save a snapshot. Operate removes all privileged authoring and semantic task shortcuts.

The fixed catalog is:

- **Build-usable (15):** `list_robotics_presets`, `get_simulation_state`, `load_robot_preset`, `create_custom_robot`, `edit_robot_chain`, `set_joint_positions`, `move_end_effector`, `configure_camera`, `edit_scene_objects`, `control_grasp`, `move_grasped_object`, `set_simulation_goal`, `run_joint_sequence`, `save_simulation_snapshot`, `begin_arm_trial`.
- **Operate-usable (4):** `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, `end_arm_trial`.

All 19 stay registered. In Operate, the 15 Build tools return `PHASE_LOCKED` and do not reveal hidden state.

## Evidence discipline

The final submission should distinguish four proof tiers:

- **Source proof:** the phase guard, schemas, and shared-store wiring exist in code.
- **Automated proof:** the current typecheck, tests, and production build pass with exact recorded counts.
- **Native-browser proof:** the judging browser discovers 19 tools and completes the constrained observe/act/retry flow.
- **Hosted proof:** the same behavior works from the final public HTTPS URL while signed out.

None of those tiers is physical-robot proof. Camera observations are analytic ideal-pinhole projections of simulated primitives, not rendered or physical pixels. Grasp behavior is a bounded kinematic capture and attachment model, not collision/contact dynamics, gravity, friction, torque, or actuator behavior. The synthetic Arm 101 teaching preset includes a simulated gripper and must not be described as a hardware twin.

## Official sources

- [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/)
- [Devpost overview](https://webmcp.devpost.com/)
- [Official rules](https://webmcp.devpost.com/rules)
- [Official resources](https://webmcp.devpost.com/resources)
- [OpenAI Site Tools guidance](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/)
- [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp)
- [Chrome imperative API guide](https://developer.chrome.com/docs/ai/webmcp/imperative-api)

Hardware preset reference sources:

- [Raspberry Pi camera hardware specifications](https://www.raspberrypi.com/documentation/accessories/camera.html)
- [ROBOTIS OpenMANIPULATOR-X specification](https://emanual.robotis.com/docs/en/platform/openmanipulator_x/specification/)
- [ROBOTIS OpenMANIPULATOR source repository](https://github.com/robotis-git/open_manipulator)
- [Universal Robots UR5e technical specifications](https://www.universal-robots.com/manuals/EN/HTML/SW5_19/Content/prod-usr-man/complianceUR5e/H_g5_sections/appendix_g5/tech_spec_sheet.htm)
- [Luxonis OAK-D Lite specifications](https://docs.luxonis.com/hardware/products/OAK-D%20Lite)

See [HACKATHON_SCORECARD.md](./HACKATHON_SCORECARD.md) for the evidence map and [SUBMISSION.md](./SUBMISSION.md) for the owner handoff.
