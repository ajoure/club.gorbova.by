import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

interface AuditProofRow {
  created_at: string;
  action: string;
  actor_type: string | null;
  actor_label: string | null;
  actor_user_id: string | null;
  sent: number;
  failed: number;
  diagnostic: Record<string, unknown>;
  meta: Record<string, unknown>;
}

/**
 * Runtime audit proof для PATCH-A:
 * показывает последнюю запись audit_logs о реальной отправке через scheduled dispatcher.
 * Источник истины — RPC get_last_broadcast_audit_proof (admin-only).
 */
export function BroadcastAuditProofCard() {
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["broadcast-audit-proof"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_last_broadcast_audit_proof");
      if (error) throw error;
      const rows = (data ?? []) as AuditProofRow[];
      return rows[0] ?? null;
    },
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {data ? (
            <ShieldCheck className="h-4 w-4 text-green-600" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          )}
          Последний runtime audit proof (scheduled dispatcher)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">
            Ошибка загрузки: {(error as Error).message}
          </div>
        ) : !data ? (
          <div className="text-sm text-muted-foreground">
            Ожидание первого реального запуска через scheduled dispatcher.
            Записей audit_logs с actor_label='broadcast-dispatcher' пока нет.
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="text-muted-foreground">Дата</div>
              <div>{new Date(data.created_at).toLocaleString("ru-RU")}</div>

              <div className="text-muted-foreground">Action</div>
              <div className="font-mono text-xs">{data.action}</div>

              <div className="text-muted-foreground">Actor</div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{data.actor_type}</Badge>
                <Badge variant="outline">{data.actor_label}</Badge>
              </div>

              <div className="text-muted-foreground">Sent / Failed</div>
              <div>
                <Badge variant="default" className="bg-green-600">
                  {data.sent}
                </Badge>{" "}
                /{" "}
                <Badge variant={data.failed > 0 ? "destructive" : "secondary"}>
                  {data.failed}
                </Badge>
              </div>
            </div>

            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2">
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                />
                Diagnostic
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                  {JSON.stringify(data.diagnostic, null, 2)}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
