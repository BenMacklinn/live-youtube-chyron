"use client";

import type { StreamSourcePreset } from "@/lib/stream-sources";

type Props = {
  source: StreamSourcePreset;
  onChange: (source: StreamSourcePreset) => void;
  disabled?: boolean;
};

export function StreamSourceToggle({ source, onChange, disabled }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("production")}
        className={`rounded-md px-4 py-2 text-sm font-medium transition ${
          source === "production"
            ? "bg-blue-600 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Production
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("test")}
        className={`rounded-md px-4 py-2 text-sm font-medium transition ${
          source === "test"
            ? "bg-blue-600 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Test
      </button>
    </div>
  );
}
