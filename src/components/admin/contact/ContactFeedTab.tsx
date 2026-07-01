import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Phone, MessageCircle, Mail, Send, ClipboardList, StickyNote,
  Paperclip, Search, Trash2, Download, Upload, Plus, Activity
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateCrmTaskDialog } from "@/components/admin/tasks/CreateCrmTaskDialog";

type FeedKind = "call" | "sms" | "email" | "telegram" | "task" | "note" | "file" | "event";

interface FeedEvent {
  id: string;
  kind: FeedKind;
  at: string | null;
  title: string | null;
  body: string | null;
  meta: Record<string, any> | null;
  author: string | null;
}

const KIND_META: Record<FeedKind, { label: string; icon: any; color: string; ring: string; }> = {
  call:     { label: "Звонки",   icon: Phone,         color: "text-sky-600 bg-sky-50 border-sky-100",             ring: "ring-sky-200" },
  sms:      { label: "SMS",      icon: MessageCircle, color: "text-emerald-600 bg-emerald-50 border-emerald-100", ring: "ring-emerald-200" },
  email:    { label: "Письма",   icon: Mail,          color: "text-violet-600 bg-violet-50 border-violet-100",    ring: "ring-violet-200" },
  telegram: { label: "Telegram", icon: Send,          color: "text-cyan-600 bg-cyan-50 border-cyan-100",          ring: "ring-cyan-200" },
  task:     { label: "Задачи",   icon: ClipboardList, color: "text-amber-600 bg-amber-50 border-amber-100",       ring: "ring-amber-200" },
  note:     { label: "Заметки",  icon: StickyNote,    color: "text-slate-600 bg-slate-50 border-slate-200",       ring: "ring-slate-200" },
  file:     { label: "Файлы",    icon: Paperclip,     color: "text-fuchsia-600 bg-fuchsia-50 border-fuchsia-100", ring: "ring-fuchsia-200" },
  event:    { label: "События",  icon: Activity,      color: "text-zinc-600 bg-zinc-50 border-zinc-200",          ring: "ring-zinc-200" },
};

const ALL_TYPES: FeedKind[] = ["call", "sms", "email", "telegram", "task", "note", "file", "event"];

