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
  transcript: string | null;
  summary: string | null;
  transcript_status: string | null;
  transcript_error: string | null;
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);

  async function handleTranscribe(callId: string) {
    try {
      setProcessingId(callId);
      const { data, error } = await supabase.functions.invoke("call-transcribe-summarize", {
        body: { call_id: callId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Расшифровка готова");
      setExpanded((s) => ({ ...s, [callId]: true }));
      queryClient.invalidateQueries({ queryKey: ["calls-history", { contactId, dealId }] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка расшифровки";
      toast.error(msg);
    } finally {
      setProcessingId(null);
    }
  }

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
          "id, public_id, direction, status, started_at, answered_at, ended_at, duration_seconds, phone_from_e164, phone_to_e164, recording_url, transcript, summary, transcript_status, transcript_error"
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
          const isOpen = expanded[call.id];
          const hasResult = Boolean(call.transcript || call.summary);
          const isProcessing = processingId === call.id || call.transcript_status === "processing";
          return (
            <div
              key={call.id}
              className="rounded-lg border bg-card hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center gap-3 px-3 py-2">
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
                    <CallRecordingPlayer
                      src={call.recording_url}
                      fallbackDurationSec={call.duration_seconds}
                      fileName={`call-${call.public_id ?? call.id}.mp3`}
                    />
                    {hasResult ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        onClick={() => setExpanded((s) => ({ ...s, [call.id]: !isOpen }))}
                        title={isOpen ? "Скрыть расшифровку" : "Показать расшифровку"}
                      >
                        {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        <span className="ml-1 hidden sm:inline">AI</span>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs"
                        disabled={isProcessing}
                        onClick={() => handleTranscribe(call.id)}
                        title="Расшифровать и суммировать звонок"
                      >
                        {isProcessing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        <span className="ml-1 hidden sm:inline">AI-сводка</span>
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {hasResult && isOpen && (
                <div className="border-t px-3 py-2 space-y-2 bg-muted/20">
                  {call.summary && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                        Сводка
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{call.summary}</p>
                    </div>
                  )}
                  {call.transcript && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                        Расшифровка
                      </div>
                      <p className="text-xs whitespace-pre-wrap text-muted-foreground max-h-64 overflow-y-auto">
                        {call.transcript}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {call.transcript_status === "error" && call.transcript_error && (
                <div className="border-t px-3 py-1.5 text-xs text-destructive bg-destructive/5">
                  Ошибка расшифровки: {call.transcript_error}
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
