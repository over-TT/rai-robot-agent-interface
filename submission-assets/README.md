# RAI Arm 101 demo capture package

This folder contains the copy-and-capture package for the current Arm 101 submission story. The planned cut is **2:18**, leaving 42 seconds below the challenge's three-minute limit.

## Files

- [`devpost-copy.md`](./devpost-copy.md) — title, eight tested tagline directions, final tagline, short description, full description, and URL slots.
- [`demo-shot-list.md`](./demo-shot-list.md) — exact 2:18 screen sequence and capture checklist.
- [`narration.txt`](./narration.txt) — final 2:18 pacing script.
- [`captions.srt`](./captions.srt) — caption draft aligned to the planned cut.
- [`judging-instructions.md`](./judging-instructions.md) — short reproduction path and expected results.

The text and timings are source assets, not proof that the final audio or video has been generated. Regenerate the narration after the product and copy are frozen, measure the resulting track, and retime the captions to that exact recording.

## Generate narration locally

On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-demo-narration.ps1
```

The helper creates the ignored local file `submission-assets/rai-narration.wav` from `narration.txt`. It uses local Windows text-to-speech and does not open the microphone or upload anything.

Any older WAV in this folder predates the final RAI script and must be replaced before recording. Voice choice changes timing, so **2:18 is the edit plan, not measured audio proof**, until the regenerated file is measured. Retiming `captions.srt` to the final voice track is still required.

## Capture sequence

1. Record at 1280 × 720 or larger with the native WebMCP state, shared 3D scene, camera view, trial phase, and activity timeline readable.
2. Begin in Build. Let the agent load the synthetic Arm 101 teaching rig, configure its camera, and prepare the practice can and goal. The rig already includes its simulated gripper.
3. Start the trial. Show the phase changing to Operate and the can resetting without revealing its placement to the agent.
4. Invoke one Build-only tool and retain the concise `PHASE_LOCKED` response as evidence that privileged scene access is unavailable.
5. Show the agent using only `observe_arm_camera`, `get_arm_telemetry`, and `set_arm_outputs` while the person sees the same attempt unfold.
6. Keep the first consequence visible long enough to understand, then show a corrected output after a new observation.
7. End the trial and show the already-visible human-facing result remaining on screen while Build unlocks again.
8. Briefly state the simulation boundary on screen or in narration.
9. Add the regenerated narration and retimed captions.
10. Export under three minutes, upload publicly to YouTube, and verify duration, speech audio, captions, and signed-out playback.

## Visual priorities

- Keep **Build / Operate** and **Observe → Sense → Act → Observe → Retry → Result** readable.
- Favor the arm, camera, and live attempt over inspector detail.
- Show one locked response, not a parade of errors.
- Let the first attempt and correction remain visible together.
- Do not reveal hidden object coordinates in the agent prompt, subtitles, cursor annotations, or debug panels.
- Do not imply that Arm 101 is a digital twin or that the user's physical desk arm has the simulated gripper.
- Use no unlicensed music, vendor footage, copied product meshes, or unauthorized third-party marks.

## Final checks

- [x] Narration regenerated from the current `narration.txt` as the ignored local file `rai-narration.wav`.
- [x] Audio measured at **1:54.895**, leaving 23.105 seconds inside the planned 2:18 cut and 65.105 seconds below the three-minute limit.
- [ ] `captions.srt` retimed and proofread against the final audio.
- [ ] Video shows native WebMCP tool use, not only human clicking.
- [ ] Tool discovery count and phase behavior match the submitted build.
- [ ] One observation-driven retry is visible.
- [ ] Boundary statement is audible and readable.
- [ ] Public YouTube playback works while signed out.
