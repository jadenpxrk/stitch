import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CopilotOp =
  | { tool: "cut_range"; startSeconds: number; endSeconds: number }
  | { tool: "trim_current"; startSeconds: number; endSeconds: number }
  | { tool: "split_at"; timeSeconds: number }
  | { tool: "set_crop"; crop: { x: number; y: number; w: number; h: number } };

type CopilotResponse = {
  message: string;
  operations: CopilotOp[];
};

function stripInlineComment(value: string) {
  return value.replace(/\s+#.*$/, "").trim();
}

function readEnv(name: string, fallback: string) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const cleaned = stripInlineComment(raw);
  return cleaned ? cleaned : fallback;
}

function isDebugEnabled() {
  const raw = process.env.COPILOT_DEBUG;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(v);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  return candidate;
}

function normalizeOps(ops: unknown, durationSeconds: number): CopilotOp[] {
  if (!Array.isArray(ops)) return [];
  const out: CopilotOp[] = [];

  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const tool = (op as { tool?: unknown }).tool;
    if (tool === "cut_range") {
      const startSeconds = Number((op as { startSeconds?: unknown }).startSeconds);
      const endSeconds = Number((op as { endSeconds?: unknown }).endSeconds);
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) continue;
      if (endSeconds <= startSeconds) continue;
      out.push({
        tool,
        startSeconds: clamp(startSeconds, 0, durationSeconds),
        endSeconds: clamp(endSeconds, 0, durationSeconds),
      });
      continue;
    }

    if (tool === "trim_current") {
      const startSeconds = Number((op as { startSeconds?: unknown }).startSeconds);
      const endSeconds = Number((op as { endSeconds?: unknown }).endSeconds);
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) continue;
      if (endSeconds <= startSeconds) continue;
      out.push({
        tool,
        startSeconds: clamp(startSeconds, 0, durationSeconds),
        endSeconds: clamp(endSeconds, 0, durationSeconds),
      });
      continue;
    }

    if (tool === "split_at") {
      const timeSeconds = Number((op as { timeSeconds?: unknown }).timeSeconds);
      if (!Number.isFinite(timeSeconds)) continue;
      out.push({ tool, timeSeconds: clamp(timeSeconds, 0, durationSeconds) });
      continue;
    }

    if (tool === "set_crop") {
      const crop = (op as { crop?: unknown }).crop as
        | { x?: unknown; y?: unknown; w?: unknown; h?: unknown }
        | undefined;
      const x = Number(crop?.x);
      const y = Number(crop?.y);
      const w = Number(crop?.w);
      const h = Number(crop?.h);
      if (![x, y, w, h].every(Number.isFinite)) continue;
      out.push({
        tool,
        crop: {
          x: clamp(x, 0, 1),
          y: clamp(y, 0, 1),
          w: clamp(w, 0, 1),
          h: clamp(h, 0, 1),
        },
      });
      continue;
    }
  }

  return out;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const durationSeconds = Number(body?.durationSeconds);

  if (!prompt) {
    return NextResponse.json({ error: "`prompt` is required" }, { status: 400 });
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return NextResponse.json({ error: "`durationSeconds` must be a positive number" }, { status: 400 });
  }

  const geminiKey = readEnv("GEMINI_API_KEY", "");
  if (!geminiKey) {
    return NextResponse.json(
      { error: "Missing GEMINI_API_KEY. Set it to enable Copilot edits." },
      { status: 400 },
    );
  }

  let GoogleGenerativeAI: typeof import("@google/generative-ai").GoogleGenerativeAI;
  try {
    ({ GoogleGenerativeAI } = await import("@google/generative-ai"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to load @google/generative-ai (${msg}). Ensure dependencies are installed in web/.` },
      { status: 500 },
    );
  }

  const genAI = new GoogleGenerativeAI(geminiKey);
  const modelName = readEnv("GEMINI_COPILOT_MODEL", "gemini-2.5-flash");
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: `
You are a video editing copilot.
You translate user requests into concrete timeline operations.

You MUST respond with ONLY valid JSON (no markdown, no backticks, no commentary).
Schema:
{
  "message": string,
  "operations": Array<
    | {"tool":"cut_range","startSeconds":number,"endSeconds":number}
    | {"tool":"trim_current","startSeconds":number,"endSeconds":number}
    | {"tool":"split_at","timeSeconds":number}
    | {"tool":"set_crop","crop":{"x":number,"y":number,"w":number,"h":number}}
  >
}

Rules:
- Times are seconds (float ok), within [0, durationSeconds].
- If the user gives timestamps like 1:23.4, convert to seconds.
- Prefer fewer operations; don't invent features.
- If unsure, return an empty operations array and explain in "message".
    `.trim(),
    generationConfig: {
      temperature: 0.2,
      // Encourages strict JSON output.
      responseMimeType: "application/json",
    },
  });

  const context = {
    prompt,
    durationSeconds,
    selection: body?.selection ?? null,
    clips: body?.clips ?? null,
  };

  let rawText = "";
  try {
    const result = await model.generateContent([
      {
        text: `Context JSON:\n${JSON.stringify(context)}\n\nNow produce your JSON response:`,
      },
    ]);
    rawText = result.response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.error("Copilot Gemini generateContent failed:", message);
    }
    return NextResponse.json({ error: `Copilot model error: ${message}` }, { status: 500 });
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    const extracted = extractJsonObject(rawText);
    if (extracted) {
      try {
        parsed = JSON.parse(extracted);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    const preview = rawText.slice(0, 2000);
    if (isDebugEnabled()) {
      // eslint-disable-next-line no-console
      console.error("Copilot returned non-JSON:", preview);
    }
    return NextResponse.json(
      {
        error: "Copilot returned an invalid response (expected JSON).",
        ...(isDebugEnabled() ? { rawPreview: preview } : null),
      },
      { status: 500 },
    );
  }

  const maybe = parsed as Partial<CopilotResponse>;
  const message = typeof maybe?.message === "string" ? maybe.message : "Ok.";
  const operations = normalizeOps(maybe?.operations, durationSeconds);

  return NextResponse.json({ message, operations });
}
