import { NextResponse } from "next/server";

// Placeholder: in a full build, this would kick off ffmpeg concat
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  return NextResponse.json({ status: "render-not-implemented", sessionId: params.id });
}
