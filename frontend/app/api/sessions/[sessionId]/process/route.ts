import { after, NextResponse } from "next/server";
import { getInternalProcessSecret } from "@/lib/live/internal";
import { kickOffProcessing } from "@/lib/live/kickoff";
import { processSessionRun } from "@/lib/live/processor";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const secret = request.headers.get("x-process-secret");
  if (secret !== getInternalProcessSecret()) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const result = await processSessionRun(sessionId);

  if (result.shouldContinue) {
    const origin = new URL(request.url).origin;
    after(async () => {
      try {
        await kickOffProcessing(origin, sessionId);
      } catch (error) {
        console.error("Failed to continue processing", error);
      }
    });
  }

  return NextResponse.json({ status: result.shouldContinue ? "continuing" : "done" });
}
