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

  const inputClassName =
    "w-full min-w-0 border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

  return (
    <section className="flex flex-wrap items-center gap-2 border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Guest</span>
      <label className="min-w-[8rem] flex-1">
        <span className="sr-only">Name</span>
        <input
          type="text"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          onPaste={handleNamePaste}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={GUEST_FIELD_MAX_CHARS}
          placeholder="Name"
          title="Paste name + company from Sheets (tab or wide gap splits fields)"
          className={inputClassName}
        />
      </label>
      <label className="min-w-[8rem] flex-1">
        <span className="sr-only">Company / show</span>
        <input
          type="text"
          value={value.company}
          onChange={(e) => onChange({ ...value, company: e.target.value })}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={GUEST_FIELD_MAX_CHARS}
          placeholder="Company / show"
          className={inputClassName}
        />
      </label>
      {saving && <span className="text-[11px] text-zinc-400">Saving…</span>}
      <div className="ml-auto flex shrink-0 gap-1.5">
        <button
          type="button"
          onClick={onClearNudge}
          disabled={disabled || saving || !hasNudge}
          className="border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || saving || !hasUnsavedChanges}
          className="bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Apply
        </button>
      </div>
    </section>
  );
}
