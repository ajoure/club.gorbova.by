import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { chunkAudioBlobToWavWindows, type WavChunk, type WavChunkPlan } from "@/lib/wavChunker";
import {
  preflightFmp4,
  sniffAudioContainer,
  streamFmp4ToWavWindows,
  type Fmp4Preflight,
} from "@/lib/fmp4AudioChunker";

// Client-assisted transcription runner. Drives the whole pipeline against the
// `transcription-client-worker` edge function and exposes progress + controls
// (start, resume, retry failed, cancel). Uses beforeunload to warn the user
// while a run is in flight and heartbeats every 20 s so the server can tell
// active jobs from abandoned ones.


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

const ACTIVE_PHASES: RunnerPhase[] = [
  "loading_audio",
  "chunking",
  "creating_job",
  "registering_parts",
  "transcribing",
  "finalizing",
];
const WINDOW_MS = 90_000;
const HEARTBEAT_MS = 20_000;

type StartOptions = { retryFailedOnly?: boolean; resume?: boolean };

type UnifiedPlan =
  | {
      mode: "progressive";
      totalDurationMs: number;
      totalParts: number;
      chunks: WavChunk[];
    }
  | {
      mode: "fmp4";
      totalDurationMs: number;
      totalParts: number;
      blob: Blob;
      preflight: Fmp4Preflight;
    };

