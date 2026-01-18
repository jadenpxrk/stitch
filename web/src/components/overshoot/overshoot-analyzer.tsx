"use client";

import * as React from "react";
import { RealtimeVision, StreamInferenceResult } from "@overshoot/sdk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type ThumbnailCandidate = {
  timeSeconds: number;
  score: number;
  reasoning: string;
  hasFace: boolean;
  hasText: boolean;
  isActionShot: boolean;
};

type PeakTick = {
  windowEndSeconds: number;
  peakScore: number;
  clipType: string | null;
  hookText: string | null;
  suggestedStart: number | null;
  suggestedEnd: number | null;
};

type ExtractedThumbnail = {
  timestampSeconds: number;
  candidateUrl: string;
  generatedUrl: string;
};

type ExtractedClip = {
  start: number;
  end: number;
  url: string;
  peakScore?: number;
  clipType?: string;
  hookText?: string;
};

type ClipExtractRequest = {
  start: number;
  end: number;
  peakScore?: number;
  clipType?: string;
  hookText?: string;
};

type ExtractResponse = {
  analysisId: string;
  durationSeconds: number | null;
  inputUrl: string;
  thumbnails: ExtractedThumbnail[];
  clips: ExtractedClip[];
};

type AnalysisResult = {
  analysisId: string;
  inputUrl: string;
  thumbnails: Array<ExtractedThumbnail & { score?: number; reasoning?: string }>;
  clips: ExtractedClip[];
};

const apiUrl =
  process.env.NEXT_PUBLIC_OVERSHOOT_API_URL || "https://cluster1.overshoot.ai/api/v0.2";
const apiKey = process.env.NEXT_PUBLIC_OVERSHOOT_API_KEY || "";
const model = process.env.NEXT_PUBLIC_OVERSHOOT_MODEL || undefined;

const thumbnailPrompt = `
Analyze this video segment and rate it as a potential thumbnail on a scale of 0-100.
Consider:
- Visual clarity and sharpness
- Facial expressions (if people present)
- Action/movement (frozen action moments)
- Composition and framing
- Emotional impact
- Text/graphics visibility
- Avoid blurry, dark, or transitional frames

Return ONLY valid JSON with exactly these keys:
{
  "thumbnail_score": number,
  "reasoning": string,
  "has_face": boolean,
  "has_text": boolean,
  "is_action_shot": boolean,
  "timestamp_seconds": number
}
No other text. timestamp_seconds should be the best guess for the strongest frame time (seconds from start of the full video).
`.trim();

const thumbnailSchema = {
  type: "object",
  properties: {
    thumbnail_score: { type: "number" },
    timestamp_seconds: { type: "number" },
    reasoning: { type: "string" },
    has_face: { type: "boolean" },
    has_text: { type: "boolean" },
    is_action_shot: { type: "boolean" },
  },
} as const;

const peakClipPrompt = `
Analyze this video segment for viral/engaging content potential.
Rate as a "peak moment" suitable for TikTok/Reels/Shorts on a scale of 0-100.
Consider:
- High energy or emotional moments
- Surprising or unexpected events
- Humor or entertainment value
- Educational "aha" moments
- Hook potential (would this grab attention?)

Return ONLY valid JSON with exactly these keys:
{
  "peak_score": number,
  "clip_type": "hook" | "climax" | "punchline" | "reveal" | "educational" | "emotional",
  "suggested_clip_start": number,
  "suggested_clip_end": number,
  "hook_text": string
}
No other text. suggested_clip_start/end are best-guess seconds from start of the full video.
`.trim();

