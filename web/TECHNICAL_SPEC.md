# Overshoot Auto-Editor (CUT / STABILIZE / BRIDGE) — Technical Spec

This document translates `SPEC.md` into an implementation-ready technical design. It assumes a hackathon-quality build that “roughly works”, prioritizing correctness of the timeline/plan over perfect ML detection.

## 1) Scope & Hard Requirements
- **Must use Overshoot API** for video stream + running vision inference on it (no custom live ingest pipeline).
- Detect **SHAKY vs GOOD** at **1 Hz** using ~**1 second** context (~8–12 frames).
- Model output must be **strict JSON only**:
  ```json
  {"ts": 12.0, "shaky": false, "confidence": 0.82}
  ```
  - `ts`: seconds since stream start (we compute/attach)
  - `shaky`: boolean
  - `confidence`: number in `[0, 1]`
  - If invalid JSON: fallback to `shaky=false, confidence=0`
- Smooth labels with **“2 of last 3”** + `confidence >= 0.95` override.
- Build segments (GOOD/SHAKY), allow per-shaky segment fix: **CUT / STABILIZE / BRIDGE (Veo)**.
- Export `edit_plan.json`; optionally render `final.mp4`.

## 2) Proposed Architecture (Minimal but Practical)
**Frontend (Review UI)**
- Start/Stop stream controls
- Live status: current tick label (GOOD/SHAKY) + confidence
- Timeline list of segments with dropdown for SHAKY segments: `CUT | STABILIZE | BRIDGE`
- Export button; optional Render button

**Backend (Coordinator)**
- Manages Overshoot session lifecycle
- Runs the 1 Hz inference tick loop
- Applies smoothing + segment building + cleanup pass
- Persists artifacts (`ticks.jsonl`, `segments.json`, `edit_plan.json`)
- Runs optional jobs:
  - `STABILIZE`: ffmpeg + vidstab per segment
  - `BRIDGE`: extract boundary frames + Gemini Veo async generation
  - final concatenation render

**Storage (Local FS)**
- `sessions/<session_id>/...` directory for all outputs (see §11).

This can be implemented as a single Next.js app (UI + API routes) or a small web UI + Node/Python backend. The technical contracts below are independent of framework.

## 3) Overshoot Integration (Session + Inference Ticks)

### 3.1 Session lifecycle
At minimum the backend needs to:
1) Create an Overshoot client (`OVERSHOOT_API_KEY`).
2) Create/start a stream session from a chosen source (webcam/phone/screen share/YouTube).
3) Start recording (or ensure the session yields a downloadable recording artifact on stop).
4) Run inference repeatedly at ~1 Hz while recording.
5) Stop session, fetch:
   - recording duration
   - recording file/URL (for frame extraction + ffmpeg rendering)

> Overshoot SDK method names are intentionally left abstract; adapt to actual SDK.

### 3.2 1 Hz tick loop
Each tick `k` covers the window `(k-1, k]` seconds relative to session start.

Implementation notes:
- Use the backend clock for the tick schedule; derive `ts = k` (or `ts = elapsed_s` rounded to 0.1).
- Request inference over the **last ~1 second** of video context (Overshoot window parameter or “last N frames” setting).
- Store the raw model response (string) for debugging.

### 3.3 Model prompt (strict JSON)
Prompt requirements:
- Must reference “last ~1 second of video”
- Must forbid any extra keys/text

Example prompt:
```
You are analyzing the last ~1 second of video (about 8–12 frames).
Return ONLY valid JSON with exactly these keys:
{"ts": <number>, "shaky": <boolean>, "confidence": <number 0..1>}
No other text.
Decide "shaky" if camera motion/jitter makes the footage unpleasant or choppy.
```

Backend behavior:
- Parse JSON strictly.
- If parse fails: `shaky=false, confidence=0`.
- Clamp confidence to `[0, 1]` (or treat out-of-range as invalid).
- Override/attach `ts` using the backend’s tick timestamp to prevent drift.

## 4) Data Model (Internal)

### 4.1 Tick result (raw)
Store one record per tick:
```json
{
  "tick": 12,
  "ts": 12.0,
  "window_start_s": 11.0,
  "window_end_s": 12.0,
  "raw": {"shaky": false, "confidence": 0.82},
  "parse_error": null
}
```

### 4.2 Smoothed tick (final_state)
Store:
```json
{"tick": 12, "ts": 12.0, "final_state": "GOOD"}
```

