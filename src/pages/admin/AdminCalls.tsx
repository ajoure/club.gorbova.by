// ============================================================================
// AdminCalls — общий журнал «Звонки и SMS»
// ----------------------------------------------------------------------------
// Единая лента звонков (public.calls) и SMS-сообщений (public.sms_messages).
// Возможности: фильтры (Все/Звонки/SMS/Сегодня/Пропущенные/Без привязки),
// сортировка по дате, поиск, массовая AI-расшифровка выбранных звонков,
// экспорт текущей выборки в CSV, имя контакта главное + телефон рядом,
// карточка контакта открывается слайдовером (как в платежах).
// ============================================================================

import { useEffect, useMemo, useState } from "react";
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
  Download,
  MessageSquare,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ContactPickerDialog,
  type PickedContact,
} from "@/components/admin/shared/pickers/ContactPickerDialog";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import callsHero from "@/assets/calls-hero.jpg";

// ---------- Types ----------

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
}

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
  contact_id: string | null;
  deal_id: string | null;
}

type Item =
  | { kind: "call"; ts: string | null; phone: string | null; contact_id: string | null; call: CallRow }
  | { kind: "sms"; ts: string | null; phone: string | null; contact_id: string | null; sms: SmsRow };

type FilterTab = "all" | "calls" | "sms" | "today" | "missed" | "unresolved";

// ---------- Constants ----------

const CALL_STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  ringing: "Звонит",
  answered: "Принят",
  completed: "Завершён",
  no_answer: "Без ответа",
  busy: "Занято",
  failed: "Сбой",
  cancelled: "Отменён",
};
const CALL_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "default",
  answered: "default",
  no_answer: "secondary",
  busy: "secondary",
  failed: "destructive",
  cancelled: "outline",
};

const SMS_STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  sending: "Отправляется",
  sent: "Отправлено",
  delivered: "Доставлено",
  failed: "Ошибка",
  rejected: "Отклонено",
};
const SMS_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  sent: "default",
  delivered: "default",
  queued: "secondary",
  sending: "secondary",
  failed: "destructive",
  rejected: "destructive",
};

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function DirectionIcon({ direction, status }: { direction: string; status: string }) {
  const missed = status === "no_answer" || status === "busy" || status === "cancelled";
  if (missed) return <PhoneMissed className="h-4 w-4 text-destructive" />;
  if (direction === "inbound") return <PhoneIncoming className="h-4 w-4 text-emerald-600" />;
  if (direction === "outbound") return <PhoneOutgoing className="h-4 w-4 text-blue-600" />;
  return <Phone className="h-4 w-4 text-muted-foreground" />;
}

function SmsStatusIcon({ status }: { status: string }) {
  if (status === "delivered" || status === "sent")
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "failed" || status === "rejected")
    return <AlertTriangle className="h-4 w-4 text-destructive" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n;]/.test(s) ? `"${s}"` : s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================

