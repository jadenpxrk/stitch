"use client";

import * as React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

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

export function WoodwidePanel() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<unknown | null>(null);

  const verify = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson("/api/woodwide/auth");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="grid gap-3">
      <div>
        <div className="font-semibold text-sm">Learned intro trim</div>
        <div className="text-muted-foreground text-xs">
          Checks the learned-intro-trim service connection and surfaces debug info for demos.
        </div>
      </div>

      {error && (
        <Alert variant="error">
          <AlertTitle>Connection error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={verify} disabled={busy} variant="secondary">
          Verify connection
        </Button>
      </div>

      {result != null && (
        <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

