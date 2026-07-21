import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chunkAudioBlobToWavWindows, type WavChunkPlan } from "@/lib/wavChunker";

// Client-assisted transcription runner. Drives the whole pipeline against the
// `transcription-client-worker` edge function and exposes progress + controls
// (start, resume, retry failed, cancel). Uses beforeunload to warn the user
// while a run is in flight.

export type RunnerPhase =
  | "idle"
  | "loading_audio"
  | "chunking"
  | "creating_job"
  | "registering_parts"
  | "transcribing"
  | "finalizing"
  | "ready"
  | "failed"
  | "cancelled";

type PartState = {
  partIndex: number;
  status: "pending" | "uploading" | "ready" | "failed";
  attempts: number;
  errorMessage?: string | null;
};

export type RunnerState = {
  phase: RunnerPhase;
  jobId: string | null;
  totalParts: number;
  completedParts: number;
  failedParts: number;
  currentPartIndex: number | null;
  parts: PartState[];
  audioSizeBytes: number | null;
  audioDurationMs: number | null;
  message: string | null;
  errorMessage: string | null;
  isActive: boolean;
};

const INITIAL: RunnerState = {
  phase: "idle",
  jobId: null,
  totalParts: 0,
  completedParts: 0,
  failedParts: 0,
  currentPartIndex: null,
  parts: [],
  audioSizeBytes: null,
  audioDurationMs: null,
  message: null,
  errorMessage: null,
  isActive: false,
};

const ACTIVE_PHASES: RunnerPhase[] = ["loading_audio", "chunking", "creating_job", "registering_parts", "transcribing", "finalizing"];
const WINDOW_MS = 90_000;

type StartOptions = { retryFailedOnly?: boolean };

