function smoothTicks(ticks) {
  const smoothed = [];
  let state = 'GOOD';
  const buf = [];

  for (const t of ticks) {
    buf.push(Boolean(t.shaky));
    while (buf.length > 3) buf.shift();
    const shakyCount = buf.filter(Boolean).length;
    const twoOfThreeShaky = shakyCount >= 2;
    const twoOfThreeGood = shakyCount <= 1;

    if (state === 'GOOD' && (twoOfThreeShaky || (t.confidence ?? 0) >= 0.95)) {
      state = 'SHAKY';
    } else if (state === 'SHAKY' && twoOfThreeGood) {
      state = 'GOOD';
    }

    smoothed.push({ ts: t.ts, finalState: state, raw: t });
  }

  return smoothed;
}

function buildSegments(smoothed) {
  if (!smoothed.length) return [];
  const segments = [];
  let current = {
    id: 'seg_0001',
    start: 0,
    end: smoothed[0].ts,
    type: smoothed[0].finalState,
    confidenceSum: smoothed[0].raw.shaky ? smoothed[0].raw.confidence : 0,
    confidenceCount: smoothed[0].raw.shaky ? 1 : 0,
  };

  for (let i = 1; i < smoothed.length; i++) {
    const s = smoothed[i];
    if (s.finalState === current.type) {
      current.end = s.ts;
      if (s.finalState === 'SHAKY') {
        current.confidenceSum += s.raw.confidence;
        current.confidenceCount += 1;
      }
      continue;
    }
    segments.push({ ...current });
    current = {
      id: `seg_${String(segments.length + 1).padStart(4, '0')}`,
      start: current.end,
      end: s.ts,
      type: s.finalState,
      confidenceSum: s.finalState === 'SHAKY' ? s.raw.confidence : 0,
      confidenceCount: s.finalState === 'SHAKY' ? 1 : 0,
    };
  }
  segments.push({ ...current });
  return segments.map((seg) => {
    const duration = seg.end - seg.start;
    const confidence_avg = seg.type === 'SHAKY' && seg.confidenceCount > 0 ? seg.confidenceSum / seg.confidenceCount : null;
    const suggested_fix = seg.type === 'SHAKY' ? (duration <= 2 ? 'BRIDGE' : 'STABILIZE') : 'STABILIZE';
    const final_fix = seg.type === 'GOOD' ? 'KEEP' : suggested_fix;
    return {
      ...seg,
      confidence_avg,
      suggested_fix,
      user_fix: null,
      final_fix,
      outputs: seg.type === 'SHAKY' ? { status: 'pending' } : {},
    };
  });
}

function cleanupSegments(segments) {
  const MIN_GOOD = 1;
  const MIN_SHAKY = 0.5;
  const MERGE_GAP = 0.5;
  if (!segments.length) return [];

  const cleaned = [];
  for (const seg of segments) {
    const duration = seg.end - seg.start;
    if (seg.type === 'GOOD' && duration < MIN_GOOD) continue;
    if (seg.type === 'SHAKY' && duration < MIN_SHAKY) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && last.type === 'GOOD' && seg.type === 'GOOD') {
      last.end = seg.end;
      continue;
    }
    cleaned.push({ ...seg });
  }

  const merged = [];
  for (let i = 0; i < cleaned.length; i++) {
    const cur = cleaned[i];
    if (
      cur.type === 'SHAKY' &&
      cur.end - cur.start < MERGE_GAP &&
      merged.length &&
      i + 1 < cleaned.length &&
      merged[merged.length - 1].type === 'GOOD' &&
      cleaned[i + 1].type === 'GOOD'
    ) {
      merged[merged.length - 1].end = cleaned[i + 1].end;
      i++;
      continue;
    }
    merged.push(cur);
  }

  return merged;
}

module.exports = { smoothTicks, buildSegments, cleanupSegments };
