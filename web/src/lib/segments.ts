import { Segment, SmoothedTick, TickRaw } from "./types";

const MIN_GOOD = 1.0;
const MIN_SHAKY = 0.5;
const MERGE_GAP = 0.5;

export function buildSegments(smoothed: SmoothedTick[], raw: TickRaw[]): Segment[] {
  if (smoothed.length === 0) return [];

  const segments: Segment[] = [];
  let current: Segment = {
    id: `seg_0000`,
    start: 0,
    end: 1,
    type: smoothed[0].finalState,
    finalFix: smoothed[0].finalState === "GOOD" ? "KEEP" : "STABILIZE",
  };

  smoothed.forEach((tick, idx) => {
    const tickStart = Math.max(0, tick.ts - 1);
    const tickEnd = tick.ts;
    const unchanged = tick.finalState === current.type;

    if (idx === 0) {
      current.start = tickStart;
      current.end = tickEnd;
      return;
    }

    if (unchanged) {
      current.end = tickEnd;
    } else {
      segments.push(current);
      current = {
        id: `seg_${String(segments.length).padStart(4, "0")}`,
        start: tickStart,
        end: tickEnd,
        type: tick.finalState,
        finalFix: tick.finalState === "GOOD" ? "KEEP" : "STABILIZE",
      };
    }
  });

  segments.push(current);

  // Add confidence averages for SHAKY segments
  segments.forEach((seg) => {
    if (seg.type === "SHAKY") {
      const ticksInSegment = raw.filter(
        (t) => t.ts > seg.start && t.ts <= seg.end,
      );
      const avg =
        ticksInSegment.reduce((sum, t) => sum + (t.raw.confidence || 0), 0) /
        Math.max(1, ticksInSegment.length);
      seg.confidenceAvg = Number.isFinite(avg) ? avg : null;
    }
  });

  return segments;
}

export function cleanupSegments(segments: Segment[]): Segment[] {
  if (segments.length === 0) return [];

  const cleaned: Segment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = { ...segments[i] };
    const duration = seg.end - seg.start;

    if (seg.type === "GOOD" && duration < MIN_GOOD) {
      // Merge into neighbors if possible
      const prev = cleaned.at(-1);
      const next = segments[i + 1];
      if (prev && prev.type === "GOOD") {
        prev.end = seg.end;
        continue;
      }
      if (next && next.type === "GOOD") {
        next.start = seg.start;
        continue;
      }
      // if isolated, keep as-is
    }

    if (seg.type === "SHAKY" && duration < MIN_SHAKY) {
      continue; // drop noise
    }

    cleaned.push(seg);
  }

  // Merge two GOOD segments split by a tiny SHAKY gap < MERGE_GAP
  const merged: Segment[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const cur = cleaned[i];
    if (
      cur.type === "SHAKY" &&
      cur.end - cur.start < MERGE_GAP &&
      merged.length > 0 &&
      i + 1 < cleaned.length &&
      merged[merged.length - 1].type === "GOOD" &&
      cleaned[i + 1].type === "GOOD"
    ) {
      merged[merged.length - 1].end = cleaned[i + 1].end;
      i += 1; // skip next GOOD
      continue;
    }
    merged.push(cur);
  }

  return merged.map((seg, idx) => ({
    ...seg,
    id: `seg_${String(idx).padStart(4, "0")}`,
  }));
}

export function suggestFix(seg: Segment): Segment {
  if (seg.type === "GOOD") return { ...seg, finalFix: "KEEP" };
  const duration = seg.end - seg.start;
  const suggestedFix = duration <= 2 ? "BRIDGE" : "STABILIZE";
  return {
    ...seg,
    suggestedFix,
    finalFix: seg.userFix ?? suggestedFix,
  };
}

export function decorateSegmentsForBridgeAbility(
  segments: Segment[],
  hasRecording: boolean,
): Segment[] {
  return segments.map((seg, idx) => {
    if (seg.type !== "SHAKY") return seg;
    const duration = seg.end - seg.start;
    const prev = segments[idx - 1];
    const next = segments[idx + 1];
    const bridgeAllowed =
      duration < 8 &&
      !!prev &&
      !!next &&
      prev.type === "GOOD" &&
      next.type === "GOOD" &&
      hasRecording;
    return { ...seg, bridgeAllowed };
  });
}
