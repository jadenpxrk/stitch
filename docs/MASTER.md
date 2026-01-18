# Stitch AI Docs Master

This document ties together the three AI-related markdown files in this repo. Use it as the entry point for understanding how captions, assistant behavior, and the Wood Wide demo story fit together.

## Document index
- `ElevenLabs.md` - Speech-to-text captions pipeline and output behavior.
- `General_Purpose.md` - Default assistant behavior and tool usage policy.
- `WOODWIDE.md` - Demo narrative for Wood Wide "learned intro trim" inference.

## ElevenLabs.md (Captions)
This doc defines the end-to-end STT flow for generating captions from a recorded session. It is intentionally pragmatic: get the audio, transcribe, normalize, and emit a stable VTT file that the UI can attach to a session.

Key responsibilities:
- Resolve the recording source (local file vs URL) and download when needed.
- Extract audio with ffmpeg into a format ElevenLabs expects (mono, 16 kHz WAV).
- Send the audio to the ElevenLabs STT endpoint with optional model/language settings.
- Parse returned segments or words into timestamped cues.
- Filter filler words (for example "umm", "uh", filler-only "like") to improve readability.

Why it matters:
- Captions are a user-facing artifact, so readability matters as much as alignment.
- Filler-word filtering is the first UX pass on transcript cleanup without changing the timeline.
- Errors should be loud; "no timestamped segments" is considered a failure, not a soft warning.

Operational notes:
- If the STT API shape changes, update the segment discovery logic first.
- Keep filler filtering conservative; false removals can be more harmful than leaving filler in.
- Use this doc to confirm environment variable names and defaults.

## General_Purpose.md (Assistant Behavior)
This doc defines the default assistant profile and the rules for tool usage. It is the guardrail for safety and for future product evolution.

Key responsibilities:
- Provide concise, clarifying guidance for generic requests.
- Avoid changing user workflows without explicit instruction.
- Ensure tools are available to the agent but invoked in a flexible, future-proof way.

Why it matters:
- Tool calls can implicitly change the product UI/UX; the assistant must not assume fixed UI flows.
- The adapter approach (capability name -> concrete tool call) lets the UI evolve without rewriting assistant guidance.
- The doc establishes a shared policy for when to ask, when to proceed, and how to avoid side effects.

Operational notes:
- Keep tool references capability-focused (what it does) instead of UI-focused (where to click).
- Confirm intent and parameters before any state-changing action.
- Update the adapter layer when tools or UI change; do not hard-code tool invocation details into responses.

## WOODWIDE.md (Learned Intro Trim Demo)
This doc is a demo narrative guide. It explains how to present a Wood Wide inference in a way that feels real and avoids looking like a gimmick.

Key responsibilities:
- Frame the model as learning a pattern ("setup wobble") rather than trimming a fixed time.
- Define a simple regression target (`intro_trim_seconds`) with clear feature inputs.
- Show the inference process explicitly (auth, request, response) so the demo is credible.

Why it matters:
- Audiences are quick to spot hardcoded behavior; this doc preempts that skepticism.
- The "learned intro trim" story fits the existing 1 Hz tick data model and does not require new pipelines.
- UI proof (timeline shift + banner) makes the inference tangible.

Operational notes:
- Pre-train the model before the demo; only inference happens live.
- Use two contrasting clips to show the model can both trim and not trim.
- A small debug drawer that surfaces dataset_id/model_id/prediction is a strong credibility signal.

## How these docs fit together
- `ElevenLabs.md` improves the session output (captions) and is the most user-visible post-processing step.
- `General_Purpose.md` controls assistant behavior, protecting UX while keeping tools accessible.
- `WOODWIDE.md` focuses on demo narrative and credibility, not production integration.

If you update any one of these, consider whether the others need alignment (for example, new assistant capabilities or new captioning behavior).
