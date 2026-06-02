"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration, formatUsd } from "@/lib/youtube";
import type { UsageStats } from "@/lib/api";

type Props = {
  usage: UsageStats | null;
};

export function UsagePanel({ usage }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const buttonLabel = usage ? formatUsd(usage.totalCostUsd) : "Usage";

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        {buttonLabel}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-80 border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Live usage & cost</h2>
          {!usage ? (
            <p className="mt-3 text-sm text-zinc-500">Usage stats appear once a session starts.</p>
          ) : (
            <div className="mt-3 space-y-4">
              <Stat
                label="Audio processed"
                value={formatDuration(usage.audioSeconds)}
                sub={`${usage.transcriptionModel ?? usage.realtimeModel}`}
              />
              <Stat
                label="Transcription est."
                value={formatUsd(usage.transcriptionCostUsd)}
                sub={`${usage.audioMinutes.toFixed(2)} min × $${(usage.transcriptionPricePerMin ?? 0.017).toFixed(3)}/min`}
              />
              <Stat
                label="Chyron tokens"
                value={`${usage.chyronInputTokens.toLocaleString()} in / ${usage.chyronOutputTokens.toLocaleString()} out`}
                sub={`${usage.chyronRequests} batches · ${usage.chyronModel}`}
              />
              <Stat
                label="Total est."
                value={formatUsd(usage.totalCostUsd)}
                sub={`Chyron ${formatUsd(usage.chyronCostUsd)} + transcription ${formatUsd(usage.transcriptionCostUsd)}`}
                highlight
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 font-mono text-base ${highlight ? "font-bold text-green-800 dark:text-green-400" : ""}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{sub}</p>
    </div>
  );
}
