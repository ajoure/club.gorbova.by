/**
 * Inline moderation controls for webinar room messages.
 * Renders hover-visible action buttons for staff members.
 *
 * State source-of-truth:
 *   The latest relevant action in `live_event_room_moderation` for (live_event_id, user_id).
 *   UI reads current state first, then displays the inverse action (toggle).
 *
 * Toggle map:
 *   muted   <-> unmuted
 *   removed <-> restored
 *   delete  — irreversible, no toggle
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Trash2,
  Reply,
  UserX,
  UserCheck,
  VolumeX,
  Volume2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import {
  isStaffRole,
  isAdminRole,
  canModerateMessages,
  canRemoveFromRoom,
} from "@/lib/liveRoomRoles";

interface InlineModerationProps {
  liveEventId: string;
  messageId: string;
  messageUserId: string;
  messageTable: "live_event_comments" | "live_event_questions";
  onReply?: () => void;
  onOpenProfile?: (userId: string) => void;
}

interface UserModState {
  isMuted: boolean;
  isRemoved: boolean;
}

export function LiveInlineModeration({
  liveEventId,
  messageId,
  messageUserId,
  messageTable,
  onReply,
  onOpenProfile,
}: InlineModerationProps) {
  const { user, role } = useAuth();
  const queryClient = useQueryClient();
  const isStaff = isStaffRole(role);
  const isAdmin = isAdminRole(role);
  const isSelf = user?.id === messageUserId;

  // Read current moderation state — last mute/remove action wins.
  const { data: modState } = useQuery<UserModState>({
    queryKey: ["live-user-mod-state", liveEventId, messageUserId],
    enabled: isStaff && !isSelf,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_room_moderation")
        .select("action_type, created_at")
        .eq("live_event_id", liveEventId)
        .eq("user_id", messageUserId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return { isMuted: false, isRemoved: false };

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

  const isMuted = modState?.isMuted ?? false;
  const isRemoved = modState?.isRemoved ?? false;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!canModerateMessages(role)) throw new Error("Нет прав");
      const { error } = await supabase.from(messageTable).delete().eq("id", messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [
          messageTable === "live_event_comments" ? "live-event-comments" : "live-event-questions",
          liveEventId,
        ],
      });
      toast.success("Сообщение удалено");
    },
    onError: (err: any) => toast.error(`Ошибка: ${err.message}`),
  });

  const moderationMutation = useMutation({
    mutationFn: async (
      actionType: "muted" | "unmuted" | "removed" | "restored",
    ) => {
      if ((actionType === "removed" || actionType === "restored") && !canRemoveFromRoom(role)) {
        throw new Error("Нет прав на удаление из комнаты");
      }
      if ((actionType === "muted" || actionType === "unmuted") && !canModerateMessages(role)) {
        throw new Error("Нет прав на модерацию");
      }
      const reasonMap: Record<string, string> = {
        muted: "Заглушен из комнаты",
        unmuted: "Mute снят",
        removed: "Удалён из комнаты",
        restored: "Возвращён в комнату",
      };
      const { error } = await supabase
        .from("live_event_room_moderation")
        .insert({
          live_event_id: liveEventId,
          user_id: messageUserId,
          action_type: actionType,
          reason: reasonMap[actionType],
          created_by: user!.id,
        } as any);
      if (error) throw error;
    },
    onSuccess: (_, actionType) => {
      queryClient.invalidateQueries({ queryKey: ["live-event-moderation", liveEventId] });
      queryClient.invalidateQueries({
        queryKey: ["live-user-mod-state", liveEventId, messageUserId],
      });
      const labels: Record<string, string> = {
        muted: "Пользователь заглушен",
        unmuted: "Mute снят",
        removed: "Пользователь удалён из комнаты",
        restored: "Пользователь возвращён в комнату",
      };
      toast.success(labels[actionType]);
    },
    onError: (err: any) => toast.error(`Ошибка: ${err.message}`),
  });

  if (!isStaff) return null;

  return (
    <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex gap-1 transition-opacity ml-auto">
      {onReply && (
        <button onClick={onReply} title="Ответить" type="button">
          <Reply className="h-3 w-3 text-muted-foreground hover:text-foreground" />
        </button>
      )}
      {onOpenProfile && !isSelf && (
        <button onClick={() => onOpenProfile(messageUserId)} title="Открыть карточку" type="button">
          <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
        </button>
      )}
      {!isSelf && (
        <>
          {/* Toggle mute/unmute */}
          <button
            onClick={() => moderationMutation.mutate(isMuted ? "unmuted" : "muted")}
            title={isMuted ? "Снять mute" : "Заглушить"}
            disabled={moderationMutation.isPending}
            type="button"
          >
            {isMuted ? (
              <Volume2 className="h-3 w-3 text-amber-500 hover:text-amber-600" />
            ) : (
              <VolumeX className="h-3 w-3 text-muted-foreground hover:text-amber-500" />
            )}
          </button>
          {/* Delete (irreversible) */}
          <button
            onClick={() => deleteMutation.mutate()}
            title="Удалить сообщение"
            disabled={deleteMutation.isPending}
            type="button"
          >
            <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </button>
          {/* Toggle remove/restore — admin-only */}
          {isAdmin && (
            <button
              onClick={() => moderationMutation.mutate(isRemoved ? "restored" : "removed")}
              title={isRemoved ? "Вернуть в комнату" : "Удалить из комнаты"}
              disabled={moderationMutation.isPending}
              type="button"
            >
              {isRemoved ? (
                <UserCheck className="h-3 w-3 text-emerald-500 hover:text-emerald-600" />
              ) : (
                <UserX className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
