import "server-only";

import { spawn } from "node:child_process";
import OpenAI, { toFile } from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LiveSessionRow } from "@/lib/supabase/types";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { liveConfig } from "./config";
import { publishSessionEvent } from "./events";
import { getFfmpegBinaryPath } from "./ffmpeg-binary";
import { loadHlsPlaylist, type HlsSegment } from "./hls-playlist";
import { isMicrophoneSourceUrl, resolveStreamInputUrl, streamSourceKind, type StreamSourceKind } from "./stream-source";
import {
  buildChyronOptionRows,
  buildChyronPrompt,
  parseChyronResponse,
  shouldGenerateChyrons,
  trimChyronFields,
} from "./chyron";
import { dedupeOverlap, tailChars } from "./text";
import { audioBytesForSeconds, usagePayload } from "./usage";

type ProcessResult = {
  shouldContinue: boolean;
  nextDelayMs?: number;
};

const LIVE_CHAIN_DELAY_MS = Math.max(1000, liveConfig.transcriptionChunkSec * 1000);
const HLS_POLL_DELAY_MS = Math.max(1000, liveConfig.hlsPollSec * 1000);
const HLS_RUN_BUDGET_MS = Math.max(15_000, liveConfig.hlsRunBudgetSec * 1000);

type ChunkResult = {
  sourceKind: StreamSourceKind;
  didWork: boolean;
  finished?: boolean;
};

export async function processSessionRun(sessionId: string): Promise<ProcessResult> {
  const supabase = createServiceSupabaseClient();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const firstSession = await loadSessionForProcessing(supabase, sessionId);
    if (!firstSession || firstSession.status === "ended" || firstSession.status === "error") {
      return { shouldContinue: false };
    }
    if (isMicrophoneSourceUrl(firstSession.youtube_url)) {
      return { shouldContinue: false };
    }

    if (streamSourceKind(resolveStreamInputUrl(firstSession.youtube_url)) === "hls") {
      return processHlsSessionRun(supabase, openai, firstSession);
    }

    for (let i = 0; i < liveConfig.chunksPerRun; i += 1) {
      const session = i === 0 ? firstSession : await loadSessionForProcessing(supabase, sessionId);
      if (!session || session.status === "ended" || session.status === "error") {
        return { shouldContinue: false };
      }

      await ensureTranscribing(supabase, session);
      await processOneChunk(supabase, openai, session);
    }

    const latest = await loadSessionForProcessing(supabase, sessionId);
    const shouldContinue = latest?.status === "transcribing" || latest?.status === "connecting";
    return { shouldContinue, nextDelayMs: shouldContinue ? LIVE_CHAIN_DELAY_MS : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown processing error";
    const updated = await updateSession(supabase, sessionId, { status: "error", error: message });
    await publishSessionEvent(supabase, sessionId, "session.status", {
      type: "session.status",
      status: updated.status,
      error: updated.error,
    });
    return { shouldContinue: false };
  }
}

export async function processUploadedAudioChunk(
  sessionId: string,
  audio: Buffer,
  contentType: string,
  durationSec: number,
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const supabase = createServiceSupabaseClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const session = await loadSessionForProcessing(supabase, sessionId);
  if (!session || session.status === "ended" || session.status === "error") {
    return { status: "ignored" };
  }
  if (!isMicrophoneSourceUrl(session.youtube_url)) {
    throw new Error("Session is not configured for microphone input");
  }

  await ensureTranscribing(supabase, session);

  const offsetSec = Number(session.next_offset_sec || 0);
  const safeDurationSec = Math.max(1, Math.min(30, durationSec || liveConfig.transcriptionChunkSec));
  const transcriptText = await transcribeUploadedChunk(openai, audio, contentType, session.id);
  const deduped = dedupeOverlap(session.last_transcript_text, transcriptText);
  const sessionPatch: Partial<LiveSessionRow> = {
    next_offset_sec: offsetSec + safeDurationSec,
    audio_bytes_sent: Number(session.audio_bytes_sent ?? 0) + audioBytesForSeconds(safeDurationSec),
    last_transcript_text: transcriptText.trim(),
  };

  await commitTranscriptChunk(supabase, openai, session, sessionPatch, deduped, offsetSec);
  return { status: "processed", text: deduped };
}

