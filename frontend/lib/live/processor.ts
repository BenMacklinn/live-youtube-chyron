import "server-only";

import { spawn } from "node:child_process";
import OpenAI, { toFile } from "openai";
import ytdl from "@distube/ytdl-core";
import ffmpegPath from "ffmpeg-static";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LiveSessionRow } from "@/lib/supabase/types";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { liveConfig } from "./config";
import { publishSessionEvent } from "./events";
import { dedupeOverlap, headChars, tailChars } from "./text";
import { audioBytesForSeconds, usagePayload } from "./usage";

const SYSTEM_PROMPT = `You are a broadcast producer assistant generating live chyron (lower-third) suggestions.

You receive:
1. A persistent session summary (conversation so far - refine it, do not discard prior context)
2. A recent transcript window (last ~60 seconds of speech - for immediacy)
3. Known entities and topic history from earlier in the session

Your job each cycle:
1. REFINE the session summary - merge new speech into the running story. Keep names, topics, and key beats. Do not reset or wipe earlier context.
2. Identify the current main topic or key moment.
3. Generate 3-5 short broadcast-style chyron options in ALL CAPS (<= 60 chars each).
4. Chyrons should reflect the FULL refined session context, weighted toward what is happening NOW in the recent window.
5. Do not repeat recently approved or rejected chyrons.
6. If context is ambiguous, return fewer options rather than inventing facts.
7. Provide a cleaned verbatim caption for the recent window (subtitle mode).
8. Keep the session summary compact. It should be a memory aid, not a transcript.

Respond with valid JSON only:
{
  "sessionSummary": "2-5 sentences refining the full conversation so far",
  "topic": "current main topic",
  "entities": ["names, orgs, key terms"],
  "chyronOptions": [{"text": "string", "rationale": "string"}],
  "verbatimCaption": "string"
}`;

type ProcessResult = {
  shouldContinue: boolean;
};

