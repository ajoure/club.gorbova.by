// Client-side orchestrator for the client-assisted transcription flow.
//
// Responsibility split:
//   * decode + chunk the audio locally (via src/lib/transcription/wavChunker);
//   * create or resume the server-side job;
//   * upload each pending part one by one, with retry/backoff on transient
//     failures and periodic heartbeats to the worker;
//   * request server-side finalize once every part is ready;
//   * expose a live stage / percent / message payload for the wizard UI.
//
// The runner intentionally does not persist to localStorage. Server rows +
// audio storage are the source of truth: if the user reloads the tab or
// re-opens the wizard, the runner reads the latest job status and picks up
// the pending part indices from the server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { decodeAudioBlob, extractChunk, planChunks, type AudioChunk, type ChunkPlan } from "@/lib/transcription/wavChunker";

export type TranscriptionStage =
  | "idle"
  | "downloading_audio"
  | "decoding"
  | "planning"
  | "uploading"
  | "transcribing"
  | "finalizing"
  | "ready"
  | "failed"
  | "cancelled";

export type TranscriptionRunnerState = {
  stage: TranscriptionStage;
  message: string;
  percent: number; // 0..100
  totalParts: number;
  completedParts: number;
  currentPartIndex: number | null;
  jobId: string | null;
  error: string | null;
  canResume: boolean;
};

const INITIAL: TranscriptionRunnerState = {
  stage: "idle",
  message: "",
  percent: 0,
  totalParts: 0,
  completedParts: 0,
  currentPartIndex: null,
  jobId: null,
  error: null,
  canResume: false,
};

const STAGE_MESSAGES: Record<TranscriptionStage, string> = {
  idle: "",
  downloading_audio: "Скачиваем аудиофайл эфира",
  decoding: "Готовим аудио к обработке",
  planning: "Разбиваем на короткие фрагменты",
  uploading: "Отправляем часть на распознавание",
  transcribing: "Распознаём речь",
  finalizing: "Собираем документ DOCX",
  ready: "Готово. Аудио и DOCX сохранены.",
  failed: "Не удалось завершить обработку",
  cancelled: "Обработка отменена",
};

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
}

async function callWorker<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("transcription-client-worker", { body });
  if (error) throw new Error(error.message || "worker_invoke_failed");
  if (!data?.ok && data?.error) throw new Error(String(data.error));
  return data as T;
}

async function fetchSignedAudioUrl(liveEventId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("live-event-media", {
    body: { action: "download", kind: "audio", live_event_id: liveEventId },
  });
  if (error) throw new Error(error.message || "audio_signed_url_failed");
  if (!data?.ok || !data?.url) throw new Error(data?.error || "audio_signed_url_failed");
  return data.url as string;
}

