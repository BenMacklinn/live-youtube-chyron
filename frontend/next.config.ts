import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/sessions/[sessionId]/process": ["./node_modules/ffmpeg-static/**/*"],
  },
};

export default nextConfig;
