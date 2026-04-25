import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Send,
  Mail,
  MessageCircle,
  Users,
  Filter,
  Loader2,
  History,
  CheckCircle,
  XCircle,
  Sparkles,
  Eye,
  ChevronRight,
  Image,
  Video,
  Music,
  Circle,
  X,
  Paperclip,
  AlertTriangle,
  ExternalLink,
  MousePointerClick,
  Clock,
  CalendarIcon,
  Repeat,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { BroadcastTemplatesSection } from "./BroadcastTemplatesSection";
import { ScheduledBroadcastsSection } from "./scheduled/ScheduledBroadcastsSection";

import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";
import { RuleListEditor } from "./RuleListEditor";

type AudienceMode = "purchased" | "active_access";

interface AudienceRule {
  product_id: string;     // "" = любой продукт
  tariff_ids: string[];   // [] = все тарифы
  mode: AudienceMode;
}

interface BroadcastFilters {
  include: AudienceRule[];
  exclude: AudienceRule[];
  club_ids: string[];
  club_membership: "current" | "ever" | "any";
  bot_ids: string[];      // [] = primary bot
  channels?: ("telegram" | "email")[];
}

interface AudiencePreview {
  telegramCount: number;
  emailCount: number;
  totalCount: number;
  users: Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    telegram_username: string | null;
    has_telegram: boolean;
    has_email: boolean;
  }>;
}

const EMPTY_RULE: AudienceRule = { product_id: "", tariff_ids: [], mode: "purchased" };

type MediaType = "photo" | "video" | "audio" | "video_note" | null;

interface MediaFile {
  type: MediaType;
  file: File;
  preview?: string;
}

type SendMode = "now" | "scheduled" | "recurring";
type Frequency = "daily" | "weekly" | "monthly";

interface RecurrenceRule {
  frequency: Frequency;
  interval: number;
  time_of_day: string; // "HH:MM"
  by_weekday?: number[]; // 1..7 Mon..Sun, only for weekly
  ends_at?: string | null;
  timezone?: string;
}

const DEFAULT_RECURRENCE: RecurrenceRule = {
  frequency: "weekly",
  interval: 1,
  time_of_day: "10:00",
  by_weekday: [1],
  timezone: "Europe/Minsk",
};

