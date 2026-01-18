#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Blob } from "node:buffer";

function usage() {
  return `Usage: veo-bridge.mjs <first.jpg> <last.jpg> <out.mp4> <durationSeconds>

Env:
  FAL_KEY                  Required. fal.ai API key.
  FAL_VEO_ENDPOINT         Optional. Default: fal-ai/veo3.1/first-last-frame-to-video
  VEO_BRIDGE_PROMPT        Optional. Prompt for motion/continuity.
  VEO_BRIDGE_RESOLUTION    Optional. auto | 720p | 1080p (default: auto)
  VEO_BRIDGE_ASPECT_RATIO  Optional. auto | 16:9 | 9:16 (default: auto)
  FFMPEG_PATH              Optional. Override ffmpeg binary path.
  FFPROBE_PATH             Optional. Override ffprobe binary path.
`;
}

function stripInlineComment(value) {
  return value.replace(/\s+#.*$/, "").trim();
}

function resolveCommand(envVarName, fallback) {
  const raw = process.env[envVarName];
  if (!raw) return fallback;
  const cleaned = stripInlineComment(raw);
  if (!cleaned) return fallback;
  if (cleaned.includes("/") || cleaned.includes("\\")) {
    return fs.existsSync(cleaned) ? cleaned : fallback;
  }
  return cleaned;
}

function isEnoent(err) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

async function run(command, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const child = spawn(command, args, { cwd: opts.cwd });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => (stdout += String(d)));
  child.stderr?.on("data", (d) => (stderr += String(d)));

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  let exitCode = null;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
  }

  if (timedOut) {
    throw new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}\n${stderr}`);
  }

  if (exitCode !== 0) {
    const msg = `Command failed (exit ${exitCode}): ${command} ${args.join(" ")}`;
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    throw new Error(detail ? `${msg}\n${detail}` : msg);
  }

  return { stdout, stderr };
}

async function runFfmpeg(args, opts = {}) {
  const ffmpeg = resolveCommand("FFMPEG_PATH", "ffmpeg");
  try {
    return await run(ffmpeg, args, opts);
  } catch (err) {
    if (!isEnoent(err)) throw err;
    const candidates =
      process.platform === "darwin"
        ? ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]
        : ["/usr/bin/ffmpeg", "/bin/ffmpeg"];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      return run(candidate, args, opts);
    }
    throw err;
  }
}

async function runFfprobe(args, opts = {}) {
  const ffprobe = resolveCommand("FFPROBE_PATH", "ffprobe");
  try {
    return await run(ffprobe, args, opts);
  } catch (err) {
    if (!isEnoent(err)) throw err;
    const candidates =
      process.platform === "darwin"
        ? ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "/usr/bin/ffprobe"]
        : ["/usr/bin/ffprobe", "/bin/ffprobe"];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) continue;
      return run(candidate, args, opts);
    }
    throw err;
  }
}

function pickDurationSeconds(targetSeconds) {
  if (targetSeconds <= 4) return "4s";
  if (targetSeconds <= 6) return "6s";
  return "8s";
}

function durationStringToSeconds(duration) {
  if (duration === "4s") return 4;
  if (duration === "6s") return 6;
  return 8;
}

async function getImageDims(imagePath) {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0:s=x",
    imagePath,
  ]);

  const m = stdout.trim().match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

async function getVideoDurationSeconds(videoPath) {
  const { stdout } = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    videoPath,
  ]);

  const parsed = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function chooseResolution(value, dims) {
  const cleaned = (value || "").trim().toLowerCase();
  if (cleaned === "720p" || cleaned === "1080p") return cleaned;
  if (cleaned && cleaned !== "auto") return "720p";
  if (!dims) return "720p";
  const minDim = Math.min(dims.width, dims.height);
  return minDim >= 1080 ? "1080p" : "720p";
}

async function main() {
  const [firstJpgPath, lastJpgPath, outMp4Path, durationSecondsRaw] = process.argv.slice(2);

  if (!firstJpgPath || !lastJpgPath || !outMp4Path || !durationSecondsRaw) {
    console.error(usage());
    process.exit(2);
  }

  const targetSeconds = Number(durationSecondsRaw);
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new Error(`Invalid durationSeconds: ${durationSecondsRaw}`);
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    throw new Error("FAL_KEY is not set.");
  }

  const dims = await getImageDims(firstJpgPath).catch(() => null);
  const resolution = chooseResolution(process.env.VEO_BRIDGE_RESOLUTION, dims);
  const aspectRatio = (process.env.VEO_BRIDGE_ASPECT_RATIO || "auto").trim();

  const prompt =
    process.env.VEO_BRIDGE_PROMPT ||
    "Keep the same scene and subject. Smooth camera motion. No new objects. Match lighting and style.";

  const endpoint = (process.env.FAL_VEO_ENDPOINT || "fal-ai/veo3.1/first-last-frame-to-video").trim();

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available. Use Node.js 18+.");
  }

  let fal;
  try {
    ({ fal } = await import("@fal-ai/client"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `Failed to load @fal-ai/client (${msg}). Install it in web/: npm install --save @fal-ai/client`,
    );
    process.exit(1);
  }

  fal.config({ credentials: falKey });

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "veo-bridge-"));
  const rawMp4Path = path.join(tmpDir, "raw.mp4");
  const cookedMp4Path = path.join(tmpDir, "out.mp4");

  try {
    const firstBlob = new Blob([await fsp.readFile(firstJpgPath)], { type: "image/jpeg" });
    const lastBlob = new Blob([await fsp.readFile(lastJpgPath)], { type: "image/jpeg" });

    const requestedDuration = pickDurationSeconds(targetSeconds);
    const result = await fal.subscribe(endpoint, {
      input: {
        prompt,
        first_frame_url: firstBlob,
        last_frame_url: lastBlob,
        duration: requestedDuration,
        aspect_ratio: aspectRatio,
        resolution,
        generate_audio: false,
        auto_fix: true,
      },
      logs: true,
      onQueueUpdate(update) {
        if (update.status === "IN_QUEUE") console.error("fal queue position:", update.queue_position);
        if (update.status === "IN_PROGRESS") console.error("fal running…");
      },
    });

    const videoUrl = result?.data?.video?.url;
    if (!videoUrl) {
      throw new Error("fal response missing video.url");
    }

    const res = await fetch(videoUrl);
    if (!res.ok) throw new Error(`Failed to download Veo output: ${res.status} ${res.statusText}`);
    await fsp.writeFile(rawMp4Path, Buffer.from(await res.arrayBuffer()));

    const duration = targetSeconds.toFixed(3);

    const rawDurationSeconds =
      (await getVideoDurationSeconds(rawMp4Path).catch(() => null)) ?? durationStringToSeconds(requestedDuration);

    // Veo supports discrete durations (4s/6s/8s). To hit the exact target duration AND
    // preserve the provided last frame, time-warp the full generated clip to `targetSeconds`,
    // then pad by cloning the last frame (so we never cut before it).
    const speedFactor = Math.max(0.01, Math.min(1, targetSeconds / rawDurationSeconds));
    const setpts = `setpts=${speedFactor.toFixed(6)}*PTS`;
    const scale = dims ? `scale=${dims.width}:${dims.height}` : null;
    const vf = [scale, "setsar=1", setpts, "tpad=stop_mode=clone:stop_duration=1", "format=yuv420p"]
      .filter(Boolean)
      .join(",");

    await runFfmpeg([
      "-y",
      "-i",
      rawMp4Path,
      "-f",
      "lavfi",
      "-t",
      duration,
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-shortest",
      "-t",
      duration,
      "-vf",
      vf,
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
      cookedMp4Path,
    ]);

    await fsp.mkdir(path.dirname(outMp4Path), { recursive: true });
    await fsp.copyFile(cookedMp4Path, outMp4Path);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
