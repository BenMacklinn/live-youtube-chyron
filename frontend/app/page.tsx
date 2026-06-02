"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApprovedTextOutput } from "@/components/ApprovedTextOutput";
import { TranscriptChyronColumns } from "@/components/TranscriptChyronColumns";
import { GenerationModeToggle } from "@/components/GenerationModeToggle";
import { UsagePanel } from "@/components/UsagePanel";
import { ProducerGuidance, type GuestContextDraft } from "@/components/ProducerGuidance";
import { YouTubeInput } from "@/components/YouTubeInput";
import {
  approveChyron,
  clearSessionContext,
  createSession,
  generateChyronsNow,
  getSessionSnapshot,
  rejectChyron,
  setGuestContext,
  setChyronGenerationMode,
  stopSession,
  uploadMicrophoneChunk,
  type ApprovedLogEntry,
  type AudioSourceMode,
  type ChyronGenerationMode,
  type ChyronSuggestions as ChyronSuggestionsType,
  type LiveMessage,
  type UsageStats,
} from "@/lib/api";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useAudioInputDevices } from "@/lib/use-audio-input-devices";

const emptyGuestContext = (): GuestContextDraft => ({ name: "", company: "" });
const MIC_CHUNK_MS = 2_500;

function guestContextsEqual(a: GuestContextDraft, b: GuestContextDraft) {
  return a.name.trim() === b.name.trim() && a.company.trim() === b.company.trim();
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>("stream");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const [generationMode, setGenerationMode] = useState<ChyronGenerationMode>("timeline");
  const [segments, setSegments] = useState<string[]>([]);
  const [partial, setPartial] = useState("");
  const [suggestions, setSuggestions] = useState<ChyronSuggestionsType | null>(null);
  const [activeChyron, setActiveChyron] = useState("");
  const [approvedLog, setApprovedLog] = useState<ApprovedLogEntry[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [starting, setStarting] = useState(false);
  const [generatingChyrons, setGeneratingChyrons] = useState(false);
  const [contextNotice, setContextNotice] = useState("");
  const [nextChyronBatchAt, setNextChyronBatchAt] = useState<number | null>(null);
  const [liveConnection, setLiveConnection] = useState<"idle" | "connecting" | "live" | "reconnecting">("idle");
  const [guestContext, setGuestContextState] = useState<GuestContextDraft>(emptyGuestContext);
  const [guestDraft, setGuestDraft] = useState<GuestContextDraft>(emptyGuestContext);
  const [guestSaving, setGuestSaving] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const microphoneQueueRef = useRef<Promise<void>>(Promise.resolve());
  const microphoneCaptureActiveRef = useRef(false);
  const recordMicrophoneSliceRef = useRef<(sessionId: string, stream: MediaStream, mimeType: string) => void>(() => {});
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);
  const {
    devices: micDevices,
    selectedDeviceId: selectedMicDeviceId,
    setSelectedDeviceId: setSelectedMicDeviceId,
    isLoading: micDevicesLoading,
    error: micDevicesError,
    refresh: refreshMicDevices,
  } = useAudioInputDevices(sourceMode === "microphone");

  const isRunning = status === "connecting" || status === "transcribing";

  const handleMessage = useCallback((msg: LiveMessage) => {
    switch (msg.type) {
      case "session.status":
        setStatus(msg.status);
        if (msg.error) setError(msg.error);
        break;
      case "transcript.delta":
        setPartial((p) => p + msg.delta);
        break;
      case "transcript.segment":
        setSegments((s) => [...s, msg.text]);
        setPartial("");
        break;
      case "chyron.suggestions": {
        const chyronOptions = msg.chyronOptions ?? [];
        const entities = msg.entities ?? [];
        setContextNotice("");
        setSuggestions((prev) => ({
          batchId: chyronOptions.length > 0 ? msg.batchId : (prev?.batchId ?? msg.batchId),
          sessionSummary: msg.sessionSummary || prev?.sessionSummary || "",
          topic: msg.topic || prev?.topic || "",
          entities: entities.length > 0 ? entities : (prev?.entities ?? []),
          chyronOptions: chyronOptions.length > 0 ? chyronOptions : (prev?.chyronOptions ?? []),
          verbatimCaption: msg.verbatimCaption || prev?.verbatimCaption || "",
          recentSummary: msg.recentSummary || prev?.recentSummary || "",
        }));
        setNextChyronBatchAt(
          msg.nextBatchAt ?? Date.now() / 1000 + (msg.chyronCadenceSec ?? 8),
        );
        break;
      }
      case "chyron.approved":
        setActiveChyron(msg.text);
        break;
      case "chyron.log":
        setApprovedLog((log) => [...log, { text: msg.text, timestamp: msg.timestamp }]);
        break;
      case "generation_mode.changed":
        setGenerationMode(msg.generationMode);
        break;
      case "usage.update":
        setUsage({
          audioSeconds: msg.audioSeconds,
          audioMinutes: msg.audioMinutes,
          chyronInputTokens: msg.chyronInputTokens,
          chyronOutputTokens: msg.chyronOutputTokens,
          chyronRequests: msg.chyronRequests,
          transcriptionCostUsd: msg.transcriptionCostUsd,
          chyronCostUsd: msg.chyronCostUsd,
          totalCostUsd: msg.totalCostUsd,
          realtimeModel: msg.realtimeModel,
          transcriptionModel: msg.transcriptionModel,
          transcriptionPricePerMin: msg.transcriptionPricePerMin,
          chyronModel: msg.chyronModel,
        });
        break;
      case "context.cleared":
        setSegments([]);
        setPartial("");
        setSuggestions(null);
        setNextChyronBatchAt(null);
        setContextNotice("Context cleared. The next chyron batch will start fresh.");
        break;
      case "guidance.updated":
        setGuestContextState({ name: msg.guestName, company: msg.guestCompany });
        setGuestDraft({ name: msg.guestName, company: msg.guestCompany });
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    const connectingTimer = window.setTimeout(() => setLiveConnection("connecting"), 0);

    getSessionSnapshot(sessionId)
      .then((snapshot) => {
        if (cancelled) return;
        setStatus(snapshot.status);
        setGenerationMode(snapshot.generationMode);
        setUrl(snapshot.youtubeUrl);
        setSegments(snapshot.segments);
        setPartial("");
        setSuggestions(snapshot.latestSuggestions);
        setActiveChyron(snapshot.activeChyron);
        setApprovedLog(snapshot.approvedLog);
        setUsage(snapshot.usage);
        setError(snapshot.error);
        setGuestContextState({ name: snapshot.guestName, company: snapshot.guestCompany });
        setGuestDraft({ name: snapshot.guestName, company: snapshot.guestCompany });
        setNextChyronBatchAt(snapshot.latestSuggestions?.nextBatchAt ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load session");
      });

    const channel = supabase
      .channel(`session-events:${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "session_events",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const message = payload.new.payload as LiveMessage;
          handleMessage(message);
        },
      )
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          setLiveConnection("live");
        } else if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT" || subscriptionStatus === "CLOSED") {
          setLiveConnection("reconnecting");
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(connectingTimer);
      setLiveConnection("idle");
      supabase.removeChannel(channel);
    };
  }, [sessionId, handleMessage, supabase]);

  const stopMicrophoneCapture = useCallback(() => {
    microphoneCaptureActiveRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    mediaRecorderRef.current = null;

    const stream = microphoneStreamRef.current;
    stream?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
  }, []);

  useEffect(() => () => stopMicrophoneCapture(), [stopMicrophoneCapture]);

  const recordMicrophoneSlice = useCallback((sessionId: string, stream: MediaStream, mimeType: string) => {
    if (!microphoneCaptureActiveRef.current || stream.getTracks().every((track) => track.readyState === "ended")) {
      return;
    }

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => setError("Microphone recorder failed.");
    recorder.onstop = () => {
      if (!microphoneCaptureActiveRef.current) return;
      recordMicrophoneSliceRef.current(sessionId, stream, mimeType);
      if (chunks.length === 0) return;

      const audio = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      const durationSec = Math.max(1, (Date.now() - startedAt) / 1000);
      microphoneQueueRef.current = microphoneQueueRef.current
        .catch(() => undefined)
        .then(() => uploadMicrophoneChunk(sessionId, audio, durationSec))
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Failed to process microphone audio");
        });
    };

    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }, MIC_CHUNK_MS);
  }, []);

  useEffect(() => {
    recordMicrophoneSliceRef.current = recordMicrophoneSlice;
  }, [recordMicrophoneSlice]);

  const startMicrophoneCapture = useCallback(async (deviceId: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not available in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    });
    microphoneStreamRef.current = stream;

    const { sessionId: id } = await createSession("", undefined, 0, generationMode, "microphone");
    setSessionId(id);
    setStatus("connecting");

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    microphoneCaptureActiveRef.current = true;
    microphoneQueueRef.current = Promise.resolve();
    recordMicrophoneSlice(id, stream, mimeType);
  }, [generationMode, recordMicrophoneSlice]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setSegments([]);
    setPartial("");
    setSuggestions(null);
    setActiveChyron("");
    setApprovedLog([]);
    setUsage(null);
    setContextNotice("");
    setNextChyronBatchAt(null);
    setGuestContextState(emptyGuestContext());
    setGuestDraft(emptyGuestContext());

    try {
      if (sourceMode === "microphone") {
        if (!selectedMicDeviceId) {
          throw new Error("Select a microphone input device before starting.");
        }
        await startMicrophoneCapture(selectedMicDeviceId);
      } else {
        const { sessionId: id } = await createSession("", undefined, 0, generationMode, "stream");
        setSessionId(id);
        setStatus("connecting");
      }
    } catch (e) {
      stopMicrophoneCapture();
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    stopMicrophoneCapture();
    if (sessionId) {
      try {
        await stopSession(sessionId);
      } catch {
        /* session may already be ended */
      }
    }
    setStatus("ended");
  };

  const handleGenerationModeChange = async (next: ChyronGenerationMode) => {
    setGenerationMode(next);
    if (!sessionId) return;
    try {
      await setChyronGenerationMode(sessionId, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set generation mode");
    }
  };

  const handleApprove = async (id: string, text: string) => {
    setActiveChyron(text);
    if (!sessionId) return;
    try {
      await approveChyron(sessionId, id, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve chyron");
    }
  };

  const handleReject = async (id: string, text: string) => {
    if (!sessionId) return;
    try {
      await rejectChyron(sessionId, id, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject chyron");
    }
  };

  const handleGuestSubmit = async () => {
    if (!sessionId) return;
    const next = { name: guestDraft.name.trim(), company: guestDraft.company.trim() };
    if (guestContextsEqual(next, guestContext)) return;

    setGuestSaving(true);
    try {
      await setGuestContext(sessionId, next.name, next.company);
      setGuestContextState(next);
      setGuestDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save guest context");
    } finally {
      setGuestSaving(false);
    }
  };

  const applyContextClearedLocally = useCallback(() => {
    setSegments([]);
    setPartial("");
    setSuggestions(null);
    setNextChyronBatchAt(null);
  }, []);

  const handleClearContext = useCallback(async () => {
    if (!sessionId) return;
    applyContextClearedLocally();
    setContextNotice("Context cleared. The next chyron batch will start fresh.");
    try {
      await clearSessionContext(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear context");
    }
  }, [sessionId, applyContextClearedLocally]);

  const handleGenerateNow = async () => {
    if (!sessionId) return;
    setGeneratingChyrons(true);
    setError(null);
    try {
      const result = await generateChyronsNow(sessionId);
      if (result.nextBatchAt) {
        setNextChyronBatchAt(result.nextBatchAt);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate chyrons");
    } finally {
      setGeneratingChyrons(false);
    }
  };

  const handleClearGuest = async () => {
    if (!sessionId) return;
    if (!guestContext.name && !guestContext.company && !guestDraft.name.trim() && !guestDraft.company.trim()) {
      return;
    }

    setGuestSaving(true);
    try {
      await setGuestContext(sessionId, "", "");
      const cleared = emptyGuestContext();
      setGuestContextState(cleared);
      setGuestDraft(cleared);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear guest");
    } finally {
      setGuestSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Live Stream Chyron Pipeline</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Start live HLS or microphone input and generate broadcast chyron suggestions every 8 seconds.
          </p>
        </header>

        <YouTubeInput
          sourceUrl={url}
          sourceMode={sourceMode}
          onSourceModeChange={setSourceMode}
          micDevices={micDevices}
          selectedMicDeviceId={selectedMicDeviceId}
          onMicDeviceChange={setSelectedMicDeviceId}
          micDevicesLoading={micDevicesLoading}
          micDevicesError={micDevicesError}
          onRefreshMicDevices={() => void refreshMicDevices()}
          onStart={handleStart}
          onStop={handleStop}
          isRunning={isRunning}
          disabled={starting}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <GenerationModeToggle
              mode={generationMode}
              onChange={handleGenerationModeChange}
              disabled={starting}
            />
            <button
              type="button"
              onClick={() => void handleClearContext()}
              disabled={!isRunning}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              Clear Context
            </button>
          </div>
          <p className="text-sm text-zinc-500">
            Status: <span className="font-medium capitalize text-zinc-800 dark:text-zinc-200">{status}</span>
            {sessionId && <span className="ml-2 font-mono text-xs text-zinc-400">({sessionId.slice(0, 8)}…)</span>}
            {sessionId && <span className="ml-2 capitalize text-zinc-400">Live: {liveConnection}</span>}
          </p>
        </div>

        {contextNotice && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
            {contextNotice}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <UsagePanel usage={usage} />

        <ProducerGuidance
          value={guestDraft}
          onChange={setGuestDraft}
          onSubmit={() => void handleGuestSubmit()}
          onClearNudge={() => void handleClearGuest()}
          disabled={!sessionId}
          saving={guestSaving}
          hasUnsavedChanges={!guestContextsEqual(
            { name: guestDraft.name.trim(), company: guestDraft.company.trim() },
            guestContext,
          )}
          hasNudge={Boolean(
            guestContext.name ||
              guestContext.company ||
              guestDraft.name.trim() ||
              guestDraft.company.trim(),
          )}
        />

        <TranscriptChyronColumns
          segments={segments}
          partial={partial}
          suggestions={suggestions}
          onApprove={handleApprove}
          onReject={handleReject}
          onGenerateNow={() => void handleGenerateNow()}
          generating={generatingChyrons}
          disabled={!isRunning && status !== "ended"}
          isRunning={isRunning}
          nextBatchAt={nextChyronBatchAt}
        />

        <ApprovedTextOutput activeChyron={activeChyron} log={approvedLog} />
      </main>
    </div>
  );
}
