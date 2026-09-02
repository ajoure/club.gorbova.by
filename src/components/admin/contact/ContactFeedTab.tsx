// ============================================================================
// ContactFeedTab v2 — Единая лента событий контакта (amoCRM-style)
// ----------------------------------------------------------------------------
// - Данные: calls, sms, telegram, email, tasks, notes, files, voice_notes,
//   deals (orders_v2), events (crm_activity_log, human-labeled).
// - Плеер звонков встроен прямо в карточку (CallRecordingPlayer + AI-сводка).
// - Композер (Telegram-style) закреплён внизу вкладки: текст, эмодзи,
//   файл, голосовое сообщение.
// - Файлы: text/csv/md — модалка с UTF-8; PDF — PdfViewer; images — lightbox;
//   остальное — direct download.
// ============================================================================
import { useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Phone, MessageCircle, Mail, Send, ClipboardList, StickyNote,
  Paperclip, Search, Trash2, Download, Plus, Activity, Handshake,
  Smile, Mic, Square, Sparkles, Play, Pause, X, AlertTriangle, RefreshCw,
  Instagram, LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSalesManagerAuditDetails, localizeAuditAction, localizeEntityType, localizeReasonCode, localizeCrmStatus } from "@/lib/crmDisplayLabels";

/** Русская подпись для «technical» event-title типа `company.created` / `company.linked_to_contact`. */
function humanizeEventTitle(title: string | null | undefined): string {
  const raw = (title ?? "").trim();
  if (!raw) return "Системное событие";
  // Если это dotted/snake_case-код — прогнать через локализацию action-словаря.
  if (/^[a-z0-9_.-]+$/i.test(raw) && /[._-]/.test(raw)) return localizeAuditAction(raw);
  return raw;
}

/** Убрать HTML-теги, оставив читаемый текст. Не рендерим сырые `<b>` пользователю. */
function stripHtmlTags(input: string | null | undefined): string {
  const raw = (input ?? "").toString();
  if (!raw) return "";
  if (typeof document === "undefined") return raw.replace(/<[^>]+>/g, "");
  const div = document.createElement("div");
  div.innerHTML = raw;
  return (div.textContent || div.innerText || "").trim();
}
import { CreateCrmTaskDialog } from "@/components/admin/tasks/CreateCrmTaskDialog";
import { CallRecordingPlayer } from "@/components/admin/calls/CallRecordingPlayer";
import { MediaLightbox } from "@/components/admin/chat/MediaLightbox";
import { PdfViewer } from "@/components/admin/chat/PdfViewer";
import { normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";

type FeedKind =
  | "call" | "sms" | "email" | "telegram" | "task" | "note"
  | "file" | "voice_note" | "deal" | "event"
  | "instagram" | "support";

interface FeedEvent {
  id: string;
  kind: FeedKind;
  at: string | null;
  title: string | null;
  body: string | null;
  meta: Record<string, any> | null;
  author: string | null;
}

async function enrichFeedDealContext(events: FeedEvent[]): Promise<FeedEvent[]> {
  const noteIds = events.filter((event) => event.kind === "note").map((event) => event.id);
  const fileIds = events.filter((event) => event.kind === "file" || event.kind === "voice_note").map((event) => event.id);
  const links = new Map<string, string>();
  if (noteIds.length) {
    const { data } = await (supabase as any).from("contact_notes").select("id,deal_id").in("id", noteIds).not("deal_id", "is", null);
    (data ?? []).forEach((row: any) => links.set(`note:${row.id}`, row.deal_id));
  }
  if (fileIds.length) {
    const { data } = await (supabase as any).from("contact_files").select("id,deal_id").in("id", fileIds).not("deal_id", "is", null);
    (data ?? []).forEach((row: any) => {
      links.set(`file:${row.id}`, row.deal_id);
      links.set(`voice_note:${row.id}`, row.deal_id);
    });
  }
  const dealIds = Array.from(new Set(links.values()));
  if (!dealIds.length) return events;
  const { data: deals } = await supabase.from("orders_v2").select("id,order_number").in("id", dealIds);
  const names = new Map((deals ?? []).map((deal) => [deal.id, deal.order_number]));
  return events.map((event) => {
    const dealId = links.get(`${event.kind}:${event.id}`);
    if (!dealId) return event;
    const number = names.get(dealId);
    return {
      ...event,
      title: `${event.kind === "note" ? "Заметка" : event.title ?? "Файл"} по сделке ${number ? `#${number}` : ""}`.trim(),
      meta: { ...(event.meta ?? {}), deal_id: dealId, order_number: number ?? null },
    };
  });
}

// Каждый тип события — уникальный «дорогой» оттенок; никаких коллизий цвета
// между двумя разными типами (например, file/deal больше не оба зелёные).
const KIND_META: Record<FeedKind, { label: string; icon: any; tint: string; iconColor: string; }> = {
  call:       { label: "Звонок",   icon: Phone,         tint: "bg-blue-500/10 border-blue-500/20",       iconColor: "text-blue-600 bg-blue-500/15" },
  sms:        { label: "SMS",      icon: MessageCircle, tint: "bg-green-500/10 border-green-500/20",     iconColor: "text-green-600 bg-green-500/15" },
  email:      { label: "Письмо",   icon: Mail,          tint: "bg-violet-500/10 border-violet-500/20",   iconColor: "text-violet-600 bg-violet-500/15" },
  telegram:   { label: "Telegram", icon: Send,          tint: "bg-sky-500/10 border-sky-500/20",         iconColor: "text-sky-600 bg-sky-500/15" },
  instagram:  { label: "Instagram",icon: Instagram,     tint: "bg-pink-500/10 border-pink-500/20",       iconColor: "text-pink-600 bg-pink-500/15" },
  support:    { label: "Техподдержка", icon: LifeBuoy,  tint: "bg-teal-500/10 border-teal-500/20",       iconColor: "text-teal-600 bg-teal-500/15" },
  task:       { label: "Задача",   icon: ClipboardList, tint: "bg-amber-500/10 border-amber-500/20",     iconColor: "text-amber-600 bg-amber-500/15" },
  note:       { label: "Заметка",  icon: StickyNote,    tint: "bg-rose-400/10 border-rose-400/20",       iconColor: "text-rose-600 bg-rose-400/15" },
  file:       { label: "Файл",     icon: Paperclip,     tint: "bg-orange-500/10 border-orange-500/20",   iconColor: "text-orange-600 bg-orange-500/15" },
  voice_note: { label: "Голосовое",icon: Mic,           tint: "bg-fuchsia-500/10 border-fuchsia-500/25", iconColor: "text-fuchsia-600 bg-fuchsia-500/15" },
  deal:       { label: "Сделка",   icon: Handshake,     tint: "bg-emerald-500/10 border-emerald-500/20", iconColor: "text-emerald-600 bg-emerald-500/15" },
  event:      { label: "Событие",  icon: Activity,      tint: "bg-indigo-500/10 border-indigo-500/20",   iconColor: "text-indigo-600 bg-indigo-500/15" },
};

const ALL_TYPES: FeedKind[] = ["call", "sms", "email", "telegram", "instagram", "support", "task", "note", "file", "voice_note", "deal", "event"];

const EMOJIS = ["😀","😁","😂","🤣","😊","😍","🥰","😎","🤔","👍","👌","🙏","🔥","❤️","💯","🎉","✅","❌","⚠️","💡","📌","🚀","💪","👏","🤝","😅","😢","😡","🙌","✨"];

function formatBytes(n?: number) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

function guessFileKind(mime?: string | null, name?: string | null): "image" | "pdf" | "text" | "audio" | "video" | "other" {
  const m = (mime || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n)) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.startsWith("audio/") || /\.(mp3|wav|ogg|webm|m4a)$/.test(n)) return "audio";
  if (m.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/.test(n)) return "video";
  if (m.startsWith("text/") || /\.(txt|csv|md|json|log)$/.test(n)) return "text";
  return "other";
}

