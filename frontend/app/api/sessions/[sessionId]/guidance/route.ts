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
  const guestName = headChars(String(body.name ?? body.guestName ?? "").trim(), liveConfig.guestNameMaxChars);
  const guestCompany = headChars(String(body.company ?? body.guestCompany ?? "").trim(), liveConfig.guestCompanyMaxChars);
  const supabase = createServiceSupabaseClient();

  const { data: session, error: loadError } = await supabase
    .from("live_sessions")
    .select("id, context_version, guest_name, guest_company")
    .eq("id", sessionId)
    .single();

  if (loadError || !session) {
    return NextResponse.json({ detail: loadError?.message || "Session not found" }, { status: 404 });
  }

  if (session.guest_name === guestName && session.guest_company === guestCompany) {
    return NextResponse.json({ status: "ok", guestName, guestCompany });
  }

  const { error: updateError } = await supabase
    .from("live_sessions")
    .update({
      guest_name: guestName,
      guest_company: guestCompany,
      producer_guidance: "",
      context_version: Number(session.context_version ?? 0) + 1,
      last_generation_at: null,
    })
    .eq("id", sessionId);

  if (updateError) {
    return NextResponse.json({ detail: updateError.message }, { status: 500 });
  }

  await publishSessionEvent(supabase, sessionId, "guidance.updated", {
    type: "guidance.updated",
    guestName,
    guestCompany,
    timestamp: Date.now() / 1000,
  });

  return NextResponse.json({ status: "ok", guestName, guestCompany });
}
