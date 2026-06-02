"use client";

import { useEffect, useRef, useState } from "react";
import { LiveTranscript } from "@/components/LiveTranscript";
import { ChyronSuggestions } from "@/components/ChyronSuggestions";
import type { ChyronSuggestions as ChyronSuggestionsType } from "@/lib/api";

type Props = {
  segments: string[];
  partial: string;
  suggestions: ChyronSuggestionsType | null;
  onApprove: (id: string, text: string) => void;
  onReject: (id: string, text: string) => void;
  onGenerateNow?: () => void | Promise<void>;
  generating?: boolean;
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
  onGenerateNow,
  generating,
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
  }, [suggestions, isRunning, nextBatchAt, generating]);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <LiveTranscript segments={segments} partial={partial} maxHeight={chyronHeight ?? undefined} />
      <div ref={chyronRef} className="h-fit">
        <ChyronSuggestions
          suggestions={suggestions}
          onApprove={onApprove}
          onReject={onReject}
          onGenerateNow={onGenerateNow}
          generating={generating}
          disabled={disabled}
          isRunning={isRunning}
          nextBatchAt={nextBatchAt}
        />
      </div>
    </div>
  );
}
