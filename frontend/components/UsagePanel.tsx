"use client";

import { formatDuration, formatUsd } from "@/lib/youtube";
import type { UsageStats } from "@/lib/api";

type Props = {
  usage: UsageStats | null;
};

export function UsagePanel({ usage }: Props) {
  if (!usage) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Usage stats appear once a session starts.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Live usage & cost</h2>
      </header>
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
    </section>
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
      <p className={`mt-1 font-mono text-lg ${highlight ? "font-bold text-blue-600 dark:text-blue-400" : ""}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{sub}</p>
    </div>
  );
}
