import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  History,
  UserCheck,
  UserX,
  RefreshCw,
  Plus,
  Trash2,
  Ban,
  CreditCard,
  User,
  RotateCcw,
} from "lucide-react";

interface AccessHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

const getActionIcon = (action: string) => {
  if (action.includes("grant")) return <UserCheck className="w-4 h-4 text-green-600" />;
  if (action.includes("revoke") || action.includes("block")) return <UserX className="w-4 h-4 text-red-600" />;
  if (action.includes("delete")) return <Trash2 className="w-4 h-4 text-red-600" />;
  if (action.includes("extend")) return <RefreshCw className="w-4 h-4 text-blue-600" />;
  if (action.includes("cancel")) return <Ban className="w-4 h-4 text-amber-600" />;
  if (action.includes("resume")) return <RotateCcw className="w-4 h-4 text-green-600" />;
  if (action.includes("refund")) return <CreditCard className="w-4 h-4 text-purple-600" />;
  return <History className="w-4 h-4 text-muted-foreground" />;
};

const getActionLabel = (action: string) => {
  const labels: Record<string, string> = {
    "admin.grant_access": "Доступ выдан",
    "admin.subscription.grant_access": "Доступ активирован",
    "admin.subscription.revoke_access": "Доступ заблокирован",
    "admin.subscription.cancel": "Подписка отменена",
    "admin.subscription.resume": "Подписка возобновлена",
    "admin.subscription.extend": "Доступ продлён",
    "admin.subscription.delete": "Подписка удалена",
    "admin.subscription.refund": "Возврат средств",
  };
  return labels[action] || action;
};

const getActionBadgeVariant = (action: string) => {
  if (action.includes("grant") || action.includes("resume") || action.includes("extend")) {
    return "default";
  }
  if (action.includes("revoke") || action.includes("delete") || action.includes("refund")) {
    return "destructive";
  }
  if (action.includes("cancel")) {
    return "secondary";
  }
  return "outline";
};

export function AccessHistorySheet({ open, onOpenChange, userId }: AccessHistorySheetProps) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["access-history", userId],
    queryFn: async () => {
      // Get audit logs for subscription/access actions
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("target_user_id", userId)
        .ilike("action", "%subscription%")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      
      // Also get general access logs
      const { data: accessLogs, error: accessError } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("target_user_id", userId)
        .ilike("action", "%access%")
        .order("created_at", { ascending: false })
        .limit(100);

      if (accessError) throw accessError;

      // Combine and sort
      const allLogs = [...(data || []), ...(accessLogs || [])];
      const uniqueLogs = allLogs.filter((log, index, self) => 
        index === self.findIndex(l => l.id === log.id)
      );
      uniqueLogs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      return uniqueLogs;
    },
    enabled: open && !!userId,
  });

  // Fetch actor profiles for display
  const { data: actorProfiles } = useQuery({
    queryKey: ["actor-profiles", history?.map(h => h.actor_user_id).join(",")],
    queryFn: async () => {
      if (!history?.length) return {};
      const actorIds = [...new Set(history.map(h => h.actor_user_id).filter(Boolean))];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", actorIds);
      
      const profileMap: Record<string, any> = {};
      data?.forEach(p => { profileMap[p.user_id] = p; });
      return profileMap;
    },
    enabled: !!history?.length,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="pb-4 pr-12 border-b">
          <SheetTitle className="flex items-center gap-2">
            <History className="w-5 h-5 shrink-0" />
            <span className="truncate">История действий с доступами</span>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !history?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Нет истории действий</p>
            </div>
          ) : (
            <div className="space-y-3 pr-2">
              {history.map(log => {
                const meta = log.meta as Record<string, any> | null;
                const actor = actorProfiles?.[log.actor_user_id];
                
                return (
                  <Card key={log.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-1">
                          {getActionIcon(log.action)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <Badge variant={getActionBadgeVariant(log.action) as any}>
                              {getActionLabel(log.action)}
                            </Badge>
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {format(new Date(log.created_at), "dd.MM.yy HH:mm", { locale: ru })}
                            </span>
                          </div>
                          
                          {/* Actor info */}
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                            <User className="w-3 h-3" />
                            <span>
                              {actor?.full_name || actor?.email || log.actor_user_id?.slice(0, 8) + "..."}
                            </span>
                          </div>

                          {/* Meta details */}
                          {meta && (
                            <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded p-2">
                              {meta.days && (
                                <div>Дней: <span className="font-medium">{meta.days}</span></div>
                              )}
                              {meta.refund_amount && (
                                <div>
                                  Сумма возврата: <span className="font-medium">{meta.refund_amount} {meta.currency || "BYN"}</span>
                                </div>
                              )}
                              {meta.refund_reason && (
                                <div>
                                  Причина: <span className="font-medium">{meta.refund_reason}</span>
                                </div>
                              )}
                              {meta.new_end_date && (
                                <div>
                                  Новая дата: <span className="font-medium">
                                    {format(new Date(meta.new_end_date), "dd.MM.yyyy")}
                                  </span>
                                </div>
                              )}
                              {meta.subscription_id && !meta.refund_reason && (
                                <div className="truncate">
                                  ID: <code className="font-mono text-[10px]">{meta.subscription_id}</code>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
