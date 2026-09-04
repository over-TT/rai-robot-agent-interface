# Set up RAI with an agent

[Public workbench](https://arm-lab-camera-robot.overtt.chatgpt.site/#workbench) · [ChatGPT handoff](https://arm-lab-camera-robot.overtt.chatgpt.site/?setup=1) · [Source](https://github.com/over-TT/RAI)

## 1. Hosted or local

The hosted page needs no installation, API key, physical robot, backend, or separate MCP server. For local development:

```sh
git clone https://github.com/over-TT/RAI.git
cd RAI
npm ci
npm run check
npm run dev
```

Use Node.js `^20.19.0 || >=22.12.0`; Node 22.12.0 is pinned for CI. Open Vite's printed URL, normally `http://127.0.0.1:4176`. Read [AGENTS.md](../AGENTS.md) before code changes. Preserve existing work.

To choose a strict port: `npm run dev -- --port 4199 --strictPort`.

Production preview: `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 4177 --strictPort`.

## 2. Discover the page tools

Use your browser integration's WebMCP discovery mechanism. RAI registers through `document.modelContext`; it is not a standalone `/mcp` endpoint. Discovery should expose **19 tools**. Confirm with a read-only `list_robotics_presets` call before claiming a connection.

A compatible ChatGPT desktop browser can open RAI beside a conversation. Account/app support varies; see [OpenAI's current guide](https://learn.chatgpt.com/docs/webmcp). A normal ChatGPT web tab is not automatically connected to another page's tools.

The setup dialog offers desktop and web links plus a copyable prompt. Links prepare the message; they do not auto-send it or grant permission. The desktop link opens the public workbench, not a copy of a local scene. Use JSON export/import to move browser-local work.

## 3. Prepare in Build mode

These examples are tool names and JSON arguments, not a universal JavaScript calling API. Use the integration's supported interface.

Call `list_robotics_presets` with `{ "detailed": true }` and `get_simulation_state` with `{ "detailed": true, "includeActivity": true }`.

For a fresh scene, or after the user agrees to replace it, call `load_robot_preset`:

```json
{ "presetId": "arm-101", "keepObjects": false, "requestId": "setup-arm-101" }
```

Arm 101 includes the arm, wide camera, gripper, bench, and can. Other Build tools create serial arms, edit joints/links, configure cameras, edit primitive objects, set goals, test grasps, run sequences, and save snapshots. Read the discovered schemas; do not invent parameter names. Gripper hardware geometry is not arbitrarily configurable.

For coordination, set `expectedRevision` from a fresh state read. Use a new `requestId` for a new command; reuse it only for the same retry. Successful request deduplication is bounded and session-local.

## 4. Conduct a constrained attempt

Call `begin_arm_trial`:

```json
{ "randomizeCan": true, "seed": 101, "requestId": "trial-101-start" }
```

Use `randomizeCan: false` for a custom scene. A camera is required. The trial selects the first Camera Module 3 Wide reference, otherwise the first camera. It does not take a `cameraId`. Starting clears any Build grasp and opens the gripper.

Until ending, use only:

1. `observe_arm_camera` with `{}`.
2. `get_arm_telemetry` with `{}`.
3. `set_arm_outputs` with bounded joint targets and/or `gripper: "open"` / `"close"`.
4. `end_arm_trial` when observations support a conclusion or further progress is not useful.

Example output shape—not a route or task solution:

```json
{
  "jointTargets": [{ "jointId": "a101-base", "value": 8 }],
  "gripper": "open",
  "requestId": "trial-101-output-1"
}
```

Choose actual outputs from fresh camera images and telemetry, then observe again. `observe_arm_camera` returns a JPEG in its `content` array; display and inspect it using your host's image support. Do not substitute hidden scene reads if images cannot be displayed. An empty view is not success. A close command is not proof of capture; inspect `gripper.holding`. `gripper: "unchanged"` alone is not an output.

Do not read world positions, hidden goals, source coordinates, DOM state, or exported scene data during a blind run. Do not use IK, named-object grasp, or scene edits. Build tools must return `PHASE_LOCKED` without privileged payloads.

End with `end_arm_trial` and `{ "requestId": "trial-101-end" }`. Ending does not itself report success. Explain what the camera-frame observations support. Label any later hidden-state audit separately; it was not control input.

## 5. Watch and replay

**Run** shows actual recorded tool activity. **Replay 1×** preserves original pauses; click a step or **Next** to inspect it. The robot and camera inset reconstruct recorded scene states—not continuous video or the agent's private reasoning.

Pick an attempt in **Run** to inspect older recordings. Up to six runs and 120 events per run are retained in the current browser. Long runs can omit middle events while preserving a real pose anchor before the retained tail. A new public-site visitor does not receive another browser's recordings. Export JSON from the file menu to retain/move a project. A storage conflict warning means another tab saved newer work: export the current tab before reloading it. The app does not silently overwrite the other tab's saved work.

## Troubleshooting

| Result | Next step |
| --- | --- |
| No tools | Check the browser/account capability and page tool status; do not claim a connection. |
| `PHASE_LOCKED` | Stay with the four Operate tools, or end before editing. |
| `REVISION_CONFLICT` | Read fresh state in Build and reconsider the change. |
| `REQUEST_ID_REUSED` | Use a fresh ID for different arguments. |
| `INVALID_INPUT` / `LIMIT_EXCEEDED` | Follow the schema and current limits; no partial edit should occur. |
| `NOT_FOUND` | Inspect current IDs in Build, rather than guessing. |
| `CONFLICT` | Check active-run state and camera availability. |
| Empty camera view | Change viewpoint through bounded joints and observe again. |
| `CAMERA_UNAVAILABLE` | Wait for the renderer to become ready and retry; do not treat this as an observation or read hidden scene data. |
| Gripper not holding | Inspect and adjust; accepted output is not capture proof. |
| Storage unavailable | Export before leaving the page. |

## Limits

JSON imports have a 64 MiB resource limit, checked before file reading and again before parsing. Browser auto-save quotas are smaller and browser-dependent; export if the app warns that saving failed. Very large projects can exceed the import budget, so keep separate project files for large experiments.

This is kinematics plus rendered pinhole images, not real contact physics. Released primitives keep their orientation and instantly settle vertically onto horizontal fixed supports or the floor. There is no falling dynamics, bounce, friction, motor torque, camera noise, or real-servo arrival. A successful result proves this browser simulation only.

[Full tool contract](../WEBMCP_TOOLS.md) · [Verification receipts](../NATIVE_WEBMCP_EVIDENCE.md) · [Open RAI](https://arm-lab-camera-robot.overtt.chatgpt.site)
