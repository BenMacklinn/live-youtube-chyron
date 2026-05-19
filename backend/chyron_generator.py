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

SYSTEM_PROMPT = """You are a broadcast producer assistant generating live chyron (lower-third) suggestions.

You receive:
1. A persistent session summary (conversation so far — refine it, do not discard prior context)
2. A recent transcript window (last ~60 seconds of speech — for immediacy)
3. Known entities and topic history from earlier in the session

Your job each cycle:
1. REFINE the session summary — merge new speech into the running story. Keep names, topics, and key beats. Do not reset or wipe earlier context.
2. Identify the current main topic or key moment.
3. Generate 3-5 short broadcast-style chyron options in ALL CAPS (<= 60 chars each).
4. Chyrons should reflect the FULL refined session context, weighted toward what is happening NOW in the recent window.
5. Do not repeat recently approved or rejected chyrons.
6. If context is ambiguous, return fewer options rather than inventing facts.
7. Provide a cleaned verbatim caption for the recent window (subtitle mode).
8. Keep the session summary compact. It should be a memory aid, not a transcript.

Respond with valid JSON only:
{
  "sessionSummary": "2-5 sentences refining the full conversation so far",
  "topic": "current main topic",
  "entities": ["names, orgs, key terms"],
  "chyronOptions": [{"text": "string", "rationale": "string"}],
  "verbatimCaption": "string"
}"""


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

        user_prompt = f"""Persistent session summary (refine this — do not wipe prior context):
{self.buffer.session_summary or "None yet — start building from the recent transcript below."}

Recent transcript (last {self.buffer.window_sec}s):
{recent}

Summary budget: keep the next sessionSummary under {settings.context_summary_max_chars} characters.
Topic history: {json.dumps(self.buffer.topic_history)}
Known entities: {json.dumps(self.buffer.known_entities)}
Recent approved chyrons (avoid repeating): {json.dumps(self.buffer.recent_approved_chyrons())}
Recent rejected chyrons (avoid repeating): {json.dumps(self.buffer.recent_rejected_chyrons())}

Mode preference: {self.mode}
"""

        response = await self._client.chat.completions.create(
            model=settings.chyron_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
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
        options = []
        for i, opt in enumerate(parsed.get("chyronOptions", [])[:5]):
            options.append(
                {
                    "id": f"{batch_id}-{i}",
                    "text": str(opt.get("text", ""))[:60].upper(),
                    "rationale": opt.get("rationale", ""),
                }
            )

        session_summary = parsed.get("sessionSummary", "")
        topic = parsed.get("topic", "")
        entities = parsed.get("entities", [])

        self.buffer.update_from_generation(session_summary, topic, entities)
        self.buffer.mark_generation_complete()

        payload = {
            "batchId": batch_id,
            "sessionSummary": self.buffer.session_summary,
            "topic": topic,
            "entities": self.buffer.known_entities,
            "chyronOptions": options,
            "verbatimCaption": parsed.get("verbatimCaption", ""),
            "chyronCadenceSec": settings.chyron_cadence_sec,
            "nextBatchAt": time.time() + settings.chyron_cadence_sec,
        }

        if self.on_suggestions:
            await self.on_suggestions(payload)

        return payload