export function BroadcastsTabContent() {
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<"templates" | "quick" | "scheduled">("templates");
  // Sprint B rev3 — фаза 2: id шаблона в режиме редактирования (открывается из «Запланированные»)
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null);

  // Channel toggles — независимые: можно отправить TG-only / Email-only / TG+Email одновременно
  const [sendToTelegram, setSendToTelegram] = useState(true);
  const [sendToEmail, setSendToEmail] = useState(false);

  // Send mode
  const [sendMode, setSendMode] = useState<SendMode>("now");
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [scheduledTime, setScheduledTime] = useState<string>("10:00");
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(DEFAULT_RECURRENCE);
  const [scheduledName, setScheduledName] = useState<string>("");

  // Composer (TG+Email общие поля; для каждого канала — свои контентные поля)
  const [message, setMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [includeButton, setIncludeButton] = useState(true);
  const [buttonText, setButtonText] = useState("Открыть платформу");
  const [buttonUrl, setButtonUrl] = useState("https://club.gorbova.by/products");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<MediaFile | null>(null);
  const [selectedBroadcast, setSelectedBroadcast] = useState<Record<string, unknown> | null>(null);


  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState<BroadcastFilters>({
    include: [],
    exclude: [],
    club_ids: [],
    club_membership: "current",
    bot_ids: [],
  });

  // Build RPC payload (channels derived from active tab)
  const rpcFilters = useMemo(() => ({
    channels: ["telegram", "email"],
    include: filters.include,
    exclude: filters.exclude,
    club_ids: filters.club_ids,
    club_membership: filters.club_membership,
  }), [filters]);

  // cf warning: check if message/email contains cf.product tokens
  const hasCfTokens = useMemo(() => {
    const allText = message + emailSubject + emailBody;
    return allText.includes('{{cf.product.');
  }, [message, emailSubject, emailBody]);

  // Single product context for {{cf.product.*}} resolution:
  // only when there's exactly one include rule with a concrete product_id
  const productContextId = useMemo(() => {
    const concreteIncludes = filters.include.filter((r) => r.product_id);
    return concreteIncludes.length === 1 ? concreteIncludes[0].product_id : null;
  }, [filters.include]);

  const showCfWarning = hasCfTokens && !productContextId;

  // All product_ids referenced in include/exclude (for tariff fetch)
  const referencedProductIds = useMemo(() => {
    const ids = new Set<string>();
    [...filters.include, ...filters.exclude].forEach((r) => {
      if (r.product_id) ids.add(r.product_id);
    });
    return Array.from(ids);
  }, [filters]);

  // Fetch products
  const { data: products } = useQuery({
    queryKey: ["broadcast-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch tariffs for any referenced products
  const { data: tariffs } = useQuery({
    queryKey: ["broadcast-tariffs", referencedProductIds],
    queryFn: async () => {
      if (referencedProductIds.length === 0) return [];
      const { data } = await supabase
        .from("tariffs")
        .select("id, name, product_id")
        .in("product_id", referencedProductIds)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: referencedProductIds.length > 0,
  });

  // Fetch telegram clubs
  const { data: clubs } = useQuery({
    queryKey: ["broadcast-clubs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("telegram_clubs")
        .select("id, club_name")
        .eq("is_active", true)
        .order("club_name");
      return data || [];
    },
  });

  // Fetch active telegram bots
  const { data: bots } = useQuery({
    queryKey: ["broadcast-bots"],
    queryFn: async () => {
      const { data } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            eq: (c: string, v: string) => {
              order: (c: string, o: { ascending: boolean }) => Promise<{ data: Array<{ id: string; bot_name: string; bot_username: string; is_primary: boolean }> | null }>;
            };
          };
        };
      })
        .from("telegram_bots")
        .select("id, bot_name, bot_username, is_primary")
        .eq("status", "active")
        .order("bot_name", { ascending: true });
      return data || [];
    },
  });

  // Audience preview via RPC (single source of truth, used by edge funcs too)
  const { data: audience, isLoading: audienceLoading } = useQuery({
    queryKey: ["broadcast-audience-rpc", rpcFilters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_broadcast_audience", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _filters: rpcFilters as any,
      });
      if (error) {
        console.error("[broadcast] audience rpc error", error);
        return { telegramCount: 0, emailCount: 0, totalCount: 0, users: [] } as AudiencePreview;
      }
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        telegramCount: Number(r.telegram_count || 0),
        emailCount: Number(r.email_count || 0),
        totalCount: Number(r.total_count || 0),
        users: (r.users as AudiencePreview["users"]) || [],
      } satisfies AudiencePreview;
    },
    refetchInterval: false,
  });

  const { data: historyItems } = useQuery({
    queryKey: ["broadcast-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .in("action", ["telegram_mass_broadcast", "email_mass_broadcast"])
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });
  const history = historyItems;

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: MediaType) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = type === "video" ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Файл слишком большой. Максимум: ${type === "video" ? "50" : "10"} МБ`);
      return;
    }

    let preview: string | undefined;
    if (type === "photo" || type === "video") {
      preview = URL.createObjectURL(file);
    }

    setMediaFile({ type, file, preview });
  };

  const removeMedia = () => {
    if (mediaFile?.preview) {
      URL.revokeObjectURL(mediaFile.preview);
    }
    setMediaFile(null);
  };

  // Send Telegram broadcast
  const sendTelegramMutation = useMutation({
    mutationFn: async () => {
      if (mediaFile) {
        const formData = new FormData();
        formData.append("message", message.trim().replace(/\[\[align:(left|center|right)\]\]/g, ""));
        formData.append("include_button", String(includeButton));
        if (includeButton) {
          formData.append("button_text", buttonText);
          formData.append("button_url", buttonUrl);
        }
        formData.append("filters", JSON.stringify(filters));
        formData.append("media_type", mediaFile.type || "");
        formData.append("media", mediaFile.file);

        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-mass-broadcast`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: formData,
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to send broadcast");
        }

        return response.json();
      }

      const { data, error } = await supabase.functions.invoke("telegram-mass-broadcast", {
        body: {
          message: message.trim().replace(/\[\[align:(left|center|right)\]\]/g, ""),
          include_button: includeButton,
          button_text: includeButton ? buttonText : undefined,
          button_url: includeButton ? buttonUrl : undefined,
          filters,
          product_context_id: productContextId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      setMessage("");
      removeMedia();
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  // Send Email broadcast
  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("email-mass-broadcast", {
        body: {
          subject: emailSubject.trim(),
          html: emailBody.trim(),
          filters,
          product_context_id: productContextId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      setEmailSubject("");
      setEmailBody("");
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  // Send test message to admin
  const sendTestMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bots } = await (supabase as any)
        .from("telegram_bots")
        .select("id")
        .eq("status", "active")
        .limit(1);
      
      if (!bots?.length) throw new Error("Нет активного бота");
      
      const { data, error } = await supabase.functions.invoke("telegram-send-test", {
        body: {
          botId: bots[0].id,
          messageText: message.trim().replace(/\[\[align:(left|center|right)\]\]/g, ""),
          buttonText: includeButton ? buttonText : undefined,
          buttonUrl: includeButton ? buttonUrl : undefined,
          product_context_id: productContextId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Тестовое сообщение отправлено вам в Telegram");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  // ===== Sprint B rev3 — Phase 2: scheduled/recurring persistence =====
  const composeScheduledAt = useCallback((): string | null => {
    if (!scheduledAt) return null;
    const [h, m] = scheduledTime.split(":").map((x) => parseInt(x, 10));
    const d = new Date(scheduledAt);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toISOString();
  }, [scheduledAt, scheduledTime]);

  const channelsArr = useMemo<("telegram" | "email")[]>(() => {
    const arr: ("telegram" | "email")[] = [];
    if (sendToTelegram) arr.push("telegram");
    if (sendToEmail) arr.push("email");
    return arr;
  }, [sendToTelegram, sendToEmail]);

  // Hydrate composer from existing template when editTemplateId is set
  useEffect(() => {
    if (!editTemplateId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("broadcast_templates")
        .select("*")
        .eq("id", editTemplateId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Не удалось загрузить шаблон для редактирования");
        setEditTemplateId(null);
        return;
      }
      const tpl = data as Record<string, unknown>;
      const ch = (tpl.channels as string[]) || [];
      setSendToTelegram(ch.includes("telegram"));
      setSendToEmail(ch.includes("email"));
      setScheduledName(String(tpl.name || ""));
      setMessage(String(tpl.message_text || ""));
      setEmailSubject(String(tpl.email_subject || ""));
      setEmailBody(String(tpl.email_body_html || ""));
      const btnUrl = (tpl.button_url as string) || "";
      const btnText = (tpl.button_text as string) || "";
      setIncludeButton(!!btnUrl);
      if (btnText) setButtonText(btnText);
      if (btnUrl) setButtonUrl(btnUrl);
      const af = (tpl.audience_filters as Record<string, unknown>) || {};
      if (af.include || af.exclude || af.club_ids) {
        setFilters({
          include: ((af.include as AudienceRule[]) || []),
          exclude: ((af.exclude as AudienceRule[]) || []),
          club_ids: ((af.club_ids as string[]) || []),
          club_membership: ((af.club_membership as "current" | "ever" | "any") || "current"),
          bot_ids: ((af.bot_ids as string[]) || []),
        });
      }
      const mode = String(tpl.send_mode || "manual");
      if (mode === "scheduled") {
        setSendMode("scheduled");
        const sf = tpl.scheduled_for ? new Date(tpl.scheduled_for as string) : null;
        if (sf) {
          setScheduledAt(sf);
          setScheduledTime(format(sf, "HH:mm"));
        }
      } else if (mode === "recurring") {
        setSendMode("recurring");
        const rule = (tpl.recurrence_rule as RecurrenceRule) || DEFAULT_RECURRENCE;
        setRecurrence({ ...DEFAULT_RECURRENCE, ...rule });
      } else {
        setSendMode("now");
      }
      toast.info(`Загружен шаблон «${tpl.name}» для редактирования`);
    })();
    return () => {
      cancelled = true;
    };
  }, [editTemplateId]);

  // Save scheduled/recurring template (INSERT or UPDATE — без дубля)
  const saveScheduledMutation = useMutation({
    mutationFn: async () => {
      const isRecurring = sendMode === "recurring";
      const payload: Record<string, unknown> = {
        name: scheduledName.trim() || `Рассылка ${format(new Date(), "dd.MM.yyyy HH:mm")}`,
        channel: channelsArr[0] || "telegram",
        channels: channelsArr,
        template_type: "general",
        message_text: sendToTelegram ? message.trim() : null,
        button_text: sendToTelegram && includeButton ? buttonText : null,
        button_url: sendToTelegram && includeButton ? buttonUrl : null,
        email_subject: sendToEmail ? emailSubject.trim() : null,
        email_body_html: sendToEmail ? emailBody.trim() : null,
        audience_filters: filters as unknown as Record<string, unknown>,
        send_mode: isRecurring ? "recurring" : "scheduled",
        status: "scheduled",
        recurrence_rule: isRecurring ? (recurrence as unknown as Record<string, unknown>) : null,
        scheduled_for: isRecurring ? null : composeScheduledAt(),
      };

      let nextRunAt: string | null = null;
      if (isRecurring) {
        const { data: nextTs, error: rpcErr } = await supabase.rpc(
          "compute_next_broadcast_run",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { rule: recurrence as any, from_ts: new Date().toISOString() },
        );
        if (rpcErr) throw rpcErr;
        nextRunAt = (nextTs as string | null) ?? null;
      } else {
        nextRunAt = composeScheduledAt();
      }
      payload.next_run_at = nextRunAt;

      if (editTemplateId) {
        const { error } = await supabase
          .from("broadcast_templates")
          .update(payload)
          .eq("id", editTemplateId);
        if (error) throw error;
        return { id: editTemplateId, mode: "update" as const };
      }
      const { data, error } = await supabase
        .from("broadcast_templates")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string, mode: "insert" as const };
    },
    onSuccess: (res) => {
      toast.success(
        res.mode === "update"
          ? "Запланированная рассылка обновлена"
          : sendMode === "recurring"
          ? "Повторяющаяся рассылка создана"
          : "Рассылка запланирована",
      );
      queryClient.invalidateQueries({ queryKey: ["scheduled-broadcasts"] });
      setEditTemplateId(null);
      setSendMode("now");
      setScheduledAt(null);
      setScheduledName("");
      setMainTab("scheduled");
    },
    onError: (err) => {
      toast.error("Ошибка сохранения: " + (err as Error).message);
    },
  });

  const handleSend = () => {
    if (!sendToTelegram && !sendToEmail) {
      toast.error("Выберите хотя бы один канал: Telegram или Email");
      return;
    }
    if (sendToTelegram && !message.trim() && !mediaFile) {
      toast.error("Введите текст сообщения или добавьте медиа для Telegram");
      return;
    }
    if (sendToEmail && (!emailSubject.trim() || !emailBody.trim())) {
      toast.error("Заполните тему и текст письма для Email");
      return;
    }

    if (sendMode === "now") {
      // Принцип Фазы 2: НЕ переписываем quick-send mutations, оборачиваем режимом send_now.
      if (sendToTelegram) sendTelegramMutation.mutate();
      if (sendToEmail) sendEmailMutation.mutate();
      return;
    }

    if (sendMode === "scheduled") {
      const ts = composeScheduledAt();
      if (!ts) {
        toast.error("Выберите дату и время отправки");
        return;
      }
      if (new Date(ts).getTime() <= Date.now()) {
        toast.error("Дата отправки должна быть в будущем");
        return;
      }
    }
    saveScheduledMutation.mutate();
  };

  const isSendDisabled =
    (!sendToTelegram && !sendToEmail) ||
    sendTelegramMutation.isPending ||
    sendEmailMutation.isPending ||
    saveScheduledMutation.isPending;

  return (
    <div className="container max-w-6xl py-6 space-y-6 overflow-auto h-full">
      {/* Main Tabs: Templates vs Quick Send */}
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "templates" | "quick" | "scheduled")}>
        <TabsList>
          <TabsTrigger value="templates">📋 Шаблоны</TabsTrigger>
          <TabsTrigger value="quick">⚡ Быстрая рассылка</TabsTrigger>
          <TabsTrigger value="scheduled">📅 Запланированные</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <BroadcastTemplatesSection />
        </TabsContent>

        <TabsContent value="scheduled" className="mt-6">
          <ScheduledBroadcastsSection
            onEdit={(id) => {
              setEditTemplateId(id);
              setMainTab("quick");
              // TODO (Sprint B rev3 — фаза 2): гидратация composer'а из broadcast_templates по editTemplateId
              toast.info("Открытие редактирования: фаза 2 (гидратация composer'а)");
            }}
          />
        </TabsContent>

        <TabsContent value="quick" className="mt-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Channel Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "telegram" | "email")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="telegram" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                Telegram
                {audience && (
                  <Badge variant="secondary" className="ml-1">
                    {audience.telegramCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-2">
                <Mail className="h-4 w-4" />
                Email
                {audience && (
                  <Badge variant="secondary" className="ml-1">
                    {audience.emailCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="telegram" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Telegram-рассылка</CardTitle>
                  <CardDescription>
                    Сообщение будет отправлено всем пользователям с привязанным Telegram
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Media attachment */}
                  {mediaFile ? (
                    <div className="relative rounded-lg border p-3 bg-muted/50">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={removeMedia}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="flex items-center gap-3">
                        {mediaFile.type === "photo" && mediaFile.preview && (
                          <img
                            src={mediaFile.preview}
                            alt="Preview"
                            className="w-20 h-20 object-cover rounded"
                          />
                        )}
                        {mediaFile.type === "video" && (
                          <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                            <Video className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        {mediaFile.type === "audio" && (
                          <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                            <Music className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        {mediaFile.type === "video_note" && (
                          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center">
                            <Circle className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{mediaFile.file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(mediaFile.file.size / 1024 / 1024).toFixed(2)} МБ
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          accept="image/*,video/*,audio/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const type = file.type.startsWith("image/")
                                ? "photo"
                                : file.type.startsWith("video/")
                                ? "video"
                                : file.type.startsWith("audio/")
                                ? "audio"
                                : null;
                              if (type) {
                                handleFileSelect(e, type);
                              }
                            }
                          }}
                        />
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                              <Paperclip className="h-4 w-4" />
                              Вложение
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-40 p-2" align="start">
                            <div className="space-y-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "image/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Image className="h-4 w-4" />
                                Фото
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "video/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Video className="h-4 w-4" />
                                Видео
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "audio/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Music className="h-4 w-4" />
                                Аудио
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "video/mp4";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Circle className="h-4 w-4" />
                                Кружок
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <span className="text-xs text-muted-foreground">
                          до 10 МБ, видео до 50 МБ
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Текст сообщения {mediaFile && "(подпись)"}</Label>
                    <TokenizedRichInput
                      value={message}
                      onChange={setMessage}
                      placeholder="Введите текст сообщения для рассылки..."
                      rows={6}
                    />
                    {showCfWarning && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          Для подстановки полей продукта выберите конкретный продукт в фильтре справа.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>


                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="includeButton"
                        checked={includeButton}
                        onCheckedChange={setIncludeButton}
                      />
                      <Label htmlFor="includeButton" className="cursor-pointer">
                        Добавить кнопку-ссылку
                      </Label>
                    </div>
                  </div>

                  {includeButton && (
                    <div className="space-y-3 pl-4 border-l-2 border-muted">
                      <div className="space-y-2">
                        <Label>Текст кнопки</Label>
                        <Input
                          value={buttonText}
                          onChange={(e) => setButtonText(e.target.value)}
                          placeholder="Открыть платформу"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>URL кнопки</Label>
                        <Input
                          value={buttonUrl}
                          onChange={(e) => setButtonUrl(e.target.value)}
                          placeholder="https://club.gorbova.by/products"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="email" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Email-рассылка</CardTitle>
                  <CardDescription>
                    Письмо будет отправлено на указанные email-адреса
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Тема письма</Label>
                    <TokenizedRichInput
                      value={emailSubject}
                      onChange={setEmailSubject}
                      placeholder="Тема письма..."
                      singleLine
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Текст письма (HTML)</Label>
                    <TokenizedRichInput
                      value={emailBody}
                      onChange={setEmailBody}
                      placeholder="<h1>Заголовок</h1><p>Текст письма...</p>"
                      rows={8}
                      allowAlign
                    />
                  </div>

                  {showCfWarning && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Для подстановки полей продукта выберите конкретный продукт в фильтре справа.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Send Buttons */}
          <div className="flex gap-2">
            {activeTab === "telegram" && (
              <Button
                variant="outline"
                onClick={() => sendTestMutation.mutate()}
                disabled={!message.trim() || sendTestMutation.isPending}
              >
                {sendTestMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                🧪 Тест себе
              </Button>
            )}
            <Button
              size="lg"
              className="flex-1 gap-2"
              onClick={handleSend}
              disabled={isSendDisabled}
            >
              {(sendTelegramMutation.isPending || sendEmailMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Отправить {activeTab === "telegram" ? "в Telegram" : "на Email"}
                  {audience && (
                    <Badge variant="secondary" className="ml-2">
                      {activeTab === "telegram" ? audience.telegramCount : audience.emailCount} получателей
                    </Badge>
                  )}
                </>
              )}
            </Button>
          </div>

          {/* History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                История рассылок
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Пока нет отправленных рассылок
                </p>
              ) : (
                <div className="space-y-3">
                  {history?.map((item) => {
                    const meta = item.meta as Record<string, unknown> | null;
                    const sent = Number(meta?.sent || 0);
                    const failed = Number(meta?.failed || 0);
                    const isTelegram = item.action === "telegram_mass_broadcast";

                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelectedBroadcast({ ...item, _meta: meta })}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors w-full text-left cursor-pointer"
                      >
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            isTelegram ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                          }`}
                        >
                          {isTelegram ? (
                            <MessageCircle className="h-5 w-5" />
                          ) : (
                            <Mail className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {String(meta?.message_preview || meta?.subject || "Рассылка")
                              .replace(/[,\s]*\{\{(?:\w+(?:\.\w+)*)\}\}[,\s]*/g, ' ')
                              .replace(/\s{2,}/g, ' ')
                              .trim() || "Рассылка"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.created_at), "dd MMM yyyy, HH:mm", {
                              locale: ru,
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            {sent}
                          </Badge>
                          {failed > 0 && (
                            <Badge variant="outline" className="gap-1">
                              <XCircle className="h-3 w-3 text-red-500" />
                              {failed}
                            </Badge>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Filters & Preview */}
        <div className="space-y-6">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Фильтры аудитории
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Include rules */}
              <RuleListEditor
                title="Включить"
                emptyHint="Все продукты (вся база)"
                rules={filters.include}
                products={products || []}
                tariffs={tariffs || []}
                onChange={(next) => setFilters((f) => ({ ...f, include: next }))}
              />

              <Separator />

              {/* Exclude rules */}
              <RuleListEditor
                title="Исключить"
                emptyHint="Никого не исключать"
                rules={filters.exclude}
                products={products || []}
                tariffs={tariffs || []}
                onChange={(next) => setFilters((f) => ({ ...f, exclude: next }))}
                destructive
              />

              <Separator />

              {/* Telegram clubs (multi) */}
              <div className="space-y-2">
                <Label>Telegram-клубы</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start font-normal">
                      {filters.club_ids.length === 0
                        ? "Все клубы / без фильтра"
                        : `Выбрано: ${filters.club_ids.length}`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="start">
                    <div className="space-y-2">
                      {clubs?.map((c) => (
                        <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={filters.club_ids.includes(c.id)}
                            onCheckedChange={(checked) => {
                              setFilters((f) => ({
                                ...f,
                                club_ids: checked
                                  ? [...f.club_ids, c.id]
                                  : f.club_ids.filter((id) => id !== c.id),
                              }));
                            }}
                          />
                          <span className="text-sm">{c.club_name}</span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                {filters.club_ids.length > 0 && (
                  <Select
                    value={filters.club_membership}
                    onValueChange={(v) =>
                      setFilters((f) => ({ ...f, club_membership: v as "current" | "ever" | "any" }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">Состоят сейчас</SelectItem>
                      <SelectItem value="ever">Состояли когда-либо</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>

              <Separator />

              {/* Bot selection (multi) */}
              <div className="space-y-2">
                <Label>Боты для отправки</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start font-normal">
                      {filters.bot_ids.length === 0
                        ? "Основной бот"
                        : `Выбрано: ${filters.bot_ids.length}`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3" align="start">
                    <div className="space-y-2">
                      {bots?.map((b) => (
                        <label key={b.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={filters.bot_ids.includes(b.id)}
                            onCheckedChange={(checked) => {
                              setFilters((f) => ({
                                ...f,
                                bot_ids: checked
                                  ? [...f.bot_ids, b.id]
                                  : f.bot_ids.filter((id) => id !== b.id),
                              }));
                            }}
                          />
                          <span className="text-sm">
                            {b.bot_name}
                            <span className="text-muted-foreground ml-1">@{b.bot_username}</span>
                            {b.is_primary && <Badge variant="outline" className="ml-2 text-[10px]">основной</Badge>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-muted-foreground">
                  Сообщение уйдёт через каждый выбранный бот тем пользователям, у которых есть с ним диалог.
                </p>
              </div>

              <Separator />

              {/* Audience Summary */}
              <div className="rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 p-4 space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Аудитория
                </h4>
                {audienceLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Подсчёт...
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-blue-500" />
                        Telegram
                      </span>
                      <span className="font-medium">{audience?.telegramCount || 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-orange-500" />
                        Email
                      </span>
                      <span className="font-medium">{audience?.emailCount || 0}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Button */}
              <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="w-full gap-2">
                    <Eye className="h-4 w-4" />
                    Просмотр получателей
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Получатели рассылки</SheetTitle>
                    <SheetDescription>
                      Первые 50 из {audience?.totalCount || 0} получателей
                    </SheetDescription>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(var(--app-height)-150px)] mt-4">
                    <div className="space-y-2">
                      {audience?.users.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {user.full_name || "Без имени"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {user.email || "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {user.has_telegram && (
                              <MessageCircle className="h-4 w-4 text-blue-500" />
                            )}
                            {user.has_email && <Mail className="h-4 w-4 text-orange-500" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Советы по рассылкам</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Персонализируйте сообщения
                    </li>
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Не отправляйте слишком часто
                    </li>
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Добавляйте призыв к действию
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>
      </Tabs>

      {/* Broadcast detail dialog */}
      <Dialog open={!!selectedBroadcast} onOpenChange={(open) => !open && setSelectedBroadcast(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedBroadcast?.action === "telegram_mass_broadcast" ? (
                <MessageCircle className="h-5 w-5" />
              ) : (
                <Mail className="h-5 w-5" />
              )}
              Детали рассылки
            </DialogTitle>
          </DialogHeader>
          {selectedBroadcast && (() => {
            const m = (selectedBroadcast._meta || selectedBroadcast.meta) as Record<string, unknown> | null;
            const fullText = String(m?.message_template || m?.message_preview || m?.subject || "—");
            const btnText = m?.button_text as string | null;
            const btnUrl = m?.button_url as string | null;
            const includeBtn = m?.include_button as boolean | undefined;
            const filtersData = m?.filters as Record<string, unknown> | null;
            const sentCount = Number(m?.sent || 0);
            const failedCount = Number(m?.failed || 0);
            return (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Дата</p>
                  <p className="text-sm">
                    {format(new Date(selectedBroadcast.created_at as string), "dd MMMM yyyy, HH:mm", { locale: ru })}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Текст сообщения</p>
                  <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                    {fullText}
                  </div>
                </div>

                {includeBtn && btnText && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Кнопка</p>
                    <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                      <MousePointerClick className="h-4 w-4 shrink-0" />
                      <span className="font-medium">{btnText}</span>
                      {btnUrl && (
                        <a href={btnUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-primary hover:underline flex items-center gap-1 text-xs">
                          <ExternalLink className="h-3 w-3" />
                          Ссылка
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Отправлено</p>
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle className="h-3 w-3 text-green-500" />
                      {sentCount}
                    </Badge>
                  </div>
                  {failedCount > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Ошибки</p>
                      <Badge variant="outline" className="gap-1">
                        <XCircle className="h-3 w-3 text-red-500" />
                        {failedCount}
                      </Badge>
                    </div>
                  )}
                </div>

                {filtersData && Object.keys(filtersData).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Фильтры</p>
                    <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
                      {(filtersData.productIds as string[])?.length > 0 && (
                        <p>Продукты: {(filtersData.productIds as string[]).length} шт.</p>
                      )}
                      {(filtersData.tariffIds as string[])?.length > 0 && (
                        <p>Тарифы: {(filtersData.tariffIds as string[]).length} шт.</p>
                      )}
                      {filtersData.hasActiveSubscription && <p>Только с активной подпиской</p>}
                      {filtersData.clubId && <p>Клуб: задан</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
