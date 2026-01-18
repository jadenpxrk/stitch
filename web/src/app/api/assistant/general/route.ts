import { NextRequest, NextResponse } from "next/server";
import type { CapabilityName } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SuggestedAction = {
  capability: CapabilityName;
  input: Record<string, unknown>;
  requiresConfirmation: true;
};

function includesAny(haystack: string, needles: string[]) {
  const s = haystack.toLowerCase();
  return needles.some((n) => s.includes(n));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const recordingUrl = typeof body?.recordingUrl === "string" ? body.recordingUrl.trim() : "";

  if (!prompt) {
    return NextResponse.json({ error: "`prompt` is required" }, { status: 400 });
  }

  const actions: SuggestedAction[] = [];
  const blockers: string[] = [];

  if (includesAny(prompt, ["caption", "captions", "transcript", "subtitles"])) {
    if (!sessionId) blockers.push("Need `sessionId` to generate captions.");
    if (!recordingUrl) blockers.push("Need `recordingUrl` to generate captions.");
    if (sessionId && recordingUrl) {
      actions.push({
        capability: "generate_captions",
        input: { sessionId, recordingUrl },
        requiresConfirmation: true,
      });
    }
  }

  if (includesAny(prompt, ["intro trim", "trim intro", "learned intro"])) {
    if (!sessionId) blockers.push("Need `sessionId` to run intro trim.");
    if (sessionId) {
      actions.push({
        capability: "trim_intro",
        input: {
          sessionId,
          datasetId: body?.datasetId,
          modelId: body?.modelId,
          userId: body?.userId,
          deviceType: body?.deviceType,
        },
        requiresConfirmation: true,
      });
    }
  }

  if (includesAny(prompt, ["export", "render"])) {
    if (!sessionId) blockers.push("Need `sessionId` to export video.");
    if (sessionId) {
      actions.push({
        capability: "export_video",
        input: { sessionId, recordingUrl: recordingUrl || undefined },
        requiresConfirmation: true,
      });
    }
  }

  const message =
    blockers.length > 0
      ? blockers.join(" ")
      : actions.length > 0
        ? "I can suggest actions for you to confirm and apply."
        : "I can help, but I’m not sure what action to take from that prompt.";

  return NextResponse.json({
    prompt,
    message,
    actions,
  });
}

