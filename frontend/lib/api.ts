export type SessionMode = "chyron" | "verbatim";
export type ChyronGenerationMode = "guest" | "timeline";
export type AudioSourceMode = "stream" | "microphone";

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
  recentSummary?: string;
  chyronCadenceSec?: number;
  nextBatchAt?: number;
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

export type LiveMessage =
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
      recentSummary?: string;
      chyronCadenceSec?: number;
      nextBatchAt?: number;
    }
  | { type: "chyron.approved"; text: string; id?: string }
  | { type: "chyron.log"; text: string; timestamp: number }
  | { type: "chyron.rejected"; id: string }
  | { type: "mode.changed"; mode: SessionMode }
  | { type: "generation_mode.changed"; generationMode: ChyronGenerationMode; timestamp: number }
  | { type: "context.cleared"; timestamp: number }
  | { type: "guidance.updated"; guestName: string; guestCompany: string; timestamp: number };

export type SessionSnapshot = {
  sessionId: string;
  status: string;
  mode: SessionMode;
  generationMode: ChyronGenerationMode;
  startSec: number;
  youtubeUrl: string;
  activeChyron: string;
  approvedLog: ApprovedLogEntry[];
  segments: string[];
  latestSuggestions: ChyronSuggestions | null;
  latestVerbatim: string;
  guestName: string;
  guestCompany: string;
  usage: UsageStats | null;
  error: string | null;
};

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
  contextWindowSec?: number,
  startSec?: number,
  generationMode: ChyronGenerationMode = "timeline",
  sourceMode: AudioSourceMode = "stream",
) {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      youtubeUrl,
      contextWindowSec,
      startSec: startSec ?? 0,
      generationMode,
      sourceMode,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to create session");
  }
  return res.json() as Promise<{ sessionId: string }>;
}

export async function uploadMicrophoneChunk(sessionId: string, audio: Blob, durationSec: number) {
  const res = await fetch(`/api/sessions/${sessionId}/microphone`, {
    method: "POST",
    headers: {
      "Content-Type": audio.type || "audio/webm",
      "X-Duration-Sec": String(durationSec),
    },
    body: audio,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Failed to process microphone audio");
  }
}

export async function stopSession(sessionId: string) {
  const res = await fetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to stop session");
}

export async function getSessionSnapshot(sessionId: string) {
  const res = await fetch(`/api/sessions/${sessionId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load session");
  return res.json() as Promise<SessionSnapshot>;
}

export async function approveChyron(sessionId: string, id: string, text: string) {
  await postSessionAction(sessionId, "approve", { id, text });
}

export async function rejectChyron(sessionId: string, id: string, text: string) {
  await postSessionAction(sessionId, "reject", { id, text });
}

export async function setSessionMode(sessionId: string, mode: SessionMode) {
  await postSessionAction(sessionId, "mode", { mode });
}

export async function setChyronGenerationMode(sessionId: string, generationMode: ChyronGenerationMode) {
  await postSessionAction(sessionId, "generation-mode", { generationMode });
}

export async function clearSessionContext(sessionId: string) {
  await postSessionAction(sessionId, "clear-context", {});
}

export async function setGuestContext(sessionId: string, name: string, company: string) {
  await postSessionAction(sessionId, "guidance", { name, company });
}

async function postSessionAction(sessionId: string, action: string, payload: object) {
  const res = await fetch(`/api/sessions/${sessionId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Failed to ${action}`);
  }
}
