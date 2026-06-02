"use client";

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
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
      <LiveTranscript segments={segments} partial={partial} />
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
  );
}
