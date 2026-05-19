import "server-only";

import ytdl from "@distube/ytdl-core";

type YtdlAgent = ReturnType<typeof ytdl.createAgent>;

let cachedAgent: YtdlAgent | undefined;

function loadYouTubeAgent(): YtdlAgent | undefined {
  if (cachedAgent) return cachedAgent;

  const raw = process.env.YOUTUBE_COOKIES?.trim();
  if (!raw) return undefined;

  let cookies: unknown;
  try {
    cookies = JSON.parse(raw);
  } catch {
    throw new Error("YOUTUBE_COOKIES must be valid JSON (cookie array exported from your browser)");
  }

  if (!Array.isArray(cookies)) {
    throw new Error("YOUTUBE_COOKIES must be a JSON array of cookie objects");
  }

  cachedAgent = ytdl.createAgent(cookies);
  return cachedAgent;
}

function isYouTubeBotBlock(message: string): boolean {
  return /sign in to confirm|not a bot|confirm you.?re not/i.test(message);
}

function formatYouTubeAccessError(cause: string): Error {
  const hasCookies = Boolean(process.env.YOUTUBE_COOKIES?.trim());
  if (hasCookies) {
    return new Error(
      `YouTube blocked audio download (${cause}). Refresh YOUTUBE_COOKIES from a logged-in youtube.com session and redeploy.`,
    );
  }

  return new Error(
    "YouTube blocked audio download from this server (bot check). " +
      "Add YOUTUBE_COOKIES to Vercel: log into youtube.com, export cookies as JSON (e.g. EditThisCookie), paste into env var.",
  );
}

export async function resolveYouTubeAudioUrl(youtubeUrl: string): Promise<string> {
  const agent = loadYouTubeAgent();
  const requestOptions = agent ? { agent } : {};

  try {
    const info = await ytdl.getInfo(youtubeUrl, requestOptions);
    const format = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
      filter: "audioonly",
    });

    if (!format?.url) {
      throw new Error("Could not resolve YouTube audio URL");
    }

    return format.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isYouTubeBotBlock(message)) {
      throw formatYouTubeAccessError(message);
    }
    throw error;
  }
}
