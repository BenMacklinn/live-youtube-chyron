import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LiveSessionRow } from "@/lib/supabase/types";
import { usagePayload } from "./usage";

export async function loadSessionSnapshot(supabase: SupabaseClient<Database>, sessionId: string) {
  const { data: session, error: sessionError } = await supabase
    .from("live_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    throw new Error(sessionError?.message || "Session not found");
  }

  const [{ data: segments, error: segmentsError }, { data: memory, error: memoryError }] = await Promise.all([
    supabase
      .from("transcript_segments")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("chyron_memory")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  if (segmentsError) throw new Error(segmentsError.message);
  if (memoryError) throw new Error(memoryError.message);

  let latestSuggestions = null;
  let latestBatch = null;
  if (session.latest_batch_id) {
    const { data, error: batchError } = await supabase
      .from("chyron_batches")
      .select("*")
      .eq("id", session.latest_batch_id)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    latestBatch = data;
  }

  if (latestBatch) {
    const { data: options, error: optionsError } = await supabase
      .from("chyron_options")
      .select("*")
      .eq("batch_id", latestBatch.id)
      .order("option_index", { ascending: true });

    if (optionsError) throw new Error(optionsError.message);

    latestSuggestions = {
      batchId: latestBatch.id,
      sessionSummary: latestBatch.session_summary,
      topic: latestBatch.topic,
      entities: latestBatch.entities,
      chyronOptions: (options ?? []).map((option) => ({
        id: option.id,
        text: option.text,
        rationale: option.rationale,
      })),
      verbatimCaption: latestBatch.verbatim_caption,
      chyronCadenceSec: latestBatch.chyron_cadence_sec,
      nextBatchAt: latestBatch.next_batch_at ? Date.parse(latestBatch.next_batch_at) / 1000 : undefined,
    };
  }

  return {
    sessionId: session.id,
    status: session.status,
    mode: session.mode,
    startSec: session.start_sec,
    youtubeUrl: session.youtube_url,
    activeChyron: session.active_chyron,
    approvedLog: (memory ?? [])
      .filter((entry) => entry.action === "approved")
      .map((entry) => ({ text: entry.text, timestamp: Date.parse(entry.created_at) / 1000 })),
    segments: (segments ?? []).map((segment) => segment.text),
    latestSuggestions,
    latestVerbatim: session.latest_verbatim,
    usage: usagePayload(session as LiveSessionRow),
    error: session.error,
  };
}
