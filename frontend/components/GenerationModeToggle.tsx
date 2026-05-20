"use client";

import type { ChyronGenerationMode } from "@/lib/api";

type Props = {
  mode: ChyronGenerationMode;
  onChange: (mode: ChyronGenerationMode) => void;
  disabled?: boolean;
};

export function GenerationModeToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("timeline")}
        className={`rounded-md px-4 py-2 text-sm font-medium transition ${
          mode === "timeline"
            ? "bg-blue-600 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Timeline
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("guest")}
        className={`rounded-md px-4 py-2 text-sm font-medium transition ${
          mode === "guest"
            ? "bg-blue-600 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Guest
      </button>
    </div>
  );
}
