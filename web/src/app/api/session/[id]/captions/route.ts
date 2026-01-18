import { NextResponse } from "next/server";
import { generateCaptions, getSession } from "@/lib/sessionStore";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const body = await request.json().catch(() => ({}));
  const { recordingUrl } = body;
  const state = await generateCaptions(params.id, recordingUrl);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const state = getSession(params.id);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
