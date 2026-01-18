import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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

// Filler words to remove from captions
const FILLER_WORDS = new Set(["umm", "um", "uh", "uhh", "ah", "ahh", "hmm", "hm", "er", "erm"]);
// "like" is only a filler when standalone (not part of "I like", "like this", etc.)
const FILLER_LIKE_PATTERN = /^like$/i;

export async function generateCaptionsForSession(
  sessionId: string,
  recordingUrl: string,
): Promise<string> {
  if (!recordingUrl) throw new Error("recordingUrl missing");
  await ensureSessionDir(sessionId);
  const sessionDir = getSessionDir(sessionId);
  const recordingPath = await resolveRecordingPath(recordingUrl, sessionDir);
  const audioPath = path.join(sessionDir, "audio.wav");
  await extractAudio(recordingPath, audioPath);
  const transcript = await transcribeAudio(audioPath);
  const rawSegments = extractSegments(transcript);
  if (!rawSegments.length) throw new Error("No timestamped segments returned.");
  const segments = filterFillerWords(rawSegments);
  if (!segments.length) throw new Error("All segments empty after filler removal.");
  const vtt = formatVtt(segments);
  const vttRelPath = "captions.vtt";
  await fs.writeFile(path.join(sessionDir, vttRelPath), vtt, "utf8");
  if (process.env.CAPTIONS_KEEP_AUDIO !== "1") {
    await fs.unlink(audioPath).catch(() => undefined);
  }
  return vttRelPath;
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
  if (!res.body) throw new Error("Recording download returned empty body");
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(destPath));
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
    "audio",
    new Blob([buffer], { type: "audio/wav" }),
    path.basename(audioPath),
  );
  if (ELEVENLABS_LANGUAGE_CODE) {
    form.append("language_code", ELEVENLABS_LANGUAGE_CODE);
  }
  if (ELEVENLABS_STT_MODEL_ID) {
    form.append("model_id", ELEVENLABS_STT_MODEL_ID);
  }
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

function extractSegments(payload: any): TranscriptSegment[] {
  if (!payload) return [];

  const direct = findSegments(payload);
  if (direct.length) return direct;

  if (Array.isArray(payload.words)) {
    return groupWords(payload.words);
  }

  return [];
}

function findSegments(payload: any): TranscriptSegment[] {
  const candidates =
    payload.segments ||
    payload.utterances ||
    payload.transcripts ||
    payload.chunks;
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((seg: any) => {
      const start = toNumber(seg.start ?? seg.start_time ?? seg.startTime);
      let end = toNumber(seg.end ?? seg.end_time ?? seg.endTime);
      if (!Number.isFinite(end) || end <= start) {
        end = start + 0.5;
      }
      return {
        start,
        end,
        text: String(seg.text ?? seg.transcript ?? seg.value ?? "").trim(),
      };
    })
    .filter((seg: TranscriptSegment) => seg.text && Number.isFinite(seg.start));
}

function groupWords(words: any[]): TranscriptSegment[] {
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
    const token = String(word.text ?? word.word ?? "").trim();
    if (!token) continue;
    const wordStart = toNumber(word.start ?? word.start_time ?? word.startTime);
    const wordEnd = toNumber(word.end ?? word.end_time ?? word.endTime);
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

function toNumber(value: unknown) {
  const num = typeof value === "string" ? Number(value) : Number(value ?? NaN);
  return Number.isFinite(num) ? num : NaN;
}

/**
 * Check if a word is a standalone filler word.
 * "like" is only considered filler when it's standalone and not part of meaningful context.
 */
function isFillerWord(word: string, prevWord?: string, nextWord?: string): boolean {
  const lower = word.toLowerCase().replace(/[.,!?;:]+$/, "");

  // Direct filler words
  if (FILLER_WORDS.has(lower)) {
    return true;
  }

  // "like" is filler only when standalone (not "I like", "like this", "looks like")
  if (FILLER_LIKE_PATTERN.test(lower)) {
    const prevLower = prevWord?.toLowerCase();
    const nextLower = nextWord?.toLowerCase();

    // Keep "like" if preceded by subject pronouns or verbs indicating preference
    const meaningfulPrev = ["i", "you", "we", "they", "would", "dont", "don't", "really", "do"];
    if (prevLower && meaningfulPrev.includes(prevLower)) {
      return false;
    }

    // Keep "like" if followed by "this", "that", "a", "the", or similar
    const meaningfulNext = ["this", "that", "a", "an", "the", "it", "them", "him", "her", "me", "us"];
    if (nextLower && meaningfulNext.includes(nextLower)) {
      return false;
    }

    // Otherwise, standalone "like" is filler
    return true;
  }

  return false;
}

/**
 * Filter filler words from segment text while preserving timestamps.
 * Normalizes whitespace and drops segments that become empty.
 */
export function filterFillerWords(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((seg) => {
      const words = seg.text.split(/\s+/);
      const filtered: string[] = [];

      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const prevWord = i > 0 ? words[i - 1] : undefined;
        const nextWord = i < words.length - 1 ? words[i + 1] : undefined;

        if (!isFillerWord(word, prevWord, nextWord)) {
          filtered.push(word);
        }
      }

      const text = filtered.join(" ").replace(/\s+/g, " ").trim();
      return { ...seg, text };
    })
    .filter((seg) => seg.text.length > 0);
}
