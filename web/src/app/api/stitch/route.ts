import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { CommandError, hasAudio, runFfmpeg, runFfprobe } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type ClipSpec = {
  in: number;
  out: number;
  crop?: CropRect | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseBoolean(value: FormDataEntryValue | null) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function parseClipsJson(value: FormDataEntryValue | null): ClipSpec[] | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const clips: ClipSpec[] = [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== "object") return null;
      const start = Number((raw as { in?: unknown }).in);
      const end = Number((raw as { out?: unknown }).out);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const crop = (raw as { crop?: unknown }).crop;
      if (crop != null) {
        if (!crop || typeof crop !== "object") return null;
        const x = Number((crop as { x?: unknown }).x);
        const y = Number((crop as { y?: unknown }).y);
        const w = Number((crop as { w?: unknown }).w);
        const h = Number((crop as { h?: unknown }).h);
        if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
        clips.push({
          in: start,
          out: end,
          crop: { x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0, 1), h: clamp(h, 0, 1) },
        });
      } else {
        clips.push({ in: start, out: end, crop: null });
      }
    }
    return clips;
  } catch {
    return null;
  }
}

function isDefaultCrop(crop: CropRect) {
  return crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
}

function makeEven(n: number) {
  return n - (n % 2);
}

async function getVideoMeta(
  inputPath: string,
): Promise<{ width: number; height: number; duration: number }> {
  const { stdout } = await runFfprobe(
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      inputPath,
    ],
    { timeoutMs: 20_000 },
  );

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  const duration = Number(parsed.format?.duration ?? "0");
  if (!stream?.width || !stream?.height) {
    throw new Error("Unable to determine input video dimensions.");
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Unable to determine input video duration.");
  }
  return { width: stream.width, height: stream.height, duration };
}

function buildCropFilter(crop: CropRect, dims: { width: number; height: number }): string | null {
  if (isDefaultCrop(crop)) return null;

  const minPx = 2;

  let x = Math.round(dims.width * crop.x);
  let y = Math.round(dims.height * crop.y);
  let w = Math.round(dims.width * crop.w);
  let h = Math.round(dims.height * crop.h);

  x = clamp(x, 0, Math.max(0, dims.width - minPx));
  y = clamp(y, 0, Math.max(0, dims.height - minPx));
  w = clamp(w, minPx, dims.width - x);
  h = clamp(h, minPx, dims.height - y);

  x = makeEven(x);
  y = makeEven(y);
  w = makeEven(w);
  h = makeEven(h);

  w = clamp(w, minPx, dims.width - x);
  h = clamp(h, minPx, dims.height - y);
  w = makeEven(w);
  h = makeEven(h);

  if (w < minPx || h < minPx) {
    throw new Error("Crop area too small.");
  }

  return `crop=${w}:${h}:${x}:${y}`;
}

