"use client";

type Props = {
  sourceUrl?: string;
  onStart: () => void;
  onStop: () => void;
  isRunning: boolean;
  disabled?: boolean;
};

export function YouTubeInput({ sourceUrl, onStart, onStop, isRunning, disabled }: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Stream source</p>
            <p className="mt-1 text-xs text-zinc-500">Daily HLS via newsmax-delta resolver</p>
          </div>
          {sourceUrl && (
            <p className="break-all text-xs text-zinc-400">
              Active source: <span className="font-mono">{sourceUrl}</span>
            </p>
          )}
        </div>
        {!isRunning ? (
          <button
            type="button"
            onClick={onStart}
            disabled={disabled}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start Stream
          </button>
        ) : (
          <button
            type="button"
            onClick={onStop}
            className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}
