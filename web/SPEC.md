````md
# Overshoot Auto-Editor: CUT / STABILIZE / BRIDGE (Spec)

https://docs.overshoot.ai/

## 1) Hard requirements (from sponsor)
- **Must use the Overshoot API** for the video stream + running vision inference on it.
- App **should roughly work** (best effort is fine).

## 2) What we are building
We take a video stream (webcam, phone camera, screen share, or YouTube), detect **shaky/choppy** parts, then turn the recording into segments.

For each **shaky segment**, we support **3 options**:
1) **CUT**: remove it
2) **STABILIZE**: keep it and apply stabilization
3) **BRIDGE (Veo)**: generate a smooth connecting clip using the **first frame and last frame** around the shaky region

We also support **manual review** so a person can change the option per segment.

## 3) User flow (simple)
1) Start stream
2) While stream runs: we tag time ranges as **GOOD** or **SHAKY**
3) Stop stream
4) Review timeline:
   - each shaky segment has a dropdown: CUT / STABILIZE / BRIDGE
5) Export an `edit_plan.json`
6) Optional: render a final video using the plan

## 4) Overshoot usage (required)
We use Overshoot as the video streaming + inference layer:
- Overshoot connects to a video source (phone camera, webcam, livestream, screen share, YouTube).
- Overshoot runs a vision-capable model on the stream (we drive it with prompts and get outputs back).
- We do NOT build our own video ingest pipeline.

### 4.1 Overshoot integration needs (minimum)
(Exact function names come from the provided Overshoot SDK docs.)

We need:
- Create client with API key
- Create a stream session from a source
- Run repeated inference “ticks” on the stream:
  - every tick should cover roughly the last ~1 second of video context
  - model response must be parseable (JSON)

Example shape (placeholder):
- `overshoot.connect(source)`
- `overshoot.infer({ model, prompt, window })`
- `overshoot.onResult(cb)` or `await overshoot.infer(...)`

## 5) What we detect (scope)
Main scope: **shaky segments**.

We only care about answering:
- “Is this second shaky enough that it needs a fix?”
- If yes, save `reason = "shaky"` and a confidence.

Optional later:
- blur, exposure, subject missing, stutter
But not required for v1.

## 6) Inference tick design (how we label shaky)
### 6.1 Tick rate
- Run inference at **1 Hz** (once per second).
- Each tick should use ~1 second of visual context (ex: 8–12 frames).

