"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovedTextOutput } from "@/components/ApprovedTextOutput";
import { TranscriptChyronColumns } from "@/components/TranscriptChyronColumns";
import { GenerationModeToggle } from "@/components/GenerationModeToggle";
import { ModeToggle } from "@/components/ModeToggle";
import { UsagePanel } from "@/components/UsagePanel";
import { ProducerGuidance, type GuestContextDraft } from "@/components/ProducerGuidance";
import { YouTubeInput } from "@/components/YouTubeInput";
import {
  approveChyron,
  clearSessionContext,
  createSession,
  getSessionSnapshot,
  rejectChyron,
  setGuestContext,
  setChyronGenerationMode,
  setSessionMode,
  stopSession,
  type ApprovedLogEntry,
  type ChyronGenerationMode,
  type ChyronSuggestions as ChyronSuggestionsType,
  type LiveMessage,
  type SessionMode,
  type UsageStats,
} from "@/lib/api";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const emptyGuestContext = (): GuestContextDraft => ({ name: "", company: "" });

function guestContextsEqual(a: GuestContextDraft, b: GuestContextDraft) {
  return a.name.trim() === b.name.trim() && a.company.trim() === b.company.trim();
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>("chyron");
  const [generationMode, setGenerationMode] = useState<ChyronGenerationMode>("timeline");
  const [segments, setSegments] = useState<string[]>([]);
  const [partial, setPartial] = useState("");
  const [suggestions, setSuggestions] = useState<ChyronSuggestionsType | null>(null);
  const [verbatimCaption, setVerbatimCaption] = useState("");
  const [activeChyron, setActiveChyron] = useState("");
  const [approvedLog, setApprovedLog] = useState<ApprovedLogEntry[]>([]);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [starting, setStarting] = useState(false);
  const [contextNotice, setContextNotice] = useState("");
  const [nextChyronBatchAt, setNextChyronBatchAt] = useState<number | null>(null);
  const [liveConnection, setLiveConnection] = useState<"idle" | "connecting" | "live" | "reconnecting">("idle");
  const [guestContext, setGuestContextState] = useState<GuestContextDraft>(emptyGuestContext);
  const [guestDraft, setGuestDraft] = useState<GuestContextDraft>(emptyGuestContext);
  const [guestSaving, setGuestSaving] = useState(false);
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

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
      case "chyron.suggestions":
        setContextNotice("");
        setSuggestions({
          batchId: msg.batchId,
          sessionSummary: msg.sessionSummary,
          topic: msg.topic,
          entities: msg.entities,
          chyronOptions: msg.chyronOptions,
          verbatimCaption: msg.verbatimCaption,
          recentSummary: msg.recentSummary,
        });
        setVerbatimCaption(msg.verbatimCaption);
        setNextChyronBatchAt(
          msg.nextBatchAt ?? Date.now() / 1000 + (msg.chyronCadenceSec ?? 8),
        );
        break;
      case "chyron.approved":
        setActiveChyron(msg.text);
        break;
      case "chyron.log":
        setApprovedLog((log) => [...log, { text: msg.text, timestamp: msg.timestamp }]);
        break;
      case "mode.changed":
        setMode(msg.mode);
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
        setVerbatimCaption("");
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
        setMode(snapshot.mode);
        setGenerationMode(snapshot.generationMode);
        setUrl(snapshot.youtubeUrl);
        setSegments(snapshot.segments);
        setPartial("");
        setSuggestions(snapshot.latestSuggestions);
        setVerbatimCaption(snapshot.latestVerbatim);
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

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setSegments([]);
    setPartial("");
    setSuggestions(null);
    setActiveChyron("");
    setApprovedLog([]);
    setVerbatimCaption("");
    setUsage(null);
    setContextNotice("");
    setNextChyronBatchAt(null);
    setGuestContextState(emptyGuestContext());
    setGuestDraft(emptyGuestContext());

    try {
      const { sessionId: id } = await createSession("", mode, undefined, 0, generationMode);
      setSessionId(id);
      setStatus("connecting");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (sessionId) {
      try {
        await stopSession(sessionId);
      } catch {
        /* session may already be ended */
      }
    }
    setStatus("ended");
  };

  const handleModeChange = async (next: SessionMode) => {
    setMode(next);
    if (!sessionId) return;
    try {
      await setSessionMode(sessionId, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set mode");
    }
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
    setVerbatimCaption("");
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
            Start the current daily Newsmax HLS stream and generate broadcast chyron suggestions every 8 seconds.
          </p>
        </header>

        <YouTubeInput
          sourceUrl={url}
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
            <ModeToggle mode={mode} onChange={handleModeChange} disabled={!sessionId} />
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
          disabled={!isRunning && status !== "ended"}
          isRunning={isRunning}
          nextBatchAt={nextChyronBatchAt}
        />

        <ApprovedTextOutput
          activeChyron={activeChyron}
          log={approvedLog}
          verbatimCaption={verbatimCaption}
          mode={mode}
        />
      </main>
    </div>
  );
}
