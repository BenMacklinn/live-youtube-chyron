"use client";

import { useEffect, useState } from "react";
import type { ChyronOption, ChyronSuggestions } from "@/lib/api";

type Props = {
  suggestions: ChyronSuggestions | null;
  onApprove: (id: string, text: string) => void;
  onReject: (id: string, text: string) => void;
  onGenerateNow?: () => void | Promise<void>;
  generating?: boolean;
  disabled?: boolean;
  isRunning?: boolean;
  nextBatchAt?: number | null;
};

function useSecondsUntil(targetUnixSec: number | null | undefined, active: boolean) {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !targetUnixSec) {
      const resetId = window.setTimeout(() => setSeconds(null), 0);
      return () => window.clearTimeout(resetId);
    }

    const tick = () => {
      const remaining = Math.ceil(targetUnixSec - Date.now() / 1000);
      setSeconds(remaining > 0 ? remaining : 0);
    };

    const tickId = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(tickId);
      window.clearInterval(id);
    };
  }, [targetUnixSec, active]);

  return seconds;
}

function ChyronCountdown({
  isRunning,
  hasSuggestions,
  secondsUntilNext,
  onGenerateNow,
  generating,
  disabled,
}: {
  isRunning: boolean;
  hasSuggestions: boolean;
  secondsUntilNext: number | null;
  onGenerateNow?: () => void | Promise<void>;
  generating?: boolean;
  disabled?: boolean;
}) {
  if (!isRunning) return null;

  let label = "Waiting for first chyron batch…";
  if (generating) {
    label = "Generating…";
  } else if (hasSuggestions && secondsUntilNext !== null) {
    label = secondsUntilNext > 0 ? `Next batch in ${secondsUntilNext}s` : "Generating next batch…";
  }

  return (
    <footer className="shrink-0 border-t border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        {onGenerateNow ? (
          <button
            type="button"
            disabled={disabled || generating}
            onClick={() => void onGenerateNow()}
            className="shrink-0 border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {generating ? "Generating…" : "Generate now"}
          </button>
        ) : null}
        <p className="flex-1 truncate text-center text-[11px] font-medium tabular-nums text-zinc-500">{label}</p>
      </div>
    </footer>
  );
}

export function ChyronSuggestions({
  suggestions,
  onApprove,
  onReject,
  onGenerateNow,
  generating = false,
  disabled,
  isRunning = false,
  nextBatchAt = null,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const secondsUntilNext = useSecondsUntil(nextBatchAt, isRunning && !generating);

  const startEdit = (opt: ChyronOption) => {
    setEditingId(opt.id);
    setEditText(opt.text);
  };

  const submitEdit = (id: string) => {
    onApprove(id, editText.trim().toUpperCase());
    setEditingId(null);
    setEditText("");
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="shrink-0 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Chyron Suggestions</h2>
        {suggestions?.sessionSummary && (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500" title={suggestions.sessionSummary}>
            {suggestions.sessionSummary}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!suggestions ? (
          <p className="flex h-full items-center justify-center text-xs text-zinc-400">Waiting for first batch…</p>
        ) : (suggestions.chyronOptions?.length ?? 0) === 0 ? (
          <p className="text-xs text-zinc-400">No chyrons in this batch — retrying on next cadence…</p>
        ) : (
          <div className="space-y-2">
            {suggestions.chyronOptions.map((opt) => (
              <div key={opt.id} className="border border-zinc-200 p-2 dark:border-zinc-700">
                {editingId === opt.id ? (
                  <div className="space-y-1.5">
                    <input
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={39}
                      className="w-full border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => submitEdit(opt.id)}
                        className="bg-green-800 px-2 py-0.5 text-[11px] text-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="border px-2 py-0.5 text-[11px]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="font-mono text-xs font-semibold tracking-wide">{opt.text}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onApprove(opt.id, opt.text)}
                        className="bg-green-800 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-green-900 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => startEdit(opt)}
                        className="border border-zinc-300 px-2 py-0.5 text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-900"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onReject(opt.id, opt.text)}
                        className="border border-red-200 px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                      >
                        Reject
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ChyronCountdown
        isRunning={isRunning}
        hasSuggestions={Boolean(suggestions)}
        secondsUntilNext={secondsUntilNext}
        onGenerateNow={onGenerateNow}
        generating={generating}
        disabled={disabled}
      />
    </section>
  );
}
