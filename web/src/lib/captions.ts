import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ensureSessionDir, getSessionDir } from "./persistence";

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_STT_URL =
  process.env.ELEVENLABS_STT_URL || "https://api.elevenlabs.io/v1/speech-to-text";
const ELEVENLABS_LANGUAGE_CODE = process.env.ELEVENLABS_LANGUAGE_CODE;
const ELEVENLABS_STT_MODEL_ID = process.env.ELEVENLABS_STT_MODEL_ID;
const FFMPEG_PATH = process.env.FFMPEG_PATH || "ffmpeg";

const MAX_CUE_DURATION_S = 6;
const MAX_CUE_CHARS = 84;

export async function generateCaptionsForSession(
  sessionId: string,
  recordingUrl: string,
): Promise<string> {
  if (!recordingUrl) throw new Error("recordingUrl missing");
  await ensureSessionDir(sessionId);
  const sessionDir = getSessionDir(sessionId);
  const recordingPath = await resolveRecordingPath(recordingUrl, sessionDir);
  const audioPath = path.join(sessionDir, "audio.wav");
  const segments = await generateCaptionsSegmentsFromRecording(recordingPath, audioPath);
  if (!segments.length) throw new Error("No timestamped segments returned.");
  const vtt = formatVtt(segments);
  const vttRelPath = "captions.vtt";
  await fs.writeFile(path.join(sessionDir, vttRelPath), vtt, "utf8");
  return vttRelPath;
}

export async function generateCaptionsVttFromRecording(recordingPath: string): Promise<string> {
  const tmpAudioPath = `${recordingPath}.audio.wav`;
  const segments = await generateCaptionsSegmentsFromRecording(recordingPath, tmpAudioPath);
  if (!segments.length) throw new Error("No timestamped segments returned.");
  return formatVtt(segments);
}

async function generateCaptionsSegmentsFromRecording(recordingPath: string, audioPath: string) {
  await extractAudio(recordingPath, audioPath);
  const transcript = await transcribeAudio(audioPath);
  const segments = filterFillerWords(extractSegments(transcript));
  if (process.env.CAPTIONS_KEEP_AUDIO !== "1") {
    await fs.unlink(audioPath).catch(() => undefined);
  }
  return segments;
}

const FILLER_WORDS = new Set(["um", "umm", "uh", "er", "hmm", "ah"]);

