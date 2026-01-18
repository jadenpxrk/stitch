# Veo 3.1 Stitch Agent (fal.ai)

## Overview

This project’s “stitch agent” generates a short **bridge clip** between two adjacent segments by calling **Veo 3.1 First/Last Frame → Video** on **fal.ai**, then post-processing the result so it can be concatenated into our render pipeline.

In `web/src/lib/renderPipeline.ts`, bridge generation is optional and wired via:
- `VEO_BRIDGE_CMD`: external command invoked as `VEO_BRIDGE_CMD <first.jpg> <last.jpg> <out.mp4> <durationSeconds>`
  - If `VEO_BRIDGE_CMD` points to a `.js`/`.mjs`/`.cjs` file, the pipeline will run it via `node` automatically (no `chmod +x` required).

If the command is not set (or you disable it), the pipeline falls back to an FFmpeg crossfade.

## fal API Endpoint

Recommended (best quality):
- `fal-ai/veo3.1/first-last-frame-to-video`

Faster/cheaper:
- `fal-ai/veo3.1/fast/first-last-frame-to-video`

## Installation

```bash
npm install --save @fal-ai/client
```

## Authentication

```bash
export FAL_KEY="YOUR_FAL_KEY"
```

```ts
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });
```

## Request Schema (First/Last Frame → Video)

| Field | Type | Required | Notes |
|------|------|----------|------|
| `prompt` | `string` | Yes | Describe how motion should connect the frames. |
| `first_frame_url` | `string \| Blob \| File` | Yes | First frame image (URL or uploaded file). |
| `last_frame_url` | `string \| Blob \| File` | Yes | Last frame image (URL or uploaded file). |
| `duration` | `"4s" \| "6s" \| "8s"` | No | Choose the smallest value ≥ desired duration, then time-warp to the exact segment duration (e.g. `setpts`). |
| `resolution` | `"720p" \| "1080p"` | No | Pick the closest to your recording, then scale to match exact concat requirements. |
| `aspect_ratio` | `"auto" \| "16:9" \| "9:16"` | No | Use `"auto"` unless you must force. |
| `generate_audio` | `boolean` | No | Defaults to `true`; we recommend `false` and add silence in post. |
| `auto_fix` | `boolean` | No | Let fal auto-rewrite prompts that fail validation. |

### Response

`video` is a `File` object:

```json
{
  "video": {
    "url": "https://.../generated.mp4",
    "content_type": "video/mp4",
    "file_name": "..."
  }
}
```

## Minimal TypeScript Example (fal.subscribe)

This example:
1) Uploads `first.jpg` and `last.jpg` automatically by passing `Blob`s
2) Calls Veo 3.1 via fal’s queue-backed `subscribe`
3) Downloads the generated MP4

```ts
import fs from "node:fs/promises";
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });

const ENDPOINT = "fal-ai/veo3.1/first-last-frame-to-video";

function pickDurationSeconds(targetSeconds: number): "4s" | "6s" | "8s" {
  if (targetSeconds <= 4) return "4s";
  if (targetSeconds <= 6) return "6s";
  return "8s";
}

export async function generateBridgeRaw(opts: {
  firstJpgPath: string;
  lastJpgPath: string;
  targetSeconds: number;
  outRawMp4Path: string;
}) {
  const firstBlob = new Blob([await fs.readFile(opts.firstJpgPath)], { type: "image/jpeg" });
  const lastBlob = new Blob([await fs.readFile(opts.lastJpgPath)], { type: "image/jpeg" });

  const result = await fal.subscribe(ENDPOINT, {
    input: {
      prompt: "Keep the same scene and subject. Smooth camera motion. No new objects.",
      first_frame_url: firstBlob,
      last_frame_url: lastBlob,
      duration: pickDurationSeconds(opts.targetSeconds),
      aspect_ratio: "auto",
      resolution: "720p",
      generate_audio: false,
      auto_fix: true,
    },
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_QUEUE") console.log("fal queue position:", update.queue_position);
      if (update.status === "IN_PROGRESS") console.log("fal running…");
    },
  });

  const videoUrl = result.data.video.url;
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Failed to download Veo output: ${res.status} ${res.statusText}`);
  await fs.writeFile(opts.outRawMp4Path, Buffer.from(await res.arrayBuffer()));
}
```

## Making the Output Concat-Safe (FFmpeg)

Our renderer concatenates pieces with `-c copy`, so the bridge must match the project’s standard encoding:
- H.264 (`libx264`), `yuv420p`, 30 FPS
- AAC stereo @ 44.1 kHz
- Exact target duration (trim/pad)
- Same frame size as the other pieces (match your recording)

Conceptual post-process (time-warp the full Veo clip to match the shaky segment length, then pad with the last frame so the clip still ends cleanly):

```bash
ffmpeg -y \
  -i raw.mp4 \
  -f lavfi -t "$DURATION" -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -map 0:v:0 -map 1:a:0 -shortest \
  -vf "setpts=$SPEED*PTS,tpad=stop_mode=clone:stop_duration=1,format=yuv420p" \
  -t "$DURATION" -c:v libx264 -pix_fmt yuv420p -r 30 \
  -c:a aac -ar 44100 -ac 2 \
  out.mp4
```

If your recording is not exactly 720p/1080p, add a `-vf scale=...` (use the dimensions of `first.jpg`) so concat doesn’t fail.

## Wiring Into This Repo

This repo includes a ready-to-use bridge command:
- `web/scripts/veo-bridge.mjs`

1) Install the client dependency in `web/`:

```bash
cd web
npm install --save @fal-ai/client
```

2) Set:

```bash
export FAL_KEY="..."
export VEO_BRIDGE_CMD="/absolute/path/to/web/scripts/veo-bridge.mjs"
```

The render pipeline will call your command for each `BRIDGE` segment. If the command exits non-zero (or can’t be spawned), it falls back to a crossfade and records a `bridge_error` in the segment outputs.

## Prompting Tips

- Keep the prompt conservative: “same scene, same subject, same lighting, smooth camera motion”.
- Avoid introducing new entities; you want continuity, not creativity.
- If the boundary frames differ strongly, consider falling back to `STABILIZE`.

## Limitations

- fal’s Veo endpoint exposes discrete durations (`"4s"`, `"6s"`, `"8s"`): time-warp to the exact segment length.
- Output must be normalized (fps/codec/audio/size) for `ffmpeg concat -c copy`.

## References

- fal Veo 3.1 first/last frame endpoint: https://fal.ai/models/fal-ai/veo3.1/first-last-frame-to-video
- fal queue docs: https://docs.fal.ai/model-apis/model-endpoints/queue
- `@fal-ai/client` (GitHub): https://github.com/fal-ai/fal-js/tree/main/libs/client
- `@fal-ai/client` (npm): https://www.npmjs.com/package/@fal-ai/client
