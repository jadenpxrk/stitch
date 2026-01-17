require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { RealtimeVision } = require('@overshoot/sdk');
const { smoothTicks, buildSegments, cleanupSegments } = require('./smoothing');

const PORT = process.env.PORT || 4000;
const OVERSHOOT_API_KEY = process.env.OVERSHOOT_API_KEY;
const OVERSHOOT_MODEL = process.env.OVERSHOOT_MODEL;
const OUTPUT_ROOT = process.env.OUTPUT_ROOT || path.join(__dirname, 'sessions');

if (!OVERSHOOT_API_KEY) {
  console.warn('Warning: OVERSHOOT_API_KEY is not set. The server will reject inference requests.');
}

if (!fs.existsSync(OUTPUT_ROOT)) fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: path.join(OUTPUT_ROOT, 'uploads') });

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!OVERSHOOT_API_KEY) return res.status(400).json({ error: 'OVERSHOOT_API_KEY missing on server' });

  const sessionId = `sess_${Date.now()}`;
  const sessionDir = path.join(OUTPUT_ROOT, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const videoPath = req.file.path;
  const ticks = [];

  try {
    const vision = new RealtimeVision({
      apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
      apiKey: OVERSHOOT_API_KEY,
      model: OVERSHOOT_MODEL,
      prompt: defaultPrompt(),
      source: { type: 'video', file: fs.createReadStream(videoPath) },
      onResult: (result) => {
        try {
          const parsed = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
          const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
          const shaky = Boolean(parsed.shaky);
          const confidence = Math.min(1, Math.max(0, Number(parsed.confidence ?? 0)));
          ticks.push({ ts, shaky, confidence });
        } catch (e) {
          // skip invalid
        }
      },
    });

    await vision.start();
    await vision.stop();
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }

  // Sort ticks by ts and apply smoothing/segments
  ticks.sort((a, b) => a.ts - b.ts);
  const smoothed = smoothTicks(ticks);
  const segmentsRaw = buildSegments(smoothed);
  const segments = cleanupSegments(segmentsRaw);

  const editPlan = {
    version: 1,
    session_id: sessionId,
    duration: ticks.length ? ticks[ticks.length - 1].ts : 0,
    ticks_hz: 1,
    segments: segments.map((seg) => ({
      id: seg.id,
      start: seg.start,
      end: seg.end,
      type: seg.type,
      confidence_avg: seg.confidence_avg,
      suggested_fix: seg.type === 'SHAKY' ? seg.suggested_fix : undefined,
      user_fix: null,
      final_fix: seg.final_fix,
      outputs: seg.outputs,
    })),
  };

  fs.writeFileSync(path.join(sessionDir, 'ticks.json'), JSON.stringify(ticks, null, 2));
  fs.writeFileSync(path.join(sessionDir, 'segments_raw.json'), JSON.stringify(segmentsRaw, null, 2));
  fs.writeFileSync(path.join(sessionDir, 'segments.json'), JSON.stringify(segments, null, 2));
  fs.writeFileSync(path.join(sessionDir, 'edit_plan.json'), JSON.stringify(editPlan, null, 2));

  res.json({ sessionId, segments, ticks: smoothed, edit_plan: editPlan });
});

function defaultPrompt() {
  return `You are analyzing the last ~1 second of video (about 8–12 frames).
Return ONLY valid JSON with exactly these keys:
{"ts": <number>, "shaky": <boolean>, "confidence": <number 0..1>}
No other text.
Decide "shaky" if camera motion/jitter makes the footage unpleasant or choppy.`;
}

app.listen(PORT, () => {
  console.log(`Overshoot proxy listening on ${PORT}`);
});
