import { NextRequest, NextResponse } from "next/server";
import { loadSessionSnapshot } from "@/lib/live/session-state";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: NextRequest, { params }: Params) {
  const { sessionId } = await params;

  try {
    const snapshot = await loadSessionSnapshot(createServiceSupabaseClient(), sessionId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Session not found" },
      { status: 404 },
    );
  }
}
