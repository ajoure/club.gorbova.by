import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LIFECYCLE_BUTTON_BASE, LIFECYCLE_BUTTON_TONES, LIFECYCLE_BUTTON_WIDTH_MIN, LIFECYCLE_BUTTON_WIDTH_ICON } from "@/components/live/lifecycleButtonStyles";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { Plus, Edit2, Loader2, Video, ExternalLink, ChevronDown, AlertCircle, CheckCircle2, Users, Link2, PlayCircle, Shield, Radio, Zap, Square, RefreshCw, Send, Copy, Eye, EyeOff, MessageSquare, HelpCircle, Unlink, RotateCcw, AlertTriangle, LayoutGrid, Monitor, ShoppingCart, Trash2, MoreHorizontal, Settings, Image as ImageIcon, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BulkActionsBar } from "@/components/admin/BulkActionsBar";
import { LiveEventDeleteDialog } from "@/components/admin/live/LiveEventDeleteDialog";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { slugify } from "@/utils/slugify";
import { LiveEventAccessRulesEditor, type AccessRuleRow } from "@/components/admin/live/LiveEventAccessRulesEditor";
import { LiveEventComments } from "@/components/live/LiveEventComments";
import { LiveEventQuestions } from "@/components/live/LiveEventQuestions";
import { LiveEventModerationPanel } from "@/components/live/LiveEventModeration";
import { LiveEventScenario } from "@/components/live/LiveEventScenario";
import { LiveEventRoomBlocksEditor } from "@/components/admin/live/LiveEventRoomBlocksEditor";
import { LiveEventProductCtaBindings } from "@/components/admin/live/LiveEventProductCtaBindings";
import { LiveEventCtaRuntimePanel } from "@/components/admin/live/LiveEventCtaRuntimePanel";
import { LiveEventThemeEditor } from "@/components/admin/live/LiveEventThemeEditor";
import { WebinarRoomSettingsCard } from "@/components/admin/live/WebinarRoomSettingsCard";
import { DomainEventService } from "@/lib/domain-events";
import { LiveEventsHelpDialog } from "@/components/admin/live/LiveEventsHelpDialog";
import { LiveEventExportButtons } from "@/components/live/LiveEventExportButtons";
import { RoomLifecycleActions } from "@/components/live/RoomLifecycleActions";
import { useActiveParticipants } from "@/hooks/useActiveParticipants";
import { parseRoomState, getRoomStateBadgeVM, type RoomState } from "@/lib/liveRoomLifecycle";
import { ColumnSettings } from "@/components/admin/ColumnSettings";
import { LiveEventsTable } from "@/components/admin/live/LiveEventsTable";
import { useLiveEventsColumns, LIVE_EVENTS_LOCKED_KEYS } from "@/hooks/useLiveEventsColumns";
import { AutowebModeEditor, type AutowebUserMode as AutowebUserModeT, type AutowebConfig } from "@/components/admin/live/AutowebModeEditor";

// Final follow-up sprint PATCH F3: отдельная компактная ячейка count активных участников
function ActiveParticipantsCell({ eventId }: { eventId: string }) {
  const { data } = useActiveParticipants(eventId, true);
  return (
    <span className="text-sm tabular-nums" title="Активные участники за последние 2 минуты">
      {typeof data === "number" ? data : "—"}
    </span>
  );
}

type EventType = "live_stream" | "recorded_webinar" | "autowebinar";
type AutowebUserMode = "one_time" | "scheduled" | "just_in_time" | "on_demand";
type SourceKind = "kinescope_live_event" | "kinescope_video";

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
  event_type: EventType;
  source_kind: SourceKind;
  event_timezone: string;
  platform_status: string;
  kinescope_live_event_id: string | null;
  kinescope_project_id: string | null;
  kinescope_stream_id: string | null;
  // Sprint 2: room lifecycle (independent SoT)
  room_state?: "closed" | "opened" | "live" | "completed" | null;
  room_opened_at?: string | null;
  live_started_at?: string | null;
  webinar_completed_at?: string | null;
}

interface NotificationOffset {
  minutes: number;
  enabled: boolean;
  label: string;
}

interface LiveEventForm {
  slug: string;
  title: string;
  description: string;
  kinescope_video_id: string;
  kinescope_mode: "picker" | "manual";
  kinescope_project_id: string;
  kinescope_folder_id: string; // live folder for live events
  status: string;
  is_published: boolean;
  scheduled_at: string;
  replay_enabled: boolean;
  invite_mode: "none" | "optional_one_time" | "required_one_time";
  direct_access_allowed: boolean;
  access_rules: AccessRuleRow[];
  event_type: EventType;
  event_timezone: string;
  kinescope_live_event_id: string;
  content_month: string | null;
  /** Transient provider data from create — persisted on save for new events */
  _providerDraft?: {
    live_event_id: string;
    stream_id?: string;
    play_link?: string;
    rtmp_link?: string;
    streamkey?: string;
    stream_status?: string;
    raw_create_response?: any;
  } | null;
  notification_enabled: boolean;
  notification_template_id: string;
  notification_channels: string[];
  notification_offsets: NotificationOffset[];
  // Sprint A — autowebinar
  autoweb_user_mode: AutowebUserMode;
  autoweb_config: AutowebConfig;
}

const defaultForm: LiveEventForm = {
  slug: "",
  title: "",
  description: "",
  kinescope_video_id: "",
  kinescope_mode: "picker",
  kinescope_project_id: "",
  kinescope_folder_id: "",
  status: "draft",
  is_published: false,
  scheduled_at: "",
  replay_enabled: false,
  invite_mode: "none",
  direct_access_allowed: true,
  access_rules: [],
  event_type: "recorded_webinar",
  event_timezone: "Europe/Minsk",
  kinescope_live_event_id: "",
  content_month: null,
  _providerDraft: null,
  notification_enabled: false,
  notification_template_id: "",
  notification_channels: ["telegram"],
  notification_offsets: [
    { minutes: 1440, enabled: true, label: "За 1 день" },
    { minutes: 60, enabled: true, label: "За 1 час" },
  ],
  autoweb_user_mode: "one_time",
  autoweb_config: {
    just_in_time: { offsets_minutes: [5, 10, 15, 30], show_countdown: true },
    on_demand: { min_delay_seconds: 0 },
    replay: {
      enabled: true,
      open_strategy: "immediate",
      delay_minutes: 0,
      window_hours: 48,
      show_chat_history: false,
      cta_strategy: "same_as_live",
    },
    viewer_controls: {
      allow_pause: true,
      allow_seek: false,
      allow_speed_control: false,
      resume_from_last_position: true,
      allow_rewatch_before_end: false,
    },
  },
};

const platformStatusLabels: Record<string, string> = {
  draft: "Черновик",
  scheduled: "Запланирован",
  live: "В эфире",
  ended: "Завершён",
  replay_available: "Запись доступна",
  archived: "Архив",
};

