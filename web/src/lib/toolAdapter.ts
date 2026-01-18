/**
 * Tool Adapter Pattern
 *
 * Maps capability names to concrete tool implementations.
 * This allows the UI to evolve independently of the assistant's guidance
 * by keeping tool references capability-focused rather than UI-focused.
 *
 * Per General_Purpose.md:
 * - Route tool calls through a small, changeable adapter
 * - Describe capabilities instead of hard-coding tool labels or UI sequences
 * - Update the adapter layer when tools or UI change
 */

import { CapabilityName, ToolResult, ToolHandler } from "./types";
import { applyIntroTrim } from "./sessionStore";
import { generateCaptionsForSession } from "./captions";

// Input types for each capability
export interface TrimIntroInput {
  sessionId: string;
  datasetId?: string;
  modelId?: string;
  userId?: string;
  deviceType?: string;
}

export interface StabilizeSegmentInput {
  sessionId: string;
  segmentId: string;
  method?: "warp" | "crop" | "smooth";
}

export interface CutSegmentInput {
  sessionId: string;
  segmentId: string;
}

export interface BridgeSegmentsInput {
  sessionId: string;
  segmentIds: string[];
}

export interface GenerateCaptionsInput {
  sessionId: string;
  recordingUrl: string;
}

export interface ExportVideoInput {
  sessionId: string;
  format?: "mp4" | "webm" | "mov";
  quality?: "draft" | "standard" | "high";
}

// Output types for each capability
export interface TrimIntroOutput {
  trimSeconds: number;
  displaySeconds: number;
  applied: boolean;
}

export interface StabilizeSegmentOutput {
  segmentId: string;
  method: string;
}

export interface CutSegmentOutput {
  segmentId: string;
  removed: boolean;
}

export interface BridgeSegmentsOutput {
  bridgedCount: number;
}

export interface GenerateCaptionsOutput {
  vttPath: string;
}

export interface ExportVideoOutput {
  outputPath: string;
  format: string;
}

/**
 * Registry of capability handlers.
 * Each handler implements a specific capability with a consistent interface.
 */
const handlers: Partial<Record<CapabilityName, ToolHandler<unknown, unknown>>> = {};

/**
 * Register a handler for a capability.
 */
export function registerHandler<TInput, TOutput>(
  capability: CapabilityName,
  handler: ToolHandler<TInput, TOutput>
): void {
  handlers[capability] = handler as ToolHandler<unknown, unknown>;
}

/**
 * Execute a capability by name.
 * Returns a standardized ToolResult with success/failure and optional data/error.
 */
export async function executeCapability<TInput, TOutput>(
  capability: CapabilityName,
  input: TInput
): Promise<ToolResult<TOutput>> {
  const handler = handlers[capability];

  if (!handler) {
    return {
      success: false,
      error: `No handler registered for capability: ${capability}`,
    };
  }

  try {
    return await handler(input) as ToolResult<TOutput>;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if a capability is available.
 */
export function hasCapability(capability: CapabilityName): boolean {
  return capability in handlers;
}

/**
 * List all registered capabilities.
 */
export function listCapabilities(): CapabilityName[] {
  return Object.keys(handlers) as CapabilityName[];
}

// Register default handlers

registerHandler<TrimIntroInput, TrimIntroOutput>(
  "trim_intro",
  async (input) => {
    const result = await applyIntroTrim(input.sessionId, {
      datasetId: input.datasetId,
      modelId: input.modelId,
      userId: input.userId,
      deviceType: input.deviceType,
    });

    if (!result) {
      return { success: false, error: "Session not found" };
    }

    if (result.error) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        trimSeconds: result.decision?.trim_seconds ?? 0,
        displaySeconds: result.decision?.display_seconds ?? 0,
        applied: result.decision !== null,
      },
    };
  }
);

registerHandler<GenerateCaptionsInput, GenerateCaptionsOutput>(
  "generate_captions",
  async (input) => {
    try {
      const vttPath = await generateCaptionsForSession(
        input.sessionId,
        input.recordingUrl
      );
      return {
        success: true,
        data: { vttPath },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Caption generation failed",
      };
    }
  }
);

// Placeholder handlers for capabilities that require implementation elsewhere
registerHandler<StabilizeSegmentInput, StabilizeSegmentOutput>(
  "stabilize_segment",
  async (input) => {
    // TODO: Implement stabilization via renderPipeline
    return {
      success: false,
      error: "Stabilize segment not yet implemented",
    };
  }
);

registerHandler<CutSegmentInput, CutSegmentOutput>(
  "cut_segment",
  async (input) => {
    // TODO: Implement cut via segment manipulation
    return {
      success: false,
      error: "Cut segment not yet implemented",
    };
  }
);

registerHandler<BridgeSegmentsInput, BridgeSegmentsOutput>(
  "bridge_segments",
  async (input) => {
    // TODO: Implement bridge via segment manipulation
    return {
      success: false,
      error: "Bridge segments not yet implemented",
    };
  }
);

registerHandler<ExportVideoInput, ExportVideoOutput>(
  "export_video",
  async (input) => {
    // TODO: Implement export via renderPipeline
    return {
      success: false,
      error: "Export video not yet implemented",
    };
  }
);

/**
 * Describe what a capability does (for assistant guidance).
 * Returns a human-readable description without UI-specific details.
 */
export function describeCapability(capability: CapabilityName): string {
  const descriptions: Record<CapabilityName, string> = {
    trim_intro:
      "Remove unstable footage from the beginning of a recording based on learned patterns",
    stabilize_segment:
      "Apply video stabilization to a shaky segment using motion compensation",
    cut_segment:
      "Remove a segment from the final output entirely",
    bridge_segments:
      "Smooth the transition between adjacent segments to hide cuts",
    generate_captions:
      "Create timestamped captions from the recording audio using speech-to-text",
    export_video:
      "Render the final edited video with all applied changes",
  };

  return descriptions[capability] ?? "Unknown capability";
}
