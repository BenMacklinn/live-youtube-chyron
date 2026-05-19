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
  const mode = body.mode === "verbatim" ? "verbatim" : "chyron";
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("live_sessions").update({ mode }).eq("id", sessionId);

  if (error) {
    return NextResponse.json({ detail: error.message }, { status: 404 });
  }

  await publishSessionEvent(supabase, sessionId, "mode.changed", {
    type: "mode.changed",
    mode,
  });

  return NextResponse.json({ status: "ok", mode });
}
