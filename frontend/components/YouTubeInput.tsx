"use client";

type Props = {
  url: string;
  startAt: string;
  onUrlChange: (url: string) => void;
  onStartAtChange: (startAt: string) => void;
  onStart: () => void;
  onStop: () => void;
  isRunning: boolean;
  disabled?: boolean;
};

export function YouTubeInput({
  url,
  startAt,
  onUrlChange,
  onStartAtChange,
  onStart,
  onStop,
  isRunning,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          disabled={isRunning || disabled}
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        {!isRunning ? (
          <button
            type="button"
            onClick={onStart}
            disabled={disabled || !url.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start
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
      <div className="flex items-center gap-3">
        <label htmlFor="start-at" className="shrink-0 text-sm text-zinc-500">
          Start at
        </label>
        <input
          id="start-at"
          type="text"
          value={startAt}
          onChange={(e) => onStartAtChange(e.target.value)}
          placeholder="10:00"
          disabled={isRunning || disabled}
          className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <span className="text-xs text-zinc-400">mm:ss or minutes (e.g. 10 = 10:00)</span>
      </div>
    </div>
  );
}
