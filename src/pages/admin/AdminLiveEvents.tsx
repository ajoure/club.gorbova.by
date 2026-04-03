import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Plus, Edit2, Loader2, Video, ExternalLink, ChevronDown, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
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

  // Load access rules for the editing event
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

  // Kinescope integration instance
  const { data: kinescopeInstance } = useQuery({
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
  const { data: kinescopeProjects, isLoading: kinescopeProjectsLoading } = useQuery({
    queryKey: ["kinescope-projects", kinescopeInstanceId],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke("kinescope-api", {
        body: { action: "list_projects", instance_id: kinescopeInstanceId },
      });
      return (data?.projects || []) as Array<{ id: string; name: string }>;
    },
    enabled: !!kinescopeInstanceId,
  });

  // Kinescope videos for selected project
  const { data: kinescopeVideos, isLoading: kinescopeVideosLoading } = useQuery({
    queryKey: ["kinescope-videos", form.kinescope_project_id, kinescopeInstanceId],
    queryFn: async () => {
      const { data } = await supabase.functions.invoke("kinescope-api", {
        body: { action: "list_videos", project_id: form.kinescope_project_id, instance_id: kinescopeInstanceId },
      });
      return (data?.videos || []) as Array<{ id: string; title: string; status: string }>;
    },
    enabled: !!form.kinescope_project_id && !!kinescopeInstanceId && form.kinescope_mode === "picker",
  });

  // --- Pre-publish validation ---
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!form.title.trim()) errors.push("Название не заполнено");
    if (!form.slug.trim()) errors.push("Slug не заполнен");
    if (!form.kinescope_video_id.trim()) errors.push("Kinescope Video ID не задан");
    if (form.access_rules.filter(r => r.product_id).length === 0) errors.push("Правила доступа не заданы");
    return errors;
  }, [form]);

  const canPublish = validationErrors.length === 0;

  // --- Save mutation ---
  const saveMutation = useMutation({
    mutationFn: async (data: LiveEventForm) => {
      const payload: Record<string, any> = {
        slug: data.slug,
        title: data.title,
        description: data.description || null,
        kinescope_video_id: data.kinescope_video_id || null,
        product_id: null, // legacy — no longer primary
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

      // Sync access rules
      if (eventId) {
        // Delete old rules
        await supabase.from("live_event_access_rules").delete().eq("live_event_id", eventId);

        // Insert new rules
        const validRules = data.access_rules.filter(r => r.product_id);
        const rows: Array<{ live_event_id: string; product_id: string; tariff_id: string | null; sort_order: number }> = [];
        
        validRules.forEach((rule, ruleIdx) => {
          if (rule.tariff_ids.length === 0) {
            // All tariffs — single row with null tariff
            rows.push({
              live_event_id: eventId!,
              product_id: rule.product_id,
              tariff_id: null,
              sort_order: ruleIdx * 10,
            });
          } else {
            // Specific tariffs — one row per tariff
            rule.tariff_ids.forEach((tariffId, tIdx) => {
              rows.push({
                live_event_id: eventId!,
                product_id: rule.product_id,
                tariff_id: tariffId,
                sort_order: ruleIdx * 10 + tIdx,
              });
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
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
      queryClient.invalidateQueries({ queryKey: ["live-event-access-rules"] });
    },
    onError: (err) => toast.error("Ошибка: " + (err as Error).message),
  });

  // --- Handlers ---
  const handleEdit = (event: LiveEvent) => {
    setEditingId(event.id);
    // Will load rules via useQuery
    setForm({
      slug: event.slug,
      title: event.title,
      description: event.description || "",
      kinescope_video_id: event.kinescope_video_id || "",
      kinescope_mode: "picker",
      kinescope_project_id: (event.metadata as any)?.kinescope_project_id || "",
      status: event.status,
      is_published: event.is_published,
      scheduled_at: event.scheduled_at || "",
      replay_enabled: event.replay_enabled,
      invite_mode: (event.invite_mode as "none" | "optional_one_time" | "required_one_time") || "none",
      direct_access_allowed: event.direct_access_allowed ?? true,
      access_rules: [], // loaded below via effect
    });
    setDialogOpen(true);
  };

  // Sync loaded rules into form when editing
  const rulesLoaded = existingRules && editingId;
  useMemo(() => {
    if (!rulesLoaded || !existingRules) return;
    // Group by product_id
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
    setAdvancedOpen(false);
    setDialogOpen(true);
  };

  const handlePublishToggle = (checked: boolean) => {
    if (checked && !canPublish) {
      toast.error("Невозможно опубликовать: " + validationErrors[0]);
      return;
    }
    setForm({ ...form, is_published: checked });
  };

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
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground/80">Основное</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Название *</Label>
                    <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug *</Label>
                    <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="my-live-event" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Описание</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
                    <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
                  </div>
                </div>
              </section>

              <Separator />

              {/* Section 2: Kinescope */}
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground/80">Kinescope</h3>
                
                {form.kinescope_mode === "picker" ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Проект Kinescope</Label>
                      <Select value={form.kinescope_project_id} onValueChange={(v) => setForm({ ...form, kinescope_project_id: v, kinescope_video_id: "" })}>
                        <SelectTrigger>
                          <SelectValue placeholder={kinescopeProjectsLoading ? "Загрузка..." : "Выберите проект"} />
                        </SelectTrigger>
                        <SelectContent>
                          {kinescopeProjects?.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {form.kinescope_project_id && (
                      <div className="space-y-2">
                        <Label>Видео</Label>
                        <Select value={form.kinescope_video_id} onValueChange={(v) => setForm({ ...form, kinescope_video_id: v })}>
                          <SelectTrigger>
                            <SelectValue placeholder={kinescopeVideosLoading ? "Загрузка..." : "Выберите видео"} />
                          </SelectTrigger>
                          <SelectContent>
                            {kinescopeVideos?.map((v) => (
                              <SelectItem key={v.id} value={v.id}>{v.title || v.id}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => setForm({ ...form, kinescope_mode: "manual" })}
                    >
                      Ввести Video ID вручную
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Kinescope Video ID</Label>
                      <Input
                        value={form.kinescope_video_id}
                        onChange={(e) => setForm({ ...form, kinescope_video_id: e.target.value })}
                        placeholder="video-id-from-kinescope"
                      />
                    </div>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => setForm({ ...form, kinescope_mode: "picker" })}
                    >
                      Выбрать из списка
                    </button>
                  </div>
                )}

                {form.kinescope_video_id && (
                  <p className="text-xs text-muted-foreground">
                    Video ID: <code className="bg-muted px-1 rounded">{form.kinescope_video_id}</code>
                  </p>
                )}
              </section>

              <Separator />

              {/* Section 3: Access rules */}
              <section>
                <LiveEventAccessRulesEditor
                  rules={form.access_rules}
                  onChange={(rules) => setForm({ ...form, access_rules: rules })}
                />
              </section>

              <Separator />

              {/* Section 4: Invite mode */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground/80">Приглашения</h3>
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
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.direct_access_allowed}
                      onCheckedChange={(v) => setForm({ ...form, direct_access_allowed: v })}
                    />
                    <Label className="text-sm">Разрешить прямой доступ без ссылки</Label>
                  </div>
                )}
              </section>

              <Separator />

              {/* Section 5: Publication & Recording */}
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground/80">Публикация и запись</h3>
                <TooltipProvider>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.is_published}
                        onCheckedChange={handlePublishToggle}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Label className="cursor-help flex items-center gap-1">
                            Опубликован
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </Label>
                        </TooltipTrigger>
                        <TooltipContent>Эфир виден системе и доступен по ссылке</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={form.replay_enabled}
                        onCheckedChange={(v) => setForm({ ...form, replay_enabled: v })}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Label className="cursor-help flex items-center gap-1">
                            Разрешить запись
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </Label>
                        </TooltipTrigger>
                        <TooltipContent>После завершения эфира пользователи смогут смотреть запись</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </TooltipProvider>
                {form.replay_enabled && form.status !== "ended" && (
                  <p className="text-xs text-muted-foreground">
                    Запись станет доступна пользователям только после завершения эфира
                  </p>
                )}
              </section>

              <Separator />

              {/* Section 6: Readiness checklist */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground/80">Проверка готовности</h3>
                <div className="space-y-1.5">
                  <CheckItem ok={!!form.title.trim()} label="Название заполнено" />
                  <CheckItem ok={!!form.slug.trim()} label="Slug заполнен" />
                  <CheckItem ok={!!form.kinescope_video_id.trim()} label="Kinescope Video ID задан" />
                  <CheckItem ok={form.access_rules.filter(r => r.product_id).length > 0} label="Правила доступа заданы" />
                </div>
                {!canPublish && form.is_published && (
                  <p className="text-xs text-destructive">
                    Публикация невозможна без выполнения всех условий
                  </p>
                )}
              </section>

              {/* Advanced settings */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronDown className={`h-3 w-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
                  Расширенные настройки
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Kinescope Video ID (ручной override)</Label>
                    <Input
                      value={form.kinescope_video_id}
                      onChange={(e) => setForm({ ...form, kinescope_video_id: e.target.value })}
                      className="text-xs"
                      placeholder="video-id"
                    />
                  </div>
                  <div className="rounded-lg border p-3 bg-muted/30">
                    <h4 className="text-xs font-medium mb-1">Для ведущего</h4>
                    <p className="text-xs text-muted-foreground">
                      Преподаватель/ведущий управляет эфиром через консоль Kinescope (dashboard.kinescope.io).
                      Автоматизация host-доступа через API не поддерживается в текущей версии.
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Summary block */}
              <Card className="bg-muted/30">
                <CardContent className="py-3 space-y-1.5">
                  <h4 className="text-xs font-semibold">Как это работает для пользователя</h4>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>
                      Доступ: {form.access_rules.filter(r => r.product_id).length > 0
                        ? `${form.access_rules.filter(r => r.product_id).length} правил(а) доступа`
                        : "не задан"}
                    </p>
                    <p>
                      Приглашения: {inviteModeLabels[form.invite_mode]?.label || form.invite_mode}
                    </p>
                    <p>
                      Запись: {form.replay_enabled ? "будет доступна после завершения" : "не предусмотрена"}
                    </p>
                    <p>
                      Вход: {form.invite_mode === "required_one_time"
                        ? "только по персональной ссылке"
                        : "напрямую по правам аккаунта"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={(!form.title.trim() || !form.slug.trim()) || saveMutation.isPending}
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

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
      ) : (
        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
      )}
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
