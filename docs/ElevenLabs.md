# ElevenLabs Speech-to-Text (Captions)

This document describes how Stitch uses ElevenLabs STT to generate captions for recorded sessions.

## Purpose
- Convert recording audio into timestamped transcript segments.
- Emit WebVTT captions that can be attached to the session.

## Flow
1. Resolve the recording URL to a local file (download if needed).
2. Extract mono 16 kHz WAV audio with ffmpeg.
3. POST the audio file to the ElevenLabs STT endpoint.
4. Parse the response into timestamped segments.
5. Filter filler words from segment text (for example "umm", "uh", "like").
6. Write `captions.vtt` into the session directory.

## Configuration
- `ELEVENLABS_API_KEY` (required)
- `ELEVENLABS_STT_URL` (optional, default `https://api.elevenlabs.io/v1/speech-to-text`)
- `ELEVENLABS_LANGUAGE_CODE` (optional, forwarded to the API)
- `ELEVENLABS_STT_MODEL_ID` (optional, forwarded to the API)
- `FFMPEG_PATH` (optional, default `ffmpeg`)
- `CAPTIONS_KEEP_AUDIO` (optional, set to `1` to keep the extracted audio file)

## Response parsing
- Prefer arrays at `segments`, `utterances`, `transcripts`, or `chunks`.
- Each segment is expected to have `start`/`end` plus text.
- If only word-level timings are returned, words are grouped into cues (max 6s or 84 chars).

## Filler word filtering
- Remove common filler tokens such as "umm", "uh", and filler-only "like".
- Be conservative: avoid removing legitimate words (for example "I like this").
- Normalize whitespace after removal; drop segments that become empty.

## Output
- Writes `captions.vtt` relative to the session directory.
- Throws if the API fails or no timestamped segments are found.

## Reference
- Implementation: `web/src/lib/captions.ts`
