import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Eye, EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { DomainEventService } from "@/lib/domain-events";

export function LiveEventCtaRuntimePanel({ liveEventId }: { liveEventId: string }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();

  const { data: bindings, isLoading } = useQuery({
    queryKey: ["cta-bindings-admin", liveEventId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("live_event_product_cta_bindings") as any)
        .select("id, title_override, cta_type, position, is_active, product_id")
        .eq("live_event_id", liveEventId)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
  });

  // Get latest runtime state per binding
  const { data: runtimeState } = useQuery({
    queryKey: ["cta-runtime-state", liveEventId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("live_event_cta_runtime_events") as any)
        .select("id, binding_id, event_type, created_at")
        .eq("live_event_id", liveEventId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      // Build map: binding_id -> latest event_type
      const stateMap: Record<string, string> = {};
      for (const ev of (data || [])) {
        if (!stateMap[ev.binding_id]) {
          stateMap[ev.binding_id] = ev.event_type;
        }
      }
      return stateMap;
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ bindingId, eventType }: { bindingId: string; eventType: string }) => {
      const { error } = await (supabase
        .from("live_event_cta_runtime_events") as any)
        .insert({
          live_event_id: liveEventId,
          binding_id: bindingId,
          event_type: eventType,
          trigger_mode: "manual",
          shown_by: session?.user?.id,
          metadata: {},
        });
      if (error) throw error;

      // Domain event + audit
      await DomainEventService.emitEvent(
        `live_product_cta_${eventType}`,
        "webinar",
        liveEventId,
        { binding_id: bindingId, actor: session?.user?.id }
      );

      // Audit log
      await (supabase.from("audit_logs") as any).insert({
        action: `cta_${eventType}`,
        actor_type: "user",
        actor_user_id: session?.user?.id,
        meta: { live_event_id: liveEventId, binding_id: bindingId },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cta-runtime-state", liveEventId] });
      queryClient.invalidateQueries({ queryKey: ["cta-runtime", liveEventId] });
      toast.success("CTA обновлён");
    },
    onError: (e: any) => toast.error(e.message || "Ошибка"),
  });

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!bindings?.length) return <p className="text-sm text-muted-foreground text-center py-4">Нет активных CTA для управления</p>;

  return (
    <div className="space-y-2 p-3">
      <span className="text-sm font-medium">Управление CTA в эфире</span>
      {bindings.map((b: any) => {
        const currentState = runtimeState?.[b.id];
        const isShown = currentState === "shown" || currentState === "replaced";

        return (
          <Card key={b.id}>
            <CardContent className="p-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{b.title_override || b.product_id?.slice(0, 8)}</p>
                <Badge variant={isShown ? "default" : "outline"} className="text-[9px] px-1 mt-0.5">
                  {isShown ? "Показан" : currentState === "hidden" ? "Скрыт" : "Не показан"}
                </Badge>
              </div>
              <div className="flex gap-1">
                {!isShown ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => actionMutation.mutate({ bindingId: b.id, eventType: "shown" })}
                    disabled={actionMutation.isPending}>
                    <Eye className="h-3 w-3" /> Показать
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                    onClick={() => actionMutation.mutate({ bindingId: b.id, eventType: "hidden" })}
                    disabled={actionMutation.isPending}>
                    <EyeOff className="h-3 w-3" /> Скрыть
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
