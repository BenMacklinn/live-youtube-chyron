import "server-only";

const DIRECT_STREAM_PROTOCOLS = new Set(["http:", "https:", "rtmp:", "rtmps:"]);
const PRODUCTION_STREAM_RESOLVER = "https://newsmax-delta.vercel.app/api/latest-clipper";

export type StreamSourceKind = "hls" | "direct";

export function isSupportedStreamSource(value: string): boolean {
  try {
    const url = new URL(value);
    return DIRECT_STREAM_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function resolveStreamInputUrl(sourceUrl: string): string {
  const trimmed = sourceUrl.trim();
  if (!isSupportedStreamSource(trimmed)) {
    throw new Error("Use a direct stream URL: rtmp://, rtmps://, https://...m3u8, or a direct media file URL.");
  }

  const url = new URL(trimmed);
  if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
    throw new Error("YouTube watch URLs are no longer supported. Use a direct RTMP, HLS (.m3u8), or media URL.");
  }

  return trimmed;
}

export async function resolveSessionStreamInputUrl(sourceUrl: string): Promise<string> {
  const trimmed = sourceUrl.trim();
  if (trimmed) {
    return resolveStreamInputUrl(trimmed);
  }

  return resolveStreamInputUrl(await loadProductionStreamInputUrl());
}

export function streamSourceKind(sourceUrl: string): StreamSourceKind {
  try {
    const url = new URL(sourceUrl.trim());
    return url.pathname.toLowerCase().endsWith(".m3u8") ? "hls" : "direct";
  } catch {
    return "direct";
  }
}

async function loadProductionStreamInputUrl(): Promise<string> {
  const endpoint = process.env.PRODUCTION_STREAM_SOURCE_URL?.trim() || PRODUCTION_STREAM_RESOLVER;
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to resolve production stream URL: ${response.status} ${response.statusText}`);
  }

  const text = (await response.text()).trim();
  if (!text) {
    throw new Error("Production stream resolver returned an empty response");
  }

  try {
    const payload = JSON.parse(text) as { url?: unknown };
    if (typeof payload.url === "string" && payload.url.trim()) {
      return payload.url.trim();
    }
  } catch {
    // Some resolvers return the direct stream URL as plain text.
  }

  return text;
}
