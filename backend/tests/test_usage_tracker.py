"""Usage and cost estimation tests."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from usage_tracker import UsageTracker


def test_audio_cost():
    usage = UsageTracker()
    # 60 seconds of PCM16 @ 24kHz mono = 48000 * 60 * 2 bytes... wait 24000 samples/sec * 2 bytes = 48000 bytes/sec
    usage.add_audio_bytes(48000 * 60)
    assert round(usage.audio_seconds) == 60
    assert usage.transcription_cost_usd() > 0


def test_chyron_token_cost():
    usage = UsageTracker()
    usage.add_chyron_usage(1000, 500)
    assert usage.chyron_input_tokens == 1000
    assert usage.chyron_output_tokens == 500
    assert usage.total_cost_usd() == usage.chyron_cost_usd()


if __name__ == "__main__":
    test_audio_cost()
    test_chyron_token_cost()
    print("All usage tests passed")
