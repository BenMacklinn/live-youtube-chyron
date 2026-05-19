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
  const supabase = createServiceSupabaseClient();

  if (text.trim()) {
    const { error } = await supabase
      .from("chyron_memory")
      .insert({ session_id: sessionId, chyron_id: id || null, text, action: "rejected" });
    if (error) return NextResponse.json({ detail: error.message }, { status: 500 });
  }

  await publishSessionEvent(supabase, sessionId, "chyron.rejected", {
    type: "chyron.rejected",
    id,
  });

  return NextResponse.json({ status: "rejected" });
}
