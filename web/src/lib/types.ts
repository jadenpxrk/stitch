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
  recordingPath?: string;
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
  intro_trim?: IntroTrimDecision;
}

// Wood Wide learned intro trim types
export interface EarlyFeatures {
  early_shaky_ratio: number;
  early_avg_confidence: number;
  early_num_flips: number;
  early_face_ratio?: number;
  early_audio_energy?: number;
  user_id?: string;
  device_type?: string;
}

export interface IntroTrimPrediction {
  intro_trim_seconds: number;
  dataset_id: string;
  model_id: string;
  raw_prediction: number;
}

export interface IntroTrimDecision {
  type: "TRIM_INTRO";
  trim_seconds: number;
  display_seconds: number; // Rounded to nearest 0.5s
  prediction: IntroTrimPrediction;
}

// Tool adapter types
export type CapabilityName =
  | "trim_intro"
  | "stabilize_segment"
  | "cut_segment"
  | "bridge_segments"
  | "generate_captions"
  | "export_video";

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput
) => Promise<ToolResult<TOutput>>;
