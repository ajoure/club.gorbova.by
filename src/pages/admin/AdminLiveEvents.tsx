import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Plus, Edit2, Loader2, Video, ExternalLink, ChevronDown, AlertCircle, CheckCircle2, Users, Link2, PlayCircle, Shield } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { slugify } from "@/utils/slugify";
import { LiveEventAccessRulesEditor, type AccessRuleRow } from "@/components/admin/live/LiveEventAccessRulesEditor";

interface LiveEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kinescope_video_id: string | null;
  product_id: string | null;
  access_rule: { mode: string; product_id: string | null; tariff_id: string | null };
  status: string;
  is_published: boolean;
  scheduled_at: string | null;
  replay_enabled: boolean;
  invite_mode: string;
  direct_access_allowed: boolean;
  created_at: string;
  metadata: Record<string, any> | null;
}

interface LiveEventForm {
  slug: string;
  title: string;
  description: string;
  kinescope_video_id: string;
  kinescope_mode: "picker" | "manual";
  kinescope_project_id: string;
  status: string;
  is_published: boolean;
  scheduled_at: string;
  replay_enabled: boolean;
  invite_mode: "none" | "optional_one_time" | "required_one_time";
  direct_access_allowed: boolean;
  access_rules: AccessRuleRow[];
}

const defaultForm: LiveEventForm = {
  slug: "",
  title: "",
  description: "",
  kinescope_video_id: "",
  kinescope_mode: "picker",
  kinescope_project_id: "",
  status: "draft",
  is_published: false,
  scheduled_at: "",
  replay_enabled: false,
  invite_mode: "none",
  direct_access_allowed: true,
  access_rules: [],
};

const statusLabels: Record<string, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  live: "В эфире",
  ended: "Завершён",
};

const inviteModeLabels: Record<string, { label: string; description: string }> = {
  none: {
    label: "Без приглашений",
    description: "Доступ по правам аккаунта, без персональной ссылки",
  },
  optional_one_time: {
    label: "Персональные ссылки можно отправлять",
    description: "По ссылке вход удобнее, но пользователь с нужными правами может войти и без неё",
  },
  required_one_time: {
    label: "Вход только по персональной ссылке",
    description: "Даже при наличии прав аккаунта нужен вход через выданную ссылку",
  },
};

