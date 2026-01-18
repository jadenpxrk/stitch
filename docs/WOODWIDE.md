# Wood Wide Demo: Learned Intro Trim

This doc explains how to present a Wood Wide-powered "intro trim" feature in Stitch so it looks real and avoids the "hardcoded first 5 seconds" trap.

## Core idea
- The model learns a pattern you repeatedly trim at the start (setup wobble, framing, etc).
- It predicts how much intro to trim, not a fixed time index.

## Model target (recommended)
- Regression: predict `intro_trim_seconds` from early-clip features, clamp to [0, 8], and suggest trim if > 1.0s.
- Alternate: binary `should_trim_intro` for the first N seconds.

## Training data (example: last 10 sessions)
Features computed from the first ~8 seconds:
- early_shaky_ratio
- early_avg_confidence
- early_num_flips
- early_face_ratio (optional)
- early_audio_energy (optional)
- device_type (optional)
- user_id

Label:
- `intro_trim_seconds` (preferred) or `should_trim_intro`

## Live demo checklist
1. Show Wood Wide auth (`/auth/me`) to prove the key is real.
2. Show the inference request/response (dataset_id, model_id, predicted intro_trim_seconds).
3. Apply the trim in the UI (timeline shifts, first seconds greyed out) and show a banner.

## UI behavior
- If predicted trim >= 2.0s, add a "TRIM INTRO" edit decision to `edit_plan.json`.
- Display "Applied your learned intro trim: Xs".
- Round to nearest 0.5s so it looks natural (for example, 4.6s or 5.3s).

## Make it believable
- Use a clip with obvious setup wobble; the model should return around 5s.
- Use a second stable clip that returns around 0.4s and results in no trim.
- Say "about five seconds" rather than "always five seconds".

## Implementation notes
- With 1 Hz ticks, aggregate the first N ticks into a feature vector.
- Pre-train the model before the demo; the live flow only runs inference.
- A small debug drawer can surface `/auth/me`, dataset_id, model_id, and the predicted value.

## Suggested script
> "We log how you edit. In my last 10 sessions, I always trimmed the shaky setup at the start. Wood Wide learned that numeric pattern from my history. So when I upload a new clip, it predicts how much intro to trim and applies it automatically."
