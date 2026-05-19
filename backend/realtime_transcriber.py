from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection

from config import settings

logger = logging.getLogger(__name__)

REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
# Commit ~2s of 24kHz mono PCM16 when VAD is disabled for gpt-realtime-whisper.
COMMIT_INTERVAL_SEC = 2.0
BYTES_PER_COMMIT = int(24000 * 2 * COMMIT_INTERVAL_SEC)


class RealtimeTranscriber:
    def __init__(
        self,
        on_delta: Callable[[str, str], Awaitable[None]] | None = None,
        on_completed: Callable[[str, str], Awaitable[None]] | None = None,
        on_status: Callable[[str, dict[str, Any]], Awaitable[None]] | None = None,
        on_audio_bytes: Callable[[int], Awaitable[None]] | None = None,
    ) -> None:
        self.on_delta = on_delta
        self.on_completed = on_completed
        self.on_status = on_status
        self.on_audio_bytes = on_audio_bytes
        self._ws: ClientConnection | None = None
        self._receive_task: asyncio.Task[None] | None = None
        self._running = False

    async def connect(self) -> None:
        # GA Realtime transcription — use intent=transcription, no beta header, no ?model=.
        headers = {
            "Authorization": f"Bearer {settings.openai_api_key}",
        }
        self._ws = await websockets.connect(
            REALTIME_URL,
            additional_headers=headers,
        )
        await self._configure_session()
        self._running = True
        self._receive_task = asyncio.create_task(self._receive_loop())

    async def _configure_session(self) -> None:
        assert self._ws is not None
        await self._ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "type": "transcription",
                        "audio": {
                            "input": {
                                "format": {"type": "audio/pcm", "rate": 24000},
                                "transcription": {
                                    "model": settings.realtime_model,
                                    "language": "en",
                                    "delay": "low",
                                },
                                # gpt-realtime-whisper requires manual commits (no server VAD).
                                "turn_detection": None,
                            }
                        },
                    },
                }
            )
        )

    async def stream_audio(self, pcm_chunks: AsyncIterator[bytes]) -> None:
        assert self._ws is not None
        pending = 0
        async for chunk in pcm_chunks:
            if not self._running:
                break
            encoded = base64.b64encode(chunk).decode("ascii")
            await self._ws.send(
                json.dumps({"type": "input_audio_buffer.append", "audio": encoded})
            )
            pending += len(chunk)
            if self.on_audio_bytes:
                await self.on_audio_bytes(len(chunk))
            if pending >= BYTES_PER_COMMIT:
                await self._ws.send(json.dumps({"type": "input_audio_buffer.commit"}))
                pending = 0

        if pending > 0 and self._running:
            await self._ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

    async def _receive_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                event = json.loads(raw)
                await self._handle_event(event)
        except websockets.ConnectionClosed as exc:
            reason = exc.reason or "connection closed"
            logger.warning("Realtime connection closed: %s %s", exc.code, reason)
            if self.on_status:
                await self.on_status(
                    "realtime_disconnected",
                    {"code": exc.code, "reason": reason, "message": reason},
                )
        finally:
            self._running = False

    async def _handle_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("type", "")

        if event_type == "conversation.item.input_audio_transcription.delta":
            if self.on_delta:
                await self.on_delta(event.get("item_id", ""), event.get("delta", ""))
        elif event_type == "conversation.item.input_audio_transcription.completed":
            if self.on_completed:
                await self.on_completed(event.get("item_id", ""), event.get("transcript", ""))
        elif event_type == "error":
            error = event.get("error", {})
            logger.error("Realtime API error: %s", error)
            if self.on_status:
                await self.on_status("error", error)
        elif event_type in ("session.created", "session.updated"):
            if self.on_status:
                await self.on_status(event_type, {})

    async def close(self) -> None:
        self._running = False
        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
        if self._ws:
            await self._ws.close()
            self._ws = None
