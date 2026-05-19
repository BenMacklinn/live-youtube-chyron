from __future__ import annotations

import asyncio
import shutil
import subprocess
import sys
from collections.abc import AsyncIterator


SAMPLE_RATE = 24000
BYTES_PER_SAMPLE = 2
CHUNK_DURATION_MS = 100
CHUNK_SIZE = int(SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_DURATION_MS / 1000)

YTDLP_CMD = [sys.executable, "-m", "yt_dlp"]


def _require_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("Required binary not found on PATH: ffmpeg")


def _run_ytdlp(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [*YTDLP_CMD, *args],
        capture_output=True,
        text=True,
        check=False,
    )


def _resolve_audio_url(url: str) -> str:
    result = _run_ytdlp(["-f", "bestaudio/best", "-g", "--no-warnings", "--no-playlist", url])
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "unknown yt-dlp error").strip()
        raise RuntimeError(f"yt-dlp failed: {detail}")

    line = result.stdout.strip().split("\n")[0]
    if not line.startswith("http"):
        raise RuntimeError("Could not resolve YouTube audio URL")
    return line


async def stream_youtube_pcm(url: str, start_sec: int = 0) -> AsyncIterator[bytes]:
    """Stream 24kHz mono PCM16 from a YouTube URL via yt-dlp and ffmpeg."""
    _require_ffmpeg()

    loop = asyncio.get_event_loop()
    audio_url = await loop.run_in_executor(None, _resolve_audio_url, url)

    ffmpeg_cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
    ]
    if start_sec > 0:
        ffmpeg_cmd.extend(["-ss", str(start_sec)])
    ffmpeg_cmd.extend(
        [
            "-i",
            audio_url,
            "-f",
            "s16le",
            "-ar",
            str(SAMPLE_RATE),
            "-ac",
            "1",
            "pipe:1",
        ]
    )

    ffmpeg = subprocess.Popen(
        ffmpeg_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert ffmpeg.stdout is not None

    try:
        while True:
            chunk = await loop.run_in_executor(None, ffmpeg.stdout.read, CHUNK_SIZE)
            if not chunk:
                break
            yield chunk
    finally:
        if ffmpeg.poll() is None:
            ffmpeg.terminate()
            try:
                ffmpeg.wait(timeout=3)
            except subprocess.TimeoutExpired:
                ffmpeg.kill()