const peakClipSchema = {
  type: "object",
  properties: {
    peak_score: { type: "number" },
    clip_type: {
      type: "string",
      enum: ["hook", "climax", "punchline", "reveal", "educational", "emotional"],
    },
    suggested_clip_start: { type: "number" },
    suggested_clip_end: { type: "number" },
    hook_text: { type: "string" },
  },
} as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse(value: unknown): unknown | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getResultJson(result: StreamInferenceResult): unknown | null {
  if (!result?.ok) return null;
  return safeJsonParse(result.result);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const t = window.setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function prepareTimingVideo(file: File, signal?: AbortSignal) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.loop = false;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.top = "-9999px";

  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }

      const timeout = window.setTimeout(() => reject(new Error("Video loading timeout.")), 10_000);
      const cleanup = () => window.clearTimeout(timeout);

      video.onloadedmetadata = () => {
        cleanup();
        resolve();
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("Failed to load video metadata."));
      };

      signal?.addEventListener(
        "abort",
        () => {
          cleanup();
          reject(new Error("aborted"));
        },
        { once: true },
      );

      if (video.readyState >= 1) {
        cleanup();
        resolve();
      }
    });

    video.currentTime = 0;
  } catch (err) {
    video.remove();
    URL.revokeObjectURL(url);
    throw err;
  }

  return { video, url };
}

function pickTopThumbnails(candidates: ThumbnailCandidate[], durationSeconds: number, count = 3) {
  const valid = candidates
    .filter((c) => Number.isFinite(c.score))
    .filter((c) => Number.isFinite(c.timeSeconds))
    .filter((c) => c.score > 0)
    .map((c) => ({
      ...c,
      timeSeconds: durationSeconds > 0 ? clamp(c.timeSeconds, 0, durationSeconds) : Math.max(0, c.timeSeconds),
    }));

  const sorted = [...valid].sort((a, b) => b.score - a.score);
  if (sorted.length === 0) return [];

  const buckets: Array<ThumbnailCandidate | null> = [null, null, null];
  for (const c of sorted) {
    const idx =
      durationSeconds > 0 ? Math.min(2, Math.max(0, Math.floor((c.timeSeconds / durationSeconds) * 3))) : 0;
    const prev = buckets[idx];
    if (!prev || c.score > prev.score) buckets[idx] = c;
  }

  const picked: ThumbnailCandidate[] = buckets.filter(Boolean) as ThumbnailCandidate[];
  picked.sort((a, b) => b.score - a.score);

  const minGap = durationSeconds > 0 ? Math.max(2, durationSeconds / 12) : 2;
  for (const c of sorted) {
    if (picked.length >= count) break;
    if (picked.some((p) => Math.abs(p.timeSeconds - c.timeSeconds) < minGap)) continue;
    picked.push(c);
  }

  return picked.slice(0, count);
}

function normalizeClipRange(start: number, end: number, durationSeconds: number) {
  const minLen = 15;
  const maxLen = 60;
  const dur = Math.max(0, durationSeconds);

  let s = Math.max(0, start);
  let e = Math.max(s, end);
  if (dur > 0) {
    s = clamp(s, 0, dur);
    e = clamp(e, 0, dur);
  }

  let len = e - s;
  if (len <= 0) return null;

  if (len < minLen) {
    const pad = (minLen - len) / 2;
    s -= pad;
    e += pad;
  }

  len = e - s;
  if (len > maxLen) {
    const center = (s + e) / 2;
    s = center - maxLen / 2;
    e = center + maxLen / 2;
  }

  if (dur > 0) {
    const clampedS = clamp(s, 0, dur);
    const clampedE = clamp(e, 0, dur);
    s = clampedS;
    e = clampedE;
  }

  len = e - s;
  if (len < minLen && dur > 0) {
    if (s <= 0.001) {
      s = 0;
      e = clamp(minLen, 0, dur);
    } else if (e >= dur - 0.001) {
      e = dur;
      s = clamp(dur - minLen, 0, dur);
    }
  }

  if (e <= s) return null;
  return { start: s, end: e };
}

