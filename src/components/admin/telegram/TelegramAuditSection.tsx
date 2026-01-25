import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, FileText, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function TelegramAuditSection() {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const { data: auditLogs, isLoading } = useQuery({
    queryKey: ['telegram-audit-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('id, action, actor_type, actor_label, meta, created_at')
        .or('action.eq.telegram.bot_config_missing,action.eq.subscription.reminders_cron_completed')
        .order('created_at', { ascending: false })
        .limit(30);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Audit Logs (Telegram)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Audit Logs (Telegram)
          <span className="text-sm font-normal text-muted-foreground ml-auto">
            {auditLogs?.length || 0} записей
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {!auditLogs || auditLogs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Нет audit-логов по Telegram
          </div>
        ) : (
          auditLogs.map((log) => {
            const meta = log.meta as any;
            const isExpanded = expandedItems.has(log.id);
            const isBotMissing = log.action === 'telegram.bot_config_missing';
            
            return (
              <Collapsible key={log.id} open={isExpanded} onOpenChange={() => toggleExpand(log.id)}>
                <CollapsibleTrigger className="w-full">
                  <div className={cn(
                    "flex items-center gap-3 p-3 rounded-lg border transition-colors hover:bg-muted/50",
                    isBotMissing ? 'border-destructive/30 bg-destructive/5' : 'border-border'
                  )}>
                    {isBotMissing ? (
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                    )}
                    
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{log.action}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {log.actor_type}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(log.created_at), 'dd MMM yyyy HH:mm:ss', { locale: ru })}
                        {log.actor_label && ` • ${log.actor_label}`}
                      </div>
                    </div>
                    
                    {/* Quick stats */}
                    {meta && !isBotMissing && (
                      <div className="flex gap-2 text-xs">
                        {meta.telegram_sent_count !== undefined && (
                          <Badge variant="outline" className="bg-green-500/10">
                            Sent: {meta.telegram_sent_count}
                          </Badge>
                        )}
                        {meta.skipped_no_telegram_linked_count !== undefined && meta.skipped_no_telegram_linked_count > 0 && (
                          <Badge variant="outline" className="bg-amber-500/10">
                            Skip TG: {meta.skipped_no_telegram_linked_count}
                          </Badge>
                        )}
                        {meta.skipped_no_link_bot_count !== undefined && meta.skipped_no_link_bot_count > 0 && (
                          <Badge variant="outline" className="bg-amber-500/10">
                            Skip Bot: {meta.skipped_no_link_bot_count}
                          </Badge>
                        )}
                        {meta.failed_send_count !== undefined && meta.failed_send_count > 0 && (
                          <Badge variant="outline" className="bg-red-500/10">
                            Fail: {meta.failed_send_count}
                          </Badge>
                        )}
                        {meta.duplicate_suppressed_count !== undefined && meta.duplicate_suppressed_count > 0 && (
                          <Badge variant="outline" className="bg-purple-500/10">
                            Dup: {meta.duplicate_suppressed_count}
                          </Badge>
                        )}
                      </div>
                    )}
                    
                    <ChevronDown className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform shrink-0",
                      isExpanded && "rotate-180"
                    )} />
                  </div>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <div className="mt-2 p-3 rounded-lg bg-muted/30 text-xs">
                    <pre className="overflow-auto max-h-[300px] whitespace-pre-wrap">
                      {JSON.stringify(meta, null, 2)}
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
