# Stitch

AI-powered video auto-editing that detects and fixes shaky segments in real-time.

## Demo

[![Watch the demo](https://img.youtube.com/vi/1avYMfUOo9A/maxresdefault.jpg)](https://youtu.be/1avYMfUOo9A)

## What is Stitch?

Stitch is an intelligent video editing tool built for the [Overshoot](https://overshoot.ai) platform. It automatically analyzes video streams to detect problematic segments (shaky, choppy, or awkward footage) and offers three ways to fix them:

**Learns Your Style** - Stitch remembers your editing preferences and learns your personal editing style over time. Like Cursor's tab autocomplete for code, Stitch can auto-apply your preferred fixes based on how you've edited similar segments before.

| Fix | Description |
|-----|-------------|
| **CUT** | Remove the segment entirely |
| **STABILIZE** | Apply motion stabilization via FFmpeg |
| **BRIDGE** | Generate a smooth AI transition using Veo 3.1 |

Built at **NexHacks**.

## Features

- **Learns Your Style** - Remembers your editing preferences and auto-applies them like Cursor tab
- **Real-time Analysis** - 1 Hz vision inference detects shaky segments as you record
- **Multiple Input Sources** - Webcam, phone camera, screen share, file upload, YouTube
- **Smart Segment Detection** - Temporal smoothing prevents false positives
- **AI Bridge Generation** - Veo 3.1 creates smooth transitions from first/last frames
- **Auto Captions** - ElevenLabs speech-to-text with filler word filtering
- **Intro Trim Detection** - Optional ML-based intro detection via Wood Wide
- **Export Options** - Edit plan JSON or fully rendered video

## Tech Stack

**Frontend**
- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 4
- Base UI components

**Backend**
- Next.js API routes
- Express.js (optional)
- FFmpeg with vidstab

**AI/ML**
- [Overshoot SDK](https://overshoot.ai) - Real-time video analysis
- [Veo 3.1](https://fal.ai) via fal.ai - AI video generation
- [ElevenLabs](https://elevenlabs.io) - Speech-to-text
- Wood Wide - Intro trim predictions

## Getting Started

### Prerequisites

- Node.js 18+
- FFmpeg with vidstab support
- API keys (see Environment Variables)

```bash
# macOS
brew install ffmpeg
```

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/stitch.git
cd stitch

# Install web dependencies
cd web
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create `web/.env.local`:

```env
OVERSHOOT_API_KEY=your_overshoot_key
ELEVENLABS_API_KEY=your_elevenlabs_key
FAL_KEY=your_fal_key
WOODWIDE_API_URL=your_woodwide_url      # optional
WOODWIDE_API_KEY=your_woodwide_key      # optional
FFMPEG_PATH=ffmpeg
OUTPUT_ROOT=sessions
```

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Video Input │ ──▶ │  Overshoot   │ ──▶ │  Segment    │
│ (any source)│     │  Analysis    │     │  Builder    │
└─────────────┘     └──────────────┘     └─────────────┘
                                                │
                    ┌──────────────────────────┘
                    ▼
┌─────────────────────────────────────────────────────────┐
│                    Timeline Editor                       │
│  ┌─────┐ ┌─────────┐ ┌─────┐ ┌───────────┐ ┌─────┐     │
│  │GOOD │ │  SHAKY  │ │GOOD │ │   SHAKY   │ │GOOD │     │
│  │     │ │ BRIDGE  │ │     │ │ STABILIZE │ │     │     │
│  └─────┘ └─────────┘ └─────┘ └───────────┘ └─────┘     │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│                   Export Options                         │
│  • edit_plan.json   • Rendered video   • Captions       │
└─────────────────────────────────────────────────────────┘
```

### Temporal Smoothing

Stitch uses a "2 of last 3" rule to prevent flickering:
- Mark as SHAKY only if 2+ of the last 3 ticks were shaky
- High confidence override: if confidence ≥ 0.95, immediately mark SHAKY

### Segment Cleanup

After recording stops:
1. Merge GOOD segments shorter than 1.0s with neighbors
2. Drop SHAKY segments shorter than 0.5s (noise)
3. Merge GOOD segments split by gaps < 0.5s

## Project Structure

```
stitch/
├── web/                    # Next.js frontend + API
│   ├── src/
│   │   ├── app/           # Pages and API routes
│   │   ├── components/    # React components
│   │   └── lib/           # Core logic
│   └── sessions/          # Runtime session storage
├── backend/               # Express.js server (optional)
├── mobile/                # React Native app (Expo)
└── docs/                  # Documentation
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/session/start` | Start a new session |
| `POST /api/session/stop` | Stop and process |
| `GET /api/session/[id]/state` | Get session state |
| `POST /api/session/[id]/tick` | Add inference result |
| `PATCH /api/session/[id]/segment/[segmentId]` | Update segment fix |
| `POST /api/session/[id]/render` | Render final video |
| `GET /api/session/[id]/export` | Export edit plan |
| `POST /api/agents/bridge` | Generate bridge clip |

## License

MIT

## Acknowledgments

- [Overshoot](https://overshoot.ai) for the real-time vision analysis platform
- [fal.ai](https://fal.ai) for Veo 3.1 video generation
- [ElevenLabs](https://elevenlabs.io) for speech-to-text
- Built at NexHacks
