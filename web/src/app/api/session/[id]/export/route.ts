import { NextResponse } from "next/server";
import { computeEditPlan } from "@/lib/sessionStore";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const plan = computeEditPlan(params.id);
  if (!plan) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(plan);
}
