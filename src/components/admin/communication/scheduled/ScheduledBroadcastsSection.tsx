/**
 * ScheduledBroadcastsSection (Sprint B rev3)
 *
 * Каноническая таблица управления запланированными и повторяющимися рассылками.
 *
 * Принципы:
 *  - Только управление. Создание/редактирование — в «Быстрой рассылке».
 *  - Никакого DispatcherStatusPanel / production approval / cron / system audit UI.
 *  - Никакого собственного wizard.
 *  - Soft-delete, если у шаблона есть broadcast_runs.
 *  - Bulk actions пишут в audit_logs (actor_type='user').
 *
 * Канон UI = паттерн таблиц проекта (см. AdminContacts):
 *  toolbar (поиск + фильтры) → bulk action bar (при selection) → таблица → confirm modals.
 */
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Loader2,
  MoreHorizontal,
  Repeat,
  Clock,
  MessageCircle,
  Mail,
  Pencil,
  Pause,
  Play,
  CalendarX,
  Copy,
  History as HistoryIcon,
  Trash2,
  Search,
  Inbox,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { toast } from "sonner";

interface SchedRow {
  id: string;
  name: string;
  status: string;
  send_mode: string;
  channels: string[];
  next_run_at: string | null;
  last_run_at: string | null;
  total_runs: number;
  created_at: string;
  recurrence_rule: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

interface BroadcastRunRow {
  id: string;
  channel: string;
  started_at: string;
  finished_at: string | null;
  audience_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
  skipped_count: number | null;
  dry_run: boolean;
  error: string | null;
  triggered_by: string | null;
}

type TypeFilter = "all" | "scheduled" | "recurring";
type StatusFilter = "all" | "active" | "paused" | "sent" | "error" | "archived";
type ChannelFilter = "all" | "telegram" | "email";

interface Props {
  /** Колбэк перехода на «Быструю рассылку» с предзаполнением (фаза 2). */
  onEdit?: (templateId: string) => void;
}

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  scheduled: { label: "Активна", variant: "default" },
  recurring: { label: "Активна", variant: "default" },
  paused: { label: "Выключена", variant: "secondary" },
  sent: { label: "Завершена", variant: "outline" },
  archived: { label: "Архив", variant: "outline" },
  draft: { label: "Черновик", variant: "outline" },
};

function statusBadge(row: SchedRow) {
  const meta = STATUS_LABEL[row.status] ?? { label: row.status, variant: "outline" as const };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd MMM yyyy, HH:mm", { locale: ru });
  } catch {
    return "—";
  }
}

