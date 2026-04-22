import { Loader2, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRoomParticipants, type RoomParticipant } from "@/hooks/useRoomParticipants";
import { resolveParticipantDisplay } from "@/lib/participantDisplay";
import { LiveRoleBadge, type AuthorRole } from "./LiveRoleBadge";

interface RoomParticipantsListProps {
  liveEventId: string;
  /** Если staff — рендерим real_name_for_staff под ником (если есть). */
  isStaff: boolean;
  /** Visibility toggle из room_settings.participants.visible_for_students. */
  visibleForStudents: boolean;
}

/**
 * Список участников комнаты.
 *
 * Privacy:
 * - Источник — RPC get_room_participants (server-side privacy filter).
 * - Не staff: real_name_for_staff IS NULL (сервер).
 * - show_avatar=false → avatar_url IS NULL (сервер).
 * - При visibleForStudents=false и !isStaff — компонент сам себя не рендерит
 *   (страховка от случайного включения родителем).
 */
export function RoomParticipantsList({
  liveEventId,
  isStaff,
  visibleForStudents,
}: RoomParticipantsListProps) {
  const enabled = isStaff || visibleForStudents;
  const { data: participants, isLoading } = useRoomParticipants(liveEventId, enabled);

  if (!enabled) return null;

  return (
    <div className="flex flex-col h-full min-h-0 room-panel">
      <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-2 py-1.5 text-xs text-muted-foreground m-3 mb-2">
        <Users className="h-3 w-3 shrink-0" />
        <span>Участники сейчас в комнате</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-1 overscroll-contain">
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : !participants?.length ? (
          <p className="text-sm room-meta-text text-center py-4">Нет активных участников</p>
        ) : (
          participants.map((p: RoomParticipant) => {
            const display = resolveParticipantDisplay({
              user_id: p.user_id,
              author_display_name: p.display_name,
              author_avatar_url: p.show_avatar === false ? null : p.avatar_url,
            });
            const role = (p.role_in_room as AuthorRole | string | null) || null;
            return (
              <div
                key={p.user_id}
                className="flex items-center gap-2 rounded-md p-1.5 hover:bg-muted/40 transition-colors"
              >
                <Avatar className="h-7 w-7 shrink-0">
                  {display.avatarUrl && (
                    <AvatarImage src={display.avatarUrl} alt={display.displayName} />
                  )}
                  <AvatarFallback className="text-[10px]">{display.initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-xs font-medium room-message-text truncate"
                      style={p.nickname_color ? { color: p.nickname_color } : undefined}
                    >
                      {display.displayName}
                    </span>
                    <LiveRoleBadge role={role} />
                  </div>
                  {isStaff && p.real_name_for_staff && (
                    <p className="text-[10px] room-meta-text truncate">
                      {p.real_name_for_staff}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
