/**
 * Wood Wide API integration for learned intro trim.
 *
 * This module extracts early-clip features from the first ~8 seconds of a recording
 * and calls the Wood Wide API to predict how much intro to trim.
 */

import { TickRaw, EarlyFeatures, IntroTrimPrediction, IntroTrimDecision } from "./types";

const WOODWIDE_API_URL = process.env.WOODWIDE_API_URL || "https://woodwide.example.com/api/v1";
const WOODWIDE_API_KEY = process.env.WOODWIDE_API_KEY;

const EARLY_WINDOW_SECONDS = 8;
const MIN_TRIM_THRESHOLD = 2.0;
const MAX_TRIM_SECONDS = 8;

/**
 * Extract features from the first ~8 seconds of tick data.
 * These features are used by the Wood Wide model to predict intro trim.
 */
export function extractEarlyFeatures(
  ticks: TickRaw[],
  ticksHz: number,
  options?: { userId?: string; deviceType?: string }
): EarlyFeatures {
  const earlyTickCount = Math.ceil(EARLY_WINDOW_SECONDS * ticksHz);
  const earlyTicks = ticks.slice(0, earlyTickCount);

  if (earlyTicks.length === 0) {
    return {
      early_shaky_ratio: 0,
      early_avg_confidence: 1,
      early_num_flips: 0,
      user_id: options?.userId,
      device_type: options?.deviceType,
    };
  }

  // Calculate shaky ratio
  const shakyCount = earlyTicks.filter((t) => t.raw.shaky).length;
  const early_shaky_ratio = shakyCount / earlyTicks.length;

  // Calculate average confidence
  const totalConfidence = earlyTicks.reduce((sum, t) => sum + t.raw.confidence, 0);
  const early_avg_confidence = totalConfidence / earlyTicks.length;

  // Calculate number of state flips (shaky -> stable or stable -> shaky)
  let early_num_flips = 0;
  for (let i = 1; i < earlyTicks.length; i++) {
    if (earlyTicks[i].raw.shaky !== earlyTicks[i - 1].raw.shaky) {
      early_num_flips++;
    }
  }

  return {
    early_shaky_ratio,
    early_avg_confidence,
    early_num_flips,
    user_id: options?.userId,
    device_type: options?.deviceType,
  };
}

/**
 * Call the Wood Wide API to get intro trim prediction.
 */
export async function inferIntroTrim(
  features: EarlyFeatures,
  options?: { datasetId?: string; modelId?: string }
): Promise<IntroTrimPrediction> {
  if (!WOODWIDE_API_KEY) {
    throw new Error("WOODWIDE_API_KEY is not configured");
  }

  const payload = {
    features,
    dataset_id: options?.datasetId,
    model_id: options?.modelId,
  };

  const response = await fetch(`${WOODWIDE_API_URL}/infer/intro-trim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WOODWIDE_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wood Wide API error: ${response.status} ${errorText}`);
  }

  const result = await response.json();

  return {
    intro_trim_seconds: clampTrimSeconds(result.prediction ?? result.intro_trim_seconds ?? 0),
    dataset_id: result.dataset_id ?? options?.datasetId ?? "default",
    model_id: result.model_id ?? options?.modelId ?? "intro-trim-v1",
    raw_prediction: result.prediction ?? result.intro_trim_seconds ?? 0,
  };
}

/**
 * Clamp trim seconds to valid range [0, MAX_TRIM_SECONDS].
 */
function clampTrimSeconds(seconds: number): number {
  return Math.max(0, Math.min(MAX_TRIM_SECONDS, seconds));
}

/**
 * Round to nearest 0.5 seconds for display.
 */
export function roundToHalfSecond(seconds: number): number {
  return Math.round(seconds * 2) / 2;
}

/**
 * Create an intro trim decision if the prediction meets the threshold.
 * Returns null if no trim should be applied.
 */
export function createIntroTrimDecision(
  prediction: IntroTrimPrediction
): IntroTrimDecision | null {
  if (prediction.intro_trim_seconds < MIN_TRIM_THRESHOLD) {
    return null;
  }

  return {
    type: "TRIM_INTRO",
    trim_seconds: prediction.intro_trim_seconds,
    display_seconds: roundToHalfSecond(prediction.intro_trim_seconds),
    prediction,
  };
}

/**
 * Full pipeline: extract features, infer trim, and create decision.
 */
export async function processIntroTrim(
  ticks: TickRaw[],
  ticksHz: number,
  options?: {
    userId?: string;
    deviceType?: string;
    datasetId?: string;
    modelId?: string;
  }
): Promise<{
  features: EarlyFeatures;
  prediction: IntroTrimPrediction;
  decision: IntroTrimDecision | null;
}> {
  const features = extractEarlyFeatures(ticks, ticksHz, {
    userId: options?.userId,
    deviceType: options?.deviceType,
  });

  const prediction = await inferIntroTrim(features, {
    datasetId: options?.datasetId,
    modelId: options?.modelId,
  });

  const decision = createIntroTrimDecision(prediction);

  return { features, prediction, decision };
}

/**
 * Verify Wood Wide API connectivity by checking auth.
 */
export async function verifyWoodWideAuth(): Promise<{
  authenticated: boolean;
  userId?: string;
  error?: string;
}> {
  if (!WOODWIDE_API_KEY) {
    return { authenticated: false, error: "WOODWIDE_API_KEY not configured" };
  }

  try {
    const response = await fetch(`${WOODWIDE_API_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${WOODWIDE_API_KEY}`,
      },
    });

    if (!response.ok) {
      return { authenticated: false, error: `Auth failed: ${response.status}` };
    }

    const data = await response.json();
    return { authenticated: true, userId: data.user_id ?? data.id };
  } catch (error) {
    return {
      authenticated: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
