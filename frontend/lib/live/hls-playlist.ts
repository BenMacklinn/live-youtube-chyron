import "server-only";

export type HlsSegment = {
  sequence: number;
  durationSec: number;
  uri: string;
  url: string;
};

export type HlsPlaylist = {
  mediaSequence: number;
  ended: boolean;
  segments: HlsSegment[];
};

export async function loadHlsPlaylist(sourceUrl: string, redirects = 0): Promise<HlsPlaylist> {
  if (redirects > 3) {
    throw new Error("HLS playlist has too many nested variants");
  }

  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load HLS playlist: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const variantUri = firstVariantUri(lines);
  if (variantUri) {
    return loadHlsPlaylist(resolvePlaylistUrl(sourceUrl, variantUri), redirects + 1);
  }

  let mediaSequence = 0;
  let pendingDuration: number | null = null;
  const segments: HlsSegment[] = [];

  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      mediaSequence = Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length)) || 0;
      continue;
    }

    if (line.startsWith("#EXTINF:")) {
      pendingDuration = Number(line.slice("#EXTINF:".length).split(",")[0]) || 0;
      continue;
    }

    if (!line.startsWith("#") && pendingDuration != null) {
      const sequence = mediaSequence + segments.length;
      segments.push({
        sequence,
        durationSec: pendingDuration,
        uri: line,
        url: resolvePlaylistUrl(sourceUrl, line),
      });
      pendingDuration = null;
    }
  }

  return {
    mediaSequence,
    ended: lines.includes("#EXT-X-ENDLIST"),
    segments,
  };
}

function firstVariantUri(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      return lines.slice(i + 1).find((line) => line && !line.startsWith("#")) ?? null;
    }
  }
  return null;
}

function resolvePlaylistUrl(baseUrl: string, uri: string): string {
  return new URL(uri, baseUrl).toString();
}
