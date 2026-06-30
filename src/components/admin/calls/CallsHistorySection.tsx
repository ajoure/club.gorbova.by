// ============================================================================
// CallsHistorySection
// ----------------------------------------------------------------------------
// Read-only список звонков по контакту или сделке (VOCHI Phase 2).
// Источник: public.calls. RLS гарантирует, что строки видят только staff.
// ============================================================================

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Play, Sparkles, Loader2, ChevronDown, ChevronUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CallRow {
  id: string;
  public_id: string | null;
  direction: "inbound" | "outbound" | string;
  status: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  phone_from_e164: string | null;
  phone_to_e164: string | null;
  recording_url: string | null;
}

interface Props {
  contactId?: string;
  dealId?: string;
  /** Без обёртки в Card (для встраивания во вкладку) */
  bare?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  ringing: "Звонит",
  answered: "Принят",
  completed: "Завершён",
  no_answer: "Без ответа",
  busy: "Занято",
  failed: "Сбой",
  canceled: "Отменён",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  answered: "default",
  no_answer: "secondary",
  busy: "secondary",
  failed: "destructive",
  canceled: "outline",
};

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function DirectionIcon({ direction, status }: { direction: string; status: string }) {
  const missed = status === "no_answer" || status === "busy" || status === "canceled";
  if (missed) return <PhoneMissed className="h-4 w-4 text-destructive" />;
  if (direction === "inbound") return <PhoneIncoming className="h-4 w-4 text-emerald-600" />;
  if (direction === "outbound") return <PhoneOutgoing className="h-4 w-4 text-blue-600" />;
  return <Phone className="h-4 w-4 text-muted-foreground" />;
}

export function CallsHistorySection({ contactId, dealId, bare = false }: Props) {
  const enabled = Boolean(contactId || dealId);
  const queryClient = useQueryClient();

  // Phase 3 — Realtime: подписка на INSERT/UPDATE по этому контакту/сделке.
  useEffect(() => {
    if (!enabled) return;
    const filter = contactId
      ? `contact_id=eq.${contactId}`
      : `deal_id=eq.${dealId}`;
    const channel = supabase
      .channel(`calls-${contactId ?? dealId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls", filter },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["calls-history", { contactId, dealId }],
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, contactId, dealId, queryClient]);


  const { data, isLoading } = useQuery({
    queryKey: ["calls-history", { contactId, dealId }],
    enabled,
    queryFn: async (): Promise<CallRow[]> => {
      let q = supabase
        .from("calls")
        .select(
          "id, public_id, direction, status, started_at, answered_at, ended_at, duration_seconds, phone_from_e164, phone_to_e164, recording_url"
        )
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(100);
      if (contactId) q = q.eq("contact_id", contactId);
      if (dealId) q = q.eq("deal_id", dealId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CallRow[];
    },
  });

  const body = (
    <div className="space-y-2">
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Звонков пока нет</p>
      ) : (
        data.map((call) => {
          const phone =
            call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
          const counterPhone =
            call.direction === "inbound" ? call.phone_to_e164 : call.phone_from_e164;
          return (
            <div
              key={call.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 hover:bg-muted/30 transition-colors"
            >
              <DirectionIcon direction={call.direction} status={call.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{phone ?? "—"}</span>
                  <Badge
                    variant={STATUS_VARIANT[call.status] ?? "outline"}
                    className="text-[10px] py-0 h-5"
                  >
                    {STATUS_LABEL[call.status] ?? call.status}
                  </Badge>
                  {call.public_id && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {call.public_id}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                  {call.started_at && (
                    <span>
                      {format(new Date(call.started_at), "d MMM yyyy HH:mm", { locale: ru })}
                    </span>
                  )}
                  <span>длит. {formatDuration(call.duration_seconds)}</span>
                  {counterPhone && (
                    <span className="hidden sm:inline">через {counterPhone}</span>
                  )}
                </div>
              </div>
              {call.recording_url && (
                <div className="shrink-0 flex items-center gap-2">
                  <audio
                    controls
                    preload="none"
                    src={call.recording_url}
                    className="h-8 max-w-[220px]"
                    title="Запись звонка"
                  />
                  <a
                    href={call.recording_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                      "hover:bg-accent transition-colors"
                    )}
                    title="Открыть запись в новой вкладке"
                  >
                    <Play className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <Phone className="w-4 h-4" />
          Звонки {data && data.length > 0 && <span className="text-xs">({data.length})</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
