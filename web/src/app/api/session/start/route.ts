import { NextResponse } from "next/server";
import { startSession } from "@/lib/sessionStore";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { sessionId, source } = body;
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const state = await startSession(sessionId, source);
  return NextResponse.json(state);
}
