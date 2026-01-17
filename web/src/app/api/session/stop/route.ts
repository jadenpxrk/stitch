import { NextResponse } from "next/server";
import { stopSession } from "@/lib/sessionStore";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { sessionId, recordingUrl } = body;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const state = await stopSession(sessionId, recordingUrl);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
