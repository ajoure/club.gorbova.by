/**
 * Inline moderation controls for webinar room messages.
 * Renders hover-visible action buttons for staff members.
 * Does NOT replace admin moderation panel — both coexist.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Trash2, Reply, UserX, VolumeX, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { isStaffRole, isAdminRole, canModerateMessages, canRemoveFromRoom } from "@/lib/liveRoomRoles";

interface InlineModerationProps {
  liveEventId: string;
  messageId: string;
  messageUserId: string;
  messageTable: "live_event_comments" | "live_event_questions";
  onReply?: () => void;
  onOpenProfile?: (userId: string) => void;
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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!canModerateMessages(role)) throw new Error("Нет прав");
      const { error } = await supabase.from(messageTable).delete().eq("id", messageId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [messageTable === "live_event_comments" ? "live-event-comments" : "live-event-questions", liveEventId] });
      toast.success("Сообщение удалено");
    },
    onError: (err: any) => toast.error(`Ошибка: ${err.message}`),
  });

  const moderationMutation = useMutation({
    mutationFn: async (actionType: "removed" | "muted") => {
      // Guard: only admin can remove, staff can mute
      if (actionType === "removed" && !canRemoveFromRoom(role)) {
        throw new Error("Нет прав на удаление из комнаты");
      }
      if (actionType === "muted" && !canModerateMessages(role)) {
        throw new Error("Нет прав на модерацию");
      }
      const { error } = await supabase.from("live_event_room_moderation").insert({
        live_event_id: liveEventId,
        user_id: messageUserId,
        action_type: actionType,
        reason: actionType === "muted" ? "Заглушен из комнаты" : "Удалён из комнаты",
        created_by: user!.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: (_, actionType) => {
      queryClient.invalidateQueries({ queryKey: ["live-event-moderation", liveEventId] });
      toast.success(actionType === "muted" ? "Пользователь заглушен" : "Пользователь удалён из комнаты");
    },
    onError: (err: any) => toast.error(`Ошибка: ${err.message}`),
  });

  if (!isStaff) return null;

  // Don't show moderation for own messages
  const isSelf = user?.id === messageUserId;

  return (
    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity ml-auto">
      {onReply && (
        <button onClick={onReply} title="Ответить">
          <Reply className="h-3 w-3 text-muted-foreground hover:text-foreground" />
        </button>
      )}
      {onOpenProfile && !isSelf && (
        <button onClick={() => onOpenProfile(messageUserId)} title="Открыть карточку">
          <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
        </button>
      )}
      {!isSelf && (
        <>
          {/* Staff: mute + delete */}
          <button onClick={() => moderationMutation.mutate("muted")} title="Заглушить" disabled={moderationMutation.isPending}>
            <VolumeX className="h-3 w-3 text-muted-foreground hover:text-amber-500" />
          </button>
          <button onClick={() => deleteMutation.mutate()} title="Удалить сообщение" disabled={deleteMutation.isPending}>
            <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </button>
          {/* Admin-only: remove from room */}
          {isAdmin && (
            <button onClick={() => moderationMutation.mutate("removed")} title="Удалить из комнаты" disabled={moderationMutation.isPending}>
              <UserX className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </button>
          )}
        </>
      )}
    </div>
  );
}
