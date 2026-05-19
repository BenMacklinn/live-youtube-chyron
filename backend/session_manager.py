from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from chyron_generator import ChyronGenerator
from chunked_transcriber import ChunkedTranscriber
from config import settings
from context_buffer import ContextBuffer
from usage_tracker import UsageTracker
from youtube_audio import stream_youtube_pcm

logger = logging.getLogger(__name__)


class SessionStatus(str, Enum):
    CONNECTING = "connecting"
    TRANSCRIBING = "transcribing"
    ERROR = "error"
    ENDED = "ended"


@dataclass
class ApprovedEntry:
    text: str
    timestamp: float


@dataclass
class LiveSession:
    session_id: str
    youtube_url: str
    start_sec: int = 0
    mode: str = "chyron"
    context_window_sec: int = 60
    status: SessionStatus = SessionStatus.CONNECTING
    error: str | None = None
    partial_transcript: str = ""
    active_chyron: str = ""
    approved_log: list[ApprovedEntry] = field(default_factory=list)
    latest_suggestions: dict[str, Any] | None = None
    latest_verbatim: str = ""
    subscribers: set[Any] = field(default_factory=set)
    buffer: ContextBuffer = field(default_factory=lambda: ContextBuffer(window_sec=60))
    usage: UsageTracker = field(default_factory=UsageTracker)
    _last_usage_broadcast: float = 0.0
    _pipeline_task: asyncio.Task[None] | None = None
    _transcriber: ChunkedTranscriber | None = None
    _chyron_gen: ChyronGenerator | None = None

    def __post_init__(self) -> None:
        self.buffer.window_sec = self.context_window_sec

    async def broadcast_usage(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_usage_broadcast < 1.0:
            return
        self._last_usage_broadcast = now
        await self.broadcast({"type": "usage.update", **self.usage.to_payload()})

    async def broadcast(self, message: dict[str, Any]) -> None:
        dead: list[Any] = []
        for ws in list(self.subscribers):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.subscribers.discard(ws)


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, LiveSession] = {}

    def create(
        self,
        youtube_url: str,
        mode: str = "chyron",
        context_window_sec: int | None = None,
        start_sec: int = 0,
    ) -> LiveSession:
        session_id = str(uuid.uuid4())
        window = context_window_sec or settings.clamped_context_window()
        session = LiveSession(
            session_id=session_id,
            youtube_url=youtube_url,
            start_sec=max(0, start_sec),
            mode=mode,
            context_window_sec=max(30, min(90, window)),
        )
        self._sessions[session_id] = session
        session._pipeline_task = asyncio.create_task(self._run_pipeline(session))
        return session

    def get(self, session_id: str) -> LiveSession | None:
        return self._sessions.get(session_id)

    async def stop(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if not session:
            return
        await self._shutdown_session(session)

    async def _shutdown_session(self, session: LiveSession) -> None:
        session.status = SessionStatus.ENDED
        if session._chyron_gen:
            await session._chyron_gen.stop()
        if session._transcriber:
            await session._transcriber.close()
        if session._pipeline_task:
            session._pipeline_task.cancel()
            try:
                await session._pipeline_task
            except asyncio.CancelledError:
                pass
        await session.broadcast({"type": "session.status", "status": session.status.value})

    async def _run_pipeline(self, session: LiveSession) -> None:
        try:
            await session.broadcast({"type": "session.status", "status": SessionStatus.CONNECTING.value})

            async def on_completed(item_id: str, transcript: str) -> None:
                session.partial_transcript = ""
                session.buffer.add_segment(item_id, transcript)
                await session.broadcast(
                    {
                        "type": "transcript.segment",
                        "itemId": item_id,
                        "text": transcript,
                        "timestamp": time.time(),
                    }
                )
                if session._chyron_gen:
                    await session._chyron_gen.request_generation()

            async def on_status(status: str, detail: dict[str, Any]) -> None:
                if status in ("error", "realtime_disconnected"):
                    session.status = SessionStatus.ERROR
                    session.error = (
                        detail.get("message")
                        or detail.get("reason")
                        or detail.get("code")
                        or str(detail)
                    )
                    await session.broadcast(
                        {"type": "session.status", "status": session.status.value, "error": session.error}
                    )

            async def on_suggestions(payload: dict[str, Any]) -> None:
                session.latest_suggestions = payload
                session.latest_verbatim = payload.get("verbatimCaption", "")
                await session.broadcast({"type": "chyron.suggestions", **payload})

            async def on_audio_bytes(nbytes: int) -> None:
                session.usage.add_audio_bytes(nbytes)
                await session.broadcast_usage()

            async def on_usage() -> None:
                await session.broadcast_usage(force=True)

            session._transcriber = ChunkedTranscriber(
                on_completed=on_completed,
                on_status=on_status,
                on_audio_bytes=on_audio_bytes,
            )
            session._chyron_gen = ChyronGenerator(
                buffer=session.buffer,
                mode=session.mode,
                on_suggestions=on_suggestions,
                on_usage=on_usage,
                usage=session.usage,
            )

            await session._transcriber.connect()
            session._chyron_gen.start()
            session.status = SessionStatus.TRANSCRIBING
            await session.broadcast({"type": "session.status", "status": session.status.value})

            await session._transcriber.stream_audio(
                stream_youtube_pcm(session.youtube_url, start_sec=session.start_sec)
            )
            session.status = SessionStatus.ENDED
            await session.broadcast_usage(force=True)
            await session.broadcast({"type": "session.status", "status": session.status.value})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Pipeline failed for session %s", session.session_id)
            session.status = SessionStatus.ERROR
            session.error = str(exc)
            await session.broadcast(
                {"type": "session.status", "status": session.status.value, "error": session.error}
            )
        finally:
            if session._chyron_gen:
                await session._chyron_gen.stop()
            if session._transcriber:
                await session._transcriber.close()

    def approve_chyron(self, session_id: str, chyron_id: str, text: str) -> None:
        session = self._require(session_id)
        session.active_chyron = text
        session.approved_log.append(ApprovedEntry(text=text, timestamp=time.time()))
        session.buffer.record_chyron(text, "approved")

    def reject_chyron(self, session_id: str, chyron_id: str, text: str = "") -> None:
        session = self._require(session_id)
        if text:
            session.buffer.record_chyron(text, "rejected")

    def set_mode(self, session_id: str, mode: str) -> None:
        session = self._require(session_id)
        session.mode = mode
        if session._chyron_gen:
            session._chyron_gen.mode = mode

    def clear_context(self, session_id: str) -> None:
        session = self._require(session_id)
        session.partial_transcript = ""
        session.latest_suggestions = None
        session.latest_verbatim = ""
        session.buffer.clear_context()

    def _require(self, session_id: str) -> LiveSession:
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"Session not found: {session_id}")
        return session


session_manager = SessionManager()
