import { RealtimeVision } from "@overshoot/sdk";

// TODO: Replace with real SDK call when available.
// This stub optionally reads a non-standard property `recordingUrl` if present.
export async function fetchRecording(vision: RealtimeVision): Promise<string | null> {
  // Some SDKs expose a recording URL on the vision object; this is speculative.
  const anyVision = vision as any;
  if (typeof anyVision.recordingUrl === "string") {
    return anyVision.recordingUrl;
  }
  return null;
}