export function useAdminTranscriptionRunner(liveEventId: string | null) {
  const [state, setState] = useState<RunnerState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const chunksRef = useRef<WavChunkPlan | null>(null);
  const runningRef = useRef(false);

  const patch = useCallback((next: Partial<RunnerState>) => {
    setState((prev) => {
      const merged = { ...prev, ...next } as RunnerState;
      merged.isActive = ACTIVE_PHASES.includes(merged.phase);
      return merged;
    });
  }, []);

  useEffect(() => {
    if (!state.isActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Транскрибация в процессе — уход со страницы прервёт загрузку частей.";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.isActive]);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("transcription-client-worker", { body });
    if (error) throw new Error(error.message || "worker_invoke_failed");
    if (!data?.ok && data?.error) throw new Error(String(data.error));
    return data as any;
  }, []);

  const loadStatus = useCallback(async (jobId?: string | null) => {
    if (!liveEventId) return null;
    const payload: Record<string, unknown> = jobId ? { action: "status", job_id: jobId } : { action: "status", live_event_id: liveEventId };
    const { data, error } = await supabase.functions.invoke("transcription-client-worker", { body: payload });
    if (error) throw new Error(error.message || "status_failed");
    return data as { ok: boolean; job: any; parts: any[] };
  }, [liveEventId]);

  const hydrateFromStatus = useCallback((snap: { job: any; parts: any[] } | null) => {
    if (!snap?.job) {
      patch({ ...INITIAL });
      return;
    }
    const parts: PartState[] = (snap.parts || []).map((p) => ({
      partIndex: p.part_index,
      status: p.status,
      attempts: p.attempts ?? 0,
      errorMessage: p.error_message,
    }));
    const phase: RunnerPhase = ["ready", "failed", "cancelled"].includes(snap.job.status)
      ? (snap.job.status as RunnerPhase)
      : "transcribing";
    patch({
      phase,
      jobId: snap.job.id,
      totalParts: snap.job.total_parts ?? parts.length,
      completedParts: snap.job.completed_parts ?? parts.filter((p) => p.status === "ready").length,
      failedParts: snap.job.failed_parts ?? parts.filter((p) => p.status === "failed").length,
      audioDurationMs: snap.job.audio_duration_ms ?? null,
      parts,
      message: null,
      errorMessage: null,
    });
  }, [patch]);

  useEffect(() => {
    if (!liveEventId) return;
    let cancelled = false;
    loadStatus().then((snap) => { if (!cancelled) hydrateFromStatus(snap); }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [liveEventId, loadStatus, hydrateFromStatus]);

  const downloadAudio = useCallback(async (): Promise<Blob> => {
    patch({ phase: "loading_audio", message: "Скачиваю аудио из хранилища…" });
    const { data, error } = await supabase.functions.invoke("live-event-media", {
      body: { action: "download", kind: "audio", live_event_id: liveEventId },
    });
    if (error || !data?.url) throw new Error(error?.message || "audio_download_url_failed");
    const response = await fetch(data.url);
    if (!response.ok) throw new Error(`audio_fetch_${response.status}`);
    const blob = await response.blob();
    patch({ audioSizeBytes: blob.size });
    return blob;
  }, [liveEventId, patch]);

  const uploadPart = useCallback(async (jobId: string, chunk: { partIndex: number; blob: Blob }) => {
    const form = new FormData();
    form.append("action", "transcribe_part");
    form.append("job_id", jobId);
    form.append("part_index", String(chunk.partIndex));
    form.append("file", chunk.blob, `part_${String(chunk.partIndex).padStart(4, "0")}.wav`);
    const { data, error } = await supabase.functions.invoke("transcription-client-worker", { body: form });
    if (error) throw new Error(error.message || "part_upload_failed");
    if (!data?.ok) throw new Error(String(data?.message || data?.error || "part_failed"));
    return data;
  }, []);

  const start = useCallback(async (options: StartOptions = {}) => {
    if (!liveEventId) throw new Error("no_live_event_id");
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = new AbortController();
    try {
      let plan = chunksRef.current;
      let job: any = null;

      if (options.retryFailedOnly && state.jobId) {
        const snap = await loadStatus(state.jobId);
        if (!snap?.job) throw new Error("job_missing");
        job = snap.job;
        hydrateFromStatus(snap);
      } else {
        const audio = await downloadAudio();
        patch({ phase: "chunking", message: "Готовлю аудио и делю на окна…" });
        plan = await chunkAudioBlobToWavWindows(audio, WINDOW_MS);
        chunksRef.current = plan;
        patch({ audioDurationMs: plan.totalDurationMs, totalParts: plan.chunks.length });

        patch({ phase: "creating_job", message: "Создаю задачу транскрибации…" });
        const created = await invoke({
          action: "create_job",
          live_event_id: liveEventId,
          audio_duration_ms: plan.totalDurationMs,
          window_ms: WINDOW_MS,
        });
        job = created.job;
        patch({ jobId: job.id, totalParts: job.total_parts });

        patch({ phase: "registering_parts", message: "Регистрирую окна…" });
        await invoke({
          action: "register_parts",
          job_id: job.id,
          parts: plan.chunks.map((c) => ({ part_index: c.partIndex, start_ms: c.startMs, end_ms: c.endMs, bytes: c.blob.size })),
        });
      }

      // Fetch canonical part state and decide which chunks to send.
      const snap = await loadStatus(job.id);
      hydrateFromStatus(snap);
      const partsById = new Map<number, PartState>((snap?.parts || []).map((p: any) => [p.part_index, { partIndex: p.part_index, status: p.status, attempts: p.attempts ?? 0, errorMessage: p.error_message }]));
      const toSend = (chunksRef.current?.chunks || []).filter((c) => {
        const existing = partsById.get(c.partIndex);
        if (!existing) return true;
        if (existing.status === "ready") return false;
        if (options.retryFailedOnly) return existing.status === "failed";
        return true;
      });

      patch({ phase: "transcribing", message: `Транскрибирую ${toSend.length} окно(а)…` });
      for (const chunk of toSend) {
        if (abortRef.current?.signal.aborted) throw new Error("cancelled_by_user");
        patch({ currentPartIndex: chunk.partIndex });
        try {
          await uploadPart(job.id, chunk);
          const fresh = await loadStatus(job.id);
          hydrateFromStatus(fresh);
        } catch (e) {
          // Continue with remaining parts; failed part is marked on server.
          const fresh = await loadStatus(job.id).catch(() => null);
          if (fresh) hydrateFromStatus(fresh);
          console.warn("[transcription-runner] part failed:", chunk.partIndex, e);
        }
      }

      const finalSnap = await loadStatus(job.id);
      hydrateFromStatus(finalSnap);
      if ((finalSnap?.job?.failed_parts ?? 0) > 0 || (finalSnap?.job?.completed_parts ?? 0) < (finalSnap?.job?.total_parts ?? 0)) {
        patch({ phase: "failed", errorMessage: "Не все окна расшифрованы. Повторите неудачные части." });
        return;
      }

      patch({ phase: "finalizing", currentPartIndex: null, message: "Собираю DOCX…" });
      const finalized = await invoke({ action: "finalize", job_id: job.id });
      if (!finalized?.ok) throw new Error(finalized?.message || "finalize_failed");
      patch({ phase: "ready", message: "Транскрипт готов", errorMessage: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      patch({ phase: message === "cancelled_by_user" ? "cancelled" : "failed", errorMessage: message, currentPartIndex: null });
    } finally {
      runningRef.current = false;
    }
  }, [liveEventId, state.jobId, loadStatus, hydrateFromStatus, downloadAudio, patch, invoke, uploadPart]);

  const retryFailed = useCallback(() => start({ retryFailedOnly: true }), [start]);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    if (state.jobId) {
      try { await invoke({ action: "cancel", job_id: state.jobId }); } catch { /* ignore */ }
    }
    patch({ phase: "cancelled", currentPartIndex: null });
  }, [state.jobId, invoke, patch]);

  const refresh = useCallback(async () => {
    const snap = await loadStatus(state.jobId ?? undefined);
    hydrateFromStatus(snap);
  }, [state.jobId, loadStatus, hydrateFromStatus]);

  const reset = useCallback(() => {
    chunksRef.current = null;
    setState(INITIAL);
  }, []);

  return { state, start, retryFailed, cancel, refresh, reset };
}
