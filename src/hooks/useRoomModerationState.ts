/**
 * Reads the current moderation state for a (live_event_id, user_id) pair.
 *
 * Source of truth: `live_event_room_moderation` — the latest mute/remove
 * action wins (toggle semantics, mirroring `LiveInlineModeration`).
 *
 * Used by chat/Q&A panels to:
 *   - disable the input when the current viewer is muted/removed,
 *   - show a banner explaining the state.
 *
 * Also subscribes to realtime so the user's UI flips immediately when
 * a moderator toggles their state from another session.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RoomModerationState {
  isMuted: boolean;
  isRemoved: boolean;
}

const EMPTY: RoomModerationState = { isMuted: false, isRemoved: false };

export function useRoomModerationState(
  liveEventId: string | undefined,
  userId: string | undefined,
): RoomModerationState {
  const queryClient = useQueryClient();
  const enabled = Boolean(liveEventId && userId);

  const { data } = useQuery<RoomModerationState>({
    queryKey: ["live-user-mod-state", liveEventId, userId],
    enabled,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_room_moderation")
        .select("action_type, created_at")
        .eq("live_event_id", liveEventId!)
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return EMPTY;

      let isMuted = false;
      let isRemoved = false;
      let muteSeen = false;
      let removeSeen = false;
      for (const row of data || []) {
        const a = row.action_type;
        if (!muteSeen && (a === "muted" || a === "unmuted")) {
          isMuted = a === "muted";
          muteSeen = true;
        }
        if (!removeSeen && (a === "removed" || a === "restored" || a === "banned")) {
          isRemoved = a === "removed" || a === "banned";
          removeSeen = true;
        }
        if (muteSeen && removeSeen) break;
      }
      return { isMuted, isRemoved };
    },
  });

  // Realtime: react to moderator actions in other sessions immediately.
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`mod-state-${liveEventId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_event_room_moderation",
          filter: `live_event_id=eq.${liveEventId}`,
        },
        (payload) => {
          const row: any = payload.new;
          if (row?.user_id === userId) {
            queryClient.invalidateQueries({
              queryKey: ["live-user-mod-state", liveEventId, userId],
            });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, liveEventId, userId, queryClient]);

  return data ?? EMPTY;
}
