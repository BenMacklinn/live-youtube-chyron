from __future__ import annotations

import asyncio
import io
import logging
import re
import uuid
import wave
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from openai import AsyncOpenAI

from config import settings
from youtube_audio import BYTES_PER_SAMPLE, SAMPLE_RATE

logger = logging.getLogger(__name__)


class ChunkedTranscriber:
    def __init__(
        self,
        on_completed: Callable[[str, str], Awaitable[None]] | None = None,
        on_status: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        on_audio_bytes: Callable[[int], Awaitable[None]] | None = None,
    ) -> None:
        self.on_completed = on_completed
        self.on_status = on_status
        self.on_audio_bytes = on_audio_bytes
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._running = False
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None
        self._worker_error: Exception | None = None
        self._last_transcript_text = ""

    async def connect(self) -> None:
        self._running = True
        self._worker_task = asyncio.create_task(self._worker())

    async def stream_audio(self, pcm_chunks: AsyncIterator[bytes]) -> None:
        chunk_sec = max(1, settings.transcription_chunk_sec)
        chunk_bytes = SAMPLE_RATE * BYTES_PER_SAMPLE * chunk_sec
        overlap_bytes = int(SAMPLE_RATE * BYTES_PER_SAMPLE * max(0.0, settings.transcription_overlap_sec))
        overlap_bytes -= overlap_bytes % BYTES_PER_SAMPLE
        overlap_bytes = min(overlap_bytes, chunk_bytes // 2)
        min_final_bytes = SAMPLE_RATE * BYTES_PER_SAMPLE
        pending = bytearray()

        async for chunk in pcm_chunks:
            if not self._running:
                break
            pending.extend(chunk)
            if self.on_audio_bytes:
                await self.on_audio_bytes(len(chunk))

            while len(pending) >= chunk_bytes:
                pcm = bytes(pending[:chunk_bytes])
                retain = overlap_bytes if overlap_bytes > 0 else 0
                del pending[: chunk_bytes - retain]
                await self._queue.put(pcm)
                if self._worker_error:
                    raise self._worker_error

        if self._running and len(pending) >= min_final_bytes:
            await self._queue.put(bytes(pending))

        if self._worker_error:
            raise self._worker_error
        await self._queue.join()
        if self._worker_error:
            raise self._worker_error
        if self._worker_task and not self._worker_task.done():
            await self._queue.put(None)
            await self._worker_task

    async def _worker(self) -> None:
        while True:
            pcm = await self._queue.get()
            try:
                if pcm is None:
                    return
                await self._transcribe_pcm(pcm)
            except Exception as exc:
                self._worker_error = exc
                self._running = False
                self._drain_queue()
                return
            finally:
                self._queue.task_done()

    def _drain_queue(self) -> None:
        while not self._queue.empty():
            self._queue.get_nowait()
            self._queue.task_done()

    async def _transcribe_pcm(self, pcm: bytes) -> None:
        item_id = str(uuid.uuid4())
        wav_bytes = _pcm_to_wav(pcm)

        try:
            transcript = await self._client.audio.transcriptions.create(
                model=settings.transcription_model,
                file=(f"{item_id}.wav", wav_bytes, "audio/wav"),
                response_format="json",
            )
        except Exception as exc:
            logger.exception("Chunk transcription failed")
            if self.on_status:
                await self.on_status("error", {"message": str(exc)})
            raise

        text = getattr(transcript, "text", "")
        deduped = _dedupe_overlap(self._last_transcript_text, text)
        self._last_transcript_text = text.strip()
        if deduped and self.on_completed:
            await self.on_completed(item_id, deduped)

    async def close(self) -> None:
        self._running = False
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass


def _pcm_to_wav(pcm: bytes) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(BYTES_PER_SAMPLE)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm)
    return output.getvalue()


def _dedupe_overlap(previous: str, current: str, max_words: int = 12) -> str:
    current_words = current.strip().split()
    previous_words = previous.strip().split()
    max_overlap = min(max_words, len(previous_words), len(current_words))

    for size in range(max_overlap, 0, -1):
        if _normalize_words(previous_words[-size:]) == _normalize_words(current_words[:size]):
            return " ".join(current_words[size:])
    return current.strip()


def _normalize_words(words: list[str]) -> list[str]:
    return [normalized for word in words if (normalized := re.sub(r"\W+", "", word.lower()))]
