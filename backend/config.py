from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    chyron_model: str = "gpt-5.4-mini"
    chyron_cadence_sec: int = 8
    context_window_sec: int = 60
    transcription_model: str = "gpt-4o-mini-transcribe"
    transcription_chunk_sec: int = 6
    transcription_overlap_sec: float = 0.75
    context_summary_max_chars: int = 1200
    context_recent_transcript_max_chars: int = 6000
    context_entities_limit: int = 20
    context_topic_history_limit: int = 6
    context_chyron_memory_limit: int = 20
    realtime_model: str = "gpt-realtime-whisper"
    frontend_url: str = "http://localhost:3000"
    backend_url: str = "http://localhost:8000"
    # USD pricing estimates (override via env if OpenAI changes rates)
    realtime_whisper_price_per_min: float = 0.017
    transcription_price_per_min: float = 0.003
    chyron_input_price_per_m: float = 0.75
    chyron_output_price_per_m: float = 4.50

    def clamped_context_window(self) -> int:
        return max(30, min(90, self.context_window_sec))

    def apply_chyron_model_pricing(self) -> None:
        if "nano" in self.chyron_model:
            self.chyron_input_price_per_m = 0.20
            self.chyron_output_price_per_m = 1.25

    def apply_transcription_model_pricing(self) -> None:
        model = self.transcription_model
        if model == "gpt-4o-mini-transcribe":
            self.transcription_price_per_min = 0.003
        elif model in ("gpt-4o-transcribe", "whisper-1"):
            self.transcription_price_per_min = 0.006
        elif model == "gpt-realtime-whisper":
            self.transcription_price_per_min = self.realtime_whisper_price_per_min


settings = Settings()
settings.apply_chyron_model_pricing()
settings.apply_transcription_model_pricing()
