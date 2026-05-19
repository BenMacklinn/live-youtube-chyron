"use client";

import type { SessionMode } from "@/lib/api";

type Props = {
  mode: SessionMode;
  onChange: (mode: SessionMode) => void;
  disabled?: boolean;
};

export function ModeToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("chyron")}
        className={`rounded-md px-4 py-2 text-sm font-medium transition ${
          mode === "chyron"
            ? "bg-blue-600 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Chyron
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange("verbatim")}
        className={`rounded-md px-4 py-2 text-sm font-medium transition ${
          mode === "verbatim"
            ? "bg-blue-600 text-white"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        Verbatim
      </button>
    </div>
  );
}
