import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldX, ShieldCheck, UserX, VolumeX, Volume2 } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

interface ModerationAction {
  id: string;
  user_id: string;
  action_type: string;
  reason: string | null;
  created_at: string;
  created_by: string;
}

export function LiveEventModerationPanel({ liveEventId }: { liveEventId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [targetUserId, setTargetUserId] = useState("");
  const [reason, setReason] = useState("");

  const { data: actions, isLoading } = useQuery({
    queryKey: ["live-event-moderation", liveEventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_room_moderation")
        .select("id, user_id, action_type, reason, created_at, created_by")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      // Fetch profile names for user_ids
      const userIds = [...new Set((data || []).map(a => a.user_id))];
      let profiles: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("user_id, full_name, first_name, last_name")
          .in("user_id", userIds);
        for (const p of profileData || []) {
          profiles[p.user_id] = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Пользователь";
        }
      }

      return (data || []).map(a => ({
        ...a,
        userName: profiles[a.user_id] || a.user_id.slice(0, 8),
      }));
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      if (!targetUserId.trim()) throw new Error("Укажите ID пользователя");
      const { error } = await supabase.from("live_event_room_moderation").insert({
        live_event_id: liveEventId,
        user_id: targetUserId.trim(),
        action_type: "removed",
        reason: reason.trim() || null,
        created_by: user!.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Пользователь удалён из комнаты");
      setTargetUserId("");
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["live-event-moderation", liveEventId] });
    },
    onError: (err: any) => toast.error(`Ошибка: ${err.message}`),
  });

  const restoreMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("live_event_room_moderation").insert({
        live_event_id: liveEventId,
        user_id: userId,
        action_type: "restored",
        reason: "Восстановлен администратором",
        created_by: user!.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Доступ восстановлен");
      queryClient.invalidateQueries({ queryKey: ["live-event-moderation", liveEventId] });
    },
    onError: (err: any) => toast.error(`Ошибка: ${err.message}`),
  });

  // Compute current state per user
  const currentStates = new Map<string, { action_type: string; userName: string }>();
  if (actions) {
    for (const a of [...actions].reverse()) {
      currentStates.set(a.user_id, { action_type: a.action_type, userName: (a as any).userName });
    }
  }
  const removedUsers = Array.from(currentStates.entries())
    .filter(([, s]) => s.action_type === "removed" || s.action_type === "banned");
  const mutedUsers = Array.from(currentStates.entries())
    .filter(([, s]) => s.action_type === "muted");

  return (
    <div className="space-y-4 p-3">
      <div className="space-y-2">
        <h4 className="text-sm font-medium flex items-center gap-1.5">
          <UserX className="h-4 w-4" /> Удалить пользователя из комнаты
        </h4>
        <div className="flex gap-2">
          <Input
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            placeholder="UUID пользователя"
            className="text-sm font-mono"
          />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина (необязательно)"
            className="text-sm"
          />
          <Button size="sm" variant="destructive" onClick={() => removeMutation.mutate()}
            disabled={!targetUserId.trim() || removeMutation.isPending}>
            {removeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Удалить"}
          </Button>
        </div>
      </div>

      {removedUsers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <ShieldX className="h-4 w-4 text-destructive" /> Удалённые ({removedUsers.length})
          </h4>
          {removedUsers.map(([userId, state]) => (
            <div key={userId} className="flex items-center justify-between border rounded p-2 text-sm">
              <div>
                <span className="font-medium">{state.userName}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {state.action_type === "banned" ? "Заблокирован" : "Удалён"}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => restoreMutation.mutate(userId)}
                disabled={restoreMutation.isPending}>
                <ShieldCheck className="h-3 w-3 mr-1" /> Восстановить
              </Button>
            </div>
          ))}
        </div>
      )}

      {mutedUsers.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-1.5">
            <VolumeX className="h-4 w-4 text-amber-500" /> Заглушенные ({mutedUsers.length})
          </h4>
          {mutedUsers.map(([userId, state]) => (
            <div key={userId} className="flex items-center justify-between border rounded p-2 text-sm">
              <div>
                <span className="font-medium">{state.userName}</span>
                <span className="text-xs text-muted-foreground ml-2">Заглушен</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => restoreMutation.mutate(userId)}
                disabled={restoreMutation.isPending}>
                <Volume2 className="h-3 w-3 mr-1" /> Разглушить
              </Button>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">История действий</h4>
          {!actions?.length ? (
            <p className="text-sm text-muted-foreground">Нет действий модерации</p>
          ) : (
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {actions.map((a: any) => (
                <div key={a.id} className="flex items-center gap-2 text-xs border-b py-1.5">
                  <Badge variant={a.action_type === "restored" || a.action_type === "unmuted" ? "outline" : "destructive"} className="text-[9px]">
                    {a.action_type === "removed" ? "Удалён" : a.action_type === "banned" ? "Заблокирован" : a.action_type === "muted" ? "Заглушен" : a.action_type === "unmuted" ? "Разглушен" : "Восстановлен"}
                  </Badge>
                  <span className="font-medium">{a.userName}</span>
                  {a.reason && <span className="text-muted-foreground">— {a.reason}</span>}
                  <span className="text-muted-foreground ml-auto">
                    {format(new Date(a.created_at), "dd.MM HH:mm", { locale: ru })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
