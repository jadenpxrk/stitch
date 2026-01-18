import fs from "node:fs/promises";
import path from "node:path";
import { EditPlanSpec, Segment, SmoothedTick, TickRaw } from "./types";

const OUTPUT_ROOT = path.resolve(process.cwd(), process.env.OUTPUT_ROOT || "sessions");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function sessionDir(sessionId: string) {
  return path.join(OUTPUT_ROOT, sessionId);
}

async function sessionPath(sessionId: string, fileName: string) {
  const dir = sessionDir(sessionId);
  await ensureDir(dir);
  return path.join(dir, fileName);
}

export async function persistTick(sessionId: string, tick: TickRaw) {
  const file = await sessionPath(sessionId, "ticks.jsonl");
  await fs.appendFile(file, `${JSON.stringify(tick)}\n`, "utf8");
}

export async function persistSmoothed(sessionId: string, smoothed: SmoothedTick[]) {
  const file = await sessionPath(sessionId, "ticks_smoothed.jsonl");
  const lines = smoothed.map((t) => JSON.stringify(t)).join("\n");
  await fs.writeFile(file, lines ? `${lines}\n` : "", "utf8");
}

export async function persistSegments(sessionId: string, raw: Segment[], final: Segment[]) {
  const rawFile = await sessionPath(sessionId, "segments_raw.json");
  const finalFile = await sessionPath(sessionId, "segments_final.json");
  await Promise.all([
    fs.writeFile(rawFile, JSON.stringify(raw, null, 2), "utf8"),
    fs.writeFile(finalFile, JSON.stringify(final, null, 2), "utf8"),
  ]);
}

export async function persistPlan(sessionId: string, plan: EditPlanSpec) {
  const file = await sessionPath(sessionId, "edit_plan.json");
  await fs.writeFile(file, JSON.stringify(plan, null, 2), "utf8");
}

export async function ensureSessionDir(sessionId: string) {
  await ensureDir(sessionDir(sessionId));
}

export function getSessionDir(sessionId: string) {
  return sessionDir(sessionId);
}
