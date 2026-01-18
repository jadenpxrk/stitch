import { NextResponse } from "next/server";
import { applyIntroTrim, getSession } from "@/lib/sessionStore";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { datasetId, modelId, userId, deviceType } = body;

  const result = await applyIntroTrim(id, {
    datasetId,
    modelId,
    userId,
    deviceType,
  });

  if (!result) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    features: result.features,
    prediction: result.prediction,
    decision: result.decision,
    applied: result.decision !== null,
    message: result.decision
      ? `Applied intro trim: ${result.decision.display_seconds}s`
      : "No trim applied (prediction below threshold)",
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = getSession(id);
  if (!state) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  // Return current intro trim status from edit plan
  const plan = await import("@/lib/sessionStore").then((m) =>
    m.computeEditPlan(id)
  );

  return NextResponse.json({
    hasIntroTrim: !!plan?.intro_trim,
    introTrim: plan?.intro_trim ?? null,
  });
}
