// ============================================================================
// AdminCalls — общий журнал звонков платформы
// ----------------------------------------------------------------------------
// Заменяет старую страницу «Звонки без привязки». Показывает все звонки
// (входящие/исходящие/пропущенные) всех сотрудников, с поиском, фильтрами,
// прослушиванием записи, AI-расшифровкой и быстрой привязкой к контакту.
// ============================================================================

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Play,
  Sparkles,
  Loader2,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Search,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ContactPickerDialog,
  type PickedContact,
} from "@/components/admin/shared/pickers/ContactPickerDialog";
import callsHero from "@/assets/calls-hero.jpg";

interface CallRow {
  id: string;
  public_id: string | null;
  direction: string;
  status: string;
  link_status: string | null;
  started_at: string | null;
  duration_seconds: number | null;
  phone_from_e164: string | null;
  phone_to_e164: string | null;
  recording_url: string | null;
  transcript: string | null;
  summary: string | null;
  transcript_status: string | null;
  transcript_error: string | null;
  contact_id: string | null;
  deal_id: string | null;
  staff_user_id?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  ringing: "Звонит",
  answered: "Принят",
  completed: "Завершён",
  no_answer: "Без ответа",
  busy: "Занято",
  failed: "Сбой",
  cancelled: "Отменён",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  answered: "default",
  no_answer: "secondary",
  busy: "secondary",
  failed: "destructive",
  cancelled: "outline",
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

type FilterTab = "all" | "unresolved" | "missed" | "today";

export default function AdminCalls() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Привязка к контакту
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerForCallId, setPickerForCallId] = useState<string | null>(null);
  const [pickerInitialQuery, setPickerInitialQuery] = useState<string | null>(null);
  const [bindingCallId, setBindingCallId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-calls-journal", tab],
    queryFn: async (): Promise<CallRow[]> => {
      let q = supabase
        .from("calls")
        .select(
          "id, public_id, direction, status, link_status, started_at, duration_seconds, phone_from_e164, phone_to_e164, recording_url, transcript, summary, transcript_status, transcript_error, contact_id, deal_id"
        )
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (tab === "unresolved") q = q.in("link_status", ["unresolved"]);
      if (tab === "missed") q = q.in("status", ["no_answer", "busy", "cancelled"]);
      if (tab === "today") {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        q = q.gte("started_at", since.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as CallRow[];
    },
  });

  const rows = useMemo(() => {
    const list = data ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (c) =>
        c.phone_from_e164?.toLowerCase().includes(term) ||
        c.phone_to_e164?.toLowerCase().includes(term) ||
        c.public_id?.toLowerCase().includes(term) ||
        c.summary?.toLowerCase().includes(term) ||
        c.transcript?.toLowerCase().includes(term)
    );
  }, [data, search]);

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
      queryClient.invalidateQueries({ queryKey: ["admin-calls-journal"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка расшифровки";
      toast.error(msg);
    } finally {
      setProcessingId(null);
    }
  }

  function openPicker(call: CallRow) {
    setPickerForCallId(call.id);
    const phone = call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
    setPickerInitialQuery(phone ?? null);
    setPickerOpen(true);
  }

  async function handlePick(contact: PickedContact) {
    if (!pickerForCallId) return;
    setBindingCallId(pickerForCallId);
    try {
      const { error } = await supabase
        .from("calls")
        .update({
          contact_id: contact.id,
          link_status: "manual",
          updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .eq("id", pickerForCallId);
      if (error) throw error;
      toast.success("Звонок привязан к контакту");
      setPickerOpen(false);
      setPickerForCallId(null);
      queryClient.invalidateQueries({ queryKey: ["admin-calls-journal"] });
      queryClient.invalidateQueries({ queryKey: ["calls-history"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось привязать звонок");
    } finally {
      setBindingCallId(null);
    }
  }

  const unresolvedCount = useMemo(
    () => (data ?? []).filter((c) => c.link_status === "unresolved").length,
    [data]
  );

  return (
    <div className="container mx-auto py-6 space-y-5">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-card">
        <img
          src={callsHero}
          alt=""
          width={1920}
          height={512}
          className="absolute inset-0 h-full w-full object-cover opacity-90"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent" />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
            <Phone className="h-3.5 w-3.5" /> Журнал звонков
          </div>
          <h1 className="text-3xl font-semibold mt-2">Звонки</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Все звонки сотрудников платформы: входящие, исходящие, пропущенные.
            Слушайте записи, читайте AI-расшифровки и привязывайте к контактам.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList>
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="today">Сегодня</TabsTrigger>
            <TabsTrigger value="missed">Пропущенные</TabsTrigger>
            <TabsTrigger value="unresolved">
              Без привязки
              {unresolvedCount > 0 && (
                <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
                  {unresolvedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Телефон, ID, текст…"
            className="pl-8 h-9"
          />
        </div>
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              {search ? "Ничего не найдено" : "Звонков пока нет"}
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map((call) => {
                const phone =
                  call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
                const counterPhone =
                  call.direction === "inbound" ? call.phone_to_e164 : call.phone_from_e164;
                const isOpen = expanded[call.id];
                const hasResult = Boolean(call.transcript || call.summary);
                const isProcessing =
                  processingId === call.id || call.transcript_status === "processing";
                const isUnresolved =
                  call.link_status === "unresolved" || call.link_status === "ambiguous";
                const binding = bindingCallId === call.id;
                return (
                  <div
                    key={call.id}
                    className="rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 px-3 py-2 flex-wrap sm:flex-nowrap">
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
                          {isUnresolved && (
                            <Badge variant="outline" className="text-[10px] py-0 h-5">
                              Без привязки
                            </Badge>
                          )}
                          {call.contact_id && (
                            <Link
                              to={`/admin/contacts/${call.contact_id}`}
                              className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
                            >
                              Контакт <ExternalLink className="h-3 w-3" />
                            </Link>
                          )}
                          {call.public_id && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {call.public_id}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                          {call.started_at && (
                            <span>
                              {format(new Date(call.started_at), "d MMM yyyy HH:mm", {
                                locale: ru,
                              })}
                            </span>
                          )}
                          <span>длит. {formatDuration(call.duration_seconds)}</span>
                          {counterPhone && (
                            <span className="hidden sm:inline">через {counterPhone}</span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2 flex-wrap">
                        {call.recording_url && (
                          <audio
                            controls
                            preload="none"
                            src={call.recording_url}
                            className="h-8 max-w-[220px]"
                            title="Запись звонка"
                          />
                        )}
                        {call.recording_url && (
                          hasResult ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 px-2 text-xs"
                              onClick={() =>
                                setExpanded((s) => ({ ...s, [call.id]: !isOpen }))
                              }
                              title={isOpen ? "Скрыть расшифровку" : "Показать расшифровку"}
                            >
                              {isOpen ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
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
                          )
                        )}
                        {call.recording_url && (
                          <a
                            href={call.recording_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                              "hover:bg-accent transition-colors"
                            )}
                            title="Открыть запись"
                          >
                            <Play className="h-3 w-3" />
                          </a>
                        )}
                        {isUnresolved && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={binding}
                            onClick={() => openPicker(call)}
                            className="h-8 px-2 text-xs"
                          >
                            {binding ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <UserPlus className="h-3 w-3 mr-1" />
                            )}
                            Привязать
                          </Button>
                        )}
                      </div>
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
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ContactPickerDialog
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o) setPickerForCallId(null);
        }}
        onPick={handlePick}
        options={{
          title: "Привязать звонок к контакту",
          initialQuery: pickerInitialQuery,
          helperText: "Поиск по имени, email или телефону",
        }}
      />
    </div>
  );
}
