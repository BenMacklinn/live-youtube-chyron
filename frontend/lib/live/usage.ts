import { BYTES_PER_SAMPLE, liveConfig, SAMPLE_RATE } from "./config";
import type { LiveSessionRow } from "@/lib/supabase/types";

export type UsagePayload = {
  audioSeconds: number;
  audioMinutes: number;
  chyronInputTokens: number;
  chyronOutputTokens: number;
  chyronRequests: number;
  transcriptionCostUsd: number;
  chyronCostUsd: number;
  totalCostUsd: number;
  realtimeModel: string;
  transcriptionModel: string;
  transcriptionPricePerMin: number;
  chyronModel: string;
};

export function audioBytesForSeconds(seconds: number) {
  return Math.round(seconds * SAMPLE_RATE * BYTES_PER_SAMPLE);
}

export function usagePayload(session: LiveSessionRow): UsagePayload {
  const audioSeconds = Number(session.audio_bytes_sent ?? 0) / (SAMPLE_RATE * BYTES_PER_SAMPLE);
  const audioMinutes = audioSeconds / 60;
  const chyronInputTokens = session.chyron_input_tokens ?? 0;
  const chyronOutputTokens = session.chyron_output_tokens ?? 0;
  const transcriptionCostUsd = audioMinutes * liveConfig.transcriptionPricePerMin;
  const chyronCostUsd =
    (chyronInputTokens / 1_000_000) * liveConfig.chyronInputPricePerM +
    (chyronOutputTokens / 1_000_000) * liveConfig.chyronOutputPricePerM;

  return {
    audioSeconds: round(audioSeconds, 1),
    audioMinutes: round(audioMinutes, 3),
    chyronInputTokens,
    chyronOutputTokens,
    chyronRequests: session.chyron_requests ?? 0,
    transcriptionCostUsd: round(transcriptionCostUsd, 4),
    chyronCostUsd: round(chyronCostUsd, 4),
    totalCostUsd: round(transcriptionCostUsd + chyronCostUsd, 4),
    realtimeModel: liveConfig.transcriptionModel,
    transcriptionModel: liveConfig.transcriptionModel,
    transcriptionPricePerMin: liveConfig.transcriptionPricePerMin,
    chyronModel: liveConfig.chyronModel,
  };
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
