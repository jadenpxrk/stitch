import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { hasAudio, runFfmpeg } from "./ffmpeg";
import { EditPlanSpec, SessionState, ShakyFix } from "./types";

const OUTPUT_ROOT = path.resolve(process.cwd(), process.env.OUTPUT_ROOT || "sessions");

function sessionDir(sessionId: string) {
  return path.join(OUTPUT_ROOT, sessionId);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function downloadToFile(url: string, outPath: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download recording: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

export async function ensureRecordingFile(
  state: SessionState,
  overrideRecordingUrl?: string,
): Promise<{ recordingPath: string; recordingUrl?: string }> {
  const dir = sessionDir(state.id);
  await ensureDir(dir);

  if (state.recordingPath) {
    return { recordingPath: state.recordingPath, recordingUrl: state.recordingUrl ?? undefined };
  }

  const recordingUrl = overrideRecordingUrl || state.recordingUrl || "";
  if (!recordingUrl) {
    throw new Error("No recording URL available. Provide recordingUrl to /stop or /render.");
  }

  const outPath = path.join(dir, "recording.mp4");
  await downloadToFile(recordingUrl, outPath);
  state.recordingUrl = recordingUrl;
  state.recordingPath = outPath;
  return { recordingPath: outPath, recordingUrl };
}

async function extractFrame(inputPath: string, ts: number, outJpg: string) {
  await runFfmpeg([
    "-y",
    "-ss",
    ts.toFixed(3),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outJpg,
  ]);
}

async function renderSliceToPiece(opts: {
  inputPath: string;
  t0: number;
  t1: number;
  outPath: string;
}) {
  const duration = Math.max(0.01, opts.t1 - opts.t0);
  const audio = await hasAudio(opts.inputPath);

  const base = [
    "-y",
    "-ss",
    opts.t0.toFixed(3),
    "-to",
    opts.t1.toFixed(3),
    "-i",
    opts.inputPath,
  ];

  if (audio) {
    await runFfmpeg([
      ...base,
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
      opts.outPath,
    ]);
    return;
  }

  await runFfmpeg([
    ...base,
    "-f",
    "lavfi",
    "-t",
    duration.toFixed(3),
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
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
    opts.outPath,
  ]);
}

async function renderStabilizedPiece(opts: {
  inputPath: string;
  t0: number;
  t1: number;
  workDir: string;
  outPath: string;
}) {
  const slicePath = path.join(opts.workDir, "slice.mp4");
  const trfPath = path.join(opts.workDir, "transforms.trf");
  await ensureDir(opts.workDir);

  await renderSliceToPiece({ inputPath: opts.inputPath, t0: opts.t0, t1: opts.t1, outPath: slicePath });

  await runFfmpeg([
    "-y",
    "-i",
    slicePath,
    "-vf",
    `vidstabdetect=shakiness=5:accuracy=15:result=${trfPath}`,
    "-f",
    "null",
    "-",
  ]);

  await runFfmpeg([
    "-y",
    "-i",
    slicePath,
    "-vf",
    `vidstabtransform=smoothing=10:input=${trfPath}`,
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
    opts.outPath,
  ]);
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
    `[0:v][1:v]xfade=transition=fade:duration=${transition.toFixed(3)}:offset=${offset.toFixed(
      3,
    )},format=yuv420p[v]`,
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
}) {
  const cmd = process.env.VEO_BRIDGE_CMD;
  if (!cmd) return false;

  const args = [opts.firstJpg, opts.lastJpg, opts.outPath, opts.duration.toFixed(3)];
  const child = spawn(cmd, args, { stdio: "inherit" });
  const exitCode: number | null = await new Promise((resolve) => child.on("close", resolve));
  if (exitCode !== 0) {
    throw new Error(`VEO_BRIDGE_CMD failed (exit ${exitCode}): ${cmd}`);
  }
  return true;
}

export async function renderFinalMp4(opts: {
  state: SessionState;
  plan: EditPlanSpec;
  recordingPath: string;
}): Promise<{ finalPath: string; updatedPlan: EditPlanSpec }> {
  const dir = sessionDir(opts.state.id);
  const renderDir = path.join(dir, "render");
  const piecesDir = path.join(renderDir, "pieces");
  const bridgesDir = path.join(renderDir, "bridges");
  const stabilizedDir = path.join(renderDir, "stabilized");
  await Promise.all([ensureDir(renderDir), ensureDir(piecesDir), ensureDir(bridgesDir), ensureDir(stabilizedDir)]);

  const updatedSegments = opts.plan.segments.map((s) => ({
    ...s,
    outputs: { ...(s.outputs ?? {}) },
  }));
  const piecePaths: string[] = [];

  for (let i = 0; i < opts.plan.segments.length; i++) {
    const seg = opts.plan.segments[i];
    const duration = Math.max(0, seg.end - seg.start);
    const fix: ShakyFix = seg.final_fix;

    if (seg.type === "GOOD") {
      if (fix !== "KEEP") continue;
      const out = path.join(piecesDir, `piece_${String(piecePaths.length).padStart(4, "0")}.mp4`);
      await renderSliceToPiece({ inputPath: opts.recordingPath, t0: seg.start, t1: seg.end, outPath: out });
      piecePaths.push(out);
      continue;
    }

    if (fix === "CUT") {
      continue;
    }

    if (fix === "STABILIZE") {
      const out = path.join(stabilizedDir, `${seg.id || `seg_${i}`}.mp4`);
      const workDir = path.join(stabilizedDir, `${seg.id || `seg_${i}`}_work`);
      await renderStabilizedPiece({
        inputPath: opts.recordingPath,
        t0: seg.start,
        t1: seg.end,
        workDir,
        outPath: out,
      });

      updatedSegments[i].outputs = { ...(updatedSegments[i].outputs ?? {}) };
      updatedSegments[i].outputs["stabilized_clip_path"] = path.relative(dir, out);
      const piece = path.join(piecesDir, `piece_${String(piecePaths.length).padStart(4, "0")}.mp4`);
      await fs.copyFile(out, piece);
      piecePaths.push(piece);
      continue;
    }

    if (fix === "BRIDGE") {
      if (duration >= 8) {
        updatedSegments[i].outputs = { ...(updatedSegments[i].outputs ?? {}) };
        updatedSegments[i].outputs["bridge_error"] = "duration >= 8s (Veo limit)";
        const out = path.join(stabilizedDir, `${seg.id || `seg_${i}`}.mp4`);
        const workDir = path.join(stabilizedDir, `${seg.id || `seg_${i}`}_work`);
        await renderStabilizedPiece({
          inputPath: opts.recordingPath,
          t0: seg.start,
          t1: seg.end,
          workDir,
          outPath: out,
        });
        updatedSegments[i].final_fix = "STABILIZE";
        updatedSegments[i].outputs["stabilized_clip_path"] = path.relative(dir, out);
        const piece = path.join(piecesDir, `piece_${String(piecePaths.length).padStart(4, "0")}.mp4`);
        await fs.copyFile(out, piece);
        piecePaths.push(piece);
        continue;
      }

      // Extract boundary frames from neighboring GOOD segments when present; else fall back to first/last inside seg.
      const prev = opts.plan.segments[i - 1];
      const next = opts.plan.segments[i + 1];
      const epsilon = 0.1;

      const beforeRange = prev && prev.type === "GOOD" ? prev : seg;
      const afterRange = next && next.type === "GOOD" ? next : seg;

      const tBefore = clamp(seg.start - epsilon, beforeRange.start, beforeRange.end);
      const tAfter = clamp(seg.end + epsilon, afterRange.start, afterRange.end);

      const firstJpg = path.join(bridgesDir, `${seg.id || `seg_${i}`}_first.jpg`);
      const lastJpg = path.join(bridgesDir, `${seg.id || `seg_${i}`}_last.jpg`);
      await extractFrame(opts.recordingPath, tBefore, firstJpg);
      await extractFrame(opts.recordingPath, tAfter, lastJpg);

      const out = path.join(bridgesDir, `${seg.id || `seg_${i}`}.mp4`);
      const usedExternal = await runExternalBridge({ firstJpg, lastJpg, duration, outPath: out });
      if (!usedExternal) {
        await renderFallbackBridgePiece({ firstJpg, lastJpg, duration, outPath: out });
      }

      updatedSegments[i].outputs = { ...(updatedSegments[i].outputs ?? {}) };
      updatedSegments[i].outputs["bridge_clip_path"] = path.relative(dir, out);
      const piece = path.join(piecesDir, `piece_${String(piecePaths.length).padStart(4, "0")}.mp4`);
      await fs.copyFile(out, piece);
      piecePaths.push(piece);
      continue;
    }
  }

  if (piecePaths.length === 0) {
    throw new Error("Nothing to render (all segments were CUT or empty).");
  }

  const concatList = piecePaths
    .map((p) => `file '${p.replaceAll("'", "'\\''")}'`)
    .join("\n");
  const listPath = path.join(renderDir, "concat.txt");
  await fs.writeFile(listPath, `${concatList}\n`, "utf8");

  const finalPath = path.join(renderDir, "final.mp4");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", finalPath]);

  const updatedPlan: EditPlanSpec = {
    ...opts.plan,
    segments: updatedSegments,
  };

  return { finalPath, updatedPlan };
}
