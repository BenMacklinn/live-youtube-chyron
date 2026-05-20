"use client";

type Props = {
  summary: string | null | undefined;
  isRunning?: boolean;
};

export function RecentSummary({ summary, isRunning = false }: Props) {
  return (
    <section className="flex min-h-[320px] flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Right Now</h2>
        <p className="mt-1 text-xs text-zinc-500">Plain-language recap of the last ~30 seconds</p>
      </header>
      <div className="flex flex-1 flex-col justify-center p-4">
        {summary ? (
          <p className="text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{summary}</p>
        ) : (
          <p className="text-sm text-zinc-400">
            {isRunning ? "Listening for speech…" : "Start a session to see what they are talking about."}
          </p>
        )}
      </div>
    </section>
  );
}