function normalizeToken(token: string) {
  return token
    .toLowerCase()
    .replace(/^[^a-z0-9']+/gi, "")
    .replace(/[^a-z0-9']+$/gi, "");
}

function shouldRemoveLike(tokens: string[], index: number): boolean {
  const prev = index > 0 ? normalizeToken(tokens[index - 1] ?? "") : "";
  const next = index + 1 < tokens.length ? normalizeToken(tokens[index + 1] ?? "") : "";

  if (prev === "i") return false;
  if (next === "this" || next === "that") return false;
  return true;
}

export function filterFillerWords(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (!segments.length) return [];

  const out: TranscriptSegment[] = [];

  for (const seg of segments) {
    const tokens = String(seg.text ?? "").split(/\s+/).filter(Boolean);
    const kept: string[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const norm = normalizeToken(token);

      if (!norm) {
        continue;
      }

      if (norm === "like") {
        if (shouldRemoveLike(tokens, i)) continue;
        kept.push(token);
        continue;
      }

      if (FILLER_WORDS.has(norm)) {
        continue;
      }

      kept.push(token);
    }

    const text = kept.join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    out.push({
      start: seg.start,
      end: seg.end,
      text,
    });
  }

  return out;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function resolveRecordingPath(recordingUrl: string, sessionDir: string) {
  if (recordingUrl.startsWith("file://")) {
    return fileURLToPath(recordingUrl);
  }
  if (!isHttpUrl(recordingUrl)) {
    return path.resolve(recordingUrl);
  }
  const url = new URL(recordingUrl);
  const ext = path.extname(url.pathname) || ".mp4";
  const localPath = path.join(sessionDir, `recording${ext}`);
  try {
    await fs.access(localPath);
    return localPath;
  } catch {
    // fallthrough to download
  }
  await downloadFile(recordingUrl, localPath);
  return localPath;
}

async function downloadFile(url: string, destPath: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download recording: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

async function extractAudio(inputPath: string, outputPath: string) {
  const args = [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "wav",
    outputPath,
  ];
  await runCommand(FFMPEG_PATH, args, "ffmpeg audio extraction failed");
}

async function runCommand(cmd: string, args: string[], errorPrefix: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${errorPrefix}: ${stderr.trim()}`));
    });
  });
}

async function transcribeAudio(audioPath: string) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY missing");
  }
  const buffer = await fs.readFile(audioPath);
  const form = new FormData();
  form.append(
    "file",
    new Blob([buffer], { type: "audio/wav" }),
    path.basename(audioPath),
  );
  if (ELEVENLABS_LANGUAGE_CODE) {
    form.append("language_code", ELEVENLABS_LANGUAGE_CODE);
  }
  form.append("model_id", ELEVENLABS_STT_MODEL_ID || "scribe_v1");
  const res = await fetch(ELEVENLABS_STT_URL, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs STT failed: ${res.status} ${text}`);
  }
  return res.json();
}

function extractSegments(payload: unknown): TranscriptSegment[] {
  if (!payload) return [];

  const direct = findSegments(payload);
  if (direct.length) return direct;

  if (isRecord(payload) && Array.isArray(payload.words)) {
    return groupWords(payload.words);
  }

  return [];
}

function findSegments(payload: unknown): TranscriptSegment[] {
  if (!isRecord(payload)) return [];
  const candidates =
    payload.segments ?? payload.utterances ?? payload.transcripts ?? payload.chunks;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((seg): TranscriptSegment | null => {
      if (!isRecord(seg)) return null;
      const start = toNumber(seg.start ?? seg["start_time"] ?? seg["startTime"]);
      let end = toNumber(seg.end ?? seg["end_time"] ?? seg["endTime"]);
      if (!Number.isFinite(end) || end <= start) {
        end = start + 0.5;
      }
      return {
        start,
        end,
        text: String(seg.text ?? seg.transcript ?? seg.value ?? "").trim(),
      };
    })
    .filter(
      (seg): seg is TranscriptSegment =>
        seg != null && Boolean(seg.text) && Number.isFinite(seg.start),
    );
}

function groupWords(words: unknown[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let start: number | null = null;
  let end = 0;
  let text = "";

  const flush = () => {
    if (!text.trim() || start === null) return;
    segments.push({
      start,
      end: Math.max(end, start + 0.2),
      text: text.trim(),
    });
    start = null;
    end = 0;
    text = "";
  };

  for (const word of words) {
    if (!isRecord(word)) continue;
    const token = String(word.text ?? word.word ?? "").trim();
    if (!token) continue;
    const wordStart = toNumber(word.start ?? word["start_time"] ?? word["startTime"]);
    const wordEnd = toNumber(word.end ?? word["end_time"] ?? word["endTime"]);
    if (!Number.isFinite(wordStart)) continue;
    const nextText = appendWord(text, token);
    const nextDuration =
      start === null ? 0 : Math.max(wordEnd, wordStart) - start;
    const shouldBreak =
      (start !== null && nextDuration > MAX_CUE_DURATION_S) ||
      nextText.length > MAX_CUE_CHARS;

    if (shouldBreak) flush();

    if (start === null) start = wordStart;
    end = Math.max(end, wordEnd || wordStart);
    text = appendWord(text, token);

    if (/[.!?]$/.test(token) && text.length > 40) {
      flush();
    }
  }

  flush();
  return segments;
}

function appendWord(current: string, token: string) {
  if (!current) return token;
  if (/^[,.:;!?]/.test(token)) return current + token;
  return `${current} ${token}`;
}

function formatVtt(segments: TranscriptSegment[]): string {
  const lines = ["WEBVTT", ""];
  const normalized = segments
    .map((seg) => ({
      start: Math.max(0, seg.start),
      end: Math.max(seg.end, seg.start + 0.2),
      text: seg.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((seg) => seg.text);

  for (const seg of normalized) {
    lines.push(`${formatTimestamp(seg.start)} --> ${formatTimestamp(seg.end)}`);
    lines.push(seg.text);
    lines.push("");
  }

  return lines.join("\n");
}

function formatTimestamp(seconds: number) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(ms).padStart(3, "0")}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown) {
  const num = typeof value === "string" ? Number(value) : Number(value ?? NaN);
  return Number.isFinite(num) ? num : NaN;
}
