"use client";

export type GuestContextDraft = {
  name: string;
  company: string;
};

const GUEST_FIELD_MAX_CHARS = 120;

/** Split a Sheets paste (tab or wide whitespace gap) into name + company. */
function splitGuestPaste(text: string): GuestContextDraft | null {
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return null;

  const firstLine = trimmed.split("\n")[0]?.trim() ?? trimmed;

  if (firstLine.includes("\t")) {
    const parts = firstLine.split("\t").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        name: parts[0].slice(0, GUEST_FIELD_MAX_CHARS),
        company: parts.slice(1).join(" ").slice(0, GUEST_FIELD_MAX_CHARS),
      };
    }
    return null;
  }

  const wideGap = firstLine.match(/^(.+?)\s{2,}(.+)$/);
  if (wideGap) {
    return {
      name: wideGap[1].trim().slice(0, GUEST_FIELD_MAX_CHARS),
      company: wideGap[2].trim().slice(0, GUEST_FIELD_MAX_CHARS),
    };
  }

  return null;
}

type Props = {
  value: GuestContextDraft;
  onChange: (value: GuestContextDraft) => void;
  onSubmit: () => void;
  onClearNudge?: () => void;
  disabled?: boolean;
  saving?: boolean;
  hasUnsavedChanges?: boolean;
  hasNudge?: boolean;
};

export function ProducerGuidance({
  value,
  onChange,
  onSubmit,
  onClearNudge,
  disabled,
  saving,
  hasUnsavedChanges,
  hasNudge,
}: Props) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!disabled && !saving) onSubmit();
    }
  };

  const handleNamePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const split = splitGuestPaste(e.clipboardData.getData("text"));
    if (!split) return;

    e.preventDefault();
    onChange(split);
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Guest Context</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Used in Guest mode — fill both + Apply. Ignored in Timeline mode.
            </p>
          </div>
          {saving && <span className="text-xs text-zinc-400">Saving…</span>}
        </div>
      </header>
      <div className="space-y-3 p-4">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Name</span>
          <input
            type="text"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            onPaste={handleNamePaste}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            maxLength={GUEST_FIELD_MAX_CHARS}
            placeholder="e.g. Tae Kim"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Company / show</span>
          <input
            type="text"
            value={value.company}
            onChange={(e) => onChange({ ...value, company: e.target.value })}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            maxLength={GUEST_FIELD_MAX_CHARS}
            placeholder="e.g. TBPN"
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-zinc-400">
              Paste name + company from Sheets into Name (tab or wide gap splits fields). Press{" "}
              <kbd className="rounded border border-zinc-300 px-1 font-mono text-[10px] dark:border-zinc-600">Enter</kbd>{" "}
              in either field to apply.
            </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClearNudge}
              disabled={disabled || saving || !hasNudge}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Clear guest
            </button>
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
      </div>
    </section>
  );
}
