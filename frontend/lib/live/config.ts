export const SAMPLE_RATE = 24_000;
export const BYTES_PER_SAMPLE = 2;

export const liveConfig = {
  transcriptionModel: process.env.TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
  transcriptionChunkSec: numberFromEnv("TRANSCRIPTION_CHUNK_SEC", 6),
  transcriptionOverlapSec: numberFromEnv("TRANSCRIPTION_OVERLAP_SEC", 0.75),
  chyronModel: process.env.CHYRON_MODEL || "gpt-5.4-nano",
  chyronCadenceSec: numberFromEnv("CHYRON_CADENCE_SEC", 8),
  contextWindowSec: numberFromEnv("CONTEXT_WINDOW_SEC", 60),
  contextSummaryMaxChars: numberFromEnv("CONTEXT_SUMMARY_MAX_CHARS", 1200),
  contextRecentTranscriptMaxChars: numberFromEnv("CONTEXT_RECENT_TRANSCRIPT_MAX_CHARS", 6000),
  contextEntitiesLimit: numberFromEnv("CONTEXT_ENTITIES_LIMIT", 20),
  contextTopicHistoryLimit: numberFromEnv("CONTEXT_TOPIC_HISTORY_LIMIT", 6),
  contextChyronMemoryLimit: numberFromEnv("CONTEXT_CHYRON_MEMORY_LIMIT", 20),
  transcriptionPricePerMin: numberFromEnv("TRANSCRIPTION_PRICE_PER_MIN", 0.003),
  chyronInputPricePerM: numberFromEnv("CHYRON_INPUT_PRICE_PER_M", process.env.CHYRON_MODEL?.includes("nano") ? 0.2 : 0.75),
  chyronOutputPricePerM: numberFromEnv("CHYRON_OUTPUT_PRICE_PER_M", process.env.CHYRON_MODEL?.includes("nano") ? 1.25 : 4.5),
  chunksPerRun: numberFromEnv("CHUNKS_PER_RUN", 3),
  hlsLiveLagSegments: numberFromEnv("HLS_LIVE_LAG_SEGMENTS", 2),
  hlsPollSec: numberFromEnv("HLS_POLL_SEC", 3),
  hlsRunBudgetSec: numberFromEnv("HLS_RUN_BUDGET_SEC", 240),
};

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