async function processOneChunk(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  session: LiveSessionRow,
): Promise<ChunkResult> {
  const audioUrl = resolveStreamInputUrl(session.youtube_url);
  const sourceKind = streamSourceKind(audioUrl);
  if (sourceKind === "hls") {
    return processHlsSegment(supabase, openai, session, audioUrl);
  }

  const offsetSec = Number(session.next_offset_sec || session.start_sec || 0);
  const durationSec = liveConfig.transcriptionChunkSec + Math.max(0, liveConfig.transcriptionOverlapSec);
  const wav = await extractWavChunk(audioUrl, offsetSec, durationSec);
  const transcriptText = await transcribeChunk(openai, wav, session.id);
  const deduped = dedupeOverlap(session.last_transcript_text, transcriptText);
  const nextOffset = offsetSec + liveConfig.transcriptionChunkSec;

  const sessionPatch: Partial<LiveSessionRow> = {
    next_offset_sec: nextOffset,
    audio_bytes_sent: Number(session.audio_bytes_sent ?? 0) + audioBytesForSeconds(liveConfig.transcriptionChunkSec),
    last_transcript_text: transcriptText.trim(),
  };

  await commitTranscriptChunk(supabase, openai, session, sessionPatch, deduped, offsetSec);
  return { sourceKind, didWork: true };
}

async function processHlsSessionRun(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  firstSession: LiveSessionRow,
): Promise<ProcessResult> {
  const deadline = Date.now() + HLS_RUN_BUDGET_MS;
  let session: LiveSessionRow | null = firstSession;

  while (Date.now() < deadline) {
    if (!session || session.status === "ended" || session.status === "error") {
      return { shouldContinue: false };
    }

    await ensureTranscribing(supabase, session);
    const result = await processHlsSegment(supabase, openai, session, resolveStreamInputUrl(session.youtube_url));

    if (result.finished) {
      const updated = await updateSession(supabase, session.id, { status: "ended" });
      await publishSessionEvent(supabase, session.id, "session.status", {
        type: "session.status",
        status: updated.status,
        error: updated.error,
      });
      return { shouldContinue: false };
    }

    if (!result.didWork) {
      await delay(HLS_POLL_DELAY_MS);
    }

    session = await loadSessionForProcessing(supabase, firstSession.id);
  }

  const latest = await loadSessionForProcessing(supabase, firstSession.id);
  const shouldContinue = latest?.status === "transcribing" || latest?.status === "connecting";
  return { shouldContinue };
}

async function ensureTranscribing(supabase: SupabaseClient<Database>, session: LiveSessionRow) {
  if (session.status !== "connecting") return;

  const updated = await updateSession(supabase, session.id, { status: "transcribing", error: null });
  await publishSessionEvent(supabase, session.id, "session.status", {
    type: "session.status",
    status: updated.status,
    error: updated.error,
  });
}

async function processHlsSegment(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  session: LiveSessionRow,
  playlistUrl: string,
): Promise<ChunkResult> {
  const playlist = await loadHlsPlaylist(playlistUrl);
  const segment = selectNextHlsSegment(playlist.segments, Number(session.next_offset_sec || 0), playlist.ended);

  if (!segment) {
    return { sourceKind: "hls", didWork: false, finished: playlist.ended };
  }

  const wav = await extractWavChunk(segment.url, 0, segment.durationSec);
  const transcriptText = await transcribeChunk(openai, wav, session.id);
  const deduped = dedupeOverlap(session.last_transcript_text, transcriptText);
  const sessionPatch: Partial<LiveSessionRow> = {
    next_offset_sec: segment.sequence + 1,
    audio_bytes_sent: Number(session.audio_bytes_sent ?? 0) + audioBytesForSeconds(segment.durationSec),
    last_transcript_text: transcriptText.trim(),
  };

  await commitTranscriptChunk(supabase, openai, session, sessionPatch, deduped, segment.sequence);
  return { sourceKind: "hls", didWork: true };
}

function selectNextHlsSegment(segments: HlsSegment[], nextSequence: number, ended: boolean): HlsSegment | null {
  if (segments.length === 0) return null;

  if (nextSequence > 0) {
    return segments.find((segment) => segment.sequence >= nextSequence) ?? null;
  }

  if (ended) return segments[0];

  const startIndex = Math.max(0, segments.length - liveConfig.hlsLiveLagSegments - 1);
  return segments[startIndex];
}

async function commitTranscriptChunk(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  session: LiveSessionRow,
  sessionPatch: Partial<LiveSessionRow>,
  deduped: string,
  offsetSec: number,
) {
  if (deduped) {
    const { error: insertError } = await supabase.from("transcript_segments").insert({
      session_id: session.id,
      text: deduped,
      offset_sec: offsetSec,
    });
    if (insertError) throw new Error(insertError.message);

    sessionPatch.context_version = Number(session.context_version ?? 0) + 1;

    await publishSessionEvent(supabase, session.id, "transcript.segment", {
      type: "transcript.segment",
      itemId: crypto.randomUUID(),
      text: deduped,
      timestamp: Date.now() / 1000,
    });
  }

  const updatedSession = await updateSession(supabase, session.id, sessionPatch);
  await publishSessionEvent(supabase, session.id, "usage.update", {
    type: "usage.update",
    ...usagePayload(updatedSession),
  });

  if (deduped) {
    await maybeGenerateChyrons(supabase, openai, updatedSession);
  }
}

