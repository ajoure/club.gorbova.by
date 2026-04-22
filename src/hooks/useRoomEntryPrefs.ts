import { useEffect, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Prefs контракт (живут per-event) — SoT для display_name / nickname_color / show_avatar.
 * live_active_sessions — runtime mirror (обновляется отдельно).
 */
export type RoomEntryPrefs = {
  display_name: string;
  nickname_color: string | null;
  show_avatar: boolean;
};

export type RoomEntryPrefsState = {
  prefs: RoomEntryPrefs | null;
  isLoading: boolean;
  /** Self-preview avatar (НЕ утекает в room payload). Только для RoomEntryDialog. */
  profileAvatarUrl: string | null;
  /** Black-box draft full_name для пред-заполнения. НЕ копируется в snapshot. */
  profileFullName: string | null;
  upsertPrefs: (next: RoomEntryPrefs) => Promise<RoomEntryPrefs>;
  /** Silent runtime mirror в live_active_sessions (только если активная session существует). */
  syncSessionMirror: (next: RoomEntryPrefs) => Promise<void>;
};

const PREFS_KEY = (eventId: string, userId: string | null) => ["room-entry-prefs", eventId, userId];

export function useRoomEntryPrefs(liveEventId: string | undefined): RoomEntryPrefsState {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const queryClient = useQueryClient();

  const { data: prefs = null, isLoading: prefsLoading } = useQuery({
    queryKey: PREFS_KEY(liveEventId || "", userId),
    enabled: !!liveEventId && !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<RoomEntryPrefs | null> => {
      const { data, error } = await (supabase
        .from("live_event_participant_prefs") as any)
        .select("display_name, nickname_color, show_avatar")
        .eq("live_event_id", liveEventId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data || null;
    },
  });

  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileFullName, setProfileFullName] = useState<string | null>(null);

  // Self-preview only — НЕ кидаем в room state.
  useEffect(() => {
    if (!userId) {
      setProfileAvatarUrl(null);
      setProfileFullName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // Канонический ключ: profiles.user_id (id ≠ user_id в этом проекте).
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url, full_name")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      setProfileAvatarUrl(data?.avatar_url || null);
      setProfileFullName(data?.full_name || null);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const upsertPrefs = useCallback(async (next: RoomEntryPrefs): Promise<RoomEntryPrefs> => {
    if (!liveEventId || !userId) throw new Error("missing live_event_id or user_id");
    const payload = {
      live_event_id: liveEventId,
      user_id: userId,
      display_name: next.display_name,
      nickname_color: next.nickname_color,
      show_avatar: next.show_avatar,
    };
    const { data, error } = await (supabase
      .from("live_event_participant_prefs") as any)
      .upsert(payload, { onConflict: "live_event_id,user_id" })
      .select("display_name, nickname_color, show_avatar")
      .single();
    if (error) throw error;

    queryClient.setQueryData(PREFS_KEY(liveEventId, userId), data);
    return data as RoomEntryPrefs;
  }, [liveEventId, userId, queryClient]);

  const syncSessionMirror = useCallback(async (next: RoomEntryPrefs) => {
    if (!liveEventId || !userId) return;
    // Update only if there's an active row; do not insert (heartbeat is the writer).
    const { error } = await (supabase
      .from("live_active_sessions") as any)
      .update({
        display_name: next.display_name,
        nickname_color: next.nickname_color,
        show_avatar: next.show_avatar,
      })
      .eq("live_event_id", liveEventId)
      .eq("user_id", userId);
    if (error) {
      // non-fatal: prefs SoT already saved.
      // eslint-disable-next-line no-console
      console.warn("[useRoomEntryPrefs] session mirror update failed:", error.message);
    }
  }, [liveEventId, userId]);

  return {
    prefs,
    isLoading: prefsLoading,
    profileAvatarUrl,
    profileFullName,
    upsertPrefs,
    syncSessionMirror,
  };
}
