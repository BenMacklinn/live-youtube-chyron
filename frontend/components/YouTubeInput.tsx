"use client";

import type { AudioSourceMode } from "@/lib/api";
import type { AudioInputDevice } from "@/lib/use-audio-input-devices";

type Props = {
  sourceUrl?: string;
  sourceMode: AudioSourceMode;
  onSourceModeChange: (mode: AudioSourceMode) => void;
  micDevices?: AudioInputDevice[];
  selectedMicDeviceId?: string | null;
  onMicDeviceChange?: (deviceId: string) => void;
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
  sourceMode,
  onSourceModeChange,
  micDevices = [],
  selectedMicDeviceId,
  onMicDeviceChange,
  micDevicesLoading = false,
  micDevicesError,
  onRefreshMicDevices,
  onStart,
  onStop,
  isRunning,
  disabled,
}: Props) {
  const micReady = sourceMode !== "microphone" || Boolean(selectedMicDeviceId);
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
          {sourceMode === "microphone" && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs font-medium text-zinc-500">Input device</span>
                <select
                  value={selectedMicDeviceId ?? ""}
                  onChange={(event) => onMicDeviceChange?.(event.target.value)}
                  disabled={disabled || isRunning || micDevicesLoading || micDevices.length === 0}
                  className="mt-1 w-full max-w-md rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {micDevices.length === 0 ? (
                    <option value="">
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
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRefreshMicDevices?.()}
                  disabled={disabled || isRunning || micDevicesLoading}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  {micDevicesLoading ? "Refreshing…" : "Refresh devices"}
                </button>
                {micDevicesError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{micDevicesError}</p>
                )}
              </div>
            </div>
          )}
        </div>
        {!isRunning ? (
          <button
            type="button"
            onClick={onStart}
            disabled={disabled || !micReady}
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
