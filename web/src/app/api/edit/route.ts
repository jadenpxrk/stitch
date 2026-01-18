import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseNumber(value: FormDataEntryValue | null): number | null {
  if (value == null) return null;
  const n = Number(String(value));
  return Number.isFinite(n) ? n : null;
}

function parseCrop(value: FormDataEntryValue | null): CropRect | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  let parsed: Partial<CropRect>;
  try {
    parsed = JSON.parse(value) as Partial<CropRect>;
  } catch {
    return null;
  }
  if (
    typeof parsed.x !== "number" ||
    typeof parsed.y !== "number" ||
    typeof parsed.w !== "number" ||
    typeof parsed.h !== "number"
  ) {
    return null;
  }
  return {
    x: clamp(parsed.x, 0, 1),
    y: clamp(parsed.y, 0, 1),
    w: clamp(parsed.w, 0, 1),
    h: clamp(parsed.h, 0, 1),
  };
}

function isDefaultCrop(crop: CropRect) {
  return crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
}

function makeEven(n: number) {
  return n - (n % 2);
}

async function getVideoDimensions(inputPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await runFfprobe(
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      inputPath,
    ],
    { timeoutMs: 20_000 },
  );

  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
  const stream = parsed.streams?.[0];
  if (!stream?.width || !stream?.height) {
    throw new Error("Unable to determine input video dimensions.");
  }
  return { width: stream.width, height: stream.height };
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

  const trimStart = parseNumber(formData.get("trimStart")) ?? 0;
  const trimEnd = parseNumber(formData.get("trimEnd")) ?? 0;
  const crop = parseCrop(formData.get("crop")) ?? { x: 0, y: 0, w: 1, h: 1 };

  if (trimStart < 0 || trimEnd <= 0 || trimEnd <= trimStart) {
    return NextResponse.json(
      { error: "`trimStart`/`trimEnd` are invalid." },
      { status: 400 },
    );
  }

  const duration = Math.max(0.01, trimEnd - trimStart);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "stitch-edit-"));
  const inputPath = path.join(tmpDir, "input.mp4");
  const outputPath = path.join(tmpDir, "output.mp4");

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buf);

    const dims = await getVideoDimensions(inputPath);
    const cropFilter = buildCropFilter(crop, dims);

    const audio = await hasAudio(inputPath);
    const inputs: string[] = [
      "-y",
      "-ss",
      trimStart.toFixed(3),
      "-to",
      trimEnd.toFixed(3),
      "-i",
      inputPath,
    ];

    if (!audio) {
      inputs.push(
        "-f",
        "lavfi",
        "-t",
        duration.toFixed(3),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
      );
    }

    const outputArgs: string[] = [];
    if (cropFilter) {
      outputArgs.push("-vf", cropFilter);
    }

    if (audio) {
      outputArgs.push(
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
        outputPath,
      );
    } else {
      outputArgs.push(
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
        outputPath,
      );
    }

    await runFfmpeg([...inputs, ...outputArgs], { timeoutMs: 10 * 60_000 });

    const outBuf = await fs.readFile(outputPath);
    return new NextResponse(outBuf, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="edited.mp4"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof CommandError ? err.stderr || err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
