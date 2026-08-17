import { lazy, Suspense, useState, useRef, useCallback, useMemo, useEffect } from "react";
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
import { DateTimePicker } from "@/components/ui/datetime-picker";
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
  FileText,
  Film,
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
import { BroadcastAuditProofCard } from "./BroadcastAuditProofCard";
import { uploadToTelegramMedia } from "@/components/admin/chat/uploadToTelegramMedia";
import { TelegramMessagePreview } from "./TelegramMessagePreview";

import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";
import { RuleListEditor } from "./RuleListEditor";

const BroadcastAnalyticsSection = lazy(() =>
  import("./BroadcastAnalyticsSection").then((module) => ({ default: module.BroadcastAnalyticsSection }))
);

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
  education?: {
    module_id: string;
    lesson_id: string;
    status: "lesson_completed" | "lesson_not_completed" | "homework_submitted" | "homework_not_submitted" | "form_answered" | "form_not_answered";
  };
}

interface AudiencePreview {
  telegramCount: number;
  emailCount: number;
  emailActiveCount: number;
  emailArchivedCount: number;
  emailNoAccountCount: number;
  totalCount: number;
  users: Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    telegram_username: string | null;
    has_telegram: boolean;
    has_email: boolean;
    has_account?: boolean;
    is_archived?: boolean;
  }>;
}

const EMPTY_RULE: AudienceRule = { product_id: "", tariff_ids: [], mode: "purchased" };

type MediaType = "photo" | "animation" | "video" | "audio" | "video_note" | "document" | null;

interface MediaFile {
  type: MediaType;
  file?: File;
  fileName: string;
  storagePath?: string;
  preview?: string;
}

interface BroadcastTestRecipient {
  full_name: string | null;
  email: string | null;
  telegram_username: string | null;
  telegram_user_id: string | number | null;
}

type SendMode = "now" | "scheduled" | "recurring" | "event" | "template";
type Frequency = "daily" | "weekly" | "monthly";

interface RecurrenceRule {
  frequency: Frequency;
  interval: number;
  time_of_day: string; // "HH:MM"
  by_weekday?: number[]; // 1..7 Mon..Sun, only for weekly
  by_monthday?: number[]; // 1..31, only for monthly
  ends_at?: string | null; // ISO date or null
  timezone?: string;
}

const DEFAULT_RECURRENCE: RecurrenceRule = {
  frequency: "weekly",
  interval: 1,
  time_of_day: "10:00",
  by_weekday: [1],
  by_monthday: [1],
  ends_at: null,
  timezone: "Europe/Minsk",
};

function readableBroadcastError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value || "");
  const normalized = raw.toLowerCase();
  if (normalized.includes("forbidden") || normalized.includes("permission")) {
    return "Недостаточно прав для управления рассылками. Обновите страницу или обратитесь к суперадминистратору.";
  }
  if (normalized.includes("unauthorized") || normalized.includes("invalid token")) {
    return "Сессия истекла. Войдите в систему заново и повторите попытку.";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "Нет связи с сервером. Проверьте интернет и повторите попытку.";
  }
  if (normalized.includes("edge function") || normalized.includes("non-2xx")) {
    return "Сервер не выполнил операцию. Проверьте данные и повторите попытку.";
  }
  return /[А-Яа-яЁё]/.test(raw)
    ? raw
    : "Не удалось выполнить операцию. Повторите попытку или обратитесь к суперадминистратору.";
}

async function readableFunctionInvokeError(value: unknown): Promise<string> {
  const context = value && typeof value === "object" && "context" in value
    ? (value as { context?: { json?: () => Promise<unknown> } }).context
    : undefined;
  if (context && typeof context.json === "function") {
    try {
      const payload = await context.json() as { error?: unknown; message?: unknown };
      const detail = payload?.error ?? payload?.message;
      if (detail) return readableBroadcastError(detail);
    } catch {
      // The response body may already be consumed; fall back to the client error.
    }
  }
  return readableBroadcastError(value);
}

