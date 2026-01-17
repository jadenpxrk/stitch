"use client";

import { useEffect, useMemo, useState } from "react";
import { EditPlan, Segment, SessionState } from "@/lib/types";

const API_BASE = ""; // same-origin

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const formatSeconds = (s: number | null | undefined) =>
  s === null || s === undefined ? "-" : `${s.toFixed(1)}s`;

export default function Home() {
  const [sessionId, setSessionId] = useState<string>("demo-session");
  const [source, setSource] = useState<string>("webcam");
  const [state, setState] = useState<SessionState | null>(null);
  const [exportPlan, setExportPlan] = useState<EditPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shakySegments = useMemo(
    () => state?.segmentsFinal.filter((s) => s.type === "SHAKY") ?? [],
    [state],
  );

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

  const stop = async () => {
    setError(null);
    try {
      const res = await api<SessionState>("/api/session/stop", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
      setState(res);
    } catch (e) {
      setError(String(e));
    }
  };

  const refresh = async () => {
    if (!sessionId) return;
    try {
      const res = await api<SessionState>(`/api/session/${sessionId}/state`);
      setState(res);
    } catch (e) {
      setError(String(e));
    }
  };

  const updateFix = async (segmentId: string, fix: Segment["finalFix"]) => {
    try {
      const res = await api<SessionState>(
        `/api/session/${sessionId}/segment/${segmentId}`,
        {
          method: "POST",
          body: JSON.stringify({ fix }),
        },
      );
      setState(res);
    } catch (e) {
      setError(String(e));
    }
  };

  const doExport = async () => {
    try {
      const res = await api<EditPlan>(`/api/session/${sessionId}/export`);
      setExportPlan(res);
    } catch (e) {
      setError(String(e));
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
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-200">
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-cyan-200">
              Status: {state?.status ?? "idle"}
            </span>
            <span>Ticks: {state?.rawTicks.length ?? 0}</span>
            <span>Duration: {formatSeconds(state?.duration)}</span>
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

        {error && (
          <div className="rounded-lg border border-red-400/50 bg-red-950/40 p-3 text-sm text-red-100">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentRow({
  seg,
  onChangeFix,
}: {
  seg: Segment;
  onChangeFix: (fix: Segment["finalFix"]) => void;
}) {
  const duration = (seg.end - seg.start).toFixed(1);
  const isShaky = seg.type === "SHAKY";
  const options = isShaky
    ? ["CUT", "STABILIZE", "BRIDGE"]
    : ["KEEP"];

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-100">
            {seg.type}
          </span>
          <span className="text-xs text-slate-300">{seg.id}</span>
        </div>
        <div className="text-sm text-slate-200">
          {seg.start.toFixed(1)}s → {seg.end.toFixed(1)}s ({duration}s)
        </div>
        {isShaky && (
          <div className="text-xs text-slate-300">
            confidence avg: {(seg.confidenceAvg ?? 0).toFixed(2)} | suggested: {seg.suggestedFix}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {isShaky ? (
          <select
            value={seg.finalFix}
            onChange={(e) => onChangeFix(e.target.value as Segment["finalFix"])}
            className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400 disabled:opacity-50"
            disabled={!seg.bridgeAllowed && seg.finalFix === "BRIDGE"}
          >
            {options.map((opt) => (
              <option key={opt} value={opt} disabled={opt === "BRIDGE" && !seg.bridgeAllowed}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200">
            KEEP
          </span>
        )}
      </div>
    </div>
  );
}
