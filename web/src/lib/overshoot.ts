import { RealtimeVision, type RealtimeVisionOptions } from "@overshoot/sdk";
import { appendTick } from "./sessionStore";
import { TickRaw } from "./types";

const apiUrl = process.env.OVERSHOOT_API_URL || "https://cluster1.overshoot.ai/api/v0.2";
const apiKey = process.env.OVERSHOOT_API_KEY;
const model = process.env.OVERSHOOT_MODEL;

if (!apiKey) {
  console.warn("OVERSHOOT_API_KEY is not set; Overshoot integration will be disabled.");
}

export function makePrompt(ts: number) {
  return `You are analyzing the last ~1 second of video (about 8-12 frames). Return ONLY valid JSON with exactly these keys: {"ts": ${ts.toFixed(
    1,
  )}, "shaky": <boolean>, "confidence": <number 0..1>} No other text. Decide "shaky" if camera motion/jitter makes the footage unpleasant or choppy.`;
}

function mapSource(source?: string): RealtimeVisionOptions["source"] | undefined {
  if (!source) return { type: "camera", cameraFacing: "environment" };
  const lower = source.toLowerCase();
  if (lower === "camera:front" || lower === "front") {
    return { type: "camera", cameraFacing: "user" };
  }
  if (lower === "camera" || lower === "webcam" || lower === "back") {
    return { type: "camera", cameraFacing: "environment" };
  }
  // Unknown sources fall back to camera to avoid breaking the stream; extend with file upload mapping when available.
  return { type: "camera", cameraFacing: "environment" };
}

export function createVision(sessionId: string, source?: string) {
  if (!apiKey) return null;
  const startTs = Date.now();
  let tick = 0;

  const vision = new RealtimeVision({
    apiUrl,
    apiKey,
    model,
    source: mapSource(source),
    processing: {
      clip_length_seconds: 1,
      delay_seconds: 1,
      fps: 30,
      sampling_ratio: 0.1,
    },
    prompt: makePrompt(0),
    outputSchema: {
      type: "object",
      properties: {
        ts: { type: "number" },
        shaky: { type: "boolean" },
        confidence: { type: "number" },
      },
    },
    onResult: (result) => {
      tick += 1;
      const elapsed = (Date.now() - startTs) / 1000;
      let parsed: any = null;
      let parseError: string | null = null;
      try {
        parsed = typeof result.result === "string" ? JSON.parse(result.result) : result.result;
      } catch (err) {
        parseError = String(err);
      }
      const raw: TickRaw = {
        tick,
        ts: Number.isFinite(parsed?.ts) ? Number(parsed.ts) : Number(elapsed.toFixed(1)),
        windowStart: Math.max(0, elapsed - 1),
        windowEnd: elapsed,
        raw: {
          shaky: Boolean(parsed?.shaky),
          confidence: Number.isFinite(parsed?.confidence) ? Number(parsed.confidence) : 0,
        },
        parseError,
      };
      appendTick(sessionId, raw).catch((err) => console.error("appendTick failed", err));
    },
  });

  return vision;
}
