"use client";

import { useEffect, useRef } from "react";

type Props = {
  segments: string[];
  partial: string;
};

export function LiveTranscript({ segments, partial }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [segments, partial]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="shrink-0 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Live Transcript</h2>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-3 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200"
      >
        {segments.length === 0 && !partial && (
          <p className="text-zinc-400">Transcript will appear here once audio is processed…</p>
        )}
        {segments.map((segment, i) => (
          <p key={`${i}-${segment.slice(0, 24)}`} className="mb-1.5">
            {segment}
          </p>
        ))}
        {partial && <p className="text-zinc-500 italic">{partial}</p>}
      </div>
    </section>
  );
}
