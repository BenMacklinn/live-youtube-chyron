import { NextResponse } from "next/server";
import { headChars } from "@/lib/live/text";
import { liveConfig } from "@/lib/live/config";
import { publishSessionEvent } from "@/lib/live/events";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const guidance = headChars(String(body.guidance ?? "").trim(), liveConfig.producerGuidanceMaxChars);
  const supabase = createServiceSupabaseClient();

  const { data: session, error: loadError } = await supabase
    .from("live_sessions")
    .select("id, context_version, producer_guidance")
    .eq("id", sessionId)
    .single();

  if (loadError || !session) {
    return NextResponse.json({ detail: loadError?.message || "Session not found" }, { status: 404 });
  }

  if (session.producer_guidance === guidance) {
    return NextResponse.json({ status: "ok", guidance });
  }

  const { error: updateError } = await supabase
    .from("live_sessions")
    .update({
      producer_guidance: guidance,
      context_version: Number(session.context_version ?? 0) + 1,
    })
    .eq("id", sessionId);

  if (updateError) {
    return NextResponse.json({ detail: updateError.message }, { status: 500 });
  }

  await publishSessionEvent(supabase, sessionId, "guidance.updated", {
    type: "guidance.updated",
    guidance,
    timestamp: Date.now() / 1000,
  });

  return NextResponse.json({ status: "ok", guidance });
}
