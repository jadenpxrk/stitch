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
import { VideoAgentsPanel } from "@/components/agents/video-agents";
import {
  CropIcon,
  FilmIcon,
  FolderOpenIcon,
  GripVerticalIcon,
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

type Clip = {
  id: string;
  file: File;
  in: number;
  out: number;
  crop: CropRect;
};

const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const SPLIT_MIN_GAP_S = 0.05;

type ClipDropTarget = {
  targetId: string;
  position: "before" | "after";
};

type ClipTrimHandle = "start" | "end";

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

function isMp4(file: File) {
  return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

function makeClipId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `clip_${crypto.randomUUID()}`;
  }
  return `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function moveClip(
  prev: Clip[],
  draggedId: string,
  targetId: string,
  position: ClipDropTarget["position"],
) {
  if (draggedId === targetId) return prev;
  const fromIndex = prev.findIndex((c) => c.id === draggedId);
  const targetIndex = prev.findIndex((c) => c.id === targetId);
  if (fromIndex < 0 || targetIndex < 0) return prev;

  const insertBase = position === "before" ? targetIndex : targetIndex + 1;
  const insertAt = fromIndex < insertBase ? insertBase - 1 : insertBase;
  if (insertAt === fromIndex) return prev;

  const next = [...prev];
  const [dragged] = next.splice(fromIndex, 1);
  next.splice(insertAt, 0, dragged);
  return next;
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
  pressed,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  pressed?: boolean;
  children: React.ReactNode;
}) {
  const button = (
    <Button
      aria-pressed={pressed}
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
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const timelineTrackRef = React.useRef<HTMLDivElement | null>(null);
  const pendingAutoplayNextClipRef = React.useRef(false);

  const [theme, setTheme] = React.useState<Theme>("dark");
  const [error, setError] = React.useState<string | null>(null);
  const [clips, setClips] = React.useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = React.useState<string | null>(null);
  const clipsRef = React.useRef<Clip[]>([]);
  const lastSelectedFileRef = React.useRef<File | null>(null);
  const clipPointerDragRef = React.useRef<{
    clipId: string;
    pointerId: number;
    startX: number;
    startY: number;
    hasDragged: boolean;
  } | null>(null);
  const suppressClipClickRef = React.useRef(false);

  const selectedClipIndex = React.useMemo(() => {
    if (!selectedClipId) return -1;
    return clips.findIndex((c) => c.id === selectedClipId);
  }, [clips, selectedClipId]);

  const selectedClip = selectedClipIndex >= 0 ? clips[selectedClipIndex] : null;
  const selectedFile = selectedClip?.file ?? null;

  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [posterUrl, setPosterUrl] = React.useState<string | null>(null);
  const [duration, setDuration] = React.useState<number>(0);
  const [currentTime, setCurrentTime] = React.useState<number>(0);
  const [isPlaying, setIsPlaying] = React.useState<boolean>(false);
  const [zoom, setZoom] = React.useState<number>(1);
  const [isCropping, setIsCropping] = React.useState<boolean>(false);
  const [isBladeMode, setIsBladeMode] = React.useState<boolean>(false);
  const [timelineHoverTime, setTimelineHoverTime] = React.useState<number | null>(null);
  const [draggingClipId, setDraggingClipId] = React.useState<string | null>(null);
  const [clipDropTarget, setClipDropTarget] = React.useState<ClipDropTarget | null>(null);
  const [trimmingClipId, setTrimmingClipId] = React.useState<string | null>(null);
  const [isExporting, setIsExporting] = React.useState<boolean>(false);
  const [fillGapsWithBlack, setFillGapsWithBlack] = React.useState<boolean>(false);

  const clipTrimRef = React.useRef<{
    clipId: string;
    handle: ClipTrimHandle;
    pointerId: number;
  } | null>(null);

  const trimStart = selectedClip?.in ?? 0;
  const trimEnd = selectedClip?.out ?? 0;
  const cropRect = selectedClip?.crop ?? DEFAULT_CROP;

  React.useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  React.useEffect(() => {
    if (!selectedFile) {
      pendingAutoplayNextClipRef.current = false;
      setVideoUrl(null);
      setPosterUrl(null);
      setDuration(0);
      setCurrentTime(0);
      setIsPlaying(false);
      setIsCropping(false);
      setIsExporting(false);
      setZoom(1);
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setVideoUrl(url);
    setPosterUrl(null);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    setIsCropping(false);
    setIsExporting(false);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  React.useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  const advanceToNextClip = React.useCallback(() => {
    if (pendingAutoplayNextClipRef.current) return true;
    const currentId = selectedClipId;
    if (!currentId) return false;
    const ordered = clipsRef.current;
    const idx = ordered.findIndex((c) => c.id === currentId);
    if (idx < 0 || idx >= ordered.length - 1) return false;

    pendingAutoplayNextClipRef.current = true;
    setSelectedClipId(ordered[idx + 1].id);
    return true;
  }, [selectedClipId]);

  React.useEffect(() => {
    if (!selectedClipId) return;
    const clip = clipsRef.current.find((c) => c.id === selectedClipId);
    if (!clip) return;
    const fileSwitched =
      lastSelectedFileRef.current !== null && lastSelectedFileRef.current !== clip.file;
    const v = videoRef.current;
    if (v) v.pause();
    setIsPlaying(false);
    setIsCropping(false);

    const end = clip.out > 0 ? clip.out : duration;
    const safeEnd = Math.max(0, end - 0.001);
    const prevTime = v?.currentTime ?? clip.in;
    const nextTime =
      !fileSwitched && prevTime >= clip.in && prevTime <= safeEnd
        ? prevTime
        : clamp(clip.in, 0, Math.max(0, duration - 0.001));

    setCurrentTime(nextTime);
    if (v) v.currentTime = nextTime;
    lastSelectedFileRef.current = clip.file;

    if (pendingAutoplayNextClipRef.current && !fileSwitched && v) {
      pendingAutoplayNextClipRef.current = false;
      void v.play().catch((e) => setError(`Playback failed: ${String(e)}`));
    }
  }, [duration, selectedClipId]);

  const canEdit = Boolean(selectedClip) && Boolean(videoUrl) && duration > 0;
  const maxTime = Math.max(0.01, duration || 1);
  const effectiveTrimEnd = trimEnd > 0 ? trimEnd : duration;
  const hasCrop = canEdit && !isDefaultCrop(cropRect);
  const hasMultipleSourceFiles = React.useMemo(() => {
    if (clips.length <= 1) return false;
    const base = clips[0]?.file;
    if (!base) return false;
    return clips.some((c) => c.file !== base);
  }, [clips]);
  const canExport = clips.length > 0 && !isExporting && !hasMultipleSourceFiles;

  const canZoomOut = canEdit && zoom > 0.5;
  const canZoomIn = canEdit && zoom < 4;

  React.useEffect(() => {
    if (!isBladeMode) setTimelineHoverTime(null);
  }, [isBladeMode]);

  const timelineWidthPx = React.useMemo(() => {
    const base = 120; // px/s
    const width = (duration || 1) * base * zoom;
    return Math.max(720, Math.round(width));
  }, [duration, zoom]);

  const playheadPx =
    duration > 0 ? (currentTime / duration) * timelineWidthPx : 0;

  const timelineHoverPx =
    duration > 0 && timelineHoverTime != null
      ? (timelineHoverTime / duration) * timelineWidthPx
      : null;

  const pickFile = () => fileInputRef.current?.click();

  const addClipAfter = (incoming: File, afterId: string | null) => {
    if (!isMp4(incoming)) {
      toastManager.add({
        title: "Unsupported file",
        description: "Please upload an .mp4 video.",
        type: "error",
      });
      return;
    }

    setError(null);
    setIsExporting(false);
    setIsCropping(false);

    const newClip: Clip = {
      id: makeClipId(),
      file: incoming,
      in: 0,
      out: 0,
      crop: DEFAULT_CROP,
    };

    setClips((prev) => {
      if (prev.length === 0) return [newClip];
      const idx = afterId ? prev.findIndex((c) => c.id === afterId) : prev.length - 1;
      const insertAt = idx >= 0 ? idx + 1 : prev.length;
      return [...prev.slice(0, insertAt), newClip, ...prev.slice(insertAt)];
    });

    setSelectedClipId(newClip.id);
  };

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const afterId = clips.length === 0 ? null : selectedClipId;
    addClipAfter(files[0], afterId);
  };

  const onDragOverStart: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const onClickClipTile =
    (clipId: string): React.MouseEventHandler<HTMLButtonElement> =>
    (e) => {
      if (suppressClipClickRef.current) {
        suppressClipClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      setSelectedClipId(clipId);
    };

  const onPointerDownClipTile =
    (clipId: string): React.PointerEventHandler<HTMLButtonElement> =>
    (e) => {
      if (e.pointerType !== "mouse") return;
      if (e.button !== 0) return;
      clipPointerDragRef.current = {
        clipId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        hasDragged: false,
      };
      setClipDropTarget(null);
      e.currentTarget.setPointerCapture(e.pointerId);
    };

  const onPointerMoveClipTile: React.PointerEventHandler<HTMLButtonElement> = (e) => {
    const drag = clipPointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const thresholdPx = 4;
    if (!drag.hasDragged && Math.hypot(dx, dy) < thresholdPx) return;

    if (!drag.hasDragged) {
      drag.hasDragged = true;
      suppressClipClickRef.current = true;
      setDraggingClipId(drag.clipId);
    }

    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const tile = el?.closest("[data-clip-tile]") as HTMLElement | null;
    if (!tile) {
      setClipDropTarget(null);
      return;
    }
    const targetId = tile.getAttribute("data-clip-id");

    if (!targetId || targetId === drag.clipId) {
      setClipDropTarget(null);
      return;
    }

    const rect = tile.getBoundingClientRect();
    const position = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setClipDropTarget({ targetId, position });
    setClips((prev) => moveClip(prev, drag.clipId, targetId, position));
    e.preventDefault();
  };

  const onPointerEndClipTile: React.PointerEventHandler<HTMLButtonElement> = (e) => {
    const drag = clipPointerDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    clipPointerDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDraggingClipId(null);
    setClipDropTarget(null);
    if (drag.hasDragged) {
      window.setTimeout(() => {
        suppressClipClickRef.current = false;
      }, 0);
    }
  };

  const onDragOverClipTile: React.DragEventHandler<HTMLButtonElement> = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.files?.length ? "copy" : "none";
  };

  const onDropStart: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) addClipAfter(dropped, null);
  };

  const onDropOnClipTile =
    (targetId: string): React.DragEventHandler<HTMLButtonElement> =>
    (e) => {
      e.preventDefault();
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) addClipAfter(dropped, targetId);
      setClipDropTarget(null);
    };

  const getTimelineTimeFromClientX = (clientX: number) => {
    const el = timelineTrackRef.current;
    if (!el) return null;
    if (duration <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = clientX - rect.left;
    const ratio = clamp(x / rect.width, 0, 1);
    return ratio * duration;
  };

  const onPointerDownClipTrimHandle =
    (clipId: string, handle: ClipTrimHandle): React.PointerEventHandler<HTMLDivElement> =>
    (e) => {
      if (!canEdit || isBladeMode) return;
      e.preventDefault();
      e.stopPropagation();
      clipTrimRef.current = { clipId, handle, pointerId: e.pointerId };
      setTrimmingClipId(clipId);
      setSelectedClipId(clipId);
      videoRef.current?.pause();
      setIsPlaying(false);
      e.currentTarget.setPointerCapture(e.pointerId);
    };

  const onPointerMoveClipTrimHandle: React.PointerEventHandler<HTMLDivElement> = (e) => {
    const drag = clipTrimRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (!canEdit) return;
    const tRaw = getTimelineTimeFromClientX(e.clientX);
    if (tRaw == null) return;
    const t = Number(tRaw.toFixed(2));

    e.preventDefault();
    e.stopPropagation();

    setClips((prev) => {
      const clip = prev.find((c) => c.id === drag.clipId);
      if (!clip) return prev;

      const minLen = SPLIT_MIN_GAP_S;

      const file = clip.file;
      const siblings = prev
        .filter((c) => c.file === file)
        .slice()
        .sort((a, b) => a.in - b.in);
      const idx = siblings.findIndex((c) => c.id === drag.clipId);
      if (idx < 0) return prev;

      const prevSibling = idx > 0 ? siblings[idx - 1] : null;
      const nextSibling = idx < siblings.length - 1 ? siblings[idx + 1] : null;

      const clipIn = clamp(clip.in, 0, duration);
      const clipOut = clamp(clip.out > 0 ? clip.out : duration, 0, duration);
      const start = Math.min(clipIn, clipOut);
      const end = Math.max(clipIn, clipOut);

      const prevEnd = prevSibling
        ? clamp(prevSibling.out > 0 ? prevSibling.out : duration, 0, duration)
        : 0;
      const nextStart = nextSibling ? clamp(nextSibling.in, 0, duration) : duration;

      if (drag.handle === "start") {
        const minStart = prevSibling ? prevEnd : 0;
        const maxStart = end - minLen;
        if (maxStart <= minStart) return prev;
        const nextIn = clamp(t, minStart, maxStart);
        return prev.map((c) => (c.id === clip.id ? { ...c, in: nextIn } : c));
      }

      const minEnd = start + minLen;
      const maxEnd = nextSibling ? nextStart : duration;
      if (maxEnd <= minEnd) return prev;
      const nextOut = clamp(t, minEnd, maxEnd);
      return prev.map((c) => (c.id === clip.id ? { ...c, out: nextOut } : c));
    });
  };

  const onPointerEndClipTrimHandle: React.PointerEventHandler<HTMLDivElement> = (e) => {
    const drag = clipTrimRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    clipTrimRef.current = null;
    setTrimmingClipId(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const next = clamp(t, 0, Math.max(0, duration - 0.001));
    v.currentTime = next;
    setCurrentTime(next);
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

  const toggleCrop = () => {
    setIsCropping((prev) => {
      if (!prev) videoRef.current?.pause();
      return !prev;
    });
  };

  const resetCrop = () => {
    if (!selectedClipId) return;
    setClips((prev) =>
      prev.map((c) => (c.id === selectedClipId ? { ...c, crop: DEFAULT_CROP } : c)),
    );
  };

  const updateCrop = (next: CropRect) => {
    if (!selectedClipId) return;
    setClips((prev) =>
      prev.map((c) => (c.id === selectedClipId ? { ...c, crop: next } : c)),
    );
  };

  const updateTrim = (start: number, end: number) => {
    if (!selectedClipId) return;
    setClips((prev) =>
      prev.map((c) => (c.id === selectedClipId ? { ...c, in: start, out: end } : c)),
    );
  };

  const splitClipAt = (time: number) => {
    if (!selectedClip) return;
    const file = selectedClip.file;
    const t = clamp(time, 0, duration);

    const candidateIdx = clips.findIndex((c) => {
      if (c.file !== file) return false;
      const end = c.out > 0 ? c.out : duration;
      return t >= c.in && t <= end;
    });

    if (candidateIdx < 0) return;

    const candidate = clips[candidateIdx];
    const start = candidate.in;
    const end = candidate.out > 0 ? candidate.out : duration;

    if (t - start < SPLIT_MIN_GAP_S || end - t < SPLIT_MIN_GAP_S) {
      toastManager.add({
        title: "Can't split here",
        description: "Move the cut point away from the clip edges and try again.",
        type: "warning",
      });
      return;
    }

    const newId = makeClipId();

    setClips((prev) => {
      const idx = prev.findIndex((c) => c.id === candidate.id);
      if (idx < 0) return prev;
      const clip = prev[idx];
      const clipEnd = clip.out > 0 ? clip.out : duration;
      const first: Clip = { ...clip, out: t };
      const second: Clip = { ...clip, id: newId, in: t, out: clipEnd };
      const next = [...prev];
      next.splice(idx, 1, first, second);
      return next;
    });

    setSelectedClipId(newId);
    setIsCropping(false);
    videoRef.current?.pause();
    setIsPlaying(false);
    seek(t);

    toastManager.add({
      title: "Split clip",
      description: `Created 2 clips at ${formatTime(t)}.`,
      type: "success",
    });
  };

  const exportClip = async () => {
    if (clips.length === 0) return;
    if (hasMultipleSourceFiles) {
      toastManager.add({
        title: "Export not supported",
        description: "Sequence export currently supports a single source file.",
        type: "error",
      });
      return;
    }

    const baseFile = clips[0]?.file;
    if (!baseFile) return;

    setIsExporting(true);
    setError(null);
    videoRef.current?.pause();

    try {
      const formData = new FormData();
      formData.append("file", baseFile, baseFile.name);
      formData.append(
        "clips",
        JSON.stringify(
          clips.map((c) => ({
            in: c.in,
            out: c.out,
            crop: c.crop,
          })),
        ),
      );
      formData.append("fillGaps", String(fillGapsWithBlack));

      const res = await fetch("/api/stitch", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const maybeJson = await res.json().catch(() => null);
        const msg = (() => {
          if (typeof maybeJson?.error === "string") return maybeJson.error;
          if (res.status === 404) {
            return "Export endpoint not found (/api/stitch). Restart the dev server.";
          }
          return `Export failed (${res.status})`;
        })();
        throw new Error(msg);
      }

      const base = baseFile.name.replace(/\\.mp4$/i, "");
      const fileName = `${base || "video"}_sequence${fillGapsWithBlack ? "_gapfill" : ""}.mp4`;

      const showSaveFilePicker = (window as unknown as { showSaveFilePicker?: unknown })
        .showSaveFilePicker as
        | undefined
        | ((options: unknown) => Promise<{ createWritable: () => Promise<{ write: (chunk: unknown) => Promise<void>; close: () => Promise<void> }> }>);

      if (showSaveFilePicker && res.body) {
        const handle = await showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "MP4 video",
              accept: { "video/mp4": [".mp4"] },
            },
          ],
        });

        const writable = await handle.createWritable();
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
        }
        await writable.close();
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      }

      toastManager.add({
        title: "Export complete",
        description: "Downloaded sequence as a single MP4.",
        type: "success",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toastManager.add({
        title: "Export failed",
        description: message,
        type: "error",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const clearProject = () => {
    const v = videoRef.current;
    if (v) v.pause();
    pendingAutoplayNextClipRef.current = false;
    setClips([]);
    setSelectedClipId(null);
  };

  return (
    <ToastProvider>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8">
          {clips.length === 0 ? (
            <div className="fixed right-6 top-6 z-50">
              <ThemeToggle theme={theme} onChange={setTheme} />
            </div>
          ) : (
            <header className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate font-semibold text-lg leading-tight">
                  {selectedClip?.file.name ?? "Untitled"}
                </div>
                <div className="mt-1 text-muted-foreground text-xs tabular-nums">
                  {selectedClipIndex >= 0
                    ? `Clip ${selectedClipIndex + 1} / ${clips.length}`
                    : `${clips.length} clips`}
                  {duration > 0 ? ` • ${formatTime(duration)} total` : " • Loading…"}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button onClick={pickFile} size="sm" variant="outline">
                  <FolderOpenIcon className="size-4" />
                  Add clip
                </Button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <span>Fill gaps</span>
                        <Switch
                          checked={fillGapsWithBlack}
                          disabled={hasMultipleSourceFiles}
                          onCheckedChange={setFillGapsWithBlack}
                        />
                      </div> as React.ReactElement<Record<string, unknown>>
                    }
                  />
                  <TooltipContent>
                    Export timeline gaps as black video + silence.
                  </TooltipContent>
                </Tooltip>
                <Button disabled={!canExport} onClick={exportClip} size="sm" variant="secondary">
                  {isExporting ? "Exporting…" : "Export"}
                </Button>
                <Button onClick={clearProject} size="sm" variant="ghost">
                  Clear
                </Button>
                <Separator className="h-8" orientation="vertical" />
                <ThemeToggle theme={theme} onChange={setTheme} />
              </div>
            </header>
          )}

          <input
            ref={fileInputRef}
            accept="video/mp4"
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files);
              e.currentTarget.value = "";
            }}
            type="file"
          />

          {error && (
            <Alert variant="error">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {clips.length === 0 ? (
            <main className="flex flex-1 items-center justify-center py-8">
              <div
                className="w-full max-w-3xl rounded-2xl border border-dashed bg-muted/40 p-10 transition-colors hover:bg-muted/60"
                onClick={pickFile}
                onDragOver={onDragOverStart}
                onDrop={onDropStart}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") pickFile();
                }}
                role="button"
                tabIndex={0}
              >
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <UploadIcon />
                    </EmptyMedia>
                    <EmptyTitle>Drop an MP4 to start</EmptyTitle>
                    <EmptyDescription>
                      Drag and drop your video here, or click to choose a file.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        pickFile();
                      }}
                    >
                      <UploadIcon className="size-4" />
                      Choose video
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            </main>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-h-0 space-y-10">
                <section className="space-y-3">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="font-semibold text-sm">Preview</div>
                      <div className="text-muted-foreground text-xs tabular-nums">
                        {duration > 0 ? (
                          <span className="tabular-nums">
                            {formatTime(currentTime)} / {formatTime(duration)}
                          </span>
                        ) : (
                          "Loading video…"
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-xl bg-black">
                    <video
                      ref={videoRef}
                      className="aspect-video w-full"
                      poster={posterUrl ?? undefined}
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        const d = Number.isFinite(v.duration) ? v.duration : 0;
                        setDuration(d);
                        if (!selectedClipId) return;

                        setClips((prev) =>
                          prev.map((c) => {
                            if (c.id !== selectedClipId) return c;
                            const nextIn = clamp(c.in, 0, d);
                            const nextOut = c.out > 0 ? clamp(c.out, 0, d) : d;
                            const orderedIn = Math.min(nextIn, nextOut);
                            const orderedOut = Math.max(nextIn, nextOut);
                            return { ...c, in: orderedIn, out: orderedOut };
                          }),
                        );

                        const start = clamp(trimStart, 0, Math.max(0, d - 0.001));
                        v.currentTime = start;
                        setCurrentTime(start);

                        if (pendingAutoplayNextClipRef.current) {
                          pendingAutoplayNextClipRef.current = false;
                          void v.play().catch((err) => setError(`Playback failed: ${String(err)}`));
                        }
                      }}
                      onEnded={() => {
                        if (advanceToNextClip()) return;
                        setIsPlaying(false);
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
                        if (
                          !e.currentTarget.paused &&
                          effectiveTrimEnd > 0 &&
                          t >= Math.max(0, effectiveTrimEnd - 0.001)
                        ) {
                          if (advanceToNextClip()) return;
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
                      <CropOverlay crop={cropRect} active={isCropping} onChange={updateCrop} />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <IconButton label="First frame" disabled={!canEdit} onClick={goFirst}>
                        <SkipBackIcon className="size-4" />
                      </IconButton>
                      <IconButton label={isPlaying ? "Pause" : "Play"} disabled={!canEdit} onClick={togglePlay}>
                        {isPlaying ? (
                          <PauseIcon className="size-4" />
                        ) : (
                          <PlayIcon className="size-4" />
                        )}
                      </IconButton>
                      <IconButton label="Last frame" disabled={!canEdit} onClick={goLast}>
                        <SkipForwardIcon className="size-4" />
                      </IconButton>
                      <IconButton
                        label={isCropping ? "Done cropping" : hasCrop ? "Edit crop" : "Crop"}
                        disabled={!canEdit}
                        onClick={toggleCrop}
                        variant={isCropping || hasCrop ? "secondary" : "outline"}
                      >
                        <CropIcon className="size-4" />
                      </IconButton>
                      <Separator className="mx-1 h-7" orientation="vertical" />
                      <IconButton label="Zoom out" disabled={!canZoomOut} onClick={zoomOut}>
                        <ZoomOutIcon className="size-4" />
                      </IconButton>
                      <IconButton label="Zoom in" disabled={!canZoomIn} onClick={zoomIn}>
                        <ZoomInIcon className="size-4" />
                      </IconButton>
                      <IconButton
                        label={
                          isBladeMode
                            ? "Blade tool on (click timeline to split)"
                            : "Blade tool (click timeline to split)"
                        }
                        disabled={!canEdit}
                        onClick={() => setIsBladeMode((prev) => !prev)}
                        pressed={isBladeMode}
                        variant={isBladeMode ? "secondary" : "outline"}
                      >
                        <ScissorsIcon className="size-4" />
                      </IconButton>
                    </div>

                    <div className="text-muted-foreground text-xs tabular-nums">
                      {formatTime(currentTime)}
                    </div>
                  </div>

                  {(isCropping || hasCrop) && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
                      <div className="text-muted-foreground text-xs">
                        {isCropping
                          ? "Drag the corners to crop. Export will use this crop."
                          : "Crop is set and will apply on export."}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button disabled={!canEdit} onClick={resetCrop} size="xs" variant="outline">
                          Reset crop
                        </Button>
                        {isCropping && (
                          <Button disabled={!canEdit} onClick={toggleCrop} size="xs">
                            Done
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                <section className="space-y-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="font-semibold text-sm">Clips</div>
                      <div className="text-muted-foreground text-xs">
                        Drag to reorder. Drop MP4s to insert after a clip.
                      </div>
                    </div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      {clips.length} total
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-xl border bg-muted/40">
                    <ScrollArea scrollbarGutter>
                      <div className="flex w-max items-start gap-2 p-2">
                        {clips.map((clip, idx) => {
                          const isSelected = clip.id === selectedClipId;
                          const isDragging = clip.id === draggingClipId;
                          const dropPosition =
                            clipDropTarget?.targetId === clip.id
                              ? clipDropTarget.position
                              : null;
                          const knownEnd = clip.out > 0 ? clip.out : 0;
                          const len = knownEnd > clip.in ? knownEnd - clip.in : 0;
                          return (
                            <div
                              key={clip.id}
                              className="relative"
                              data-clip-id={clip.id}
                              data-clip-tile="true"
                            >
                              {dropPosition === "before" && (
                                <div className="pointer-events-none absolute -left-1 top-2 bottom-2 w-0.5 rounded bg-primary" />
                              )}
                              {dropPosition === "after" && (
                                <div className="pointer-events-none absolute -right-1 top-2 bottom-2 w-0.5 rounded bg-primary" />
                              )}
                              <Button
                                onClick={onClickClipTile(clip.id)}
                                onDragOver={onDragOverClipTile}
                                onDrop={onDropOnClipTile(clip.id)}
                                onPointerCancel={onPointerEndClipTile}
                                onPointerDown={onPointerDownClipTile(clip.id)}
                                onPointerMove={onPointerMoveClipTile}
                                onPointerUp={onPointerEndClipTile}
                                size="sm"
                                variant="outline"
                                className={`w-52 !h-auto cursor-grab flex-col !items-start !justify-start !gap-1 overflow-hidden !px-3 !py-2 text-left active:cursor-grabbing ${isSelected ? "border-primary bg-primary/10 shadow-primary/20 shadow-sm ring-1 ring-primary/20" : ""} ${isDragging ? "opacity-50" : ""}`}
                              >
                                <div className="flex w-full min-w-0 items-center justify-between gap-2">
                                  <div className="flex min-w-0 items-center gap-1">
                                    <GripVerticalIcon className="size-3.5 text-muted-foreground/70" />
                                    <span className="font-medium text-xs tabular-nums">
                                      Clip {idx + 1}
                                    </span>
                                  </div>
                                  <span className="shrink-0 text-muted-foreground text-[10px] tabular-nums">
                                    {clip.out > 0 ? `${len.toFixed(1)}s` : "…"}
                                  </span>
                                </div>
                                <div className="w-full min-w-0 truncate text-[10px] text-muted-foreground">
                                  {clip.file.name}
                                </div>
                                <div className="flex w-full min-w-0 items-center justify-between gap-2 text-[10px] text-muted-foreground tabular-nums">
                                  <span className="truncate">In {formatTime(clip.in)}</span>
                                  <span className="truncate">
                                    Out {clip.out > 0 ? formatTime(clip.out) : "…"}
                                  </span>
                                </div>
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
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
                          updateTrim(orderedStart, orderedEnd);
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
                          ref={timelineTrackRef}
	                          className={`relative h-18 select-none ${isBladeMode ? "cursor-crosshair" : "cursor-pointer"}`}
	                          onPointerDown={(e) => {
	                            if (!duration || !canEdit) return;
	                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const ratio = clamp(x / rect.width, 0, 1);
                            const t = ratio * duration;
                            if (isBladeMode) {
                              splitClipAt(t);
                              return;
                            }
                            seek(t);
                            if (!selectedClip) return;
                            const file = selectedClip.file;
                            const candidate = clips.find((c) => {
                              if (c.file !== file) return false;
                              const end = c.out > 0 ? c.out : duration;
                              return t >= c.in && t <= end;
                            });
                            if (candidate) setSelectedClipId(candidate.id);
                          }}
                          onPointerLeave={() => setTimelineHoverTime(null)}
                          onPointerMove={(e) => {
                            if (!duration || !isBladeMode) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const ratio = clamp(x / rect.width, 0, 1);
                            setTimelineHoverTime(ratio * duration);
                          }}
                          role="presentation"
                          style={{
                            width: timelineWidthPx,
                            backgroundImage:
                              "linear-gradient(to right, color-mix(in srgb, var(--foreground) 6%, transparent) 1px, transparent 1px)",
                            backgroundSize: `${Math.max(24, Math.round(60 * zoom))}px 100%`,
                          }}
                        >
                          {canEdit && selectedClip && duration > 0 && (
                            <div className="absolute inset-y-3 left-0 right-0">
                              {clips
                                .filter((c) => c.file === selectedClip.file)
                                .slice()
                                .sort((a, b) => a.in - b.in)
                                .map((clip) => {
                                  const start = clamp(clip.in, 0, duration);
                                  const end = clamp(clip.out > 0 ? clip.out : duration, 0, duration);
                                  const orderedStart = Math.min(start, end);
                                  const orderedEnd = Math.max(start, end);
                                  if (orderedEnd <= orderedStart) return null;

                                  const leftPx = (orderedStart / duration) * timelineWidthPx;
                                  const rightPx = (orderedEnd / duration) * timelineWidthPx;
                                  const widthPx = rightPx - leftPx;
                                  const gapPx = 4;
                                  const insetLeftPx = leftPx + gapPx / 2;
                                  const insetWidthPx = Math.max(0, widthPx - gapPx);
                                  if (insetWidthPx <= 0) return null;

                                  const isSelected = clip.id === selectedClipId;
                                  return (
                                    <div
                                      key={clip.id}
                                      className={`group absolute inset-y-0 rounded-lg border bg-warning/8 shadow-xs/5 transition-[box-shadow,border-color] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] ${isSelected ? "z-10 border-warning/56 ring-2 ring-warning/16" : "z-0 border-warning/32"} dark:bg-warning/16 dark:before:shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]`}
                                      style={{ left: `${insetLeftPx}px`, width: `${insetWidthPx}px` }}
                                    >
                                      {!isBladeMode && canEdit && (
                                        <>
                                          <div
                                            className={`absolute inset-y-0 left-0 w-2 touch-none cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100 ${isSelected || trimmingClipId === clip.id ? "opacity-100" : ""}`}
                                            onPointerCancel={onPointerEndClipTrimHandle}
                                            onPointerDown={onPointerDownClipTrimHandle(clip.id, "start")}
                                            onPointerMove={onPointerMoveClipTrimHandle}
                                            onPointerUp={onPointerEndClipTrimHandle}
                                            role="presentation"
                                          >
                                            <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded bg-warning/70" />
                                          </div>
                                          <div
                                            className={`absolute inset-y-0 right-0 w-2 touch-none cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100 ${isSelected || trimmingClipId === clip.id ? "opacity-100" : ""}`}
                                            onPointerCancel={onPointerEndClipTrimHandle}
                                            onPointerDown={onPointerDownClipTrimHandle(clip.id, "end")}
                                            onPointerMove={onPointerMoveClipTrimHandle}
                                            onPointerUp={onPointerEndClipTrimHandle}
                                            role="presentation"
                                          >
                                            <div className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded bg-warning/70" />
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                          <div
                            className="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary"
                            style={{ left: `${playheadPx}px` }}
                          />
                          {isBladeMode && timelineHoverPx != null && timelineHoverTime != null && (
                            <>
                              <div
                                className="pointer-events-none absolute inset-y-0 z-30 w-px bg-destructive"
                                style={{ left: `${timelineHoverPx}px` }}
                              />
                              <div
                                className="pointer-events-none absolute bottom-2 z-30 -translate-x-1/2 rounded-md bg-background/80 px-1.5 py-0.5 text-xs text-foreground tabular-nums shadow"
                                style={{ left: `${timelineHoverPx}px` }}
                              >
                                {formatTime(timelineHoverTime)}
                              </div>
                            </>
                          )}
                          <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-20 flex items-center justify-between text-muted-foreground text-xs tabular-nums">
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
                    <div className="font-semibold text-sm">Agents</div>
                    <div className="text-muted-foreground text-xs">
                      Run specialized agents to generate assets and suggestions.
                    </div>
                  </div>

                  <Tabs defaultValue="copilot">
                    <TabsList>
                      <TabsTrigger value="copilot">
                        <SparklesIcon className="size-4" />
                        Copilot
                      </TabsTrigger>
                      <TabsTrigger value="agents">
                        <FolderOpenIcon className="size-4" />
                        Agents
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

                    <TabsContent className="mt-4" value="agents">
                      <VideoAgentsPanel
                        file={selectedFile}
                        durationSeconds={duration}
                        onSelectThumbnail={(url) => setPosterUrl(url)}
                      />
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