function buildPeakClips(ticks: PeakTick[], durationSeconds: number) {
  const windowLen = 3;
  const threshold = 70;
  const candidates = ticks
    .filter((t) => Number.isFinite(t.peakScore))
    .filter((t) => t.peakScore >= threshold)
    .map((t) => {
      const end = durationSeconds > 0 ? clamp(t.windowEndSeconds, 0, durationSeconds) : Math.max(0, t.windowEndSeconds);
      const start = Math.max(0, end - windowLen);
      return {
        start,
        end,
        peakScore: t.peakScore,
        clipType: t.clipType,
        hookText: t.hookText,
        suggestedStart: t.suggestedStart,
        suggestedEnd: t.suggestedEnd,
      };
    })
    .sort((a, b) => a.start - b.start);

  if (candidates.length === 0) return [];

  const merged: Array<{
    start: number;
    end: number;
    top: (typeof candidates)[number];
  }> = [];

  const mergeGap = 1;
  for (const cand of candidates) {
    const last = merged.at(-1);
    if (!last || cand.start > last.end + mergeGap) {
      merged.push({ start: cand.start, end: cand.end, top: cand });
      continue;
    }
    last.end = Math.max(last.end, cand.end);
    if (cand.peakScore > last.top.peakScore) last.top = cand;
  }

  const clips: ClipExtractRequest[] = [];
  for (const seg of merged) {
    const top = seg.top;

    const suggested =
      top.suggestedStart != null && top.suggestedEnd != null
        ? normalizeClipRange(top.suggestedStart, top.suggestedEnd, durationSeconds)
        : null;

    const derived = normalizeClipRange(seg.start, seg.end, durationSeconds);
    const picked = suggested ?? derived;
    if (!picked) continue;

    clips.push({
      start: picked.start,
      end: picked.end,
      peakScore: top.peakScore,
      clipType: top.clipType ?? undefined,
      hookText: top.hookText ?? undefined,
    });
  }

  clips.sort((a, b) => (b.peakScore ?? 0) - (a.peakScore ?? 0));
  return clips.slice(0, 5);
}

async function runOvershoot<T>(opts: {
  file: File;
  durationSeconds: number;
  processing: { clip_length_seconds: number; delay_seconds: number; fps: number; sampling_ratio: number };
  prompt: string;
  outputSchema: Record<string, unknown>;
  parse: (payload: unknown, elapsedSeconds: number) => T | null;
  onProgress?: (elapsedSeconds: number) => void;
  signal?: AbortSignal;
}) {
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_OVERSHOOT_API_KEY is not set.");
  }

  const results: T[] = [];
  let vision: RealtimeVision | null = null;
  const timing = await prepareTimingVideo(opts.file, opts.signal);

  try {
    vision = new RealtimeVision({
      apiUrl,
      apiKey,
      model,
      source: { type: "video", file: opts.file },
      processing: opts.processing,
      prompt: opts.prompt,
      outputSchema: opts.outputSchema,
      onResult: (result) => {
        const elapsedSeconds = timing.video.currentTime;
        opts.onProgress?.(elapsedSeconds);
        const json = getResultJson(result);
        const parsed = opts.parse(json, elapsedSeconds);
        if (parsed) results.push(parsed);
      },
    });

    await Promise.all([vision.start(), timing.video.play()]);

    const total = Math.max(0.5, opts.durationSeconds);
    while (!timing.video.ended && timing.video.currentTime < total) {
      if (opts.signal?.aborted) throw new Error("aborted");
      opts.onProgress?.(timing.video.currentTime);
      await sleep(250, opts.signal);
    }
  } finally {
    await vision?.stop().catch(() => undefined);
    timing.video.pause();
    timing.video.remove();
    URL.revokeObjectURL(timing.url);
  }

  return results;
}

