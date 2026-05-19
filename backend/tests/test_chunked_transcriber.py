"""Tests for chunked transcription helpers."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chunked_transcriber import _dedupe_overlap


def test_dedupe_overlap_removes_repeated_boundary_words():
    previous = "The mayor said the new transit plan"
    current = "new transit plan will begin next month"

    assert _dedupe_overlap(previous, current) == "will begin next month"


def test_dedupe_overlap_keeps_distinct_text():
    previous = "The mayor discussed transit"
    current = "A council member responded on housing"

    assert _dedupe_overlap(previous, current) == current


if __name__ == "__main__":
    test_dedupe_overlap_removes_repeated_boundary_words()
    test_dedupe_overlap_keeps_distinct_text()
    print("All chunked transcriber tests passed")
