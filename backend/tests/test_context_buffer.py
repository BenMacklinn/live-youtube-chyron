"""Basic tests for context buffer and session validation logic."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import settings
from context_buffer import ContextBuffer


def test_recent_transcript():
    buf = ContextBuffer(window_sec=60)
    buf.add_segment("a", "Hello world")
    buf.add_segment("b", "Second segment")
    text = buf.recent_transcript()
    assert "Hello world" in text
    assert "Second segment" in text


def test_generation_gate():
    buf = ContextBuffer(window_sec=60)
    assert not buf.has_new_content_since_last_generation()
    buf.add_segment("a", "New speech")
    assert buf.has_new_content_since_last_generation()
    buf.mark_generation_complete()
    assert not buf.has_new_content_since_last_generation()


def test_generation_gate_survives_pruning():
    buf = ContextBuffer(window_sec=1)
    buf.add_segment("a", "Old speech")
    buf.mark_generation_complete()
    buf.segments[0].timestamp = time.time() - 10

    buf.add_segment("b", "Fresh speech")

    assert len(buf.segments) == 1
    assert buf.segments[0].item_id == "b"
    assert buf.has_new_content_since_last_generation()


def test_chyron_memory_persists():
    buf = ContextBuffer(window_sec=60)
    buf.record_chyron("TEST CHYRON", "approved")
    assert buf.recent_approved_chyrons()[0] == "TEST CHYRON"


def test_session_summary_refines():
    buf = ContextBuffer(window_sec=60)
    buf.update_from_generation("Guest discusses AI regulation.", "AI regulation", ["Senator Lee"])
    buf.update_from_generation(
        "Guest discusses AI regulation, then pivots to healthcare costs.",
        "Healthcare costs",
        ["Senator Lee", "CMS"],
    )
    assert "AI regulation" in buf.session_summary
    assert "healthcare" in buf.session_summary.lower()
    assert "Senator Lee" in buf.known_entities
    assert "CMS" in buf.known_entities
    assert len(buf.topic_history) == 2


def test_context_budgets():
    buf = ContextBuffer(window_sec=60)
    long_summary = " ".join(["summary"] * 500)
    buf.update_from_generation(
        long_summary,
        "Topic 0",
        [f"Entity {i}" for i in range(settings.context_entities_limit + 5)],
    )
    for i in range(settings.context_topic_history_limit + 5):
        buf.update_from_generation(buf.session_summary, f"Topic {i}", [])

    assert len(buf.session_summary) <= settings.context_summary_max_chars
    assert len(buf.known_entities) == settings.context_entities_limit
    assert len(buf.topic_history) == settings.context_topic_history_limit

    buf.add_segment("long", " ".join(["transcript"] * 200))
    assert len(buf.recent_transcript(80)) <= 80


def test_clear_context_resets_memory():
    buf = ContextBuffer(window_sec=60)
    buf.add_segment("a", "Guest talks about the economy")
    buf.update_from_generation("Guest discusses the economy.", "Economy", ["Guest"])
    buf.record_chyron("ECONOMY TAKES CENTER STAGE", "approved")
    buf.mark_generation_complete()

    buf.clear_context()

    assert buf.recent_transcript() == ""
    assert buf.session_summary == ""
    assert buf.last_topic == ""
    assert buf.known_entities == []
    assert buf.topic_history == []
    assert buf.recent_approved_chyrons() == []
    assert not buf.has_new_content_since_last_generation()


if __name__ == "__main__":
    test_recent_transcript()
    test_generation_gate()
    test_generation_gate_survives_pruning()
    test_chyron_memory_persists()
    test_session_summary_refines()
    test_context_budgets()
    test_clear_context_resets_memory()
    print("All tests passed")
