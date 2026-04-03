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
import { Plus, Edit2, Loader2, Video, ExternalLink, ChevronDown, AlertCircle, CheckCircle2, Users, Link2, PlayCircle, Shield, Radio, Zap, Square, RefreshCw, Send, Copy, Eye, EyeOff, MessageSquare, HelpCircle, Unlink, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { slugify } from "@/utils/slugify";
import { LiveEventAccessRulesEditor, type AccessRuleRow } from "@/components/admin/live/LiveEventAccessRulesEditor";
import { LiveEventComments } from "@/components/live/LiveEventComments";
import { LiveEventQuestions } from "@/components/live/LiveEventQuestions";
import { DomainEventService } from "@/lib/domain-events";

type EventType = "live_stream" | "recorded_webinar";
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [publishAttempted, setPublishAttempted] = useState(false);
  const [creatingLiveEvent, setCreatingLiveEvent] = useState(false);

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
        .select("product_id, tariff_id, sort_order")
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

  // --- Validation ---
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
    } else {
      items.push(
        { key: "kinescope", label: "Источник видео привязан", ok: !!form.kinescope_video_id.trim(), blocker: true },
      );
    }

    items.push(
      { key: "access", label: "Указано, кто может войти на эфир", ok: form.access_rules.filter(r => r.product_id).length > 0, blocker: true },
      { key: "replay", label: "Запись будет доступна после завершения", ok: form.replay_enabled, blocker: false },
    );

    return items;
  }, [form, isLiveStream]);

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
        setForm(f => ({ ...f, kinescope_live_event_id: eventId }));
        
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
              live_event_id: eventId,
              stream_id: streamId,
              play_link: playLink,
              rtmp_link: rtmpLink,
              streamkey: streamkey,
              stream_status: streamStatus,
              raw_create_response: eventData,
            },
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
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
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

      const sourceKind: SourceKind = data.event_type === "live_stream" ? "kinescope_live_event" : "kinescope_video";

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
      }

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
        event_type: data.event_type,
        source_kind: sourceKind,
        event_timezone: data.event_timezone,
        platform_status: data.status,
        kinescope_live_event_id: data.kinescope_live_event_id || null,
        kinescope_project_id: data.kinescope_project_id || null,
        metadata: mergedMetadata,
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
    setForm({
      slug: event.slug,
      title: event.title,
      description: event.description || "",
      kinescope_video_id: event.kinescope_video_id || "",
      kinescope_mode: event.kinescope_video_id ? "picker" : "picker",
      kinescope_project_id: event.kinescope_project_id || (event.metadata as any)?.kinescope_project_id || "",
      kinescope_folder_id: (event.metadata as any)?.kinescope_folder_id || "",
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
            <p className="text-sm text-muted-foreground">Управление живыми эфирами и автовебинарами</p>
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
                    <TableHead>Тип</TableHead>
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
                      <TableCell>
                        <Badge variant={event.event_type === "live_stream" ? "default" : "secondary"} className="text-[10px]">
                          {event.event_type === "live_stream" ? (
                            <><Radio className="h-3 w-3 mr-1" />Живой эфир</>
                          ) : (
                            <><Video className="h-3 w-3 mr-1" />Видео</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{platformStatusLabels[event.platform_status] || event.platform_status}</Badge>
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
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleEdit(event)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => window.open(`/live/${event.slug}`, "_blank")}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          {event.event_type === "live_stream" && event.kinescope_live_event_id && (
                            <>
                              {event.platform_status === "scheduled" && (
                                <Button variant="ghost" size="sm" title="Запустить эфир"
                                  onClick={() => handleLifecycleAction(event.id, "enable_live_event", event.kinescope_live_event_id!)}>
                                  <Zap className="h-4 w-4 text-green-600" />
                                </Button>
                              )}
                              {event.platform_status === "live" && (
                                <Button variant="ghost" size="sm" title="Завершить эфир"
                                  onClick={() => handleLifecycleAction(event.id, "complete_live_event", event.kinescope_live_event_id!)}>
                                  <Square className="h-4 w-4 text-red-600" />
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" title="Обновить статус"
                                onClick={() => handleLifecycleAction(event.id, "sync_live_event", event.kinescope_live_event_id!)}>
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                            </>
                          )}
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
                      <SelectContent>
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

              <Separator />

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
                              <SelectContent>
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
                              <SelectContent>
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
                              <SelectContent>
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
                                <SelectContent>
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

  // Determine provider source status from local state
  useEffect(() => {
    if (!kinescopeLiveEventId) {
      setProviderSourceStatus("draft");
    } else {
      // Default to ok if we have an ID, will be refined by sync
      if (providerSourceStatus === "draft") setProviderSourceStatus("ok");
    }
  }, [kinescopeLiveEventId]);

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

      // Handle missing (404)
      if (returnedSourceStatus === "missing") {
        setSyncStatus("error");
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
        return;
      }

      if (returnedSourceStatus === "broken") {
        setSyncStatus("error");
        toast.warning("Источник трансляции повреждён", {
          description: syncData?.provider_error_message || "Отсутствуют stream или play_link",
          duration: 6000,
        });
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
        last_provider_sync_at: new Date().toISOString(),
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

      // 3. Update DB with new provider data
      const newMeta = {
        ...existingMeta,
        kinescope_project_id: projectId || existingMeta.kinescope_project_id,
        kinescope_folder_id: folderId,
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

      // 5. Update local state
      setProviderSourceStatus("ok");
      setSyncStatus("idle");
      onFormUpdate?.({ kinescope_live_event_id: newEventId });

      toast.success("Эфир пересоздан в Kinescope", { description: `Новый ID: ${newEventId}` });
      refetchProvider();
      queryClient.invalidateQueries({ queryKey: ["admin-live-events"] });
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

      const newMeta = {
        ...existingMeta,
        provider: { current: {} },
        provider_history: providerHistory,
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
    <div className="space-y-4">
      {/* Block A: Источник трансляции Kinescope */}
      <div className="rounded-lg border p-3 space-y-3">
        <h4 className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
          Источник трансляции Kinescope
        </h4>

        {/* Dual status badges */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Платформа:</span>
            <Badge variant="outline" className="text-[10px]">
              {platformStatusLabels[platformStatus] || platformStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Kinescope:</span>
            <Badge className={`text-[10px] ${providerSourceColors[providerSourceStatus]}`}>
              {providerSourceLabels[providerSourceStatus]}
            </Badge>
          </div>
        </div>

        {kinescopeLiveEventId && (
          <p className="text-xs text-muted-foreground">
            ID: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{kinescopeLiveEventId}</code>
          </p>
        )}
        {lastSync && (
          <p className="text-[10px] text-muted-foreground">
            Последняя синхронизация: {format(new Date(lastSync), "dd.MM.yyyy HH:mm:ss", { locale: ru })}
          </p>
        )}

        {/* Warning for missing/broken */}
        {providerSourceStatus === "missing" && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/5 border border-destructive/20 p-2.5">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-destructive">Источник трансляции удалён в Kinescope</p>
              <p className="text-muted-foreground">Пересоздайте эфир или отвяжите источник.</p>
            </div>
          </div>
        )}
        {providerSourceStatus === "broken" && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/5 border border-amber-500/20 p-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-medium text-amber-700">Источник трансляции повреждён</p>
              <p className="text-muted-foreground">Отсутствуют ключевые поля (stream, play_link). Попробуйте обновить или пересоздать.</p>
            </div>
          </div>
        )}
      </div>

      {/* Block B: OBS / Streaming settings — only if source is available */}
      {isSourceAvailable && (playLink || streamkey) && (
        <div className="rounded-lg border p-3 space-y-3">
          <h4 className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" /> Настройки трансляции (OBS)
          </h4>
          
          {playLink && (
            <ProviderField label="Ссылка для просмотра" value={playLink} onCopy={() => copyToClipboard(playLink, "Ссылка")} />
          )}
          <ProviderField label="RTMP сервер" value={rtmpLink} onCopy={() => copyToClipboard(rtmpLink, "RTMP")} />
          
          {streamkey && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Ключ трансляции</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-2 py-1.5 rounded text-[11px] font-mono break-all">
                  {showStreamkey ? streamkey : "••••••••••••••••"}
                </code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setShowStreamkey(!showStreamkey)}>
                  {showStreamkey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyToClipboard(streamkey, "Ключ")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Block C: Actions */}
      <div className="flex flex-wrap gap-2">
        {/* Enable / Complete — only if source OK */}
        {editingId && isSourceAvailable && platformStatus !== "live" && platformStatus !== "ended" && (
          <Button variant="outline" size="sm" className="gap-1.5"
            onClick={() => onLifecycleAction(editingId, "enable_live_event", kinescopeLiveEventId)}>
            <Zap className="h-3.5 w-3.5" /> Запустить эфир
          </Button>
        )}
        {editingId && isSourceAvailable && platformStatus === "live" && (
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive"
            onClick={() => onLifecycleAction(editingId, "complete_live_event", kinescopeLiveEventId)}>
            <Square className="h-3.5 w-3.5" /> Завершить эфир
          </Button>
        )}

        {/* Sync — always available if we have an ID */}
        {kinescopeLiveEventId && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSyncProvider} disabled={syncStatus === "syncing"}>
            {syncStatus === "syncing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить источник
          </Button>
        )}

        {/* Recreate */}
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRecreateDialogOpen(true)}
          disabled={!canRecreate || recreating}>
          <RotateCcw className="h-3.5 w-3.5" /> Пересоздать эфир
        </Button>

        {/* Detach — only if there's a provider bound */}
        {kinescopeLiveEventId && (
          <Button variant="outline" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setDetachDialogOpen(true)}
            disabled={detaching}>
            <Unlink className="h-3.5 w-3.5" /> Отвязать источник
          </Button>
        )}
      </div>

      {/* Recreate blockers */}
      {!canRecreate && recreateBlockers.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {recreateBlockers.map((b, i) => (
            <p key={i} className="flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {b}
            </p>
          ))}
        </div>
      )}

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

      {/* Comments & Questions tabs */}
      {editingId && (
        <>
          <Separator />
          <Tabs defaultValue="comments" className="w-full">
            <TabsList>
              <TabsTrigger value="comments" className="gap-1.5 text-xs">
                <MessageSquare className="h-3 w-3" /> Комментарии
              </TabsTrigger>
              <TabsTrigger value="questions" className="gap-1.5 text-xs">
                <HelpCircle className="h-3 w-3" /> Вопросы
              </TabsTrigger>
            </TabsList>
            <TabsContent value="comments" className="border rounded-lg mt-2">
              <LiveEventComments liveEventId={editingId} />
            </TabsContent>
            <TabsContent value="questions" className="border rounded-lg mt-2">
              <LiveEventQuestions liveEventId={editingId} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function ProviderField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-muted px-2 py-1.5 rounded text-[11px] font-mono break-all">{value}</code>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onCopy}>
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