### 4.3 Segment
Align with `SPEC.md` and carry both suggestion and user override:
```json
{
  "id": "seg_0007",
  "start": 10.0,
  "end": 14.0,
  "type": "SHAKY",
  "confidence_avg": 0.74,
  "suggested_fix": "STABILIZE",
  "user_fix": null,
  "final_fix": "STABILIZE",
  "outputs": {}
}
```

## 5) Smoothing (2-of-3 + High-Confidence Override)

Maintain:
- `state ∈ {GOOD, SHAKY}`
- a ring buffer of the last 3 raw tick labels: `raw_shaky[]`

Definitions:
- `shaky_count = sum(raw_shaky over last up to 3 ticks)`
- `two_of_three_shaky = shaky_count >= 2` (when fewer than 3 ticks exist, use majority of available)
- `two_of_three_good = shaky_count <= 1` (same availability rule)

Transition rules (from `SPEC.md`):
- Switch into `SHAKY` if `two_of_three_shaky` **OR** current tick `confidence >= 0.95`.
- Switch back to `GOOD` if `two_of_three_good`.

Startup behavior (ticks 1–2):
- Apply the same majority rule on the available ticks so state is defined immediately.

## 6) Segment Builder (from smoothed ticks)

### 6.1 Construction
Given `final_state` per tick:
- Start the first segment at `t=0` using tick 1’s state.
- For each tick `k`:
  - If state unchanged: extend current segment end to `k`.
  - If changed: close current segment at `k-1..k` boundary, open a new segment starting at `k-1` (or `k`, depending on how you represent windows).

Recommended representation to avoid fencepost errors:
- Treat tick `k` as the interval `(k-1, k]` and set segment boundaries on integer seconds.

### 6.2 Segment confidence aggregation
For SHAKY segments:
- `confidence_avg = average(raw.confidence for ticks in segment)`
For GOOD segments:
- omit or set to `null` (not required)

## 7) Cleanup Pass (After Stop)
Apply the `SPEC.md` defaults:
- `MIN_GOOD = 1.0s`
- `MIN_SHAKY = 0.5s`
- `MERGE_GAP = 0.5s`

Rules:
1) If a GOOD segment duration `< MIN_GOOD`: merge into neighbors (treat as noise).
2) If a SHAKY segment duration `< MIN_SHAKY`: drop it (treat as noise).
3) If two GOOD segments are split by a tiny SHAKY gap `< MERGE_GAP`: merge into one GOOD segment.

Implementation detail:
- Because ticks are 1 Hz, segments are typically integer seconds; these thresholds mostly affect edge segments and any non-integer end-of-video duration.

## 8) Fix Suggestion + Validity Rules

### 8.1 Default suggestion (from `SPEC.md`)
- If SHAKY duration `<= 2.0s`: suggest `BRIDGE`
- Else: suggest `STABILIZE`

### 8.2 BRIDGE enabled/disabled
BRIDGE is selectable only when:
- segment duration `< 8.0s` (Veo max clip constraint)
- there is a preceding GOOD segment and a following GOOD segment (to extract boundary frames)
- a recording artifact exists for frame extraction

If BRIDGE is not allowed, UI disables it and backend rejects it.

## 9) BRIDGE (Gemini Veo first+last frame) Implementation

### 9.1 Inputs
For a SHAKY segment `[t0, t1]`:
- `first_frame_image`: from just before `t0` inside the preceding GOOD segment
- `last_frame_image`: from just after `t1` inside the following GOOD segment
- `prompt`: “keep same scene, same subject, smooth camera motion, no new objects”
- `duration_s`: `(t1 - t0)` (must be `< 8.0`)
- `resolution`: 720p (hackathon speed)
- `aspectRatio`: match the source recording

Choose an epsilon to avoid sampling inside the shaky region:
- `epsilon_s = 0.10` (tunable)
- `t_before = clamp(t0 - epsilon_s, good_prev.start, good_prev.end)`
- `t_after = clamp(t1 + epsilon_s, good_next.start, good_next.end)`

### 9.2 Extract boundary frames
Use ffmpeg on the downloaded recording file:
- `first.jpg`: frame at `t_before`
- `last.jpg`: frame at `t_after`

Example (conceptual):
```bash
ffmpeg -ss "$t_before" -i input.mp4 -frames:v 1 -q:v 2 first.jpg
ffmpeg -ss "$t_after"  -i input.mp4 -frames:v 1 -q:v 2 last.jpg
```

