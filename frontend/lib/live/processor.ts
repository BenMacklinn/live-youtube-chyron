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
import { resolveStreamInputUrl, streamSourceKind, type StreamSourceKind } from "./stream-source";
import { dedupeOverlap, headChars, tailChars } from "./text";
import { audioBytesForSeconds, usagePayload } from "./usage";

const CHYRON_MAX_CHARS = 39;

const CHYRON_STYLE_RULES = `Chyron title style (critical):
- Every chyron MUST include the guest name and company/show from guest context below. Tie the line to both — e.g. "[Name] on [topic at company]" or "[Company]: [topic with name]".
- Specific, not broad: one tight news beat from the current transcript topic — never a sector headline with no who/what.
- Structure: "[Guest name] on [topic]", "[Company] [verb] [development]", or "[Name] on [what they are discussing]" using the supplied guest fields.
- Every chyron must read as a finished phrase within the character limit. Never end on dangling words (to, on, about, into, for, with) or cut off mid-thought.
- Ban vague abstractions without the guest anchor: no lines built only from jargon like quantities, shipping, disruption, debate, strategy, industry, market.
- Ban mood or meta labels (pressured, speaks out, heated exchange, turns to, pivot to) — state the actual topic instead.
- If the transcript topic is unclear, still anchor to the guest name and company with the best-supported topic; return fewer options rather than going generic.`;

const CHYRON_QUALITY_USER_NOTE = `Chyron bar: Every option must contain both the guest name and company/show from guest context. Pull the topic from the recent transcript. Complete thought only — max ${CHYRON_MAX_CHARS} characters, no trailing prepositions.`;

const PERSISTENT_SYSTEM_PROMPT = `You are a broadcast producer assistant generating live chyron (lower-third) suggestions.

You receive:
1. A persistent session summary (conversation so far - refine it, do not discard prior context)
2. A recent transcript window (last ~60 seconds of speech - for immediacy)
3. Known entities and topic history from earlier in the session
4. Required guest name and company/show from the control room (who is on air)

Your job each cycle:
1. REFINE the session summary - merge new speech into the running story. Keep names, topics, and key beats. Do not reset or wipe earlier context.
2. Identify the current main topic or key moment.
3. Generate 3-5 chyron options in ALL CAPS following the style rules below.
4. Every chyron option MUST be fewer than ${CHYRON_MAX_CHARS} characters, including spaces and punctuation.
5. Chyrons should reflect the FULL refined session context, weighted toward the current news beat in the recent window.
6. Do not repeat recently approved or rejected chyrons.

${CHYRON_STYLE_RULES}
7. If context is ambiguous, return fewer options rather than inventing facts.
8. Provide a cleaned verbatim caption for the recent window (subtitle mode).
9. Keep the session summary compact. It should be a memory aid, not a transcript.
10. Provide recentSummary: ONE crisp sentence (max ~25 words) in plain everyday English on what speakers are discussing in the last ~${liveConfig.recentSummaryWindowSec} seconds. No broadcast jargon, no ALL CAPS, no chyron phrasing.

Respond with valid JSON only:
{
  "sessionSummary": "2-5 sentences refining the full conversation so far",
  "recentSummary": "one short plain-language sentence, max ~25 words",
  "topic": "current main topic",
  "entities": ["names, orgs, key terms"],
  "chyronOptions": [{"text": "string", "rationale": "string"}],
  "verbatimCaption": "string"
}`;

const FRESH_CONTEXT_SYSTEM_PROMPT = `You are a broadcast producer assistant generating live chyron (lower-third) suggestions.

The producer just cleared session context. Treat this as a brand-new segment:
- Ignore any prior topics, names, or story beats outside the recent transcript window below.
- Build sessionSummary only from the recent transcript window.
- Do not carry over people, places, or topics unless they appear in that window or in guest context.

Your job each cycle:
1. Write a compact session summary from the recent transcript only.
2. Identify the current main topic or key moment.
3. Generate 3-5 chyron options in ALL CAPS following the style rules below.
4. Every chyron option MUST be fewer than ${CHYRON_MAX_CHARS} characters, including spaces and punctuation.
5. Chyrons should reflect the current news beat in the recent window.
6. Do not repeat recently approved or rejected chyrons.

${CHYRON_STYLE_RULES}
7. If context is ambiguous, return fewer options rather than inventing facts.
8. Provide a cleaned verbatim caption for the recent window (subtitle mode).
9. Provide recentSummary: ONE crisp sentence (max ~25 words) in plain everyday English on what speakers are discussing in the last ~${liveConfig.recentSummaryWindowSec} seconds. No broadcast jargon, no ALL CAPS, no chyron phrasing.

Respond with valid JSON only:
{
  "sessionSummary": "2-5 sentences from the recent transcript only",
  "recentSummary": "one short plain-language sentence, max ~25 words",
  "topic": "current main topic",
  "entities": ["names, orgs, key terms"],
  "chyronOptions": [{"text": "string", "rationale": "string"}],
  "verbatimCaption": "string"
}`;

