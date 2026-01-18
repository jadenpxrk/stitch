import { describe, it, expect } from "vitest";
import {
  extractEarlyFeatures,
  roundToHalfSecond,
  createIntroTrimDecision,
} from "./woodwide";
import { TickRaw, IntroTrimPrediction } from "./types";

// Helper to create mock ticks
function createMockTicks(
  count: number,
  options?: {
    shakyRatio?: number;
    avgConfidence?: number;
  }
): TickRaw[] {
  const shakyRatio = options?.shakyRatio ?? 0.5;
  const avgConfidence = options?.avgConfidence ?? 0.8;

  return Array.from({ length: count }, (_, i) => ({
    tick: i + 1,
    ts: i,
    windowStart: i,
    windowEnd: i + 1,
    raw: {
      shaky: Math.random() < shakyRatio,
      confidence: avgConfidence + (Math.random() - 0.5) * 0.2,
    },
    parseError: null,
  }));
}

describe("extractEarlyFeatures", () => {
  it("should extract features from the first 8 seconds at 1Hz", () => {
    const ticks = createMockTicks(20, { shakyRatio: 0.5, avgConfidence: 0.8 });
    const features = extractEarlyFeatures(ticks, 1);

    expect(features.early_shaky_ratio).toBeGreaterThanOrEqual(0);
    expect(features.early_shaky_ratio).toBeLessThanOrEqual(1);
    expect(features.early_avg_confidence).toBeGreaterThan(0);
    expect(features.early_num_flips).toBeGreaterThanOrEqual(0);
  });

  it("should only use first 8 seconds of ticks at 1Hz", () => {
    const ticks = createMockTicks(100, { shakyRatio: 0, avgConfidence: 1 });
    // Mark ticks after 8 as shaky
    for (let i = 8; i < ticks.length; i++) {
      ticks[i].raw.shaky = true;
    }

    const features = extractEarlyFeatures(ticks, 1);

    // Should not see the shaky ticks after 8 seconds
    expect(features.early_shaky_ratio).toBe(0);
  });

  it("should handle higher tick rates", () => {
    const ticks = createMockTicks(80, { shakyRatio: 0.3, avgConfidence: 0.9 });
    const features = extractEarlyFeatures(ticks, 10); // 10Hz

    expect(features.early_shaky_ratio).toBeGreaterThanOrEqual(0);
    expect(features.early_avg_confidence).toBeGreaterThan(0);
  });

  it("should include optional user and device info", () => {
    const ticks = createMockTicks(10);
    const features = extractEarlyFeatures(ticks, 1, {
      userId: "user-123",
      deviceType: "iphone",
    });

    expect(features.user_id).toBe("user-123");
    expect(features.device_type).toBe("iphone");
  });

  it("should return defaults for empty ticks", () => {
    const features = extractEarlyFeatures([], 1);

    expect(features.early_shaky_ratio).toBe(0);
    expect(features.early_avg_confidence).toBe(1);
    expect(features.early_num_flips).toBe(0);
  });

  it("should count state flips correctly", () => {
    const ticks: TickRaw[] = [
      { tick: 1, ts: 0, windowStart: 0, windowEnd: 1, raw: { shaky: false, confidence: 0.9 }, parseError: null },
      { tick: 2, ts: 1, windowStart: 1, windowEnd: 2, raw: { shaky: true, confidence: 0.9 }, parseError: null },
      { tick: 3, ts: 2, windowStart: 2, windowEnd: 3, raw: { shaky: true, confidence: 0.9 }, parseError: null },
      { tick: 4, ts: 3, windowStart: 3, windowEnd: 4, raw: { shaky: false, confidence: 0.9 }, parseError: null },
      { tick: 5, ts: 4, windowStart: 4, windowEnd: 5, raw: { shaky: false, confidence: 0.9 }, parseError: null },
      { tick: 6, ts: 5, windowStart: 5, windowEnd: 6, raw: { shaky: true, confidence: 0.9 }, parseError: null },
    ];

    const features = extractEarlyFeatures(ticks, 1);

    // Flips: stable->shaky at tick 2, shaky->stable at tick 4, stable->shaky at tick 6
    expect(features.early_num_flips).toBe(3);
  });
});

describe("roundToHalfSecond", () => {
  it("should round to nearest 0.5", () => {
    expect(roundToHalfSecond(4.2)).toBe(4);
    expect(roundToHalfSecond(4.3)).toBe(4.5);
    expect(roundToHalfSecond(4.6)).toBe(4.5);
    expect(roundToHalfSecond(4.8)).toBe(5);
    expect(roundToHalfSecond(5.0)).toBe(5);
    expect(roundToHalfSecond(5.25)).toBe(5.5);
  });

  it("should handle zero", () => {
    expect(roundToHalfSecond(0)).toBe(0);
  });

  it("should handle small values", () => {
    expect(roundToHalfSecond(0.1)).toBe(0);
    expect(roundToHalfSecond(0.3)).toBe(0.5);
  });
});

describe("createIntroTrimDecision", () => {
  it("should create decision when prediction >= 2.0s", () => {
    const prediction: IntroTrimPrediction = {
      intro_trim_seconds: 4.6,
      dataset_id: "ds-123",
      model_id: "model-v1",
      raw_prediction: 4.6,
    };

    const decision = createIntroTrimDecision(prediction);

    expect(decision).not.toBeNull();
    expect(decision?.type).toBe("TRIM_INTRO");
    expect(decision?.trim_seconds).toBe(4.6);
    expect(decision?.display_seconds).toBe(4.5);
    expect(decision?.prediction).toEqual(prediction);
  });

  it("should return null when prediction < 2.0s", () => {
    const prediction: IntroTrimPrediction = {
      intro_trim_seconds: 1.5,
      dataset_id: "ds-123",
      model_id: "model-v1",
      raw_prediction: 1.5,
    };

    const decision = createIntroTrimDecision(prediction);

    expect(decision).toBeNull();
  });

  it("should return null for zero prediction", () => {
    const prediction: IntroTrimPrediction = {
      intro_trim_seconds: 0,
      dataset_id: "ds-123",
      model_id: "model-v1",
      raw_prediction: 0,
    };

    const decision = createIntroTrimDecision(prediction);

    expect(decision).toBeNull();
  });

  it("should handle exactly 2.0s (threshold)", () => {
    const prediction: IntroTrimPrediction = {
      intro_trim_seconds: 2.0,
      dataset_id: "ds-123",
      model_id: "model-v1",
      raw_prediction: 2.0,
    };

    const decision = createIntroTrimDecision(prediction);

    expect(decision).not.toBeNull();
    expect(decision?.display_seconds).toBe(2);
  });
});
