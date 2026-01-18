"use client";

import * as React from "react";
import { RealtimeVision, StreamInferenceResult } from "@overshoot/sdk";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type ThumbnailProvider = "fal" | "gemini";

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

type VisionParseContext = {
  windowIndex: number;
  windowEndSeconds: number;
  playbackSeconds: number;
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

type ThumbnailResult = {
  analysisId: string;
  inputUrl: string;
  thumbnails: Array<ExtractedThumbnail & { score?: number; reasoning?: string }>;
};

type ClipResult = {
  analysisId: string;
  inputUrl: string;
  clips: ExtractedClip[];
};

type BridgeResponse = {
  jobId: string;
  durationSeconds: number;
  usedVeo: boolean;
  error: string | null;
  bridgeUrl: string;
  firstFrameUrl: string;
  lastFrameUrl: string;
};

const apiUrl =
  process.env.NEXT_PUBLIC_VISION_API_URL ||
  process.env.NEXT_PUBLIC_OVERSHOOT_API_URL ||
  "https://cluster1.overshoot.ai/api/v0.2";
const apiKey =
  process.env.NEXT_PUBLIC_VISION_API_KEY || process.env.NEXT_PUBLIC_OVERSHOOT_API_KEY || "";
const model = process.env.NEXT_PUBLIC_VISION_MODEL || process.env.NEXT_PUBLIC_OVERSHOOT_MODEL || undefined;

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

function clipRangesNear(a: { start: number; end: number }, b: { start: number; end: number }) {
  const aCenter = (a.start + a.end) / 2;
  const bCenter = (b.start + b.end) / 2;
  const centerDelta = Math.abs(aCenter - bCenter);
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return overlap >= 1 || centerDelta <= 30;
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

    const derived = normalizeClipRange(seg.start, seg.end, durationSeconds);

    const normalizedSuggested =
      top.suggestedStart != null && top.suggestedEnd != null
        ? normalizeClipRange(top.suggestedStart, top.suggestedEnd, durationSeconds)
        : null;

    const suggested =
      normalizedSuggested && derived && clipRangesNear(normalizedSuggested, derived) ? normalizedSuggested : null;

    const picked = suggested ?? derived ?? normalizedSuggested;
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

  const unique: ClipExtractRequest[] = [];
  const eps = 0.25;
  for (const clip of clips) {
    const dup = unique.some((u) => Math.abs(u.start - clip.start) <= eps && Math.abs(u.end - clip.end) <= eps);
    if (!dup) unique.push(clip);
  }

  return unique.slice(0, 5);
}

async function runVision<T>(opts: {
  file: File;
  durationSeconds: number;
  processing: { clip_length_seconds: number; delay_seconds: number; fps: number; sampling_ratio: number };
  prompt: string;
  outputSchema: Record<string, unknown>;
  parse: (payload: unknown, ctx: VisionParseContext) => T | null;
  onProgress?: (elapsedSeconds: number) => void;
  signal?: AbortSignal;
}) {
  if (!apiKey) {
    throw new Error("Vision API key is not set.");
  }

  const results: T[] = [];
  let vision: RealtimeVision | null = null;
  const timing = await prepareTimingVideo(opts.file, opts.signal);

  try {
    let windowIndex = 0;
    vision = new RealtimeVision({
      apiUrl,
      apiKey,
      model,
      source: { type: "video", file: opts.file },
      processing: opts.processing,
      prompt: opts.prompt,
      outputSchema: opts.outputSchema,
      onResult: (result) => {
        const playbackSeconds = timing.video.currentTime;
        opts.onProgress?.(playbackSeconds);

        const computedEnd = windowIndex * opts.processing.delay_seconds + opts.processing.clip_length_seconds;
        const windowEndSeconds =
          opts.durationSeconds > 0 ? clamp(computedEnd, 0, opts.durationSeconds) : Math.max(0, computedEnd);

        const json = getResultJson(result);
        const parsed = opts.parse(json, { windowIndex, windowEndSeconds, playbackSeconds });
        if (parsed) results.push(parsed);

        windowIndex += 1;
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

async function extractAssets(opts: {
  file: File;
  frameTimes?: number[];
  clips?: ClipExtractRequest[];
  provider?: ThumbnailProvider;
  signal?: AbortSignal;
}) {
  const fd = new FormData();
  fd.append("file", opts.file);
  fd.append("frames", JSON.stringify(opts.frameTimes ?? []));
  fd.append("clips", JSON.stringify(opts.clips ?? []));
  if (opts.provider) {
    fd.append("provider", opts.provider);
  }

  const res = await fetch("/api/analysis/extract", { method: "POST", body: fd, signal: opts.signal });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error || `Extraction failed (${res.status})`);
  }
  return (await res.json()) as ExtractResponse;
}

function ThumbnailAgent({
  file,
  durationSeconds,
  onSelectThumbnail,
}: {
  file: File | null;
  durationSeconds: number;
  onSelectThumbnail?: (url: string) => void;
}) {
  type ThumbnailItem = ThumbnailResult["thumbnails"][number];
  const [status, setStatus] = React.useState<"idle" | "running" | "extracting" | "ready" | "error">("idle");
  const [elapsed, setElapsed] = React.useState<number>(0);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ThumbnailResult | null>(null);
  const [selectedThumb, setSelectedThumb] = React.useState<string | null>(null);
  const [previewThumb, setPreviewThumb] = React.useState<ThumbnailItem | null>(null);
  const [provider, setProvider] = React.useState<ThumbnailProvider>("gemini");
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setStatus("idle");
    setElapsed(0);
    setError(null);
    setResult(null);
    setSelectedThumb(null);
    setPreviewThumb(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [file]);

  const canRun = Boolean(file) && durationSeconds > 0 && Boolean(apiKey);

  const run = async () => {
    if (!file) return;
    setError(null);
    setResult(null);
    setSelectedThumb(null);
    setPreviewThumb(null);
    setElapsed(0);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      setStatus("running");

      const candidates = await runVision<ThumbnailCandidate>({
        file,
        durationSeconds,
        processing: { clip_length_seconds: 2, delay_seconds: 0.5, fps: 30, sampling_ratio: 0.2 },
        prompt: thumbnailPrompt,
        outputSchema: thumbnailSchema,
        signal: abort.signal,
        onProgress: (e) => setElapsed(e),
        parse: (payload, ctx) => {
          const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
          if (!obj) return null;
          const score = Number(obj.thumbnail_score);
          const ts = Number(obj.timestamp_seconds);
          const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
          if (!Number.isFinite(score)) return null;
          const timeSeconds = Number.isFinite(ts) ? ts : ctx.windowEndSeconds;
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

      const top = pickTopThumbnails(candidates, durationSeconds, 3);
      const frameTimes = top.map((t) => t.timeSeconds);

      setStatus("extracting");
      setElapsed(0);

      const data = await extractAssets({ file, frameTimes, clips: [], provider, signal: abort.signal });

      const mergedThumbs = data.thumbnails.map((t, idx) => {
        const meta = top[idx];
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
      });
      setStatus("ready");
    } catch (err) {
      if (abort.signal.aborted) {
        setStatus("idle");
        setElapsed(0);
        return;
      }
      setStatus("error");
      setError(String(err));
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setElapsed(0);
  };

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Thumbnail Agent</div>
          <div className="text-muted-foreground text-xs">Find strong frames for a poster thumbnail.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={!canRun || status === "running" || status === "extracting"} onClick={run} size="sm">
            Run
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
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={provider}
          onValueChange={(val) => setProvider(val as ThumbnailProvider)}
          disabled={status === "running" || status === "extracting"}
        >
          <SelectTrigger size="sm" className="w-[160px]">
            <SelectValue placeholder="Select provider">
              {provider === "gemini" ? "Gemini Flash" : "Nano Banana Pro"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="gemini">Gemini Flash</SelectItem>
            <SelectItem value="fal">Nano Banana Pro</SelectItem>
          </SelectPopup>
        </Select>
      </div>

      {(status === "running" || status === "extracting") && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {status === "extracting" ? (
            <span>Extracting frames…</span>
          ) : (
            <span>
              Watching… {Math.min(elapsed, durationSeconds).toFixed(1)}s / {durationSeconds.toFixed(1)}s
            </span>
          )}
        </div>
      )}

      {error && (
        <Alert variant="error">
          <AlertTitle>Thumbnail agent failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-2">
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
                      setPreviewThumb(t);
                    }}
                    type="button"
                  >
                    <img alt="Generated thumbnail" className="aspect-video w-full object-cover" src={t.generatedUrl} />
                    <div className="space-y-1 p-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{t.score != null ? `${Math.round(t.score)}/100` : "—"}</span>
                        <span>{t.timestampSeconds.toFixed(1)}s</span>
                      </div>
                      {t.reasoning && <div className="line-clamp-2 text-[11px] text-muted-foreground">{t.reasoning}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <div className="text-muted-foreground text-xs">
            Assets are stored under <code className="font-mono">sessions/analysis/{result.analysisId}</code>.
          </div>
        </div>
      )}

      <Dialog
        open={previewThumb !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewThumb(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Thumbnail preview</DialogTitle>
            <DialogDescription>
              {previewThumb?.timestampSeconds != null ? `${previewThumb.timestampSeconds.toFixed(1)}s` : "—"}
              {previewThumb?.score != null ? ` · ${Math.round(previewThumb.score)}/100` : ""}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel scrollFade={false}>
            {previewThumb && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Original Frame</div>
                    <div className="overflow-hidden rounded-lg bg-black">
                      <img
                        alt="Original frame"
                        className="aspect-video w-full object-contain"
                        src={previewThumb.candidateUrl}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Thumbnailified</div>
                    <div className="overflow-hidden rounded-lg bg-black">
                      <img
                        alt="Generated thumbnail"
                        className="aspect-video w-full object-contain"
                        src={previewThumb.generatedUrl}
                      />
                    </div>
                  </div>
                </div>

                {previewThumb.reasoning && (
                  <div className="text-sm text-muted-foreground">{previewThumb.reasoning}</div>
                )}

                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <a
                    className="underline underline-offset-4"
                    href={previewThumb.candidateUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open original
                  </a>
                  <a
                    className="underline underline-offset-4"
                    href={previewThumb.generatedUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open thumbnail
                  </a>
                </div>
              </div>
            )}
          </DialogPanel>

          <DialogFooter variant="bare">
            <Button onClick={() => setPreviewThumb(null)} type="button" variant="secondary">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClipScoutAgent({
  file,
  durationSeconds,
}: {
  file: File | null;
  durationSeconds: number;
}) {
  const [status, setStatus] = React.useState<"idle" | "running" | "extracting" | "ready" | "error">("idle");
  const [elapsed, setElapsed] = React.useState<number>(0);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ClipResult | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setStatus("idle");
    setElapsed(0);
    setError(null);
    setResult(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [file]);

  const canRun = Boolean(file) && durationSeconds > 0 && Boolean(apiKey);

  const run = async () => {
    if (!file) return;
    setError(null);
    setResult(null);
    setElapsed(0);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      setStatus("running");

      const peakTicks = await runVision<PeakTick>({
        file,
        durationSeconds,
        processing: { clip_length_seconds: 3, delay_seconds: 1, fps: 30, sampling_ratio: 0.1 },
        prompt: peakClipPrompt,
        outputSchema: peakClipSchema,
        signal: abort.signal,
        onProgress: (e) => setElapsed(e),
        parse: (payload, ctx) => {
          const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
          if (!obj) return null;
          const peakScore = Number(obj.peak_score);
          if (!Number.isFinite(peakScore)) return null;

          const clipType = typeof obj.clip_type === "string" ? obj.clip_type : null;
          const hookText = typeof obj.hook_text === "string" ? obj.hook_text : null;
          const suggestedStart = Number.isFinite(Number(obj.suggested_clip_start)) ? Number(obj.suggested_clip_start) : null;
          const suggestedEnd = Number.isFinite(Number(obj.suggested_clip_end)) ? Number(obj.suggested_clip_end) : null;

          return {
            peakScore,
            windowEndSeconds: ctx.windowEndSeconds,
            clipType,
            hookText,
            suggestedStart,
            suggestedEnd,
          };
        },
      });

      const clips = buildPeakClips(peakTicks, durationSeconds);

      setStatus("extracting");
      setElapsed(0);

      const data = await extractAssets({ file, frameTimes: [], clips, signal: abort.signal });

      setResult({
        analysisId: data.analysisId,
        inputUrl: data.inputUrl,
        clips: data.clips,
      });
      setStatus("ready");
    } catch (err) {
      if (abort.signal.aborted) {
        setStatus("idle");
        setElapsed(0);
        return;
      }
      setStatus("error");
      setError(String(err));
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setElapsed(0);
  };

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Clip Scout Agent</div>
          <div className="text-muted-foreground text-xs">Find a few peak moments (15–60s) for short-form.</div>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={!canRun || status === "running" || status === "extracting"} onClick={run} size="sm">
            Run
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
      </div>

      {(status === "running" || status === "extracting") && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {status === "extracting" ? (
            <span>Extracting clips…</span>
          ) : (
            <span>
              Watching… {Math.min(elapsed, durationSeconds).toFixed(1)}s / {durationSeconds.toFixed(1)}s
            </span>
          )}
        </div>
      )}

      {error && (
        <Alert variant="error">
          <AlertTitle>Clip scout failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-3">
          {result.clips.length === 0 ? (
            <div className="text-muted-foreground text-sm">No peak clips detected (try again).</div>
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
          <div className="text-muted-foreground text-xs">
            Assets are stored under <code className="font-mono">sessions/analysis/{result.analysisId}</code>.
          </div>
        </div>
      )}
    </div>
  );
}

function VeoBridgeAgent({
  file,
  durationSeconds,
}: {
  file: File | null;
  durationSeconds: number;
}) {
  const [status, setStatus] = React.useState<"idle" | "running" | "ready" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<BridgeResponse | null>(null);
  const [prompt, setPrompt] = React.useState<string>(
    "Keep the same scene and subject. Smooth camera motion. No new objects. Match lighting and style.",
  );
  const [rangeStart, setRangeStart] = React.useState<number>(0);
  const [rangeEnd, setRangeEnd] = React.useState<number>(2);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
    setRangeStart(0);
    setRangeEnd(durationSeconds > 0 ? Math.min(2, durationSeconds) : 2);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [file, durationSeconds]);

  const canRun = Boolean(file) && durationSeconds > 0;

  const run = async () => {
    if (!file) return;
    setError(null);
    setResult(null);

    const start = clamp(rangeStart, 0, durationSeconds);
    const end = clamp(rangeEnd, 0, durationSeconds);
    if (end <= start + 0.05) {
      setStatus("error");
      setError("Range is too small. Pick a longer segment.");
      return;
    }

    const segmentDuration = end - start;
    if (segmentDuration > 8) {
      setStatus("error");
      setError("Range must be <= 8.0s (model limit).");
      return;
    }

    const epsilon = 0.1;
    const firstFrameTs = clamp(start - epsilon, 0, durationSeconds);
    const lastFrameTs = clamp(end + epsilon, 0, durationSeconds);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      setStatus("running");

      const fd = new FormData();
      fd.append("file", file);
      fd.append("firstFrameTs", String(firstFrameTs));
      fd.append("lastFrameTs", String(lastFrameTs));
      fd.append("durationSeconds", String(segmentDuration));
      fd.append("prompt", prompt);

      const res = await fetch("/api/agents/bridge", { method: "POST", body: fd, signal: abort.signal });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error || `Bridge generation failed (${res.status})`);
      }
      const data = (await res.json()) as BridgeResponse;
      setResult(data);
      setStatus("ready");
    } catch (err) {
      if (abort.signal.aborted) {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setError(String(err));
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  };

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-sm">Veo Stitch Agent</div>
          <div className="text-muted-foreground text-xs">
            Generate a replacement clip that bridges from a frame before the range to a frame after it.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={!canRun || status === "running"} onClick={run} size="sm">
            Run
          </Button>
          <Button disabled={status !== "running"} onClick={cancel} size="sm" variant="secondary">
            Cancel
          </Button>
        </div>
      </div>

      {!file ? (
        <div className="text-muted-foreground text-sm">Select a clip to generate a bridge.</div>
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Range start (s)</div>
              <Input
                nativeInput
                type="number"
                min={0}
                max={Math.max(0, durationSeconds)}
                step={0.1}
                value={Number.isFinite(rangeStart) ? String(rangeStart) : "0"}
                onChange={(e) => setRangeStart(Number(e.currentTarget.value))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Range end (s)</div>
              <Input
                nativeInput
                type="number"
                min={0}
                max={Math.max(0, durationSeconds)}
                step={0.1}
                value={Number.isFinite(rangeEnd) ? String(rangeEnd) : "2"}
                onChange={(e) => setRangeEnd(Number(e.currentTarget.value))}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Prompt</div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              placeholder="Describe how the motion should connect the frames…"
              rows={3}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            Output duration:{" "}
            <span className="tabular-nums">{Math.max(0, rangeEnd - rangeStart).toFixed(1)}s</span> (max 8.0s).
          </div>
        </div>
      )}

      {status === "running" && <div className="text-xs text-muted-foreground">Generating… this can take a while.</div>}

      {error && (
        <Alert variant="error">
          <AlertTitle>Bridge generation failed</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-2">
          {!result.usedVeo && (
            <Alert variant="warning">
              <AlertTitle>Fallback mode</AlertTitle>
              <AlertDescription className="break-words">
                Generated a basic crossfade bridge. {result.error ? `Details: ${result.error}` : null}
              </AlertDescription>
            </Alert>
          )}

          <video className="w-full rounded-lg" controls preload="metadata" src={result.bridgeUrl} />
          <div className="flex justify-end">
            <Button render={<a download href={result.bridgeUrl} />} size="xs" variant="outline">
              Download bridge clip
            </Button>
          </div>
          <div className="text-muted-foreground text-xs">
            Assets are stored under <code className="font-mono">sessions/agents/bridge/{result.jobId}</code>.
          </div>
        </div>
      )}
    </div>
  );
}

export function VideoAgentsPanel({
  file,
  durationSeconds,
  onSelectThumbnail,
}: {
  file: File | null;
  durationSeconds: number;
  onSelectThumbnail?: (url: string) => void;
}) {
  return (
    <div className="space-y-4">
      {!apiKey && (
        <Alert variant="warning">
          <AlertTitle>Vision API key missing</AlertTitle>
          <AlertDescription>
            Set <code className="font-mono">NEXT_PUBLIC_VISION_API_KEY</code> to enable the agents in the browser.
          </AlertDescription>
        </Alert>
      )}

      {!file ? (
        <div className="text-muted-foreground text-sm">Select a clip to run agents.</div>
      ) : (
        <div className="space-y-4">
          <ThumbnailAgent file={file} durationSeconds={durationSeconds} onSelectThumbnail={onSelectThumbnail} />
          <Separator />
          <ClipScoutAgent file={file} durationSeconds={durationSeconds} />
          <Separator />
          <VeoBridgeAgent file={file} durationSeconds={durationSeconds} />
        </div>
      )}
    </div>
  );
}
