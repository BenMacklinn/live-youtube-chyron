import { NextResponse } from "next/server";
import { publishSessionEvent } from "@/lib/live/events";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const { sessionId } = await params;
  const supabase = createServiceSupabaseClient();

  const [{ error: segmentError }, { error: batchError }] = await Promise.all([
    supabase.from("transcript_segments").delete().eq("session_id", sessionId),
    supabase.from("chyron_batches").delete().eq("session_id", sessionId),
  ]);

  if (segmentError) {
    return NextResponse.json({ detail: segmentError.message }, { status: 500 });
  }

  if (batchError) {
    return NextResponse.json({ detail: batchError.message }, { status: 500 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("live_sessions")
    .update({
      session_summary: "",
      last_topic: "",
      known_entities: [],
      topic_history: [],
      context_version: 0,
      last_generation_version: 0,
      context_cleared_at: new Date().toISOString(),
      latest_batch_id: null,
      latest_verbatim: "",
      last_transcript_text: "",
    })
    .eq("id", sessionId)
    .select("id")
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ detail: sessionError?.message || "Session not found" }, { status: 404 });
  }

  await publishSessionEvent(supabase, sessionId, "context.cleared", {
    type: "context.cleared",
    timestamp: Date.now() / 1000,
  });

  return NextResponse.json({ status: "cleared" });
}
