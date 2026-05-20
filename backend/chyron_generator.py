from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Awaitable, Callable

from openai import AsyncOpenAI

from config import settings
from context_buffer import ContextBuffer
from usage_tracker import UsageTracker

logger = logging.getLogger(__name__)

CHYRON_MAX_CHARS = 39

SYSTEM_PROMPT = f"""You generate live broadcast chyrons (lower-third headlines) from speech transcripts.

Rules:
- Return 3-5 chyron options in ALL CAPS
- Each chyron must be {CHYRON_MAX_CHARS} characters or fewer, including spaces and punctuation
- Headlines should reflect what speakers are discussing right now
- Be specific; use names, places, and facts from the transcript
- Do not repeat chyrons listed as recently approved or rejected
- Do not invent facts not supported by the transcript

Respond with JSON only:
{{
  "sessionSummary": "brief running summary of the conversation",
  "recentSummary": "one plain-language sentence on what they're discussing now",
  "chyronOptions": [{{"text": "ALL CAPS headline"}}],
  "verbatimCaption": "cleaned subtitle text for the recent speech"
}}"""


def _build_user_prompt(buffer: ContextBuffer) -> str:
    recent = buffer.recent_transcript(settings.context_recent_transcript_max_chars)
    parts: list[str] = []

    if buffer.session_summary.strip():
        parts.append(
            "Session summary so far (refine, do not discard prior context):\n"
            f"{buffer.session_summary}"
        )

    parts.append(f"Recent transcript (last {buffer.window_sec}s):\n{recent}")
    parts.append(
        f"Keep sessionSummary under {settings.context_summary_max_chars} characters."
    )

    approved = buffer.recent_approved_chyrons()
    rejected = buffer.recent_rejected_chyrons()
    if approved:
        parts.append(f"Recently approved (do not repeat): {json.dumps(approved)}")
    if rejected:
        parts.append(f"Recently rejected (do not repeat): {json.dumps(rejected)}")

    return "\n\n".join(parts)


def _normalize_option(text: str) -> str:
    cleaned = text.strip().upper()
    if not cleaned or len(cleaned) > CHYRON_MAX_CHARS:
        return cleaned[:CHYRON_MAX_CHARS].strip()
    return cleaned


class ChyronGenerator:
    def __init__(
        self,
        buffer: ContextBuffer,
        mode: str = "chyron",
        on_suggestions: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
        on_usage: Callable[[], Awaitable[None]] | None = None,
        usage: UsageTracker | None = None,
    ) -> None:
        self.buffer = buffer
        self.mode = mode
        self.on_suggestions = on_suggestions
        self.on_usage = on_usage
        self.usage = usage
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._task: asyncio.Task[None] | None = None
        self._pending_request_task: asyncio.Task[None] | None = None
        self._generate_lock = asyncio.Lock()
        self._last_generation_at = 0.0
        self._running = False

    def start(self) -> None:
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._pending_request_task:
            self._pending_request_task.cancel()
            try:
                await self._pending_request_task
            except asyncio.CancelledError:
                pass

    async def _loop(self) -> None:
        while self._running:
            await asyncio.sleep(settings.chyron_cadence_sec)
            if not self._running:
                break
            await self._safe_generate_with_rate_limit()

    async def request_generation(self) -> None:
        if not self._running:
            return
        if self._pending_request_task and not self._pending_request_task.done():
            return
        self._pending_request_task = asyncio.create_task(self._debounced_generate())

    async def _debounced_generate(self) -> None:
        try:
            await asyncio.sleep(0.25)
            await self._safe_generate_with_rate_limit()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Requested chyron generation failed")

    async def _safe_generate_with_rate_limit(self) -> None:
        try:
            await self._generate_with_rate_limit()
        except Exception:
            logger.exception("Chyron generation failed")

    async def _generate_with_rate_limit(self) -> None:
        async with self._generate_lock:
            if not self._running:
                return
            elapsed = time.monotonic() - self._last_generation_at
            wait_sec = settings.chyron_cadence_sec - elapsed
            if self._last_generation_at > 0 and wait_sec > 0:
                await asyncio.sleep(wait_sec)
            if not self._running:
                return
            payload = await self.generate()
            if payload:
                self._last_generation_at = time.monotonic()

    async def generate(self) -> dict[str, Any] | None:
        if not self.buffer.has_new_content_since_last_generation():
            return None

        recent = self.buffer.recent_transcript(settings.context_recent_transcript_max_chars)
        if not recent.strip():
            return None

        response = await self._client.chat.completions.create(
            model=settings.chyron_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(self.buffer)},
            ],
            response_format={"type": "json_object"},
        )

        if self.usage and response.usage:
            self.usage.add_chyron_usage(
                response.usage.prompt_tokens or 0,
                response.usage.completion_tokens or 0,
            )
            if self.on_usage:
                await self.on_usage()

        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)

        batch_id = str(uuid.uuid4())
        skip = {
            text.strip().upper()
            for text in (
                self.buffer.recent_approved_chyrons()
                + self.buffer.recent_rejected_chyrons()
            )
        }
        options = []
        for i, opt in enumerate(parsed.get("chyronOptions", [])[:8]):
            text = _normalize_option(str(opt.get("text", "")))
            if not text or len(text) < 8 or text in skip:
                continue
            options.append(
                {
                    "id": f"{batch_id}-{len(options)}",
                    "text": text,
                    "rationale": opt.get("rationale", ""),
                }
            )
            if len(options) >= 5:
                break

        session_summary = str(parsed.get("sessionSummary", "")).strip()
        self.buffer.update_from_generation(
            session_summary,
            "",
            [],
        )
        self.buffer.mark_generation_complete()

        payload = {
            "batchId": batch_id,
            "sessionSummary": self.buffer.session_summary,
            "topic": "",
            "entities": [],
            "chyronOptions": options,
            "verbatimCaption": parsed.get("verbatimCaption", ""),
            "recentSummary": parsed.get("recentSummary", ""),
            "chyronCadenceSec": settings.chyron_cadence_sec,
            "nextBatchAt": time.time() + settings.chyron_cadence_sec,
        }

        if self.on_suggestions:
            await self.on_suggestions(payload)

        return payload
