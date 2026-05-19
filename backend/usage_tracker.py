from __future__ import annotations

from dataclasses import dataclass

from config import settings

SAMPLE_RATE = 24000
BYTES_PER_SAMPLE = 2


@dataclass
class UsageTracker:
    audio_bytes_sent: int = 0
    chyron_input_tokens: int = 0
    chyron_output_tokens: int = 0
    chyron_requests: int = 0

    def add_audio_bytes(self, nbytes: int) -> None:
        self.audio_bytes_sent += nbytes

    @property
    def audio_seconds(self) -> float:
        return self.audio_bytes_sent / (SAMPLE_RATE * BYTES_PER_SAMPLE)

    @property
    def audio_minutes(self) -> float:
        return self.audio_seconds / 60.0

    def add_chyron_usage(self, input_tokens: int, output_tokens: int) -> None:
        self.chyron_input_tokens += input_tokens
        self.chyron_output_tokens += output_tokens
        self.chyron_requests += 1

    def transcription_cost_usd(self) -> float:
        return self.audio_minutes * settings.transcription_price_per_min

    def chyron_cost_usd(self) -> float:
        input_cost = (self.chyron_input_tokens / 1_000_000) * settings.chyron_input_price_per_m
        output_cost = (self.chyron_output_tokens / 1_000_000) * settings.chyron_output_price_per_m
        return input_cost + output_cost

    def total_cost_usd(self) -> float:
        return self.transcription_cost_usd() + self.chyron_cost_usd()

    def to_payload(self) -> dict:
        return {
            "audioSeconds": round(self.audio_seconds, 1),
            "audioMinutes": round(self.audio_minutes, 3),
            "chyronInputTokens": self.chyron_input_tokens,
            "chyronOutputTokens": self.chyron_output_tokens,
            "chyronRequests": self.chyron_requests,
            "transcriptionCostUsd": round(self.transcription_cost_usd(), 4),
            "chyronCostUsd": round(self.chyron_cost_usd(), 4),
            "totalCostUsd": round(self.total_cost_usd(), 4),
            "realtimeModel": settings.transcription_model,
            "transcriptionModel": settings.transcription_model,
            "transcriptionPricePerMin": settings.transcription_price_per_min,
            "chyronModel": settings.chyron_model,
        }