### 6.2 Model output contract (strict JSON)
For each tick, we require ONLY this JSON:
```json
{
  "ts": 12.0,
  "shaky": false,
  "confidence": 0.82
}
````

Rules:

* `ts` is seconds since stream start (we attach this)
* `shaky` is boolean
* `confidence` is 0..1

If output is invalid JSON:

* fallback to `shaky=false, confidence=0`

### 6.3 Prompt requirement

Prompt must force the model to decide shakiness from the last ~1 second of video.
No long text. No extra keys. JSON only.

## 7) Smoothing (no flicker)

We do not want shaky/ok to flip every second.

Use “2 of last 3” smoothing:

* Switch into SHAKY if **2 of last 3** ticks are shaky OR current tick confidence >= 0.95
* Switch back into GOOD if **2 of last 3** ticks are not shaky

Output each second:

* `final_state ∈ { GOOD, SHAKY }`

## 8) Segment building

We convert per-second `final_state` into segments.

### 8.1 Segment structure

```json
{
  "start": 10.0,
  "end": 14.0,
  "type": "SHAKY",
  "confidence_avg": 0.74,

  "suggested_fix": "STABILIZE",
  "user_fix": null,
  "final_fix": "STABILIZE"
}
```

Segment types:

* `GOOD`
* `SHAKY`

### 8.2 Building logic

* Start at t=0 with the first `final_state`.
* Each second:

  * if state unchanged: extend segment
  * if changed: close segment, open new one

### 8.3 Cleanup pass (after stop)

Defaults:

* `MIN_GOOD = 1.0s`
* `MIN_SHAKY = 0.5s`
* `MERGE_GAP = 0.5s`

Rules:

* If a GOOD segment < MIN_GOOD, merge it into neighbors (treat as noise).
* If a SHAKY segment < MIN_SHAKY, drop it (treat as noise).
* If two GOOD segments are split by a tiny SHAKY gap < MERGE_GAP, merge into one GOOD segment.

## 9) Fix options (only for SHAKY segments)

Each SHAKY segment supports:

* **CUT**
* **STABILIZE**
* **BRIDGE (Veo)**

GOOD segments are always KEEP.

### 9.1 Default suggestion

* If shaky segment duration <= 2.0s: suggest **BRIDGE**
* Else: suggest **STABILIZE**
  User can change it.

## 10) CUT

* Remove the shaky time range from the final output.
* Easiest possible path.

## 11) STABILIZE

Goal: keep the segment but reduce shake.

Implementation target:

* Use ffmpeg stabilization (vidstab) on the exact time slice:

  * detect transforms
  * apply transforms
* Keep original audio for that slice (default).

## 12) BRIDGE (Gemini Veo first+last frame)

Goal: replace the shaky region with a generated clip that smoothly connects:

* the last stable frame BEFORE the shaky segment
* the first stable frame AFTER the shaky segment

### 12.1 When BRIDGE is allowed

- When the shaky segment is less than 8 seconds long. This is because VEO supports a max of 8 second long video clips that can be generated.

### 12.2 Inputs to Veo

For shaky segment `[t0, t1]`:

* `first_frame_image`: extracted at ~`t0 - small_epsilon` inside the GOOD segment before it
* `last_frame_image`: extracted at ~`t1 + small_epsilon` inside the GOOD segment after it
* `prompt`: “keep same scene, same subject, smooth camera motion, no new objects”
* config:

  * `lastFrame`: last_frame_image
  * `aspectRatio`: match original (16:9 or 9:16)
  * `resolution`: 720p for speed (hackathon)

### 12.3 Veo call pattern (Gemini API)

Veo video generation is async:

* call `generateVideos(...)`
* poll operation until done
* download returned video file

We store the generated clip path and use it in rendering.

### 12.4 Audio rule for bridge

Default:

* mute bridge clip audio
  Optional later:
* crossfade original audio around the bridge boundaries

## 13) Review UI (minimum)

We only need:

* timeline of segments
* for each SHAKY segment: dropdown { CUT, STABILIZE, BRIDGE } with BRIDGE disabled when not allowed
* export button

No advanced editor features needed.

## 14) Export: edit_plan.json

Export a single file that fully describes the final decision.

```json
{
  "version": 1,
  "duration": 63.4,
  "segments": [
    {
      "start": 0.0,
      "end": 10.0,
      "type": "GOOD",
      "final_fix": "KEEP"
    },
    {
      "start": 10.0,
      "end": 12.0,
      "type": "SHAKY",
      "confidence_avg": 0.78,
      "suggested_fix": "BRIDGE",
      "user_fix": null,
      "final_fix": "BRIDGE",
      "outputs": {
        "bridge_clip_path": "bridges/seg_001.mp4"
      }
    },
    {
      "start": 12.0,
      "end": 63.4,
      "type": "GOOD",
      "final_fix": "KEEP"
    }
  ]
}
```

## 15) Optional: final render pipeline

If we render a final video:

* Build an ordered list of clip pieces:

  * KEEP: original slices
  * CUT: skipped
  * STABILIZE: stabilized slice file
  * BRIDGE: bridge slice file
* Concatenate with ffmpeg.

## 16) Implementation checklist (for an AI coding agent)

1. Overshoot stream session + receive timestamps
2. 1 Hz inference ticks on last ~1 second window
3. Parse JSON contract, store tick results
4. Smoothing (2 of last 3) -> stable GOOD/SHAKY
5. Segment builder + cleanup pass
6. Review timeline + per-segment fix selection
7. Export `edit_plan.json`
8. CUT support (skip segments)
9. STABILIZE support (ffmpeg vidstab)
10. BRIDGE support:

    * extract boundary frames
    * call Veo first+last frame generation
    * poll, download, trim
11. Optional: render final output

```

Source notes (for the requirements and the Veo behavior):
- Overshoot description and “must use Overshoot API / should roughly work” comes from the NexHacks track page. :contentReference[oaicite:0]{index=0}  
- Veo “frame-specific generation” with first and/or last frames, plus the `generateVideos` async flow, comes from Google’s Gemini API Veo docs and Google’s developer blog. :contentReference[oaicite:1]{index=1}
::contentReference[oaicite:2]{index=2}
```
