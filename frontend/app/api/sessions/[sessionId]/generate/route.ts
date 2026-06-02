import { NextResponse } from "next/server";
import { forceGenerateChyrons } from "@/lib/live/processor";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const { sessionId } = await params;

  try {
    const result = await forceGenerateChyrons(sessionId);

    if (result.reason === "no_session") {
      return NextResponse.json({ detail: "Session not found or not active" }, { status: 404 });
    }
    if (result.reason === "no_transcript") {
      return NextResponse.json({ detail: "No transcript available yet" }, { status: 409 });
    }
    if (!result.generated) {
      return NextResponse.json({ status: "skipped" });
    }

    return NextResponse.json({
      status: "generated",
      nextBatchAt: result.nextBatchAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to generate chyrons";
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
