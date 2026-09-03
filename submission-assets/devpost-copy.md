# RAI Devpost copy

## Submission identity

- **Title:** RAI — Robot Agent Interface
- **Final tagline:** Build the arm. Then take away the map.
- **Short description:** A browser robot-arm lab where WebMCP lets an AI build an experiment, then removes privileged scene access so people can watch it observe, act, and correct itself through a camera.

## Eight tagline directions considered

1. **Build the arm. Then take away the map.** — strongest statement of the two-phase product.
2. **Watch an AI learn through its camera.** — clearest plain-language benefit.
3. **An AI arm that has to look.** — compact constraint-first hook.
4. **The robot sees. The agent adapts.** — emphasizes the feedback loop.
5. **No coordinates. Just camera, joints, and retries.** — technical and specific.
6. **Give an agent an arm. Watch it learn.** — accessible demo framing.
7. **Robot reasoning, visible while it happens.** — human oversight angle.
8. **Robot control you can actually watch.** — transparent-interface angle.

**Pick:** Option 1. It is specific to RAI's Build-to-Operate permission change and creates curiosity without using category clichés.

## Copy-ready Devpost description

### What it does

RAI turns a browser tab into a shared robot-arm experiment. In Build, a WebMCP agent gets fifteen tools to load or author a serial arm, edit joints and links, configure a camera, place primitive objects, define a goal, test poses, run sequences, and save snapshots. The included Arm 101 preset provides a synthetic arm, wide camera, parallel gripper, practice can, and visible tipping goal.

Starting a trial changes the rules. The can moves to an unknown reachable placement and privileged scene access locks. All nineteen tools remain discoverable, but only four work: `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, and `end_arm_trial`. The agent cannot request object coordinates, inverse kinematics, hidden goal state, or a semantic `tip_can` action. It has to observe, command joints and the gripper, see what changed, and retry.

The person watches the same arm, camera view, and Observe → Sense → Act → Retry → Result history. In the verified local native-WebMCP run, camera evidence changed from a 96.393° upright long axis to 41.017° tipped. The human-facing interface showed the released can at 79.6° with the goal Done; that result was never exposed to the operating agent as a shortcut.

Across a separate 12-seed Operate-only sweep, RAI completed 12/12 first-try grasps, 12/12 camera-confirmed tips, and 12/12 post-end hidden goal checks with eight output calls on average. Camera-axis change ranged from 39.5° to 42.6°. The centered final frame was ambiguous, so the policy used a ±35° side-view retry; the post-end goal check remained audit-only and was never an operating shortcut.

### How it was built

React and Three.js render original primitive geometry from a versioned scene model. Deterministic forward kinematics drive the serial arm. Camera observations come from analytic ideal-pinhole projection. A bounded kinematic capture rule attaches, carries, rotates, and releases the practice object. The imperative WebMCP adapter registers nineteen schema-validated tools against the same revisioned store used by the human interface, with phase checks, optimistic revisions, cancellation, and request deduplication.

The current local gate passes TypeScript, 68/68 tests in 12 files, and a production build of 613 transformed modules.

### Why WebMCP matters

WebMCP gives the agent stable, inspectable controls without screen-coordinate guessing or a hidden parallel backend. More importantly, RAI changes which capabilities are valid as the experiment moves from authoring to operation. The restriction is enforced by the interface, not left to prompt obedience. That makes both the agent's capability boundary and its intermediate attempts visible to the person watching.

### Honest limitations

RAI is Isaac-Sim-inspired, not a browser replacement for Isaac Sim and not a physical-robot controller. Camera detections are structured analytic projections, not learned perception or real sensor pixels. Manipulation is deterministic kinematics, not collision response, contact force, friction, gravity, motor torque, or sim-to-real proof. Arm 101 is a synthetic teaching rig rather than a digital twin.

## Links — fill only after verification

- **Live app:** `[PENDING — root will insert verified public HTTPS URL]`
- **Public source:** https://github.com/over-TT/RAI
- **Demo video:** `[PENDING — insert public YouTube URL after signed-out playback check]`
- **Submitted commit:** `[PENDING — insert exact verified public commit]`
