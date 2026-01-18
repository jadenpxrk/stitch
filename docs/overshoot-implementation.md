# Overshoot SDK Implementation Plan

## Goals

### 1. Thumbnail Generation Pipeline
- Analyze uploaded MP4 videos to identify **3 visually compelling frames** that would make good thumbnails
- Pass these 3 candidate frames to **Nano Banana Pro** for AI-powered thumbnail generation
- Allow users to select from generated thumbnails for their video

### 2. Peak Clip Detection for Short-Form Content
- Identify "peak moments" in videos that would perform well as short-form content
- Target platforms: TikTok, Instagram Reels, YouTube Shorts
- Extract clips of optimal length (15-60 seconds) containing high-engagement moments

---

## How Overshoot Works

### Overview
Overshoot is a real-time AI video analysis SDK. It processes video using a **rolling window technique** rather than frame-by-frame analysis, making it efficient for analyzing longer videos.

**Key Concept**: "Point a video source, describe what you want in plain English, pick a model, and get results in real-time."

### Installation
```bash
npm install @overshoot/sdk
```

### API Key
Obtain from: https://platform.overshoot.ai/api-keys

### Basic Usage
```javascript
import { RealtimeVision } from '@overshoot/sdk'

const vision = new RealtimeVision({
  apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
  apiKey: 'your-api-key',
  prompt: 'Your analysis prompt here',
  onResult: (result) => {
    console.log(result.result)
  }
})

await vision.start()
await vision.stop()
```

### Video File Processing
For uploaded MP4s (not live camera):
```javascript
const vision = new RealtimeVision({
  apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
  apiKey: process.env.OVERSHOOT_API_KEY,
  source: {
    type: 'video',
    file: videoFile  // The uploaded MP4 file
  },
  prompt: 'Your analysis prompt',
  onResult: (result) => {
    // Handle results as they stream in
  }
})
```

### Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `clip_length_seconds` | 1 | Window duration for analysis context |
| `delay_seconds` | 1 | How often results are delivered |
| `fps` | 30 | Maximum frame capture rate |
| `sampling_ratio` | 0.1 | Fraction of frames analyzed (10% = every 10th frame) |

### Available Models

| Model | Notes |
|-------|-------|
| `Qwen/Qwen3-VL-30B-A3B-Instruct` | **Default** - Best quality |
| `Qwen/Qwen3-VL-8B-Instruct` | Faster, lighter |
| `OpenGVLab/InternVL3_5-30B-A3B` | Alternative option |

### Structured Output (JSON Schema)
Instead of plain text, get structured JSON responses:
```javascript
const vision = new RealtimeVision({
  // ... other config
  outputSchema: {
    type: 'object',
    properties: {
      thumbnail_score: { type: 'number' },
      is_peak_moment: { type: 'boolean' },
      description: { type: 'string' }
    }
  },
  onResult: (result) => {
    const data = JSON.parse(result.result)
    // data.thumbnail_score, data.is_peak_moment, etc.
  }
})
```

### Response Object
```javascript
{
  result: "AI analysis response",
  inference_latency_ms: 150,  // Model processing time
  total_latency_ms: 300       // End-to-end including network
}
```

---

## Implementation Strategy

### Part 1: Thumbnail Frame Detection

**Prompt Strategy:**
```javascript
const thumbnailPrompt = `
Analyze this video segment and rate it as a potential thumbnail on a scale of 0-100.
Consider:
- Visual clarity and sharpness
- Facial expressions (if people present)
- Action/movement (frozen action moments)
- Composition and framing
- Emotional impact
- Text/graphics visibility
- Avoid blurry, dark, or transitional frames
`
```

**Output Schema:**
```javascript
const thumbnailSchema = {
  type: 'object',
  properties: {
    thumbnail_score: {
      type: 'number',
      description: 'Score from 0-100 for thumbnail potential'
    },
    timestamp_seconds: {
      type: 'number',
      description: 'Timestamp of the best frame in this window'
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation of the score'
    },
    has_face: { type: 'boolean' },
    has_text: { type: 'boolean' },
    is_action_shot: { type: 'boolean' }
  }
}
```

