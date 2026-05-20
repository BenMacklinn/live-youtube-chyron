export type StreamSourcePreset = "production" | "test";

export const STREAM_SOURCE_LABELS: Record<StreamSourcePreset, string> = {
  production: "Production",
  test: "Test",
};

export const STREAM_SOURCE_HINTS: Record<StreamSourcePreset, string> = {
  production: "Daily HLS via newsmax-delta resolver",
  test: "CloudFront HLS test playlist",
};