export function BroadcastsTabContent() {
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<"templates" | "quick" | "scheduled" | "analytics">("templates");
  // Sprint B rev3 — фаза 2: id шаблона в режиме редактирования (открывается из «Запланированные»)
  const [editTemplateId, setEditTemplateId] = useState<string | null>(null);
  const openTemplateForSendRef = useRef(false);

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
  const [testEmail, setTestEmail] = useState("");


  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingMediaTypeRef = useRef<Exclude<MediaType, null>>("document");

  const [filters, setFilters] = useState<BroadcastFilters>({
    include: [],
    exclude: [],
    club_ids: [],
    club_membership: "current",
    bot_ids: [],
  });

  // Архивные профили — opt-in. По умолчанию НЕ включаем.
  const [includeArchived, setIncludeArchived] = useState(false);

  // Build RPC payload (channels derived from active tab)
  const rpcFilters = useMemo(() => ({
    channels: ["telegram", "email"],
    include: filters.include,
    exclude: filters.exclude,
    club_ids: filters.club_ids,
    club_membership: filters.club_membership,
    education: filters.education,
    include_archived: includeArchived,
  }), [filters, includeArchived]);

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
  const telegramWillSplit = useMemo(() => {
    if (!mediaFile || !message.trim()) return false;
    return mediaFile.type === "video_note" || message.trim().length > 1024;
  }, [mediaFile, message]);
  const telegramDeliveryHint = telegramWillSplit
    ? mediaFile?.type === "video_note"
      ? "Telegram не поддерживает подпись у кружка: кружок и текст будут отправлены двумя сообщениями."
      : "Подпись длиннее 1024 символов: медиа и текст будут отправлены двумя сообщениями."
    : mediaFile
    ? "Медиа, короткий текст и кнопка будут отправлены одним сообщением."
    : "Текст и кнопка будут отправлены одним сообщением.";

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

  const { data: trainingModules } = useQuery({
    queryKey: ["broadcast-training-modules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_modules")
        .select("id, title")
        .eq("is_active", true)
        .order("title");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: trainingLessons } = useQuery({
    queryKey: ["broadcast-training-lessons", filters.education?.module_id],
    queryFn: async () => {
      if (!filters.education?.module_id) return [];
      const { data, error } = await supabase
        .from("training_lessons")
        .select("id, title")
        .eq("module_id", filters.education.module_id)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data || [];
    },
    enabled: Boolean(filters.education?.module_id),
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

  // Тест в Telegram всегда идёт текущему авторизованному администратору.
  // Показываем его явно, чтобы оператор не ожидал отправку другому сотруднику.
  const { data: testRecipient, isLoading: testRecipientLoading } = useQuery<BroadcastTestRecipient | null>({
    queryKey: ["broadcast-test-recipient"],
    queryFn: async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("Не удалось определить текущего администратора");
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, email, telegram_username, telegram_user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data as BroadcastTestRecipient | null;
    },
    staleTime: 60_000,
  });

  // Audience preview via RPC (single source of truth, used by edge funcs too).
  // ВАЖНО: ошибки RPC НЕ маскируем под нулевую аудиторию — иначе админ видит
  // «0 получателей» вместо явной причины и думает, что фильтр пустой.
  const { data: audience, isLoading: audienceLoading, error: audienceError, refetch: refetchAudience } = useQuery<AudiencePreview, Error>({
    queryKey: ["broadcast-audience-rpc", rpcFilters],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("broadcast-audience-preview", {
        body: { filters: rpcFilters },
      });
      if (error) {
        console.error("[broadcast] audience rpc error", error, "filters:", rpcFilters);
        throw new Error("Не удалось рассчитать аудиторию. Проверьте доступ к контакт-центру и повторите попытку.");
      }
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        telegramCount: Number(r.telegram_count || 0),
        emailCount: Number(r.email_count || 0),
        emailActiveCount: Number(r.email_active_count || 0),
        emailArchivedCount: Number(r.email_archived_count || 0),
        emailNoAccountCount: Number(r.email_no_account_count || 0),
        totalCount: Number(r.total_count || 0),
        users: (r.users as AudiencePreview["users"]) || [],
      } satisfies AudiencePreview;
    },
    refetchInterval: false,
    retry: 1,
  });
  const hasAudienceError = !!audienceError;

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
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: Exclude<MediaType, null>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = ["video", "animation", "video_note", "document"].includes(type)
      ? 50 * 1024 * 1024
      : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Файл слишком большой. Максимум: ${maxSize / 1024 / 1024} МБ`);
      e.target.value = "";
      return;
    }

    let preview: string | undefined;
    if (type === "photo" || type === "animation" || type === "video") {
      preview = URL.createObjectURL(file);
    }

    setMediaFile({ type, file, fileName: file.name, preview });
    e.target.value = "";
  };

  const chooseMedia = (type: Exclude<MediaType, null>, accept: string) => {
    pendingMediaTypeRef.current = type;
    if (fileInputRef.current) {
      fileInputRef.current.accept = accept;
      fileInputRef.current.click();
    }
  };

  const removeMedia = useCallback(() => {
    if (mediaFile?.preview) {
      URL.revokeObjectURL(mediaFile.preview);
    }
    setMediaFile(null);
  }, [mediaFile]);

  // ===== Edit-mode lifecycle helpers =====
  // Snapshot загруженного шаблона для определения «грязных» изменений (unsaved guard).
  const loadedTemplateSnapshotRef = useRef<string | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState<null | { kind: "exit" | "new" }>(null);

  const computeComposerSnapshot = useCallback((): string => {
    return JSON.stringify({
      sendToTelegram,
      sendToEmail,
      sendMode,
      scheduledName,
      message,
      emailSubject,
      emailBody,
      includeButton,
      buttonText,
      buttonUrl,
      filters,
      includeArchived,
      mediaType: mediaFile?.type ?? null,
      mediaFileName: mediaFile?.fileName ?? null,
      mediaStoragePath: mediaFile?.storagePath ?? null,
      recurrence,
      scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
      scheduledTime,
    });
  }, [
    sendToTelegram, sendToEmail, sendMode, scheduledName, message, emailSubject,
    emailBody, includeButton, buttonText, buttonUrl, filters, includeArchived, mediaFile, recurrence,
    scheduledAt, scheduledTime,
  ]);

  const snapshotCurrentComposer = useCallback(() => {
    loadedTemplateSnapshotRef.current = computeComposerSnapshot();
  }, [computeComposerSnapshot]);

  const isComposerDirty = useCallback((): boolean => {
    if (!editTemplateId) return false;
    if (loadedTemplateSnapshotRef.current === null) return false;
    return computeComposerSnapshot() !== loadedTemplateSnapshotRef.current;
  }, [editTemplateId, computeComposerSnapshot]);

  const resetComposer = useCallback(() => {
    setMessage("");
    setEmailSubject("");
    setEmailBody("");
    setScheduledName("");
    setScheduledAt(null);
    setSendMode("now");
    setIncludeButton(true);
    setButtonText("Открыть платформу");
    setButtonUrl("https://club.gorbova.by/products");
    setSendToTelegram(true);
    setSendToEmail(false);
    setIncludeArchived(false);
    setFilters({ include: [], exclude: [], club_ids: [], club_membership: "current", bot_ids: [] });
    removeMedia();
    setRecurrence(DEFAULT_RECURRENCE);
  }, [removeMedia]);

  const exitEditMode = useCallback(() => {
    setEditTemplateId(null);
    loadedTemplateSnapshotRef.current = null;
    resetComposer();
  }, [resetComposer]);

  // Send Telegram broadcast
  const sendTelegramMutation = useMutation({
    mutationFn: async ({ analyticsCampaignId, campaignName }: { analyticsCampaignId: string; campaignName: string }) => {
      // Полная база (нет include/exclude/club_ids/bot_ids) → требуем явное подтверждение,
      // иначе backend-guard блокирует запрос как broadcast_blocked_empty_audience_filters.
      const isFullBase =
        (filters.include?.length ?? 0) === 0 &&
        (filters.exclude?.length ?? 0) === 0 &&
        (filters.club_ids?.length ?? 0) === 0 &&
        (filters.bot_ids?.length ?? 0) === 0 &&
        !filters.education;
      let allowFullAudience = false;
      if (isFullBase) {
        const phrase = `ОТПРАВИТЬ ВСЕМ ${audience?.telegramCount ?? 0}`;
        const typed = window.prompt(
          `Вы запускаете Telegram-рассылку по ВСЕЙ базе (${audience?.telegramCount ?? 0} получателей).\n\nДля подтверждения введите фразу:\n${phrase}`,
        );
        if (typed !== phrase) {
          throw new Error("Подтверждение не получено — рассылка отменена");
        }
        allowFullAudience = true;
      }

      if (mediaFile?.file) {
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
        if (productContextId) formData.append("product_context_id", productContextId);
        formData.append("analytics_campaign_id", analyticsCampaignId);
        formData.append("analytics_campaign_name", campaignName);
        formData.append("analytics_send_mode", "manual");
        if (allowFullAudience) {
          formData.append("allow_full_audience", "true");
          formData.append("confirm_full_audience_text", "SEND TO ALL");
        }

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
          throw new Error(readableBroadcastError(error.error));
        }

        return response.json();
      }

      const body: Record<string, unknown> = {
        message: message.trim().replace(/\[\[align:(left|center|right)\]\]/g, ""),
        include_button: includeButton,
        button_text: includeButton ? buttonText : undefined,
        button_url: includeButton ? buttonUrl : undefined,
        filters,
        product_context_id: productContextId,
        analytics_campaign_id: analyticsCampaignId,
        analytics_campaign_name: campaignName,
        analytics_send_mode: "manual",
      };
      if (mediaFile?.storagePath) {
        body.media_storage_path = mediaFile.storagePath;
        body.media_type = mediaFile.type;
        body.media_file_name = mediaFile.fileName;
      }
      if (allowFullAudience) {
        body.allow_full_audience = true;
        body.confirm_full_audience_text = "SEND TO ALL";
      }
      const { data, error } = await supabase.functions.invoke("telegram-mass-broadcast", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      // В режиме редактирования НЕ очищаем поля — шаблон остаётся загруженным,
      // чтобы можно было отправить ещё раз / отредактировать / сохранить.
      if (!editTemplateId) {
        setMessage("");
        removeMedia();
      }
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + readableBroadcastError(error));
    },
  });

  // Send Email broadcast
  const sendEmailMutation = useMutation({
    mutationFn: async ({ analyticsCampaignId, campaignName }: { analyticsCampaignId: string; campaignName: string }) => {
      // Полная база (нет ни include/exclude/club_ids) → требуем явное подтверждение.
      const isFullBase =
        (filters.include?.length ?? 0) === 0 &&
        (filters.exclude?.length ?? 0) === 0 &&
        (filters.club_ids?.length ?? 0) === 0 &&
        !filters.education;
      const body: Record<string, unknown> = {
        subject: emailSubject.trim(),
        html: emailBody.trim(),
        filters,
        product_context_id: productContextId,
        include_archived: includeArchived,
        analytics_campaign_id: analyticsCampaignId,
        analytics_campaign_name: campaignName,
        analytics_send_mode: "manual",
      };
      if (isFullBase) {
        const phrase = `ОТПРАВИТЬ ВСЕМ ${audience?.emailCount ?? 0}`;
        const typed = window.prompt(
          `Вы запускаете рассылку по ВСЕЙ базе (${audience?.emailCount ?? 0} получателей).\n\nДля подтверждения введите фразу:\n${phrase}`,
        );
        if (typed !== phrase) {
          throw new Error("Подтверждение не получено — рассылка отменена");
        }
        body.allow_full_audience = true;
        body.confirm_full_audience_text = "SEND TO ALL";
      }
      const { data, error } = await supabase.functions.invoke("email-mass-broadcast", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      // В режиме редактирования НЕ очищаем — шаблон остаётся загруженным.
      if (!editTemplateId) {
        setEmailSubject("");
        setEmailBody("");
      }
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + readableBroadcastError(error));
    },
  });

  // Telegram-тест текущему авторизованному администратору.
  const sendTelegramTestMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const selectedBot = bots?.find((bot) => filters.bot_ids.includes(bot.id))
        || bots?.find((bot) => bot.is_primary)
        || bots?.[0];
      if (!selectedBot) throw new Error("Нет активного Telegram-бота");

      const cleanMessage = message.trim().replace(/\[\[align:(left|center|right)\]\]/g, "");
      const common = {
        botId: selectedBot.id,
        messageText: cleanMessage,
        buttonText: includeButton ? buttonText : undefined,
        buttonUrl: includeButton ? buttonUrl : undefined,
        product_context_id: productContextId,
        media_type: mediaFile?.type,
        media_storage_path: mediaFile?.storagePath,
        media_file_name: mediaFile?.fileName,
      };

      if (mediaFile?.file) {
        const formData = new FormData();
        Object.entries(common).forEach(([key, value]) => {
          if (value !== undefined && value !== null) formData.append(key, String(value));
        });
        formData.append("media", mediaFile.file);
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-send-test`,
          { method: "POST", headers: { Authorization: `Bearer ${session?.access_token}` }, body: formData },
        );
        const result = await response.json();
        if (!response.ok) throw new Error(readableBroadcastError(result.error));
        return result;
      }

      const { data, error } = await supabase.functions.invoke("telegram-send-test", { body: common });
      if (error) throw new Error(await readableFunctionInvokeError(error));
      if (data && typeof data === "object" && "error" in data && data.error) {
        throw new Error(readableBroadcastError(data.error));
      }
      return data;
    },
    onSuccess: () => {
      toast.success(`Тест отправлен в Telegram: ${testRecipient?.full_name || "текущий администратор"}`);
    },
    onError: (error) => {
      toast.error("Ошибка: " + readableBroadcastError(error));
    },
  });

  // Email-тест идёт только на явно введённый адрес и не использует аудиторию рассылки.
  const sendEmailTestMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const recipient = testEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        throw new Error("Введите корректный Email для теста");
      }
      if (!emailSubject.trim()) throw new Error("Добавьте тему тестового письма");
      if (!emailBody.trim()) throw new Error("Добавьте текст тестового письма");

      const html = `<div style="margin:0 0 16px;padding:12px 16px;border-radius:8px;background:#eef6ff;color:#1d4ed8;font-weight:600">Тестовое письмо — рассылка не запущена</div>${emailBody.trim()}`;
      const text = `Тестовое письмо — рассылка не запущена\n\n${emailBody
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()}`;
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error("Сессия истекла. Войдите в систему заново и повторите попытку.");
      }
      // Direct fetch is intentional here: in the Lovable Cloud runtime the
      // functions client dropped the per-invocation Authorization header,
      // while the same explicit transport is already reliable for Telegram.
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: recipient,
          subject: `[ТЕСТ] ${emailSubject.trim()}`,
          html,
          text,
          product_id: productContextId || undefined,
          context: {
            event_type: "broadcast_test",
            meta: { source: "broadcast_editor", test_only: true },
          },
        }),
      });

      const responseText = await response.text();
      let result: unknown = null;
      if (responseText) {
        try {
          result = JSON.parse(responseText);
        } catch {
          result = responseText;
        }
      }
      const resultError = result && typeof result === "object" && "error" in result
        ? (result as { error?: unknown }).error
        : null;
      if (!response.ok || resultError) {
        throw new Error(readableBroadcastError(resultError || `Ошибка сервера (${response.status})`));
      }
      return result;
    },
    onSuccess: () => {
      toast.success(`Тестовое письмо принято к отправке: ${testEmail.trim()}`);
    },
    onError: (error) => {
      toast.error("Ошибка Email-теста: " + readableBroadcastError(error));
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
  // Гидратация запускается только при смене id. snapshotCurrentComposer намеренно
  // не является зависимостью: он меняется вместе с полями, которые этот effect заполняет.
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
      const storedMediaPath = (tpl.media_storage_path as string) || "";
      const storedMediaType = (tpl.media_type as Exclude<MediaType, null>) || null;
      if (storedMediaPath && storedMediaType) {
        const slash = storedMediaPath.indexOf("/");
        const bucket = slash > 0 ? storedMediaPath.slice(0, slash) : "telegram-media";
        const key = slash > 0 ? storedMediaPath.slice(slash + 1) : storedMediaPath;
        const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(key, 3600);
        setMediaFile({
          type: storedMediaType,
          fileName: String(tpl.media_file_name || "Медиафайл"),
          storagePath: storedMediaPath,
          preview: signed?.signedUrl,
        });
      } else {
        setMediaFile(null);
      }
      const af = (tpl.audience_filters as Record<string, unknown>) || {};
      setIncludeArchived(Boolean(af.include_archived));
      if (af.include || af.exclude || af.club_ids) {
        setFilters({
          include: ((af.include as AudienceRule[]) || []),
          exclude: ((af.exclude as AudienceRule[]) || []),
          club_ids: ((af.club_ids as string[]) || []),
          club_membership: ((af.club_membership as "current" | "ever" | "any") || "current"),
          bot_ids: ((af.bot_ids as string[]) || []),
          education: af.education as BroadcastFilters["education"],
        });
      }
      const mode = String(tpl.send_mode || "manual");
      if (String(tpl.trigger_kind || "") === "lesson_event" || mode === "event") {
        setSendMode("event");
      } else if (mode === "scheduled") {
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
        setSendMode(openTemplateForSendRef.current ? "now" : String(tpl.status || "") === "draft" ? "template" : "now");
      }
      openTemplateForSendRef.current = false;
      toast.info(`Загружен шаблон «${tpl.name}» для редактирования`);
      // Snapshot — после применения всех setState (через micro-task), для guard «грязных» изменений.
      setTimeout(() => {
        if (!cancelled) snapshotCurrentComposer();
      }, 0);
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTemplateId]);

  // Save scheduled/recurring template (INSERT or UPDATE — без дубля)
  // RPC compute_next_broadcast_run signature: (rule jsonb, from_ts timestamptz) — verified.
  const saveScheduledMutation = useMutation({
    mutationFn: async () => {
      const isRecurring = sendMode === "recurring";
      const isEvent = sendMode === "event";
      const isTemplate = sendMode === "template";

      // Validate recurrence rule shape (monthly requires by_monthday, weekly requires by_weekday)
      if (isRecurring) {
        if (recurrence.frequency === "weekly" && !(recurrence.by_weekday && recurrence.by_weekday.length > 0)) {
          throw new Error("Для еженедельной рассылки выберите хотя бы один день недели");
        }
        if (recurrence.frequency === "monthly" && !(recurrence.by_monthday && recurrence.by_monthday.length > 0)) {
          throw new Error("Для ежемесячной рассылки укажите день месяца (1–31)");
        }
      }

      // Compute next_run_at FIRST — if RPC fails for recurring, do not save.
      let nextRunAt: string | null = null;
      if (isRecurring) {
        const { data: nextTs, error: rpcErr } = await supabase.rpc(
          "compute_next_broadcast_run",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { rule: recurrence as any, from_ts: new Date().toISOString() },
        );
        if (rpcErr) throw new Error("RPC compute_next_broadcast_run: " + rpcErr.message);
        nextRunAt = (nextTs as string | null) ?? null;
        if (!nextRunAt) throw new Error("Не удалось вычислить следующий запуск по правилу повторения");
      } else if (!isTemplate && !isEvent) {
        nextRunAt = composeScheduledAt();
      }

      let mediaStoragePath = mediaFile?.storagePath || null;
      if (mediaFile?.file) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Сессия истекла. Войдите в систему заново.");
        const uploaded = await uploadToTelegramMedia(mediaFile.file, user.id);
        mediaStoragePath = `${uploaded.bucket}/${uploaded.path}`;
      }

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
        audience_filters: { ...filters, include_archived: includeArchived } as unknown as Record<string, unknown>,
        media_storage_path: sendToTelegram ? mediaStoragePath : null,
        media_type: sendToTelegram ? mediaFile?.type || null : null,
        media_file_name: sendToTelegram ? mediaFile?.fileName || null : null,
        send_mode: isTemplate ? "manual" : isEvent ? "event" : isRecurring ? "recurring" : "scheduled",
        // CRITICAL: recurring saved with status='recurring', чтобы pause/resume
        // корректно восстанавливал metadata.paused_from_status.
        status: isTemplate ? "draft" : isEvent || isRecurring ? "recurring" : "scheduled",
        recurrence_rule: isRecurring ? (recurrence as unknown as Record<string, unknown>) : null,
        scheduled_for: isTemplate || isRecurring || isEvent ? null : composeScheduledAt(),
        next_run_at: nextRunAt,
        trigger_kind: isEvent ? "lesson_event" : sendMode === "scheduled" && filters.education ? "scheduled_condition" : "manual",
        education_condition: filters.education || null,
      };

      if (editTemplateId) {
        const { error } = await supabase
          .from("broadcast_templates")
          .update(payload as never)
          .eq("id", editTemplateId);
        if (error) throw error;
        return { id: editTemplateId, mode: "update" as const, mediaStoragePath };
      }
      const { data, error } = await supabase
        .from("broadcast_templates")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(payload as any)
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id as string, mode: "insert" as const, mediaStoragePath };
    },
    onSuccess: (res) => {
      toast.success(
        res.mode === "update"
          ? sendMode === "template" ? "Шаблон обновлён" : "Запланированная рассылка обновлена"
          : sendMode === "template"
          ? "Шаблон сохранён"
          : sendMode === "recurring"
          ? "Повторяющаяся рассылка создана"
          : sendMode === "event"
          ? "Автоматическая рассылка по событию создана"
          : "Рассылка запланирована",
      );
      // CRITICAL: использовать canonical queryKey таблицы «Запланированные» (Фаза 1).
      queryClient.invalidateQueries({ queryKey: ["scheduled-broadcasts-canonical"] });
      if (res.mode === "update") {
        // По решению: остаёмся в редакторе после «Сохранить изменения», не переключаем вкладку,
        // не сбрасываем editTemplateId — иначе из режима редактирования невозможно «выйти осознанно».
        // Чтобы экран отражал актуальные значения шаблона, обновим snapshot для guard.
        snapshotCurrentComposer();
      } else {
        // Новая запланированная — выходим из режима создания и переходим во вкладку «Запланированные».
        setEditTemplateId(null);
        setSendMode("now");
        setScheduledAt(null);
        setScheduledName("");
        setMainTab(sendMode === "template" ? "templates" : "scheduled");
      }
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
    if (hasAudienceError) {
      toast.error("Аудитория не рассчитана", {
        description: audienceError?.message || "Исправьте фильтры или повторите позже",
      });
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
    if ((sendMode === "template" || sendMode === "event") && !scheduledName.trim()) {
      toast.error(sendMode === "template" ? "Укажите название шаблона" : "Укажите название автоматической рассылки");
      return;
    }
    if (filters.education && !filters.education.lesson_id) {
      toast.error("Выберите урок для условия по обучению");
      return;
    }
    if (sendMode === "event" && !filters.education) {
      toast.error("Для отправки по событию задайте условие по обучению");
      return;
    }
    if (sendMode === "event" && filters.education && ![
      "lesson_completed",
      "homework_submitted",
      "form_answered",
    ].includes(filters.education.status)) {
      toast.error("По событию доступны только положительные действия: урок пройден, ДЗ сдано или анкета заполнена");
      return;
    }

    if (sendMode === "now") {
      const analyticsCampaignId = crypto.randomUUID();
      const campaignName = scheduledName.trim()
        || emailSubject.trim()
        || message.trim().replace(/\s+/g, " ").slice(0, 80)
        || `Рассылка ${format(new Date(), "dd.MM.yyyy HH:mm")}`;
      // Both channels use the same campaign id so the report remains one
      // administrator action rather than two unrelated rows.
      if (sendToTelegram) sendTelegramMutation.mutate({ analyticsCampaignId, campaignName });
      if (sendToEmail) sendEmailMutation.mutate({ analyticsCampaignId, campaignName });
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
    hasAudienceError ||
    audienceLoading ||
    sendTelegramMutation.isPending ||
    sendEmailMutation.isPending ||
    saveScheduledMutation.isPending;

  return (
    <div className="w-full max-w-[1680px] mx-auto px-4 md:px-6 xl:px-8 py-6 space-y-6 overflow-auto h-full">
      {/* Main Tabs: Templates vs Quick Send */}
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "templates" | "quick" | "scheduled" | "analytics")}>
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger className="shrink-0" value="templates">📋 Шаблоны</TabsTrigger>
          <TabsTrigger className="shrink-0" value="quick">⚡ Быстрая рассылка</TabsTrigger>
          <TabsTrigger className="shrink-0" value="scheduled">📅 Запланированные</TabsTrigger>
          <TabsTrigger className="shrink-0" value="analytics">📊 Аналитика</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <BroadcastTemplatesSection
            onCreate={() => {
              setEditTemplateId(null);
              resetComposer();
              setSendMode("template");
              setMainTab("quick");
            }}
            onEdit={(id) => {
              openTemplateForSendRef.current = false;
              setEditTemplateId(id);
              setMainTab("quick");
            }}
            onUse={(id) => {
              openTemplateForSendRef.current = true;
              setEditTemplateId(id);
              setMainTab("quick");
            }}
          />
        </TabsContent>

        <TabsContent value="scheduled" className="mt-6 space-y-6">
          <BroadcastAuditProofCard />
          <ScheduledBroadcastsSection
            onEdit={(id) => {
              openTemplateForSendRef.current = false;
              setEditTemplateId(id);
              setMainTab("quick");
            }}
          />
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <Suspense fallback={<div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>}>
            <BroadcastAnalyticsSection />
          </Suspense>
        </TabsContent>

        <TabsContent value="quick" className="mt-6">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 2xl:gap-8">
        {/* Main Content */}
        <div className="min-w-0 space-y-6">
          {/* Edit-mode banner + actions */}
          {editTemplateId ? (
            <Alert>
              <Pencil className="h-4 w-4" />
              <AlertDescription className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-sm">
                  Редактирование шаблона. Сохранение обновит существующую запись (без дубля).
                </span>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (isComposerDirty()) {
                        setExitConfirmOpen({ kind: "exit" });
                      } else {
                        exitEditMode();
                        toast.info("Выход из режима редактирования");
                      }
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Выйти
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Крестик закрывает редактор и возвращает к списку шаблонов.
                  const hasContent = !!(message.trim() || emailSubject.trim() || emailBody.trim() || scheduledName.trim() || mediaFile);
                  if (hasContent) {
                    setExitConfirmOpen({ kind: "new" });
                  } else {
                    resetComposer();
                    setMainTab("templates");
                  }
                }}
              >
                <X className="h-4 w-4 mr-1" />
                Закрыть редактор
              </Button>
            </div>
          )}

          {/* Confirm dialog for exit / new with unsaved changes */}
          <AlertDialog open={!!exitConfirmOpen} onOpenChange={(o) => !o && setExitConfirmOpen(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Несохранённые изменения</AlertDialogTitle>
                <AlertDialogDescription>
                  {exitConfirmOpen?.kind === "exit"
                    ? "В шаблоне есть несохранённые изменения. Выйти из редактирования и потерять их?"
                    : "В редакторе есть несохранённые данные. Закрыть его и потерять изменения?"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (exitConfirmOpen?.kind === "exit") {
                      exitEditMode();
                      toast.info("Выход из режима редактирования");
                    } else {
                      resetComposer();
                      setMainTab("templates");
                    }
                    setExitConfirmOpen(null);
                  }}
                >
                  {exitConfirmOpen?.kind === "exit" ? "Выйти без сохранения" : "Закрыть без сохранения"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>


          {/* Channel toggles */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Каналы рассылки</CardTitle>
              <CardDescription>
                Можно отправлять одновременно в Telegram и Email
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {hasAudienceError && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="space-y-2">
                    <div className="font-medium">Ошибка расчёта аудитории</div>
                    <div className="text-xs opacity-90 break-words">{readableBroadcastError(audienceError)}</div>
                    <Button type="button" variant="outline" size="sm" onClick={() => refetchAudience()}>
                      Повторить расчёт
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-blue-500" />
                  <div>
                    <Label htmlFor="ch-tg" className="cursor-pointer font-medium">
                      Отправлять в Telegram
                    </Label>
                    {!hasAudienceError && audience && (
                      <p className="text-xs text-muted-foreground">
                        {audience.telegramCount} получателей
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  id="ch-tg"
                  checked={sendToTelegram}
                  onCheckedChange={setSendToTelegram}
                />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-orange-500" />
                  <div>
                    <Label htmlFor="ch-email" className="cursor-pointer font-medium">
                      Отправлять Email
                    </Label>
                    {!hasAudienceError && audience && (
                      <p className="text-xs text-muted-foreground">
                        {audience.emailCount} получателей · активных {audience.emailActiveCount}
                        {audience.emailArchivedCount > 0 ? ` · архивных ${audience.emailArchivedCount}` : ""}
                        {audience.emailNoAccountCount > 0 ? ` · без аккаунта ${audience.emailNoAccountCount}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  id="ch-email"
                  checked={sendToEmail}
                  onCheckedChange={setSendToEmail}
                />
              </div>
              {sendToEmail && (
                <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div>
                      <Label htmlFor="ch-include-archived" className="cursor-pointer font-medium">
                        Включить архивных контактов
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        По умолчанию архивные исключены. Включи, чтобы охватить всю историческую базу
                        {audience ? ` (+${audience.emailArchivedCount})` : ""}.
                      </p>
                    </div>
                  </div>
                  <Switch
                    id="ch-include-archived"
                    checked={includeArchived}
                    onCheckedChange={setIncludeArchived}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Send mode */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Режим отправки</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup
                value={sendMode}
                onValueChange={(v) => setSendMode(v as SendMode)}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1750px]:grid-cols-5"
              >
                <Label
                  htmlFor="mode-now"
                  className={cn(
                    "grid min-h-16 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors",
                    sendMode === "now" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem id="mode-now" value="now" />
                  <Send className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 whitespace-normal break-words text-sm font-medium leading-tight">Отправить сейчас</span>
                </Label>
                <Label
                  htmlFor="mode-scheduled"
                  className={cn(
                    "grid min-h-16 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors",
                    sendMode === "scheduled" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem id="mode-scheduled" value="scheduled" />
                  <CalendarIcon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 whitespace-normal break-words text-sm font-medium leading-tight">Запланировать</span>
                </Label>
                <Label
                  htmlFor="mode-recurring"
                  className={cn(
                    "grid min-h-16 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors",
                    sendMode === "recurring" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem id="mode-recurring" value="recurring" />
                  <Repeat className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 whitespace-normal break-words text-sm font-medium leading-tight">Повторять</span>
                </Label>
                <Label
                  htmlFor="mode-template"
                  className={cn(
                    "grid min-h-16 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors",
                    sendMode === "template" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem id="mode-template" value="template" />
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 whitespace-normal break-words text-sm font-medium leading-tight">Сохранить как шаблон</span>
                </Label>
                <Label
                  htmlFor="mode-event"
                  className={cn(
                    "grid min-h-16 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors",
                    sendMode === "event" && "border-primary bg-primary/5",
                  )}
                >
                  <RadioGroupItem id="mode-event" value="event" />
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 whitespace-normal break-words text-sm font-medium leading-tight">По событию ученика</span>
                </Label>
              </RadioGroup>

              {sendMode === "event" && (
                <Alert>
                  <Sparkles className="h-4 w-4" />
                  <AlertDescription>
                    После прохождения урока, сдачи домашнего задания или заполнения анкеты сообщение будет поставлено в очередь автоматически. Повторная отправка одному ученику по тому же событию блокируется.
                  </AlertDescription>
                </Alert>
              )}

              {/* Scheduled DateTime — canonical platform DateTimePicker */}
              {sendMode === "scheduled" && (
                <div className="space-y-2 pt-2">
                  <Label>Дата и время отправки</Label>
                  <DateTimePicker
                    date={scheduledAt ?? undefined}
                    time={scheduledTime}
                    onDateChange={(d) => setScheduledAt(d ?? null)}
                    onTimeChange={(t) => setScheduledTime(t)}
                  />
                </div>
              )}

              {/* Recurrence rule */}
              {sendMode === "recurring" && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label>Частота</Label>
                      <Select
                        value={recurrence.frequency}
                        onValueChange={(v) =>
                          setRecurrence((r) => ({ ...r, frequency: v as Frequency }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Ежедневно</SelectItem>
                          <SelectItem value="weekly">Еженедельно</SelectItem>
                          <SelectItem value="monthly">Ежемесячно</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Каждые</Label>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={recurrence.interval}
                        onChange={(e) =>
                          setRecurrence((r) => ({
                            ...r,
                            interval: Math.max(1, parseInt(e.target.value) || 1),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Время</Label>
                      <Input
                        type="time"
                        value={recurrence.time_of_day}
                        onChange={(e) =>
                          setRecurrence((r) => ({ ...r, time_of_day: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  {recurrence.frequency === "weekly" && (
                    <div className="space-y-2">
                      <Label>Дни недели</Label>
                      <div className="flex gap-2 flex-wrap">
                        {[
                          { d: 1, l: "Пн" },
                          { d: 2, l: "Вт" },
                          { d: 3, l: "Ср" },
                          { d: 4, l: "Чт" },
                          { d: 5, l: "Пт" },
                          { d: 6, l: "Сб" },
                          { d: 7, l: "Вс" },
                        ].map(({ d, l }) => {
                          const active = (recurrence.by_weekday || []).includes(d);
                          return (
                            <Button
                              key={d}
                              type="button"
                              size="sm"
                              variant={active ? "default" : "outline"}
                              onClick={() =>
                                setRecurrence((r) => {
                                  const cur = r.by_weekday || [];
                                  return {
                                    ...r,
                                    by_weekday: active
                                      ? cur.filter((x) => x !== d)
                                      : [...cur, d].sort(),
                                  };
                                })
                              }
                            >
                              {l}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {recurrence.frequency === "monthly" && (
                    <div className="space-y-2">
                      <Label>День месяца (1–31)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={31}
                        value={(recurrence.by_monthday && recurrence.by_monthday[0]) || 1}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(31, parseInt(e.target.value) || 1));
                          setRecurrence((r) => ({ ...r, by_monthday: [v] }));
                        }}
                        className="w-32"
                      />
                      <p className="text-xs text-muted-foreground">
                        Если в месяце меньше дней — рассылка будет в последний день месяца.
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Дата окончания (опционально)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        value={recurrence.ends_at ? recurrence.ends_at.slice(0, 10) : ""}
                        onChange={(e) =>
                          setRecurrence((r) => ({
                            ...r,
                            ends_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                          }))
                        }
                        className="w-48"
                      />
                      {recurrence.ends_at && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRecurrence((r) => ({ ...r, ends_at: null }))}
                        >
                          Очистить
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {sendMode !== "now" && (
                <div className="space-y-2 pt-2">
                  <Label>{sendMode === "template" ? "Название шаблона" : sendMode === "event" ? "Название автоматической рассылки" : "Название рассылки (для таблицы «Запланированные»)"}</Label>
                  <Input
                    value={scheduledName}
                    onChange={(e) => setScheduledName(e.target.value)}
                    placeholder="Например: Анонс эфира 1 мая"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Telegram composer */}
          {sendToTelegram && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageCircle className="h-5 w-5 text-blue-500" />
                  Telegram-рассылка
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Одно и то же медиа для немедленной, запланированной и шаблонной рассылки. */}
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
                        <img src={mediaFile.preview} alt="Preview" className="w-20 h-20 object-cover rounded" />
                      )}
                      {mediaFile.type === "video" && (
                        <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                          <Video className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      {mediaFile.type === "animation" && (
                        mediaFile.preview ? (
                          mediaFile.fileName.toLowerCase().endsWith(".mp4") ? (
                            <video src={mediaFile.preview} autoPlay loop muted playsInline className="w-20 h-20 object-cover rounded" />
                          ) : (
                            <img src={mediaFile.preview} alt="Предпросмотр GIF" className="w-20 h-20 object-cover rounded" />
                          )
                        ) : (
                          <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                            <Film className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )
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
                      {mediaFile.type === "document" && (
                        <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                          <FileText className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mediaFile.fileName}</p>
                        {mediaFile.file && (
                          <p className="text-xs text-muted-foreground">
                            {(mediaFile.file.size / 1024 / 1024).toFixed(2)} МБ
                          </p>
                        )}
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
                        onChange={(e) => handleFileSelect(e, pendingMediaTypeRef.current)}
                      />
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2">
                            <Paperclip className="h-4 w-4" />
                            Вложение
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2" align="start">
                          <div className="space-y-1">
                            <Button variant="ghost" size="sm" className="w-full justify-start gap-2"
                              onClick={() => chooseMedia("photo", "image/jpeg,image/png,image/webp")}>
                              <Image className="h-4 w-4" /> Фото
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full justify-start gap-2"
                              onClick={() => chooseMedia("animation", "image/gif,video/mp4")}>
                              <Film className="h-4 w-4" /> GIF / анимация
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full justify-start gap-2"
                              onClick={() => chooseMedia("video", "video/mp4,video/quicktime,video/webm")}>
                              <Video className="h-4 w-4" /> Видео
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full justify-start gap-2"
                              onClick={() => chooseMedia("audio", "audio/*")}>
                              <Music className="h-4 w-4" /> Аудио
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full justify-start gap-2"
                              onClick={() => chooseMedia("video_note", "video/mp4")}>
                              <Circle className="h-4 w-4" /> Кружок
                            </Button>
                            <Button variant="ghost" size="sm" className="w-full justify-start gap-2"
                              onClick={() => chooseMedia("document", ".pdf,.doc,.docx,.xls,.xlsx,.zip,.txt")}>
                              <FileText className="h-4 w-4" /> Файл
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                      <span className="text-xs text-muted-foreground">GIF — файл .gif или короткий зацикленный .mp4</span>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Текст сообщения {mediaFile && "(подпись к медиа)"}</Label>
                  <TokenizedRichInput
                    value={message}
                    onChange={setMessage}
                    placeholder="Введите текст сообщения для рассылки..."
                    rows={6}
                  />
                  {mediaFile && (
                    <Alert variant={telegramWillSplit ? "destructive" : "default"}>
                      {telegramWillSplit ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                      <AlertDescription>{telegramDeliveryHint}</AlertDescription>
                    </Alert>
                  )}
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

                <Separator />
                <div className="space-y-2">
                  <Label>Предпросмотр в Telegram</Label>
                  <TelegramMessagePreview
                    text={message}
                    mediaType={mediaFile?.type}
                    mediaUrl={mediaFile?.preview}
                    fileName={mediaFile?.fileName}
                    showButton={includeButton}
                    buttonText={buttonText}
                    deliveryHint={telegramDeliveryHint}
                    willSplit={telegramWillSplit}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Email composer */}
          {sendToEmail && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-orange-500" />
                  Email-рассылка
                </CardTitle>
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
          )}

          {/* Safe single-recipient tests. These never use the broadcast audience. */}
          {sendMode === "now" && (sendToTelegram || sendToEmail) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Тестовая отправка</CardTitle>
                <CardDescription>
                  Проверяет сообщение на одном получателе. Рассылка по аудитории не запускается.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sendToTelegram && (
                  <div className="rounded-lg border p-4 space-y-3 min-w-0">
                    <div className="flex items-start gap-3">
                      <MessageCircle className="h-5 w-5 shrink-0 text-blue-500 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium">Telegram текущему администратору</p>
                        <p className="text-sm text-muted-foreground break-words">
                          {testRecipientLoading
                            ? "Проверяем профиль…"
                            : testRecipient?.full_name || "Имя администратора не указано"}
                          {testRecipient?.telegram_username ? ` · @${testRecipient.telegram_username.replace(/^@/, "")}` : ""}
                        </p>
                        {!testRecipientLoading && !testRecipient?.telegram_user_id && (
                          <p className="text-sm text-destructive mt-1">
                            Telegram не привязан к этому профилю. Войдите под нужным администратором или привяжите его Telegram.
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => sendTelegramTestMutation.mutate()}
                      disabled={
                        testRecipientLoading ||
                        !testRecipient?.telegram_user_id ||
                        (!message.trim() && !mediaFile) ||
                        sendTelegramTestMutation.isPending
                      }
                    >
                      {sendTelegramTestMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Отправить тест в Telegram
                    </Button>
                  </div>
                )}

                {sendToEmail && (
                  <div className="rounded-lg border p-4 space-y-3 min-w-0">
                    <div className="flex items-start gap-3">
                      <Mail className="h-5 w-5 shrink-0 text-orange-500 mt-0.5" />
                      <div className="min-w-0">
                        <Label htmlFor="broadcast-test-email" className="font-medium">
                          Email для теста
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Адрес вводится явно и не зависит от профиля текущего администратора.
                        </p>
                      </div>
                    </div>
                    <Input
                      id="broadcast-test-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={testEmail}
                      onChange={(event) => setTestEmail(event.target.value)}
                      placeholder="name@example.com"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => sendEmailTestMutation.mutate()}
                      disabled={
                        !testEmail.trim() ||
                        !emailSubject.trim() ||
                        !emailBody.trim() ||
                        sendEmailTestMutation.isPending
                      }
                    >
                      {sendEmailTestMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Mail className="h-4 w-4" />
                      )}
                      Отправить тестовое письмо
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Send Buttons */}
          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1 gap-2"
              onClick={handleSend}
              disabled={isSendDisabled}
            >
              {(sendTelegramMutation.isPending || sendEmailMutation.isPending || saveScheduledMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {sendMode === "now" ? "Отправка..." : "Сохранение..."}
                </>
              ) : sendMode === "now" ? (
                <>
                  <Send className="h-4 w-4" />
                  Отправить
                  {channelsArr.length > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {channelsArr.map((c) => (c === "telegram" ? "TG" : "Email")).join(" + ")}
                    </Badge>
                  )}
                </>
              ) : sendMode === "scheduled" ? (
                <>
                  <CalendarIcon className="h-4 w-4" />
                  {editTemplateId ? "Сохранить изменения" : "Запланировать"}
                </>
              ) : sendMode === "recurring" ? (
                <>
                  <Repeat className="h-4 w-4" />
                  {editTemplateId ? "Сохранить изменения" : "Создать повторяющуюся"}
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  {editTemplateId ? "Сохранить шаблон" : "Сохранить как шаблон"}
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
        <div className="min-w-0 space-y-6 xl:w-[360px]">
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

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Условие по обучению</Label>
                  {filters.education && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFilters((current) => ({ ...current, education: undefined }))}
                    >
                      Сбросить
                    </Button>
                  )}
                </div>
                <Select
                  value={filters.education?.module_id || "none"}
                  onValueChange={(moduleId) => setFilters((current) => ({
                    ...current,
                    education: moduleId === "none" ? undefined : {
                      module_id: moduleId,
                      lesson_id: "",
                      status: "lesson_completed",
                    },
                  }))}
                >
                  <SelectTrigger><SelectValue placeholder="Без условия" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без условия</SelectItem>
                    {(trainingModules || []).map((module) => (
                      <SelectItem key={module.id} value={module.id}>{module.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filters.education && (
                  <>
                    <Select
                      value={filters.education.lesson_id || ""}
                      onValueChange={(lessonId) => setFilters((current) => ({
                        ...current,
                        education: current.education ? { ...current.education, lesson_id: lessonId } : undefined,
                      }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите урок" /></SelectTrigger>
                      <SelectContent>
                        {(trainingLessons || []).map((lesson) => (
                          <SelectItem key={lesson.id} value={lesson.id}>{lesson.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={filters.education.status}
                      onValueChange={(status) => setFilters((current) => ({
                        ...current,
                        education: current.education ? {
                          ...current.education,
                          status: status as NonNullable<BroadcastFilters["education"]>["status"],
                        } : undefined,
                      }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lesson_completed">Урок пройден</SelectItem>
                        <SelectItem value="lesson_not_completed">Урок не пройден</SelectItem>
                        <SelectItem value="homework_submitted">Домашнее задание сдано</SelectItem>
                        <SelectItem value="homework_not_submitted">Домашнее задание не сдано</SelectItem>
                        <SelectItem value="form_answered">Анкета заполнена</SelectItem>
                        <SelectItem value="form_not_answered">Анкета не заполнена</SelectItem>
                      </SelectContent>
                    </Select>
                    {!filters.education.lesson_id && (
                      <p className="text-xs text-destructive">Выберите конкретный урок.</p>
                    )}
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  Перед отправкой условие проверяется повторно по фактическому прогрессу ученика.
                </p>
              </div>

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
                ) : hasAudienceError ? (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-xs space-y-2">
                      <div className="font-medium">Ошибка расчёта</div>
                      <div className="break-words opacity-90">{readableBroadcastError(audienceError)}</div>
                      <Button type="button" variant="outline" size="sm" onClick={() => refetchAudience()}>
                        Повторить
                      </Button>
                    </AlertDescription>
                  </Alert>
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
