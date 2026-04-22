import { useMemo } from "react";
import { useRoomParticipants } from "./useRoomParticipants";

/**
 * Add-only хук: возвращает Map<user_id, real_name_for_staff> ТОЛЬКО для staff.
 *
 * Источник — тот же RPC get_room_participants (privacy-aware на сервере).
 * Никаких прямых client-fetch в profiles здесь НЕТ.
 *
 * Контракт fallback: если автор сообщения не в активных участниках,
 * хук вернёт undefined для его user_id → UI показывает alias как обычно.
 * Это сознательный privacy-fallback (см. финальный proof-pack).
 */
export function useStaffNameMap(
  liveEventId: string | null | undefined,
  isStaff: boolean,
) {
  const enabled = !!isStaff && !!liveEventId;
  const { data: participants } = useRoomParticipants(liveEventId, enabled);

  return useMemo(() => {
    const map = new Map<string, string>();
    if (!isStaff || !participants) return map;
    for (const p of participants) {
      if (p.real_name_for_staff && p.real_name_for_staff.trim()) {
        map.set(p.user_id, p.real_name_for_staff);
      }
    }
    return map;
  }, [participants, isStaff]);
}
