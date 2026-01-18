import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { runFfmpeg } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTPUT_ROOT = path.resolve(process.cwd(), process.env.OUTPUT_ROOT || "sessions");
const AGENTS_ROOT = path.join(OUTPUT_ROOT, "agents");
const BRIDGE_ROOT = path.join(AGENTS_ROOT, "bridge");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function makeJobId() {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function stripInlineComment(value: string) {
  return value.replace(/\s+#.*$/, "").trim();
}

function assetUrl(jobId: string, relPath: string) {
  const normalized = relPath.split(path.sep).join("/");
  const encoded = normalized.split("/").map(encodeURIComponent).join("/");
  return `/api/agents/bridge/${encodeURIComponent(jobId)}/asset/${encoded}`;
}

async function extractFrame(inputPath: string, tsSeconds: number, outJpg: string) {
  await runFfmpeg(["-y", "-ss", tsSeconds.toFixed(3), "-i", inputPath, "-frames:v", "1", "-q:v", "2", outJpg], {
    timeoutMs: 2 * 60_000,
  });
}

async function renderFallbackBridgePiece(opts: {
  firstJpg: string;
  lastJpg: string;
  duration: number;
  outPath: string;
}) {
  const d = Math.max(0.25, opts.duration);
  const transition = Math.min(0.5, Math.max(0.1, d / 3));
  const offset = Math.max(0, d - transition);

  await runFfmpeg([
    "-y",
    "-loop",
    "1",
    "-t",
    d.toFixed(3),
    "-i",
    opts.firstJpg,
    "-loop",
    "1",
    "-t",
    d.toFixed(3),
    "-i",
    opts.lastJpg,
    "-f",
    "lavfi",
    "-t",
    d.toFixed(3),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-filter_complex",
    `[0:v][1:v]xfade=transition=fade:duration=${transition.toFixed(3)}:offset=${offset.toFixed(3)},format=yuv420p[v]`,
    "-map",
    "[v]",
    "-map",
    "2:a:0",
    "-shortest",
    "-c:v",
    "libx264",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    opts.outPath,
  ]);
}

async function runExternalBridge(opts: {
  firstJpg: string;
  lastJpg: string;
  duration: number;
  outPath: string;
  prompt?: string;
}): Promise<{ used: boolean; error?: string }> {
  const cmdRaw = process.env.VEO_BRIDGE_CMD;
  if (!cmdRaw) return { used: false, error: "VEO_BRIDGE_CMD is not set" };

  const cmd = stripInlineComment(cmdRaw);
  if (!cmd) return { used: false, error: "VEO_BRIDGE_CMD is empty" };

  const args = [opts.firstJpg, opts.lastJpg, opts.outPath, opts.duration.toFixed(3)];

  const ext = path.extname(cmd).toLowerCase();
  const looksLikeNodeScript = ext === ".js" || ext === ".mjs" || ext === ".cjs";
  const command = looksLikeNodeScript ? process.execPath : cmd;
  const commandArgs = looksLikeNodeScript ? [cmd, ...args] : args;

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.prompt) env.VEO_BRIDGE_PROMPT = opts.prompt;

  try {
    const child = spawn(command, commandArgs, { stdio: "inherit", env });
    const exitCode: number | null = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    if (exitCode === 0) return { used: true };
    return { used: false, error: `VEO_BRIDGE_CMD failed (exit ${exitCode}): ${cmd}` };
  } catch (err) {
    return { used: false, error: `VEO_BRIDGE_CMD error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected multipart/form-data request." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "`file` is required." }, { status: 400 });
  }
  if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
    return NextResponse.json({ error: "Only .mp4 files are supported." }, { status: 400 });
  }

  const firstFrameTs = parseNumber(formData.get("firstFrameTs"));
  const lastFrameTs = parseNumber(formData.get("lastFrameTs"));
  const durationSecondsRaw = parseNumber(formData.get("durationSeconds"));
  const prompt = typeof formData.get("prompt") === "string" ? String(formData.get("prompt")) : undefined;

  if (firstFrameTs == null || lastFrameTs == null || durationSecondsRaw == null) {
    return NextResponse.json(
      { error: "`firstFrameTs`, `lastFrameTs`, `durationSeconds` are required." },
      { status: 400 },
    );
  }

  if (firstFrameTs < 0 || lastFrameTs < 0) {
    return NextResponse.json({ error: "Frame timestamps must be >= 0." }, { status: 400 });
  }
  if (lastFrameTs <= firstFrameTs) {
    return NextResponse.json({ error: "`lastFrameTs` must be > `firstFrameTs`." }, { status: 400 });
  }

  const durationSeconds = clamp(durationSecondsRaw, 0.25, 8);
  if (durationSecondsRaw > 8 + 1e-6) {
    return NextResponse.json({ error: "durationSeconds must be <= 8.0 (model limit)." }, { status: 400 });
  }

  const jobId = makeJobId();
  const jobDir = path.join(BRIDGE_ROOT, jobId);
  const framesDir = path.join(jobDir, "frames");
  const outDir = path.join(jobDir, "out");
  await Promise.all([ensureDir(jobDir), ensureDir(framesDir), ensureDir(outDir)]);

  try {
    const inputPath = path.join(jobDir, "input.mp4");
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);

    const safeFirst = clamp(firstFrameTs, 0, Math.max(0, lastFrameTs));
    const safeLast = clamp(lastFrameTs, Math.max(0, safeFirst), Math.max(0, lastFrameTs + 0.001));

    const firstJpg = path.join(framesDir, "first.jpg");
    const lastJpg = path.join(framesDir, "last.jpg");

    await extractFrame(inputPath, safeFirst, firstJpg);
    await extractFrame(inputPath, safeLast, lastJpg);

    const outPath = path.join(outDir, "bridge.mp4");
    const external = await runExternalBridge({ firstJpg, lastJpg, duration: durationSeconds, outPath, prompt });
    if (!external.used) {
      await renderFallbackBridgePiece({ firstJpg, lastJpg, duration: durationSeconds, outPath });
    }

    return NextResponse.json({
      jobId,
      durationSeconds,
      usedVeo: external.used,
      error: external.used ? null : external.error ?? null,
      bridgeUrl: assetUrl(jobId, path.relative(jobDir, outPath)),
      firstFrameUrl: assetUrl(jobId, path.relative(jobDir, firstJpg)),
      lastFrameUrl: assetUrl(jobId, path.relative(jobDir, lastJpg)),
    });
  } catch (err: unknown) {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