export default function AdminCalls() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  // Универсальная выборка: ключи вида "call:<id>" и "sms:<id>" — чекбоксы на каждой строке.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);

  // Contact slideover
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);

  // Manual binding
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerForCallId, setPickerForCallId] = useState<string | null>(null);
  const [pickerInitialQuery, setPickerInitialQuery] = useState<string | null>(null);
  const [bindingCallId, setBindingCallId] = useState<string | null>(null);

  // ---------- Data: calls ----------
  const { data: calls, isLoading: callsLoading } = useQuery({
    queryKey: ["admin-calls-journal", "calls"],
    queryFn: async (): Promise<CallRow[]> => {
      const { data, error } = await supabase
        .from("calls")
        .select(
          "id, public_id, direction, status, link_status, started_at, duration_seconds, phone_from_e164, phone_to_e164, recording_url, transcript, summary, transcript_status, transcript_error, contact_id, deal_id"
        )
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as CallRow[];
    },
  });

  // ---------- Data: sms ----------
  const { data: smses, isLoading: smsLoading } = useQuery({
    queryKey: ["admin-calls-journal", "sms"],
    queryFn: async (): Promise<SmsRow[]> => {
      const { data, error } = await supabase
        .from("sms_messages")
        .select(
          "id, phone_e164, text, status, provider, sender, segments, cost, error, created_at, contact_id, deal_id"
        )
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as SmsRow[];
    },
  });

  const isLoading = callsLoading || smsLoading;

  // ---------- Bulk-fetch contact names for visible items ----------
  const contactIds = useMemo(() => {
    const set = new Set<string>();
    (calls ?? []).forEach((c) => c.contact_id && set.add(c.contact_id));
    (smses ?? []).forEach((s) => s.contact_id && set.add(s.contact_id));
    return Array.from(set);
  }, [calls, smses]);

  const { data: contactsMap } = useQuery({
    queryKey: ["admin-calls-journal", "contacts", contactIds],
    enabled: contactIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, first_name, last_name, email, phone, avatar_url")
        .in("id", contactIds);
      if (error) throw error;
      const map = new Map<string, { name: string; email: string | null; avatar_url: string | null }>();
      (data ?? []).forEach((p: any) => {
        const name =
          p.full_name ||
          [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
          p.email ||
          p.phone ||
          "Без имени";
        map.set(p.id, { name, email: p.email ?? null, avatar_url: p.avatar_url ?? null });
      });
      return map;
    },
  });

  function contactName(contactId: string | null): string | null {
    if (!contactId) return null;
    return contactsMap?.get(contactId)?.name ?? null;
  }

  // ---------- Realtime ----------
  useEffect(() => {
    const ch = supabase
      .channel("admin-calls-journal-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-calls-journal", "calls"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sms_messages" }, () => {
        queryClient.invalidateQueries({ queryKey: ["admin-calls-journal", "sms"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [queryClient]);

  // ---------- Merge + filter + sort ----------
  const items = useMemo<Item[]>(() => {
    const callItems: Item[] = (calls ?? []).map((c) => {
      const phone = c.direction === "inbound" ? c.phone_from_e164 : c.phone_to_e164;
      return { kind: "call", ts: c.started_at, phone, contact_id: c.contact_id, call: c };
    });
    const smsItems: Item[] = (smses ?? []).map((s) => ({
      kind: "sms",
      ts: s.created_at,
      phone: s.phone_e164,
      contact_id: s.contact_id,
      sms: s,
    }));

    let merged: Item[] = [...callItems, ...smsItems];

    if (tab === "calls") merged = merged.filter((i) => i.kind === "call");
    else if (tab === "sms") merged = merged.filter((i) => i.kind === "sms");
    else if (tab === "missed")
      merged = merged.filter(
        (i) =>
          i.kind === "call" &&
          ["no_answer", "busy", "cancelled"].includes(i.call.status)
      );
    else if (tab === "unresolved")
      merged = merged.filter((i) => i.kind === "call" && i.call.link_status === "unresolved");
    else if (tab === "today") {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      merged = merged.filter((i) => i.ts && new Date(i.ts) >= since);
    }

    const term = search.trim().toLowerCase();
    if (term) {
      merged = merged.filter((i) => {
        const cname = contactName(i.contact_id)?.toLowerCase() ?? "";
        if (cname.includes(term)) return true;
        if (i.phone?.toLowerCase().includes(term)) return true;
        if (i.kind === "call") {
          return (
            i.call.public_id?.toLowerCase().includes(term) ||
            i.call.summary?.toLowerCase().includes(term) ||
            i.call.transcript?.toLowerCase().includes(term)
          );
        }
        return (
          i.sms.text?.toLowerCase().includes(term) ||
          i.sms.sender?.toLowerCase().includes(term)
        );
      });
    }

    merged.sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return sortDir === "desc" ? tb - ta : ta - tb;
    });
    return merged;
  }, [calls, smses, tab, search, sortDir, contactsMap]);

  const unresolvedCount = useMemo(
    () => (calls ?? []).filter((c) => c.link_status === "unresolved").length,
    [calls]
  );

  // ---------- Actions ----------
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
      queryClient.invalidateQueries({ queryKey: ["admin-calls-journal", "calls"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка расшифровки";
      toast.error(msg);
    } finally {
      setProcessingId(null);
    }
  }

  // Candidates for bulk transcribe = calls with recording and no transcript yet
  const bulkCandidates = useMemo(() => {
    return (calls ?? []).filter(
      (c) => c.recording_url && !c.transcript && c.transcript_status !== "processing"
    );
  }, [calls]);

  function toggleSelect(callId: string) {
    setSelectedCallIds((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) next.delete(callId);
      else next.add(callId);
      return next;
    });
  }

  function selectAllCandidates() {
    setSelectedCallIds(new Set(bulkCandidates.map((c) => c.id)));
  }

  function clearSelection() {
    setSelectedCallIds(new Set());
  }

  async function runBulkTranscribe() {
    if (selectedCallIds.size === 0) return;
    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    for (const id of Array.from(selectedCallIds)) {
      try {
        const { data, error } = await supabase.functions.invoke("call-transcribe-summarize", {
          body: { call_id: id },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        ok++;
      } catch (e) {
        fail++;
        // eslint-disable-next-line no-console
        console.error("bulk transcribe failed for", id, e);
      }
    }
    setBulkRunning(false);
    clearSelection();
    queryClient.invalidateQueries({ queryKey: ["admin-calls-journal", "calls"] });
    if (fail === 0) toast.success(`Расшифровано: ${ok}`);
    else toast.warning(`Готово: ${ok}, ошибок: ${fail}`);
  }

  function exportCsv() {
    const header = [
      "Тип",
      "Дата",
      "Контакт",
      "Телефон",
      "Направление",
      "Статус",
      "Длительность",
      "Текст / Сводка",
      "ID",
    ];
    const out: string[][] = [header];
    items.forEach((it) => {
      const ts = it.ts ? format(new Date(it.ts), "yyyy-MM-dd HH:mm:ss") : "";
      const cname = contactName(it.contact_id) ?? "";
      if (it.kind === "call") {
        out.push([
          "Звонок",
          ts,
          cname,
          it.phone ?? "",
          it.call.direction,
          CALL_STATUS_LABEL[it.call.status] ?? it.call.status,
          formatDuration(it.call.duration_seconds),
          it.call.summary ?? "",
          it.call.public_id ?? it.call.id,
        ]);
      } else {
        out.push([
          "SMS",
          ts,
          cname,
          it.phone ?? "",
          "outbound",
          SMS_STATUS_LABEL[it.sms.status] ?? it.sms.status,
          "",
          it.sms.text ?? "",
          it.sms.id,
        ]);
      }
    });
    downloadCsv(`calls-sms-${format(new Date(), "yyyyMMdd-HHmm")}.csv`, out);
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
      queryClient.invalidateQueries({ queryKey: ["admin-calls-journal", "calls"] });
      queryClient.invalidateQueries({ queryKey: ["calls-history"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось привязать звонок");
    } finally {
      setBindingCallId(null);
    }
  }

  async function openContactSheet(profileId: string) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .single();
      if (error) throw error;
      setSelectedContact(data);
      setContactSheetOpen(true);
    } catch (e) {
      console.error("Failed to load contact:", e);
      toast.error("Не удалось загрузить контакт");
    }
  }

  // ---------- Render ----------
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
            <Phone className="h-3.5 w-3.5" /> Журнал коммуникаций
          </div>
          <h1 className="text-3xl font-semibold mt-2">Звонки и SMS</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Единая лента: звонки сотрудников и отправленные SMS. Слушайте записи,
            делайте AI-расшифровку (в т.ч. массово), выгружайте выборку в CSV.
          </p>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="all">Все</TabsTrigger>
            <TabsTrigger value="calls">Звонки</TabsTrigger>
            <TabsTrigger value="sms">SMS</TabsTrigger>
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

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя, телефон, текст…"
              className="pl-8 h-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            title={sortDir === "desc" ? "Сначала новые" : "Сначала старые"}
          >
            {sortDir === "desc" ? (
              <ArrowDownNarrowWide className="h-4 w-4 mr-1" />
            ) : (
              <ArrowUpNarrowWide className="h-4 w-4 mr-1" />
            )}
            {sortDir === "desc" ? "Новые" : "Старые"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={exportCsv}
            disabled={items.length === 0}
          >
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {/* Bulk bar */}
      {(tab === "all" || tab === "calls" || tab === "today" || tab === "missed" || tab === "unresolved") && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Выбрано звонков: <b>{selectedCallIds.size}</b> / можно расшифровать: {bulkCandidates.length}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7"
            onClick={selectAllCandidates}
            disabled={bulkCandidates.length === 0}
          >
            Выбрать все доступные
          </Button>
          {selectedCallIds.size > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={clearSelection}
            >
              Снять выделение
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7"
            onClick={runBulkTranscribe}
            disabled={selectedCallIds.size === 0 || bulkRunning}
          >
            {bulkRunning ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1" />
            )}
            Расшифровать выбранные
          </Button>
        </div>
      )}

      {/* List */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              {search ? "Ничего не найдено" : "Пока пусто"}
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((it) =>
                it.kind === "call"
                  ? renderCall(it.call)
                  : renderSms(it.sms)
              )}
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

      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={(open) => {
          setContactSheetOpen(open);
          if (!open) setSelectedContact(null);
        }}
      />
    </div>
  );

  // ---------- Row renderers ----------
  function renderCall(call: CallRow) {
    const phone = call.direction === "inbound" ? call.phone_from_e164 : call.phone_to_e164;
    const counterPhone = call.direction === "inbound" ? call.phone_to_e164 : call.phone_from_e164;
    const isOpen = expanded[call.id];
    const hasResult = Boolean(call.transcript || call.summary);
    const isProcessing = processingId === call.id || call.transcript_status === "processing";
    const isUnresolved = call.link_status === "unresolved";
    const binding = bindingCallId === call.id;
    const cname = contactName(call.contact_id);
    const canSelect = Boolean(call.recording_url && !call.transcript && call.transcript_status !== "processing");
    const checked = selectedCallIds.has(call.id);

    return (
      <div
        key={`call-${call.id}`}
        className="rounded-lg border bg-card hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3 px-3 py-2 flex-wrap sm:flex-nowrap">
          <div className="shrink-0 flex items-center gap-2">
            {canSelect ? (
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggleSelect(call.id)}
                aria-label="Выбрать звонок"
              />
            ) : (
              <div className="w-4" />
            )}
            <DirectionIcon direction={call.direction} status={call.status} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {call.contact_id && cname ? (
                <button
                  type="button"
                  onClick={() => openContactSheet(call.contact_id!)}
                  className="text-sm font-semibold text-foreground hover:underline truncate max-w-[260px]"
                  title={cname}
                >
                  {cname}
                </button>
              ) : (
                <span className="text-sm font-semibold">{phone ?? "—"}</span>
              )}
              {call.contact_id && cname && phone && (
                <span className="text-xs text-muted-foreground font-mono">{phone}</span>
              )}
              <Badge
                variant={CALL_STATUS_VARIANT[call.status] ?? "outline"}
                className="text-[10px] py-0 h-5"
              >
                {CALL_STATUS_LABEL[call.status] ?? call.status}
              </Badge>
              {isUnresolved && (
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  Без привязки
                </Badge>
              )}
              {call.public_id && (
                <span className="font-mono text-[10px] text-muted-foreground">{call.public_id}</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
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
            {call.recording_url &&
              (hasResult ? (
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
              ))}
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
  }

  function renderSms(sms: SmsRow) {
    const cname = contactName(sms.contact_id);
    return (
      <div
        key={`sms-${sms.id}`}
        className="rounded-lg border bg-card hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start gap-3 px-3 py-2">
          <div className="shrink-0 flex items-center gap-2 pt-0.5">
            <div className="w-4" />
            <MessageSquare className="h-4 w-4 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {sms.contact_id && cname ? (
                <button
                  type="button"
                  onClick={() => openContactSheet(sms.contact_id!)}
                  className="text-sm font-semibold text-foreground hover:underline truncate max-w-[260px]"
                  title={cname}
                >
                  {cname}
                </button>
              ) : (
                <span className="text-sm font-semibold">{sms.phone_e164 ?? "—"}</span>
              )}
              {sms.contact_id && cname && sms.phone_e164 && (
                <span className="text-xs text-muted-foreground font-mono">{sms.phone_e164}</span>
              )}
              <Badge variant="outline" className="text-[10px] py-0 h-5">
                SMS
              </Badge>
              <Badge
                variant={SMS_STATUS_VARIANT[sms.status] ?? "outline"}
                className="text-[10px] py-0 h-5"
              >
                <span className="inline-flex items-center gap-1">
                  <SmsStatusIcon status={sms.status} />
                  {SMS_STATUS_LABEL[sms.status] ?? sms.status}
                </span>
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
            {sms.error && <p className="text-xs text-destructive mt-1">{sms.error}</p>}
          </div>
        </div>
      </div>
    );
  }
}
