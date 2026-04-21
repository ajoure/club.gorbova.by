/**
 * Sprint B: client-side re-export единого контракта autoweb-room-state.
 * Source of truth: supabase/functions/_shared/autoweb-types.ts
 *
 * Этот файл существует только чтобы клиент мог импортировать тип
 * через alias "@/types/autoweb" без пути в supabase/functions.
 * При любом изменении контракта — править ТОЛЬКО shared-файл,
 * этот лишь зеркалит экспорты.
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
  enabled: boolean;
  last_video_position_seconds: number;
}

export interface AutowebRoomStateResponse {
  status: "ok" | "not_found" | "unsupported_event_type" | "error";
  phase: AutowebPhase;
  session_id: string;
  live_event_id: string;
  starts_at: string;
  ends_at: string;
  replay_opens_at: string | null;
  replay_ends_at: string | null;
  viewer_controls: AutowebViewerControls;
  timeline_enabled: boolean;
  chat_enabled: boolean;
  questions_enabled: boolean;
  resume: AutowebResumeContract;
  viewer_timezone: string;
  event_timezone: string;
  kinescope_video_id: string | null;
}
