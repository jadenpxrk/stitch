import { SegmentType, SmoothedTick, TickRaw } from "./types";

const TWO_OF_THREE = 3;

export function smoothTicks(raw: TickRaw[]): SmoothedTick[] {
  const buffer: boolean[] = [];
  let state: SegmentType = "GOOD";
  const result: SmoothedTick[] = [];

  raw.forEach((tick) => {
    buffer.push(!!tick.raw.shaky);
    if (buffer.length > TWO_OF_THREE) buffer.shift();
    const shakyCount = buffer.filter(Boolean).length;
    const twoOfThreeShaky = shakyCount >= 2;
    const twoOfThreeGood = shakyCount <= 1;
    const highConfidence = tick.raw.confidence >= 0.95;

    if (state === "GOOD") {
      if (twoOfThreeShaky || highConfidence) state = "SHAKY";
    } else {
      if (twoOfThreeGood) state = "GOOD";
    }

    result.push({ tick: tick.tick, ts: tick.ts, finalState: state });
  });

  return result;
}