export function ScheduledBroadcastsSection({ onEdit }: Props) {
  const qc = useQueryClient();

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<null | {
    kind: "bulk_delete" | "bulk_unschedule" | "row_delete" | "row_unschedule";
    ids: string[];
    label: string;
  }>(null);

  // History sheet
  const [historyId, setHistoryId] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["scheduled-broadcasts-canonical"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcast_templates")
        .select(
          "id, name, status, send_mode, channels, next_run_at, last_run_at, total_runs, created_at, recurrence_rule, metadata"
        )
        .in("status", ["scheduled", "recurring", "paused", "sent", "archived"])
        .order("next_run_at", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as SchedRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // hide archived by default unless explicitly chosen
      if (statusFilter !== "archived" && r.status === "archived") return false;

      if (q && !r.name.toLowerCase().includes(q)) return false;

      if (typeFilter === "scheduled" && r.send_mode !== "scheduled") return false;
      if (typeFilter === "recurring" && r.send_mode !== "recurring") return false;

      if (statusFilter === "active" && !["scheduled", "recurring"].includes(r.status)) return false;
      if (statusFilter === "paused" && r.status !== "paused") return false;
      if (statusFilter === "sent" && r.status !== "sent") return false;
      if (statusFilter === "archived" && r.status !== "archived") return false;
      if (statusFilter === "error") {
        // error = paused with last error metadata, fallback: never (no dedicated status)
        const hasErr = !!(r.metadata && (r.metadata as Record<string, unknown>).last_error);
        if (!hasErr) return false;
      }

      if (channelFilter !== "all" && !r.channels?.includes(channelFilter)) return false;

      return true;
    });
  }, [rows, search, typeFilter, statusFilter, channelFilter]);

  const allOnPageChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someOnPageChecked = filtered.some((r) => selected.has(r.id));

  const toggleAll = () => {
    if (allOnPageChecked) {
      const next = new Set(selected);
      filtered.forEach((r) => next.delete(r.id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((r) => next.add(r.id));
      setSelected(next);
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  // ===== Audit helper (canonical platform pattern) =====
  // For bulk actions audit is mandatory. We do not block the action itself
  // (data change has already happened), but we MUST surface failures to the
  // operator via toast so the gap is visible and can be reconciled.
  const writeAudit = async (
    action: string,
    ids: string[],
    beforeAfter: Record<string, unknown>,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const uid = userRes?.user?.id ?? null;
      const { error } = await supabase.from("audit_logs").insert({
        actor_type: "user",
        actor_user_id: uid,
        actor_label: "admin_bulk_broadcasts",
        action,
        meta: {
          ids,
          count: ids.length,
          ...beforeAfter,
        },
      });
      if (error) throw error;
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[scheduled-broadcasts] audit log failed", err);
      toast.warning(
        `Действие выполнено, но запись в журнал аудита не удалась (${action}). Сообщите администратору.`,
        { description: message.slice(0, 200) },
      );
      return { success: false, error: message };
    }
  };

  // ===== Mutations =====

  // PAUSE
  const pauseMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // Read current statuses to remember paused_from_status
      const { data: current } = await supabase
        .from("broadcast_templates")
        .select("id, status, metadata")
        .in("id", ids);

      const updates =
        (current ?? []).map((row) => {
          const prevMeta = (row.metadata as Record<string, unknown>) ?? {};
          return supabase
            .from("broadcast_templates")
            .update({
              status: "paused",
              metadata: { ...prevMeta, paused_from_status: row.status },
            })
            .eq("id", row.id);
        }) ?? [];

      const results = await Promise.all(updates);
      const errs = results.filter((r) => r.error).map((r) => r.error?.message);
      if (errs.length) throw new Error(errs.join("; "));

      await writeAudit("broadcast_bulk_disable", ids, {
        before_status: Object.fromEntries((current ?? []).map((r) => [r.id, r.status])),
        after_status: "paused",
      });
    },
    onSuccess: (_d, ids) => {
      toast.success(`Выключено: ${ids.length}`);
      qc.invalidateQueries({ queryKey: ["scheduled-broadcasts-canonical"] });
      setSelected(new Set());
    },
    onError: (e) => toast.error("Ошибка: " + (e as Error).message),
  });

  // RESUME
  const resumeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data: current } = await supabase
        .from("broadcast_templates")
        .select("id, status, send_mode, recurrence_rule, next_run_at, metadata")
        .in("id", ids);

      const errors: string[] = [];
      for (const row of current ?? []) {
        const meta = (row.metadata as Record<string, unknown>) ?? {};
        const restored =
          (meta.paused_from_status as string) ||
          (row.recurrence_rule ? "recurring" : "scheduled");

        let nextRun: string | null = row.next_run_at;

        if (restored === "recurring" && row.recurrence_rule) {
          const { data: nextRunRpc, error: rpcErr } = await supabase.rpc(
            "compute_next_broadcast_run",
            { rule: row.recurrence_rule as never, from_ts: new Date().toISOString() }
          );
          if (rpcErr) {
            errors.push(`${row.id}: ${rpcErr.message}`);
            continue;
          }
          nextRun = (nextRunRpc as string | null) ?? null;
        }

        if (restored === "scheduled" && row.next_run_at) {
          if (new Date(row.next_run_at).getTime() < Date.now()) {
            errors.push(
              `${row.id}: дата уже прошла, откройте «Изменить» и выберите новую`
            );
            continue;
          }
        }

        const newMeta = { ...meta };
        delete newMeta.paused_from_status;

        const { error } = await supabase
          .from("broadcast_templates")
          .update({ status: restored, next_run_at: nextRun, metadata: newMeta as never })
          .eq("id", row.id);
        if (error) errors.push(`${row.id}: ${error.message}`);
      }

      if (errors.length) throw new Error(errors.join("; "));

      await writeAudit("broadcast_bulk_enable", ids, {
        before_status: "paused",
        after_status: "scheduled|recurring",
      });
    },
    onSuccess: (_d, ids) => {
      toast.success(`Включено: ${ids.length}`);
      qc.invalidateQueries({ queryKey: ["scheduled-broadcasts-canonical"] });
      setSelected(new Set());
    },
    onError: (e) => toast.error("Ошибка: " + (e as Error).message),
  });

  // UNSCHEDULE → draft
  const unscheduleMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data: current } = await supabase
        .from("broadcast_templates")
        .select("id, status")
        .in("id", ids);

      const { error } = await supabase
        .from("broadcast_templates")
        .update({
          status: "draft",
          send_mode: "manual",
          next_run_at: null,
          recurrence_rule: null,
        })
        .in("id", ids);
      if (error) throw error;

      await writeAudit("broadcast_bulk_unschedule", ids, {
        before_status: Object.fromEntries((current ?? []).map((r) => [r.id, r.status])),
        after_status: "draft",
      });
    },
    onSuccess: (_d, ids) => {
      toast.success(`Снято с расписания: ${ids.length}`);
      qc.invalidateQueries({ queryKey: ["scheduled-broadcasts-canonical"] });
      setSelected(new Set());
    },
    onError: (e) => toast.error("Ошибка: " + (e as Error).message),
  });

  // DELETE — safe: hard delete если нет runs, иначе soft-archive
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      // For each id, check broadcast_runs presence
      const { data: runs } = await supabase
        .from("broadcast_runs")
        .select("template_id")
        .in("template_id", ids);

      const withHistory = new Set((runs ?? []).map((r) => r.template_id as string));
      const hardDeleteIds = ids.filter((id) => !withHistory.has(id));
      const softArchiveIds = ids.filter((id) => withHistory.has(id));

      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id ?? null;

      if (hardDeleteIds.length) {
        const { error } = await supabase
          .from("broadcast_templates")
          .delete()
          .in("id", hardDeleteIds);
        if (error) throw error;
      }

      if (softArchiveIds.length) {
        // Read metadata first
        const { data: current } = await supabase
          .from("broadcast_templates")
          .select("id, metadata")
          .in("id", softArchiveIds);

        const updates =
          (current ?? []).map((row) => {
            const prevMeta = (row.metadata as Record<string, unknown>) ?? {};
            return supabase
              .from("broadcast_templates")
              .update({
                status: "archived",
                next_run_at: null,
                metadata: {
                  ...prevMeta,
                  deleted_at: new Date().toISOString(),
                  deleted_by: uid,
                },
              })
              .eq("id", row.id);
          }) ?? [];
        const results = await Promise.all(updates);
        const errs = results.filter((r) => r.error).map((r) => r.error?.message);
        if (errs.length) throw new Error(errs.join("; "));
      }

      await writeAudit("broadcast_bulk_delete", ids, {
        hard_deleted: hardDeleteIds,
        soft_archived: softArchiveIds,
      });

      return { hardDeleteIds, softArchiveIds };
    },
    onSuccess: (res) => {
      toast.success(
        `Удалено: ${res.hardDeleteIds.length}, архивировано: ${res.softArchiveIds.length}`
      );
      qc.invalidateQueries({ queryKey: ["scheduled-broadcasts-canonical"] });
      setSelected(new Set());
    },
    onError: (e) => toast.error("Ошибка: " + (e as Error).message),
  });

  // DUPLICATE
  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: src, error: readErr } = await supabase
        .from("broadcast_templates")
        .select("*")
        .eq("id", id)
        .single();
      if (readErr || !src) throw readErr ?? new Error("not found");

      const { id: _id, created_at: _ca, updated_at: _ua, sent_at: _sa, sent_count: _sc, failed_count: _fc, total_runs: _tr, last_run_at: _lr, ...rest } =
        src as Record<string, unknown>;

      const { error } = await supabase.from("broadcast_templates").insert({
        ...(rest as Record<string, unknown>),
        name: `${(src as Record<string, unknown>).name} (копия)`,
        status: "draft",
        send_mode: "manual",
        next_run_at: null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Скопировано в черновики");
      qc.invalidateQueries({ queryKey: ["scheduled-broadcasts-canonical"] });
    },
    onError: (e) => toast.error("Ошибка копирования: " + (e as Error).message),
  });

  // History
  const { data: historyRows, isLoading: historyLoading } = useQuery({
    queryKey: ["broadcast-runs-history", historyId],
    enabled: !!historyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcast_runs")
        .select(
          "id, channel, started_at, finished_at, audience_count, sent_count, failed_count, skipped_count, dry_run, error, triggered_by"
        )
        .eq("template_id", historyId!)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as BroadcastRunRow[];
    },
  });

  // ===== Render =====

  const renderRowActions = (row: SchedRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-50 bg-popover">
        <DropdownMenuItem onClick={() => onEdit?.(row.id)}>
          <Pencil className="h-4 w-4 mr-2" /> Изменить
        </DropdownMenuItem>
        {row.status === "paused" ? (
          <DropdownMenuItem onClick={() => resumeMutation.mutate([row.id])}>
            <Play className="h-4 w-4 mr-2" /> Включить
          </DropdownMenuItem>
        ) : ["scheduled", "recurring"].includes(row.status) ? (
          <DropdownMenuItem onClick={() => pauseMutation.mutate([row.id])}>
            <Pause className="h-4 w-4 mr-2" /> Выключить
          </DropdownMenuItem>
        ) : null}
        {["scheduled", "recurring", "paused"].includes(row.status) && (
          <DropdownMenuItem
            onClick={() =>
              setConfirmAction({
                kind: "row_unschedule",
                ids: [row.id],
                label: `Снять с расписания: ${row.name}?`,
              })
            }
          >
            <CalendarX className="h-4 w-4 mr-2" /> Снять с расписания
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => duplicateMutation.mutate(row.id)}>
          <Copy className="h-4 w-4 mr-2" /> Дублировать
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setHistoryId(row.id)}>
          <HistoryIcon className="h-4 w-4 mr-2" /> История запусков
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() =>
            setConfirmAction({
              kind: "row_delete",
              ids: [row.id],
              label: `Удалить «${row.name}»? При наличии истории запусков шаблон будет архивирован.`,
            })
          }
        >
          <Trash2 className="h-4 w-4 mr-2" /> Удалить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent className="z-50 bg-popover">
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="scheduled">Однократные</SelectItem>
            <SelectItem value="recurring">Повторяющиеся</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent className="z-50 bg-popover">
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="active">Активные</SelectItem>
            <SelectItem value="paused">Выключенные</SelectItem>
            <SelectItem value="sent">Завершённые</SelectItem>
            <SelectItem value="error">С ошибкой</SelectItem>
            <SelectItem value="archived">Архив</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={(v) => setChannelFilter(v as ChannelFilter)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Канал" />
          </SelectTrigger>
          <SelectContent className="z-50 bg-popover">
            <SelectItem value="all">Все каналы</SelectItem>
            <SelectItem value="telegram">Telegram</SelectItem>
            <SelectItem value="email">Email</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="py-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium mr-2">
              Выбрано: {selected.size}
            </span>
            <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate([...selected])}>
              <Play className="h-3 w-3 mr-1" /> Включить
            </Button>
            <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate([...selected])}>
              <Pause className="h-3 w-3 mr-1" /> Выключить
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setConfirmAction({
                  kind: "bulk_unschedule",
                  ids: [...selected],
                  label: `Снять с расписания ${selected.size} рассылок и вернуть в черновики?`,
                })
              }
            >
              <CalendarX className="h-3 w-3 mr-1" /> Снять
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                setConfirmAction({
                  kind: "bulk_delete",
                  ids: [...selected],
                  label: `Удалить ${selected.size} рассылок? Шаблоны с историей запусков будут архивированы.`,
                })
              }
            >
              <Trash2 className="h-3 w-3 mr-1" /> Удалить/архивировать
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Снять выбор
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allOnPageChecked}
                    onCheckedChange={toggleAll}
                    aria-label="Выбрать все на странице"
                    {...(someOnPageChecked && !allOnPageChecked
                      ? { "data-state": "indeterminate" as const }
                      : {})}
                  />
                </TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Каналы</TableHead>
                <TableHead>Следующая</TableHead>
                <TableHead>Последняя</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Создано</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin inline-block text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-sm text-muted-foreground">
                    <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    Запланированных рассылок нет.
                    <br />
                    Создайте новую через «Быстрая рассылка» → «Запланировать».
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => (
                  <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleOne(row.id)}
                        aria-label={`Выбрать ${row.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => onEdit?.(row.id)}
                        className="font-medium text-left hover:underline"
                      >
                        {row.name}
                      </button>
                    </TableCell>
                    <TableCell>
                      {row.send_mode === "recurring" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Repeat className="h-3 w-3" /> Повторяющаяся
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <Clock className="h-3 w-3" /> Однократная
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {row.channels?.includes("telegram") && (
                          <Badge variant="outline" className="gap-1">
                            <MessageCircle className="h-3 w-3" /> TG
                          </Badge>
                        )}
                        {row.channels?.includes("email") && (
                          <Badge variant="outline" className="gap-1">
                            <Mail className="h-3 w-3" /> Email
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmtDate(row.next_run_at)}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmtDate(row.last_run_at)}
                    </TableCell>
                    <TableCell>{statusBadge(row)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {fmtDate(row.created_at)}
                    </TableCell>
                    <TableCell>{renderRowActions(row)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirm dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердите действие</AlertDialogTitle>
            <AlertDialogDescription>{confirmAction?.label}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmAction) return;
                const { kind, ids } = confirmAction;
                if (kind === "bulk_delete" || kind === "row_delete") {
                  deleteMutation.mutate(ids);
                } else if (kind === "bulk_unschedule" || kind === "row_unschedule") {
                  unscheduleMutation.mutate(ids);
                }
                setConfirmAction(null);
              }}
            >
              Подтвердить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* History sheet */}
      <Sheet open={!!historyId} onOpenChange={(o) => !o && setHistoryId(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>История запусков</SheetTitle>
            <SheetDescription>
              Последние 50 запусков из broadcast_runs
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {historyLoading ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            ) : !historyRows || historyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Запусков пока не было
              </p>
            ) : (
              historyRows.map((r) => (
                <Card key={r.id}>
                  <CardContent className="py-3 text-sm space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline">{r.channel}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(r.started_at)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span>Аудитория: {r.audience_count ?? 0}</span>
                      <span>Отправлено: {r.sent_count ?? 0}</span>
                      <span>Ошибок: {r.failed_count ?? 0}</span>
                      <span>Пропущено: {r.skipped_count ?? 0}</span>
                      {r.dry_run && <Badge variant="secondary">dry-run</Badge>}
                      {r.triggered_by && (
                        <span className="text-muted-foreground">
                          источник: {r.triggered_by}
                        </span>
                      )}
                    </div>
                    {r.error && (
                      <p className="text-xs text-destructive">{r.error}</p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
