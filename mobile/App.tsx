import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system';
import { Camera } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { createOvershootClient, OvershootResult } from './overshootClient'; // kept for potential local fallback

// Types aligned to SPEC.md / TECHNICAL_SPEC.md
const FIXES = ['CUT', 'STABILIZE', 'BRIDGE'] as const;
const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL || 'http://localhost:4000';
type Fix = typeof FIXES[number];
type SegmentType = 'GOOD' | 'SHAKY';

type RawTick = {
  ts: number;
  shaky: boolean;
  confidence: number;
  parseError?: string | null;
};

type SmoothedTick = {
  ts: number;
  finalState: SegmentType;
};

type Segment = {
  id: string;
  start: number;
  end: number;
  type: SegmentType;
  confidenceSum: number;
  confidenceCount: number;
  confidence_avg: number | null;
  suggested_fix: Fix;
  user_fix: Fix | null;
  final_fix: Fix | 'KEEP';
  outputs: Record<string, string>;
};

type SessionState = 'idle' | 'running' | 'stopped';

const pad = (n: number) => n.toString().padStart(4, '0');

function suggestFix(duration: number): Fix {
  return duration <= 2 ? 'BRIDGE' : 'STABILIZE';
}

function bridgeAllowed(segment: Segment, prev: Segment | undefined, next: Segment | undefined): boolean {
  if (segment.type !== 'SHAKY') return false;
  const duration = segment.end - segment.start;
  if (duration >= 8) return false;
  if (!prev || !next) return false;
  if (prev.type !== 'GOOD' || next.type !== 'GOOD') return false;
  return true;
}

function cleanupSegments(segments: Segment[]): Segment[] {
  const MIN_GOOD = 1;
  const MIN_SHAKY = 0.5;
  const MERGE_GAP = 0.5;

  if (!segments.length) return [];

  const cleaned: Segment[] = [];
  for (const seg of segments) {
    const duration = seg.end - seg.start;
    if (seg.type === 'GOOD' && duration < MIN_GOOD) {
      // Merge noise into neighbors: skip adding, let neighbors absorb later.
      continue;
    }
    if (seg.type === 'SHAKY' && duration < MIN_SHAKY) {
      continue;
    }
    const last = cleaned[cleaned.length - 1];
    if (last && last.type === 'GOOD' && seg.type === 'GOOD') {
      last.end = seg.end;
      continue;
    }
    cleaned.push({ ...seg });
  }

  // Merge tiny shaky gaps between good segments
  const merged: Segment[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const current = cleaned[i];
    if (
      current.type === 'SHAKY' &&
      current.end - current.start < MERGE_GAP &&
      merged.length &&
      i + 1 < cleaned.length &&
      merged[merged.length - 1].type === 'GOOD' &&
      cleaned[i + 1].type === 'GOOD'
    ) {
      merged[merged.length - 1].end = cleaned[i + 1].end;
      i++; // skip next GOOD
      continue;
    }
    merged.push(current);
  }

  return merged.map((seg) => ({
    ...seg,
    confidence_avg: seg.type === 'SHAKY' && seg.confidenceCount > 0 ? seg.confidenceSum / seg.confidenceCount : null,
    suggested_fix: seg.type === 'SHAKY' ? suggestFix(seg.end - seg.start) : 'STABILIZE',
    final_fix: seg.type === 'GOOD' ? 'KEEP' : seg.final_fix,
  }));
}

function nextSmoothedState(
  rawShakyBuffer: boolean[],
  currentState: SegmentType,
  raw: RawTick
): { nextState: SegmentType; nextBuffer: boolean[] } {
  const buffer = [...rawShakyBuffer.slice(-2), raw.shaky];
  const shakyCount = buffer.filter(Boolean).length;
  const twoOfThreeShaky = shakyCount >= 2;
  const twoOfThreeGood = shakyCount <= 1; // applies for len 1/2/3 equally as majority-good

  if (currentState === 'GOOD' && (twoOfThreeShaky || raw.confidence >= 0.95)) {
    return { nextState: 'SHAKY', nextBuffer: buffer };
  }
  if (currentState === 'SHAKY' && twoOfThreeGood) {
    return { nextState: 'GOOD', nextBuffer: buffer };
  }
  return { nextState: currentState, nextBuffer: buffer };
}