const eventTypeLabels: Record<string, string> = {
  live_stream: "Живой эфир",
  recorded_webinar: "Видео / Автовебинар",
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
  // Tabs state — controlled, reset on dialog open
  const [activeTab, setActiveTab] = useState<string>("basic");
  const [extrasTab, setExtrasTab] = useState<string>("room");
  useEffect(() => {
    if (dialogOpen) {
      setActiveTab("basic");
      setExtrasTab("room");
    }
  }, [dialogOpen, editingId]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [publishAttempted, setPublishAttempted] = useState(false);
  const [creatingLiveEvent, setCreatingLiveEvent] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Final follow-up sprint PATCH F4/F5: bulk selection + delete dialog
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  // PATCH F-CANON: shared canonical column state (resize / reorder / hide-show + persist)
  const { columns, setColumns } = useLiveEventsColumns();

  const isLiveStream = form.event_type === "live_stream";

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
    const existingTime = scheduledTime || "00:00";
    const [h, m] = existingTime.split(":").map(Number);
    const combined = new Date(date);
    combined.setHours(h, m, 0, 0);
    setForm(f => ({ ...f, scheduled_at: combined.toISOString() }));
  }, [scheduledTime]);

  const handleTimeChange = useCallback((time: string) => {
    if (!scheduledDate) return;
    if (!time) {
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
        .select("product_id, tariff_id, sort_order, conditions")
        .eq("live_event_id", editingId)
        .order("sort_order");
      return data || [];
    },
    enabled: !!editingId,
  });

  // Kinescope integration instance
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

  // Kinescope videos for selected project (only for recorded_webinar)
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
    enabled: !!form.kinescope_project_id && !!kinescopeInstanceId && form.kinescope_mode === "picker" && !isLiveStream,
  });

  // Kinescope live folders (for live_stream)
  const { data: kinescopeLiveFolders, isLoading: kinescopeLiveFoldersLoading } = useQuery({
    queryKey: ["kinescope-live-folders", kinescopeInstanceId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: { action: "list_live_folders", instance_id: kinescopeInstanceId },
      });
      if (error) throw error;
      if (!data?.success) return [];
      const folders = (data?.data as any)?.folders || (data?.data as any)?.data || [];
      return folders as Array<{ id: string; name: string }>;
    },
    enabled: !!kinescopeInstanceId && isLiveStream,
  });

  // Broadcast templates for notification picker
  const { data: broadcastTemplates } = useQuery({
    queryKey: ["broadcast-templates-for-notifications"],
    queryFn: async () => {
      const { data } = await supabase
        .from("broadcast_templates")
        .select("id, name, template_type, channel, message_text, email_subject, email_body_html")
        .in("template_type", ["webinar_invite", "general"])
        .order("name");
      return data || [];
    },
    enabled: dialogOpen,
  });


  const validationItems = useMemo(() => {
    const items: Array<{ key: string; label: string; ok: boolean; blocker: boolean }> = [
      { key: "title", label: "Название заполнено", ok: !!form.title.trim(), blocker: true },
      { key: "slug", label: "Slug заполнен", ok: !!form.slug.trim(), blocker: true },
    ];

    if (isLiveStream) {
      items.push(
        { key: "kinescope", label: "Живой эфир создан в Kinescope", ok: !!form.kinescope_live_event_id.trim(), blocker: true },
        { key: "scheduled", label: "Дата и время эфира заданы", ok: !!form.scheduled_at, blocker: true },
      );
      // Check provider_source_status from metadata for live_stream
      const currentEvent = events?.find(e => e.id === editingId);
      const providerStatus = (currentEvent?.metadata as any)?.provider_source_status;
      if (providerStatus === "missing" || providerStatus === "broken") {
        items.push({
          key: "provider_source",
          label: "Источник трансляции недоступен",
          ok: false,
          blocker: true,
        });
      }
    } else {
      items.push(
        { key: "kinescope", label: "Источник видео привязан", ok: !!form.kinescope_video_id.trim(), blocker: true },
      );

      // PATCH-1 (Sprint A → B): валидация конфигурации режима автовебинара.
      const mode = form.autoweb_user_mode;
      if (mode === "one_time") {
        items.push({
          key: "autoweb_one_time_date",
          label: "Дата и время разового показа заданы",
          ok: !!form.scheduled_at,
          blocker: true,
        });
      } else if (mode === "scheduled") {
        const sched = form.autoweb_config?.schedule ?? {};
        const wd = (sched.weekdays ?? []).length;
        const tm = (sched.times ?? []).length;
        const rrules = (sched.rrules ?? []).length;
        items.push(
          { key: "autoweb_sched_weekday", label: "Выбран хотя бы 1 день недели", ok: wd > 0, blocker: true },
          { key: "autoweb_sched_time", label: "Указано хотя бы 1 время запуска", ok: tm > 0, blocker: true },
          { key: "autoweb_sched_rrules", label: "Расписание сгенерировано", ok: rrules > 0, blocker: true },
        );
      } else if (mode === "just_in_time") {
        const offsets = (form.autoweb_config?.just_in_time?.offsets_minutes ?? []).length;
        items.push({
          key: "autoweb_jit_offsets",
          label: "Выбран хотя бы 1 офсет «через N минут»",
          ok: offsets > 0,
          blocker: true,
        });
      } else if (mode === "on_demand") {
        const delay = form.autoweb_config?.on_demand?.min_delay_seconds ?? 0;
        items.push({
          key: "autoweb_on_demand_delay",
          label: "Задержка перед стартом валидна (0–120 сек)",
          ok: Number.isFinite(delay) && delay >= 0 && delay <= 120,
          blocker: true,
        });
      }
    }

    items.push(
      { key: "access", label: "Указано, кто может войти на эфир", ok: form.access_rules.filter(r => r.product_id).length > 0, blocker: true },
      { key: "replay", label: "Запись будет доступна после завершения", ok: form.replay_enabled, blocker: false },
    );

    // 6E. Notification readiness blockers
    if (form.notification_enabled) {
      items.push(
        { key: "notif_template", label: "Выбран шаблон уведомления", ok: !!form.notification_template_id, blocker: true },
        { key: "notif_channels", label: "Выбран хотя бы один канал", ok: form.notification_channels.length > 0, blocker: true },
        { key: "notif_offsets", label: "Включён хотя бы один срок уведомления", ok: form.notification_offsets.some(o => o.enabled), blocker: true },
        { key: "notif_scheduled", label: "Задано время начала эфира", ok: !!form.scheduled_at, blocker: true },
      );
      // Template/channel compatibility — same logic as in cron (6D)
      const selectedTemplate = broadcastTemplates?.find(t => t.id === form.notification_template_id);
      if (selectedTemplate && form.notification_channels.includes('telegram') && !selectedTemplate.message_text) {
        items.push({ key: "notif_tg_compat", label: "Шаблон не содержит текст для Telegram", ok: false, blocker: true });
      }
      if (selectedTemplate && form.notification_channels.includes('email') && (!selectedTemplate.email_subject || !selectedTemplate.email_body_html)) {
        items.push({ key: "notif_email_compat", label: "Шаблон не содержит тему или текст для Email", ok: false, blocker: true });
      }
    }

    return items;
  }, [form, isLiveStream, events, editingId]);

  const blockers = validationItems.filter(i => i.blocker && !i.ok);
  const canPublish = blockers.length === 0;

  // Invite readiness
  const isInviteReady = useMemo(() => {
    if (!form.is_published) return false;
    if (isLiveStream) return !!form.scheduled_at;
    return true;
  }, [form.is_published, form.scheduled_at, isLiveStream]);

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

  // --- Create live event in Kinescope ---
  const handleCreateKinescopeLiveEvent = async () => {
    if (!form.kinescope_folder_id || !kinescopeInstanceId) {
      toast.error("Выберите папку для живых эфиров");
      return;
    }
    setCreatingLiveEvent(true);
    try {
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: {
          action: "create_live_event",
          instance_id: kinescopeInstanceId,
          folder_id: form.kinescope_folder_id,
          project_id: form.kinescope_project_id || undefined,
          name: form.title || "Новый эфир",
        },
      });

      if (error) {
        const msg = typeof error === "object" && error.message ? error.message : String(error);
        toast.error(`Ошибка вызова: ${msg}`);
        return;
      }
      
      if (!data?.success) {
        const errorMsg = data?.error || "Неизвестная ошибка Kinescope";
        toast.error(`Не удалось создать эфир: ${errorMsg}`, {
          description: data?.status_code ? `Код ответа: ${data.status_code}` : undefined,
          duration: 8000,
        });
        console.error("[AdminLiveEvents] create_live_event failed:", JSON.stringify(data));
        return;
      }
      
      // Extract event data from response
      const eventData = (data.data as any)?.data || data.data;
      const eventId = eventData?.id;
      const streamId = eventData?.stream?.id;
      const playLink = eventData?.play_link;
      const rtmpLink = eventData?.rtmp_link;
      const streamkey = eventData?.streamkey;
      const streamStatus = eventData?.stream?.status;
      
      if (eventId) {
        // Store provider draft in form state for new events (persisted on save)
        const providerDraftData = {
          live_event_id: eventId,
          stream_id: streamId,
          play_link: playLink,
          rtmp_link: rtmpLink,
          streamkey: streamkey,
          stream_status: streamStatus,
          raw_create_response: eventData,
        };
        setForm(f => ({ ...f, kinescope_live_event_id: eventId, _providerDraft: providerDraftData }));
        
        // If editing, save provider data to DB immediately with metadata merge
        if (editingId) {
          const { data: current } = await supabase.from("live_events").select("metadata").eq("id", editingId).single();
          const existingMeta = (current?.metadata as Record<string, any>) || {};
          const mergedMeta = {
            ...existingMeta,
            kinescope_project_id: form.kinescope_project_id || existingMeta.kinescope_project_id,
            kinescope_folder_id: form.kinescope_folder_id,
            provider: {
              ...(existingMeta.provider || {}),
              current: {
                live_event_id: eventId,
                stream_id: streamId,
                play_link: playLink,
                rtmp_link: rtmpLink,
                streamkey: streamkey,
                stream_status: streamStatus,
                raw_create_response: eventData,
              },
            },
            provider_source_status: "ok",
            last_provider_sync_at: new Date().toISOString(),
          };
          await supabase.from("live_events").update({
            kinescope_live_event_id: eventId,
            kinescope_stream_id: streamId || null,
            metadata: mergedMeta,
          } as any).eq("id", editingId);
        }
        
        toast.success("Эфир создан в Kinescope", {
          description: `ID: ${eventId}`,
        });
        queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
      } else {
        toast.warning("Эфир создан, но ID не получен. Проверьте консоль.");
        console.warn("[AdminLiveEvents] create_live_event — no ID in response:", data);
      }
    } catch (err: any) {
      const msg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
      toast.error(`Ошибка создания эфира: ${msg}`);
      console.error("[AdminLiveEvents] create_live_event exception:", err);
    } finally {
      setCreatingLiveEvent(false);
    }
  };

  // --- Admin lifecycle actions ---
  const handleLifecycleAction = async (eventId: string, action: "enable_live_event" | "complete_live_event" | "sync_live_event", liveEventId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: { action, instance_id: kinescopeInstanceId, live_event_id: liveEventId },
      });
      
      if (error) {
        const msg = typeof error === "object" && error.message ? error.message : String(error);
        toast.error(`Ошибка вызова: ${msg}`);
        return;
      }
      
      if (!data?.success) {
        toast.error(data?.error || "Kinescope вернул ошибку", {
          description: data?.status_code ? `Код: ${data.status_code}` : undefined,
          duration: 6000,
        });
        console.error(`[AdminLiveEvents] ${action} failed:`, data);
        return;
      }
      
      // Update platform_status based on action
      let newStatus: string | null = null;
      if (action === "enable_live_event") newStatus = "live";
      else if (action === "complete_live_event") newStatus = "ended";

      if (newStatus) {
        await supabase.from("live_events").update({ platform_status: newStatus, status: newStatus } as any).eq("id", eventId);
      }

      toast.success(action === "enable_live_event" ? "Эфир запущен" : action === "complete_live_event" ? "Эфир завершён" : "Статус обновлён");
      // Полная инвалидация всех derived источников: список + provider-карточка + access rules.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-live-events"] }),
        queryClient.invalidateQueries({ queryKey: ["live-event-provider", eventId] }),
        queryClient.invalidateQueries({ queryKey: ["live-event-provider"] }),
      ]);
    } catch (err: any) {
      const msg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
      toast.error(`Ошибка: ${msg}`);
      console.error(`[AdminLiveEvents] ${action} exception:`, err);
    }
  };

  // --- Save mutation ---
  const saveMutation = useMutation({
    mutationFn: async (data: LiveEventForm) => {
      if (slugExists) throw new Error("Такой slug уже существует. Выберите другой.");

      // sourceKind вычисляется ниже в зависимости от effectiveEventType (Sprint A patch).

      // Merge metadata: preserve existing provider data
      let mergedMetadata: Record<string, any> = {
        kinescope_project_id: data.kinescope_project_id || null,
        kinescope_folder_id: data.kinescope_folder_id || null,
      };
      
      if (editingId) {
        const { data: current } = await supabase.from("live_events").select("metadata").eq("id", editingId).single();
        const existingMeta = (current?.metadata as Record<string, any>) || {};
        mergedMetadata = {
          ...existingMeta,
          ...mergedMetadata,
        };
      } else if (data._providerDraft && data.kinescope_live_event_id) {
        // New event with already-created Kinescope source — include full provider.current
        mergedMetadata.provider = {
          current: {
            live_event_id: data._providerDraft.live_event_id,
            stream_id: data._providerDraft.stream_id,
            play_link: data._providerDraft.play_link,
            rtmp_link: data._providerDraft.rtmp_link,
            streamkey: data._providerDraft.streamkey,
            stream_status: data._providerDraft.stream_status,
            raw_create_response: data._providerDraft.raw_create_response,
          },
        };
        mergedMetadata.provider_source_status = "ok";
        mergedMetadata.provider_error_message = null;
        mergedMetadata.provider_status_code = 200;
        mergedMetadata.last_provider_sync_at = new Date().toISOString();
      }

      // Always persist notification_settings
      mergedMetadata.notification_settings = {
        enabled: data.notification_enabled,
        template_id: data.notification_template_id || null,
        channels: data.notification_channels,
        offsets: data.notification_offsets,
      };


      // SURGICAL HARDENING (live-bugfix): never write platform_status/status from form save.
      // Lifecycle (draft → scheduled → live → ended → replay_available) is owned exclusively
      // by lifecycle actions (handleLifecycleAction) and provider sync. Form save MUST NOT
      // downgrade an active 'live' status back to whatever stale value sits in form state.
      // Initial 'status' is set only on INSERT (new event creation).
      // Sprint A — autowebinar mapping:
      //   one_time     → event_type='recorded_webinar' (NO autoweb_mode), без дублей
      //   scheduled/JIT/on_demand → event_type='autowebinar' + autoweb_mode
      // Один источник истины: пользователь выбирает 4 режима в UI, БД хранит 2 типа.
      let effectiveEventType: EventType = data.event_type;
      let autowebMode: AutowebUserMode | null = null;
      if (data.event_type === "recorded_webinar" || data.event_type === "autowebinar") {
        if (data.autoweb_user_mode === "one_time") {
          effectiveEventType = "recorded_webinar";
          autowebMode = null;
        } else {
          effectiveEventType = "autowebinar";
          autowebMode = data.autoweb_user_mode;
        }
      }
      const effectiveSourceKind: SourceKind =
        effectiveEventType === "live_stream" ? "kinescope_live_event" : "kinescope_video";

      const payload: Record<string, any> = {
        slug: data.slug,
        title: data.title,
        description: data.description || null,
        kinescope_video_id: data.kinescope_video_id || null,
        product_id: null,
        access_rule: { mode: "rules", product_id: null, tariff_id: null },
        is_published: data.is_published,
        scheduled_at: data.scheduled_at || null,
        replay_enabled: data.replay_enabled,
        invite_mode: data.invite_mode,
        direct_access_allowed: data.direct_access_allowed,
        event_type: effectiveEventType,
        source_kind: effectiveSourceKind,
        event_timezone: data.event_timezone,
        kinescope_live_event_id: data.kinescope_live_event_id || null,
        kinescope_project_id: data.kinescope_project_id || null,
        metadata: mergedMetadata,
        autoweb_mode: autowebMode,
        autoweb_config: effectiveEventType === "autowebinar" ? data.autoweb_config : {},
      };

      // On INSERT only: seed initial lifecycle status. UPDATE never touches platform_status/status.
      if (!editingId) {
        payload.status = data.status || "draft";
        payload.platform_status = data.status || "draft";
      }

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
        const rows: Array<{ live_event_id: string; product_id: string; tariff_id: string | null; sort_order: number; conditions: Record<string, any> }> = [];

        validRules.forEach((rule, ruleIdx) => {
          const conditions: Record<string, any> = {};
          if (rule.match_purchase_month === true) conditions.match_purchase_month = true;
          if (rule.tariff_ids.length === 0) {
            rows.push({ live_event_id: eventId!, product_id: rule.product_id, tariff_id: null, sort_order: ruleIdx * 10, conditions });
          } else {
            rule.tariff_ids.forEach((tariffId, tIdx) => {
              rows.push({ live_event_id: eventId!, product_id: rule.product_id, tariff_id: tariffId, sort_order: ruleIdx * 10 + tIdx, conditions });
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
      const wasPublished = form.is_published;
      const wasInviteReady = isInviteReady;
      
      toast.success(editingId ? "Эфир обновлён" : "Эфир создан");
      
      if (wasPublished && wasInviteReady) {
        toast.info("Эфир готов к приглашениям", {
          action: {
            label: "Создать приглашение",
            onClick: () => window.open("/admin/communication?tab=broadcasts", "_blank"),
          },
          duration: 8000,
        });
      } else if (wasPublished && !wasInviteReady) {
        // Show what's still needed
        const missing: string[] = [];
        if (isLiveStream && !form.scheduled_at) missing.push("дата и время эфира");
        if (isLiveStream && !form.kinescope_live_event_id) missing.push("живой эфир в Kinescope");
        if (!isLiveStream && !form.kinescope_video_id) missing.push("видео Kinescope");
        if (form.access_rules.filter(r => r.product_id).length === 0) missing.push("правила доступа");
        
        if (missing.length > 0) {
          toast.info(`Для приглашений осталось: ${missing.join(", ")}`, { duration: 8000 });
        }
      } else if (!wasPublished) {
        const remainingBlockers = blockers.map(b => b.label.toLowerCase());
        if (remainingBlockers.length > 0) {
          toast.info(`Для публикации: ${remainingBlockers.join(", ")}`, { duration: 6000 });
        }
      }
      
      setDialogOpen(false);
      setEditingId(null);
      setForm(defaultForm);
      setSlugManuallyEdited(false);
      setPublishAttempted(false);
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
      queryClient.invalidateQueries({ queryKey: ["live-event-access-rules"] });
      queryClient.invalidateQueries({ queryKey: ["live-event-provider"] });
    },
    onError: (err: any) => {
      const msg = err?.message || (typeof err === "object" ? JSON.stringify(err) : String(err));
      toast.error(`Ошибка сохранения: ${msg}`);
    },
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
    setSlugManuallyEdited(true);
    setPublishAttempted(false);
    const meta = (event.metadata as Record<string, any>) || {};
    const ns = meta.notification_settings || {};
    setForm({
      slug: event.slug,
      title: event.title,
      description: event.description || "",
      kinescope_video_id: event.kinescope_video_id || "",
      kinescope_mode: event.kinescope_video_id ? "picker" : "picker",
      kinescope_project_id: event.kinescope_project_id || meta.kinescope_project_id || "",
      kinescope_folder_id: meta.kinescope_folder_id || "",
      status: event.status,
      is_published: event.is_published,
      scheduled_at: event.scheduled_at || "",
      replay_enabled: event.replay_enabled,
      invite_mode: (event.invite_mode as "none" | "optional_one_time" | "required_one_time") || "none",
      direct_access_allowed: event.direct_access_allowed ?? true,
      access_rules: [],
      event_type: (event.event_type as EventType) || "recorded_webinar",
      event_timezone: event.event_timezone || "Europe/Minsk",
      kinescope_live_event_id: event.kinescope_live_event_id || "",
      notification_enabled: ns.enabled ?? false,
      notification_template_id: ns.template_id || "",
      notification_channels: ns.channels || ["telegram"],
      notification_offsets: ns.offsets || [
        { minutes: 1440, enabled: true, label: "За 1 день" },
        { minutes: 60, enabled: true, label: "За 1 час" },
      ],
      autoweb_user_mode: (
        event.event_type === "autowebinar"
          ? (((event as any).autoweb_mode as AutowebUserMode) ?? "on_demand")
          : "one_time"
      ),
      autoweb_config: ((event as any).autoweb_config as AutowebConfig) ?? defaultForm.autoweb_config,
    });
    setDialogOpen(true);
  };

  // Sync loaded rules into form when editing
  useMemo(() => {
    if (!existingRules || !editingId) return;
    type Group = { tariff_ids: string[]; match_purchase_month: boolean };
    const grouped = new Map<string, Group>();
    for (const row of existingRules as Array<{ product_id: string; tariff_id: string | null; conditions?: any }>) {
      const pid = row.product_id;
      if (!grouped.has(pid)) grouped.set(pid, { tariff_ids: [], match_purchase_month: false });
      const g = grouped.get(pid)!;
      if (row.tariff_id) g.tariff_ids.push(row.tariff_id);
      const cond = row.conditions || {};
      if (cond?.match_purchase_month === true) g.match_purchase_month = true;
    }
    const accessRules: AccessRuleRow[] = Array.from(grouped.entries()).map(([product_id, g]) => ({
      product_id,
      tariff_ids: g.tariff_ids,
      match_purchase_month: g.match_purchase_month,
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
            <p className="text-sm text-muted-foreground">Управление живыми эфирами и автовебинарами</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleCreate} className={cn(LIFECYCLE_BUTTON_BASE, LIFECYCLE_BUTTON_TONES.success)}>
              <Plus className="h-4 w-4" />
              Создать эфир
            </Button>
            <Button onClick={() => setHelpOpen(true)} title="Справка" className={cn(LIFECYCLE_BUTTON_BASE, LIFECYCLE_BUTTON_TONES.info, "min-w-0 w-9 px-0")}>
              <HelpCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <LiveEventsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

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
          <div className="space-y-2">
            <div className="flex items-center justify-end">
              <ColumnSettings
                columns={columns.filter((c) => !LIVE_EVENTS_LOCKED_KEYS.has(c.key))}
                onChange={(updated) => {
                  // Merge: locked columns preserved as-is, others replaced.
                  setColumns((prev) => {
                    const lockedFirst = prev.filter((c) => LIVE_EVENTS_LOCKED_KEYS.has(c.key));
                    // Reapply order: locked checkbox first, then user columns, then locked actions last
                    const checkbox = lockedFirst.find((c) => c.key === "checkbox");
                    const actions = lockedFirst.find((c) => c.key === "actions");
                    const reordered = [
                      ...(checkbox ? [{ ...checkbox, order: 0 }] : []),
                      ...updated.map((c, i) => ({ ...c, order: i + 1 })),
                      ...(actions ? [{ ...actions, order: updated.length + 1 }] : []),
                    ];
                    return reordered;
                  });
                }}
              />
            </div>
            <LiveEventsTable
              events={events}
              onEdit={handleEdit}
              onLifecycleAction={handleLifecycleAction}
              onDelete={(id) => setDeleteIds([id])}
              onSelectionChange={setSelectedIds}
            />
          </div>
        )}

        {/* Final follow-up sprint PATCH F4: bulk actions bar (selection на текущей странице) */}
        <BulkActionsBar
          selectedCount={selectedIds.size}
          totalCount={events?.length || 0}
          entityName="эфиров на странице"
          onClearSelection={() => setSelectedIds(new Set())}
          onSelectAll={() => events && setSelectedIds(new Set(events.map((e) => e.id)))}
          onBulkDelete={() => setDeleteIds(Array.from(selectedIds))}
        />

        {/* Final follow-up sprint PATCH F5: единый delete dialog (single + bulk) */}
        <LiveEventDeleteDialog
          open={deleteIds.length > 0}
          eventIds={deleteIds}
          onOpenChange={(o) => { if (!o) setDeleteIds([]); }}
          onSuccess={() => {
            setSelectedIds(new Set());
            // Если открыт edit-dialog для удалённого id — закрыть
            if (editingId && deleteIds.includes(editingId)) {
              setDialogOpen(false);
              setEditingId(null);
            }
          }}
        />


        {/* --- Create/Edit Sheet (tabs UX, mirrors ContactDetailSheet) --- */}
        <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
          <SheetContent
            className={[
              // Size — wider/taller than ContactDetailSheet (max-w-3xl) per plan
              "w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] sm:max-w-5xl",
              "!h-[calc(100dvh-1rem)] sm:!h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)]",
              "!top-2 !bottom-2 !right-2 sm:!top-4 sm:!bottom-4 sm:!right-4 !left-auto",
              "!rounded-2xl",
              "p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]",
              "flex flex-col overflow-hidden",
            ].join(" ")}
          >
            <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0">
              <SheetTitle>{editingId ? "Редактировать эфир" : "Создать эфир"}</SheetTitle>
            </SheetHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Horizontally scrollable tabs bar (mirrors ContactDetailSheet) */}
              <div
                className="flex-shrink-0 overflow-x-auto scrollbar-none"
                style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}
              >
                <TabsList className="mx-4 sm:mx-6 my-2 sm:my-3 inline-flex w-auto whitespace-nowrap bg-transparent h-auto">
                  <TabsTrigger value="basic" className="text-xs sm:text-sm px-2.5 sm:px-3">Основное</TabsTrigger>
                  <TabsTrigger value="source" className="text-xs sm:text-sm px-2.5 sm:px-3">Источник</TabsTrigger>
                  <TabsTrigger value="access" className="text-xs sm:text-sm px-2.5 sm:px-3">Доступ</TabsTrigger>
                  <TabsTrigger value="notifications" className="text-xs sm:text-sm px-2.5 sm:px-3">Уведомления</TabsTrigger>
                  <TabsTrigger value="extras" className="text-xs sm:text-sm px-2.5 sm:px-3">Дополнительно</TabsTrigger>
                </TabsList>
              </div>
              <Separator className="mx-4 sm:mx-6" />

              <div className="flex-1 overflow-y-auto bg-muted/30">
                <div className="px-4 sm:px-6 py-4 pb-8 min-w-0 [&_*]:min-w-0">
                  {/* === TAB: Основное === */}
                  <TabsContent value="basic" className="m-0 space-y-4">
                    {/* Step 0: Event type selector (only for new events) */}
              {!editingId && (
                <FormSection title="Тип эфира">
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      className={`rounded-lg border-2 p-4 text-left transition-colors ${form.event_type === "live_stream" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"}`}
                      onClick={() => setForm(f => ({ ...f, event_type: "live_stream", kinescope_video_id: "" }))}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Radio className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">Живой эфир</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Онлайн-трансляция в реальном времени</p>
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg border-2 p-4 text-left transition-colors ${form.event_type === "recorded_webinar" ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"}`}
                      onClick={() => setForm(f => ({ ...f, event_type: "recorded_webinar", kinescope_live_event_id: "" }))}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Video className="h-4 w-4 text-primary" />
                        <span className="font-medium text-sm">Видео / Автовебинар</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Готовое видео, показываемое как вебинар</p>
                    </button>
                  </div>
                </FormSection>
              )}

              {editingId && (
                <div className="flex items-center gap-2">
                  <Badge variant={isLiveStream ? "default" : "secondary"}>
                    {isLiveStream ? <><Radio className="h-3 w-3 mr-1" />Живой эфир</> : <><Video className="h-3 w-3 mr-1" />Видео / Автовебинар</>}
                  </Badge>
                </div>
              )}

              {/* Sprint A — Конструктор режима автовебинара (для recorded_webinar/autowebinar) */}
              {(form.event_type === "recorded_webinar" || form.event_type === "autowebinar") && (
                <FormSection title="Режим показа">
                  <AutowebModeEditor
                    userMode={form.autoweb_user_mode}
                    onUserModeChange={(m) => setForm((f) => ({ ...f, autoweb_user_mode: m }))}
                    config={form.autoweb_config}
                    onConfigChange={(c) => setForm((f) => ({ ...f, autoweb_config: c }))}
                    timezone={form.event_timezone}
                  />
                </FormSection>
              )}

              <Separator />

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
                    Короткий адрес эфира в ссылке. Заполняется автоматически из названия.
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
                      <SelectContent className="max-h-[60vh] overflow-y-auto">
                        <SelectItem value="draft">Черновик</SelectItem>
                        <SelectItem value="scheduled">Запланирован</SelectItem>
                        <SelectItem value="live">В эфире</SelectItem>
                        <SelectItem value="ended">Завершён</SelectItem>
                        <SelectItem value="replay_available">Запись доступна</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{isLiveStream ? "Дата и время эфира *" : "Дата и время (анонс)"}</Label>
                    <DateTimePicker
                      date={scheduledDate}
                      time={scheduledTime}
                      onDateChange={handleDateChange}
                      onTimeChange={handleTimeChange}
                    />
                    <p className="text-xs text-muted-foreground">
                      Часовой пояс: {form.event_timezone}
                    </p>
                  </div>
                </div>
              </FormSection>
                  </TabsContent>

                  {/* === TAB: Источник === */}
                  <TabsContent value="source" className="m-0 space-y-4">
              {/* Section 2: Kinescope source */}
              <FormSection title={isLiveStream ? "Живой эфир Kinescope" : "Источник видео"}>
                {isLiveStream ? (
                  // Live stream mode
                  <div className="space-y-4">
                    {kinescopeNotConfigured ? (
                      <div className="rounded-lg border border-dashed p-4 text-center space-y-2">
                        <p className="text-sm text-muted-foreground">Интеграция с Kinescope не настроена</p>
                      </div>
                    ) : !form.kinescope_live_event_id ? (
                      /* --- Pre-create: folder picker + create button --- */
                      <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                          Выберите папку для трансляций и создайте эфир.
                        </p>

                        <div className="space-y-1.5">
                          <Label>Папка для трансляций *</Label>
                          {kinescopeLiveFoldersLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка...
                            </div>
                          ) : kinescopeLiveFolders && kinescopeLiveFolders.length > 0 ? (
                            <Select value={form.kinescope_folder_id} onValueChange={(v) => setForm({ ...form, kinescope_folder_id: v })}>
                              <SelectTrigger><SelectValue placeholder="Выберите папку" /></SelectTrigger>
                              <SelectContent className="max-h-[60vh] overflow-y-auto">
                                {kinescopeLiveFolders.map((f) => (
                                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="rounded-lg border border-dashed p-3 text-center">
                              <p className="text-xs text-muted-foreground">Нет папок для трансляций. Создайте папку в Kinescope.</p>
                            </div>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <Label>Проект для записи (куда сохранится запись)</Label>
                          {kinescopeProjectsLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка...
                            </div>
                          ) : (
                            <Select value={form.kinescope_project_id} onValueChange={(v) => setForm({ ...form, kinescope_project_id: v })}>
                              <SelectTrigger><SelectValue placeholder="Выберите проект (для записи)" /></SelectTrigger>
                              <SelectContent className="max-h-[60vh] overflow-y-auto">
                                {kinescopeProjects?.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <p className="text-xs text-muted-foreground">Записи эфира будут сохранены в этот проект</p>
                        </div>

                        <Button
                          onClick={handleCreateKinescopeLiveEvent}
                          disabled={!form.kinescope_folder_id || creatingLiveEvent}
                          variant="outline"
                          className="gap-2"
                        >
                          {creatingLiveEvent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                          Создать живой эфир в Kinescope
                        </Button>
                      </div>
                    ) : (
                      /* --- Post-create: Control Panel --- */
                      <LiveStreamControlPanel
                        form={form}
                        editingId={editingId}
                        kinescopeInstanceId={kinescopeInstanceId}
                        onLifecycleAction={handleLifecycleAction}
                        queryClient={queryClient}
                        onFormUpdate={(updates) => setForm(f => ({ ...f, ...updates }))}
                      />
                    )}
                  </div>
                ) : (
                  // Recorded webinar mode (existing flow, unchanged)
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Привяжите существующее видео из аккаунта Kinescope.
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
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка проектов...
                            </div>
                          ) : (
                            <Select value={form.kinescope_project_id} onValueChange={(v) => setForm({ ...form, kinescope_project_id: v, kinescope_video_id: "" })}>
                              <SelectTrigger><SelectValue placeholder="Выберите проект" /></SelectTrigger>
                              <SelectContent className="max-h-[60vh] overflow-y-auto">
                                {kinescopeProjects?.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        {form.kinescope_project_id && (
                          <div className="space-y-1.5">
                            <Label>Видео</Label>
                            {kinescopeVideosLoading ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка видео...
                              </div>
                            ) : kinescopeVideos && kinescopeVideos.length === 0 ? (
                              <div className="rounded-lg border border-dashed p-3 text-center">
                                <p className="text-sm text-muted-foreground">В этом проекте нет видео</p>
                              </div>
                            ) : (
                              <Select value={form.kinescope_video_id} onValueChange={(v) => setForm({ ...form, kinescope_video_id: v })}>
                                <SelectTrigger><SelectValue placeholder="Выберите видео" /></SelectTrigger>
                                <SelectContent className="max-h-[60vh] overflow-y-auto">
                                  {kinescopeVideos?.map((v) => (
                                    <SelectItem key={v.id} value={v.id}>{v.title || v.id}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        )}
                        <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
                          onClick={() => setForm({ ...form, kinescope_mode: "manual" })}>
                          Ввести Video ID вручную
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="space-y-1.5">
                          <Label>Kinescope Video ID</Label>
                          <Input value={form.kinescope_video_id} onChange={(e) => setForm({ ...form, kinescope_video_id: e.target.value })} placeholder="Вставьте ID из консоли Kinescope" />
                        </div>
                        <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground transition-colors"
                          onClick={() => setForm({ ...form, kinescope_mode: "picker" })}>
                          Выбрать из списка
                        </button>
                      </div>
                    )}

                    {form.kinescope_video_id && (
                      <p className="text-xs text-muted-foreground">
                        Привязано: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{form.kinescope_video_id}</code>
                      </p>
                    )}
                  </div>
                )}
              </FormSection>
                  </TabsContent>

                  {/* === TAB: Доступ === */}
                  <TabsContent value="access" className="m-0 space-y-4">
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
                  <SelectContent className="max-h-[60vh] overflow-y-auto">
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
                  </TabsContent>

                  {/* === TAB: Уведомления === */}
                  <TabsContent value="notifications" className="m-0 space-y-4">
              {/* Section 4.5: Notifications (live_stream only) */}
              {!isLiveStream ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Уведомления настраиваются только для живых эфиров.
                  </p>
                </div>
              ) : (
                <>
                  <FormSection title="Уведомления">
                    <SwitchRow
                      checked={form.notification_enabled}
                      onCheckedChange={(v) => setForm({ ...form, notification_enabled: v })}
                      label="Включить автоматические уведомления"
                      description="Уведомления будут отправлены пользователям с доступом к эфиру"
                    />

                    {form.notification_enabled && (
                      <div className="space-y-4 pl-1">
                        {/* Template picker */}
                        <div className="space-y-1.5">
                          <Label className="text-xs">Шаблон уведомления</Label>
                          <Select
                            value={form.notification_template_id}
                            onValueChange={(v) => setForm({ ...form, notification_template_id: v })}
                          >
                            <SelectTrigger className="text-xs">
                              <SelectValue placeholder="Выберите шаблон" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[60vh] overflow-y-auto">
                              {broadcastTemplates?.map((t) => (
                                <SelectItem key={t.id} value={t.id} className="text-xs">
                                  {t.name} <span className="text-muted-foreground ml-1">({t.template_type})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">
                            Переменные: {"{{live_event.title}}"}, {"{{live_event.link}}"}, {"{{live_event.start_at_source_tz}}"}
                          </p>
                        </div>

                        {/* Channels */}
                        <div className="space-y-1.5">
                          <Label className="text-xs">Каналы</Label>
                          <div className="flex gap-4">
                            {(["telegram", "email"] as const).map((ch) => (
                              <label key={ch} className="flex items-center gap-2 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={form.notification_channels.includes(ch)}
                                  onChange={(e) => {
                                    const channels = e.target.checked
                                      ? [...form.notification_channels, ch]
                                      : form.notification_channels.filter(c => c !== ch);
                                    setForm({ ...form, notification_channels: channels.length > 0 ? channels : [ch] });
                                  }}
                                  className="rounded border-input"
                                />
                                {ch === "telegram" ? "Telegram" : "Email"}
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Offsets */}
                        <div className="space-y-1.5">
                          <Label className="text-xs">Когда уведомлять</Label>
                          <div className="space-y-2">
                            {form.notification_offsets.map((offset, idx) => (
                              <label key={idx} className="flex items-center gap-2 text-xs cursor-pointer">
                                <Switch
                                  checked={offset.enabled}
                                  onCheckedChange={(v) => {
                                    const newOffsets = [...form.notification_offsets];
                                    newOffsets[idx] = { ...offset, enabled: v };
                                    setForm({ ...form, notification_offsets: newOffsets });
                                  }}
                                  className="scale-75"
                                />
                                {offset.label}
                              </label>
                            ))}
                          </div>
                        </div>

                        {/* Summary */}
                        <div className="rounded-lg bg-muted/30 p-3 text-xs space-y-1">
                          <p className="font-medium text-foreground/80">Итого:</p>
                          <p className="text-muted-foreground">
                            Шаблон: {broadcastTemplates?.find(t => t.id === form.notification_template_id)?.name || "не выбран"}
                          </p>
                          <p className="text-muted-foreground">
                            Каналы: {form.notification_channels.map(c => c === "telegram" ? "Telegram" : "Email").join(", ")}
                          </p>
                          <p className="text-muted-foreground">
                            Сроки: {form.notification_offsets.filter(o => o.enabled).map(o => o.label).join(", ") || "нет"}
                          </p>
                          <p className="text-muted-foreground">
                            Получатели: все пользователи с доступом к эфиру по правилам доступа
                          </p>
                        </div>
                      </div>
                    )}
                  </FormSection>
                </>
              )}
                  </TabsContent>

                  {/* === TAB: Дополнительно === */}
                  <TabsContent value="extras" className="m-0 space-y-4">
              {!editingId && (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Дополнительные настройки (комната, комментарии, вопросы, модерация, сценарий, блоки, CTA, тема) станут доступны после первого сохранения эфира.
                  </p>
                </div>
              )}
              {/* Section 5: Publication & Recording */}
              <FormSection title="Публикация и запись">
                {canPublish ? (
                  <div className="flex items-center gap-3">
                    <Button
                      variant={form.is_published ? "outline" : "default"}
                      size="sm"
                      onClick={() => handlePublishToggle(!form.is_published)}
                    >
                      {form.is_published ? "Снять публикацию" : "Опубликовать эфир"}
                    </Button>
                    {form.is_published && <Badge variant="default">Опубликован</Badge>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" disabled className="opacity-50">
                      Опубликовать эфир
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Заполните обязательные поля для публикации
                    </p>
                  </div>
                )}
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
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    {isLiveStream ? "Для публикации живого эфира:" : "Для публикации автовебинара:"}
                  </p>
                  {validationItems.map((item) => (
                    <CheckItem key={item.key} ok={item.ok} label={item.label} blocker={item.blocker} highlight={publishAttempted && item.blocker && !item.ok} />
                  ))}
                </div>
                {publishAttempted && blockers.length > 0 && (
                  <p className="text-xs text-destructive">
                    Публикация невозможна: заполните обязательные поля выше
                  </p>
                )}
              </FormSection>

              {/* Source Debug Block — admin видит реальное состояние source */}
              {editingId && (() => {
                const currentEvent = events?.find(e => e.id === editingId);
                if (!currentEvent) return null;
                const meta = currentEvent.metadata as Record<string, any> | null;
                const pss = meta?.provider_source_status || "unknown";
                const lastSync = meta?.last_synced_at || meta?.last_provider_sync_at;
                const hasVideoId = !!currentEvent.kinescope_video_id;
                const hasLiveId = !!currentEvent.kinescope_live_event_id;
                const providerCurrent = (meta?.provider?.current ?? {}) as Record<string, any>;
                const embedLinkRaw: string | null = providerCurrent?.embed_link ?? null;
                const playLinkRaw: string | null = providerCurrent?.play_link ?? null;
                const playSlug = (() => {
                  if (!playLinkRaw) return null;
                  const s = String(playLinkRaw).trim();
                  if (!s) return null;
                  const noProto = s.replace(/^https?:\/\/[^/]+\//, '');
                  const slug = noProto.split(/[/?#]/)[0]?.trim() || null;
                  return slug && slug.length > 0 ? slug : null;
                })();
                const liveEmbedFromProvider = embedLinkRaw && String(embedLinkRaw).trim().length > 0
                  ? String(embedLinkRaw).trim()
                  : (playSlug ? `https://kinescope.io/embed/${playSlug}` : null);
                const isLiveActive = currentEvent.platform_status === "live";
                const resolvedKind = isLiveActive
                  ? (liveEmbedFromProvider ? "kinescope_live_embed" : "live_pending")
                  : (hasVideoId ? "kinescope_video" : hasLiveId ? "kinescope_live_embed" : "none");
                const embedUrl = isLiveActive
                  ? liveEmbedFromProvider
                  : (hasVideoId
                      ? `https://kinescope.io/embed/${currentEvent.kinescope_video_id}`
                      : (liveEmbedFromProvider ?? null));
                const playUrl = hasVideoId
                  ? `https://kinescope.io/${currentEvent.kinescope_video_id}`
                  : (playLinkRaw || null);

                return (
                  <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Monitor className="h-3.5 w-3.5" />
                      Source Debug
                    </h4>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                      <span className="text-muted-foreground">Provider status:</span>
                      <span className={pss === "ok" ? "text-green-600 font-medium" : pss === "missing" || pss === "broken" ? "text-destructive font-medium" : "text-muted-foreground"}>
                        {pss}
                      </span>
                      <span className="text-muted-foreground">Resolved source:</span>
                      <span className="font-mono">{resolvedKind}</span>
                      <span className="text-muted-foreground">Embed URL:</span>
                      <span className="font-mono truncate" title={embedUrl || "—"}>{embedUrl ? "✅" : "❌"} {embedUrl || "—"}</span>
                      <span className="text-muted-foreground">Play URL:</span>
                      <span className="font-mono truncate" title={playUrl || "—"}>{playUrl || "—"}</span>
                      <span className="text-muted-foreground">Last sync:</span>
                      <span>{lastSync ? format(new Date(lastSync), "dd.MM.yyyy HH:mm:ss") : "—"}</span>
                    </div>
                    {embedUrl && (
                      <Button variant="outline" size="sm" className="text-[10px] h-6" onClick={() => window.open(embedUrl, "_blank")}>
                        <ExternalLink className="h-3 w-3 mr-1" /> Открыть embed
                      </Button>
                    )}
                  </div>
                );
              })()}

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
                  </div>
                  {isLiveStream && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Kinescope Live Event ID (ручной override)</Label>
                      <Input
                        value={form.kinescope_live_event_id}
                        onChange={(e) => setForm({ ...form, kinescope_live_event_id: e.target.value })}
                        className="text-xs"
                        placeholder="live-event-id"
                      />
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>

              {/* Summary block */}
              <div className="rounded-lg border bg-muted/20 p-4 space-y-2.5">
                <h4 className="text-xs font-semibold text-foreground">Как это работает для пользователя</h4>
                <div className="space-y-2">
                  <SummaryItem icon={isLiveStream ? Radio : Video} label="Тип">
                    {isLiveStream ? "Живой эфир" : "Видео / Автовебинар"}
                  </SummaryItem>
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
                  {isInviteReady && (
                    <SummaryItem icon={Send} label="Приглашения">
                      Готов к приглашениям
                    </SummaryItem>
                  )}
                </div>
              </div>

              {/* Comments, Questions, Moderation, Scenario tabs (level-2) */}
              {editingId && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between gap-2 py-2">
                    <span className="text-xs font-medium text-muted-foreground">Экспорт данных:</span>
                    <LiveEventExportButtons liveEventId={editingId} eventTitle={form.title || undefined} />
                  </div>
                  <Tabs value={extrasTab} onValueChange={setExtrasTab} className="w-full">
                    <div className="overflow-x-auto scrollbar-none">
                      <TabsList className="inline-flex w-auto whitespace-nowrap bg-transparent h-auto gap-1 p-1">
                        <TabsTrigger value="room" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <ImageIcon className="h-3 w-3" /> Комната
                        </TabsTrigger>
                        <TabsTrigger value="comments" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <MessageSquare className="h-3 w-3" /> Комментарии
                        </TabsTrigger>
                        <TabsTrigger value="questions" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <HelpCircle className="h-3 w-3" /> Вопросы
                        </TabsTrigger>
                        <TabsTrigger value="moderation" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <Shield className="h-3 w-3" /> Модерация
                        </TabsTrigger>
                        <TabsTrigger value="scenario" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <Video className="h-3 w-3" /> Сценарий
                        </TabsTrigger>
                        <TabsTrigger value="blocks" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <LayoutGrid className="h-3 w-3" /> Блоки
                        </TabsTrigger>
                        <TabsTrigger value="cta" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <ShoppingCart className="h-3 w-3" /> CTA
                        </TabsTrigger>
                        <TabsTrigger value="theme" className="gap-1.5 text-xs sm:text-sm px-2.5 sm:px-3">
                          <Monitor className="h-3 w-3" /> Тема
                        </TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="room" className="border rounded-lg mt-2">
                      <WebinarRoomSettingsCard liveEventId={editingId} />
                    </TabsContent>
                    <TabsContent value="comments" className="border rounded-lg mt-2 h-[500px] overflow-hidden">
                      <LiveEventComments liveEventId={editingId} />
                    </TabsContent>
                    <TabsContent value="questions" className="border rounded-lg mt-2 h-[500px] overflow-hidden">
                      <LiveEventQuestions liveEventId={editingId} />
                    </TabsContent>
                    <TabsContent value="moderation" className="border rounded-lg mt-2 h-[500px] overflow-hidden">
                      <LiveEventModerationPanel liveEventId={editingId} />
                    </TabsContent>
                    <TabsContent value="scenario" className="border rounded-lg mt-2">
                      <LiveEventScenario liveEventId={editingId} />
                    </TabsContent>
                    <TabsContent value="blocks" className="border rounded-lg mt-2">
                      <LiveEventRoomBlocksEditor liveEventId={editingId} />
                    </TabsContent>
                    <TabsContent value="cta" className="border rounded-lg mt-2">
                      <LiveEventProductCtaBindings liveEventId={editingId} />
                      <LiveEventCtaRuntimePanel liveEventId={editingId} />
                    </TabsContent>
                    <TabsContent value="theme" className="border rounded-lg mt-2">
                      <LiveEventThemeEditor liveEventId={editingId} />
                    </TabsContent>
                  </Tabs>
                </>
              )}
                  </TabsContent>
                </div>
              </div>
            </Tabs>

            {/* Sticky footer */}
            <div className="flex-shrink-0 border-t p-4 flex justify-end gap-2 bg-background">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button
                onClick={() => saveMutation.mutate(form)}
                disabled={(!form.title.trim() || !form.slug.trim() || !!slugExists) || saveMutation.isPending}
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {editingId ? "Сохранить" : "Создать"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </AdminLayout>
  );
}

// --- Sub-components ---

function FormSection({ title, children }: { title?: string; children: React.ReactNode }) {
  // Mirrors ContactDetailSheet visual pattern: white Card with header on muted background.
  return (
    <Card>
      {title && (
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
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
    <div className={`flex items-start gap-3 rounded-lg p-3 min-w-0 ${error ? "bg-destructive/5 border border-destructive/30" : "bg-muted/20"}`}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5 shrink-0" />
      <div className="space-y-0.5 min-w-0 flex-1">
        <Label className="text-sm cursor-pointer break-words" onClick={() => onCheckedChange(!checked)}>{label}</Label>
        {description && <p className="text-xs text-muted-foreground break-words">{description}</p>}
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

// --- Provider Source Status types ---
type ProviderSourceStatus = "draft" | "ok" | "missing" | "broken";
type ProviderSyncStatus = "idle" | "syncing" | "success" | "error";

const providerSourceLabels: Record<ProviderSourceStatus, string> = {
  draft: "Не создан",
  ok: "Источник активен",
  missing: "Источник удалён в Kinescope",
  broken: "Источник повреждён",
};

const providerSourceColors: Record<ProviderSourceStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  ok: "bg-primary/10 text-primary",
  missing: "bg-destructive/10 text-destructive",
  broken: "bg-amber-500/10 text-amber-700",
};

// --- Live Stream Control Panel ---
function LiveStreamControlPanel({
  form,
  editingId,
  kinescopeInstanceId,
  onLifecycleAction,
  queryClient,
  onFormUpdate,
}: {
  form: LiveEventForm;
  editingId: string | null;
  kinescopeInstanceId: string | undefined;
  onLifecycleAction: (eventId: string, action: "enable_live_event" | "complete_live_event" | "sync_live_event", liveEventId: string) => Promise<void>;
  queryClient: ReturnType<typeof useQueryClient>;
  onFormUpdate?: (updates: Partial<LiveEventForm>) => void;
}) {
  const [showStreamkey, setShowStreamkey] = useState(false);
  const [syncStatus, setSyncStatus] = useState<ProviderSyncStatus>("idle");
  const [providerSourceStatus, setProviderSourceStatus] = useState<ProviderSourceStatus>("draft");
  const [recreateDialogOpen, setRecreateDialogOpen] = useState(false);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [recreating, setRecreating] = useState(false);
  const [detaching, setDetaching] = useState(false);
  const autoHealAttemptedRef = useRef(false);

  // Get provider data from DB
  const { data: eventData, refetch: refetchProvider } = useQuery({
    queryKey: ["live-event-provider", editingId],
    queryFn: async () => {
      if (!editingId) return null;
      const { data } = await supabase.from("live_events").select("metadata, platform_status, kinescope_stream_id, kinescope_live_event_id").eq("id", editingId).single();
      return data;
    },
    enabled: !!editingId,
  });

  const providerCurrent = (eventData?.metadata as any)?.provider?.current || (eventData?.metadata as any)?.provider || {};
  const playLink = providerCurrent.play_link;
  const rtmpLink = providerCurrent.rtmp_link || "rtmp://rtmp.kinescope.io/live";
  const streamkey = providerCurrent.streamkey;
  const streamStatus = providerCurrent.stream_status || "pending";
  const platformStatus = eventData?.platform_status || "draft";
  const lastSync = (eventData?.metadata as any)?.last_provider_sync_at;
  const kinescopeLiveEventId = eventData?.kinescope_live_event_id || form.kinescope_live_event_id;

  // Reset auto-heal flag when editing a different event
  useEffect(() => {
    autoHealAttemptedRef.current = false;
  }, [editingId]);

  // Determine provider source status from DB metadata (source of truth)
  // Auto-heal: if kinescope_live_event_id exists but provider.current is empty, trigger sync once
  useEffect(() => {
    if (!kinescopeLiveEventId) {
      setProviderSourceStatus("draft");
      return;
    }
    const meta = eventData?.metadata as any;
    const metaStatus = meta?.provider_source_status as ProviderSourceStatus | undefined;
    if (metaStatus && ["ok", "missing", "broken", "draft"].includes(metaStatus)) {
      setProviderSourceStatus(metaStatus);
      return;
    }
    
    const hasProviderCurrent = !!meta?.provider?.current?.play_link || !!meta?.provider?.current?.stream_id;
    if (!hasProviderCurrent && editingId && kinescopeInstanceId && !autoHealAttemptedRef.current && syncStatus !== "syncing") {
      // Auto-heal: legacy event without provider.current — trigger sync once
      autoHealAttemptedRef.current = true;
      handleSyncProvider();
    } else if (providerSourceStatus === "draft") {
      setProviderSourceStatus("ok");
    }
  }, [kinescopeLiveEventId, eventData]);

  // Can recreate only if folder_id and project_id are available
  const canRecreate = !!(form.kinescope_folder_id || (eventData?.metadata as any)?.kinescope_folder_id);
  const recreateBlockers: string[] = [];
  if (!form.kinescope_folder_id && !(eventData?.metadata as any)?.kinescope_folder_id) {
    recreateBlockers.push("Не выбрана папка live-эфиров");
  }

  // --- handleSyncProvider ---
  const handleSyncProvider = async () => {
    if (!editingId || !kinescopeLiveEventId || !kinescopeInstanceId) return;
    setSyncStatus("syncing");
    try {
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: { action: "sync_live_event", instance_id: kinescopeInstanceId, live_event_id: kinescopeLiveEventId },
      });

      if (error) {
        setSyncStatus("error");
        toast.error(`Ошибка синхронизации: ${error.message || String(error)}`);
        return;
      }

      const syncData = data?.data as any;
      const returnedSourceStatus: ProviderSourceStatus = syncData?.provider_source_status || "ok";
      setProviderSourceStatus(returnedSourceStatus);

      // Handle missing (404) — persist to DB
      if (returnedSourceStatus === "missing") {
        setSyncStatus("error");
        // Save status to DB metadata
        const { data: currentForMissing } = await supabase.from("live_events").select("metadata").eq("id", editingId).single();
        const existingMetaMissing = (currentForMissing?.metadata as Record<string, any>) || {};
        const missingMeta = {
          ...existingMetaMissing,
          provider_source_status: "missing",
          provider_error_message: syncData?.provider_error_message || "Событие удалено в Kinescope (404)",
          provider_status_code: syncData?.status_code || 404,
          last_provider_sync_at: new Date().toISOString(),
          provider: {
            ...(existingMetaMissing.provider || {}),
            current: {}, // Clear current provider data
          },
          provider_history: existingMetaMissing.provider_history || [],
        };
        await supabase.from("live_events").update({ metadata: missingMeta } as any).eq("id", editingId);

        // Audit
        try {
          await DomainEventService.emitEvent("live_provider_missing", "admin", editingId, {
            platform_live_event_id: editingId,
            old_provider_live_event_id: kinescopeLiveEventId,
            provider_source_status_before: providerSourceStatus,
            provider_source_status_after: "missing",
          });
        } catch {}
        toast.error("Источник трансляции удалён в Kinescope", {
          description: "Вы можете пересоздать эфир или отвязать источник",
          duration: 8000,
        });
        refetchProvider();
        queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
        return;
      }

      // Handle broken — persist to DB
      if (returnedSourceStatus === "broken") {
        setSyncStatus("error");
        const { data: currentForBroken } = await supabase.from("live_events").select("metadata").eq("id", editingId).single();
        const existingMetaBroken = (currentForBroken?.metadata as Record<string, any>) || {};
        const brokenMeta = {
          ...existingMetaBroken,
          provider_source_status: "broken",
          provider_error_message: syncData?.provider_error_message || "Отсутствуют stream или play_link",
          provider_status_code: syncData?.status_code || 200,
          last_provider_sync_at: new Date().toISOString(),
        };
        await supabase.from("live_events").update({ metadata: brokenMeta } as any).eq("id", editingId);

        toast.warning("Источник трансляции повреждён", {
          description: syncData?.provider_error_message || "Отсутствуют stream или play_link",
          duration: 6000,
        });
        refetchProvider();
        queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
        return;
      }

      // OK — process normal sync
      const syncEvent = syncData?.event?.data || syncData?.event;
      const syncVideos = syncData?.videos?.data || syncData?.videos;
      const providerStreamStatus = syncEvent?.stream?.status || syncData?.provider_stream_status;

      let newPlatformStatus = platformStatus;
      if (providerStreamStatus === "pending") newPlatformStatus = "scheduled";
      else if (providerStreamStatus === "active" || providerStreamStatus === "live") newPlatformStatus = "live";
      else if (providerStreamStatus === "completed" || providerStreamStatus === "finished") newPlatformStatus = "ended";

      let replayVideoId: string | null = null;
      if (Array.isArray(syncVideos) && syncVideos.length > 0) {
        replayVideoId = syncVideos[0]?.id || null;
        if (replayVideoId) newPlatformStatus = "replay_available";
      }

      // Merge metadata with provider.current structure
      const { data: current } = await supabase.from("live_events").select("metadata").eq("id", editingId).single();
      const existingMeta = (current?.metadata as Record<string, any>) || {};
      const mergedMeta = {
        ...existingMeta,
        provider_source_status: "ok",
        provider_error_message: null,
        provider_status_code: syncData?.status_code || 200,
        last_provider_sync_at: new Date().toISOString(),
        provider: {
          ...(existingMeta.provider || {}),
          current: {
            ...(existingMeta.provider?.current || existingMeta.provider || {}),
            stream_status: providerStreamStatus,
            play_link: syncEvent?.play_link || providerCurrent.play_link,
            rtmp_link: syncEvent?.rtmp_link || providerCurrent.rtmp_link,
            streamkey: syncEvent?.streamkey || providerCurrent.streamkey,
          },
        },
        replay_video_id: replayVideoId || existingMeta.replay_video_id,
      };

      const updatePayload: Record<string, any> = {
        metadata: mergedMeta,
        platform_status: newPlatformStatus,
        status: newPlatformStatus,
      };
      if (replayVideoId) {
        updatePayload.kinescope_video_id = replayVideoId;
      }

      await supabase.from("live_events").update(updatePayload as any).eq("id", editingId);

      // Audit
      try {
        await DomainEventService.emitEvent("live_provider_synced", "admin", editingId, {
          platform_live_event_id: editingId,
          provider_live_event_id: kinescopeLiveEventId,
          provider_source_status_after: "ok",
          provider_stream_status: providerStreamStatus,
        });
      } catch {}

      setSyncStatus("success");
      toast.success("Статус обновлён");
      refetchProvider();
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
    } catch (err: any) {
      setSyncStatus("error");
      toast.error(`Ошибка: ${err.message || String(err)}`);
    }
  };

  // --- handleRecreateProvider ---
  const handleRecreateProvider = async () => {
    if (!editingId || !kinescopeInstanceId) return;
    const folderId = form.kinescope_folder_id || (eventData?.metadata as any)?.kinescope_folder_id;
    const projectId = form.kinescope_project_id || (eventData?.metadata as any)?.kinescope_project_id;
    if (!folderId) {
      toast.error("Не выбрана папка для трансляций");
      return;
    }

    setRecreating(true);
    try {
      // 1. Save old provider to history
      const { data: current } = await supabase.from("live_events").select("metadata, kinescope_live_event_id, kinescope_stream_id").eq("id", editingId).single();
      const existingMeta = (current?.metadata as Record<string, any>) || {};
      const oldProvider = existingMeta.provider?.current || existingMeta.provider || {};
      const providerHistory = existingMeta.provider_history || [];

      if (current?.kinescope_live_event_id) {
        providerHistory.push({
          live_event_id: current.kinescope_live_event_id,
          stream_id: current.kinescope_stream_id,
          play_link: oldProvider.play_link,
          rtmp_link: oldProvider.rtmp_link,
          has_streamkey: !!oldProvider.streamkey,
          provider_stream_status: oldProvider.stream_status,
          detached_at: new Date().toISOString(),
          reason: "recreated",
        });
      }

      // 2. Create new live event
      const { data, error } = await supabase.functions.invoke("kinescope-api", {
        body: {
          action: "create_live_event",
          instance_id: kinescopeInstanceId,
          folder_id: folderId,
          project_id: projectId || undefined,
          name: form.title || "Новый эфир",
        },
      });

      if (error || !data?.success) {
        toast.error(`Не удалось пересоздать: ${data?.error || error?.message || "Неизвестная ошибка"}`);
        return;
      }

      const eventDataResp = (data.data as any)?.data || data.data;
      const newEventId = eventDataResp?.id;
      const newStreamId = eventDataResp?.stream?.id;

      if (!newEventId) {
        toast.error("Эфир создан, но ID не получен");
        return;
      }

      // 3. Update DB with new provider data (status will be confirmed by auto-sync)
      const newMeta = {
        ...existingMeta,
        kinescope_project_id: projectId || existingMeta.kinescope_project_id,
        kinescope_folder_id: folderId,
        provider_source_status: "ok", // will be confirmed by auto-sync
        provider_error_message: null,
        provider_status_code: null,
        provider: {
          current: {
            live_event_id: newEventId,
            stream_id: newStreamId,
            play_link: eventDataResp?.play_link,
            rtmp_link: eventDataResp?.rtmp_link,
            streamkey: eventDataResp?.streamkey,
            stream_status: eventDataResp?.stream?.status || "pending",
          },
        },
        provider_history: providerHistory,
        last_provider_sync_at: new Date().toISOString(),
      };

      await supabase.from("live_events").update({
        kinescope_live_event_id: newEventId,
        kinescope_stream_id: newStreamId || null,
        metadata: newMeta,
      } as any).eq("id", editingId);

      // 4. Audit
      try {
        await DomainEventService.emitEvent("live_provider_recreated", "admin", editingId, {
          platform_live_event_id: editingId,
          old_provider_live_event_id: current?.kinescope_live_event_id,
          new_provider_live_event_id: newEventId,
          old_stream_id: current?.kinescope_stream_id,
          new_stream_id: newStreamId,
          reason: "recreated",
          provider_source_status_before: providerSourceStatus,
          provider_source_status_after: "ok",
        });
      } catch {}

      // 5. Update local state and auto-sync to confirm
      setProviderSourceStatus("ok");
      setSyncStatus("idle");
      onFormUpdate?.({ kinescope_live_event_id: newEventId });

      toast.success("Эфир пересоздан в Kinescope", { description: `Новый ID: ${newEventId}` });
      refetchProvider();
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });

      // 6. Auto-sync the newly created event to confirm its state
      setTimeout(() => {
        handleSyncProvider();
      }, 1500);
    } catch (err: any) {
      toast.error(`Ошибка пересоздания: ${err.message || String(err)}`);
    } finally {
      setRecreating(false);
      setRecreateDialogOpen(false);
    }
  };

  // --- handleDetachProvider ---
  const handleDetachProvider = async () => {
    if (!editingId) return;
    setDetaching(true);
    try {
      const { data: current } = await supabase.from("live_events").select("metadata, kinescope_live_event_id, kinescope_stream_id").eq("id", editingId).single();
      const existingMeta = (current?.metadata as Record<string, any>) || {};
      const oldProvider = existingMeta.provider?.current || existingMeta.provider || {};
      const providerHistory = existingMeta.provider_history || [];

      if (current?.kinescope_live_event_id) {
        providerHistory.push({
          live_event_id: current.kinescope_live_event_id,
          stream_id: current.kinescope_stream_id,
          play_link: oldProvider.play_link,
          rtmp_link: oldProvider.rtmp_link,
          has_streamkey: !!oldProvider.streamkey,
          provider_stream_status: oldProvider.stream_status,
          detached_at: new Date().toISOString(),
          reason: "manual_reset",
        });
      }

      const newMeta: Record<string, any> = {
        ...existingMeta,
        provider: { current: {} },
        provider_history: providerHistory,
        provider_source_status: "draft",
        provider_error_message: null,
        provider_status_code: null,
        last_provider_sync_at: new Date().toISOString(),
      };
      // Keep folder_id and project_id at top level of metadata
      if (existingMeta.kinescope_folder_id) newMeta.kinescope_folder_id = existingMeta.kinescope_folder_id;
      if (existingMeta.kinescope_project_id) newMeta.kinescope_project_id = existingMeta.kinescope_project_id;

      await supabase.from("live_events").update({
        kinescope_live_event_id: null,
        kinescope_stream_id: null,
        metadata: newMeta,
      } as any).eq("id", editingId);

      // Audit
      try {
        await DomainEventService.emitEvent("live_provider_detached", "admin", editingId, {
          platform_live_event_id: editingId,
          old_provider_live_event_id: current?.kinescope_live_event_id,
          old_stream_id: current?.kinescope_stream_id,
          reason: "manual_reset",
          provider_source_status_before: providerSourceStatus,
          provider_source_status_after: "draft",
        });
      } catch {}

      setProviderSourceStatus("draft");
      setSyncStatus("idle");
      onFormUpdate?.({ kinescope_live_event_id: "" });

      toast.success("Привязка к Kinescope сброшена", {
        description: "Платформенный эфир сохранён. Можно привязать новый источник.",
      });
      refetchProvider();
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
    } catch (err: any) {
      toast.error(`Ошибка: ${err.message || String(err)}`);
    } finally {
      setDetaching(false);
      setDetachDialogOpen(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} скопировано`);
  };

  const isSourceAvailable = providerSourceStatus === "ok";
  const isSourceMissingOrBroken = providerSourceStatus === "missing" || providerSourceStatus === "broken";

  return (
    <div className="space-y-4 min-w-0">
      {/* Block A: Источник трансляции Kinescope — стандарт contact-card */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3 shadow-sm overflow-hidden min-w-0">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-primary/10 shrink-0">
            <Video className="h-4 w-4 text-primary" />
          </div>
          <h4 className="text-sm font-semibold text-foreground">Источник трансляции Kinescope</h4>
        </div>

        {/* Dual status badges */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Платформа:</span>
            <Badge variant="outline" className="text-xs">
              {platformStatusLabels[platformStatus] || platformStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Kinescope:</span>
            <Badge className={`text-xs ${providerSourceColors[providerSourceStatus]}`}>
              {providerSourceLabels[providerSourceStatus]}
            </Badge>
          </div>
        </div>

        {kinescopeLiveEventId && (
          <div className="space-y-1.5 min-w-0">
            <Label className="text-xs font-medium text-muted-foreground">ID источника</Label>
            <div className="flex items-stretch gap-1.5 min-w-0">
              <code className="flex-1 min-w-0 bg-muted/60 border border-border px-3 py-2 rounded-md text-xs font-mono break-all overflow-hidden">
                {kinescopeLiveEventId}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => copyToClipboard(kinescopeLiveEventId, "ID")}
                title="Скопировать"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        {lastSync && (
          <p className="text-xs text-muted-foreground">
            Последняя синхронизация: {format(new Date(lastSync), "dd.MM.yyyy HH:mm:ss", { locale: ru })}
          </p>
        )}

        {/* Warning for missing/broken */}
        {providerSourceStatus === "missing" && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/5 border border-destructive/20 p-2.5">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs space-y-1 min-w-0">
              <p className="font-medium text-destructive">Источник трансляции удалён в Kinescope</p>
              <p className="text-muted-foreground">Пересоздайте эфир или отвяжите источник.</p>
            </div>
          </div>
        )}
        {providerSourceStatus === "broken" && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/5 border border-amber-500/20 p-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1 min-w-0">
              <p className="font-medium text-amber-700">Источник трансляции повреждён</p>
              <p className="text-muted-foreground">Отсутствуют ключевые поля (stream, play_link). Попробуйте обновить или пересоздать.</p>
            </div>
          </div>
        )}
      </div>

      {/* Block B: OBS / Streaming settings — only if source is available */}
      {isSourceAvailable && (playLink || streamkey) && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4 shadow-sm overflow-hidden min-w-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 shrink-0">
              <Radio className="h-4 w-4 text-primary" />
            </div>
            <h4 className="text-sm font-semibold text-foreground">Настройки трансляции (OBS)</h4>
          </div>

          {playLink && (
            <ProviderField label="Ссылка для просмотра" value={playLink} onCopy={() => copyToClipboard(playLink, "Ссылка")} />
          )}
          <ProviderField label="RTMP сервер" value={rtmpLink} onCopy={() => copyToClipboard(rtmpLink, "RTMP")} />

          {streamkey && (
            <div className="space-y-1.5 min-w-0">
              <Label className="text-xs font-medium text-muted-foreground">Ключ трансляции</Label>
              <div className="flex items-stretch gap-1.5 min-w-0">
                <code className="flex-1 min-w-0 bg-muted/60 border border-border px-3 py-2 rounded-md text-xs font-mono break-all overflow-hidden">
                  {showStreamkey ? streamkey : "••••••••••••••••••••••••"}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => setShowStreamkey(!showStreamkey)}
                  title={showStreamkey ? "Скрыть" : "Показать"}
                >
                  {showStreamkey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={() => copyToClipboard(streamkey, "Ключ")}
                  title="Скопировать"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Block C: Actions — единый стандарт кнопок */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm min-w-0">
        <div className="flex flex-wrap gap-2">
          {/* Enable / Complete — only if source OK */}
          {editingId && isSourceAvailable && platformStatus !== "live" && platformStatus !== "ended" && (
            <Button variant="default" size="default" className="h-10 gap-2"
              onClick={() => onLifecycleAction(editingId, "enable_live_event", kinescopeLiveEventId)}>
              <Zap className="h-4 w-4" /> Запустить эфир
            </Button>
          )}
          {editingId && isSourceAvailable && platformStatus === "live" && (
            <Button variant="destructive" size="default" className="h-10 gap-2"
              onClick={() => onLifecycleAction(editingId, "complete_live_event", kinescopeLiveEventId)}>
              <Square className="h-4 w-4" /> Завершить эфир
            </Button>
          )}

          {/* Sync — always available if we have an ID */}
          {kinescopeLiveEventId && (
            <Button className={cn(LIFECYCLE_BUTTON_BASE, LIFECYCLE_BUTTON_TONES.info, LIFECYCLE_BUTTON_WIDTH_MIN)} onClick={handleSyncProvider} disabled={syncStatus === "syncing"}>
              {syncStatus === "syncing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить источник
            </Button>
          )}

          {/* Recreate */}
          <Button className={cn(LIFECYCLE_BUTTON_BASE, LIFECYCLE_BUTTON_TONES.warning, LIFECYCLE_BUTTON_WIDTH_MIN)} onClick={() => setRecreateDialogOpen(true)}
            disabled={!canRecreate || recreating}>
            <RotateCcw className="h-4 w-4" /> Пересоздать эфир
          </Button>

          {/* Detach — only if there's a provider bound */}
          {kinescopeLiveEventId && (
            <Button className={cn(LIFECYCLE_BUTTON_BASE, LIFECYCLE_BUTTON_TONES.warning, LIFECYCLE_BUTTON_WIDTH_MIN)} onClick={() => setDetachDialogOpen(true)}
              disabled={detaching}>
              <Unlink className="h-4 w-4" /> Отвязать источник
            </Button>
          )}
        </div>

        {/* Recreate blockers */}
        {!canRecreate && recreateBlockers.length > 0 && (
          <div className="text-xs text-muted-foreground space-y-0.5 mt-3">
            {recreateBlockers.map((b, i) => (
              <p key={i} className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" /> {b}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Confirm: Recreate */}
      <AlertDialog open={recreateDialogOpen} onOpenChange={setRecreateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Пересоздать эфир в Kinescope?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Будет создан новый источник трансляции. Текущая привязка будет сохранена в истории.</p>
              <ul className="list-disc pl-4 text-xs space-y-1">
                <li>Ссылка <code>/live/{form.slug || "..."}</code> сохранится</li>
                <li>Комментарии и вопросы не потеряются</li>
                <li>Будет заменён только источник трансляции</li>
                <li>Приглашения начнут работать после повторной проверки готовности</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecreateProvider} disabled={recreating}>
              {recreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Пересоздать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: Detach */}
      <AlertDialog open={detachDialogOpen} onOpenChange={setDetachDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сбросить привязку Kinescope?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Привязка к провайдеру будет удалена. Платформенный эфир сохранится.</p>
              <ul className="list-disc pl-4 text-xs space-y-1">
                <li>Ссылка <code>/live/{form.slug || "..."}</code> сохранится</li>
                <li>Комментарии и вопросы не потеряются</li>
                <li>Правила доступа и настройки приглашений сохранятся</li>
                <li>Эфир перейдёт в состояние «без источника» и может быть привязан заново</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDetachProvider} disabled={detaching} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {detaching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сбросить привязку
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Instruction block */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
          <ChevronDown className="h-3 w-3" />
          Инструкция для администратора и ведущего
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-4">
          <div className="rounded-lg border p-3 space-y-2">
            <h4 className="text-xs font-semibold text-foreground/80">Для администратора</h4>
            <ol className="list-decimal pl-4 text-xs text-muted-foreground space-y-1">
              <li>Создайте эфир, выберите тип «Живой эфир»</li>
              <li>Выберите папку для трансляций и проект для записи</li>
              <li>Создайте источник в Kinescope</li>
              <li>Задайте дату, время, правила доступа</li>
              <li>Настройте уведомления: шаблон, каналы, сроки</li>
              <li>Сохраните эфир</li>
              <li>Опубликуйте эфир</li>
              <li>Перед стартом проверьте статус источника</li>
              <li>В момент старта — нажмите «Запустить эфир»</li>
              <li>После завершения — «Завершить эфир» → «Обновить источник»</li>
            </ol>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <h4 className="text-xs font-semibold text-foreground/80">Для ведущего / преподавателя</h4>
            <ol className="list-decimal pl-4 text-xs text-muted-foreground space-y-1">
              <li>Откройте карточку эфира в админке</li>
              <li>Скопируйте RTMP сервер и Ключ трансляции</li>
              <li>В OBS: Настройки → Вещание → Сервис: Пользовательский</li>
              <li>Вставьте RTMP сервер и ключ трансляции</li>
              <li>Запустите трансляцию в OBS</li>
              <li>Ведите эфир</li>
              <li>По окончании остановите OBS, со стороны админки — завершить эфир и синхронизировать</li>
            </ol>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* P2: для нового эфира — callout, где потом искать настройки заставки/музыки. */}
      {!editingId && (
        <>
          <Separator />
          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="text-xs text-foreground">
              После сохранения эфира под формой появится вкладка{" "}
              <span className="font-semibold">«Заставка и комната»</span> — там
              настраивается обложка, музыка и обратный отсчёт до старта.
            </div>
          </div>
        </>
      )}

      {/* Level-2 tabs (Комната / Комментарии / ... / Тема) перенесены
          в карточку эфира → вкладка «Дополнительно». Здесь дубль удалён. */}
    </div>
  );
}

function ProviderField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="flex items-stretch gap-1.5 min-w-0">
        <code className="flex-1 min-w-0 bg-muted/60 border border-border px-3 py-2 rounded-md text-xs font-mono break-all overflow-hidden">
          {value}
        </code>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onCopy}
          title="Скопировать"
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Sprint 2 PATCH 2.3 + 2.6: room state badge + active participants counter в одной ячейке.
// Использует общий VM-маппер (PATCH 2.7) — чтобы список / карточка / комната не расходились.
function RoomStateCell({ event }: { event: LiveEvent }) {
  const state = parseRoomState(event.room_state);
  const vm = getRoomStateBadgeVM(state);
  const { data: activeCount } = useActiveParticipants(event.id, state === "opened" || state === "live");
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={vm.variant} className={vm.pulse ? "animate-pulse" : ""}>
        {vm.shortLabel}
      </Badge>
      {(state === "opened" || state === "live") && typeof activeCount === "number" && (
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1" title="Активные участники за последние 2 минуты">
          <Users className="h-3 w-3" /> {activeCount}
        </span>
      )}
    </div>
  );
}