export function OvershootAnalyzer({
  file,
  durationSeconds,
  onSelectThumbnail,
}: {
  file: File | null;
  durationSeconds: number;
  onSelectThumbnail?: (url: string) => void;
}) {
  const [status, setStatus] = React.useState<"idle" | "running" | "extracting" | "ready" | "error">("idle");
  const [phase, setPhase] = React.useState<"thumbnails" | "peaks" | null>(null);
  const [elapsed, setElapsed] = React.useState<number>(0);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<AnalysisResult | null>(null);
  const [selectedThumb, setSelectedThumb] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setStatus("idle");
    setPhase(null);
    setElapsed(0);
    setError(null);
    setResult(null);
    setSelectedThumb(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [file]);

  const canRun = Boolean(file) && durationSeconds > 0 && Boolean(apiKey);

  const run = async () => {
    if (!file) return;
    setError(null);
    setResult(null);
    setSelectedThumb(null);
    setElapsed(0);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      setStatus("running");
      setPhase("thumbnails");

      const thumbCandidates = await runOvershoot<ThumbnailCandidate>({
        file,
        durationSeconds,
        processing: { clip_length_seconds: 2, delay_seconds: 0.5, fps: 30, sampling_ratio: 0.2 },
        prompt: thumbnailPrompt,
        outputSchema: thumbnailSchema,
        signal: abort.signal,
        onProgress: (e) => setElapsed(e),
        parse: (payload, elapsedSeconds) => {
          const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
          if (!obj) return null;
          const score = Number(obj.thumbnail_score);
          const ts = Number(obj.timestamp_seconds);
          const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
          if (!Number.isFinite(score)) return null;
          const timeSeconds = Number.isFinite(ts) ? ts : elapsedSeconds;
          return {
            score,
            timeSeconds,
            reasoning,
            hasFace: Boolean(obj.has_face),
            hasText: Boolean(obj.has_text),
            isActionShot: Boolean(obj.is_action_shot),
          };
        },
      });

      const topThumbs = pickTopThumbnails(thumbCandidates, durationSeconds, 3);
      const frameTimes = topThumbs.map((t) => t.timeSeconds);

      setPhase("peaks");
      setElapsed(0);

      const peakTicks = await runOvershoot<PeakTick>({
        file,
        durationSeconds,
        processing: { clip_length_seconds: 3, delay_seconds: 1, fps: 30, sampling_ratio: 0.1 },
        prompt: peakClipPrompt,
        outputSchema: peakClipSchema,
        signal: abort.signal,
        onProgress: (e) => setElapsed(e),
        parse: (payload, elapsedSeconds) => {
          const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
          if (!obj) return null;
          const peakScore = Number(obj.peak_score);
          if (!Number.isFinite(peakScore)) return null;

          const clipType = typeof obj.clip_type === "string" ? obj.clip_type : null;
          const hookText = typeof obj.hook_text === "string" ? obj.hook_text : null;
          const suggestedStart = Number.isFinite(Number(obj.suggested_clip_start))
            ? Number(obj.suggested_clip_start)
            : null;
          const suggestedEnd = Number.isFinite(Number(obj.suggested_clip_end)) ? Number(obj.suggested_clip_end) : null;

          return {
            peakScore,
            windowEndSeconds: elapsedSeconds,
            clipType,
            hookText,
            suggestedStart,
            suggestedEnd,
          };
        },
      });

      const clips = buildPeakClips(peakTicks, durationSeconds);

      setStatus("extracting");
      setPhase(null);
      setElapsed(0);

      const fd = new FormData();
      fd.append("file", file);
      fd.append("frames", JSON.stringify(frameTimes));
      fd.append("clips", JSON.stringify(clips));

      const res = await fetch("/api/analysis/extract", { method: "POST", body: fd });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error || `Extraction failed (${res.status})`);
      }
      const data = (await res.json()) as ExtractResponse;

      const mergedThumbs = data.thumbnails.map((t, idx) => {
        const meta = topThumbs[idx];
        return {
          ...t,
          score: meta?.score,
          reasoning: meta?.reasoning,
        };
      });

      setResult({
        analysisId: data.analysisId,
        inputUrl: data.inputUrl,
        thumbnails: mergedThumbs,
        clips: data.clips,
      });
      setStatus("ready");
    } catch (err) {
      if (abort.signal.aborted) {
        setStatus("idle");
        setPhase(null);
        setElapsed(0);
        return;
      }
      setStatus("error");
      setPhase(null);
      setError(String(err));
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setPhase(null);
    setElapsed(0);
  };

  return (
    <div className="space-y-4">
      {!apiKey && (
        <Alert variant="warning">
          <AlertTitle>Overshoot API key missing</AlertTitle>
          <AlertDescription>
            Set <code className="font-mono">NEXT_PUBLIC_OVERSHOOT_API_KEY</code> to enable analysis in the browser.
          </AlertDescription>
        </Alert>
      )}

      {!file ? (
        <div className="text-muted-foreground text-sm">Select a clip to analyze.</div>
      ) : (
        <div className="space-y-2 text-muted-foreground text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="truncate">
              <span className="font-medium text-foreground">Selected:</span> {file.name}
            </div>
            <div className="tabular-nums">{durationSeconds.toFixed(1)}s</div>
          </div>
          <div className="flex items-center gap-2">
            <Button disabled={!canRun || status === "running" || status === "extracting"} onClick={run} size="sm">
              Analyze (thumbnails + peak clips)
            </Button>
            <Button
              disabled={status !== "running" && status !== "extracting"}
              onClick={cancel}
              size="sm"
              variant="secondary"
            >
              Cancel
            </Button>
          </div>

          {(status === "running" || status === "extracting") && (
            <div className="text-xs">
              {status === "extracting" ? (
                <span>Extracting with ffmpeg…</span>
              ) : (
                <span>
                  Running {phase}… {Math.min(elapsed, durationSeconds).toFixed(1)}s /{" "}
                  {durationSeconds.toFixed(1)}s
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <Alert variant="error">
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">Thumbnails</div>
              <div className="text-muted-foreground text-xs">Pick one to use as the video poster.</div>
            </div>

            {result.thumbnails.length === 0 ? (
              <div className="text-muted-foreground text-sm">No thumbnails extracted.</div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {result.thumbnails.map((t) => {
                  const selected = selectedThumb === t.generatedUrl;
                  return (
                    <button
                      key={t.generatedUrl}
                      className={`overflow-hidden rounded-lg border text-left transition ${
                        selected ? "border-primary ring-2 ring-primary/40" : "hover:border-muted-foreground/40"
                      }`}
                      onClick={() => {
                        setSelectedThumb(t.generatedUrl);
                        onSelectThumbnail?.(t.generatedUrl);
                      }}
                      type="button"
                    >
                      <img alt="Generated thumbnail" className="aspect-video w-full object-cover" src={t.generatedUrl} />
                      <div className="space-y-1 p-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                          <span>{t.score != null ? `${Math.round(t.score)}/100` : "—"}</span>
                          <span>{t.timestampSeconds.toFixed(1)}s</span>
                        </div>
                        {t.reasoning && (
                          <div className="line-clamp-2 text-[11px] text-muted-foreground">{t.reasoning}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm">Peak Clips</div>
              <div className="text-muted-foreground text-xs">15–60s suggestions for short-form.</div>
            </div>

            {result.clips.length === 0 ? (
              <div className="text-muted-foreground text-sm">No peak clips detected (try again or lower threshold).</div>
            ) : (
              <ScrollArea className="h-[380px] rounded-xl border bg-muted/40">
                <div className="space-y-4 p-4">
                  {result.clips.map((c) => (
                    <div key={c.url} className="grid gap-3 rounded-xl border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                        <span>
                          {c.start.toFixed(1)}s → {c.end.toFixed(1)}s ({(c.end - c.start).toFixed(1)}s)
                        </span>
                        <span>
                          {c.peakScore != null ? `${Math.round(c.peakScore)}/100` : "—"}
                          {c.clipType ? ` · ${c.clipType}` : ""}
                        </span>
                      </div>
                      {c.hookText && <div className="text-sm">{c.hookText}</div>}
                      <video className="w-full rounded-lg" controls preload="metadata" src={c.url} />
                      <div className="flex justify-end">
                        <Button render={<a download href={c.url} />} size="xs" variant="outline">
                          Download clip
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          <div className="text-muted-foreground text-xs">
            Assets are stored under <code className="font-mono">sessions/analysis/{result.analysisId}</code>.
          </div>
        </div>
      )}
    </div>
  );
}