type RenderSegment =
  | { type: "clip"; start: number; end: number; crop: CropRect }
  | { type: "gap"; duration: number };

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { error: "Expected multipart/form-data request." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "`file` is required." }, { status: 400 });
  }

  const clips = parseClipsJson(formData.get("clips"));
  if (!clips || clips.length === 0) {
    return NextResponse.json({ error: "`clips` must be a non-empty JSON array." }, { status: 400 });
  }

  const fillGaps = parseBoolean(formData.get("fillGaps"));

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stitch-export-"));
  const inputPath = path.join(tmpDir, "input.mp4");
  const workDir = path.join(tmpDir, "work");
  const outputPath = path.join(tmpDir, "sequence.mp4");
  let cleanupOnStreamClose = false;

  try {
    await fs.mkdir(workDir, { recursive: true });

    await pipeline(
      Readable.fromWeb(file.stream() as unknown as NodeReadableStream<Uint8Array>),
      createWriteStream(inputPath),
    );

    const meta = await getVideoMeta(inputPath);
    const audio = await hasAudio(inputPath);

    const normalized = clips
      .map((c) => {
        const start = Number.isFinite(c.in) ? c.in : 0;
        const rawEnd = Number.isFinite(c.out) ? c.out : 0;
        const end = rawEnd > 0 ? rawEnd : meta.duration;
        const crop: CropRect = c.crop
          ? {
              x: clamp(c.crop.x, 0, 1),
              y: clamp(c.crop.y, 0, 1),
              w: clamp(c.crop.w, 0, 1),
              h: clamp(c.crop.h, 0, 1),
            }
          : { x: 0, y: 0, w: 1, h: 1 };

        return {
          start: clamp(start, 0, meta.duration),
          end: clamp(end, 0, meta.duration),
          crop,
        };
      })
      .filter((c) => c.end > c.start + 0.001);

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "All clips were empty after validation." },
        { status: 400 },
      );
    }

    const renderOrder = normalized;
    const epsilon = 0.001;

    const segments: RenderSegment[] = [];
    for (let i = 0; i < renderOrder.length; i++) {
      const c = renderOrder[i];
      segments.push({ type: "clip", start: c.start, end: c.end, crop: c.crop });
      if (fillGaps && i < renderOrder.length - 1) {
        const next = renderOrder[i + 1];
        const gap = next.start - c.end;
        if (gap > epsilon) segments.push({ type: "gap", duration: gap });
      }
    }

    const piecePaths: string[] = [];
    const commonEncode = (out: string) => [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
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
      out,
    ];

    for (const seg of segments) {
      const index = String(piecePaths.length).padStart(4, "0");
      const out = path.join(workDir, `piece_${index}.mp4`);

      if (seg.type === "gap") {
        const dur = Math.max(0.01, seg.duration);
        await runFfmpeg(
          [
            "-y",
            "-f",
            "lavfi",
            "-t",
            dur.toFixed(3),
            "-i",
            `color=c=black:s=${meta.width}x${meta.height}:r=30`,
            "-f",
            "lavfi",
            "-t",
            dur.toFixed(3),
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            ...commonEncode(out),
          ],
          { timeoutMs: 10 * 60_000 },
        );

        piecePaths.push(out);
        continue;
      }

      const duration = Math.max(0.01, seg.end - seg.start);
      const inputs: string[] = [
        "-y",
        "-ss",
        seg.start.toFixed(3),
        "-to",
        seg.end.toFixed(3),
        "-i",
        inputPath,
      ];

      const inputsWithAudio = [...inputs];
      if (!audio) {
        inputsWithAudio.push(
          "-f",
          "lavfi",
          "-t",
          duration.toFixed(3),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=44100",
        );
      }

      const cropFilter = buildCropFilter(seg.crop, meta);
      const outputArgs: string[] = [];
      if (cropFilter) outputArgs.push("-vf", cropFilter);

      if (audio) {
        outputArgs.push("-map", "0:v:0", "-map", "0:a:0", ...commonEncode(out));
      } else {
        outputArgs.push("-map", "0:v:0", "-map", "1:a:0", "-shortest", ...commonEncode(out));
      }

      await runFfmpeg([...inputsWithAudio, ...outputArgs], { timeoutMs: 10 * 60_000 });
      piecePaths.push(out);
    }

    const concatList = piecePaths
      .map((p) => `file '${p.replaceAll("'", "'\\''")}'`)
      .join("\n");
    const listPath = path.join(workDir, "concat.txt");
    await fs.writeFile(listPath, `${concatList}\n`, "utf8");

    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], {
      timeoutMs: 10 * 60_000,
    });

    const stream = createReadStream(outputPath);
    const cleanup = async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    };
    stream.on("close", () => void cleanup());
    stream.on("error", () => void cleanup());
    cleanupOnStreamClose = true;

    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="sequence.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof CommandError ? err.stderr || err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (!cleanupOnStreamClose) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
