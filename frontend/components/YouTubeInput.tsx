"use client";

import type { AudioInputDevice } from "@/lib/use-audio-input-devices";

export const STREAM_INPUT_ID = "stream";

type Props = {
  sourceUrl?: string;
  selectedInputId: string;
  onInputChange: (inputId: string) => void;
  micDevices?: AudioInputDevice[];
  micDevicesLoading?: boolean;
  micDevicesError?: string | null;
  onRefreshMicDevices?: () => void;
  onStart: () => void;
  onStop: () => void;
  isRunning: boolean;
  disabled?: boolean;
};

export function YouTubeInput({
  sourceUrl,
  selectedInputId,
  onInputChange,
  micDevices = [],
  micDevicesLoading = false,
  micDevicesError,
  onRefreshMicDevices,
  onStart,
  onStop,
  isRunning,
  disabled,
}: Props) {
  const usingStream = selectedInputId === STREAM_INPUT_ID;
  const startReady = usingStream || Boolean(selectedInputId);

  return (
    <div className="flex flex-wrap items-center gap-2 border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <label className="flex min-w-[12rem] flex-1 items-center gap-2">
        <span className="sr-only">Audio input</span>
        <select
          value={selectedInputId}
          onChange={(event) => onInputChange(event.target.value)}
          disabled={disabled || isRunning}
          className="min-w-0 flex-1 border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 focus:border-zinc-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value={STREAM_INPUT_ID}>Live Stream</option>
          {micDevices.length === 0 ? (
            <option value="" disabled>
              {micDevicesLoading ? "Detecting microphones…" : "No microphones found"}
            </option>
          ) : (
            micDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))
          )}
        </select>
      </label>

      <button
        type="button"
        onClick={() => onRefreshMicDevices?.()}
        disabled={disabled || isRunning || micDevicesLoading}
        className="shrink-0 border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        Refresh
      </button>

      {sourceUrl && usingStream && (
        <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-400">
          <span className="font-mono">{sourceUrl}</span>
        </p>
      )}

      {micDevicesError && (
        <p className="text-[11px] text-red-600 dark:text-red-400">{micDevicesError}</p>
      )}

      {!isRunning ? (
        <button
          type="button"
          onClick={onStart}
          disabled={disabled || !startReady}
          className="ml-auto shrink-0 bg-green-800 px-3 py-1 text-xs font-medium text-white hover:bg-green-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {usingStream ? "Start Stream" : "Start Mic"}
        </button>
      ) : (
        <button
          type="button"
          onClick={onStop}
          className="ml-auto shrink-0 bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
        >
          Stop
        </button>
      )}
    </div>
  );
}
