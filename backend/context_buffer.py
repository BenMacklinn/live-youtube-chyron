from __future__ import annotations

import time
from dataclasses import dataclass, field

from config import settings


@dataclass
class TranscriptSegment:
    item_id: str
    text: str
    timestamp: float


@dataclass
class ChyronMemory:
    text: str
    action: str  # approved | rejected
    timestamp: float


@dataclass
class ContextBuffer:
    window_sec: int = 60
    segments: list[TranscriptSegment] = field(default_factory=list)
    chyron_memory: list[ChyronMemory] = field(default_factory=list)
    session_summary: str = ""
    last_topic: str = ""
    known_entities: list[str] = field(default_factory=list)
    topic_history: list[str] = field(default_factory=list)
    _version: int = 0
    _last_generation_version: int = 0

    def add_segment(self, item_id: str, text: str) -> None:
        cleaned = text.strip()
        if not cleaned:
            return
        self.segments.append(TranscriptSegment(item_id=item_id, text=cleaned, timestamp=time.time()))
        self._version += 1
        self._prune_segments()

    def _prune_segments(self) -> None:
        cutoff = time.time() - self.window_sec
        self.segments = [s for s in self.segments if s.timestamp >= cutoff]

    def recent_transcript(self, max_chars: int | None = None) -> str:
        self._prune_segments()
        transcript = " ".join(s.text for s in self.segments)
        return _tail_chars(transcript, max_chars or settings.context_recent_transcript_max_chars)

    def has_new_content_since_last_generation(self) -> bool:
        return self._version > self._last_generation_version

    def mark_generation_complete(self) -> None:
        self._last_generation_version = self._version

    def record_chyron(self, text: str, action: str) -> None:
        self.chyron_memory.append(ChyronMemory(text=text, action=action, timestamp=time.time()))
        self.chyron_memory = self.chyron_memory[-settings.context_chyron_memory_limit :]

    def recent_approved_chyrons(self, limit: int = 8) -> list[str]:
        return [c.text for c in reversed(self.chyron_memory) if c.action == "approved"][:limit]

    def recent_rejected_chyrons(self, limit: int = 5) -> list[str]:
        return [c.text for c in reversed(self.chyron_memory) if c.action == "rejected"][:limit]

    def update_from_generation(
        self,
        session_summary: str,
        topic: str,
        entities: list[str],
    ) -> None:
        if session_summary.strip():
            self.session_summary = _head_chars(session_summary.strip(), settings.context_summary_max_chars)
        if topic.strip():
            self.last_topic = topic.strip()
            if not self.topic_history or self.topic_history[-1] != topic.strip():
                self.topic_history.append(topic.strip())
                self.topic_history = self.topic_history[-settings.context_topic_history_limit :]
        for entity in entities:
            cleaned = str(entity).strip()
            if cleaned and cleaned not in self.known_entities:
                self.known_entities.append(cleaned)
        self.known_entities = self.known_entities[-settings.context_entities_limit :]

    def clear_context(self) -> None:
        self.segments.clear()
        self.chyron_memory.clear()
        self.session_summary = ""
        self.last_topic = ""
        self.known_entities.clear()
        self.topic_history.clear()
        self._version += 1
        self.mark_generation_complete()


def _head_chars(value: str, max_chars: int) -> str:
    if max_chars <= 0 or len(value) <= max_chars:
        return value
    return value[:max_chars].rsplit(" ", 1)[0].rstrip()


def _tail_chars(value: str, max_chars: int) -> str:
    if max_chars <= 0 or len(value) <= max_chars:
        return value
    return value[-max_chars:].split(" ", 1)[-1].lstrip()