type GenerateChyronsOptions = {
  force?: boolean;
};

type GenerateChyronsResult = {
  generated: boolean;
  reason?: "no_session" | "no_transcript" | "context_changed";
  nextBatchAt?: number;
};

export async function forceGenerateChyrons(sessionId: string): Promise<GenerateChyronsResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const supabase = createServiceSupabaseClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const session = await loadSessionForProcessing(supabase, sessionId);
  if (!session || session.status === "ended" || session.status === "error") {
    return { generated: false, reason: "no_session" };
  }

  return maybeGenerateChyrons(supabase, openai, session, { force: true });
}

async function maybeGenerateChyrons(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  session: LiveSessionRow,
  options?: GenerateChyronsOptions,
): Promise<GenerateChyronsResult> {
  const freshSession = await loadSessionForProcessing(supabase, session.id);
  if (!freshSession) return { generated: false, reason: "no_session" };
  session = freshSession;

  if (!options?.force) {
    if (session.context_version <= session.last_generation_version) return { generated: false };
    if (session.last_generation_at) {
      const elapsedMs = Date.now() - Date.parse(session.last_generation_at);
      if (elapsedMs < liveConfig.chyronCadenceSec * 1000) return { generated: false };
    }
  }

  const generationContextVersion = session.context_version;
  const cutoff = new Date(Date.now() - session.context_window_sec * 1000).toISOString();
  let segmentQuery = supabase
    .from("transcript_segments")
    .select("text")
    .eq("session_id", session.id)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true });
  if (session.context_cleared_at) {
    segmentQuery = segmentQuery.gte("created_at", session.context_cleared_at);
  }

  let memoryQuery = supabase
    .from("chyron_memory")
    .select("text, action")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(liveConfig.contextChyronMemoryLimit);
  if (session.context_cleared_at) {
    memoryQuery = memoryQuery.gte("created_at", session.context_cleared_at);
  }

  const [{ data: segments, error: segmentError }, { data: memory, error: memoryError }] = await Promise.all([
    segmentQuery,
    memoryQuery,
  ]);

  if (segmentError) throw new Error(segmentError.message);
  if (memoryError) throw new Error(memoryError.message);

  const recentTranscript = tailChars((segments ?? []).map((segment) => segment.text).join(" "), liveConfig.contextRecentTranscriptMaxChars);
  if (!recentTranscript.trim()) return { generated: false, reason: "no_transcript" };
  if (!shouldGenerateChyrons()) return { generated: false };

  const approved = (memory ?? []).filter((entry) => entry.action === "approved").map((entry) => entry.text).slice(0, 8);
  const rejected = (memory ?? []).filter((entry) => entry.action === "rejected").map((entry) => entry.text).slice(0, 5);
  const prompt = buildChyronPrompt(session, recentTranscript, approved, rejected);

  const response = await openai.chat.completions.create({
    model: liveConfig.chyronModel,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    response_format: { type: "json_object" },
  });

  const afterGeneration = await loadSessionForProcessing(supabase, session.id);
  if (!afterGeneration) return { generated: false, reason: "no_session" };
  if (!options?.force && afterGeneration.context_version !== generationContextVersion) {
    return { generated: false, reason: "context_changed" };
  }
  session = afterGeneration;

  const parsed = parseChyronResponse(response.choices[0].message.content || "{}");
  const { sessionSummary, recentSummary, verbatimCaption } = trimChyronFields(parsed);
  const batchId = crypto.randomUUID();
  const nextBatchAtMs = Date.now() + liveConfig.chyronCadenceSec * 1000;
  const nextBatchAt = new Date(nextBatchAtMs).toISOString();
  const nextBatchAtUnix = nextBatchAtMs / 1000;
  const skipTexts = new Set([...approved, ...rejected].map((text) => text.trim().toUpperCase()));
  const optionRows = buildChyronOptionRows(parsed.chyronOptions, batchId, session.id, skipTexts);
  const nextSessionSummary = sessionSummary || session.session_summary;

  if (optionRows.length === 0) {
    const updated = await updateSession(supabase, session.id, {
      session_summary: nextSessionSummary,
      latest_verbatim: verbatimCaption,
      last_generation_at: new Date().toISOString(),
      chyron_input_tokens: Number(session.chyron_input_tokens ?? 0) + (response.usage?.prompt_tokens ?? 0),
      chyron_output_tokens: Number(session.chyron_output_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
      chyron_requests: Number(session.chyron_requests ?? 0) + 1,
    });

    await publishSessionEvent(supabase, session.id, "chyron.suggestions", {
      type: "chyron.suggestions",
      batchId: session.latest_batch_id ?? batchId,
      sessionSummary: nextSessionSummary,
      topic: "",
      entities: [],
      chyronOptions: [],
      verbatimCaption,
      recentSummary,
      chyronCadenceSec: liveConfig.chyronCadenceSec,
      nextBatchAt: nextBatchAtUnix,
    });
    await publishSessionEvent(supabase, session.id, "usage.update", {
      type: "usage.update",
      ...usagePayload(updated),
    });
    return { generated: true, nextBatchAt: nextBatchAtUnix };
  }

  const { error: batchError } = await supabase.from("chyron_batches").insert({
    id: batchId,
    session_id: session.id,
    session_summary: nextSessionSummary,
    topic: "",
    entities: [],
    verbatim_caption: verbatimCaption,
    recent_summary: recentSummary,
    chyron_cadence_sec: liveConfig.chyronCadenceSec,
    next_batch_at: nextBatchAt,
  });
  if (batchError) throw new Error(batchError.message);

  if (optionRows.length > 0) {
    const { error: optionError } = await supabase.from("chyron_options").insert(optionRows);
    if (optionError) throw new Error(optionError.message);
  }

  const updated = await updateSession(supabase, session.id, {
    latest_batch_id: batchId,
    latest_verbatim: verbatimCaption,
    session_summary: nextSessionSummary,
    last_generation_version: session.context_version,
    last_generation_at: new Date().toISOString(),
    chyron_input_tokens: Number(session.chyron_input_tokens ?? 0) + (response.usage?.prompt_tokens ?? 0),
    chyron_output_tokens: Number(session.chyron_output_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
    chyron_requests: Number(session.chyron_requests ?? 0) + 1,
  });

  await publishSessionEvent(supabase, session.id, "chyron.suggestions", {
    type: "chyron.suggestions",
    batchId,
    sessionSummary: nextSessionSummary,
    topic: "",
    entities: [],
    chyronOptions: optionRows.map((option) => ({
      id: option.id,
      text: option.text,
      rationale: option.rationale,
    })),
    verbatimCaption,
    recentSummary,
    chyronCadenceSec: liveConfig.chyronCadenceSec,
    nextBatchAt: nextBatchAtUnix,
  });
  await publishSessionEvent(supabase, session.id, "usage.update", {
    type: "usage.update",
    ...usagePayload(updated),
  });
  return { generated: true, nextBatchAt: nextBatchAtUnix };
}

async function transcribeChunk(openai: OpenAI, wav: Buffer, sessionId: string) {
  const file = await toFile(wav, `${sessionId}-${Date.now()}.wav`, { type: "audio/wav" });
  const transcript = await openai.audio.transcriptions.create({
    model: liveConfig.transcriptionModel,
    file,
    response_format: "json",
  });

  return String(transcript.text ?? "").trim();
}

async function transcribeUploadedChunk(openai: OpenAI, audio: Buffer, contentType: string, sessionId: string) {
  const extension = contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "mp4" : "webm";
  const file = await toFile(audio, `${sessionId}-${Date.now()}.${extension}`, {
    type: contentType || "audio/webm",
  });
  const transcript = await openai.audio.transcriptions.create({
    model: liveConfig.transcriptionModel,
    file,
    response_format: "json",
  });

  return String(transcript.text ?? "").trim();
}

async function extractWavChunk(
  audioUrl: string,
  offsetSec: number,
  durationSec: number,
): Promise<Buffer> {
  const binaryPath = await getFfmpegBinaryPath();

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, offsetSec)),
      "-i",
      audioUrl,
      "-t",
      String(durationSec),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "wav",
      "pipe:1",
    ];
    const ffmpeg = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    ffmpeg.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8") || `ffmpeg exited with code ${code}`));
    });
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSessionForProcessing(supabase: SupabaseClient<Database>, sessionId: string) {
  const { data, error } = await supabase.from("live_sessions").select("*").eq("id", sessionId).single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateSession(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  patch: Partial<LiveSessionRow>,
) {
  const { data, error } = await supabase.from("live_sessions").update(patch).eq("id", sessionId).select("*").single();
  if (error || !data) throw new Error(error?.message || "Failed to update session");
  return data;
}
