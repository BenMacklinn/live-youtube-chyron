"use client";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  saving?: boolean;
  hasUnsavedChanges?: boolean;
};

export function ProducerGuidance({
  value,
  onChange,
  onSubmit,
  disabled,
  saving,
  hasUnsavedChanges,
}: Props) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !saving) onSubmit();
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Producer Guidance</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Type who is on and what they are discussing — especially after Clear Context
            </p>
          </div>
          {saving && <span className="text-xs text-zinc-400">Saving…</span>}
        </div>
      </header>
      <div className="p-4">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={3}
          maxLength={500}
          placeholder={'e.g. "Tae Kim live on TBPN" — press Enter to apply'}
          className="w-full resize-y rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-400">
            Press <kbd className="rounded border border-zinc-300 px-1 font-mono text-[10px] dark:border-zinc-600">Enter</kbd> to
            apply ground truth. <kbd className="rounded border border-zinc-300 px-1 font-mono text-[10px] dark:border-zinc-600">Shift+Enter</kbd> for a new line.
          </p>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || saving || !hasUnsavedChanges}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Apply
          </button>
        </div>
      </div>
    </section>
  );
}
