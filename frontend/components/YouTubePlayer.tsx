"use client";

import { extractYouTubeId, youtubeEmbedUrl } from "@/lib/youtube";

type Props = {
  url: string;
  startSec: number;
  active: boolean;
};

export function YouTubePlayer({ url, startSec, active }: Props) {
  const videoId = extractYouTubeId(url);

  if (!active || !videoId) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-800">
      <div className="border-b border-zinc-800 px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
        Video audio
      </div>
      <div className="aspect-video w-full">
        <iframe
          key={`${videoId}-${startSec}`}
          src={youtubeEmbedUrl(videoId, startSec)}
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    </section>
  );
}
