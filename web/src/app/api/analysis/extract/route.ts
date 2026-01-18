import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { CommandError, hasAudio, runFfmpeg, runFfprobe } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClipRequest = {
  start: number;
  end: number;
  peakScore?: number;
  clipType?: string;
  hookText?: string;
};

const OUTPUT_ROOT = path.resolve(process.cwd(), process.env.OUTPUT_ROOT || "sessions");
const ANALYSIS_ROOT = path.join(OUTPUT_ROOT, "analysis");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function makeAnalysisId() {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `analysis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson(value: FormDataEntryValue | null): unknown {
  if (!value) return null;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseFrames(value: FormDataEntryValue | null): number[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  const out: number[] = [];
  for (const item of parsed) {
    const n = Number(item);
    if (!Number.isFinite(n) || n < 0) continue;
    out.push(n);
  }
  return out.slice(0, 10);
}

function parseClips(value: FormDataEntryValue | null): ClipRequest[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  const out: ClipRequest[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const start = Number(obj.start);
    const end = Number(obj.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end <= start) continue;
    const clip: ClipRequest = { start, end };
    if (typeof obj.peakScore === "number" && Number.isFinite(obj.peakScore)) clip.peakScore = obj.peakScore;
    if (typeof obj.clipType === "string") clip.clipType = obj.clipType;
    if (typeof obj.hookText === "string") clip.hookText = obj.hookText;
    out.push(clip);
  }
  return out.slice(0, 10);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function getVideoDurationSeconds(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await runFfprobe(
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", inputPath],
      { timeoutMs: 20_000 },
    );
    const n = Number(stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function extractFrame(inputPath: string, tsSeconds: number, outJpg: string) {
  await runFfmpeg(["-y", "-ss", tsSeconds.toFixed(3), "-i", inputPath, "-frames:v", "1", "-q:v", "2", outJpg], {
    timeoutMs: 2 * 60_000,
  });
}

async function generateThumbnailLocal(inputJpg: string, outJpg: string) {
  await runFfmpeg(
    [
      "-y",
      "-i",
      inputJpg,
      "-vf",
      "scale=1280:-2:force_original_aspect_ratio=decrease,eq=contrast=1.12:brightness=0.03:saturation=1.15,unsharp=5:5:0.8:5:5:0.0",
      "-q:v",
      "2",
      outJpg,
    ],
    { timeoutMs: 2 * 60_000 },
  );
}

async function runNanoBanana(inputJpg: string, outJpg: string) {
  const cmd = process.env.NANO_BANANA_CMD;
  if (!cmd) return false;
  const child = spawn(cmd, [inputJpg, outJpg], { stdio: "inherit" });
  const exitCode: number | null = await new Promise((resolve) => child.on("close", resolve));
  if (exitCode !== 0) {
    throw new Error(`NANO_BANANA_CMD failed (exit ${exitCode}): ${cmd}`);
  }
  return true;
}

async function extractClip(inputPath: string, start: number, end: number, outPath: string) {
  try {
    await runFfmpeg(
      [
        "-y",
        "-ss",
        start.toFixed(3),
        "-to",
        end.toFixed(3),
        "-i",
        inputPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { timeoutMs: 10 * 60_000 },
    );
    return;
  } catch {
    // Fall through to a more compatible re-encode path.
  }

  const duration = Math.max(0.01, end - start);
  const audio = await hasAudio(inputPath);

  const base: string[] = ["-y", "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", inputPath];

  if (!audio) {
    base.push(
      "-f",
      "lavfi",
      "-t",
      duration.toFixed(3),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
    );
  }

  const outArgs: string[] = [];
  if (audio) {
    outArgs.push(
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outPath,
    );
  } else {
    outArgs.push(
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      outPath,
    );
  }

  await runFfmpeg([...base, ...outArgs], { timeoutMs: 10 * 60_000 });
}

function assetUrl(analysisId: string, relPath: string) {
  const normalized = relPath.split(path.sep).join("/");
  const encoded = normalized.split("/").map(encodeURIComponent).join("/");
  return `/api/analysis/${encodeURIComponent(analysisId)}/asset/${encoded}`;
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

  const frames = parseFrames(formData.get("frames"));
  const clips = parseClips(formData.get("clips"));

  const analysisId = makeAnalysisId();
  const analysisDir = path.join(ANALYSIS_ROOT, analysisId);
  const framesDir = path.join(analysisDir, "frames");
  const thumbsDir = path.join(analysisDir, "thumbnails");
  const clipsDir = path.join(analysisDir, "clips");

  await Promise.all([ensureDir(analysisDir), ensureDir(framesDir), ensureDir(thumbsDir), ensureDir(clipsDir)]);

  const inputPath = path.join(analysisDir, "input.mp4");
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(inputPath, buf);

  const duration = await getVideoDurationSeconds(inputPath);

  try {
    const extractedFrames = await Promise.all(
      frames.map(async (ts, i) => {
        const safeTs = duration ? clamp(ts, 0, Math.max(0, duration - 0.01)) : Math.max(0, ts);
        const baseName = `frame_${String(i).padStart(2, "0")}`;
        const outCandidate = path.join(framesDir, `${baseName}.jpg`);
        const outGenerated = path.join(thumbsDir, `thumb_${String(i).padStart(2, "0")}.jpg`);
        await extractFrame(inputPath, safeTs, outCandidate);
        const usedNanoBanana = await runNanoBanana(outCandidate, outGenerated);
        if (!usedNanoBanana) {
          await generateThumbnailLocal(outCandidate, outGenerated);
        }
        return {
          timestampSeconds: safeTs,
          candidateUrl: assetUrl(analysisId, path.relative(analysisDir, outCandidate)),
          generatedUrl: assetUrl(analysisId, path.relative(analysisDir, outGenerated)),
        };
      }),
    );

    const extractedClips = await Promise.all(
      clips.map(async (clip, i) => {
        const safeStart = duration ? clamp(clip.start, 0, Math.max(0, duration - 0.01)) : Math.max(0, clip.start);
        const safeEnd = duration ? clamp(clip.end, 0, duration) : Math.max(0, clip.end);
        if (safeEnd <= safeStart) {
          throw new Error("Invalid clip range after clamping.");
        }

        const outName = `clip_${String(i).padStart(2, "0")}.mp4`;
        const outPath = path.join(clipsDir, outName);
        await extractClip(inputPath, safeStart, safeEnd, outPath);
        return {
          start: safeStart,
          end: safeEnd,
          url: assetUrl(analysisId, path.relative(analysisDir, outPath)),
          peakScore: clip.peakScore,
          clipType: clip.clipType,
          hookText: clip.hookText,
        };
      }),
    );

    return NextResponse.json({
      analysisId,
      durationSeconds: duration,
      inputUrl: assetUrl(analysisId, "input.mp4"),
      thumbnails: extractedFrames,
      clips: extractedClips,
    });
  } catch (err: unknown) {
    // Best-effort cleanup for temp artefacts if extraction fails mid-flight.
    await fs.rm(analysisDir, { recursive: true, force: true }).catch(() => undefined);
    const message = err instanceof CommandError ? err.stderr || err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
