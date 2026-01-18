export type ShakyFix = "CUT" | "STABILIZE" | "BRIDGE" | "KEEP";

export type SegmentType = "GOOD" | "SHAKY";

export interface TickRaw {
  tick: number;
  ts: number;
  windowStart: number;
  windowEnd: number;
  raw: {
    shaky: boolean;
    confidence: number;
  };
  parseError: string | null;
}

export interface SmoothedTick {
  tick: number;
  ts: number;
  finalState: SegmentType;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  type: SegmentType;
  confidenceAvg?: number | null;
  suggestedFix?: Exclude<ShakyFix, "KEEP">;
  userFix?: Exclude<ShakyFix, "KEEP"> | null;
  finalFix: ShakyFix;
  outputs?: Record<string, unknown>;
  bridgeAllowed?: boolean;
}

export interface CaptionsState {
  status: "idle" | "running" | "ready" | "error";
  startedAt?: number;
  finishedAt?: number;
  vttPath?: string;
  error?: string;
}

export interface SessionState {
  id: string;
  status: "idle" | "running" | "stopped";
  startedAt: number | null;
  stoppedAt: number | null;
  ticksHz: number;
  rawTicks: TickRaw[];
  smoothed: SmoothedTick[];
  segmentsRaw: Segment[];
  segmentsFinal: Segment[];
  duration: number | null;
  source?: string;
  recordingUrl?: string | null;
  recordingPath?: string | null;
  captions?: CaptionsState;
}

export interface EditPlanSpec {
  version: number;
  duration: number;
  session_id?: string;
  source?: string;
  recording_url?: string;
  ticks_hz?: number;
  captions_vtt_path?: string;
  segments: Segment[];
}
