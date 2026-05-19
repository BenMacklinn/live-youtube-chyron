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
  const text = String(body.text ?? "");
  const id = String(body.id ?? "");

  if (!text.trim()) {
    return NextResponse.json({ detail: "Text is required" }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: session, error: sessionError } = await supabase
    .from("live_sessions")
    .update({ active_chyron: text })
    .eq("id", sessionId)
    .select("id")
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ detail: sessionError?.message || "Session not found" }, { status: 404 });
  }

  const { data: memory, error: memoryError } = await supabase
    .from("chyron_memory")
    .insert({ session_id: sessionId, chyron_id: id || null, text, action: "approved" })
    .select("created_at")
    .single();

  if (memoryError || !memory) {
    return NextResponse.json({ detail: memoryError?.message || "Failed to approve chyron" }, { status: 500 });
  }

  await publishSessionEvent(supabase, sessionId, "chyron.approved", {
    type: "chyron.approved",
    text,
    id,
  });
  await publishSessionEvent(supabase, sessionId, "chyron.log", {
    type: "chyron.log",
    text,
    timestamp: Date.parse(memory.created_at) / 1000,
  });

  return NextResponse.json({ status: "approved" });
}
