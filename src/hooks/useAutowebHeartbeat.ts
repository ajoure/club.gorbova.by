/**
 * Phase A: клиентский hook — heartbeat в autoweb-session-heartbeat.
 *
 * Что делает:
 *  - Каждые 10s шлёт текущий player_state + current_time_seconds + playback_started.
 *  - Не полирует состояние сам — SoT = сервер, тут только доставка сигнала.
 *  - Не пишет ничего в БД напрямую. Никаких optimistic UI-переходов.
 *
 * Границы Фазы A: только lifecycle-сигналы. Никакого presence-counter, chat isolation,
 * test mode, viewer counter — это Фазы B–D.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AutowebPlayerState =
  | "idle"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error"
  | "autoplay_blocked";

interface Args {
  sessionId: string | null | undefined;
  playerState: AutowebPlayerState;
  currentTimeSeconds: number;
  playbackStarted: boolean;
  /** По умолчанию 10s. */
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 10_000;

export function useAutowebHeartbeat({
  sessionId,
  playerState,
  currentTimeSeconds,
  playbackStarted,
  intervalMs = DEFAULT_INTERVAL_MS,
}: Args) {
  // Держим свежие значения в ref, чтобы interval не пересоздавался на каждый tick.
  const stateRef = useRef({ playerState, currentTimeSeconds, playbackStarted });
  stateRef.current = { playerState, currentTimeSeconds, playbackStarted };

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    const inFlight = { current: false };

    const send = async () => {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      try {
        const { playerState, currentTimeSeconds, playbackStarted } = stateRef.current;
        await supabase.functions.invoke("autoweb-session-heartbeat", {
          method: "POST",
          body: {
            session_id: sessionId,
            player_state: playerState,
            current_time_seconds: currentTimeSeconds,
            playback_started: playbackStarted,
          },
        });
      } catch {
        // Тихо — heartbeat не должен ломать UI. Повторим на следующем тике.
      } finally {
        inFlight.current = false;
      }
    };

    // Первый выстрел — сразу, чтобы auto_room_opened_at зафиксировался как можно раньше.
    send();
    const id = window.setInterval(send, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId, intervalMs]);
}
