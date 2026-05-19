import { getInternalProcessSecret } from "./internal";

export async function kickOffProcessing(origin: string, sessionId: string) {
  const response = await fetch(`${origin}/api/sessions/${sessionId}/process`, {
    method: "POST",
    headers: {
      "x-process-secret": getInternalProcessSecret(),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Processing kickoff failed with ${response.status}`);
  }
}