### 9.3 Veo call + polling
Veo is async:
1) `generateVideos(...)` with first/last frames + prompt + config
2) poll operation until done
3) download resulting mp4 to `bridges/<segment_id>.mp4`

Backend must store operation state so the UI can show “Generating…” and recover on refresh.

### 9.4 Post-processing
To make rendering deterministic:
- Trim/pad the generated clip to exactly `(t1 - t0)` seconds.
- Transcode to the project’s standard output settings (codec/fps/resolution) so concat is reliable.
- Mute bridge audio (either drop audio track or replace with silence).

### 9.5 Failure handling
If Veo generation fails:
- record error in segment `outputs.bridge_error`
- fall back automatically to `STABILIZE` (or require user choice); never block export

## 10) STABILIZE Implementation (ffmpeg + vidstab)

For each SHAKY segment with `final_fix=STABILIZE`:
1) Extract the segment to an intermediate file (`stabilize_in/<id>.mp4`).
2) Run `vidstabdetect` to produce transforms.
3) Run `vidstabtransform` to apply transforms into `stabilized/<id>.mp4`.
4) Keep original audio for that slice.

Example (conceptual):
```bash
# 1) slice
ffmpeg -ss "$t0" -to "$t1" -i input.mp4 -c copy stabilize_in/seg_0007.mp4
# 2) detect
ffmpeg -i stabilize_in/seg_0007.mp4 -vf vidstabdetect=shakiness=5:accuracy=15 -f null -
# 3) transform
ffmpeg -i stabilize_in/seg_0007.mp4 -vf vidstabtransform=smoothing=10 -c:a copy stabilized/seg_0007.mp4
```

Notes:
- Some `-c copy` slices may fail on non-keyframe boundaries; fall back to re-encode slices if needed.
- Stabilization may introduce borders; decide on crop/zoom policy via config.

## 11) Render Pipeline (Optional `final.mp4`)

### 11.1 Piece list construction
Convert segments into an ordered list of output “pieces”:
- GOOD → KEEP: original slice
- SHAKY + CUT → skip
- SHAKY + STABILIZE → stabilized file
- SHAKY + BRIDGE → generated bridge file

### 11.2 Normalize and concat
For simplest concat:
- Ensure every piece is encoded with identical:
  - resolution
  - fps
  - video codec/profile
  - audio sample rate/channel layout
- Ensure every piece has an audio track:
  - for BRIDGE: insert silence matching duration

Then concat pieces using ffmpeg concat demuxer or `filter_complex concat`.

### 11.3 Artifacts
Persist:
- `renders/final.mp4`
- `renders/pieces/0001.mp4`, `0002.mp4`, ...
- `renders/concat_list.txt` (if using concat demuxer)

## 12) `edit_plan.json` Export (Aligned to SPEC.md)

Required shape (minimum):
```json
{
  "version": 1,
  "duration": 63.4,
  "segments": [
    {"start": 0.0, "end": 10.0, "type": "GOOD", "final_fix": "KEEP"},
    {
      "start": 10.0,
      "end": 12.0,
      "type": "SHAKY",
      "confidence_avg": 0.78,
      "suggested_fix": "BRIDGE",
      "user_fix": null,
      "final_fix": "BRIDGE",
      "outputs": {"bridge_clip_path": "bridges/seg_001.mp4"}
    }
  ]
}
```

Recommended additions (still version 1, optional keys):
- `session_id`
- `source` (what was streamed)
- `ticks_hz` (=1)
- per-segment `id`
- per-segment `outputs.stabilized_clip_path` when applicable

## 13) Recommended Files/Directories (Local)
Within `sessions/<session_id>/`:
- `ticks.jsonl`
- `ticks_smoothed.jsonl`
- `segments_raw.json`
- `segments_final.json`
- `edit_plan.json`
- `bridges/`
- `stabilized/`
- `renders/`

## 14) Configuration (Env Vars)
- `OVERSHOOT_API_KEY`
- `OVERSHOOT_MODEL` (vision-capable model identifier)
- `GEMINI_API_KEY` (for Veo)
- `FFMPEG_PATH` (optional if not on PATH)
- `OUTPUT_ROOT` (defaults to `sessions/`)

## 15) Operational Notes / Risks
- Overshoot SDK capabilities (window selection, recording download) may differ; keep adapters thin and versioned.
- Veo job latency can be long; treat BRIDGE generation as a background job with polling + retries.
- Rendering requires ffmpeg + vidstab availability on the host.
