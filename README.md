# Live YouTube Chyron Pipeline

Producer dashboard that accepts a **YouTube URL**, transcribes audio in short chunks via OpenAI `gpt-4o-mini-transcribe`, and generates **3–5 broadcast chyron suggestions** from a rolling **30–90 second** transcript context using `gpt-5.4-mini` (or `gpt-5.4-nano`).

Approved chyrons appear as plain text with copy/download — no external display integration in v1.

## Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- **ffmpeg** — `brew install ffmpeg`
- **yt-dlp** — installed via `pip install -r requirements.txt` in the backend venv (uses `python -m yt_dlp`, not the system binary)
- **OpenAI API key** with transcription access

## Setup

1. Copy environment file and add your API key:

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

2. Install backend dependencies (use Python 3.11+; `python3` on some systems may need to be `python3.11`):

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

3. Install frontend dependencies:

```bash
cd frontend
npm install
```

## Run

**Terminal 1 — backend** (from `backend/` with venv active):

```bash
uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend** (from `frontend/`):

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), paste a YouTube URL, and click **Start**.

## Deploy

- **GitHub:** https://github.com/BenMacklinn/live-youtube-chyron
- **Vercel (frontend):** https://frontend-gamma-six-12.vercel.app

The Next.js UI deploys on Vercel. The Python backend (WebSockets, `ffmpeg`, `yt-dlp`) must run on a separate host such as Railway, Render, or a VPS.

In the Vercel project settings, set **Root Directory** to `frontend` if Git deploys fail from the monorepo root.

Required Vercel environment variables once the backend is live:

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-backend.example.com` |
| `BACKEND_URL` | `https://your-backend.example.com` |

`NEXT_PUBLIC_BACKEND_URL` is used for the live WebSocket. `BACKEND_URL` is used for `/api/*` rewrites from Next.js.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Required |
| `CHYRON_MODEL` | `gpt-5.4-mini` | Caption model (`gpt-5.4-nano` for lower cost) |
| `CHYRON_CADENCE_SEC` | `8` | Seconds between chyron batches |
| `CONTEXT_WINDOW_SEC` | `60` | Rolling transcript window (30–90) |
| `TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | OpenAI transcription model |
| `TRANSCRIPTION_CHUNK_SEC` | `6` | Seconds of audio per transcription request |
| `TRANSCRIPTION_OVERLAP_SEC` | `0.75` | Audio overlap between chunks to reduce boundary drops |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin |
| `BACKEND_URL` | `http://localhost:8000` | Backend URL for Next.js rewrites |

Frontend WebSocket connects directly to `NEXT_PUBLIC_BACKEND_URL` (defaults to `http://localhost:8000`).

## Tests

```bash
cd backend
source .venv/bin/activate
python tests/test_context_buffer.py
curl http://localhost:8000/health
```

## Architecture

```
YouTube URL → yt-dlp + ffmpeg (24kHz PCM) → 6s WAV chunks → OpenAI gpt-4o-mini-transcribe
                                                                    ↓
                                                          Rolling transcript buffer (30–90s)
                                                                    ↓
                                                          Event-aware → gpt-5.4-mini chyron batch
                                                                    ↓
                                                          Producer approve/edit/reject → text output
```

## API

- `POST /api/sessions` — `{ "youtubeUrl": "...", "mode": "chyron", "contextWindowSec": 60 }`
- `POST /api/sessions/{id}/stop` — stop session
- `GET /api/sessions/{id}` — session state
- `WS /ws/sessions/{id}` — live events + approve/reject actions, plus `context.clear` to reset topic memory for a new guest or segment

## Modes

- **Chyron (default)** — AI-generated broadcast chyron suggestions
- **Verbatim** — also shows cleaned subtitle text from each batch
