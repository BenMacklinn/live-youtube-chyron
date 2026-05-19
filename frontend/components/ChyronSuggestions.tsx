"use client";

import { useEffect, useState } from "react";
import type { ChyronOption, ChyronSuggestions } from "@/lib/api";

type Props = {
  suggestions: ChyronSuggestions | null;
  onApprove: (id: string, text: string) => void;
  onReject: (id: string, text: string) => void;
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
}: {
  isRunning: boolean;
  hasSuggestions: boolean;
  secondsUntilNext: number | null;
}) {
  if (!isRunning) return null;

  let label = "Waiting for first chyron batch…";
  if (hasSuggestions && secondsUntilNext !== null) {
    label = secondsUntilNext > 0 ? `Next chyron batch in ${secondsUntilNext}s` : "Generating next batch…";
  }

  return (
    <footer className="shrink-0 border-t border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
      <p className="text-center text-xs font-medium tabular-nums text-zinc-500">{label}</p>
    </footer>
  );
}

export function ChyronSuggestions({
  suggestions,
  onApprove,
  onReject,
  disabled,
  isRunning = false,
  nextBatchAt = null,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const secondsUntilNext = useSecondsUntil(nextBatchAt, isRunning);

  if (!suggestions) {
    return (
      <section className="flex min-h-[320px] flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Chyron Suggestions</h2>
        </header>
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-400">
          Waiting for first batch…
        </div>
        <ChyronCountdown isRunning={isRunning} hasSuggestions={false} secondsUntilNext={secondsUntilNext} />
      </section>
    );
  }

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
    <section className="flex min-h-[320px] flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Chyron Suggestions</h2>
        {suggestions.topic && (
          <p className="mt-1 text-xs text-zinc-500">
            Topic: {suggestions.topic}
            {suggestions.entities.length > 0 && ` · ${suggestions.entities.join(", ")}`}
          </p>
        )}
        {suggestions.sessionSummary && (
          <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            <span className="font-medium text-zinc-500">Session context: </span>
            {suggestions.sessionSummary}
          </p>
        )}
      </header>
      <div className="space-y-3 p-4">
        {suggestions.chyronOptions.map((opt) => (
          <div key={opt.id} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            {editingId === opt.id ? (
              <div className="space-y-2">
                <input
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  maxLength={60}
                  className="w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => submitEdit(opt.id)}
                    className="rounded bg-green-600 px-3 py-1 text-xs text-white"
                  >
                    Save & Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded border px-3 py-1 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="font-mono text-sm font-semibold tracking-wide">{opt.text}</p>
                {opt.rationale && <p className="mt-1 text-xs text-zinc-500">{opt.rationale}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onApprove(opt.id, opt.text)}
                    className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => startEdit(opt)}
                    className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-900"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onReject(opt.id, opt.text)}
                    className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <ChyronCountdown isRunning={isRunning} hasSuggestions secondsUntilNext={secondsUntilNext} />
    </section>
  );
}
