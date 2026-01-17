import { NextResponse } from "next/server";
import { getSession } from "@/lib/sessionStore";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const state = getSession(params.id);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(state);
}
