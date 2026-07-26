// ============================================================================
// SmsHistorySection
// ----------------------------------------------------------------------------
// История SMS-сообщений по контакту или сделке. Источник: public.sms_messages.
// RLS гарантирует видимость только staff. Realtime — INSERT/UPDATE по фильтру.
// ============================================================================

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { MessageSquare, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface SmsRow {
  id: string;
  phone_e164: string | null;
  text: string | null;
  status: string;
  provider: string | null;
  sender: string | null;
  segments: number | null;
  cost: number | null;
  error: string | null;
  created_at: string;
}

interface Props {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  bare?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  sending: "Отправляется",
  sent: "Отправлено",
  delivered: "Доставлено",
  failed: "Ошибка",
  rejected: "Отклонено",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  sent: "default",
  delivered: "default",
  queued: "secondary",
  sending: "secondary",
  failed: "destructive",
  rejected: "destructive",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "delivered" || status === "sent") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "failed" || status === "rejected") return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

export function SmsHistorySection({ contactId, companyId, dealId, bare = false }: Props) {
  const enabled = Boolean(contactId || companyId || dealId);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const filter = contactId
      ? `contact_id=eq.${contactId}`
      : companyId
        ? `company_id=eq.${companyId}`
        : `deal_id=eq.${dealId}`;
    const channel = supabase
      .channel(`sms-${contactId ?? companyId ?? dealId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sms_messages", filter },
        () => {
          queryClient.invalidateQueries({ queryKey: ["sms-history", { contactId, companyId, dealId }] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, contactId, companyId, dealId, queryClient]);

  const { data, isLoading } = useQuery({
    queryKey: ["sms-history", { contactId, companyId, dealId }],
    enabled,
    queryFn: async (): Promise<SmsRow[]> => {
      let q = supabase
        .from("sms_messages")
        .select("id, phone_e164, text, status, provider, sender, segments, cost, error, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (contactId) q = q.eq("contact_id", contactId);
      else if (companyId) q = (q as any).eq("company_id", companyId);
      if (dealId) q = q.eq("deal_id", dealId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SmsRow[];
    },
  });

  const body = (
    <div className="space-y-2">
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">SMS пока не отправлялись</p>
      ) : (
        data.map((sms) => (
          <div
            key={sms.id}
            className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2 hover:bg-muted/30 transition-colors"
          >
            <StatusIcon status={sms.status} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{sms.phone_e164 ?? "—"}</span>
                <Badge
                  variant={STATUS_VARIANT[sms.status] ?? "outline"}
                  className="text-[10px] py-0 h-5"
                >
                  {STATUS_LABEL[sms.status] ?? sms.status}
                </Badge>
                {sms.sender && (
                  <span className="text-[10px] text-muted-foreground">от {sms.sender}</span>
                )}
              </div>
              {sms.text && (
                <p className="text-sm mt-1 whitespace-pre-wrap break-words">{sms.text}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                <span>{format(new Date(sms.created_at), "d MMM yyyy HH:mm", { locale: ru })}</span>
                {sms.segments != null && <span>сегм. {sms.segments}</span>}
                {sms.cost != null && Number(sms.cost) > 0 && (
                  <span>{Number(sms.cost).toFixed(3)} BYN</span>
                )}
                {sms.provider && <span className="hidden sm:inline">через {sms.provider}</span>}
              </div>
              {sms.error && (
                <p className="text-xs text-destructive mt-1">{sms.error}</p>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          SMS {data && data.length > 0 && <span className="text-xs">({data.length})</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
