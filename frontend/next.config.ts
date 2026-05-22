import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the ffmpeg binary via package tracing, not vercel.json includeFiles.
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
