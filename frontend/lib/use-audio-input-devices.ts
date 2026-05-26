"use client";

import { useCallback, useEffect, useState } from "react";

export type AudioInputDevice = {
  deviceId: string;
  label: string;
};

export type AudioInputPermission = "unsupported" | "prompt" | "granted" | "denied";

function formatDeviceLabel(device: MediaDeviceInfo, index: number) {
  const trimmed = device.label.trim();
  if (trimmed) return trimmed;
  return `Microphone ${index + 1}`;
}

export function useAudioInputDevices(enabled: boolean) {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [permission, setPermission] = useState<AudioInputPermission>("prompt");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setPermission("unsupported");
      setDevices([]);
      return;
    }

    const inputs = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "audioinput" && device.deviceId)
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: formatDeviceLabel(device, index),
      }));

    setDevices(inputs);
    setSelectedDeviceId((current) => {
      if (current && inputs.some((device) => device.deviceId === current)) return current;
      return inputs[0]?.deviceId ?? null;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      setError("Microphone capture is not available in this browser.");
      setDevices([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
          setPermission(status.state === "granted" ? "granted" : status.state === "denied" ? "denied" : "prompt");
        } catch {
          // Some browsers do not support microphone permission queries.
        }
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setPermission("granted");
      } catch (err) {
        setPermission("denied");
        throw err;
      } finally {
        stream?.getTracks().forEach((track) => track.stop());
      }

      await listDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to access microphones");
      try {
        await listDevices();
      } catch {
        setDevices([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [listDevices]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || permission !== "granted") return;

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;

    const handleDeviceChange = () => {
      void listDevices();
    };

    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [enabled, permission, listDevices]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    permission,
    isLoading,
    error,
    refresh,
  };
}