async function mockOvershootInference(ts: number): Promise<RawTick> {
  // Placeholder: replace with real Overshoot SDK call using EXPO_PUBLIC_OVERSHOOT_API_KEY
  const shaky = Math.random() > 0.72;
  const confidence = shaky ? 0.6 + Math.random() * 0.4 : Math.random() * 0.6;
  return { ts, shaky, confidence, parseError: null };
}

async function overshootTick(ts: number, clientRef: React.MutableRefObject<any>): Promise<OvershootResult> {
  if (!clientRef.current) {
    throw new Error('Overshoot client not initialized');
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ts, shaky: false, confidence: 0, parseError: 'timeout' });
    }, 4000);
    clientRef.current.onResult((result: any) => {
      clearTimeout(timeout);
      try {
        const parsed = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
        const shaky = Boolean(parsed.shaky);
        const confidence = Number(parsed.confidence ?? 0);
        resolve({ ts, shaky, confidence: Math.min(1, Math.max(0, confidence)), parseError: null });
      } catch (err) {
        resolve({ ts, shaky: false, confidence: 0, parseError: String(err) });
      }
    });
    // Trigger inference tick; Overshoot SDK streams continuously once started
  });
}

async function proxyTick(ts: number): Promise<OvershootResult> {
  const res = await fetch(`${PROXY_URL}/tick`);
  const json = await res.json();
  if (json.result) {
    return {
      ts,
      shaky: Boolean(json.result.shaky),
      confidence: Math.min(1, Math.max(0, Number(json.result.confidence ?? 0))),
      parseError: null,
    };
  }
  if (json.error) {
    return { ts, shaky: false, confidence: 0, parseError: json.error };
  }
  return { ts, shaky: false, confidence: 0, parseError: null };
}

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ticks, setTicks] = useState<RawTick[]>([]);
  const [smoothedTicks, setSmoothedTicks] = useState<SmoothedTick[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [currentState, setCurrentState] = useState<SegmentType>('GOOD');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [useMock, setUseMock] = useState<boolean>(false);
  const [useProxy, setUseProxy] = useState<boolean>(true);
  const [selectedVideo, setSelectedVideo] = useState<{ uri: string; name?: string } | null>(null);
  const rawBufferRef = useRef<boolean[]>([]);
  const timerRef = useRef<NodeJS.Timer | null>(null);
  const sessionStartedAtRef = useRef<number | null>(null);
  const tickInFlight = useRef(false);
  const overshootRef = useRef<any>(null);

  const startSession = async () => {
    if (sessionState === 'running') return;

    const id = `sess_${Date.now()}`;
    setSessionId(id);
    setTicks([]);
    setSmoothedTicks([]);
    setSegments([]);
    setCurrentState('GOOD');
    rawBufferRef.current = [];
    setLastConfidence(null);
    setErrorMsg(null);
    setSessionState('running');
    sessionStartedAtRef.current = Date.now();

    const apiKey = process.env.EXPO_PUBLIC_OVERSHOOT_API_KEY;
    const model = process.env.EXPO_PUBLIC_OVERSHOOT_MODEL;
    const proxyUrl = process.env.EXPO_PUBLIC_PROXY_URL || 'http://localhost:4000';

    if (useProxy) {
      if (!selectedVideo) {
        setErrorMsg('Select a video before starting.');
        setUseMock(true);
      } else {
        try {
          const form = new FormData();
          form.append('video', {
            uri: selectedVideo.uri,
            name: selectedVideo.name || 'upload.mp4',
            type: 'video/mp4',
          } as any);

          const resp = await fetch(`${proxyUrl}/upload`, {
            method: 'POST',
            body: form,
          });
          const json = await resp.json();
          if (resp.ok) {
            // Seed segments from backend result
            setUseMock(false);
            setSegments(json.segments || []);
            setTicks((json.ticks || []).map((t: any) => ({ ts: t.ts, shaky: t.finalState === 'SHAKY', confidence: t.raw?.confidence ?? 0 })));
            setSmoothedTicks(json.ticks || []);
            // Stop immediately since processing already done
            setSessionState('stopped');
            setErrorMsg(null);
            return;
          } else {
            setUseMock(true);
            setErrorMsg(`Proxy upload failed: ${json.error || 'unknown error'}`);
          }
        } catch (e: any) {
          setUseMock(true);
          setErrorMsg(`Proxy upload failed: ${String(e)}`);
        }
      }
    } else if (!apiKey) {
      setUseMock(true);
      setErrorMsg('Missing EXPO_PUBLIC_OVERSHOOT_API_KEY. Running in mock mode.');
    } else {
      setUseMock(false);
      try {
        const { status } = await Camera.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          alert('Camera permission is required to start the stream.');
          setSessionState('idle');
          return;
        }
        overshootRef.current = createOvershootClient({
          apiKey: apiKey,
          model: model ?? undefined,
          cameraFacing: 'environment',
        });
        await overshootRef.current.start();
      } catch (e: any) {
        setUseMock(true);
        setErrorMsg(`Overshoot start failed: ${String(e)}. Falling back to mock.`);
      }
    }

    timerRef.current = setInterval(() => {
      void handleTick();
    }, 1000);
  };

  const stopSession = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (overshootRef.current) {
      try {
        await overshootRef.current.stop();
      } catch (e) {
        console.warn('Overshoot stop failed', e);
      }
    }
    setSessionState('stopped');
    // Run cleanup pass
    setSegments((prev) => cleanupSegments(prev));
  };

  const handleTick = async () => {
    if (tickInFlight.current || sessionState !== 'running') return;
    tickInFlight.current = true;
    const startedAt = sessionStartedAtRef.current;
    if (!startedAt) {
      tickInFlight.current = false;
      return;
    }
    const ts = Math.max(0, (Date.now() - startedAt) / 1000);

    let raw: RawTick;
    try {
      if (useMock) {
        raw = await mockOvershootInference(ts);
      } else if (useProxy) {
        raw = await proxyTick(ts);
      } else {
        raw = await overshootTick(ts, overshootRef);
      }
      if (!Number.isFinite(raw.confidence)) raw.confidence = 0;
      raw.confidence = Math.min(1, Math.max(0, raw.confidence));
      raw.ts = ts; // enforce ts from our clock
    } catch (err) {
      raw = { ts, shaky: false, confidence: 0, parseError: String(err) };
    }

    setTicks((prev) => [...prev, raw]);
    setLastConfidence(raw.confidence);

    const { nextState, nextBuffer } = nextSmoothedState(rawBufferRef.current, currentState, raw);
    rawBufferRef.current = nextBuffer;
    setCurrentState(nextState);
    setSmoothedTicks((prev) => [...prev, { ts, finalState: nextState }]);

    setSegments((prev) => {
      if (!prev.length) {
        const seg: Segment = {
          id: `seg_${pad(1)}`,
          start: 0,
          end: ts,
          type: nextState,
          confidenceSum: raw.shaky ? raw.confidence : 0,
          confidenceCount: raw.shaky ? 1 : 0,
          confidence_avg: raw.shaky ? raw.confidence : null,
          suggested_fix: nextState === 'SHAKY' ? suggestFix(ts) : 'STABILIZE',
          user_fix: null,
          final_fix: nextState === 'GOOD' ? 'KEEP' : suggestFix(ts),
          outputs: nextState === 'SHAKY' ? { status: 'pending' } : {},
        };
        return [seg];
      }

      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last.type === nextState) {
        last.end = ts;
        if (nextState === 'SHAKY') {
          last.confidenceSum += raw.confidence;
          last.confidenceCount += 1;
          last.confidence_avg = last.confidenceSum / last.confidenceCount;
        }
        return updated;
      }

      const newSeg: Segment = {
        id: `seg_${pad(updated.length + 1)}`,
        start: last.end,
        end: ts,
        type: nextState,
        confidenceSum: nextState === 'SHAKY' ? raw.confidence : 0,
        confidenceCount: nextState === 'SHAKY' ? 1 : 0,
        confidence_avg: nextState === 'SHAKY' ? raw.confidence : null,
        suggested_fix: nextState === 'SHAKY' ? suggestFix(ts - last.end) : 'STABILIZE',
        user_fix: null,
        final_fix: nextState === 'GOOD' ? 'KEEP' : suggestFix(ts - last.end),
        outputs: nextState === 'SHAKY' ? { status: 'pending' } : {},
      };
      updated.push(newSeg);
      return updated;
    });

    tickInFlight.current = false;
  };

  const exportPlan = async () => {
    if (!sessionId) return;
    const cleaned = cleanupSegments(segments);
    const duration = cleaned.length ? cleaned[cleaned.length - 1].end : 0;
    const plan = {
      version: 1,
      session_id: sessionId,
      ticks_hz: 1,
      duration,
      segments: cleaned.map((seg) => {
        const finalFix = seg.type === 'GOOD' ? 'KEEP' : seg.user_fix ?? seg.suggested_fix;
        const base = {
          id: seg.id,
          start: seg.start,
          end: seg.end,
          type: seg.type,
          confidence_avg: seg.confidence_avg,
          suggested_fix: seg.type === 'SHAKY' ? seg.suggested_fix : undefined,
          user_fix: seg.user_fix,
          final_fix: finalFix,
          outputs: seg.outputs,
        };
        if (seg.type === 'GOOD') {
          return { ...base, final_fix: 'KEEP' };
        }
        return base;
      }),
    };

    const path = `${FileSystem.documentDirectory}edit_plan_${sessionId}.json`;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(plan, null, 2), {
      encoding: FileSystem.EncodingType.UTF8,
    });
    alert(`edit_plan.json saved to\n${path}`);
  };

  const lastState = currentState;
  const lastTickTs = smoothedTicks.length ? smoothedTicks[smoothedTicks.length - 1].ts : 0;

  const disableExport = segments.length === 0 || sessionState === 'running';

  const displayedSegments = useMemo(() => cleanupSegments(segments), [segments]);

  const updateUserFix = (segmentId: string, userFix: Fix) => {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === segmentId
          ? {
              ...seg,
              user_fix: userFix,
              final_fix: seg.type === 'GOOD' ? 'KEEP' : userFix,
            }
          : seg
      )
    );
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const selectVideo = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'video/*', multiple: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    setSelectedVideo({ uri: asset.uri, name: asset.name });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>Overshoot Auto-Editor</Text>
        <Text style={styles.subtitle}>CUT / STABILIZE / BRIDGE (Mobile)</Text>
        <Text style={styles.meta}>Session: {sessionId ?? '—'}</Text>
        <Text style={styles.meta}>State: {sessionState.toUpperCase()}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.button, styles.secondary]} onPress={selectVideo} disabled={sessionState === 'running'}>
          <Text style={styles.buttonText}>{selectedVideo ? 'Change Video' : 'Select Video'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.primary]} onPress={startSession} disabled={sessionState === 'running'}>
          <Text style={styles.buttonText}>Process Video</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.secondary]} onPress={stopSession} disabled={sessionState !== 'running'}>
          <Text style={styles.buttonText}>Stop</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, disableExport ? styles.disabled : styles.accent]} onPress={exportPlan} disabled={disableExport}>
          <Text style={styles.buttonText}>Export edit_plan.json</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Live Tick</Text>
        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
        <Text style={styles.statusLine}>State: {lastState}</Text>
        <Text style={styles.statusLine}>Last ts: {lastTickTs.toFixed(1)}s</Text>
        <Text style={styles.statusLine}>Last confidence: {lastConfidence !== null ? lastConfidence.toFixed(2) : '—'}</Text>
        <Text style={styles.statusLine}>Mode: {useMock ? 'mock' : useProxy ? 'proxy' : 'direct'}</Text>
        {selectedVideo ? <Text style={styles.statusLine}>Video: {selectedVideo.name || selectedVideo.uri}</Text> : null}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {displayedSegments.length === 0 ? (
          <Text style={styles.empty}>No segments yet. Start the stream to build timeline.</Text>
        ) : (
          displayedSegments.map((seg, idx) => {
            const prev = idx > 0 ? displayedSegments[idx - 1] : undefined;
            const next = idx + 1 < displayedSegments.length ? displayedSegments[idx + 1] : undefined;
            const duration = seg.end - seg.start;
            const canBridge = bridgeAllowed(seg, prev, next);
            const options = FIXES.map((fix) => ({ fix, disabled: fix === 'BRIDGE' && !canBridge }));
            const finalFix = seg.type === 'GOOD' ? 'KEEP' : seg.user_fix ?? seg.suggested_fix;

            return (
              <View key={seg.id} style={styles.segmentCard}>
                <View style={styles.segmentHeader}>
                  <Text style={styles.segmentTitle}>{seg.type} · {seg.id}</Text>
                  <Text style={styles.segmentMeta}>{duration.toFixed(1)}s</Text>
                </View>
                <Text style={styles.segmentMeta}>t={seg.start.toFixed(1)} → {seg.end.toFixed(1)}s</Text>
                {seg.type === 'SHAKY' && (
                  <>
                    <Text style={styles.segmentMeta}>confidence_avg: {seg.confidence_avg?.toFixed(2) ?? 'n/a'}</Text>
                    <Text style={styles.segmentMeta}>suggested: {seg.suggested_fix}</Text>
                    <View style={styles.pickerRow}>
                      <Text style={styles.pickerLabel}>Final fix:</Text>
                      <Picker
                        selectedValue={seg.user_fix ?? seg.suggested_fix}
                        style={styles.picker}
                        onValueChange={(value) => updateUserFix(seg.id, value as Fix)}
                      >
                        {options.map(({ fix, disabled }) => (
                          <Picker.Item key={fix} label={fix + (disabled ? ' (disabled)' : '')} value={fix} enabled={!disabled} />
                        ))}
                      </Picker>
                    </View>
                  </>
                )}
                {seg.type === 'GOOD' && <Text style={styles.segmentMeta}>final: KEEP</Text>}
                <Text style={styles.segmentMeta}>final_fix: {finalFix}</Text>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#cbd5e1',
    marginTop: 2,
  },
  meta: {
    color: '#94a3b8',
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: '#22c55e',
  },
  secondary: {
    backgroundColor: '#f97316',
  },
  accent: {
    backgroundColor: '#2563eb',
  },
  disabled: {
    backgroundColor: '#475569',
  },
  buttonText: {
    color: '#0b1224',
    fontWeight: '700',
  },
  statusCard: {
    marginHorizontal: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  statusTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    marginBottom: 4,
  },
  statusLine: {
    color: '#cbd5e1',
  },
  error: {
    color: '#f87171',
    marginBottom: 4,
  },
  scroll: {
    flex: 1,
    marginTop: 10,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  empty: {
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 20,
  },
  segmentCard: {
    backgroundColor: '#0b1224',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  segmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  segmentTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
  },
  segmentMeta: {
    color: '#94a3b8',
    marginTop: 2,
  },
  pickerRow: {
    marginTop: 8,
  },
  pickerLabel: {
    color: '#cbd5e1',
    marginBottom: 4,
  },
  picker: {
    backgroundColor: '#111827',
    color: '#e2e8f0',
  },
});
