"use client";

import type { ChyronGenerationMode } from "@/lib/api";

type Props = {
  mode: ChyronGenerationMode;
  onChange: (mode: ChyronGenerationMode) => void;
  disabled?: boolean;
};

export function GenerationModeToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="inline-flex shrink-0 border border-zinc-300 p-0.5 dark:border-zinc-700">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("timeline")}
        className={`px-3 py-1 text-xs font-medium transition ${
          mode === "timeline"
            ? "bg-green-800 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Timeline
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("guest")}
        className={`px-3 py-1 text-xs font-medium transition ${
          mode === "guest"
            ? "bg-green-800 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Guest
      </button>
    </div>
  );
}
