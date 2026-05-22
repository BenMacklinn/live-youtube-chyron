"use client";

import type { AudioSourceMode } from "@/lib/api";

type Props = {
  sourceUrl?: string;
  sourceMode: AudioSourceMode;
  onSourceModeChange: (mode: AudioSourceMode) => void;
  onStart: () => void;
  onStop: () => void;
  isRunning: boolean;
  disabled?: boolean;
};

export function YouTubeInput({
  sourceUrl,
  sourceMode,
  onSourceModeChange,
  onStart,
  onStop,
  isRunning,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Audio source</p>
            <p className="mt-1 text-xs text-zinc-500">
              {sourceMode === "microphone"
                ? "Browser microphone chunks sent for transcription"
                : "Daily HLS via newsmax-delta resolver"}
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-zinc-300 p-1 dark:border-zinc-700">
            <button
              type="button"
              disabled={disabled || isRunning}
              onClick={() => onSourceModeChange("stream")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                sourceMode === "stream"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              HLS
            </button>
            <button
              type="button"
              disabled={disabled || isRunning}
              onClick={() => onSourceModeChange("microphone")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                sourceMode === "microphone"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              Mic
            </button>
          </div>
          {sourceUrl && sourceMode === "stream" && (
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
            {sourceMode === "microphone" ? "Start Mic" : "Start Stream"}
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