function formatBytes(n?: number) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function ContactFeedTab({ contactId }: { contactId: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<FeedKind>>(new Set());
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // debounce search
  useMemo(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const types = selected.size === 0 ? null : Array.from(selected);

  const { data, isLoading, refetch } = useQuery({
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
      return ((data ?? []) as unknown) as FeedEvent[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["contact_feed", contactId] });
  };

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
      if (path) {
        await supabase.storage.from("contact-files").remove([path]);
      }
    },
    onSuccess: () => { toast.success("Файл удалён"); invalidate(); },
    onError: (e: any) => toast.error(e?.message || "Не удалось удалить"),
  });

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) throw new Error("no auth");
      for (const file of Array.from(list)) {
        const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
        const path = `${contactId}/${Date.now()}_${safeName}`;
        const up = await supabase.storage.from("contact-files").upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
        if (up.error) throw up.error;
        const { data: signed } = await supabase.storage.from("contact-files")
          .createSignedUrl(path, 60 * 60 * 24 * 30);
        const { error: insErr } = await supabase.from("contact_files").insert({
          contact_id: contactId,
          uploader_id: uid,
          name: file.name,
          storage_path: path,
          url: signed?.signedUrl ?? null,
          mime_type: file.type || null,
          size_bytes: file.size,
        });
        if (insErr) throw insErr;
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

  async function openFile(evt: FeedEvent) {
    const path = evt.meta?.storage_path as string | undefined;
    if (!path) {
      if (evt.meta?.url) window.open(evt.meta.url, "_blank");
      return;
    }
    const { data, error } = await supabase.storage.from("contact-files").createSignedUrl(path, 60 * 10);
    if (error || !data?.signedUrl) { toast.error("Не удалось получить ссылку"); return; }
    window.open(data.signedUrl, "_blank");
  }

  const toggleType = (k: FeedKind) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Composer + actions */}
      <Card className="p-3 space-y-2 backdrop-blur bg-white/60 dark:bg-white/5 border-white/40">
        <Textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (noteBody.trim()) createNote.mutate(noteBody.trim());
            }
          }}
          placeholder="Написать заметку… (Ctrl/⌘ + Enter — отправить)"
          className="min-h-[64px] bg-transparent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!noteBody.trim() || createNote.isPending}
            onClick={() => createNote.mutate(noteBody.trim())}
          >
            <StickyNote className="w-4 h-4 mr-1" /> Добавить заметку
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCreateTaskOpen(true)}>
            <Plus className="w-4 h-4 mr-1" /> Задача
          </Button>
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="w-4 h-4 mr-1" /> {uploading ? "Загрузка…" : "Файл"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      </Card>

      {/* Filters + search */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSelected(new Set())}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs border transition",
            selected.size === 0 ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
          )}
        >
          Все
        </button>
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

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !data || data.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Пока событий нет</p>
          <p className="text-xs">Добавь заметку, задачу или загрузи файл — они появятся здесь.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((evt) => {
            const M = KIND_META[evt.kind] ?? KIND_META.event;
            const Icon = M.icon;
            const canDelete = evt.meta?.can_delete === true;
            return (
              <Card
                key={`${evt.kind}:${evt.id}`}
                className={cn(
                  "p-3 border backdrop-blur bg-white/50 dark:bg-white/5 border-white/40",
                  "hover:ring-1", M.ring
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("shrink-0 rounded-lg p-2 border", M.color)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{M.label}</span>
                      {evt.kind === "task" && evt.meta?.status && (
                        <Badge variant="outline" className="text-[10px]">{String(evt.meta.status)}</Badge>
                      )}
                      {evt.kind === "call" && evt.meta?.duration != null && (
                        <Badge variant="outline" className="text-[10px]">{Number(evt.meta.duration)}s</Badge>
                      )}
                      <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap">
                        {evt.at ? format(new Date(evt.at), "d MMM, HH:mm", { locale: ru }) : "—"}
                      </span>
                    </div>

                    {evt.kind === "note" ? (
                      <div className="mt-1 text-sm whitespace-pre-wrap break-words">{evt.body}</div>
                    ) : evt.kind === "file" ? (
                      <div className="mt-1 flex items-center gap-2 text-sm">
                        <button
                          onClick={() => openFile(evt)}
                          className="text-primary hover:underline truncate"
                        >
                          {evt.title}
                        </button>
                        <span className="text-xs text-muted-foreground">{formatBytes(evt.meta?.size_bytes)}</span>
                      </div>
                    ) : (
                      <>
                        {evt.title && evt.kind !== "call" && evt.kind !== "sms" && (
                          <div className="mt-1 text-sm font-medium truncate">{evt.title}</div>
                        )}
                        {evt.body && (
                          <div className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words line-clamp-4">
                            {evt.body}
                          </div>
                        )}
                      </>
                    )}

                    {(evt.author || evt.meta?.phone) && (
                      <div className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                        {evt.meta?.phone && <span>{evt.meta.phone}</span>}
                        {evt.author && <span>· {evt.author}</span>}
                      </div>
                    )}
                  </div>

                  {evt.kind === "note" && canDelete && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => deleteNote.mutate(evt.id)}
                      title="Удалить заметку"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {evt.kind === "file" && (
                    <div className="flex flex-col gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => openFile(evt)} title="Скачать">
                        <Download className="w-3.5 h-3.5" />
                      </Button>
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
          })}
        </div>
      )}

      <CreateCrmTaskDialog
        open={createTaskOpen}
        onOpenChange={(v) => { setCreateTaskOpen(v); if (!v) refetch(); }}
        defaultContactId={contactId}
      />
    </div>
  );
}

export default ContactFeedTab;
