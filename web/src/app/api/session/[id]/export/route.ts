import { NextRequest, NextResponse } from "next/server";
import { computeEditPlan } from "@/lib/sessionStore";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const plan = computeEditPlan(id);
  if (!plan) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(plan);
}