export async function processSessionRun(sessionId: string): Promise<ProcessResult> {
  const supabase = createServiceSupabaseClient();
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  try {
    for (let i = 0; i < liveConfig.chunksPerRun; i += 1) {
      const session = await loadSessionForProcessing(supabase, sessionId);
      if (!session || session.status === "ended" || session.status === "error") {
        return { shouldContinue: false };
      }

      if (session.status === "connecting") {
        const updated = await updateSession(supabase, session.id, { status: "transcribing", error: null });
        await publishSessionEvent(supabase, session.id, "session.status", {
          type: "session.status",
          status: updated.status,
          error: updated.error,
        });
      }

      await processOneChunk(supabase, openai, session);
    }

    const latest = await loadSessionForProcessing(supabase, sessionId);
    return { shouldContinue: latest?.status === "transcribing" || latest?.status === "connecting" };
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

async function processOneChunk(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  session: LiveSessionRow,
) {
  const offsetSec = Number(session.next_offset_sec || session.start_sec || 0);
  const durationSec = liveConfig.transcriptionChunkSec + Math.max(0, liveConfig.transcriptionOverlapSec);
  const audioUrl = await resolveAudioUrl(session.youtube_url);
  const wav = await extractWavChunk(audioUrl, offsetSec, durationSec);
  const transcriptText = await transcribeChunk(openai, wav, session.id);
  const deduped = dedupeOverlap(session.last_transcript_text, transcriptText);
  const nextOffset = offsetSec + liveConfig.transcriptionChunkSec;

  const sessionPatch: Partial<LiveSessionRow> = {
    next_offset_sec: nextOffset,
    audio_bytes_sent: Number(session.audio_bytes_sent ?? 0) + audioBytesForSeconds(liveConfig.transcriptionChunkSec),
    last_transcript_text: transcriptText.trim(),
  };

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

async function maybeGenerateChyrons(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  session: LiveSessionRow,
) {
  if (session.context_version <= session.last_generation_version) return;

  if (session.last_generation_at) {
    const elapsedMs = Date.now() - Date.parse(session.last_generation_at);
    if (elapsedMs < liveConfig.chyronCadenceSec * 1000) return;
  }

  const cutoff = new Date(Date.now() - session.context_window_sec * 1000).toISOString();
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
    supabase
      .from("transcript_segments")
      .select("text")
      .eq("session_id", session.id)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: true }),
    memoryQuery,
  ]);

  if (segmentError) throw new Error(segmentError.message);
  if (memoryError) throw new Error(memoryError.message);

  const recentTranscript = tailChars((segments ?? []).map((segment) => segment.text).join(" "), liveConfig.contextRecentTranscriptMaxChars);
  if (!recentTranscript.trim()) return;

  const approved = (memory ?? []).filter((entry) => entry.action === "approved").map((entry) => entry.text).slice(0, 8);
  const rejected = (memory ?? []).filter((entry) => entry.action === "rejected").map((entry) => entry.text).slice(0, 5);

  const response = await openai.chat.completions.create({
    model: liveConfig.chyronModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Persistent session summary (refine this - do not wipe prior context):
${session.session_summary || "None yet - start building from the recent transcript below."}

Recent transcript (last ${session.context_window_sec}s):
${recentTranscript}

Summary budget: keep the next sessionSummary under ${liveConfig.contextSummaryMaxChars} characters.
Topic history: ${JSON.stringify(session.topic_history)}
Known entities: ${JSON.stringify(session.known_entities)}
Recent approved chyrons (avoid repeating): ${JSON.stringify(approved)}
Recent rejected chyrons (avoid repeating): ${JSON.stringify(rejected)}

Mode preference: ${session.mode}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  const batchId = crypto.randomUUID();
  const entities = mergeEntities(session.known_entities, parsed.entities ?? []);
  const topic = String(parsed.topic ?? "").trim();
  const sessionSummary = parsed.sessionSummary
    ? headChars(String(parsed.sessionSummary).trim(), liveConfig.contextSummaryMaxChars)
    : session.session_summary;
  const topicHistory = topic ? appendLimited(session.topic_history, topic, liveConfig.contextTopicHistoryLimit) : session.topic_history;
  const nextBatchAt = new Date(Date.now() + liveConfig.chyronCadenceSec * 1000).toISOString();
  const options: Array<{ text?: unknown; rationale?: unknown }> = Array.isArray(parsed.chyronOptions)
    ? parsed.chyronOptions.slice(0, 5)
    : [];

  const { error: batchError } = await supabase.from("chyron_batches").insert({
    id: batchId,
    session_id: session.id,
    session_summary: sessionSummary,
    topic,
    entities,
    verbatim_caption: String(parsed.verbatimCaption ?? ""),
    chyron_cadence_sec: liveConfig.chyronCadenceSec,
    next_batch_at: nextBatchAt,
  });
  if (batchError) throw new Error(batchError.message);

  const optionRows = options.map((option, index) => ({
    id: `${batchId}-${index}`,
    batch_id: batchId,
    session_id: session.id,
    option_index: index,
    text: String(option.text ?? "").slice(0, 60).toUpperCase(),
    rationale: String(option.rationale ?? ""),
  }));

  if (optionRows.length > 0) {
    const { error: optionError } = await supabase.from("chyron_options").insert(optionRows);
    if (optionError) throw new Error(optionError.message);
  }

  const updated = await updateSession(supabase, session.id, {
    latest_batch_id: batchId,
    latest_verbatim: String(parsed.verbatimCaption ?? ""),
    session_summary: sessionSummary,
    last_topic: topic,
    known_entities: entities,
    topic_history: topicHistory,
    last_generation_version: session.context_version,
    last_generation_at: new Date().toISOString(),
    chyron_input_tokens: Number(session.chyron_input_tokens ?? 0) + (response.usage?.prompt_tokens ?? 0),
    chyron_output_tokens: Number(session.chyron_output_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
    chyron_requests: Number(session.chyron_requests ?? 0) + 1,
  });

  await publishSessionEvent(supabase, session.id, "chyron.suggestions", {
    type: "chyron.suggestions",
    batchId,
    sessionSummary,
    topic,
    entities,
    chyronOptions: optionRows.map((option) => ({
      id: option.id,
      text: option.text,
      rationale: option.rationale,
    })),
    verbatimCaption: String(parsed.verbatimCaption ?? ""),
    chyronCadenceSec: liveConfig.chyronCadenceSec,
    nextBatchAt: Date.parse(nextBatchAt) / 1000,
  });
  await publishSessionEvent(supabase, session.id, "usage.update", {
    type: "usage.update",
    ...usagePayload(updated),
  });
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

async function resolveAudioUrl(youtubeUrl: string) {
  const info = await ytdl.getInfo(youtubeUrl);
  const format = ytdl.chooseFormat(info.formats, {
    quality: "highestaudio",
    filter: "audioonly",
  });

  if (!format?.url) {
    throw new Error("Could not resolve YouTube audio URL");
  }

  return format.url;
}

function extractWavChunk(audioUrl: string, offsetSec: number, durationSec: number): Promise<Buffer> {
  if (!ffmpegPath) {
    return Promise.reject(new Error("ffmpeg-static did not provide a binary path"));
  }
  const binaryPath = ffmpegPath;

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, offsetSec)),
      "-t",
      String(durationSec),
      "-i",
      audioUrl,
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

function mergeEntities(current: string[], next: unknown[]) {
  const merged = [...current];
  for (const entity of next) {
    const cleaned = String(entity).trim();
    if (cleaned && !merged.includes(cleaned)) merged.push(cleaned);
  }
  return merged.slice(-liveConfig.contextEntitiesLimit);
}

function appendLimited(values: string[], next: string, limit: number) {
  const cleaned = next.trim();
  const appended = values.at(-1) === cleaned ? values : [...values, cleaned];
  return appended.slice(-limit);
}
