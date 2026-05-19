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
  const { data, error } = await supabase
    .from("live_sessions")
    .update({ status: "ended" })
    .eq("id", sessionId)
    .select("status, error")
    .single();

  if (error || !data) {
    return NextResponse.json({ detail: error?.message || "Session not found" }, { status: 404 });
  }

  await publishSessionEvent(supabase, sessionId, "session.status", {
    type: "session.status",
    status: data.status,
    error: data.error,
  });

  return NextResponse.json({ status: "stopped" });
}