export function useAdminTranscriptionRunner(liveEventId: string) {
  const [state, setState] = useState<TranscriptionRunnerState>(INITIAL);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);
  const heartbeatRef = useRef<number | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const update = useCallback((patch: Partial<TranscriptionRunnerState>) => {
    setState((prev) => ({ ...prev, ...patch, message: patch.stage ? STAGE_MESSAGES[patch.stage] : patch.message ?? prev.message }));
  }, []);

  const startHeartbeat = useCallback((jobId: string) => {
    if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
    heartbeatRef.current = window.setInterval(() => {
      void callWorker({ action: "heartbeat", job_id: jobId }).catch(() => {});
    }, 20_000);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  useEffect(() => () => stopHeartbeat(), [stopHeartbeat]);

  const refreshStatus = useCallback(async () => {
    const status = await callWorker<{ ok: true; job: { id: string; status: string; stage: string; total_parts: number; completed_parts: number } | null; parts: Array<{ part_index: number; status: string }> }>({
      action: "status",
      live_event_id: liveEventId,
    });
    if (!status.job) {
      update({ ...INITIAL });
      return status;
    }
    const isActive = ["pending_parts", "transcribing", "finalizing"].includes(status.job.status);
    update({
      jobId: status.job.id,
      totalParts: status.job.total_parts,
      completedParts: status.job.completed_parts,
      percent: status.job.total_parts > 0 ? Math.round((status.job.completed_parts / status.job.total_parts) * 100) : 0,
      stage:
        status.job.status === "ready"
          ? "ready"
          : status.job.status === "failed"
          ? "failed"
          : status.job.status === "cancelled"
          ? "cancelled"
          : (status.job.stage as TranscriptionStage) || "uploading",
      canResume: isActive,
      error: null,
    });
    return status;
  }, [liveEventId, update]);

  const uploadPartWithRetry = useCallback(async (jobId: string, chunk: AudioChunk, maxAttempts = 3) => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (cancelledRef.current) throw new Error("cancelled_by_user");
      try {
        const base64 = await blobToBase64(chunk.wav);
        const res = await callWorker<{ ok: true; completed_parts: number; cached?: boolean }>({
          action: "submit_part",
          job_id: jobId,
          part_index: chunk.index,
          wav_base64: base64,
        });
        return res;
      } catch (error) {
        lastError = error;
        const delay = Math.min(30_000, 2_000 * Math.pow(2, attempt));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("part_upload_failed");
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    cancelledRef.current = false;
    update({ stage: "downloading_audio", error: null });

    try {
      const audioUrl = await fetchSignedAudioUrl(liveEventId);
      const response = await fetch(audioUrl);
      if (!response.ok) throw new Error(`audio_download_${response.status}`);
      const audioBlob = await response.blob();
      if (cancelledRef.current) throw new Error("cancelled_by_user");

      update({ stage: "decoding" });
      const audioBuffer = await decodeAudioBlob(audioBlob);
      if (cancelledRef.current) throw new Error("cancelled_by_user");

      update({ stage: "planning" });
      const plan: ChunkPlan = planChunks(audioBuffer);

      const created = await callWorker<{ ok: true; job: { id: string; total_parts: number; completed_parts: number }; pending_indices: number[] }>({
        action: "create_or_resume",
        live_event_id: liveEventId,
        total_parts: plan.totalParts,
        window_ms: plan.windowMs,
        audio_duration_ms: plan.durationMs,
        bounds: plan.bounds.map((b) => ({ index: b.index, start_ms: b.startMs, end_ms: b.endMs })),
      });

      const jobId = created.job.id;
      jobIdRef.current = jobId;
      startHeartbeat(jobId);

      update({
        jobId,
        totalParts: plan.totalParts,
        completedParts: created.job.completed_parts,
        percent: plan.totalParts > 0 ? Math.round((created.job.completed_parts / plan.totalParts) * 100) : 0,
        stage: "uploading",
        canResume: true,
      });

      let completed = created.job.completed_parts;
      for (const partIndex of created.pending_indices) {
        if (cancelledRef.current) throw new Error("cancelled_by_user");
        update({ currentPartIndex: partIndex, stage: "transcribing" });
        const chunk = extractChunk(audioBuffer, plan, partIndex);
        const res = await uploadPartWithRetry(jobId, chunk);
        completed = res.completed_parts ?? completed + 1;
        update({
          completedParts: completed,
          percent: plan.totalParts > 0 ? Math.round((completed / plan.totalParts) * 100) : 0,
        });
      }

      update({ stage: "finalizing", currentPartIndex: null });
      await callWorker({ action: "finalize", job_id: jobId });
      stopHeartbeat();
      update({ stage: "ready", percent: 100, canResume: false });
    } catch (error) {
      stopHeartbeat();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = message === "cancelled_by_user";
      update({
        stage: cancelled ? "cancelled" : "failed",
        error: cancelled ? null : message,
        canResume: cancelled ? true : false,
      });
    } finally {
      runningRef.current = false;
    }
  }, [liveEventId, startHeartbeat, stopHeartbeat, update, uploadPartWithRetry]);

  const cancel = useCallback(async () => {
    cancelledRef.current = true;
    stopHeartbeat();
    if (jobIdRef.current) {
      await callWorker({ action: "cancel", job_id: jobIdRef.current }).catch(() => {});
    }
    update({ stage: "cancelled", canResume: true });
  }, [stopHeartbeat, update]);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    jobIdRef.current = null;
    stopHeartbeat();
    setState(INITIAL);
  }, [stopHeartbeat]);

  // Guard against tab close while an active job is running.
  useEffect(() => {
    const active = state.stage === "downloading_audio" || state.stage === "decoding" || state.stage === "planning" || state.stage === "uploading" || state.stage === "transcribing" || state.stage === "finalizing";
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.stage]);

  return useMemo(
    () => ({ state, run, cancel, reset, refreshStatus }),
    [state, run, cancel, reset, refreshStatus],
  );
}
