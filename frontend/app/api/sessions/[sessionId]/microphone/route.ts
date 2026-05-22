import { NextResponse } from "next/server";
import { processUploadedAudioChunk } from "@/lib/live/processor";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  const durationSec = Number(request.headers.get("x-duration-sec") ?? 0);
  const contentType = request.headers.get("content-type") || "audio/webm";
  const buffer = Buffer.from(await request.arrayBuffer());

  if (buffer.length === 0) {
    return NextResponse.json({ detail: "Audio chunk is empty" }, { status: 400 });
  }

  try {
    const result = await processUploadedAudioChunk(sessionId, buffer, contentType, durationSec);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { detail: error instanceof Error ? error.message : "Failed to process microphone audio" },
      { status: 500 },
    );
  }
}
