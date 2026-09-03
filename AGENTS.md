# Working on RAI

RAI is browser-only. Do not connect physical hardware or require an API key. Read [README.md](README.md) and [docs/SETUP_WITH_AGENTS.md](docs/SETUP_WITH_AGENTS.md) first.

## Setup

Use Node.js `^20.19.0 || >=22.12.0`. Run `npm ci`, `npm run check`, then `npm run dev`. Reuse an existing checkout/server when appropriate. Preserve unrelated edits, saved scenes, and recordings. Do not commit secrets, dependencies, or generated `dist/`. Remote publication/access changes require the user's authorization.

## Source map

- `src/App.tsx`, `src/styles.css`: human UI, setup, replay.
- `src/components/RobotScene.tsx`, `SensorViewport.tsx`: world/camera rendering.
- `src/domain/`: types, validation, kinematics, commands, tasks, persistence.
- `src/webmcp/`: schemas, parser, dispatch, registration.
- `src/lib/runTimeline.ts`: recorded wall-clock frame selection.
- `WEBMCP_TOOLS.md`: exact tool contract.

## Keep the experiment honest

Human controls and WebMCP share validated dispatch. Preserve atomic guards, revisions, retry deduplication, cancellation, and activity.

During Operate, only `observe_arm_camera`, `get_arm_telemetry`, `set_arm_outputs`, and `end_arm_trial` may return usable results. Do not leak scene state through errors or metadata. Do not introduce a semantic shortcut such as `tip_can`.

When conducting a blind trial, do not inspect source, DOM goals, internal stores, or exported coordinates to choose outputs. Build preparation and post-end auditing are separate, labelled phases.

Separate automated tests, actual browser tool calls, hosting checks, and physical proof. Tool-route provenance is not authenticated model identity. Analytic detections are not pixels. Replay is not video or private reasoning. Never fabricate events, durations, attempts, or outcomes.

Keep the quiet dark workbench, usable human controls, and no mascot. Run `npm run check` before handoff and verify affected browser behavior when relevant.