function contextWasCleared(session: LiveSessionRow) {
  return Boolean(session.context_cleared_at);
}

function guestContextReady(session: LiveSessionRow) {
  return Boolean(session.guest_name?.trim()) && Boolean(session.guest_company?.trim());
}

function guestContextBlock(session: LiveSessionRow) {
  const name = session.guest_name?.trim() ?? "";
  const company = session.guest_company?.trim() ?? "";
  if (!guestContextReady(session)) return "";

  return `

Guest context (required in every chyron — ground truth even if not spoken yet):
Guest name: ${name}
Company / show: ${company}`;
}

function chyronIncludesGuest(text: string, session: LiveSessionRow) {
  const name = session.guest_name?.trim().toUpperCase() ?? "";
  const company = session.guest_company?.trim().toUpperCase() ?? "";
  if (!name || !company) return false;

  const nameParts = name.split(/\s+/).filter((part) => part.length >= 2);
  const hasName = nameParts.some((part) => text.includes(part)) || text.includes(name);

  const companyParts = company.split(/\s+/).filter((part) => part.length >= 3);
  const hasCompany = companyParts.some((part) => text.includes(part)) || text.includes(company);

  return hasName && hasCompany;
}

function buildChyronPrompt(session: LiveSessionRow, recentTranscript: string, approved: string[], rejected: string[]) {
  const fresh = contextWasCleared(session) && !session.session_summary.trim();
  const guidance = guestContextBlock(session);

  if (fresh) {
    return {
      system: FRESH_CONTEXT_SYSTEM_PROMPT,
      user: `Recent transcript (last ${session.context_window_sec}s — start fresh, no prior segment memory):
${recentTranscript}

Summary budget: keep the next sessionSummary under ${liveConfig.contextSummaryMaxChars} characters.
Recent approved chyrons (avoid repeating): ${JSON.stringify(approved)}
Recent rejected chyrons (avoid repeating): ${JSON.stringify(rejected)}

Mode preference: ${session.mode}
${CHYRON_QUALITY_USER_NOTE}${guidance}`,
    };
  }

  return {
    system: PERSISTENT_SYSTEM_PROMPT,
    user: `Persistent session summary (refine this - do not wipe prior context):
${session.session_summary || "None yet - start building from the recent transcript below."}

Recent transcript (last ${session.context_window_sec}s):
${recentTranscript}

Summary budget: keep the next sessionSummary under ${liveConfig.contextSummaryMaxChars} characters.
Topic history: ${JSON.stringify(session.topic_history)}
Known entities: ${JSON.stringify(session.known_entities)}
Recent approved chyrons (avoid repeating): ${JSON.stringify(approved)}
Recent rejected chyrons (avoid repeating): ${JSON.stringify(rejected)}

Mode preference: ${session.mode}
${CHYRON_QUALITY_USER_NOTE}${guidance}`,
  };
}

const CHYRON_GENERIC_WORDS = new Set([
  "HEAVY",
  "QUANTITIES",
  "DISRUPT",
  "SHIPPING",
  "DEBATE",
  "MARKET",
  "INDUSTRY",
  "SECTOR",
  "MAJOR",
  "KEY",
  "CRITICAL",
  "TACTIC",
  "STRATEGY",
  "DISCUSSION",
  "ISSUE",
  "IMPACT",
  "GROWTH",
  "RISK",
  "SUPPLY",
  "DEMAND",
  "TRADE",
  "POLICY",
  "ECONOMY",
  "TREND",
  "OUTLOOK",
  "LANDSCAPE",
  "DYNAMIC",
  "PRESSURE",
  "CHALLENGE",
]);

const CHYRON_DANGLING_END =
  /\b(TO|ON|ABOUT|INTO|FOR|WITH|AND|OR|THE|A|AN|AS|AT|BY|FROM|OF|IN)$/;

const CHYRON_INCOMPLETE_PHRASE = /\b(TURNS?|TURNING|SHIFTS?|SHIFTING|PIVOTS?|PIVOTING|MOVES?|MOVING|DEBATE)\s+(TO|ON|ABOUT|INTO|FOR)?$/i;

