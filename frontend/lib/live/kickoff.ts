import { getInternalProcessSecret } from "./internal";

/** Prefer stable production host for server-side fetch (avoids SSO on deployment URLs). */
export function getProcessingBaseUrl(requestOrigin: string): string {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost) return `https://${productionHost}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return requestOrigin;
}

export async function kickOffProcessing(requestOrigin: string, sessionId: string) {
  const baseUrl = getProcessingBaseUrl(requestOrigin);
  const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/process`, {
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
