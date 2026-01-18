"use client";

import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "error" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).error)
        : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return data;
}

export function CaptionsNotes({ file }: { file: File | null }) {
  const [status, setStatus] = React.useState<"idle" | "running" | "ready" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [vtt, setVtt] = React.useState<string>("");

  React.useEffect(() => {
    let cancelled = false;
    if (!file) {
      setStatus("idle");
      setError(null);
      setVtt("");
      return;
    }

    setStatus("running");
    setError(null);
    setVtt("");

    (async () => {
      const form = new FormData();
      form.append("file", file, file.name || "video.mp4");
      const data = await fetchJson<{ vtt: string }>("/api/captions", {
        method: "POST",
        body: form,
      });
      if (cancelled) return;
      setVtt(data.vtt || "");
      setStatus("ready");
    })().catch((err) => {
      if (cancelled) return;
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
    };
  }, [file]);

  const download = React.useCallback(() => {
    if (!vtt) return;
    const blob = new Blob([vtt], { type: "text/vtt;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "captions.vtt";
    a.click();
    URL.revokeObjectURL(url);
  }, [vtt]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-semibold text-sm">Captions</div>
        <div className="text-muted-foreground text-xs">
          Captions generate automatically when you upload a video.
        </div>
      </div>

      {!file && (
        <Alert variant="info">
          <AlertTitle>No video selected</AlertTitle>
          <AlertDescription>Upload a video to generate captions.</AlertDescription>
        </Alert>
      )}

      {status === "running" && (
        <Alert>
          <AlertTitle>Generating</AlertTitle>
          <AlertDescription>Creating timestamped captions…</AlertDescription>
        </Alert>
      )}

      {status === "error" && error && (
        <Alert variant="error">
          <AlertTitle>Caption generation failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {status === "ready" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={download} disabled={!vtt}>
              Download VTT
            </Button>
          </div>
          <Separator />
          <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">{vtt}</pre>
        </>
      )}
    </div>
  );
}

