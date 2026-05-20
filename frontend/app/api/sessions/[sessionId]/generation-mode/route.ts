import { NextResponse } from "next/server";
import { publishSessionEvent } from "@/lib/live/events";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const generationMode = body.generationMode === "guest" ? "guest" : "timeline";
  const supabase = createServiceSupabaseClient();

  const { data: session, error: loadError } = await supabase
    .from("live_sessions")
    .select("id, generation_mode, context_version")
    .eq("id", sessionId)
    .single();

  if (loadError || !session) {
    return NextResponse.json({ detail: loadError?.message || "Session not found" }, { status: 404 });
  }

  if (session.generation_mode === generationMode) {
    return NextResponse.json({ status: "ok", generationMode });
  }

  const { error: updateError } = await supabase
    .from("live_sessions")
    .update({
      generation_mode: generationMode,
      context_version: Number(session.context_version ?? 0) + 1,
      last_generation_at: null,
    })
    .eq("id", sessionId);

  if (updateError) {
    return NextResponse.json({ detail: updateError.message }, { status: 500 });
  }

  await publishSessionEvent(supabase, sessionId, "generation_mode.changed", {
    type: "generation_mode.changed",
    generationMode,
    timestamp: Date.now() / 1000,
  });

  return NextResponse.json({ status: "ok", generationMode });
}
