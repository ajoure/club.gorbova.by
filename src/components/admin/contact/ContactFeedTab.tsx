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
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Phone, MessageCircle, Mail, Send, ClipboardList, StickyNote,
  Paperclip, Search, Trash2, Download, Plus, Activity, Handshake,
  Smile, Mic, Square, Sparkles, Play, Pause, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateCrmTaskDialog } from "@/components/admin/tasks/CreateCrmTaskDialog";
import { CallRecordingPlayer } from "@/components/admin/calls/CallRecordingPlayer";
import { MediaLightbox } from "@/components/admin/chat/MediaLightbox";
import { PdfViewer } from "@/components/admin/chat/PdfViewer";

type FeedKind =
  | "call" | "sms" | "email" | "telegram" | "task" | "note"
  | "file" | "voice_note" | "deal" | "event";

interface FeedEvent {
  id: string;
  kind: FeedKind;
  at: string | null;
  title: string | null;
  body: string | null;
  meta: Record<string, any> | null;
  author: string | null;
}

const KIND_META: Record<FeedKind, { label: string; icon: any; tint: string; iconColor: string; }> = {
  call:       { label: "Звонок",   icon: Phone,         tint: "bg-blue-500/10 border-blue-500/20",       iconColor: "text-blue-600 bg-blue-500/15" },
  sms:        { label: "SMS",      icon: MessageCircle, tint: "bg-green-500/10 border-green-500/20",     iconColor: "text-green-600 bg-green-500/15" },
  email:      { label: "Письмо",   icon: Mail,          tint: "bg-violet-500/10 border-violet-500/20",   iconColor: "text-violet-600 bg-violet-500/15" },
  telegram:   { label: "Telegram", icon: Send,          tint: "bg-sky-500/10 border-sky-500/20",         iconColor: "text-sky-600 bg-sky-500/15" },
  task:       { label: "Задача",   icon: ClipboardList, tint: "bg-amber-500/10 border-amber-500/20",     iconColor: "text-amber-600 bg-amber-500/15" },
  note:       { label: "Заметка",  icon: StickyNote,    tint: "bg-rose-400/10 border-rose-400/20",       iconColor: "text-rose-600 bg-rose-400/15" },
  file:       { label: "Файл",     icon: Paperclip,     tint: "bg-teal-500/10 border-teal-500/20",       iconColor: "text-teal-600 bg-teal-500/15" },
  voice_note: { label: "Голосовое",icon: Mic,           tint: "bg-fuchsia-500/10 border-fuchsia-500/20", iconColor: "text-fuchsia-600 bg-fuchsia-500/15" },
  deal:       { label: "Сделка",   icon: Handshake,     tint: "bg-emerald-500/10 border-emerald-500/20", iconColor: "text-emerald-600 bg-emerald-500/15" },
  event:      { label: "Событие",  icon: Activity,      tint: "bg-indigo-500/10 border-indigo-500/20",   iconColor: "text-indigo-600 bg-indigo-500/15" },
};

const ALL_TYPES: FeedKind[] = ["call", "sms", "email", "telegram", "task", "note", "file", "voice_note", "deal", "event"];

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

