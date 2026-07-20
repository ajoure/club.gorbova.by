/**
 * Sprint B: единый контракт ответа autoweb-room-state.
 *
 * Этот файл — single source of truth для shape ответа.
 * Импортируется И edge function (autoweb-room-state/index.ts),
 * И клиентом (через src/types/autoweb.ts re-export).
 *
 * НЕ дублировать тип в другом месте. Любое изменение контракта — здесь.
 */

export type AutowebPhase = "pre_show" | "live" | "replay" | "ended";

export interface AutowebViewerControls {
  allow_pause: boolean;
  allow_seek: boolean;
  allow_speed_control: boolean;
  resume_from_last_position: boolean;
  allow_rewatch_before_end: boolean;
}

export interface AutowebResumeContract {
  /** Зафиксировано в Sprint B: всегда возвращается, даже если UI ещё не использует. */
  enabled: boolean;
  /** 0 если resume disabled или нет сохранённой позиции. */
  last_video_position_seconds: number;
}

/** Presentation counter for the room header. `real_count` is never sent to a
 * regular viewer; it is present only for staff diagnostics. */
export interface AutowebViewerCount {
  visible: boolean;
  displayed_count: number | null;
  real_count?: number;
}

export interface AutowebRoomStateResponse {
  status: "ok" | "not_found" | "unsupported_event_type" | "error";
  phase: AutowebPhase;
  session_id: string;
  live_event_id: string;
  starts_at: string; // ISO
  ends_at: string;   // ISO = starts_at + duration
  replay_opens_at: string | null;
  replay_ends_at: string | null;
  viewer_controls: AutowebViewerControls;
  timeline_enabled: boolean;
  chat_enabled: boolean;
  questions_enabled: boolean;
  /** Source history is disabled for replay unless replay.show_chat_history is enabled. */
  history_enabled: boolean;
  /**
   * Точка позднего входа, вычисленная сервером для текущей live-фазы.
   * Для replay/pre_show это 0; сохранённая пользовательская позиция остаётся
   * отдельным resume-контрактом и при включённом resume имеет приоритет в UI.
   */
  session_playback_position_seconds: number;
  resume: AutowebResumeContract;
  viewer_count: AutowebViewerCount;
  viewer_timezone: string;
  event_timezone: string;
  /** Для UI: видео-источник (ID Kinescope), уже подтверждённый правом на эту session. */
  kinescope_video_id: string | null;
  /**
   * Ссылка на исходный live_stream, чью запись проигрывает автовеб.
   * Из этого события берутся исторические комментарии/вопросы/участники/сценарий
   * для timed-replay. NULL — источник не привязан, история недоступна.
   */
  source_live_event_id: string | null;
  /**
   * ISO-время старта исходного эфира (для расчёта relative_seconds исторических событий).
   * NULL если source_live_event_id не задан.
   */
  source_started_at: string | null;
}

export interface AutowebRoomStateError {
  status: "error" | "not_found" | "unsupported_event_type";
  message?: string;
}
