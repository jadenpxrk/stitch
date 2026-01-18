import { NextRequest, NextResponse } from "next/server";
import { appendTick } from "@/lib/sessionStore";
import { TickRaw } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = await request.json().catch(() => ({}));
  const { tick, ts, raw, windowStart, windowEnd, parseError } = body;
  if (tick === undefined || ts === undefined || !raw) {
    return NextResponse.json({ error: "tick, ts, raw required" }, { status: 400 });
  }
  const payload: TickRaw = {
    tick: Number(tick),
    ts: Number(ts),
    windowStart: Number(windowStart ?? ts - 1),
    windowEnd: Number(windowEnd ?? ts),
    raw: {
      shaky: Boolean(raw.shaky),
      confidence: Number(raw.confidence ?? 0),
    },
    parseError: parseError ?? null,
  };
  const { id } = await params;
  const state = await appendTick(id, payload);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