export function useAdminTranscriptionRunner(liveEventId: string | null) {
  const [state, setState] = useState<RunnerState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const planRef = useRef<UnifiedPlan | null>(null);
  const runningRef = useRef(false);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateRef = useRef<RunnerState>(INITIAL);

  const patch = useCallback((next: Partial<RunnerState>) => {
    setState((prev) => {
      const merged = { ...prev, ...next } as RunnerState;
      merged.isActive = ACTIVE_PHASES.includes(merged.phase);
      stateRef.current = merged;
      return merged;
    });
  }, []);


  // beforeunload warning while a run is in flight.
  useEffect(() => {
    if (!state.isActive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue =
        "Транскрибация в процессе — не закрывайте вкладку до сообщения «Всё сохранено».";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.isActive]);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("transcription-client-worker", { body });
    if (error) throw new Error(error.message || "worker_invoke_failed");
    if (data && (data as any).ok === false && (data as any).error) {
      throw new Error(String((data as any).error));
    }
    return data as any;
  }, []);

  const loadStatus = useCallback(async (jobId?: string | null) => {
    if (!liveEventId) return null;
    const payload: Record<string, unknown> = jobId
      ? { action: "status", job_id: jobId }
      : { action: "status", live_event_id: liveEventId };
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

  // Initial hydration + heartbeat lifecycle bound to isActive.
  useEffect(() => {
    if (!liveEventId) return;
    let cancelled = false;
    loadStatus().then((snap) => { if (!cancelled) hydrateFromStatus(snap); }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [liveEventId, loadStatus, hydrateFromStatus]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback((jobId: string) => {
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      const s = stateRef.current;
      if (!s.isActive) { stopHeartbeat(); return; }
      supabase.functions
        .invoke("transcription-client-worker", { body: { action: "heartbeat", job_id: jobId } })
        .catch(() => { /* ignore transient failures */ });
    }, HEARTBEAT_MS);
  }, [stopHeartbeat]);

  useEffect(() => stopHeartbeat, [stopHeartbeat]);

  const downloadAudio = useCallback(async (): Promise<Blob> => {
    patch({ phase: "loading_audio", message: "Загружаем сохранённый аудиофайл для обработки…" });
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

  const humanFriendlyError = useCallback((raw: unknown): string => {
    const code = raw instanceof Error ? raw.message : String(raw);
    switch (code) {
      case "webcodecs_unavailable":
        return "Этот браузер не поддерживает WebCodecs — фрагментированный аудиофайл Kinescope не может быть обработан здесь. Откройте админку в актуальном Chrome/Edge/Opera и запустите транскрибацию заново.";
      case "audio_decoder_config_unsupported":
        return "Аудиокодек этого фрагмента Kinescope не поддерживается WebCodecs в вашем браузере. Обновите Chrome/Edge или используйте другой браузер — повтор на этой же машине не поможет.";
      case "fmp4_no_audio_track":
        return "Это аудиофрагмент Kinescope, но аудио-дорожку прочитать не удалось. Проверьте исходный трек в Kinescope; повтор в этом браузере не изменит результат.";
      case "fmp4_moov_not_found_in_preflight_window":
        return "Аудиофайл выглядит как fragmented MP4, но заголовок moov не найден в начале файла. Файл повреждён или обрезан — повтор не поможет.";
      case "cancelled_by_user":
        return "Отменено по запросу.";
      default:
        if (code.startsWith("audio_fetch_")) return `Не удалось скачать аудио: HTTP ${code.replace("audio_fetch_", "")}.`;
        return `Не удалось декодировать сохранённый аудиофайл: ${code}. Скорее всего, контейнер не поддерживается — повтор не поможет; обратитесь к разработчику.`;
    }
  }, []);

  const ensurePlan = useCallback(async (): Promise<UnifiedPlan> => {
    if (planRef.current) return planRef.current;
    patch({ phase: "loading_audio", message: "Загружаем сохранённый аудиофайл для обработки…" });
    const audio = await downloadAudio();
    patch({ phase: "chunking", message: "Проверяем контейнер аудио…" });
    const sniff = await sniffAudioContainer(audio);
    if (sniff.container === "fmp4") {
      // Preflight: prove we can actually decode this fMP4 before creating a
      // server-side job. If WebCodecs or the codec config is unsupported, we
      // abort here with a human message and do not touch the STT worker.
      patch({ message: "Проверяем поддержку декодирования fMP4/AAC в этом браузере…" });
      const pre = await preflightFmp4(audio);
      if (!pre.webCodecsSupported) throw new Error("webcodecs_unavailable");
      if (!pre.decoderConfigSupported) throw new Error("audio_decoder_config_unsupported");
      const totalDurationMs = pre.totalDurationMs
        ?? Math.round((audio.size / (128_000 / 8)) * 1000); // AAC ~128 kbps fallback estimate
      const totalParts = Math.max(1, Math.ceil(totalDurationMs / WINDOW_MS));
      const plan: UnifiedPlan = { mode: "fmp4", totalDurationMs, totalParts, blob: audio, preflight: pre };
      planRef.current = plan;
      patch({ audioDurationMs: totalDurationMs, totalParts });
      return plan;
    }
    patch({ message: "Готовим прогрессивное аудио и делим на окна…" });
    const progressive = await chunkAudioBlobToWavWindows(audio, WINDOW_MS);
    const plan: UnifiedPlan = {
      mode: "progressive",
      totalDurationMs: progressive.totalDurationMs,
      totalParts: progressive.chunks.length,
      chunks: progressive.chunks,
    };
    planRef.current = plan;
    patch({ audioDurationMs: plan.totalDurationMs, totalParts: plan.totalParts });
    return plan;
  }, [downloadAudio, patch]);

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
      let job: any = null;

      const existingSnap = state.jobId
        ? await loadStatus(state.jobId)
        : await loadStatus(null);
      const canReuse =
        existingSnap?.job &&
        (options.retryFailedOnly || options.resume
          ? !["ready", "cancelled"].includes(existingSnap.job.status)
          : !["ready", "failed", "cancelled"].includes(existingSnap.job.status));
      if (canReuse) {
        job = existingSnap.job;
        hydrateFromStatus(existingSnap);
        await ensurePlan();
      } else {
        // Fresh run. Preflight the container first — for fMP4 we must not
        // create a job or hand any audio to the STT pipeline unless the
        // decoder pipeline actually initialises here in the browser.
        const plan = await ensurePlan();
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
        const parts = plan.mode === "progressive"
          ? plan.chunks.map((c) => ({
              part_index: c.partIndex,
              start_ms: c.startMs,
              end_ms: c.endMs,
              bytes: c.blob.size,
            }))
          : Array.from({ length: plan.totalParts }, (_, i) => ({
              part_index: i,
              start_ms: i * WINDOW_MS,
              end_ms: Math.min((i + 1) * WINDOW_MS, plan.totalDurationMs),
              bytes: null,
            }));
        await invoke({ action: "register_parts", job_id: job.id, parts });
      }

      startHeartbeat(job.id);

      // Canonical part state → decide which chunks to send.
      const snap = await loadStatus(job.id);
      hydrateFromStatus(snap);
      const partsById = new Map<number, PartState>(
        (snap?.parts || []).map((p: any) => [
          p.part_index,
          { partIndex: p.part_index, status: p.status, attempts: p.attempts ?? 0, errorMessage: p.error_message },
        ]),
      );
      const shouldSend = (idx: number): boolean => {
        const existing = partsById.get(idx);
        if (!existing) return true;
        if (existing.status === "ready") return false;
        if (options.retryFailedOnly) return existing.status === "failed";
        return true;
      };

      const plan = planRef.current!;
      const remainingCount =
        plan.mode === "progressive"
          ? plan.chunks.filter((c) => shouldSend(c.partIndex)).length
          : Array.from({ length: plan.totalParts }, (_, i) => i).filter(shouldSend).length;

      patch({
        phase: "transcribing",
        message: `Транскрибирую ${remainingCount} окно(а). Не закрывайте вкладку — оценка 10–15 минут для эфира 60–90 минут.`,
      });

      const handleChunk = async (chunk: { partIndex: number; blob: Blob }) => {
        if (abortRef.current?.signal.aborted) throw new Error("cancelled_by_user");
        if (!shouldSend(chunk.partIndex)) return;
        patch({ currentPartIndex: chunk.partIndex });
        try {
          await uploadPart(job.id, chunk);
        } catch (e) {
          console.warn("[transcription-runner] part failed:", chunk.partIndex, e);
        } finally {
          const fresh = await loadStatus(job.id).catch(() => null);
          if (fresh) hydrateFromStatus(fresh);
        }
      };

      if (plan.mode === "progressive") {
        for (const chunk of plan.chunks) await handleChunk(chunk);
      } else {
        // Streaming fMP4: emit each 90 s WAV, upload, then release its PCM
        // buffer before decoding continues. Backpressure holds because
        // streamFmp4ToWavWindows awaits our onPart callback.
        await streamFmp4ToWavWindows(plan.blob, {
          windowMs: WINDOW_MS,
          signal: abortRef.current?.signal,
          onPart: handleChunk,
        });
      }


      const finalSnap = await loadStatus(job.id);
      hydrateFromStatus(finalSnap);
      const done = finalSnap?.job?.completed_parts ?? 0;
      const total = finalSnap?.job?.total_parts ?? 0;
      const failed = finalSnap?.job?.failed_parts ?? 0;
      if (failed > 0 || done < total) {
        patch({
          phase: "failed",
          errorMessage: `Расшифровано ${done}/${total}. Нажмите «Повторить», чтобы попробовать неудачные окна.`,
        });
        return;
      }

      patch({ phase: "finalizing", currentPartIndex: null, message: "Собираю DOCX…" });
      const finalized = await invoke({ action: "finalize", job_id: job.id });
      if (!finalized?.ok) throw new Error(finalized?.message || "finalize_failed");
      patch({
        phase: "ready",
        message: "Всё сохранено — вкладку можно закрывать.",
        errorMessage: null,
        currentPartIndex: null,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      patch({
        phase: raw === "cancelled_by_user" ? "cancelled" : "failed",
        errorMessage: humanFriendlyError(error),
        currentPartIndex: null,
      });
    } finally {
      runningRef.current = false;
      stopHeartbeat();
    }
  }, [
    liveEventId,
    state.jobId,
    loadStatus,
    hydrateFromStatus,
    ensurePlan,
    patch,
    invoke,
    uploadPart,
    startHeartbeat,
    stopHeartbeat,
    humanFriendlyError,
  ]);


  const retryFailed = useCallback(() => start({ retryFailedOnly: true }), [start]);
  const resume = useCallback(() => start({ resume: true }), [start]);

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    stopHeartbeat();
    if (state.jobId) {
      try { await invoke({ action: "cancel", job_id: state.jobId }); } catch { /* ignore */ }
    }
    patch({ phase: "cancelled", currentPartIndex: null });
  }, [state.jobId, invoke, patch, stopHeartbeat]);

  const refresh = useCallback(async () => {
    const snap = await loadStatus(state.jobId ?? undefined);
    hydrateFromStatus(snap);
  }, [state.jobId, loadStatus, hydrateFromStatus]);

  const reset = useCallback(() => {
    planRef.current = null;
    stopHeartbeat();
    setState(INITIAL);
    stateRef.current = INITIAL;
  }, [stopHeartbeat]);

  return { state, start, resume, retryFailed, cancel, refresh, reset };
}
