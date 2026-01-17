import { NextResponse } from "next/server";
import { setUserFix } from "@/lib/sessionStore";

export async function POST(
  request: Request,
  { params }: { params: { id: string; segmentId: string } },
) {
  const body = await request.json().catch(() => ({}));
  const { fix } = body;
  if (!fix) {
    return NextResponse.json({ error: "fix required" }, { status: 400 });
  }
  const state = setUserFix(params.id, params.segmentId, fix);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