// ---------------------- Sub-components ---------------------------------------

function CallCard({ evt, entityId }: { evt: FeedEvent; entityId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const duration = Number(evt.meta?.duration || 0);
  const recording = evt.meta?.recording_url as string | undefined;
  const transcript = evt.meta?.transcript as string | undefined;
  const summary = (evt.meta?.summary as string | undefined) || evt.body || undefined;
  const canSummarize = duration >= 5 && !!recording && !summary;

  async function runSummary() {
    try {
      setBusy(true);
      const { data, error } = await supabase.functions.invoke("call-transcribe-summarize", {
        body: { call_id: evt.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Расшифровка готова");
      qc.invalidateQueries({ queryKey: ["contact_feed", entityId] });
    } catch (e: any) {
      toast.error(e?.message || "Ошибка расшифровки");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {evt.meta?.phone && <span className="text-sm font-medium">{evt.meta.phone}</span>}
        {duration > 0 && <Badge variant="outline" className="text-[10px]">{duration}с</Badge>}
        {evt.meta?.status && <Badge variant="outline" className="text-[10px]">{localizeCrmStatus(String(evt.meta.status))}</Badge>}
      </div>
      {recording && (
        <CallRecordingPlayer src={recording} fallbackDurationSec={duration || null} fileName={`call-${evt.meta?.public_id || evt.id}.mp3`} />
      )}
      {summary && (
        <div className="rounded-lg bg-background/60 border border-border/40 p-2 text-xs whitespace-pre-wrap">
          <div className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Сводка</div>
          {summary}
        </div>
      )}
      {transcript && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Расшифровка</summary>
          <div className="mt-1 whitespace-pre-wrap opacity-80">{transcript}</div>
        </details>
      )}
      {canSummarize && (
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={runSummary}>
          <Sparkles className="w-3 h-3 mr-1" /> {busy ? "Расшифровка…" : "AI-сводка"}
        </Button>
      )}
    </div>
  );
}

/**
 * Принудительное скачивание: fetch → blob → object URL.
 * Атрибут `download` игнорируется браузером на cross-origin ответах Storage
 * (open in tab вместо save), поэтому качаем через blob.
 */
async function forceDownload(url: string, name: string) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`http_${resp.status}`);
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (e: any) {
    toast.error(e?.message || "Ошибка скачивания");
  }
}

/**
 * VoiceNoteBubble — карточка голосового с плеером как у звонков,
 * AI-расшифровкой (авто-запуск при отсутствии), сводкой, кнопкой отправки
 * в support-Telegram. Никакого нативного <audio controls> с серым меню.
 */
function VoiceNoteBubble({ evt, entityId }: { evt: FeedEvent; entityId: string }) {
  const qc = useQueryClient();
  const path = evt.meta?.storage_path as string | undefined;
  const name = (evt.title || evt.meta?.name || `voice_${evt.id}.webm`) as string;
  const [url, setUrl] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [localAiResult, setLocalAiResult] = useState<{
    transcript?: string;
    summary?: string;
    status?: string;
    reason?: string;
  } | null>(null);

  const transcript = (localAiResult?.transcript || evt.meta?.transcript) as string | undefined;
  const summary = (localAiResult?.summary || evt.meta?.summary) as string | undefined;
  const status = (localAiResult?.status || evt.meta?.transcribe_status) as string | undefined;
  const reason = (localAiResult?.reason || evt.meta?.transcribe_reason) as string | undefined;
  const sizeBytes = Number(evt.meta?.size_bytes || 0);
  const canTranscribe = !!path && !transcript && !summary
    && status !== "processing" && status !== "skipped_too_short" && sizeBytes >= 4096;

  useEffect(() => {
    if (!path) return;
    supabase.storage.from("contact-files").createSignedUrl(path, 60 * 60).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [path]);

  useEffect(() => {
    setLocalAiResult(null);
  }, [evt.id, evt.meta?.transcript, evt.meta?.summary, evt.meta?.transcribe_status]);

  async function runTranscribe() {
    if (!evt.id) return;
    try {
      setAiBusy(true);
      const { data, error } = await supabase.functions.invoke("voice-note-transcribe-summarize", {
        body: { file_id: evt.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.skipped) {
        setLocalAiResult({ status: "skipped_too_short", reason: data?.reason || "too_short" });
        toast.info("Голосовое слишком короткое для расшифровки");
      } else {
        setLocalAiResult({
          transcript: data?.transcript || transcript,
          summary: data?.summary || summary,
          status: data?.status || "done",
        });
        setShowTranscript(true);
        toast.success(data?.cached ? "Расшифровка уже готова" : "Расшифровка готова");
      }
      qc.invalidateQueries({ queryKey: ["contact_feed", entityId] });
    } catch (e: any) {
      toast.error(await normalizeEdgeFunctionErrorAsync(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function sendToSupport() {
    try {
      setTgBusy(true);
      const { data, error } = await supabase.functions.invoke("voice-note-forward-to-support", {
        body: { file_id: evt.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const sent = Number(data?.sent || 0);
      if (sent > 0) toast.success(`Отправлено в Telegram (${sent})`);
      else toast.warning("Никто из support-админов не привязал Telegram");
    } catch (e: any) {
      toast.error(await normalizeEdgeFunctionErrorAsync(e));
    } finally {
      setTgBusy(false);
    }
  }

  if (!url) return <div className="text-xs text-muted-foreground">Загрузка аудио…</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Плеер — тот же кастомный, что и в звонках, тонированный под голосовые */}
        <CallRecordingPlayer
          src={url}
          fileName={name}
          className="min-w-0 flex-1 !bg-fuchsia-500/10 !border-fuchsia-500/25"
        />

        <TooltipProvider delayDuration={150}>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-fuchsia-500/15 bg-background/70 p-1 shadow-sm backdrop-blur">
            {canTranscribe && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-full text-fuchsia-700 hover:bg-fuchsia-500/15 hover:text-fuchsia-800"
                    disabled={aiBusy}
                    onClick={runTranscribe}
                    aria-label="Сделать AI-сводку голосового"
                  >
                    <Sparkles className={cn("h-3.5 w-3.5", aiBusy && "animate-pulse")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Расшифровать голосовое и сделать AI-сводку</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-full text-sky-700 hover:bg-sky-500/15 hover:text-sky-800"
                  disabled={tgBusy}
                  onClick={sendToSupport}
                  aria-label="Отправить голосовое в Telegram support"
                >
                  <Send className={cn("h-3.5 w-3.5", tgBusy && "animate-pulse")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Отправить голосовое в Telegram support</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {/* Статусные состояния AI */}
      {status === "processing" && (
        <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3 animate-pulse" /> Расшифровка…
        </div>
      )}
      {status === "skipped_too_short" && (
        <div className="text-[11px] text-muted-foreground">Слишком короткое сообщение для AI</div>
      )}
      {status === "failed" && reason && (
        <div className="text-[11px] text-destructive/80">AI: {reason}</div>
      )}

      {summary && (
        <div className="rounded-lg bg-background/60 border border-fuchsia-500/20 p-2 text-xs whitespace-pre-wrap">
          <div className="font-semibold text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Сводка</div>
          {summary}
        </div>
      )}
      {transcript && (
        <details className="text-xs" open={showTranscript} onToggle={(e) => setShowTranscript((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Расшифровка</summary>
          <div className="mt-1 whitespace-pre-wrap opacity-80">{transcript}</div>
        </details>
      )}
    </div>
  );
}

function TextFilePreview({
  open, onClose, path, name,
}: { open: boolean; onClose: () => void; path: string; name: string }) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase.storage.from("contact-files").createSignedUrl(path, 60 * 10);
        if (!data?.signedUrl) throw new Error("no url");
        const resp = await fetch(data.signedUrl);
        const buf = await resp.arrayBuffer();
        setText(new TextDecoder("utf-8").decode(buf));
      } catch (e: any) {
        toast.error(e?.message || "Не удалось открыть файл");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, path]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader><DialogTitle className="text-sm truncate">{name}</DialogTitle></DialogHeader>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <pre className="text-xs whitespace-pre-wrap break-words font-mono overflow-auto flex-1 bg-muted/30 p-3 rounded">{text}</pre>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PdfDialog({ open, onClose, url, name }: { open: boolean; onClose: () => void; url: string; name: string }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-3 border-b"><DialogTitle className="text-sm truncate">{name}</DialogTitle></DialogHeader>
        <div className="h-[80vh]"><PdfViewer url={url} fileName={name} /></div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------- Voice Recorder ---------------------------------------

function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "audio/webm" });
        setBlob(b);
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed(v => v + 1), 1000);
    } catch (e: any) {
      toast.error("Нет доступа к микрофону");
    }
  };

  const stop = () => {
    mediaRef.current?.stop();
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const reset = () => { setBlob(null); setElapsed(0); };

  return { recording, blob, elapsed, start, stop, reset };
}


async function loadPlatformEventsForContact(
  contactId: string,
  types: FeedKind[] | null,
  search: string | null,
  rpcDealIds: string[] = [],
): Promise<FeedEvent[]> {
  if (types && !types.includes("event") && !types.includes("deal")) return [];
  const q = (search || "").trim().toLowerCase();
  const match = (...parts: any[]) => !q || parts.some((v) => String(v ?? "").toLowerCase().includes(q));
  const events: FeedEvent[] = [];

  const { data: contact } = await supabase.from("profiles").select("id,user_id,email,phone,full_name").eq("id", contactId).maybeSingle();
  const userId = (contact as any)?.user_id as string | undefined;
  const email = ((contact as any)?.email || "").toLowerCase();
  const phoneDigits = String((contact as any)?.phone || "").replace(/\D/g, "");

  const orderSelect = "id,order_number,status,final_price,currency,created_at,updated_at,deal_date,customer_email,product:products_v2(name),tariff:tariffs(name)";
  const orderQuery = () => supabase
    .from("orders_v2")
    .select(orderSelect)
    .order("created_at", { ascending: false })
    .limit(80);

  // Do not combine profile/user/email/phone filters in one PostgREST `.or(...)`.
  // A legacy value containing reserved filter syntax can invalidate that entire
  // request and silently remove the order ids needed for deal audit events.
  // Keep the canonical profile lookup authoritative and run legacy fallbacks
  // independently, then merge the results deterministically.
  const orderResults = await Promise.all([
    orderQuery().eq("profile_id", contactId),
    ...(userId ? [orderQuery().eq("user_id", userId)] : []),
    ...(email ? [orderQuery().ilike("customer_email", email)] : []),
    ...(phoneDigits ? [orderQuery().ilike("customer_phone", `%${phoneDigits}%`)] : []),
  ]);
  if (orderResults[0]?.error) throw orderResults[0].error;

  const orderRows = Array.from(new Map(orderResults
    .flatMap((result) => result.error ? [] : result.data || [])
    .map((order) => [order.id, order] as const)).values())
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 80) as any[];
  // The canonical feed RPC already resolved deals through the contact's user_id.
  // Reuse those ids as a second authoritative source so audit events remain
  // available even when a legacy order cannot be rediscovered by profile/email/phone.
  const orderIds = Array.from(new Set([
    ...rpcDealIds,
    ...orderRows.map((o) => o.id).filter(Boolean),
  ])).slice(0, 80);

  if (!types || types.includes("deal")) {
    for (const o of orderRows) {
      const productName = o.product?.name;
      const tariffName = o.tariff?.name;
      const title = `Сделка ${o.order_number || String(o.id).slice(0, 8)}`;
      const body = [
        o.status === "paid" ? "Оплачено" : o.status === "pending" ? "Ожидает оплаты" : o.status === "refunded" ? "Возврат" : o.status === "canceled" ? "Отменена" : `Статус: ${o.status}`,
        productName ? `Продукт: ${productName}` : null,
        tariffName ? `Тариф: ${tariffName}` : null,
        o.final_price != null ? `Сумма: ${o.final_price} ${o.currency || ""}` : null,
      ].filter(Boolean).join("\n");
      if (match(title, body)) events.push({ id: `deal-${o.id}`, kind: "deal", at: o.deal_date || o.updated_at || o.created_at, title, body, author: "Система", meta: { status: o.status, order_number: o.order_number, final_price: o.final_price, currency: o.currency, product_name: productName, tariff_name: tariffName } });
    }
  }

  if (!types || types.includes("event")) {
    let payQuery = supabase
      .from("payments_v2")
      .select("id,order_id,amount,currency,status,provider,provider_payment_id,transaction_type,product_name_raw,error_message,paid_at,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(120);
    const paymentOr = [`profile_id.eq.${contactId}`];
    if (userId) paymentOr.push(`user_id.eq.${userId}`);
    for (const oid of orderIds.slice(0, 40)) paymentOr.push(`order_id.eq.${oid}`);
    payQuery = payQuery.or(paymentOr.join(","));
    const { data: payments } = await payQuery;
    for (const p of ((payments || []) as any[])) {
      const title = p.status === "succeeded" ? "Платёж прошёл" : p.status === "refunded" ? "Платёж возвращён" : p.status === "failed" ? "Платёж не прошёл" : `Платёж: ${p.status}`;
      const body = [`Сумма: ${p.amount ?? 0} ${p.currency || ""}`, p.product_name_raw ? `Продукт: ${p.product_name_raw}` : null, p.provider ? `Провайдер: ${p.provider}` : null, p.error_message ? `Ошибка: ${p.error_message}` : null].filter(Boolean).join("\n");
      if (match(title, body, p.provider_payment_id)) events.push({ id: `payment-${p.id}`, kind: "event", at: p.paid_at || p.updated_at || p.created_at, title, body, author: "Система", meta: { event_source: "payment", status: p.status, amount: p.amount, currency: p.currency, provider: p.provider } });
    }

    const auditSelect = "id,actor_user_id,action,target_user_id,meta,created_at,actor_type,actor_label,entity_type,entity_id";
    const auditEntityIds = [contactId, ...orderIds.slice(0, 20)];
    const entityAuditPromise = supabase
      .from("audit_logs")
      .select(auditSelect)
      .in("entity_id", auditEntityIds)
      .order("created_at", { ascending: false })
      .limit(160);
    const entityAuditResult = await entityAuditPromise;

    // Some production PostgREST paths return no rows for a mixed contact/deal
    // `in(...)` filter even though the same deal audit is readable with an
    // exact entity lookup (the deal history uses that canonical path). Keep
    // the efficient batch query, then retry each loaded deal through the same
    // exact query as DealDetailSheet. The feed is an on-demand admin view; the
    // extra reads are preferable to silently hiding audit. Exact deal ids also
    // preserve the contact boundary: actor/target ids are deliberately never
    // used as ownership filters.
    const managerAuditActions = [
      "deal.sales_manager_changed",
      "deal_sales_manager_assigned_on_create",
    ];
    const batchAudits = entityAuditResult.error ? [] : entityAuditResult.data || [];
    const hasManagerAudit = batchAudits.some((audit) =>
      managerAuditActions.includes(String(audit.action || "")),
    );
    const exactDealAuditResults = !hasManagerAudit && orderIds.length
      ? await Promise.all(orderIds.map((orderId) => supabase
          .from("audit_logs")
          .select(auditSelect)
          .eq("entity_id", orderId)
          .order("created_at", { ascending: false })
          .limit(20)))
      : [];

    // Actor and target identify who performed/received an action, not which
    // contact owns it. Restrict the feed to this contact and its deals so a
    // staff contact cannot see unrelated customer events merely because that
    // staff member was the actor or assigned manager.
    const audits = Array.from(new Map([
      ...batchAudits,
      ...exactDealAuditResults.flatMap((result) => result.error ? [] : result.data || []),
    ].map((audit) => [audit.id, audit] as const)).values())
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
      .slice(0, 160);
    const actorIds = Array.from(new Set(((audits || []) as any[]).map((audit) => audit.actor_user_id).filter(Boolean)));
    const actorNames = new Map<string, string>();
    if (actorIds.length) {
      const { data: actorProfiles } = await supabase
        .from("profiles")
        .select("user_id,full_name")
        .in("user_id", actorIds);
      ((actorProfiles || []) as any[]).forEach((actor) => {
        if (actor.user_id && actor.full_name) actorNames.set(actor.user_id, actor.full_name);
      });
    }
    for (const a of ((audits || []) as any[])) {
      const action = String(a.action || "");
      const title = localizeAuditAction(action);
      const entityLabel = localizeEntityType(a.entity_type);
      const metaObj = (a.meta && typeof a.meta === "object") ? a.meta as Record<string, any> : {};
      const managerAuditDetails = formatSalesManagerAuditDetails(action, metaObj);
      const reasonLabel = !managerAuditDetails && metaObj.reason ? localizeReasonCode(String(metaObj.reason)) : "";
      const bodyLines: string[] = [];
      if (entityLabel) bodyLines.push(`Объект: ${entityLabel}`);
      if (managerAuditDetails) {
        bodyLines.push(...managerAuditDetails);
      } else {
        if (reasonLabel) bodyLines.push(`Причина: ${reasonLabel}`);
        if (metaObj.pipeline_name) bodyLines.push(`Воронка: ${metaObj.pipeline_name}`);
        if (metaObj.to_stage_name) bodyLines.push(`Новая стадия: ${metaObj.to_stage_name}`);
        else if (metaObj.target_stage_name) bodyLines.push(`Целевая стадия: ${metaObj.target_stage_name}`);
      }
      const body = bodyLines.join("\n");
      const actorName = a.actor_label || actorNames.get(a.actor_user_id) || (a.actor_type === "system" ? "Система" : "Сотрудник");
      if (match(title, body, actorName, JSON.stringify(a.meta || {}))) events.push({ id: `audit-${a.id}`, kind: "event", at: a.created_at, title, body, author: actorName, meta: { event_source: "audit", action: a.action, entity_type: a.entity_type, entity_id: a.entity_id, raw_meta: a.meta } });
    }
  }

  // Post-payment уведомления (email/telegram) по заказам этого контакта.
  if (orderIds.length && (!types || types.includes("email") || types.includes("telegram"))) {
    const { data: notifs } = await supabase
      .from("order_notification_deliveries")
      .select("id,order_id,channel,notification_type,status,recipient,provider_message_id,sent_at,created_at,error,metadata")
      .in("order_id", orderIds.slice(0, 80))
      .order("created_at", { ascending: false })
      .limit(200);
    for (const n of ((notifs || []) as any[])) {
      const channel = String(n.channel || "").toLowerCase();
      const kind: FeedKind = channel === "telegram" ? "telegram" : "email";
      if (types && !types.includes(kind)) continue;
      const chanLabel = kind === "telegram" ? "Telegram" : "Email";
      const status = String(n.status || "");
      const statusWord =
        status === "sent" ? "отправлен" :
        status === "failed" ? "не отправлен" :
        status === "skipped" ? "пропущен" :
        status === "pending" ? "в очереди" :
        `статус: ${status}`;
      const md = (n.metadata || {}) as Record<string, any>;
      const subject: string | null = md.subject || null;
      const preview: string | null = md.preview_text || null;
      const messageText: string | null = md.message_text || null;
      // Short preview: telegram → first ~280 chars of message; email → subject + preview
      const shortBody = (() => {
        if (kind === "telegram") {
          const t = (messageText || "").replace(/<[^>]+>/g, "").trim();
          return t ? (t.length > 320 ? `${t.slice(0, 320)}…` : t) : null;
        }
        const fullEmailText = (messageText || "").replace(/<[^>]+>/g, "").trim();
        const parts = [
          subject ? `Тема: ${subject}` : null,
          preview ? `Preview: ${preview}` : null,
          fullEmailText || null,
        ];
        return parts.filter(Boolean).join("\n") || null;
      })();
      const title = subject && kind === "email"
        ? `${chanLabel} ${statusWord}: ${subject}`
        : `${chanLabel} ${statusWord}`;
      const body = [
        shortBody,
        md.product_name ? `Продукт: ${md.product_name}${md.tariff_name ? ` · ${md.tariff_name}` : ""}` : null,
        md.skip_reason ? `Причина пропуска: ${md.skip_reason}` : null,
        n.recipient ? `Получатель: ${n.recipient}` : null,
        n.provider_message_id ? `ID сообщения: ${n.provider_message_id}` : null,
        n.error ? `Ошибка: ${n.error}` : null,
      ].filter(Boolean).join("\n");
      if (!match(title, body, n.recipient, n.notification_type, messageText, subject)) continue;
      events.push({
        id: `notification:${n.id}`,
        kind,
        at: n.sent_at || n.created_at,
        title,
        body,
        author: "Система",
        meta: {
          event_source: "order_notification",
          order_id: n.order_id,
          status,
          channel,
          notification_type: n.notification_type,
          provider_message_id: n.provider_message_id,
          subject,
          message_text: messageText,
          rendered_html: md.rendered_html || null,
          template_code: md.template_code || null,
          product_name: md.product_name || null,
          tariff_name: md.tariff_name || null,
          is_error: status === "failed" || Boolean(n.error),
        },
      });
    }

  }

  // Выдача доступа по заказам (access_grant_ledger).
  if (orderIds.length && (!types || types.includes("event"))) {
    const { data: grants } = await supabase
      .from("access_grant_ledger")
      .select("id,order_id,action_type,status,reason_code,target_type,target_key,target_ref,result,error_details,created_at")
      .in("order_id", orderIds.slice(0, 80))
      .order("created_at", { ascending: false })
      .limit(200);
    for (const g of ((grants || []) as any[])) {
      const action = String(g.action_type || "").toLowerCase();
      const status = String(g.status || "").toLowerCase();
      const actionWord =
        action === "grant" ? "Доступ выдан" :
        action === "revoke" ? "Доступ отозван" :
        action === "extend" ? "Доступ продлён" :
        `Доступ: ${action || "изменение"}`;
      const failed = status === "failed" || status === "error" || Boolean(g.error_details);
      const title = failed ? `${actionWord} — ошибка` : actionWord;
      const result = (g.result || {}) as Record<string, any>;
      const accessEnd = result?.access_end || result?.expires_at || null;
      const windowDays = result?.window_days ?? null;
      const body = [
        g.target_type ? `Тип: ${g.target_type}${g.target_ref ? ` (${g.target_ref})` : ""}` : null,
        g.target_key ? `Ключ: ${g.target_key}` : null,
        accessEnd ? `Действует до: ${accessEnd}` : null,
        windowDays ? `Окно: ${windowDays} дн.` : null,
        g.reason_code ? `Причина: ${g.reason_code}` : null,
        failed && g.error_details ? `Ошибка: ${typeof g.error_details === "string" ? g.error_details : JSON.stringify(g.error_details)}` : null,
      ].filter(Boolean).join("\n");
      if (!match(title, body, g.target_key, g.target_ref, g.reason_code)) continue;
      events.push({
        id: `access_grant:${g.id}`,
        kind: "event",
        at: g.created_at,
        title,
        body,
        author: "Система",
        meta: {
          event_source: "access_grant",
          order_id: g.order_id,
          action_type: g.action_type,
          status: g.status,
          target_type: g.target_type,
          target_key: g.target_key,
          target_ref: g.target_ref,
          access_end: accessEnd,
          window_days: windowDays,
          is_error: failed,
        },
      });
    }
  }

  return events;
}

// ---------------------- Main -------------------------------------------------

export function ContactFeedTab({
  contactId,
  companyId,
  dealId,
  embedded = false,
  readOnly = false,
}: {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  embedded?: boolean;
  readOnly?: boolean;
}) {
  const entityId = dealId ?? companyId ?? contactId ?? "";
  const isDeal = Boolean(dealId);
  const isCompany = !isDeal && Boolean(companyId);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<FeedKind>>(new Set());
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [lastGoodFeedEvents, setLastGoodFeedEvents] = useState<FeedEvent[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const rec = useVoiceRecorder();

  const [previewText, setPreviewText] = useState<{ path: string; name: string } | null>(null);
  const [previewPdf, setPreviewPdf] = useState<{ url: string; name: string } | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // auto-resize composer
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [noteBody]);

  // Blob URL для превью только что записанного голосового; освобождаем при смене blob.
  const recBlobUrl = useMemo(() => (rec.blob ? URL.createObjectURL(rec.blob) : null), [rec.blob]);
  useEffect(() => () => { if (recBlobUrl) URL.revokeObjectURL(recBlobUrl); }, [recBlobUrl]);


  const types = selected.size === 0 ? null : Array.from(selected);

  const {
    data: feedEvents = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["contact_feed", entityId, types, debounced],
    enabled: !!entityId,
    placeholderData: (previousData) => previousData ?? [],
    queryFn: async () => {
      const { data, error } = isDeal
        ? await (supabase as any).rpc("deal_feed_list", {
            _deal_id: entityId,
            _types: types,
            _search: debounced || null,
            _limit: 200,
            _offset: 0,
          })
        : isCompany
        ? await supabase.rpc("company_feed_list", {
            _company_id: entityId,
            _types: types,
            _search: debounced || null,
            _limit: 200,
            _offset: 0,
          })
        : await supabase.rpc("contact_feed_list", {
            _contact_id: entityId,
            _types: types,
            _search: debounced || null,
            _limit: 200,
            _offset: 0,
          });
      if (error) throw error;
      // RPC возвращает jsonb-массив, но клиент может принести его в нескольких формах.
      const raw: any = data;
      const parsedString = typeof raw === "string"
        ? (() => { try { return JSON.parse(raw); } catch { return []; } })()
        : null;
      const firstObjectValue = raw && typeof raw === "object" && !Array.isArray(raw)
        ? Object.values(raw).find((value) => Array.isArray(value))
        : null;
      const arr = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.data)
          ? raw.data
          : Array.isArray(parsedString)
            ? parsedString
            : Array.isArray((parsedString as any)?.data)
              ? (parsedString as any).data
              : Array.isArray(firstObjectValue)
                ? firstObjectValue
                : [];
      const rpcEvents = arr as FeedEvent[];
      let platformEvents: FeedEvent[] = [];
      if (!isCompany && !isDeal) {
        try {
          const rpcDealIds = rpcEvents
            .filter((event) => event.kind === "deal" && /^[0-9a-f-]{36}$/i.test(String(event.id)))
            .map((event) => String(event.id));
          platformEvents = await loadPlatformEventsForContact(
            entityId,
            types as FeedKind[] | null,
            debounced || null,
            rpcDealIds,
          );
        } catch (platformError) {
          console.warn("[contact-feed] platform events fallback failed:", platformError);
        }
      }
      const byKey = new Map<string, FeedEvent>();
      [...rpcEvents, ...platformEvents].forEach((evt) => byKey.set(`${evt.kind}:${evt.id}`, evt));
      const enriched = await enrichFeedDealContext(Array.from(byKey.values()));
      return enriched.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
    },
  });

  useEffect(() => {
    setLastGoodFeedEvents([]);
  }, [entityId]);

  useEffect(() => {
    if (!isLoading && !isError) {
      setLastGoodFeedEvents(feedEvents);
    }
  }, [entityId, feedEvents, isError, isLoading]);

  const visibleFeedEvents = isError && lastGoodFeedEvents.length > 0 ? lastGoodFeedEvents : feedEvents;
  const hasFeedEvents = visibleFeedEvents.length > 0;
  const feedErrorMessage = error instanceof Error
    ? error.message
    : isDeal ? "Не удалось загрузить ленту сделки" : isCompany ? "Не удалось загрузить ленту компании" : "Не удалось загрузить ленту контакта";

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contact_feed", entityId] });

  const createNote = useMutation({
    mutationFn: async (body: string) => {
      const { error } = isDeal
        ? await (supabase as any).rpc("crm_deal_note_create", { _deal_id: entityId, _body: body })
        : isCompany
        ? await supabase.rpc("company_note_create", {
            _company_id: entityId,
            _body: body,
            _source: "manual",
            _source_key: null,
            _metadata: {},
          })
        : await supabase.rpc("contact_note_create", { _contact_id: entityId, _body: body });
      if (error) throw error;
    },
    onSuccess: () => { setNoteBody(""); toast.success("Заметка добавлена"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Не удалось добавить заметку"),
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(isCompany ? "company_note_delete" : "contact_note_delete", { _note_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Заметка удалена"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Не удалось удалить"),
  });

  const deleteFile = useMutation({
    mutationFn: async (evt: FeedEvent) => {
      const path = evt.meta?.storage_path as string | undefined;
      const fileTable = isCompany ? "company_files" : "contact_files";
      const fileQuery = (supabase as any).from(fileTable);
      const { error } = await fileQuery.delete().eq("id", evt.id);
      if (error) throw error;
      if (path) await supabase.storage.from("contact-files").remove([path]);
    },
    onSuccess: () => { toast.success("Удалено"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Не удалось удалить"),
  });

  async function uploadBlob(blob: Blob, filename: string, mime: string): Promise<string> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) throw new Error("no auth");
    const safeName = filename.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    const storageOwnerId = contactId ?? entityId;
    const path = `${storageOwnerId}/${Date.now()}_${safeName}`;
    const up = await supabase.storage.from("contact-files").upload(path, blob, { contentType: mime, upsert: false });
    if (up.error) throw up.error;
    const fileTable = isCompany ? "company_files" : "contact_files";
    const filePayload = isCompany
      ? { company_id: entityId, uploader_id: uid, name: filename, storage_path: path, url: null, mime_type: mime, size_bytes: blob.size, meta: {} }
      : { contact_id: contactId ?? entityId, deal_id: dealId ?? null, company_id: dealId ? companyId ?? null : null, uploader_id: uid, name: filename, storage_path: path, url: null, mime_type: mime, size_bytes: blob.size };
    const { data: inserted, error: insErr } = await (supabase as any).from(fileTable).insert(filePayload).select("id").single();
    if (insErr) throw insErr;
    return inserted!.id as string;
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        await uploadBlob(file, file.name, file.type || "application/octet-stream");
      }
      toast.success("Файлы загружены");
      invalidate();
    } catch (e: any) {
      toast.error(e?.message || "Ошибка загрузки");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function sendVoice() {
    if (!rec.blob) return;
    try {
      setUploading(true);
      const name = `voice_${Date.now()}.webm`;
      const fileId = await uploadBlob(rec.blob, name, "audio/webm");
      toast.success("Голосовое отправлено");
      rec.reset();
      invalidate();
      // Фоновая AI-расшифровка (не блокирует UI). Ошибки уже пишутся в meta функцией.
      supabase.functions.invoke("voice-note-transcribe-summarize", { body: { file_id: fileId } })
        .then(() => invalidate())
        .catch((e) => console.warn("[voice-note] auto-transcribe failed:", e));
    } catch (e: any) {
      toast.error(e?.message || "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

  /** Открывает файл в подходящем предпросмотре (или скачивает, если превью нет). */
  async function openFile(evt: FeedEvent) {
    const path = evt.meta?.storage_path as string | undefined;
    const name = (evt.title || evt.meta?.name || "file") as string;
    if (!path) {
      if (evt.meta?.url) window.open(evt.meta.url, "_blank");
      return;
    }
    const kind = guessFileKind(evt.meta?.mime_type, name);
    const { data, error } = await supabase.storage.from("contact-files").createSignedUrl(path, 60 * 10);
    if (error || !data?.signedUrl) { toast.error("Не удалось получить ссылку"); return; }
    if (kind === "image") setPreviewImage({ url: data.signedUrl, name });
    else if (kind === "pdf") setPreviewPdf({ url: data.signedUrl, name });
    else if (kind === "text") setPreviewText({ path, name });
    else await forceDownload(data.signedUrl, name);
  }

  /** Всегда качает файл на диск (кнопка «Скачать» в списке). */
  async function downloadFile(evt: FeedEvent) {
    const path = evt.meta?.storage_path as string | undefined;
    const name = (evt.title || evt.meta?.name || "file") as string;
    if (!path) {
      if (evt.meta?.url) await forceDownload(evt.meta.url, name);
      return;
    }
    const { data, error } = await supabase.storage.from("contact-files").createSignedUrl(path, 60 * 10);
    if (error || !data?.signedUrl) { toast.error("Не удалось получить ссылку"); return; }
    await forceDownload(data.signedUrl, name);
  }

  const toggleType = (k: FeedKind) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const insertEmoji = (e: string) => {
    setNoteBody(v => v + e);
    composerRef.current?.focus();
  };

  const canSend = !readOnly && noteBody.trim().length > 0 && !createNote.isPending;

  return (
    <div className={cn(
      embedded
        ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/75 backdrop-blur-sm p-3 sm:p-4"
        : "flex h-[calc(100vh-260px)] min-h-[520px] max-h-[calc(100vh-220px)] flex-col overflow-hidden rounded-2xl border border-border/40 bg-background/75 backdrop-blur-sm p-3 sm:p-4"

    )}>
      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-1.5 sticky top-0 z-10 bg-background/70 backdrop-blur py-1 -mx-3 sm:-mx-4 px-3 sm:px-4 border-b border-border/30">

        <button
          onClick={() => setSelected(new Set())}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs border transition",
            selected.size === 0 ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
          )}
        >Все</button>
        {ALL_TYPES.map((k) => {
          const on = selected.has(k);
          const M = KIND_META[k];
          const Icon = M.icon;
          return (
            <button
              key={k}
              onClick={() => toggleType(k)}
              className={cn(
                "px-2.5 py-1 rounded-full text-xs border inline-flex items-center gap-1 transition",
                on ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
              )}
            >
              <Icon className="w-3 h-3" /> {M.label}
            </button>
          );
        })}
        <div className="relative ml-auto min-w-[220px]">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по ленте…"
            className="pl-7 h-8 text-xs"
          />
        </div>
      </div>

      {/* List (scrollable) */}
      <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pb-3 pt-1">
        {isError && hasFeedEvents && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Не удалось обновить ленту</div>
              <div className="mt-0.5 break-words opacity-90">{feedErrorMessage}</div>
            </div>
            <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className={cn("mr-1 h-3 w-3", isFetching && "animate-spin")} />
              Повторить
            </Button>
          </div>
        )}
        {isLoading ? (
          [1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)
        ) : isError && !hasFeedEvents ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-10 text-center text-destructive">
            <AlertTriangle className="mb-2 h-10 w-10 opacity-70" />
            <p className="text-sm font-medium">Лента не загрузилась</p>
            <p className="mt-1 max-w-md break-words text-xs opacity-90">{feedErrorMessage}</p>
            <Button size="sm" variant="outline" className="mt-3 h-8 text-xs" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isFetching && "animate-spin")} />
              Повторить
            </Button>
          </div>
        ) : !hasFeedEvents ? (
          <div className={cn("flex flex-col items-center justify-center text-center text-muted-foreground", embedded ? "min-h-[220px] py-6" : "h-full min-h-[260px]")}>
            <Activity className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Пока событий нет</p>
            <p className="text-xs">Добавь заметку, задачу или загрузи файл — они появятся здесь.</p>
          </div>

        ) : (
          visibleFeedEvents.map((evt) => {
            const M = KIND_META[evt.kind] ?? KIND_META.event;
            const Icon = M.icon;
            const canDelete = evt.meta?.can_delete === true;
            return (
              <Card
                key={`${evt.kind}:${evt.id}`}
                className={cn("p-3 border backdrop-blur", M.tint)}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("shrink-0 rounded-lg p-2", M.iconColor)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{M.label}</span>
                      {evt.kind === "task" && evt.meta?.status && (
                        <Badge variant="outline" className="text-[10px]">{localizeCrmStatus(String(evt.meta.status))}</Badge>
                      )}
                      {evt.kind === "deal" && evt.meta?.status && (
                        <Badge variant="outline" className="text-[10px]">{localizeCrmStatus(String(evt.meta.status))}</Badge>
                      )}
                      {evt.kind === "event" && evt.meta?.status && (
                        <Badge variant="outline" className="text-[10px]">{localizeCrmStatus(String(evt.meta.status))}</Badge>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
                        {evt.at ? format(new Date(evt.at), "d MMM, HH:mm", { locale: ru }) : "—"}
                      </span>
                    </div>

                    {evt.kind === "call" ? (
                      <div className="mt-2"><CallCard evt={evt} entityId={entityId} /></div>
                    ) : evt.kind === "voice_note" ? (
                      <div className="mt-2">
                        <VoiceNoteBubble evt={evt} entityId={entityId} />
                      </div>
                    ) : evt.kind === "note" ? (
                      <div className="mt-1 text-sm whitespace-pre-wrap break-words">{evt.body}</div>
                    ) : evt.kind === "file" ? (
                      <div className="mt-1 flex items-center gap-2 text-sm">
                        <button onClick={() => openFile(evt)} className="text-primary hover:underline truncate">
                          {evt.title}
                        </button>
                        <span className="text-xs text-muted-foreground">{formatBytes(evt.meta?.size_bytes)}</span>
                      </div>
                    ) : evt.kind === "event" ? (
                      <>
                        <div className="mt-1 text-sm font-medium truncate">{humanizeEventTitle(evt.title)}</div>
                        {evt.body && (
                          <div className={cn(
                            "mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words",
                            evt.meta?.event_source === "order_notification"
                              ? "max-h-80 overflow-y-auto rounded-md bg-background/40 p-2"
                              : "line-clamp-4"
                          )}>
                            {stripHtmlTags(evt.body)}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {evt.title && (
                          <div className="mt-1 text-sm font-medium truncate">{evt.title}</div>
                        )}
                        {evt.body && (
                          <div className={cn(
                            "mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words",
                            evt.meta?.event_source === "order_notification"
                              ? "max-h-80 overflow-y-auto rounded-md bg-background/40 p-2"
                              : "line-clamp-4"
                          )}>
                            {stripHtmlTags(evt.body)}
                          </div>
                        )}
                      </>
                    )}

                    {(evt.author || evt.meta?.phone) && evt.kind !== "call" && (
                      <div className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                        {evt.meta?.phone && <span>{evt.meta.phone}</span>}
                        {evt.author && <span>· {evt.author}</span>}
                      </div>
                    )}
                  </div>

                  {evt.kind === "note" && canDelete && !readOnly && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => deleteNote.mutate(evt.id)} title="Удалить">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(evt.kind === "file" || evt.kind === "voice_note") && (
                    <div className="flex flex-col gap-1">
                      {evt.kind === "file" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => downloadFile(evt)} title="Скачать">
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {canDelete && !readOnly && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => deleteFile.mutate(evt)} title="Удалить файл">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Composer (Telegram-style, sticky bottom) */}
      <div className="z-10 mt-2 shrink-0">
        {readOnly && (
          <div className="rounded-2xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
            Режим просмотра: добавление заметок, файлов и задач доступно пользователям с правом редактирования.
          </div>
        )}
        {!readOnly && (rec.blob ? (
          <div className="flex items-center gap-2 rounded-2xl border border-fuchsia-500/25 bg-fuchsia-500/10 p-2 backdrop-blur">
            <CallRecordingPlayer
              src={recBlobUrl!}
              className="!bg-fuchsia-500/10 !border-fuchsia-500/25 flex-1"
              fileName={`voice_${Date.now()}.webm`}
            />
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={rec.reset} title="Отменить">
              <X className="w-4 h-4" />
            </Button>
            <Button size="icon" className="h-8 w-8 shrink-0 rounded-full" disabled={uploading} onClick={sendVoice} title="Отправить">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        ) : rec.recording ? (
          <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-2 backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm tabular-nums">{Math.floor(rec.elapsed/60)}:{String(rec.elapsed%60).padStart(2,"0")}</span>
            <span className="text-xs text-muted-foreground flex-1">Идёт запись…</span>
            <Button size="icon" className="h-8 w-8 shrink-0 rounded-full" onClick={rec.stop} title="Остановить">
              <Square className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2 rounded-2xl border border-border/50 bg-background/95 p-2 backdrop-blur">
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" title="Эмодзи">
                  <Smile className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" side="top" align="start">
                <div className="grid grid-cols-6 gap-1">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => insertEmoji(e)} className="text-xl hover:bg-accent rounded p-1">{e}</button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" disabled={uploading}>
                  <Paperclip className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-1" side="top" align="start">
                <button
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip className="w-4 h-4" /> Файл
                </button>
                <button
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent"
                  onClick={() => setCreateTaskOpen(true)}
                >
                  <ClipboardList className="w-4 h-4" /> Задача
                </button>
              </PopoverContent>
            </Popover>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
            <Textarea
              ref={composerRef}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) {
                  e.preventDefault();
                  createNote.mutate(noteBody.trim());
                }
              }}
              placeholder="Сообщение…  (Ctrl/⌘ + Enter — отправить)"
              rows={1}
              className="flex-1 min-h-[36px] max-h-[160px] resize-none bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-2 py-2 text-sm"
            />
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" onClick={rec.start} title="Голосовое сообщение">
              <Mic className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              disabled={!canSend}
              onClick={() => createNote.mutate(noteBody.trim())}
              title="Отправить"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {/* Modals */}
      <CreateCrmTaskDialog
        open={createTaskOpen}
        onOpenChange={(v) => { setCreateTaskOpen(v); if (!v) invalidate(); }}
        defaultContactId={isCompany ? null : contactId ?? null}
        defaultCompanyId={isCompany ? entityId : companyId ?? null}
        defaultDealId={dealId ?? null}
      />
      {previewText && (
        <TextFilePreview open onClose={() => setPreviewText(null)} path={previewText.path} name={previewText.name} />
      )}
      {previewPdf && (
        <PdfDialog open onClose={() => setPreviewPdf(null)} url={previewPdf.url} name={previewPdf.name} />
      )}
      {previewImage && (
        <MediaLightbox
          open
          onOpenChange={(v) => !v && setPreviewImage(null)}
          type="photo"
          url={previewImage.url}
          fileName={previewImage.name}
        />
      )}
    </div>
  );
}

export default ContactFeedTab;
