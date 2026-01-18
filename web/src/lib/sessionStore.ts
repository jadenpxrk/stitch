import { EditPlanSpec, SessionState, ShakyFix, TickRaw } from "./types";
import { buildSegments, cleanupSegments, decorateSegmentsForBridgeAbility, suggestFix } from "./segments";
import { smoothTicks } from "./smoothing";

import { RealtimeVision } from "@overshoot/sdk";
import { createVision } from "./overshoot";
import { generateCaptionsForSession } from "./captions";
import {
  ensureSessionDir,
  persistPlan,
  persistSegments,
  persistSmoothed,
  persistTick,
} from "./persistence";
import { fetchRecording } from "./overshootRecording";

const SESSIONS = new Map<string, SessionState>();
const RUNNING = new Map<string, RealtimeVision>();
const CAPTION_JOBS = new Map<string, Promise<void>>();

const DEFAULT_SESSION: SessionState = {
  id: "",
  status: "idle",
  startedAt: null,
  stoppedAt: null,
  ticksHz: 1,
  rawTicks: [],
  smoothed: [],
  segmentsRaw: [],
  segmentsFinal: [],
  duration: null,
  source: undefined,
  recordingUrl: null,
  captions: { status: "idle" },
};

function cloneState(base: SessionState): SessionState {
  return JSON.parse(JSON.stringify(base));
}

async function newSession(id: string, source?: string): Promise<SessionState> {
  const state = cloneState(DEFAULT_SESSION);
  state.id = id;
  state.status = "running";
  state.startedAt = Date.now();
  state.source = source;
  SESSIONS.set(id, state);
  await ensureSessionDir(id);
  const vision = createVision(id, source);
  if (vision) {
    RUNNING.set(id, vision);
    vision.start().catch((err) => console.error("vision.start failed", err));
  }
  return state;
}

export async function startSession(id: string, source?: string): Promise<SessionState> {
  const state = await newSession(id, source);
  return state;
}

export async function stopSession(
  id: string,
  recordingUrl?: string,
): Promise<SessionState | null> {
  const state = SESSIONS.get(id);
  if (!state) return null;
  const vision = RUNNING.get(id);
  if (vision) {
    try {
      await vision.stop();
    } catch (err) {
      console.error("vision.stop failed", err);
    }
    RUNNING.delete(id);
  }
  state.status = "stopped";
  state.stoppedAt = Date.now();
  if (state.startedAt) {
    state.duration = (state.stoppedAt - state.startedAt) / 1000;
  }
  if (recordingUrl) {
    state.recordingUrl = recordingUrl;
  }
  await fetchRecordingUrl(state);
  recompute(state);
  await persistArtifacts(state.id);
  return state;
}

async function persistArtifacts(id: string) {
  const plan = computeEditPlan(id);
  const state = SESSIONS.get(id);
  if (!state || !plan) return;
  await Promise.all([
    persistSmoothed(id, state.smoothed),
    persistSegments(id, state.segmentsRaw, state.segmentsFinal),
    persistPlan(id, plan),
  ]);
}

export async function appendTick(id: string, tick: TickRaw): Promise<SessionState | null> {
  const state = SESSIONS.get(id);
  if (!state) return null;
  state.rawTicks.push(tick);
  recompute(state);
  await persistTick(id, tick);
  await persistSmoothed(id, state.smoothed);
  await persistSegments(id, state.segmentsRaw, state.segmentsFinal);
  return state;
}

export async function generateCaptions(
  id: string,
  recordingUrl?: string,
): Promise<SessionState | null> {
  const state = SESSIONS.get(id);
  if (!state) return null;
  if (recordingUrl) {
    state.recordingUrl = recordingUrl;
  }
  if (state.status !== "stopped") {
    state.captions = { status: "error", error: "session not stopped" };
    return state;
  }
  if (!state.recordingUrl) {
    state.captions = { status: "error", error: "recordingUrl missing" };
    return state;
  }
  if (state.captions?.status === "running") return state;
  if (state.captions?.status === "ready" && state.captions.vttPath) {
    return state;
  }

  state.captions = { status: "running", startedAt: Date.now() };

  const job = (async () => {
    const vttPath = await generateCaptionsForSession(state.id, state.recordingUrl!);
    state.captions = {
      status: "ready",
      vttPath,
      startedAt: state.captions?.startedAt,
      finishedAt: Date.now(),
    };
    const plan = computeEditPlan(state.id);
    if (plan) {
      await persistPlan(state.id, plan);
    }
  })().catch((err) => {
    state.captions = {
      status: "error",
      error: String(err),
      startedAt: state.captions?.startedAt,
      finishedAt: Date.now(),
    };
  });

  CAPTION_JOBS.set(id, job);
  await job;
  CAPTION_JOBS.delete(id);
  return state;
}

export function setUserFix(
  id: string,
  segmentId: string,
  fix: Exclude<ShakyFix, "KEEP">,
): SessionState | null {
  const state = SESSIONS.get(id);
  if (!state) return null;
  const target = state.segmentsFinal.find((s) => s.id === segmentId);
  if (!target) return null;
  target.userFix = fix;
  target.finalFix = fix;
  return state;
}

export function getSession(id: string): SessionState | null {
  const state = SESSIONS.get(id);
  return state ? cloneState(state) : null;
}

export function getSessionMutable(id: string): SessionState | null {
  return SESSIONS.get(id) ?? null;
}

async function fetchRecordingUrl(state: SessionState) {
  const vision = RUNNING.get(state.id);
  if (!vision) return;
  try {
    const url = await fetchRecording(vision);
    state.recordingUrl = url;
  } catch (err) {
    console.error("fetchRecording failed", err);
  }
}

export function computeEditPlan(id: string): EditPlanSpec | null {
  const state = SESSIONS.get(id);
  if (!state || state.status === "idle") return null;
  return {
    version: 1,
    duration: state.duration ?? (state.rawTicks.at(-1)?.ts ?? 0),
    session_id: state.id,
    source: state.source,
    recording_url: state.recordingUrl ?? undefined,
    ticks_hz: state.ticksHz,
    captions_vtt_path:
      state.captions?.status === "ready" ? state.captions.vttPath : undefined,
    segments: state.segmentsFinal,
  };
}

function recompute(state: SessionState) {
  state.smoothed = smoothTicks(state.rawTicks);
  const built = buildSegments(state.smoothed, state.rawTicks);
  const cleaned = cleanupSegments(built);
  const suggested = cleaned.map(suggestFix);
  const decorated = decorateSegmentsForBridgeAbility(suggested, !!state.recordingUrl);
  state.segmentsRaw = built;
  state.segmentsFinal = decorated;
}
