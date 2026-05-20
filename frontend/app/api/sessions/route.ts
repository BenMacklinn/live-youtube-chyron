import { after, NextRequest, NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import { liveConfig } from "@/lib/live/config";
import { publishSessionEvent } from "@/lib/live/events";
import { kickOffProcessing } from "@/lib/live/kickoff";
import { resolveSessionStreamInputUrl } from "@/lib/live/stream-source";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const youtubeUrl = String(body.youtubeUrl ?? "").trim();
  const mode = body.mode === "verbatim" ? "verbatim" : "chyron";
  const startSec = Math.max(0, Number(body.startSec ?? 0) || 0);
  const contextWindowSec = clamp(Number(body.contextWindowSec ?? liveConfig.contextWindowSec) || liveConfig.contextWindowSec, 30, 90);

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ detail: "OPENAI_API_KEY is not configured" }, { status: 500 });
  }
  let streamUrl: string;
  try {
    streamUrl = await resolveSessionStreamInputUrl(youtubeUrl);
  } catch (error) {
    return NextResponse.json({ detail: error instanceof Error ? error.message : "Invalid stream URL" }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: session, error } = await supabase
    .from("live_sessions")
    .insert({
      youtube_url: streamUrl,
      mode,
      status: "connecting",
      start_sec: startSec,
      next_offset_sec: startSec,
      context_window_sec: contextWindowSec,
    })
    .select("id, status, error")
    .single();

  if (error || !session) {
    return NextResponse.json({ detail: error?.message || "Failed to create session" }, { status: 500 });
  }

  await publishSessionEvent(supabase, session.id, "session.status", {
    type: "session.status",
    status: session.status,
    error: session.error,
  });

  const origin = new URL(request.url).origin;
  after(async () => {
    try {
      await kickOffProcessing(origin, session.id);
    } catch (error) {
      console.error("Failed to start processing", error);
    }
  });

  return NextResponse.json({ sessionId: session.id });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
