import "server-only";

import { access, chmod, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

let cachedBinaryPath: string | undefined;

async function assertExecutable(binaryPath: string) {
  await access(binaryPath, constants.X_OK);
}

export async function getFfmpegBinaryPath(): Promise<string> {
  if (cachedBinaryPath) return cachedBinaryPath;

  const candidates = [
    process.env.FFMPEG_PATH?.trim(),
    ffmpegStatic,
    path.join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg"),
  ].filter((value): value is string => Boolean(value));

  let source: string | undefined;
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
      source = candidate;
      break;
    } catch {
      // try next candidate
    }
  }

  if (!source) {
    throw new Error("ffmpeg binary not found. Install ffmpeg-static or set FFMPEG_PATH.");
  }

  if (process.env.VERCEL) {
    const dest = path.join(os.tmpdir(), "ffmpeg");
    try {
      await assertExecutable(dest);
    } catch {
      await copyFile(source, dest);
      await chmod(dest, 0o755);
      await assertExecutable(dest);
    }
    cachedBinaryPath = dest;
    return dest;
  }

  await assertExecutable(source);
  cachedBinaryPath = source;
  return source;
}
