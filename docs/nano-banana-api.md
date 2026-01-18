# Nano Banana Pro API Documentation

## Overview

Nano Banana Pro is a state-of-the-art AI image generation and editing model hosted on fal.ai. It leverages Google's Gemini 3 Pro Image architecture for high semantic accuracy and precise pixel-level manipulation.

**Key Capabilities:**
- Text-to-image generation
- Image editing with natural language prompts
- Multi-image composition (up to 14 reference images)
- Multiple output resolutions (1K, 2K, 4K)
- Various aspect ratios for different platforms

---

## Installation

```bash
npm install --save @fal-ai/client
```

## Authentication

### Environment Variable (Recommended)
```bash
export FAL_KEY="YOUR_API_KEY"
```

### Manual Configuration
```typescript
import { fal } from "@fal-ai/client";

fal.config({
  credentials: "YOUR_FAL_KEY"
});
```

> **Security Note:** For client-side applications, use a server-side proxy to protect your API key.

---

## Endpoints

### 1. Text-to-Image Generation

**Endpoint:** `POST /fal-ai/nano-banana-pro`

Generates images from text prompts.

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Text description of the image to generate |
| `num_images` | integer | No | 1 | Number of images (1-4) |
| `aspect_ratio` | string | No | "1:1" | Options: 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 |
| `output_format` | string | No | "png" | Options: jpeg, png, webp |
| `resolution` | string | No | "1K" | Options: 1K, 2K, 4K |
| `sync_mode` | boolean | No | false | Return as data URI (not saved in history) |

#### TypeScript Example

```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/nano-banana-pro", {
  input: {
    prompt: "A cinematic YouTube thumbnail showing a person looking surprised at a laptop screen",
    num_images: 1,
    aspect_ratio: "16:9",
    resolution: "1K"
  }
});

console.log(result.data.images[0].url);
```

#### Response

```json
{
  "images": [
    {
      "file_name": "nano-banana-t2i-output.png",
      "content_type": "image/png",
      "url": "https://storage.googleapis.com/falserverless/..."
    }
  ],
  "description": ""
}
```

---

### 2. Image Editing (Image-to-Image)

**Endpoint:** `POST /fal-ai/nano-banana-pro/edit`

Edit existing images using natural language prompts. **This is the key endpoint for thumbnail generation from video frames.**

#### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Natural language instruction for editing |
| `image_urls` | string[] | Yes | - | URLs of input images (up to 14) |
| `num_images` | integer | No | 1 | Number of variations (1-4) |
| `aspect_ratio` | string | No | "auto" | Options: auto, 21:9, 16:9, 3:2, 4:3, 5:4, 1:1, 4:5, 3:4, 2:3, 9:16 |
| `output_format` | string | No | "png" | Options: jpeg, png, webp |
| `resolution` | string | No | "1K" | Options: 1K, 2K, 4K |

#### TypeScript Example

```typescript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
  input: {
    prompt: "Transform this video frame into an eye-catching YouTube thumbnail. Add dramatic lighting, enhance colors, and make it look professional and clickable.",
    image_urls: [
      "https://your-storage.com/extracted-frame-1.jpg",
      "https://your-storage.com/extracted-frame-2.jpg"
    ],
    aspect_ratio: "16:9",
    resolution: "1K",
    num_images: 3
  }
});

// Get generated thumbnail URLs
result.data.images.forEach((img, i) => {
  console.log(`Thumbnail ${i + 1}: ${img.url}`);
});
```

#### Response

```json
{
  "images": [
    {
      "file_name": "nano-banana-multi-edit-output-01.png",
      "content_type": "image/png",
      "url": "https://storage.googleapis.com/falserverless/..."
    },
    {
      "file_name": "nano-banana-multi-edit-output-02.png",
      "content_type": "image/png",
      "url": "https://storage.googleapis.com/falserverless/..."
    }
  ],
  "description": "Edited images."
}
```

---

## Queue Management (Long-Running Jobs)

For long-running requests, use the queue API:

### Submit to Queue

```typescript
import { fal } from "@fal-ai/client";

const { request_id } = await fal.queue.submit("fal-ai/nano-banana-pro/edit", {
  input: {
    prompt: "Create a thumbnail...",
    image_urls: ["https://..."]
  },
  webhookUrl: "https://your-app.com/webhook/fal" // Optional
});
```

### Check Status

```typescript
const status = await fal.queue.status("fal-ai/nano-banana-pro/edit", {
  requestId: request_id,
  logs: true
});
// status.status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
```

### Get Result

```typescript
const result = await fal.queue.result("fal-ai/nano-banana-pro/edit", {
  requestId: request_id
});
console.log(result.data.images);
```

---

## Pricing

| Resolution | Cost per Image |
|------------|----------------|
| 1K (1024px) | $0.15 |
| 2K (2048px) | $0.15 |
| 4K | $0.30 (2x rate) |

---

## Thumbnail Agent Integration

### Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    THUMBNAIL GENERATION FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Video Upload                                                 │
│     └── User uploads MP4                                         │
│                                                                  │
│  2. Overshoot Analysis                                           │
│     └── Analyze video with rolling window                        │
│     └── Score each segment for thumbnail potential               │
│     └── Return top 3 timestamps                                  │
│                                                                  │
│  3. Frame Extraction (ffmpeg)                                    │
│     └── ffmpeg -ss {timestamp} -i video.mp4 -vframes 1 frame.jpg │
│     └── Upload frames to cloud storage (get URLs)                │
│                                                                  │
│  4. Nano Banana Pro /edit                                        │
│     └── Pass frame URLs + thumbnail prompt                       │
│     └── Generate 3 enhanced thumbnails per frame                 │
│     └── User selects favorite                                    │
│                                                                  │
│  5. Export                                                       │
│     └── Download selected thumbnail                              │
│     └── Or set as video thumbnail metadata                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Example Implementation

```typescript
import { fal } from "@fal-ai/client";
import { RealtimeVision } from "@overshoot/sdk";

// Step 1: Configure Nano Banana
fal.config({ credentials: process.env.FAL_KEY });

// Step 2: Analyze video with Overshoot to find best frames
async function findBestFrames(videoUrl: string): Promise<number[]> {
  const scores: Array<{ timestamp: number; score: number }> = [];

  const vision = new RealtimeVision({
    apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
    apiKey: process.env.OVERSHOOT_API_KEY,
    source: { type: 'video', url: videoUrl },
    prompt: `Rate this frame as a YouTube thumbnail (0-100). Consider visual clarity, facial expressions, action, composition.`,
    outputSchema: {
      type: 'object',
      properties: {
        thumbnail_score: { type: 'number' },
        timestamp_seconds: { type: 'number' }
      }
    },
    onResult: (result) => {
      const data = JSON.parse(result.result);
      scores.push({
        timestamp: data.timestamp_seconds,
        score: data.thumbnail_score
      });
    }
  });

  await vision.start();
  await vision.stop();

  // Return top 3 timestamps
  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.timestamp);
}

// Step 3: Generate thumbnails from extracted frames
async function generateThumbnails(frameUrls: string[]): Promise<string[]> {
  const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", {
    input: {
      prompt: `Transform this video frame into a professional YouTube thumbnail:
        - Enhance colors and contrast for visual pop
        - Add subtle dramatic lighting
        - Ensure the main subject stands out
        - Make it scroll-stopping and clickable
        - Maintain authenticity of the original scene`,
      image_urls: frameUrls,
      aspect_ratio: "16:9",
      resolution: "1K",
      num_images: 3
    }
  });

  return result.data.images.map(img => img.url);
}

// Step 4: Full pipeline
async function thumbnailPipeline(videoUrl: string) {
  // 1. Find best timestamps
  const timestamps = await findBestFrames(videoUrl);

  // 2. Extract frames with ffmpeg (server-side)
  const frameUrls = await extractFrames(videoUrl, timestamps);

  // 3. Generate thumbnails
  const thumbnails = await generateThumbnails(frameUrls);

  return thumbnails;
}
```

### Thumbnail Prompt Templates

**For YouTube/General:**
```
Transform this video frame into a professional YouTube thumbnail. Enhance colors, add dramatic lighting, make the subject pop. Keep it authentic but eye-catching.
```

**For TikTok/Reels (vertical):**
```
Create a vertical thumbnail for TikTok. Bold, vibrant colors. Clear focal point. Text-friendly composition with space for overlays.
```

**For Educational Content:**
```
Create a clean, professional thumbnail. Enhance clarity and readability. Subtle color grading. Professional look suitable for educational content.
```

**For Gaming:**
```
Create an exciting gaming thumbnail. Enhance action moments. Add intensity with color grading. Make it dynamic and energetic.
```

---

## Response Types

### ImageFile Object

```typescript
interface ImageFile {
  url: string;           // Download URL
  file_name: string;     // Generated filename
  content_type: string;  // MIME type (e.g., "image/png")
  width?: number;        // Image width
  height?: number;       // Image height
  file_size?: number;    // Size in bytes
}
```

### Full Response

```typescript
interface NanoBananaResponse {
  images: ImageFile[];
  description: string;
}
```

---

## Error Handling

| Status | Description |
|--------|-------------|
| 400 | Bad Request - Invalid parameters or missing required fields |
| 401 | Unauthorized - Authentication failed |
| 500 | Internal Server Error |

```typescript
try {
  const result = await fal.subscribe("fal-ai/nano-banana-pro/edit", { input });
} catch (error) {
  if (error.status === 401) {
    console.error("Invalid API key");
  } else if (error.status === 400) {
    console.error("Invalid parameters:", error.message);
  }
}
```

---

## Dependencies

```json
{
  "@fal-ai/client": "latest",
  "@overshoot/sdk": "latest",
  "fluent-ffmpeg": "^2.1.2"
}
```

---

## Environment Variables

```bash
FAL_KEY=your-fal-api-key
OVERSHOOT_API_KEY=your-overshoot-api-key
```