function chyronAnchorTokens(session: LiveSessionRow, entityList: string[]): string[] {
  const tokens = new Set<string>();
  const add = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    tokens.add(cleaned);
    for (const part of cleaned.split(/\s+/)) {
      if (part.length >= 3) tokens.add(part);
    }
  };

  add(session.guest_name ?? "");
  add(session.guest_company ?? "");
  for (const entity of entityList) add(entity);
  for (const entity of session.known_entities ?? []) add(entity);

  return [...tokens];
}

function chyronHasAnchor(text: string, anchors: string[]) {
  if (anchors.length === 0) return true;
  return anchors.some((anchor) => {
    const normalized = anchor.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
    if (normalized.length < 3) return false;
    return text.includes(normalized);
  });
}

function isUsableChyron(text: string, session: LiveSessionRow, anchors: string[]) {
  if (text.length < 12) return false;
  if (CHYRON_DANGLING_END.test(text)) return false;
  if (CHYRON_INCOMPLETE_PHRASE.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  const nonGeneric = words.filter((word) => !CHYRON_GENERIC_WORDS.has(word));
  if (nonGeneric.length === 0) return false;

  if (guestContextReady(session)) {
    return chyronIncludesGuest(text, session);
  }

  return chyronHasAnchor(text, anchors);
}

function buildChyronOptionRows(
  options: Array<{ text?: unknown; rationale?: unknown }>,
  batchId: string,
  session: LiveSessionRow,
  anchors: string[],
) {
  const rows: Array<{
    id: string;
    batch_id: string;
    session_id: string;
    option_index: number;
    text: string;
    rationale: string;
  }> = [];

  for (const option of options) {
    const text = headChars(String(option.text ?? "").trim().toUpperCase(), CHYRON_MAX_CHARS);
    if (!isUsableChyron(text, session, anchors)) continue;

    rows.push({
      id: `${batchId}-${rows.length}`,
      batch_id: batchId,
      session_id: session.id,
      option_index: rows.length,
      text,
      rationale: String(option.rationale ?? ""),
    });

    if (rows.length >= 5) break;
  }

  return rows;
}

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
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required");
  }

  try {
    const firstSession = await loadSessionForProcessing(supabase, sessionId);
    if (!firstSession || firstSession.status === "ended" || firstSession.status === "error") {
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

async function maybeGenerateChyrons(
  supabase: SupabaseClient<Database>,
  openai: OpenAI,
  session: LiveSessionRow,
) {
  const freshSession = await loadSessionForProcessing(supabase, session.id);
  if (!freshSession) return;
  session = freshSession;

  if (session.context_version <= session.last_generation_version) return;

  if (session.last_generation_at) {
    const elapsedMs = Date.now() - Date.parse(session.last_generation_at);
    if (elapsedMs < liveConfig.chyronCadenceSec * 1000) return;
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
  if (!recentTranscript.trim()) return;
  if (!guestContextReady(session)) return;

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
  if (!afterGeneration || afterGeneration.context_version !== generationContextVersion) {
    return;
  }
  session = afterGeneration;

  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  const batchId = crypto.randomUUID();
  const startFresh = contextWasCleared(session) && !session.session_summary.trim();
  const entities = startFresh
    ? mergeEntities([], parsed.entities ?? [])
    : mergeEntities(session.known_entities, parsed.entities ?? []);
  const topic = String(parsed.topic ?? "").trim();
  const sessionSummary = parsed.sessionSummary
    ? headChars(String(parsed.sessionSummary).trim(), liveConfig.contextSummaryMaxChars)
    : session.session_summary;
  const topicHistory = startFresh
    ? topic
      ? [topic]
      : []
    : topic
      ? appendLimited(session.topic_history, topic, liveConfig.contextTopicHistoryLimit)
      : session.topic_history;
  const nextBatchAt = new Date(Date.now() + liveConfig.chyronCadenceSec * 1000).toISOString();
  const recentSummary = parsed.recentSummary
    ? headChars(String(parsed.recentSummary).trim(), liveConfig.recentSummaryMaxChars)
    : "";
  const options: Array<{ text?: unknown; rationale?: unknown }> = Array.isArray(parsed.chyronOptions)
    ? parsed.chyronOptions.slice(0, 8)
    : [];
  const anchors = chyronAnchorTokens(session, entities);
  const optionRows = buildChyronOptionRows(options, batchId, session, anchors);
  if (optionRows.length === 0) return;

  const { error: batchError } = await supabase.from("chyron_batches").insert({
    id: batchId,
    session_id: session.id,
    session_summary: sessionSummary,
    topic,
    entities,
    verbatim_caption: String(parsed.verbatimCaption ?? ""),
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
    recentSummary,
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
