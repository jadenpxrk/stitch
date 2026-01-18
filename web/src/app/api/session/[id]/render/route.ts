import { NextRequest, NextResponse } from "next/server";
import { computeEditPlan, getSessionMutable, stopSession } from "@/lib/sessionStore";
import { ensureRecordingFile, renderFinalMp4 } from "@/lib/renderPipeline";
import { persistPlan } from "@/lib/persistence";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { recordingUrl } = body as { recordingUrl?: string };

  // If a client calls /render before /stop, stop it to capture duration + recompute segments.
  const existing = getSessionMutable(id);
  if (existing && existing.status === "running") {
    await stopSession(id, recordingUrl);
  }

  const state = getSessionMutable(id);
  if (!state) return NextResponse.json({ error: "not found" }, { status: 404 });

  const plan = computeEditPlan(id);
  if (!plan) return NextResponse.json({ error: "no plan" }, { status: 400 });

  try {
    const { recordingPath } = await ensureRecordingFile(state, recordingUrl);
    const { finalPath, updatedPlan } = await renderFinalMp4({
      state,
      plan,
      recordingPath,
    });
    await persistPlan(state.id, updatedPlan);
    return NextResponse.json({
      status: "ok",
      sessionId: state.id,
      final_path: finalPath,
      edit_plan: updatedPlan,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "error", sessionId: state.id, error: message },
      { status: 500 },
    );
  }
}
