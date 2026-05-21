"use client";

import type { ApprovedLogEntry } from "@/lib/api";

type Props = {
  activeChyron: string;
  log: ApprovedLogEntry[];
};

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString();
}

export function ApprovedTextOutput({ activeChyron, log }: Props) {
  const fullLog = log.map((e) => `[${formatTime(e.timestamp)}] ${e.text}`).join("\n");

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const download = () => {
    const blob = new Blob([fullLog || activeChyron || ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chyron-log-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Approved Text Output</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => copy(activeChyron)}
            disabled={!activeChyron}
            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600"
          >
            Copy Active
          </button>
          <button
            type="button"
            onClick={() => copy(fullLog)}
            disabled={log.length === 0}
            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600"
          >
            Copy Log
          </button>
          <button
            type="button"
            onClick={download}
            disabled={log.length === 0 && !activeChyron}
            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-600"
          >
            Download .txt
          </button>
        </div>
      </header>
      <div className="p-4">
        <p className="mb-1 text-xs font-medium uppercase text-zinc-500">Active Chyron</p>
        <p className="min-h-[3rem] font-mono text-base font-bold tracking-wide">
          {activeChyron || "—"}
        </p>
      </div>
      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="mb-2 text-xs font-medium uppercase text-zinc-500">Session Log</p>
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-zinc-600 dark:text-zinc-400">
          {fullLog || "No approved chyrons yet."}
        </pre>
      </div>
    </section>
  );
}