**Algorithm:**
1. Process entire video with rolling windows
2. Collect all results with scores
3. Sort by `thumbnail_score` descending
4. Take top 3 unique frames (ensure they're from different parts of video)
5. Extract actual frames at those timestamps using ffmpeg
6. Pass to Nano Banana Pro for thumbnail generation

### Part 2: Peak Clip Detection

**Prompt Strategy:**
```javascript
const peakClipPrompt = `
Analyze this video segment for viral/engaging content potential.
Rate as a "peak moment" suitable for TikTok/Reels on a scale of 0-100.
Consider:
- High energy or emotional moments
- Surprising or unexpected events
- Humor or entertainment value
- Educational "aha" moments
- Visual spectacle
- Clear audio/dialogue moments
- Hook potential (would this grab attention?)
`
```

**Output Schema:**
```javascript
const peakClipSchema = {
  type: 'object',
  properties: {
    peak_score: {
      type: 'number',
      description: 'Viral potential score 0-100'
    },
    clip_type: {
      type: 'string',
      enum: ['hook', 'climax', 'punchline', 'reveal', 'educational', 'emotional']
    },
    suggested_clip_start: { type: 'number' },
    suggested_clip_end: { type: 'number' },
    hook_text: {
      type: 'string',
      description: 'Suggested text overlay or caption'
    }
  }
}
```

**Algorithm:**
1. Process video with overlapping windows (e.g., 3-second windows, 1-second overlap)
2. Identify segments with high `peak_score`
3. Merge adjacent high-scoring segments into clips
4. Ensure clips are 15-60 seconds (optimal for short-form)
5. Extract clips using ffmpeg with proper start/end times
6. Optionally add hooks/captions based on `hook_text`

---

## Recommended Configuration for Our Use Case

```javascript
const overshootConfig = {
  apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
  apiKey: process.env.OVERSHOOT_API_KEY,

  // For thumbnail detection - sample more frames
  clip_length_seconds: 2,
  delay_seconds: 0.5,
  fps: 30,
  sampling_ratio: 0.2,  // Analyze 20% of frames for better coverage

  // Use default model for best quality
  model: 'Qwen/Qwen3-VL-30B-A3B-Instruct'
}
```

---

## Integration Flow

```
┌─────────────────┐
│  Upload MP4     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Overshoot SDK  │
│  Analyze Video  │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐  ┌──────────┐
│Thumb- │  │  Peak    │
│nail   │  │  Clip    │
│Frames │  │Detection │
└───┬───┘  └────┬─────┘
    │           │
    ▼           ▼
┌───────────┐  ┌──────────────┐
│  FFmpeg   │  │   FFmpeg     │
│  Extract  │  │   Extract    │
│  3 Frames │  │   Clips      │
└─────┬─────┘  └──────────────┘
      │
      ▼
┌─────────────────┐
│ Nano Banana Pro │
│ Generate Thumbs │
└─────────────────┘
```

---

## Notes for Implementation

1. **API Key Storage**: Store `OVERSHOOT_API_KEY` in environment variables
2. **Frame Extraction**: Use ffmpeg to extract frames at specific timestamps
   ```bash
   ffmpeg -ss {timestamp} -i input.mp4 -vframes 1 -q:v 2 frame_{n}.jpg
   ```
3. **Clip Extraction**: Use ffmpeg for clip extraction
   ```bash
   ffmpeg -i input.mp4 -ss {start} -to {end} -c copy clip_{n}.mp4
   ```
4. **Parallel Processing**: Can run thumbnail and peak detection with different prompts simultaneously using `updatePrompt()` or separate instances
5. **Cost Optimization**: Adjust `sampling_ratio` based on video length - lower for longer videos

---

## Dependencies

```json
{
  "@overshoot/sdk": "latest",
  "fluent-ffmpeg": "^2.1.2"
}
```