export default function AdminLiveEvents() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LiveEventForm>(defaultForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [publishAttempted, setPublishAttempted] = useState(false);

  // Date/time state for DateTimePicker
  const scheduledDate = useMemo(() => {
    if (!form.scheduled_at) return undefined;
    try { return parseISO(form.scheduled_at); } catch { return undefined; }
  }, [form.scheduled_at]);

  const scheduledTime = useMemo(() => {
    if (!form.scheduled_at) return "";
    try {
      const d = parseISO(form.scheduled_at);
      return format(d, "HH:mm");
    } catch { return ""; }
  }, [form.scheduled_at]);

  const handleDateChange = useCallback((date: Date | undefined) => {
    if (!date) {
      setForm(f => ({ ...f, scheduled_at: "" }));
      return;
    }
    // Preserve existing time or default to 00:00
    const existingTime = scheduledTime || "00:00";
    const [h, m] = existingTime.split(":").map(Number);
    const combined = new Date(date);
    combined.setHours(h, m, 0, 0);
    setForm(f => ({ ...f, scheduled_at: combined.toISOString() }));
  }, [scheduledTime]);

  const handleTimeChange = useCallback((time: string) => {
    if (!scheduledDate) return;
    if (!time) {
      // Keep date, remove time precision
      const d = new Date(scheduledDate);
      d.setHours(0, 0, 0, 0);
      setForm(f => ({ ...f, scheduled_at: d.toISOString() }));
      return;
    }
    const [h, m] = time.split(":").map(Number);
    const combined = new Date(scheduledDate);
    combined.setHours(h, m, 0, 0);
    setForm(f => ({ ...f, scheduled_at: combined.toISOString() }));
  }, [scheduledDate]);

  // --- Data queries ---
  const { data: events, isLoading } = useQuery({
    queryKey: ["admin-live-events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_events")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as LiveEvent[];
    },
  });

  const { data: existingRules } = useQuery({
    queryKey: ["live-event-access-rules", editingId],
    queryFn: async () => {
      if (!editingId) return [];
      const { data } = await supabase
        .from("live_event_access_rules")
        .select("product_id, tariff_id, sort_order")
        .eq("live_event_id", editingId)
        .order("sort_order");
      return data || [];
    },
    enabled: !!editingId,
  });

  // Kinescope integration instance (tolerant lookup)
  const { data: kinescopeInstance, isLoading: kinescopeInstanceLoading } = useQuery({
    queryKey: ["kinescope-instance"],
    queryFn: async () => {
      const { data } = await supabase
        .from("integration_instances")
        .select("id, config, status")
        .eq("provider", "kinescope")
        .eq("status", "connected")
        .limit(1)
        .maybeSingle();
      return data;
    },
  });

  const kinescopeInstanceId = kinescopeInstance?.id;

  // Kinescope projects
  const { data: kinescopeProjects, isLoading: kinescopeProjectsLoading, error: kinescopeProjectsError } = useQuery({
    queryKey: ["kinescope-projects", kinescopeInstanceId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: { action: "list_projects", instance_id: kinescopeInstanceId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Ошибка загрузки проектов");
      return (data?.projects || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!kinescopeInstanceId,
  });

  // Kinescope videos for selected project
  const { data: kinescopeVideos, isLoading: kinescopeVideosLoading, error: kinescopeVideosError } = useQuery({
    queryKey: ["kinescope-videos", form.kinescope_project_id, kinescopeInstanceId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: { action: "list_videos", project_id: form.kinescope_project_id, instance_id: kinescopeInstanceId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Ошибка загрузки видео");
      return (data?.videos || []) as Array<{ id: string; title: string; status: string }>;
    },
    enabled: !!form.kinescope_project_id && !!kinescopeInstanceId && form.kinescope_mode === "picker",
  });

  // --- Validation ---
  const validationItems = useMemo(() => {
    const items: Array<{ key: string; label: string; ok: boolean; blocker: boolean }> = [
      { key: "title", label: "Название заполнено", ok: !!form.title.trim(), blocker: true },
      { key: "slug", label: "Slug заполнен", ok: !!form.slug.trim(), blocker: true },
      { key: "kinescope", label: "Источник трансляции/записи привязан", ok: !!form.kinescope_video_id.trim(), blocker: true },
      { key: "access", label: "Правила доступа заданы", ok: form.access_rules.filter(r => r.product_id).length > 0, blocker: true },
      { key: "replay", label: "Запись будет доступна", ok: form.replay_enabled, blocker: false },
    ];
    return items;
  }, [form]);

  const blockers = validationItems.filter(i => i.blocker && !i.ok);
  const canPublish = blockers.length === 0;

  // --- Slug uniqueness check ---
  const { data: slugExists } = useQuery({
    queryKey: ["slug-check", form.slug, editingId],
    queryFn: async () => {
      if (!form.slug.trim()) return false;
      let q = supabase.from("live_events").select("id").eq("slug", form.slug.trim()).limit(1);
      if (editingId) q = q.neq("id", editingId);
      const { data } = await q;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!form.slug.trim(),
  });

  // --- Save mutation ---
  const saveMutation = useMutation({
    mutationFn: async (data: LiveEventForm) => {
      if (slugExists) throw new Error("Такой slug уже существует. Выберите другой.");

      const payload: Record<string, any> = {
        slug: data.slug,
        title: data.title,
        description: data.description || null,
        kinescope_video_id: data.kinescope_video_id || null,
        product_id: null,
        access_rule: { mode: "rules", product_id: null, tariff_id: null },
        status: data.status,
        is_published: data.is_published,
        scheduled_at: data.scheduled_at || null,
        replay_enabled: data.replay_enabled,
        invite_mode: data.invite_mode,
        direct_access_allowed: data.direct_access_allowed,
        metadata: {
          kinescope_project_id: data.kinescope_project_id || null,
        },
      };

      let eventId = editingId;

      if (editingId) {
        const { error } = await supabase.from("live_events").update(payload as any).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from("live_events").insert(payload as any).select("id").single();
        if (error) throw error;
        eventId = inserted.id;
      }

      if (eventId) {
        await supabase.from("live_event_access_rules").delete().eq("live_event_id", eventId);
        const validRules = data.access_rules.filter(r => r.product_id);
        const rows: Array<{ live_event_id: string; product_id: string; tariff_id: string | null; sort_order: number }> = [];
        
        validRules.forEach((rule, ruleIdx) => {
          if (rule.tariff_ids.length === 0) {
            rows.push({ live_event_id: eventId!, product_id: rule.product_id, tariff_id: null, sort_order: ruleIdx * 10 });
          } else {
            rule.tariff_ids.forEach((tariffId, tIdx) => {
              rows.push({ live_event_id: eventId!, product_id: rule.product_id, tariff_id: tariffId, sort_order: ruleIdx * 10 + tIdx });
            });
          }
        });

        if (rows.length > 0) {
          const { error: rulesError } = await supabase.from("live_event_access_rules").insert(rows);
          if (rulesError) throw rulesError;
        }
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Эфир обновлён" : "Эфир создан");
      setDialogOpen(false);
      setEditingId(null);
      setForm(defaultForm);
      setSlugManuallyEdited(false);
      setPublishAttempted(false);
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
      queryClient.invalidateQueries({ queryKey: ["live-event-access-rules"] });
    },
    onError: (err) => toast.error("Ошибка: " + (err as Error).message),
  });

  // --- Handlers ---
  const handleTitleChange = (title: string) => {
    const updates: Partial<LiveEventForm> = { title };
    if (!slugManuallyEdited) {
      updates.slug = slugify(title);
    }
    setForm(f => ({ ...f, ...updates }));
  };

  const handleSlugChange = (slug: string) => {
    setSlugManuallyEdited(true);
    setForm(f => ({ ...f, slug }));
  };

  const handleEdit = (event: LiveEvent) => {
    setEditingId(event.id);
    setSlugManuallyEdited(true); // existing event = slug already set
    setPublishAttempted(false);
    setForm({
      slug: event.slug,
      title: event.title,
      description: event.description || "",
      kinescope_video_id: event.kinescope_video_id || "",
      kinescope_mode: event.kinescope_video_id ? "picker" : "picker",
      kinescope_project_id: (event.metadata as any)?.kinescope_project_id || "",
      status: event.status,
      is_published: event.is_published,
      scheduled_at: event.scheduled_at || "",
      replay_enabled: event.replay_enabled,
      invite_mode: (event.invite_mode as "none" | "optional_one_time" | "required_one_time") || "none",
      direct_access_allowed: event.direct_access_allowed ?? true,
      access_rules: [],
    });
    setDialogOpen(true);
  };

  // Sync loaded rules into form when editing
  useMemo(() => {
    if (!existingRules || !editingId) return;
    const grouped = new Map<string, string[]>();
    for (const row of existingRules) {
      const pid = row.product_id;
      if (!grouped.has(pid)) grouped.set(pid, []);
      if (row.tariff_id) grouped.get(pid)!.push(row.tariff_id);
    }
    const accessRules: AccessRuleRow[] = Array.from(grouped.entries()).map(([product_id, tariff_ids]) => ({
      product_id,
      tariff_ids,
    }));
    if (accessRules.length > 0 || form.access_rules.length === 0) {
      setForm(f => ({ ...f, access_rules: accessRules }));
    }
  }, [existingRules, editingId]);

  const handleCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setSlugManuallyEdited(false);
    setPublishAttempted(false);
    setAdvancedOpen(false);
    setDialogOpen(true);
  };

  const handlePublishToggle = (checked: boolean) => {
    if (checked && !canPublish) {
      setPublishAttempted(true);
      return;
    }
    setPublishAttempted(false);
    setForm(f => ({ ...f, is_published: checked }));
  };

  // Kinescope state
  const kinescopeNotConfigured = !kinescopeInstanceLoading && !kinescopeInstance;
  const kinescopeApiError = kinescopeProjectsError || kinescopeVideosError;

  return (
    <AdminLayout>
      <div className="space-y-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Video className="h-5 w-5" />
              Эфиры
            </h2>
            <p className="text-sm text-muted-foreground">Управление видеоэфирами</p>
          </div>
          <Button onClick={handleCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            Создать эфир
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !events?.length ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Нет эфиров. Создайте первый.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Опубликован</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.title}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">/live/{event.slug}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{statusLabels[event.status] || event.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {event.is_published ? (
                          <Badge variant="default">Да</Badge>
                        ) : (
                          <Badge variant="outline">Нет</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {event.scheduled_at
                          ? format(new Date(event.scheduled_at), "dd.MM.yyyy HH:mm", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(event)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(`/live/${event.slug}`, "_blank")}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* --- Create/Edit Dialog --- */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Редактировать эфир" : "Создать эфир"}</DialogTitle>
            </DialogHeader>

            <div className="space-y-6 py-2">
              {/* Section 1: Основное */}
              <FormSection title="Основное">
                <div className="space-y-2">
                  <Label>Название *</Label>
                  <Input value={form.title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Название эфира" />
                </div>
                <div className="space-y-1.5">
                  <Label>Slug</Label>
                  <Input value={form.slug} onChange={(e) => handleSlugChange(e.target.value)} placeholder="my-live-event" />
                  {slugExists && (
                    <p className="text-xs text-destructive">Этот адрес уже занят. Выберите другой.</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Короткий адрес эфира в ссылке. Заполняется автоматически из названия, при необходимости можно изменить вручную.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Описание</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Краткое описание эфира" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Статус</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Черновик</SelectItem>
                        <SelectItem value="scheduled">Запланирован</SelectItem>
                        <SelectItem value="live">В эфире</SelectItem>
                        <SelectItem value="ended">Завершён</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Дата и время эфира</Label>
                    <DateTimePicker
                      date={scheduledDate}
                      time={scheduledTime}
                      onDateChange={handleDateChange}
                      onTimeChange={handleTimeChange}
                    />
                  </div>
                </div>
              </FormSection>

              <Separator />

              {/* Section 2: Kinescope */}
              <FormSection title="Источник трансляции">
                <p className="text-xs text-muted-foreground">
                  Привяжите существующее видео или эфир из аккаунта Kinescope. Автоматическое создание эфира в Kinescope пока не поддерживается.
                </p>

                {kinescopeNotConfigured ? (
                  <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
                    <p className="text-sm text-muted-foreground">Интеграция с Kinescope не настроена</p>
                    <p className="text-xs text-muted-foreground">
                      Используйте ручной ввод Kinescope Video ID в расширенных настройках ниже.
                    </p>
                  </div>
                ) : kinescopeApiError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-1">
                    <p className="text-sm text-destructive font-medium">Не удалось подключиться к Kinescope</p>
                    <p className="text-xs text-muted-foreground">
                      {(kinescopeApiError as Error)?.message || "Проверьте настройки интеграции или используйте ручной ввод Video ID."}
                    </p>
                  </div>
                ) : form.kinescope_mode === "picker" ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Проект</Label>
                      {kinescopeProjectsLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Загрузка проектов...
                        </div>
                      ) : (
                        <Select value={form.kinescope_project_id} onValueChange={(v) => setForm({ ...form, kinescope_project_id: v, kinescope_video_id: "" })}>
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите проект" />
                          </SelectTrigger>
                          <SelectContent>
                            {kinescopeProjects && kinescopeProjects.length > 0 ? (
                              kinescopeProjects.map((p) => (
                                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                              ))
                            ) : (
                              <div className="px-3 py-2 text-sm text-muted-foreground">Нет доступных проектов</div>
                            )}
                          </SelectContent>
                        </Select>
                      )}
                      <p className="text-xs text-muted-foreground">Проект — папка в Kinescope, где хранятся видео</p>
                    </div>

                    {form.kinescope_project_id && (
                      <div className="space-y-1.5">
                        <Label>Видео</Label>
                        {kinescopeVideosLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Загрузка видео...
                          </div>
                        ) : kinescopeVideosError ? (
                          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                            <p className="text-sm text-destructive">Не удалось загрузить видео</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {(kinescopeVideosError as Error)?.message}
                            </p>
                          </div>
                        ) : kinescopeVideos && kinescopeVideos.length === 0 ? (
                          <div className="rounded-lg border border-dashed p-3 text-center">
                            <p className="text-sm text-muted-foreground">В этом проекте нет видео</p>
                          </div>
                        ) : (
                          <Select value={form.kinescope_video_id} onValueChange={(v) => setForm({ ...form, kinescope_video_id: v })}>
                            <SelectTrigger>
                              <SelectValue placeholder="Выберите видео" />
                            </SelectTrigger>
                            <SelectContent>
                              {kinescopeVideos?.map((v) => (
                                <SelectItem key={v.id} value={v.id}>{v.title || v.id}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
                      onClick={() => setForm({ ...form, kinescope_mode: "manual" })}
                    >
                      Ввести Video ID вручную
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="space-y-1.5">
                      <Label>Kinescope Video ID</Label>
                      <Input
                        value={form.kinescope_video_id}
                        onChange={(e) => setForm({ ...form, kinescope_video_id: e.target.value })}
                        placeholder="Вставьте ID из консоли Kinescope"
                      />
                      <p className="text-xs text-muted-foreground">
                        Используйте, если нужно вручную привязать существующий объект Kinescope.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
                      onClick={() => setForm({ ...form, kinescope_mode: "picker" })}
                    >
                      Выбрать из списка
                    </button>
                  </div>
                )}

                {form.kinescope_video_id && (
                  <p className="text-xs text-muted-foreground">
                    Привязано: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{form.kinescope_video_id}</code>
                  </p>
                )}
              </FormSection>

              <Separator />

              {/* Section 3: Access rules */}
              <FormSection>
                <LiveEventAccessRulesEditor
                  rules={form.access_rules}
                  onChange={(rules) => setForm({ ...form, access_rules: rules })}
                />
              </FormSection>

              <Separator />

              {/* Section 4: Invite mode */}
              <FormSection title="Приглашения">
                <Select
                  value={form.invite_mode}
                  onValueChange={(v) => {
                    const newMode = v as "none" | "optional_one_time" | "required_one_time";
                    const newDirect = newMode === "required_one_time" ? false : form.direct_access_allowed;
                    setForm({ ...form, invite_mode: newMode, direct_access_allowed: newDirect });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(inviteModeLabels).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {inviteModeLabels[form.invite_mode]?.description}
                </p>
                {form.invite_mode === "optional_one_time" && (
                  <SwitchRow
                    checked={form.direct_access_allowed}
                    onCheckedChange={(v) => setForm({ ...form, direct_access_allowed: v })}
                    label="Разрешить прямой доступ без ссылки"
                  />
                )}
              </FormSection>

              <Separator />

              {/* Section 5: Publication & Recording */}
              <FormSection title="Публикация и запись">
                <SwitchRow
                  checked={form.is_published}
                  onCheckedChange={handlePublishToggle}
                  label="Опубликован"
                  description="Эфир виден системе и доступен по ссылке"
                  error={publishAttempted && !canPublish}
                />
                <SwitchRow
                  checked={form.replay_enabled}
                  onCheckedChange={(v) => setForm({ ...form, replay_enabled: v })}
                  label="Разрешить доступ к записи после завершения"
                  description={
                    form.replay_enabled && form.status !== "ended"
                      ? "Запись станет доступна пользователям только после завершения эфира"
                      : "Пользователи смогут посмотреть запись после завершения эфира"
                  }
                />
              </FormSection>

              <Separator />

              {/* Section 6: Readiness checklist */}
              <FormSection title="Проверка готовности">
                <div className={`rounded-lg border p-3 space-y-1.5 ${publishAttempted && blockers.length > 0 ? "border-destructive/50 bg-destructive/5" : "bg-muted/20"}`}>
                  {validationItems.map((item) => (
                    <CheckItem
                      key={item.key}
                      ok={item.ok}
                      label={item.label}
                      blocker={item.blocker}
                      highlight={publishAttempted && item.blocker && !item.ok}
                    />
                  ))}
                </div>
                {publishAttempted && blockers.length > 0 && (
                  <p className="text-xs text-destructive">
                    Публикация невозможна: заполните обязательные поля выше
                  </p>
                )}
              </FormSection>

              {/* Advanced settings */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown className={`h-3 w-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                  Расширенные настройки
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Kinescope Video ID (ручной override)</Label>
                    <Input
                      value={form.kinescope_video_id}
                      onChange={(e) => setForm({ ...form, kinescope_video_id: e.target.value })}
                      className="text-xs"
                      placeholder="video-id"
                    />
                    <p className="text-xs text-muted-foreground">
                      Используйте только если нужно вручную привязать существующий объект Kinescope.
                    </p>
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <h4 className="text-xs font-medium mb-1">Для ведущего</h4>
                    <p className="text-xs text-muted-foreground">
                      Ведущий управляет эфиром через консоль Kinescope. Автоматизация host-доступа через API не поддерживается в текущей версии.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Summary block */}
              <div className="rounded-lg border bg-muted/20 p-4 space-y-2.5">
                <h4 className="text-xs font-semibold text-foreground">Как это работает для пользователя</h4>
                <div className="space-y-2">
                  <SummaryItem icon={Users} label="Кто войдёт">
                    {form.access_rules.filter(r => r.product_id).length > 0
                      ? `${form.access_rules.filter(r => r.product_id).length} правил(а) доступа`
                      : "Не задано"}
                  </SummaryItem>
                  <SummaryItem icon={Link2} label="Нужен invite">
                    {form.invite_mode === "required_one_time" ? "Да, только по ссылке" : form.invite_mode === "optional_one_time" ? "Опционально" : "Нет"}
                  </SummaryItem>
                  <SummaryItem icon={PlayCircle} label="Запись">
                    {form.replay_enabled ? "Будет доступна после завершения" : "Не предусмотрена"}
                  </SummaryItem>
                  <SummaryItem icon={Shield} label="Публикация">
                    {form.is_published ? "Опубликован" : canPublish ? "Готов к публикации" : "Не готов"}
                  </SummaryItem>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={(!form.title.trim() || !form.slug.trim() || !!slugExists) || saveMutation.isPending}
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {editingId ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}

// --- Sub-components ---

function FormSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      {title && <h3 className="text-sm font-semibold text-foreground/80">{title}</h3>}
      {children}
    </section>
  );
}

function SwitchRow({
  checked,
  onCheckedChange,
  label,
  description,
  error,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  description?: string;
  error?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${error ? "bg-destructive/5 border border-destructive/30" : "bg-muted/20"}`}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />
      <div className="space-y-0.5">
        <Label className="text-sm cursor-pointer" onClick={() => onCheckedChange(!checked)}>{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

function CheckItem({ ok, label, blocker, highlight }: { ok: boolean; label: string; blocker: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
      ) : (
        <AlertCircle className={`h-3.5 w-3.5 shrink-0 ${highlight ? "text-destructive" : "text-muted-foreground"}`} />
      )}
      <span className={ok ? "text-foreground" : highlight ? "text-destructive" : "text-muted-foreground"}>
        {label}
        {!blocker && !ok && " (рекомендация)"}
      </span>
    </div>
  );
}

function SummaryItem({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div>
        <span className="text-muted-foreground">{label}: </span>
        <span className="text-foreground">{children}</span>
      </div>
    </div>
  );
}
