import { RealtimeVision } from '@overshoot/sdk';

export type OvershootResult = {
  ts: number;
  shaky: boolean;
  confidence: number;
  parseError?: string | null;
};

const MODEL_PROMPT = `You are analyzing the last ~1 second of video (about 8–12 frames).
Return ONLY valid JSON with exactly these keys:
{"ts": <number>, "shaky": <boolean>, "confidence": <number 0..1>}
No other text.
Decide "shaky" if camera motion/jitter makes the footage unpleasant or choppy.`;

export type OvershootConfig = {
  apiKey: string;
  model?: string;
  cameraFacing?: 'user' | 'environment';
};

export function createOvershootClient(config: OvershootConfig) {
  const cameraFacing = config.cameraFacing ?? 'environment';
  const vision = new RealtimeVision({
    apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
    apiKey: config.apiKey,
    model: config.model,
    prompt: MODEL_PROMPT,
    cameraFacing,
    source: { type: 'camera', cameraFacing },
  });

  return vision;
}