function CallCard({ evt, contactId }: { evt: FeedEvent; contactId: string }) {
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
      qc.invalidateQueries({ queryKey: ["contact_feed", contactId] });
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
        {evt.meta?.status && <Badge variant="outline" className="text-[10px]">{String(evt.meta.status)}</Badge>}
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

function VoiceNoteBubble({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("contact-files").createSignedUrl(path, 60 * 60).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [path]);
  if (!url) return <div className="text-xs text-muted-foreground">Загрузка аудио…</div>;
  return <audio src={url} controls className="w-full max-w-sm h-9" />;
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

// ---------------------- Main -------------------------------------------------

export function ContactFeedTab({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<FeedKind>>(new Set());
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
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

  const types = selected.size === 0 ? null : Array.from(selected);

  const { data, isLoading } = useQuery({
    queryKey: ["contact_feed", contactId, types, debounced],
    enabled: !!contactId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("contact_feed_list", {
        _contact_id: contactId,
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
      return arr as FeedEvent[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["contact_feed", contactId] });

  const createNote = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.rpc("contact_note_create", { _contact_id: contactId, _body: body });
      if (error) throw error;
    },
    onSuccess: () => { setNoteBody(""); toast.success("Заметка добавлена"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Не удалось добавить заметку"),
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("contact_note_delete", { _note_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Заметка удалена"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Не удалось удалить"),
  });

  const deleteFile = useMutation({
    mutationFn: async (evt: FeedEvent) => {
      const path = evt.meta?.storage_path as string | undefined;
      const { error } = await supabase.from("contact_files").delete().eq("id", evt.id);
      if (error) throw error;
      if (path) await supabase.storage.from("contact-files").remove([path]);
    },
    onSuccess: () => { toast.success("Удалено"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Не удалось удалить"),
  });

  async function uploadBlob(blob: Blob, filename: string, mime: string) {
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) throw new Error("no auth");
    const safeName = filename.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    const path = `${contactId}/${Date.now()}_${safeName}`;
    const up = await supabase.storage.from("contact-files").upload(path, blob, { contentType: mime, upsert: false });
    if (up.error) throw up.error;
    const { error: insErr } = await supabase.from("contact_files").insert({
      contact_id: contactId,
      uploader_id: uid,
      name: filename,
      storage_path: path,
      url: null,
      mime_type: mime,
      size_bytes: blob.size,
    });
    if (insErr) throw insErr;
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
      await uploadBlob(rec.blob, name, "audio/webm");
      toast.success("Голосовое отправлено");
      rec.reset();
      invalidate();
    } catch (e: any) {
      toast.error(e?.message || "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  }

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
    else {
      const a = document.createElement("a");
      a.href = data.signedUrl; a.download = name; a.click();
    }
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

  const canSend = noteBody.trim().length > 0 && !createNote.isPending;

  return (
    <div className="flex flex-col h-full min-h-[60vh]">
      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2 sticky top-0 z-10 bg-background/80 backdrop-blur py-2">
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
      <div className="flex-1 overflow-y-auto space-y-2 pb-3 pt-1">
        {isLoading ? (
          [1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)
        ) : !data || data.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Пока событий нет</p>
            <p className="text-xs">Добавь заметку, задачу или загрузи файл — они появятся здесь.</p>
          </div>
        ) : (
          data.map((evt) => {
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
                        <Badge variant="outline" className="text-[10px]">{String(evt.meta.status)}</Badge>
                      )}
                      {evt.kind === "deal" && evt.meta?.status && (
                        <Badge variant="outline" className="text-[10px]">{String(evt.meta.status)}</Badge>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
                        {evt.at ? format(new Date(evt.at), "d MMM, HH:mm", { locale: ru }) : "—"}
                      </span>
                    </div>

                    {evt.kind === "call" ? (
                      <div className="mt-2"><CallCard evt={evt} contactId={contactId} /></div>
                    ) : evt.kind === "voice_note" ? (
                      <div className="mt-2">
                        {evt.meta?.storage_path && <VoiceNoteBubble path={evt.meta.storage_path} />}
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
                    ) : (
                      <>
                        {evt.title && (
                          <div className="mt-1 text-sm font-medium truncate">{evt.title}</div>
                        )}
                        {evt.body && (
                          <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words line-clamp-4">
                            {evt.body}
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

                  {evt.kind === "note" && canDelete && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => deleteNote.mutate(evt.id)} title="Удалить">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(evt.kind === "file" || evt.kind === "voice_note") && (
                    <div className="flex flex-col gap-1">
                      {evt.kind === "file" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => openFile(evt)} title="Скачать">
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {canDelete && (
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
      <div className="sticky bottom-0 z-10 mt-2">
        {rec.blob ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-background/95 p-2 backdrop-blur">
            <audio src={URL.createObjectURL(rec.blob)} controls className="h-9 flex-1" />
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={rec.reset} title="Отменить">
              <X className="w-4 h-4" />
            </Button>
            <Button size="icon" className="h-9 w-9 shrink-0 rounded-full" disabled={uploading} onClick={sendVoice} title="Отправить">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        ) : rec.recording ? (
          <div className="flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-2 backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm tabular-nums">{Math.floor(rec.elapsed/60)}:{String(rec.elapsed%60).padStart(2,"0")}</span>
            <span className="text-xs text-muted-foreground flex-1">Идёт запись…</span>
            <Button size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={rec.stop} title="Остановить">
              <Square className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2 rounded-2xl border border-border/50 bg-background/95 p-2 backdrop-blur">
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" title="Эмодзи">
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
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" disabled={uploading}>
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
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full" onClick={rec.start} title="Голосовое сообщение">
              <Mic className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              disabled={!canSend}
              onClick={() => createNote.mutate(noteBody.trim())}
              title="Отправить"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateCrmTaskDialog
        open={createTaskOpen}
        onOpenChange={(v) => { setCreateTaskOpen(v); if (!v) invalidate(); }}
        defaultContactId={contactId}
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
