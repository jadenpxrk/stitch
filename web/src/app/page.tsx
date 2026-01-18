"use client";

import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToastProvider, toastManager } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CropIcon,
  FilmIcon,
  FolderOpenIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  ScissorsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SparklesIcon,
  SunIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

type Theme = "dark" | "light";

type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

function formatTime(seconds: number) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const ss = r.toFixed(1).padStart(4, "0");
  return `${m}:${ss}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isDefaultCrop(crop: CropRect) {
  return crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1;
}

type CropHandle = "move" | "nw" | "ne" | "sw" | "se";

function CropOverlay({
  crop,
  active,
  onChange,
}: {
  crop: CropRect;
  active: boolean;
  onChange: (crop: CropRect) => void;
}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    handle: CropHandle;
    startX: number;
    startY: number;
    startCrop: CropRect;
    bounds: DOMRect;
    pointerId: number;
  } | null>(null);

  const startDrag = (e: React.PointerEvent, handle: CropHandle) => {
    if (!active) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const bounds = overlay.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: crop,
      bounds,
      pointerId: e.pointerId,
    };
    overlay.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const overlay = overlayRef.current;
    if (overlay && overlay.hasPointerCapture(drag.pointerId)) {
      overlay.releasePointerCapture(drag.pointerId);
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const dx = (e.clientX - drag.startX) / drag.bounds.width;
    const dy = (e.clientY - drag.startY) / drag.bounds.height;

    const minW = 0.05;
    const minH = 0.05;

    const start = drag.startCrop;
    const startL = start.x;
    const startT = start.y;
    const startR = start.x + start.w;
    const startB = start.y + start.h;

    let l = startL;
    let t = startT;
    let r = startR;
    let b = startB;

    if (drag.handle === "move") {
      const w = startR - startL;
      const h = startB - startT;
      l = clamp(startL + dx, 0, 1 - w);
      t = clamp(startT + dy, 0, 1 - h);
      r = l + w;
      b = t + h;
    }

    if (drag.handle === "nw") {
      l = clamp(startL + dx, 0, startR - minW);
      t = clamp(startT + dy, 0, startB - minH);
    }

    if (drag.handle === "ne") {
      r = clamp(startR + dx, startL + minW, 1);
      t = clamp(startT + dy, 0, startB - minH);
    }

    if (drag.handle === "sw") {
      l = clamp(startL + dx, 0, startR - minW);
      b = clamp(startB + dy, startT + minH, 1);
    }

    if (drag.handle === "se") {
      r = clamp(startR + dx, startL + minW, 1);
      b = clamp(startB + dy, startT + minH, 1);
    }

    const next: CropRect = {
      x: clamp(l, 0, 1 - minW),
      y: clamp(t, 0, 1 - minH),
      w: clamp(r - l, minW, 1),
      h: clamp(b - t, minH, 1),
    };

    onChange(next);
    e.preventDefault();
    e.stopPropagation();
  };

  const left = `${crop.x * 100}%`;
  const top = `${crop.y * 100}%`;
  const width = `${crop.w * 100}%`;
  const height = `${crop.h * 100}%`;

  return (
    <div
      ref={overlayRef}
      className={`absolute inset-0 ${active ? "pointer-events-auto" : "pointer-events-none"}`}
      onPointerCancel={endDrag}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      role="presentation"
    >
      <div
        className="absolute border-2 border-primary"
        onPointerDown={(e) => startDrag(e, "move")}
        role="presentation"
        style={{
          left,
          top,
          width,
          height,
          boxShadow: active ? "0 0 0 9999px rgba(0,0,0,0.55)" : "none",
          cursor: active ? "move" : "default",
        }}
      >
        {([
          ["nw", "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize"],
          ["ne", "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize"],
          ["sw", "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize"],
          ["se", "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize"],
        ] as const).map(([handle, pos]) => (
          <div
            key={handle}
            className={`absolute size-3 rounded-sm border border-primary bg-background ${pos}`}
            onPointerDown={(e) => startDrag(e, handle)}
            role="presentation"
          />
        ))}
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  variant = "outline",
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  children: React.ReactNode;
}) {
  const button = (
    <Button
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      variant={variant}
    >
      {children}
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={button as React.ReactElement<Record<string, unknown>>}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <SunIcon className="size-4" />
      <Switch
        checked={theme === "dark"}
        onCheckedChange={(checked) => onChange(checked ? "dark" : "light")}
      />
      <MoonIcon className="size-4" />
    </div>
  );
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string>("demo-session");
  const [source, setSource] = useState<string>("webcam");
  const [recordingUrl, setRecordingUrl] = useState<string>("");
  const [state, setState] = useState<SessionState | null>(null);
  const [exportPlan, setExportPlan] = useState<EditPlan | null>(null);
  const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shakySegments = useMemo(
    () => state?.segmentsFinal.filter((s) => s.type === "SHAKY") ?? [],
    [state],
  );
  const captions = state?.captions;
  const captionsReady = captions?.status === "ready" && !!captions.vttPath;
  const canGenerateCaptions =
    !!sessionId && !!recordingUrl && state?.status === "stopped";

  const start = async () => {
    setError(null);
    setExportPlan(null);
    try {
      const res = await api<SessionState>("/api/session/start", {
        method: "POST",
        body: JSON.stringify({ sessionId, source }),
      });
      setState(res);
    } catch (e) {
      setError(String(e));
    }
  };

  const ingestFile = (incoming: File) => {
    const isMp4 =
      incoming.type === "video/mp4" || incoming.name.toLowerCase().endsWith(".mp4");
    if (!isMp4) {
      toastManager.add({
        title: "Unsupported file",
        description: "Please upload an .mp4 video.",
        type: "error",
      });
      return;
    }
    setError(null);
    try {
      const res = await api<SessionState>("/api/session/stop", {
        method: "POST",
        body: JSON.stringify({ sessionId, recordingUrl: recordingUrl || undefined }),
      });
      setState(res);
    } catch (e) {
      setError(String(e));
    }
  };

  const togglePlay = async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      const end = effectiveTrimEnd > 0 ? effectiveTrimEnd : duration;
      if (v.currentTime < trimStart || v.currentTime >= Math.max(0, end - 0.001)) {
        const next = clamp(trimStart, 0, Math.max(0, duration - 0.001));
        v.currentTime = next;
        setCurrentTime(next);
      }
      try {
        await v.play();
      } catch (e) {
        setError(`Playback failed: ${String(e)}`);
      }
    } else {
      v.pause();
    }
  };

  const goFirst = () => seek(trimStart);
  const goLast = () =>
    seek(effectiveTrimEnd > 0 ? effectiveTrimEnd - 0.001 : duration - 0.001);

  const zoomIn = () =>
    setZoom((z) => clamp(Number((z + 0.25).toFixed(2)), 0.5, 4));
  const zoomOut = () =>
    setZoom((z) => clamp(Number((z - 0.25).toFixed(2)), 0.5, 4));

  const split = () => {
    toastManager.add({
      title: "Split clip",
      description: "Coming soon — functionality not wired yet.",
      type: "info",
    });
  };

  const doExport = async () => {
    try {
      const res = await api<EditPlan>(`/api/session/${sessionId}/export`);
      setExportPlan(res);
    } catch (e) {
      setError(String(e));
    }
  };

  const generateCaptions = async () => {
    if (!sessionId) return;
    setError(null);
    setIsGeneratingCaptions(true);
    try {
      const res = await api<SessionState>(`/api/session/${sessionId}/captions`, {
        method: "POST",
        body: JSON.stringify({ recordingUrl: recordingUrl || undefined }),
      });
      setState(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsGeneratingCaptions(false);
    }
  };

  const simulateTick = async (shaky: boolean) => {
    if (!sessionId) return;
    const ts = (state?.rawTicks.length ?? 0) + 1;
    const confidence = shaky ? 0.96 : 0.2;
    const raw = { shaky, confidence };
    try {
      const res = await api<SessionState>(`/api/session/${sessionId}/tick`, {
        method: "POST",
        body: JSON.stringify({
          tick: ts,
          ts,
          raw,
        }),
      });
      setState(res);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state?.recordingUrl && !recordingUrl) {
      setRecordingUrl(state.recordingUrl);
    }
  }, [recordingUrl, state?.recordingUrl]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Overshoot Auto-Editor
          </p>
          <h1 className="text-4xl font-semibold text-slate-50">
            CUT / STABILIZE / BRIDGE
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Stream via Overshoot, label shaky seconds at 1 Hz, smooth with
            2-of-3 rule, and export an edit plan. UI keeps controls minimal for
            hackathon speed.
          </p>
        </header>

        <section className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-[0.15em] text-slate-400">
                Session ID
              </span>
              <input
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs uppercase tracking-[0.15em] text-slate-400">
                Source
              </span>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                onClick={start}
                className="flex-1 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
              >
                Start
              </button>
              <button
                onClick={stop}
                className="flex-1 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white transition hover:border-white"
              >
                Stop
              </button>
              <button
                onClick={refresh}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:border-white"
              >
                Refresh
              </button>
            </div>
            <label className="flex flex-col gap-1 text-sm md:col-span-3">
              <span className="text-xs uppercase tracking-[0.15em] text-slate-400">
                Recording URL (required for captions)
              </span>
              <input
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
                placeholder="https://.../recording.mp4 or /path/to/file"
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400"
              />
            </label>
          </div>

                  <div className="relative overflow-hidden rounded-xl bg-black">
                    <video
                      ref={videoRef}
                      className="aspect-video w-full"
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        const d = Number.isFinite(v.duration) ? v.duration : 0;
                        setDuration(d);
                        setTrimStart(0);
                        setTrimEnd(d);
                        setCropRect(DEFAULT_CROP);
                      }}
                      onPause={() => setIsPlaying(false)}
	                      onPlay={() => setIsPlaying(true)}
	                      onTimeUpdate={(e) => {
	                        const t = e.currentTarget.currentTime;
	                        if (!e.currentTarget.paused && t < trimStart) {
	                          e.currentTarget.currentTime = trimStart;
	                          setCurrentTime(trimStart);
	                          return;
	                        }
	                        if (effectiveTrimEnd > 0 && t > effectiveTrimEnd) {
	                          e.currentTarget.pause();
	                          e.currentTarget.currentTime = effectiveTrimEnd;
	                          setCurrentTime(effectiveTrimEnd);
	                          return;
                        }
                        setCurrentTime(t);
                      }}
                      src={videoUrl ?? undefined}
                    />
                    {isCropping && (
                      <CropOverlay crop={cropRect} active={isCropping} onChange={setCropRect} />
                    )}
                  </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <button
              onClick={() => simulateTick(false)}
              className="rounded-lg border border-green-400/50 px-3 py-1 font-semibold text-green-200 hover:border-green-300"
            >
              + Good tick
            </button>
            <button
              onClick={() => simulateTick(true)}
              className="rounded-lg border border-red-400/50 px-3 py-1 font-semibold text-red-200 hover:border-red-300"
            >
              + Shaky tick
            </button>
            <span className="text-slate-400">
              (Dev helper: simulates 1 Hz labeling)
            </span>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Segments</h2>
            <span className="text-sm text-slate-300">
              {shakySegments.length} shaky / {state?.segmentsFinal.length ?? 0} total
            </span>
          </div>
          <div className="mt-4 grid gap-3">
            {(state?.segmentsFinal ?? []).map((seg) => (
              <SegmentRow
                key={seg.id}
                seg={seg}
                onChangeFix={(fix) => updateFix(seg.id, fix)}
              />
            ))}
            {(state?.segmentsFinal ?? []).length === 0 && (
              <p className="text-sm text-slate-400">No segments yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={generateCaptions}
              className="rounded-lg bg-indigo-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-indigo-300 disabled:opacity-60"
              disabled={!canGenerateCaptions || isGeneratingCaptions}
            >
              {isGeneratingCaptions ? "Generating..." : "Generate captions (VTT)"}
            </button>
            <span className="text-sm text-slate-300">
              Status: {captions?.status ?? "idle"}
            </span>
            {captionsReady && (
              <a
                href={`/api/session/${sessionId}/captions/file`}
                className="text-sm font-semibold text-indigo-200 hover:text-indigo-100"
              >
                Download VTT
              </a>
            )}
          </div>
          {captions?.status === "error" && (
            <div className="mt-3 text-xs text-red-200">
              {captions.error ?? "Caption generation failed."}
            </div>
          )}
          {!recordingUrl && (
            <div className="mt-3 text-xs text-slate-400">
              Provide a recording URL or local path to enable captioning.
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2">
            <button
              onClick={doExport}
              className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Export edit_plan.json
            </button>
            <button className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white opacity-60" disabled>
              Render (stub)
            </button>
            {exportPlan && (
              <span className="text-sm text-emerald-200">
                Export ready (version {exportPlan.version})
              </span>
            )}
          </div>
          {exportPlan && (
            <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-emerald-100">
              {JSON.stringify(exportPlan, null, 2)}
            </pre>
          )}
        </section>

                <section className="space-y-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="font-semibold text-sm">Timeline</div>
                      <div className="text-muted-foreground text-xs">
                        Trim start/end, scrub, and zoom.
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-muted-foreground text-sm tabular-nums">
                      <span>In: {formatTime(trimStart)}</span>
                      <Separator className="h-4" orientation="vertical" />
                      <span>Out: {formatTime(effectiveTrimEnd)}</span>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-muted-foreground text-xs">
                        <span>Trim</span>
                        <span className="tabular-nums">
                          {(effectiveTrimEnd - trimStart).toFixed(1)}s selected
                        </span>
                      </div>
                      <Slider
                        disabled={!canEdit}
                        max={maxTime}
                        min={0}
                        step={0.01}
                        value={[trimStart, effectiveTrimEnd]}
                        onValueChange={(value) => {
                          if (!Array.isArray(value)) return;
                          const [a, b] = value;
                          const nextStart = clamp(a, 0, duration);
                          const nextEnd = clamp(b, 0, duration);
                          const orderedStart = Math.min(nextStart, nextEnd);
                          const orderedEnd = Math.max(nextStart, nextEnd);
                          setTrimStart(orderedStart);
                          setTrimEnd(orderedEnd);
                          if (currentTime < orderedStart) seek(orderedStart);
                          if (currentTime > orderedEnd) seek(Math.max(0, orderedEnd - 0.001));
                        }}
                      />
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between text-muted-foreground text-xs">
                        <span>Playhead</span>
                        <span className="tabular-nums">{formatTime(currentTime)}</span>
                      </div>
                      <Slider
                        disabled={!canEdit}
                        max={maxTime}
                        min={0}
                        step={0.01}
                        value={[currentTime]}
                        onValueChange={(value) => {
                          const next = Array.isArray(value) ? value[0] : value;
                          seek(next);
                        }}
                      />
                    </div>

                    <div className="overflow-hidden rounded-xl border bg-muted/40">
                      <ScrollArea scrollbarGutter>
                        <div
                          className="relative h-18 select-none"
                          onPointerDown={(e) => {
                            if (!duration) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const ratio = clamp(x / rect.width, 0, 1);
                            seek(ratio * duration);
                          }}
                          role="presentation"
                          style={{
                            width: timelineWidthPx,
                            backgroundImage:
                              "linear-gradient(to right, color-mix(in srgb, var(--foreground) 6%, transparent) 1px, transparent 1px)",
                            backgroundSize: `${Math.max(24, Math.round(60 * zoom))}px 100%`,
                          }}
                        >
                          <div
                            className="pointer-events-none absolute inset-y-0 bg-primary/12"
                            style={{
                              left: `${trimLeftPx}px`,
                              width: `${Math.max(0, trimRightPx - trimLeftPx)}px`,
                            }}
                          />
                          <div
                            className="pointer-events-none absolute inset-y-0 w-px bg-primary"
                            style={{ left: `${playheadPx}px` }}
                          />
                          <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between text-muted-foreground text-xs tabular-nums">
                            <span>0:00.0</span>
                            <span>{formatTime(duration)}</span>
                          </div>
                        </div>
                      </ScrollArea>
                    </div>
                  </div>
                </section>
              </div>

              <aside className="min-h-0 lg:pl-6 max-lg:pt-6">
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="font-semibold text-sm">AI Assistant</div>
                    <div className="text-muted-foreground text-xs">
                      Placeholder panel — will drive edits from natural language.
                    </div>
                  </div>

                  <Tabs defaultValue="copilot">
                    <TabsList>
                      <TabsTrigger value="copilot">
                        <SparklesIcon className="size-4" />
                        Copilot
                      </TabsTrigger>
                      <TabsTrigger value="notes">
                        <FilmIcon className="size-4" />
                        Notes
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent className="mt-4" value="copilot">
                      <div className="flex flex-col gap-3">
                        <Textarea placeholder='Try: "Remove pauses", "Add jump cuts", "Zoom on speaker", "Add captions"...' />
                        <Button disabled variant="secondary">
                          Generate edit plan (coming soon)
                        </Button>
                        <div className="text-muted-foreground text-xs">
                          Tip: we’ll surface suggestions here and apply them to the timeline.
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent className="mt-4" value="notes">
                      <div className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
                        This area can show transcripts, detected chapters, suggested cuts,
                        and export options.
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </ToastProvider>
  );
}
