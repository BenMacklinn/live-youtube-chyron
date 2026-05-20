"use client";

import { useEffect, useRef, useState } from "react";
import { LiveTranscript } from "@/components/LiveTranscript";
import { ChyronSuggestions } from "@/components/ChyronSuggestions";
import { RecentSummary } from "@/components/RecentSummary";
import type { ChyronSuggestions as ChyronSuggestionsType } from "@/lib/api";

type Props = {
  segments: string[];
  partial: string;
  suggestions: ChyronSuggestionsType | null;
  onApprove: (id: string, text: string) => void;
  onReject: (id: string, text: string) => void;
  disabled?: boolean;
  isRunning?: boolean;
  nextBatchAt?: number | null;
};

export function TranscriptChyronColumns({
  segments,
  partial,
  suggestions,
  onApprove,
  onReject,
  disabled,
  isRunning,
  nextBatchAt,
}: Props) {
  const chyronRef = useRef<HTMLDivElement>(null);
  const [chyronHeight, setChyronHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = chyronRef.current;
    if (!el) return;

    const update = () => setChyronHeight(el.offsetHeight);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [suggestions, isRunning, nextBatchAt]);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-3 lg:grid-cols-2">
      <LiveTranscript segments={segments} partial={partial} maxHeight={chyronHeight ?? undefined} />
      <RecentSummary summary={suggestions?.recentSummary} isRunning={isRunning} />
      <div ref={chyronRef} className="h-fit lg:col-span-2 xl:col-span-1">
        <ChyronSuggestions
          suggestions={suggestions}
          onApprove={onApprove}
          onReject={onReject}
          disabled={disabled}
          isRunning={isRunning}
          nextBatchAt={nextBatchAt}
        />
      </div>
    </div>
  );
}
