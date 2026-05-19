"""Tests for chyron generation timing controls."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chyron_generator import ChyronGenerator
from context_buffer import ContextBuffer


def test_request_generation_runs_after_transcript_event():
    asyncio.run(_test_request_generation_runs_after_transcript_event())


async def _test_request_generation_runs_after_transcript_event():
    calls = 0
    buffer = ContextBuffer(window_sec=60)
    generator = ChyronGenerator.__new__(ChyronGenerator)
    generator.buffer = buffer
    generator._task = None
    generator._pending_request_task = None
    generator._generate_lock = asyncio.Lock()
    generator._last_generation_at = 0.0
    generator._running = True

    async def fake_generate():
        nonlocal calls
        calls += 1
        return {"batchId": "test"}

    generator.generate = fake_generate  # type: ignore[method-assign]
    generator._running = True

    await generator.request_generation()
    await asyncio.sleep(0.3)

    assert calls == 1


if __name__ == "__main__":
    test_request_generation_runs_after_transcript_event()
    print("All chyron generator tests passed")
