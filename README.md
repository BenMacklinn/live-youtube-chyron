# Live Stream Chyron Pipeline

Producer dashboard that accepts a direct **RTMP, HLS (`.m3u8`), or media URL**, transcribes audio in short chunks via OpenAI `gpt-4o-mini-transcribe`, and generates **3–5 broadcast chyron suggestions** from a rolling **30–90 second** transcript context using `gpt-5.4-nano`.

Approved chyrons appear as plain text with copy/download — no external display integration in v1.

## Prerequisites

- **Node.js 18+**
- **OpenAI API key** with transcription access
- **Supabase project** — this repo is wired for `Live Chyron` (`xrbbbebtxjekvwkyuloe`)

## Setup

1. Copy environment file and add your API key:

```bash
cp .env.example frontend/.env.local
# Edit frontend/.env.local and set OPENAI_API_KEY and SUPABASE_SECRET_KEY.
```

2. Install frontend dependencies:

```bash
cd frontend
npm install
```

## Run

Run the Vercel-hosted Next.js app locally:

```bash
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), paste a direct stream URL, and click **Start**.

## Deploy

- **GitHub:** https://github.com/BenMacklinn/live-youtube-chyron
- **Vercel (frontend):** https://frontend-gamma-six-12.vercel.app

The production app runs on Vercel with Supabase handling durable state and realtime delivery. The legacy Python backend remains in `backend/` as a local/reference implementation, but the production path uses Next.js route handlers under `frontend/app/api`.

The main start button resolves the current daily HLS URL from `https://newsmax-delta.vercel.app/api/latest-clipper`, so operators do not need to paste the `.m3u8` manually.

Required Vercel environment variables:

| Variable | Example |
|----------|---------|
| `OPENAI_API_KEY` | `sk-...` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xrbbbebtxjekvwkyuloe.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | Supabase secret/service role key |
| `INTERNAL_PROCESS_SECRET` | Random long string used by chained chunk jobs |

Supabase schema migrations live in `supabase/migrations/` and have been applied to the `Live Chyron` project.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | Required |
| `CHYRON_MODEL` | `gpt-5.4-nano` | Faster, lower-cost caption/chyron model |
| `CHYRON_CADENCE_SEC` | `8` | Seconds between chyron batches |
| `CONTEXT_WINDOW_SEC` | `60` | Rolling transcript window (30–90) |
| `TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | OpenAI transcription model |
| `TRANSCRIPTION_CHUNK_SEC` | `6` | Seconds of audio per transcription request |
| `TRANSCRIPTION_OVERLAP_SEC` | `0.75` | Audio overlap between chunks to reduce boundary drops |
| `CHUNKS_PER_RUN` | `3` | Number of chunks processed by each bounded Vercel invocation before chaining |
| `DEFAULT_STREAM_SOURCE_URL` | `https://newsmax-delta.vercel.app/api/latest-clipper` | Resolver endpoint for the daily stream |

## Tests

```bash
cd frontend
npm run lint
npm run build
```

## Architecture

```
Direct stream/media URL → Vercel chunk route → ffmpeg-static WAV chunk → OpenAI gpt-4o-mini-transcribe
                                                                     ↓
                                                          Supabase session context + transcript rows
                                                                     ↓
                                                          Event-aware → gpt-5.4-nano chyron batch
                                                                     ↓
                                                          Supabase Realtime → producer dashboard
```

## API

- `POST /api/sessions` — `{ "mode": "chyron", "contextWindowSec": 60 }` starts the daily stream; pass `youtubeUrl` only to override the default source.
- `POST /api/sessions/{id}/stop` — stop session
- `GET /api/sessions/{id}` — session state
- `POST /api/sessions/{id}/approve` — approve a chyron
- `POST /api/sessions/{id}/reject` — reject a chyron
- `POST /api/sessions/{id}/mode` — switch `chyron` / `verbatim`
- `POST /api/sessions/{id}/clear-context` — reset rolling context

Live updates arrive through Supabase Realtime `session_events` rows.

## Modes

- **Chyron (default)** — AI-generated broadcast chyron suggestions
- **Verbatim** — also shows cleaned subtitle text from each batch
