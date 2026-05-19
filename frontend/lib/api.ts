export type SessionMode = "chyron" | "verbatim";

export type ChyronOption = {
  id: string;
  text: string;
  rationale: string;
};

export type ChyronSuggestions = {
  batchId: string;
  sessionSummary?: string;
  topic: string;
  entities: string[];
  chyronOptions: ChyronOption[];
  verbatimCaption: string;
};

export type ApprovedLogEntry = {
  text: string;
  timestamp: number;
};

export type UsageStats = {
  audioSeconds: number;
  audioMinutes: number;
  chyronInputTokens: number;
  chyronOutputTokens: number;
  chyronRequests: number;
  transcriptionCostUsd: number;
  chyronCostUsd: number;
  totalCostUsd: number;
  realtimeModel: string;
  transcriptionModel?: string;
  transcriptionPricePerMin?: number;
  chyronModel: string;
};

export type WsMessage =
  | { type: "session.status"; status: string; error?: string }
  | { type: "usage.update"; audioSeconds: number; audioMinutes: number; chyronInputTokens: number; chyronOutputTokens: number; chyronRequests: number; transcriptionCostUsd: number; chyronCostUsd: number; totalCostUsd: number; realtimeModel: string; transcriptionModel?: string; transcriptionPricePerMin?: number; chyronModel: string }
  | { type: "transcript.delta"; itemId: string; delta: string }
  | { type: "transcript.segment"; itemId: string; text: string; timestamp: number }
  | {
      type: "chyron.suggestions";
      batchId: string;
      sessionSummary?: string;
      topic: string;
      entities: string[];
      chyronOptions: ChyronOption[];
      verbatimCaption: string;
      chyronCadenceSec?: number;
      nextBatchAt?: number;
    }
  | { type: "chyron.approved"; text: string; id?: string }
  | { type: "chyron.log"; text: string; timestamp: number }
  | { type: "chyron.rejected"; id: string }
  | { type: "mode.changed"; mode: SessionMode }
  | { type: "context.cleared"; timestamp: number };

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export function parseStartTime(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  const parts = trimmed.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return 0;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60; // bare number = minutes

  return 0;
}

export async function createSession(
  youtubeUrl: string,
  mode: SessionMode,
  contextWindowSec?: number,
  startSec?: number,
) {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtubeUrl, mode, contextWindowSec, startSec: startSec ?? 0 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create session");
  }
  return res.json() as Promise<{ sessionId: string }>;
}

export async function stopSession(sessionId: string) {
  const res = await fetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop session");
}

export function sessionWebSocketUrl(sessionId: string) {
  const wsBase = backendUrl.replace(/^http/, "ws");
  return `${wsBase}/ws/sessions/${sessionId}`;
}
