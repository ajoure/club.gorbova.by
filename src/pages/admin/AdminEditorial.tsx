import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVisibilityPolling } from "@/hooks/useVisibilityPolling";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Newspaper,
  Send,
  Clock,
  CheckCircle,
  RefreshCw,
  ExternalLink,
  Edit,
  Trash2,
  Calendar,
  Globe,
  Loader2,
  Play,
  Settings,
  Plus,
  XCircle,
  AlertCircle,
  Brain,
  RefreshCcw,
  Info,
  Zap,
  Upload,
  FileJson,
  Download,
  MessageSquare,
} from "lucide-react";
import { StyleProfileDialog } from "@/components/admin/StyleProfileDialog";
import { SyncResultDialog } from "@/components/admin/SyncResultDialog";
import { AudienceInsightsDialog } from "@/components/admin/AudienceInsightsDialog";

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  ai_summary: string | null;
  source: string;
  source_url: string | null;
  country: string;
  category: string;
  effective_date: string | null;
  telegram_status: string;
  news_priority: string;
  keywords: string[] | null;
  created_at: string;
  scraped_at: string | null;
  source_id: string | null;
  is_published: boolean;
  is_resonant?: boolean;
  resonance_topics?: string[] | null;
  news_sources?: {
    name: string;
  };
}

interface TelegramChannel {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_type: string;
  is_active: boolean;
}

// P0.9.1: ScrapeConfig interface for UI
interface ScrapeConfig {
  type?: string;
  rss_url?: string;
  fallback_url?: string;
  proxy_mode?: "auto" | "enhanced";
  country?: "BY" | "RU" | "AUTO";
  requires_auth?: boolean;
}

interface NewsSource {
  id: string;
  name: string;
  url: string;
  country: string;
  category: string;
  is_active: boolean;
  priority: number;
  last_scraped_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  last_error_details: Record<string, unknown> | null;
  scrape_config: ScrapeConfig | null;
  created_at: string;
}

// P0.9.3: Human-readable error labels
const getErrorLabel = (code: string | null): { label: string; emoji: string } => {
  if (!code) return { label: "", emoji: "" };
  switch (code) {
    case "404":
    case "410":
      return { label: "URL не найден", emoji: "📭" };
    case "400":
      return { label: "Неверный запрос", emoji: "⚠️" };
    case "401":
    case "403":
      return { label: "Блок/гео/доступ", emoji: "🚫" };
    case "429":
      return { label: "Лимит запросов", emoji: "🔄" };
    case "timeout":
      return { label: "Таймаут/рендер", emoji: "⏱" };
    case "500":
    case "502":
    case "503":
    case "504":
      return { label: "Ошибка сервера", emoji: "💥" };
    case "no_api_key":
      return { label: "Нет API ключа", emoji: "🔑" };
    case "auth_required":
      return { label: "Нужна авторизация", emoji: "🔐" };
    default:
      return { label: `Ошибка: ${code}`, emoji: "❌" };
  }
};

// P1.9.5: Get scrape method badge
const getScrapeMethodBadge = (config: ScrapeConfig | null): { label: string; variant: "default" | "secondary" | "outline" } => {
  if (!config) return { label: "Auto", variant: "outline" };
  if (config.rss_url) return { label: "📡 RSS", variant: "default" };
  if (config.proxy_mode === "enhanced") return { label: "🔒 Enhanced", variant: "secondary" };
  return { label: "🌐 Auto", variant: "outline" };
};

interface ScrapeLog {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  sources_total: number;
  sources_success: number;
  sources_failed: number;
  news_found: number;
  news_saved: number;
  news_duplicates: number;
  errors: unknown;
  summary: string | null;
  triggered_by: string;
}

interface ChannelSettings {
  style_profile?: {
    tone?: string;
    avg_length?: string;
    characteristic_phrases?: string[];
    generated_at?: string;
  };
}

// Helper to format news for publication per regulations
const formatNewsForPublication = (news: NewsItem) => {
  const effectiveDateFormatted = news.effective_date
    ? format(new Date(news.effective_date), "dd MMMM yyyy", { locale: ru })
    : null;

  let formattedSummary = news.ai_summary || news.summary || "";

  // Auto-format with HTML tags per regulations
  if (effectiveDateFormatted) {
    formattedSummary = `${formattedSummary}\n\n<u>Вступает в силу: ${effectiveDateFormatted}</u>`;
  }

  return {
    title: `<b>${news.title}</b>`,
    summary: formattedSummary,
  };
};

// Health status helper
const getHealthStatus = (source: NewsSource) => {
  if (source.last_error) {
    return { status: "error", icon: "🔴", label: "Ошибка", color: "text-destructive" };
  }
  if (!source.last_scraped_at) {
    return { status: "never", icon: "⚪", label: "Никогда", color: "text-muted-foreground" };
  }

  const hoursSinceLastScrape =
    (Date.now() - new Date(source.last_scraped_at).getTime()) / (1000 * 60 * 60);

  if (hoursSinceLastScrape < 24) {
    return { status: "online", icon: "🟢", label: "Online", color: "text-green-600" };
  }
  if (hoursSinceLastScrape < 48) {
    return { status: "stale", icon: "🟡", label: "Устарел", color: "text-yellow-600" };
  }
  return { status: "offline", icon: "🔴", label: "Offline", color: "text-destructive" };
};

const AdminEditorial = () => {
  const queryClient = useQueryClient();
  const visibilityInterval = useVisibilityPolling(30000);
  const [activeTab, setActiveTab] = useState("drafts");
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [editForm, setEditForm] = useState({ title: "", summary: "", effective_date: "" });
  
  // Publication options
  const [publishToSite, setPublishToSite] = useState(true);
  const [publishToTelegram, setPublishToTelegram] = useState(true);

  // Style profile dialog state
  const [styleResultDialogOpen, setStyleResultDialogOpen] = useState(false);
  const [styleResult, setStyleResult] = useState<{
    success: boolean;
    posts_analyzed: number;
    katerina_messages: number;
    data_source: string;
    style_profile: Record<string, unknown>;
  } | null>(null);

  // Sync result dialog state
  const [syncResultDialogOpen, setSyncResultDialogOpen] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  // Audience insights dialog state
  const [audienceDialogOpen, setAudienceDialogOpen] = useState(false);
  const [audienceResult, setAudienceResult] = useState<any>(null);

  // Sources management state
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<NewsSource | null>(null);
  const [sourceForm, setSourceForm] = useState({
    name: "",
    url: "",
    country: "by",
    category: "npa",
    priority: 50,
    is_active: true,
  });

  // Fetch news by status
  const { data: draftNews, isLoading: loadingDrafts } = useQuery({
    queryKey: ["editorial-news", "draft"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_content")
        .select("*, news_sources(name)")
        .eq("telegram_status", "draft")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as NewsItem[];
    },
  });

  const { data: queuedNews, isLoading: loadingQueued } = useQuery({
    queryKey: ["editorial-news", "queued"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_content")
        .select("*, news_sources(name)")
        .eq("telegram_status", "queued")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as NewsItem[];
    },
  });

  const { data: sentNews, isLoading: loadingSent } = useQuery({
    queryKey: ["editorial-news", "sent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_content")
        .select("*, news_sources(name)")
        .eq("telegram_status", "sent")
        .order("telegram_sent_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as NewsItem[];
    },
  });

  // Fetch channels
  const { data: channels } = useQuery({
    queryKey: ["telegram-publish-channels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_publish_channels")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data as TelegramChannel[];
    },
  });

  // Fetch sources for settings tab
  const { data: sources, isLoading: loadingSources } = useQuery({
    queryKey: ["news-sources-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_sources")
        .select("*")
        .order("priority", { ascending: false });
      if (error) throw error;
      return data as NewsSource[];
    },
  });

  // Fetch last scrape log for notifications
  const { data: lastScrapeLog, refetch: refetchScrapeLog } = useQuery({
    queryKey: ["last-scrape-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scrape_logs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ScrapeLog | null;
    },
    refetchInterval: visibilityInterval, // Pause when tab hidden
  });

  // Fetch channel settings for style profile
  const { data: channelWithStyle } = useQuery({
    queryKey: ["channel-style-profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_publish_channels")
        .select("id, channel_name, settings")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; channel_name: string; settings: ChannelSettings } | null;
    },
  });

  // Run scraper mutation - now async with immediate response
  const runScraperMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("monitor-news", {
        body: { limit: 10, async: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Парсинг запущен в фоне", {
        description: "Вы можете продолжить работу. Результаты появятся автоматически.",
      });
      // Start polling for results
      setTimeout(() => refetchScrapeLog(), 2000);
    },
    onError: (error) => {
      toast.error(`Ошибка запуска: ${error.message}`);
    },
  });

  // Learn style mutation
  const learnStyleMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const { data, error } = await supabase.functions.invoke("telegram-learn-style", {
        body: { channel_id: channelId, force: true },
      });
      if (error) throw error;
      // Check if API returned an error in the response body
      if (data?.error) {
        throw new Error(data.error);
      }
      return data;
    },
    onSuccess: (data) => {
      // Show dialog with detailed results instead of toast
      setStyleResult(data);
      setStyleResultDialogOpen(true);
      queryClient.invalidateQueries({ queryKey: ["channel-style-profile"] });
    },
    onError: (error: Error) => {
      // Check if error is about insufficient posts
      if (error.message.includes("at least 5") || error.message.includes("минимум 5")) {
        toast.error("Недостаточно постов для анализа", {
          description: "Опубликуйте минимум 5 новостей в Telegram, затем попробуйте снова.",
        });
      } else if (error.message.includes("Channel not found")) {
        toast.error("Канал не найден", {
          description: "Добавьте и активируйте Telegram-канал в настройках.",
        });
      } else {
        toast.error(`Ошибка: ${error.message}`);
      }
    },
  });

  // Import channel history mutation
  const importHistoryMutation = useMutation({
    mutationFn: async (exportData: unknown) => {
      const { data, error } = await supabase.functions.invoke("import-telegram-history", {
        body: { 
          export_data: exportData,
          channel_id: channelWithStyle?.settings ? (channelWithStyle as { id: string; channel_name: string; settings: ChannelSettings & { channel_id?: string } })?.settings?.channel_id : null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success("История канала импортирована", {
        description: `Импортировано ${data.imported} постов из ${data.text_messages}`,
      });
      queryClient.invalidateQueries({ queryKey: ["archived-posts-count"] });
    },
    onError: (error: Error) => {
      toast.error(`Ошибка импорта: ${error.message}`);
    },
  });

  // Sync bot history mutation
  const syncHistoryMutation = useMutation({
    mutationFn: async () => {
      const channelId = channelWithStyle?.settings 
        ? (channelWithStyle as { id: string; channel_name: string; settings: ChannelSettings & { channel_id?: string } })?.settings?.channel_id 
        : null;
      
      const { data, error } = await supabase.functions.invoke("sync-telegram-history", {
        body: { channel_id: channelId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      // Show detailed dialog with sync results
      setSyncResult({
        total_messages: data.total_messages || 0,
        katerina_messages: data.katerina_messages || 0,
        katerina_meaningful: data.katerina_meaningful || 0,
        audience_messages: data.audience_messages || 0,
        audience_meaningful: data.audience_meaningful || 0,
        unique_users: data.unique_users || 0,
        synced_katerina: data.synced_katerina || 0,
        earliest_date: data.earliest_date,
        latest_date: data.latest_date,
        ready_for_style: data.ready_for_style ?? false,
        ready_for_audience_analysis: data.ready_for_audience_analysis ?? false,
        by_user: data.by_user,
      });
      setSyncResultDialogOpen(true);
      refetchKaterinaCount();
      refetchKaterinaDateRange();
      queryClient.invalidateQueries({ queryKey: ["archived-posts-count"] });
    },
    onError: (error: Error) => {
      toast.error(`Ошибка синхронизации: ${error.message}`);
    },
  });

  // Analyze audience mutation
  const analyzeAudienceMutation = useMutation({
    mutationFn: async () => {
      const channelId = channelWithStyle?.settings 
        ? (channelWithStyle as any)?.settings?.channel_id 
        : null;
      
      const { data, error } = await supabase.functions.invoke("analyze-audience", {
        body: { channel_id: channelId, force: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      setAudienceResult(data);
      setAudienceDialogOpen(true);
    },
    onError: (error: Error) => {
      toast.error(`Ошибка анализа: ${error.message}`);
    },
  });

  // Fetch archived posts count for the active channel
  const { data: archivedPostsCount } = useQuery({
    queryKey: ["archived-posts-count", channelWithStyle?.id],
    queryFn: async () => {
      if (!channelWithStyle) return 0;
      // Get channel_id from telegram_publish_channels
      const { data: channelData } = await supabase
        .from("telegram_publish_channels")
        .select("channel_id")
        .eq("id", channelWithStyle.id)
        .single();
      
      if (!channelData?.channel_id) return 0;

      const { count, error } = await supabase
        .from("channel_posts_archive")
        .select("*", { count: "exact", head: true })
        .eq("channel_id", channelData.channel_id);
      
      if (error) return 0;
      return count || 0;
    },
    enabled: !!channelWithStyle,
  });

  // Fetch Katerina Gorbova's message count (from_tg_user_id = 99340019)
  const { data: katerinaMessagesCount, refetch: refetchKaterinaCount } = useQuery({
    queryKey: ["katerina-messages-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("tg_chat_messages")
        .select("*", { count: "exact", head: true })
        .eq("from_tg_user_id", 99340019)
        .not("text", "is", null);
      
      if (error) return 0;
      return count || 0;
    },
  });

  // Fetch earliest message date from Katerina
  const { data: katerinaDateRange, refetch: refetchKaterinaDateRange } = useQuery({
    queryKey: ["katerina-messages-date-range"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tg_chat_messages")
        .select("message_ts")
        .eq("from_tg_user_id", 99340019)
        .not("text", "is", null)
        .order("message_ts", { ascending: true })
        .limit(1);
      
      if (error || !data || data.length === 0) return null;
      return { earliest: data[0].message_ts };
    },
  });

  // Total posts available for style learning
  const totalPostsForStyle = (katerinaMessagesCount || 0) + (sentNews?.length || 0) + (archivedPostsCount || 0);
  const hasEnoughPosts = totalPostsForStyle >= 5 || (katerinaMessagesCount || 0) >= 5;

  // Handle file upload for history import
  const handleHistoryFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      toast.error("Неверный формат файла", {
        description: "Загрузите JSON-файл экспорта из Telegram Desktop",
      });
      return;
    }

    try {
      const text = await file.text();
      const exportData = JSON.parse(text);
      
      if (!exportData.messages || !Array.isArray(exportData.messages)) {
        toast.error("Неверная структура файла", {
          description: "Файл должен содержать массив messages",
        });
        return;
      }

      importHistoryMutation.mutate(exportData);
    } catch {
      toast.error("Ошибка чтения файла", {
        description: "Не удалось распарсить JSON",
      });
    }
    
    // Reset input
    event.target.value = '';
  };

  // Retry single source mutation
  const retrySourceMutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const { data, error } = await supabase.functions.invoke("monitor-news", {
        body: { sourceId, limit: 1 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Источник перепроверен");
      queryClient.invalidateQueries({ queryKey: ["news-sources-all"] });
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Publish mutation with dual-publishing support
  const publishMutation = useMutation({
    mutationFn: async ({
      newsId,
      channelId,
      action,
      toSite,
      toTelegram,
    }: {
      newsId: string;
      channelId: string;
      action: string;
      toSite: boolean;
      toTelegram: boolean;
    }) => {
      const results: { site?: boolean; telegram?: boolean } = {};

      // Update database if publishing to site
      if (toSite) {
        const { error } = await supabase
          .from("news_content")
          .update({ is_published: true })
          .eq("id", newsId);
        if (error) throw error;
        results.site = true;
      }

      // Publish to Telegram if selected
      if (toTelegram) {
        const { data, error } = await supabase.functions.invoke("telegram-publish-news", {
          body: { action, newsId, channelId },
        });
        if (error) throw error;
        results.telegram = true;
      }

      // Log positive signal for feedback loop
      await supabase.from("audit_logs").insert({
        action: "editorial.publish",
        actor_type: "admin",
        meta: {
          news_id: newsId,
          signal: "positive",
          published_to_site: toSite,
          published_to_telegram: toTelegram,
        },
      });

      return results;
    },
    onSuccess: (data, variables) => {
      const parts = [];
      if (data.site) parts.push("на сайт");
      if (data.telegram) {
        parts.push(variables.action === "add_to_queue" ? "в очередь Telegram" : "в Telegram");
      }
      toast.success(`Новость опубликована: ${parts.join(" и ")}`);
      queryClient.invalidateQueries({ queryKey: ["editorial-news"] });
      setPublishDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Update news mutation
  const updateNewsMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<NewsItem> }) => {
      const { error } = await supabase
        .from("news_content")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Новость обновлена");
      queryClient.invalidateQueries({ queryKey: ["editorial-news"] });
      setEditDialogOpen(false);
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Delete news mutation with feedback loop
  const deleteNewsMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      // Get news data before deletion for feedback
      const { data: newsData } = await supabase
        .from("news_content")
        .select("title, keywords, is_resonant")
        .eq("id", id)
        .single();

      const { error } = await supabase
        .from("news_content")
        .delete()
        .eq("id", id);
      if (error) throw error;

      // Log negative signal for feedback loop
      await supabase.from("audit_logs").insert({
        action: "editorial.reject",
        actor_type: "admin",
        meta: {
          news_id: id,
          signal: "negative",
          reason: reason || "not_specified",
          title: newsData?.title,
          keywords: newsData?.keywords,
          was_resonant: newsData?.is_resonant,
        },
      });
    },
    onSuccess: () => {
      toast.success("Новость удалена");
      queryClient.invalidateQueries({ queryKey: ["editorial-news"] });
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Source mutations
  const saveSourceMutation = useMutation({
    mutationFn: async (data: typeof sourceForm & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("news_sources")
          .update({
            name: data.name,
            url: data.url,
            country: data.country,
            category: data.category,
            priority: data.priority,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("news_sources").insert({
          name: data.name,
          url: data.url,
          country: data.country,
          category: data.category,
          priority: data.priority,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingSource ? "Источник обновлён" : "Источник добавлен");
      queryClient.invalidateQueries({ queryKey: ["news-sources-all"] });
      setSourceDialogOpen(false);
      resetSourceForm();
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("news_sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Источник удалён");
      queryClient.invalidateQueries({ queryKey: ["news-sources-all"] });
    },
    onError: (error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  const toggleSourceMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("news_sources")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news-sources-all"] });
    },
  });

  const resetSourceForm = () => {
    setSourceForm({
      name: "",
      url: "",
      country: "by",
      category: "npa",
      priority: 50,
      is_active: true,
    });
    setEditingSource(null);
  };

  const handleEditSource = (source: NewsSource) => {
    setEditingSource(source);
    setSourceForm({
      name: source.name,
      url: source.url,
      country: source.country,
      category: source.category,
      priority: source.priority,
      is_active: source.is_active,
    });
    setSourceDialogOpen(true);
  };

  const handleAddSource = () => {
    resetSourceForm();
    setSourceDialogOpen(true);
  };

  const handleEdit = (news: NewsItem) => {
    setSelectedNews(news);
    // Auto-format with HTML tags per regulations
    const formatted = formatNewsForPublication(news);
    setEditForm({
      title: news.title,
      summary: news.ai_summary || news.summary || "",
      effective_date: news.effective_date || "",
    });
    setEditDialogOpen(true);
  };

  const handlePublish = (news: NewsItem) => {
    setSelectedNews(news);
    setPublishToSite(true);
    setPublishToTelegram(true);
    if (channels && channels.length > 0) {
      setSelectedChannel(channels[0].id);
    }
    setPublishDialogOpen(true);
  };

  const getCategoryBadge = (category: string) => {
    const variants: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
      npa: { label: "НПА", variant: "default" },
      government: { label: "Госорган", variant: "secondary" },
      media: { label: "СМИ", variant: "outline" },
    };
    return variants[category] || { label: category, variant: "outline" };
  };

  const getCountryFlag = (country: string) => {
    return country === "by" ? "🇧🇾" : "🇷🇺";
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      npa: "НПА",
      government: "Госорган",
      media: "СМИ",
    };
    return labels[category] || category;
  };

  // Health stats for settings tab
  const healthStats = sources
    ? {
        online: sources.filter((s) => getHealthStatus(s).status === "online").length,
        stale: sources.filter((s) => getHealthStatus(s).status === "stale").length,
        error: sources.filter((s) => getHealthStatus(s).status === "error" || getHealthStatus(s).status === "offline").length,
        never: sources.filter((s) => getHealthStatus(s).status === "never").length,
        active: sources.filter((s) => s.is_active).length,
        total: sources.length,
      }
    : null;

  const renderNewsCard = (news: NewsItem, showActions = true) => (
    <Card key={news.id} className="mb-4">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {news.news_priority === "urgent" && (
                <Badge variant="destructive" className="text-xs">🔴 СРОЧНО</Badge>
              )}
              {news.is_resonant && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge className="text-xs bg-orange-500 hover:bg-orange-600">
                        🔥 Резонанс
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Совпадение с обсуждениями:</p>
                      <p className="text-xs font-medium">{news.resonance_topics?.join(', ') || 'темы аудитории'}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Badge {...getCategoryBadge(news.category)}>{getCategoryBadge(news.category).label}</Badge>
              <span className="text-muted-foreground text-xs">{getCountryFlag(news.country)}</span>
              <span className="text-muted-foreground text-xs">
                {news.news_sources?.name || news.source}
              </span>
              <span className="text-muted-foreground text-xs">
                {format(new Date(news.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
              </span>
              {news.is_published && (
                <Badge variant="outline" className="text-xs bg-green-50">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  На сайте
                </Badge>
              )}
            </div>
            <CardTitle className="text-base leading-tight">{news.title}</CardTitle>
          </div>
          {showActions && (
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" onClick={() => handleEdit(news)}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const reason = prompt("Причина удаления (необязательно):");
                  if (reason !== null) {
                    deleteNewsMutation.mutate({ id: news.id, reason: reason || undefined });
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3 line-clamp-3">
          {news.ai_summary || news.summary || "Нет описания"}
        </p>

        {news.effective_date && (
          <div className="flex items-center gap-1 text-sm mb-3">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="underline">
              Вступает в силу: {format(new Date(news.effective_date), "dd MMMM yyyy", { locale: ru })}
            </span>
          </div>
        )}

        {news.keywords && news.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {news.keywords.slice(0, 5).map((kw, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {kw}
              </Badge>
            ))}
          </div>
        )}

        {showActions && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={() => handlePublish(news)}>
              <Send className="h-4 w-4 mr-1" />
              Опубликовать
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (channels && channels.length > 0) {
                  publishMutation.mutate({
                    newsId: news.id,
                    channelId: channels[0].id,
                    action: "add_to_queue",
                    toSite: false,
                    toTelegram: true,
                  });
                } else {
                  toast.error("Нет настроенных каналов");
                }
              }}
            >
              <Clock className="h-4 w-4 mr-1" />
              В очередь
            </Button>
            {news.source_url && (
              <Button size="sm" variant="ghost" asChild>
                <a href={news.source_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Источник
                </a>
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Newspaper className="h-6 w-6" />
              Редакция
            </h1>
            <p className="text-muted-foreground">
              Мониторинг новостей и публикация в Telegram
            </p>
          </div>
          <Button
            onClick={() => runScraperMutation.mutate()}
            disabled={runScraperMutation.isPending}
          >
            {runScraperMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Запустить парсинг
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto -mx-4 px-4 pb-2">
            <TabsList className="inline-flex w-auto min-w-full sm:w-auto">
              <TabsTrigger value="drafts" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <Edit className="h-4 w-4 hidden sm:block" />
                Входящие
                {draftNews && draftNews.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{draftNews.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="queued" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <Clock className="h-4 w-4 hidden sm:block" />
                В очереди
                {queuedNews && queuedNews.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{queuedNews.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="sent" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <CheckCircle className="h-4 w-4 hidden sm:block" />
                Опубликовано
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm">
                <Settings className="h-4 w-4 hidden sm:block" />
                Настройки
                {healthStats && healthStats.error > 0 && (
                  <Badge variant="destructive" className="ml-1">{healthStats.error}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="drafts" className="mt-4">
            {loadingDrafts ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : draftNews && draftNews.length > 0 ? (
              <div className="grid gap-4">
                {draftNews.map((news) => renderNewsCard(news))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Нет новых черновиков</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Нажмите "Запустить парсинг" для поиска новостей
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="queued" className="mt-4">
            {loadingQueued ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : queuedNews && queuedNews.length > 0 ? (
              <div className="grid gap-4">
                {queuedNews.map((news) => renderNewsCard(news, false))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Очередь пуста</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="sent" className="mt-4">
            {loadingSent ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : sentNews && sentNews.length > 0 ? (
              <div className="grid gap-4">
                {sentNews.map((news) => renderNewsCard(news, false))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-8 text-center">
                  <CheckCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Нет опубликованных новостей</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Settings Tab with Sources & Health Status */}
          <TabsContent value="settings" className="mt-4 space-y-6">
            {/* Last Scrape Result Notification */}
            {lastScrapeLog && lastScrapeLog.status === "completed" && (
              <Card className="border-green-200 bg-green-50 dark:bg-green-950/20">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium text-green-800 dark:text-green-200">
                        {lastScrapeLog.summary || `Найдено ${lastScrapeLog.news_saved} новостей`}
                      </p>
                      <p className="text-sm text-green-600 dark:text-green-400">
                        {format(new Date(lastScrapeLog.completed_at || lastScrapeLog.started_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["editorial-news"] })}>
                    <RefreshCcw className="h-4 w-4 mr-1" />
                    Обновить
                  </Button>
                </CardContent>
              </Card>
            )}

            {lastScrapeLog && lastScrapeLog.status === "running" && (
              <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                <CardContent className="p-4 flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                  <div>
                    <p className="font-medium text-blue-800 dark:text-blue-200">Парсинг в процессе...</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">Результаты появятся автоматически</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* AI Style Control Panel */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Управление ИИ-стилем
                </CardTitle>
                <CardDescription>
                  Обучите ИИ писать в стиле вашего канала
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    {channelWithStyle?.settings?.style_profile ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            Тон: {channelWithStyle.settings.style_profile.tone || "деловой"}
                          </Badge>
                          <Badge variant="outline">
                            Длина: {channelWithStyle.settings.style_profile.avg_length || "средняя"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Последний анализ: {channelWithStyle.settings.style_profile.generated_at 
                            ? format(new Date(channelWithStyle.settings.style_profile.generated_at), "dd.MM.yyyy HH:mm", { locale: ru })
                            : "—"}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          Стиль ещё не изучен. Нажмите "Обучить" для анализа.
                        </p>
                        {!channelWithStyle && (
                          <p className="text-xs text-orange-600">
                            ⚠️ Нет активного Telegram-канала. Добавьте канал в настройках Telegram.
                          </p>
                        )}
                        {channelWithStyle && !hasEnoughPosts && (
                          <p className="text-xs text-orange-600">
                            ⚠️ Постов для анализа: {totalPostsForStyle} из 5 минимум.
                          </p>
                        )}
                        {(katerinaMessagesCount || 0) > 0 && (
                          <p className="text-xs text-green-600">
                            ✅ Найдено {katerinaMessagesCount} сообщений @katerinagorbova
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => channelWithStyle && learnStyleMutation.mutate(channelWithStyle.id)}
                      disabled={learnStyleMutation.isPending || !channelWithStyle || !hasEnoughPosts}
                    >
                      {learnStyleMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Zap className="h-4 w-4 mr-2" />
                      )}
                      Обучить стилю
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Import Channel History Card */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      Импорт истории канала
                    </CardTitle>
                    <CardDescription>
                      Загрузите историю для обучения ИИ стилю
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      refetchKaterinaCount();
                      refetchKaterinaDateRange();
                      queryClient.invalidateQueries({ queryKey: ["archived-posts-count"] });
                      toast.success("Данные обновлены");
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Statistics Section */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-md border p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileJson className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Архив (JSON)</span>
                      </div>
                      <p className="text-2xl font-bold">{archivedPostsCount || 0}</p>
                      <p className="text-xs text-muted-foreground">постов</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Сообщения бота</span>
                      </div>
                      <p className="text-2xl font-bold">{katerinaMessagesCount || 0}</p>
                      <p className="text-xs text-muted-foreground">
                        {katerinaDateRange?.earliest 
                          ? `с ${format(new Date(katerinaDateRange.earliest), "dd.MM.yyyy", { locale: ru })}`
                          : "нет данных"
                        }
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Sync Bot History Button */}
                    <Button
                      variant="outline"
                      onClick={() => syncHistoryMutation.mutate()}
                      disabled={syncHistoryMutation.isPending || (katerinaMessagesCount || 0) === 0}
                    >
                      {syncHistoryMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      Загрузить историю бота
                    </Button>
                    
                    {/* Upload JSON Button */}
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleHistoryFileUpload}
                      className="hidden"
                      id="history-file-input"
                      disabled={importHistoryMutation.isPending}
                    />
                    <Label
                      htmlFor="history-file-input"
                      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer ${importHistoryMutation.isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {importHistoryMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileJson className="h-4 w-4" />
                      )}
                      Загрузить JSON
                    </Label>
                  </div>
                  
                  {/* Info about bot messages */}
                  {(katerinaMessagesCount || 0) > 0 && (
                    <div className="rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 p-3 text-sm">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                        <CheckCircle className="h-4 w-4" />
                        <span className="font-medium">Сообщения бота доступны для анализа</span>
                      </div>
                      <p className="text-green-600 dark:text-green-500 mt-1 text-xs">
                        {katerinaMessagesCount} сообщений @katerinagorbova будут использованы при обучении стилю
                      </p>
                    </div>
                  )}

                  {/* Instructions */}
                  <div className="rounded-md bg-muted p-3 text-sm">
                    <p className="font-medium mb-2">Как экспортировать историю:</p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                      <li>Откройте <strong>Telegram Desktop</strong></li>
                      <li>Перейдите в ваш канал</li>
                      <li>Меню (⋮) → <strong>Экспорт данных чата</strong></li>
                      <li>Выберите формат <strong>JSON</strong></li>
                      <li>Загрузите файл <code className="bg-background px-1 rounded">result.json</code></li>
                    </ol>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Health Status Overview */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{healthStats?.total || 0}</div>
                  <div className="text-sm text-muted-foreground">Всего источников</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">🟢 {healthStats?.online || 0}</div>
                  <div className="text-sm text-muted-foreground">Online</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-600">🟡 {healthStats?.stale || 0}</div>
                  <div className="text-sm text-muted-foreground">Устарел</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-destructive">🔴 {healthStats?.error || 0}</div>
                  <div className="text-sm text-muted-foreground">Ошибки</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold">{healthStats?.active || 0}</div>
                  <div className="text-sm text-muted-foreground">Активных</div>
                </CardContent>
              </Card>
            </div>

            {/* Sources Table */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Источники новостей
                  </CardTitle>
                  <CardDescription>
                    Управление источниками для мониторинга
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {(healthStats?.error || 0) > 0 && (
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const failedSources = sources?.filter(s => 
                          s.last_error || getHealthStatus(s).status === "error" || getHealthStatus(s).status === "offline"
                        ) || [];
                        
                        if (failedSources.length === 0) {
                          toast.info("Все источники работают");
                          return;
                        }
                        
                        toast.info(`Пересканируем ${failedSources.length} проблемных источников...`);
                        
                        for (const source of failedSources) {
                          try {
                            await supabase.functions.invoke("monitor-news", {
                              body: { sourceId: source.id, limit: 1, async: true },
                            });
                          } catch (err) {
                            console.error(`Failed to retry ${source.name}:`, err);
                          }
                        }
                        
                        toast.success(`Запущено пересканирование ${failedSources.length} источников`);
                        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["news-sources-all"] }), 5000);
                      }}
                    >
                      <RefreshCcw className="h-4 w-4 mr-2" />
                      Повторить для ошибок ({healthStats?.error})
                    </Button>
                  )}
                  <Button onClick={handleAddSource}>
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingSources ? (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Вкл</TableHead>
                        <TableHead className="w-12">Статус</TableHead>
                        <TableHead>Источник</TableHead>
                        <TableHead className="w-24">Метод</TableHead>
                        <TableHead>Категория</TableHead>
                        <TableHead className="w-20">Приор.</TableHead>
                        <TableHead>Последний скан</TableHead>
                        <TableHead>Ошибка</TableHead>
                        <TableHead className="w-32">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sources?.map((source) => {
                        const health = getHealthStatus(source);
                        return (
                          <TableRow key={source.id}>
                            <TableCell>
                              <Switch
                                checked={source.is_active}
                                onCheckedChange={(checked) =>
                                  toggleSourceMutation.mutate({ id: source.id, is_active: checked })
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <span className={`text-lg ${health.color}`}>{health.icon}</span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-medium">{health.label}</p>
                                    {source.last_error && (
                                      <p className="text-xs text-destructive max-w-xs truncate">
                                        {source.last_error}
                                      </p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span>{getCountryFlag(source.country)}</span>
                                <div>
                                  <div className="font-medium">{source.name}</div>
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-muted-foreground hover:underline flex items-center gap-1"
                                  >
                                    {new URL(source.url).hostname}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                              </div>
                            </TableCell>
                            {/* P1.9.5: Method column */}
                            <TableCell>
                              {(() => {
                                const methodInfo = getScrapeMethodBadge(source.scrape_config);
                                return (
                                  <Badge variant={methodInfo.variant} className="text-xs whitespace-nowrap">
                                    {methodInfo.label}
                                  </Badge>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{getCategoryLabel(source.category)}</Badge>
                            </TableCell>
                            <TableCell>{source.priority}</TableCell>
                            <TableCell>
                              {source.last_scraped_at ? (
                                <div className="flex items-center gap-1">
                                  {source.last_error ? (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  ) : (
                                    <CheckCircle className="h-4 w-4 text-green-600" />
                                  )}
                                  <span className="text-sm">
                                    {format(new Date(source.last_scraped_at), "dd.MM HH:mm", { locale: ru })}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">Никогда</span>
                              )}
                            </TableCell>
                            {/* P1.9.5: Human-readable error labels */}
                            <TableCell>
                              {source.last_error_code ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      {(() => {
                                        const errInfo = getErrorLabel(source.last_error_code);
                                        return (
                                          <Badge variant="destructive" className="text-xs">
                                            {errInfo.emoji} {errInfo.label}
                                          </Badge>
                                        );
                                      })()}
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      <p className="font-medium">Код: {source.last_error_code}</p>
                                      {source.last_error && <p className="text-xs mt-1">{source.last_error}</p>}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <span className="text-muted-foreground/50">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {(source.last_error || health.status === "error" || health.status === "offline") && (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button 
                                          variant="ghost" 
                                          size="icon"
                                          onClick={() => retrySourceMutation.mutate(source.id)}
                                          disabled={retrySourceMutation.isPending}
                                        >
                                          {retrySourceMutation.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <RefreshCw className="h-4 w-4 text-primary" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Перепроверить источник</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                                <Button variant="ghost" size="icon" onClick={() => handleEditSource(source)}>
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    if (confirm("Удалить этот источник?")) {
                                      deleteSourceMutation.mutate(source.id);
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Edit News Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Редактировать новость</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Заголовок</label>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Описание</label>
                <Textarea
                  value={editForm.summary}
                  onChange={(e) => setEditForm({ ...editForm, summary: e.target.value })}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;, &lt;u&gt;подчёркнутый&lt;/u&gt;
                </p>
              </div>
              
              {/* AI Persona Styling Buttons */}
              <div className="border rounded-lg p-3 bg-muted/30">
                <label className="text-sm font-medium mb-2 block">🎭 Стилизация ИИ</label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!editForm.summary) return;
                      toast.info("Стилизация...");
                      const { data, error } = await supabase.functions.invoke("stylize-sarcasm", {
                        body: { text: editForm.summary, persona: "official" },
                      });
                      if (error) { toast.error(error.message); return; }
                      setEditForm({ ...editForm, summary: data.stylized });
                      toast.success("Официальный стиль применён");
                    }}
                  >
                    📋 Официально
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!editForm.summary) return;
                      toast.info("Стилизация...");
                      const { data, error } = await supabase.functions.invoke("stylize-sarcasm", {
                        body: { text: editForm.summary, persona: "club" },
                      });
                      if (error) { toast.error(error.message); return; }
                      setEditForm({ ...editForm, summary: data.stylized });
                      toast.success("Клубный стиль применён");
                    }}
                  >
                    👥 Для Клуба
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-gradient-to-r from-primary/20 to-accent/20 hover:from-primary/30 hover:to-accent/30"
                    onClick={async () => {
                      if (!editForm.summary) return;
                      toast.info("Применяем стиль Екатерины...");
                      const { data, error } = await supabase.functions.invoke("stylize-sarcasm", {
                        body: { text: editForm.summary, persona: "katerina" },
                      });
                      if (error) { toast.error(error.message); return; }
                      setEditForm({ ...editForm, summary: data.stylized });
                      toast.success("✍️ Стиль Екатерины применён!");
                    }}
                  >
                    ✍️ Стиль Екатерины
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:from-green-500/30 hover:to-emerald-500/30"
                    onClick={async () => {
                      if (!editForm.summary) return;
                      toast.info("Добавляем доброту...");
                      const { data, error } = await supabase.functions.invoke("stylize-sarcasm", {
                        body: { text: editForm.summary, persona: "katerina_kind" },
                      });
                      if (error) { toast.error(error.message); return; }
                      setEditForm({ ...editForm, summary: data.stylized });
                      toast.success("💚 Добрый стиль для клиента применён!");
                    }}
                  >
                    💚 Для клиента (добрый)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!editForm.summary) return;
                      toast.info("Добавляем иронию...");
                      const { data, error } = await supabase.functions.invoke("stylize-sarcasm", {
                        body: { text: editForm.summary, persona: "sarcastic" },
                      });
                      if (error) { toast.error(error.message); return; }
                      setEditForm({ ...editForm, summary: data.stylized });
                      toast.success("🔥 С иронией применён!");
                    }}
                  >
                    🔥 С иронией
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      if (!editForm.summary) return;
                      toast.info("Сокращаем до сути...");
                      const { data, error } = await supabase.functions.invoke("stylize-sarcasm", {
                        body: { text: editForm.summary, persona: "brief" },
                      });
                      if (error) { toast.error(error.message); return; }
                      setEditForm({ ...editForm, summary: data.stylized });
                      toast.success("📌 Краткий факт готов!");
                    }}
                  >
                    📌 Краткий факт
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Дата вступления в силу</label>
                <Input
                  type="date"
                  value={editForm.effective_date}
                  onChange={(e) => setEditForm({ ...editForm, effective_date: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Отмена
              </Button>
              <Button
                onClick={() => {
                  if (selectedNews) {
                    updateNewsMutation.mutate({
                      id: selectedNews.id,
                      updates: {
                        title: editForm.title,
                        ai_summary: editForm.summary,
                        effective_date: editForm.effective_date || null,
                      },
                    });
                  }
                }}
                disabled={updateNewsMutation.isPending}
              >
                {updateNewsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Publish Dialog with dual-publishing options */}
        <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Опубликовать новость</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Publication targets */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Куда опубликовать:</Label>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="publish-site"
                    checked={publishToSite}
                    onCheckedChange={(checked) => setPublishToSite(checked as boolean)}
                  />
                  <Label htmlFor="publish-site" className="font-normal">
                    На сайт (пометить как опубликованное)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="publish-telegram"
                    checked={publishToTelegram}
                    onCheckedChange={(checked) => setPublishToTelegram(checked as boolean)}
                  />
                  <Label htmlFor="publish-telegram" className="font-normal">
                    В Telegram канал
                  </Label>
                </div>
              </div>

              {/* Channel selection (only if Telegram selected) */}
              {publishToTelegram && (
                <div>
                  <label className="text-sm font-medium">Канал</label>
                  <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите канал" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels?.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>
                          {ch.channel_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selectedNews && (
                <Card className="bg-muted/50">
                  <CardContent className="p-4">
                    <p className="font-medium">{selectedNews.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedNews.ai_summary?.slice(0, 150)}...
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPublishDialogOpen(false)}>
                Отмена
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  if (selectedNews && (publishToSite || (publishToTelegram && selectedChannel))) {
                    publishMutation.mutate({
                      newsId: selectedNews.id,
                      channelId: selectedChannel,
                      action: "add_to_queue",
                      toSite: publishToSite,
                      toTelegram: publishToTelegram,
                    });
                  }
                }}
                disabled={publishMutation.isPending || (!publishToSite && !publishToTelegram) || (publishToTelegram && !selectedChannel)}
              >
                <Clock className="h-4 w-4 mr-2" />
                В очередь
              </Button>
              <Button
                onClick={() => {
                  if (selectedNews && (publishToSite || (publishToTelegram && selectedChannel))) {
                    publishMutation.mutate({
                      newsId: selectedNews.id,
                      channelId: selectedChannel,
                      action: "publish_single",
                      toSite: publishToSite,
                      toTelegram: publishToTelegram,
                    });
                  }
                }}
                disabled={publishMutation.isPending || (!publishToSite && !publishToTelegram) || (publishToTelegram && !selectedChannel)}
              >
                {publishMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Send className="h-4 w-4 mr-2" />
                Опубликовать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Source Add/Edit Dialog */}
        <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingSource ? "Редактировать источник" : "Добавить источник"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Название</label>
                <Input
                  value={sourceForm.name}
                  onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
                  placeholder="МНС РБ"
                />
              </div>
              <div>
                <label className="text-sm font-medium">URL</label>
                <Input
                  value={sourceForm.url}
                  onChange={(e) => setSourceForm({ ...sourceForm, url: e.target.value })}
                  placeholder="https://nalog.gov.by/news/"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Страна</label>
                  <Select
                    value={sourceForm.country}
                    onValueChange={(v) => setSourceForm({ ...sourceForm, country: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by">🇧🇾 Беларусь</SelectItem>
                      <SelectItem value="ru">🇷🇺 Россия</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Категория</label>
                  <Select
                    value={sourceForm.category}
                    onValueChange={(v) => setSourceForm({ ...sourceForm, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="npa">НПА</SelectItem>
                      <SelectItem value="government">Госорган</SelectItem>
                      <SelectItem value="media">СМИ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Приоритет (1-100)</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={sourceForm.priority}
                  onChange={(e) => setSourceForm({ ...sourceForm, priority: parseInt(e.target.value) || 50 })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={sourceForm.is_active}
                  onCheckedChange={(checked) => setSourceForm({ ...sourceForm, is_active: checked })}
                />
                <label className="text-sm">Активен</label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSourceDialogOpen(false)}>
                Отмена
              </Button>
              <Button
                onClick={() => {
                  saveSourceMutation.mutate({
                    ...sourceForm,
                    id: editingSource?.id,
                  });
                }}
                disabled={saveSourceMutation.isPending || !sourceForm.name || !sourceForm.url}
              >
                {saveSourceMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Сохранить
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Style Profile Result Dialog */}
        <StyleProfileDialog
          open={styleResultDialogOpen}
          onOpenChange={setStyleResultDialogOpen}
          result={styleResult as any}
          onRelearn={() => channelWithStyle && learnStyleMutation.mutate(channelWithStyle.id)}
          isRelearning={learnStyleMutation.isPending}
        />

        {/* Sync History Result Dialog */}
        <SyncResultDialog
          open={syncResultDialogOpen}
          onOpenChange={setSyncResultDialogOpen}
          result={syncResult}
          onLearnStyle={() => {
            setSyncResultDialogOpen(false);
            channelWithStyle && learnStyleMutation.mutate(channelWithStyle.id);
          }}
          onAnalyzeAudience={() => {
            setSyncResultDialogOpen(false);
            analyzeAudienceMutation.mutate();
          }}
          isLearnStyleLoading={learnStyleMutation.isPending}
          isAnalyzeLoading={analyzeAudienceMutation.isPending}
        />

        {/* Audience Insights Dialog */}
        <AudienceInsightsDialog
          open={audienceDialogOpen}
          onOpenChange={setAudienceDialogOpen}
          result={audienceResult}
          onReanalyze={() => analyzeAudienceMutation.mutate()}
          isReanalyzing={analyzeAudienceMutation.isPending}
        />
      </div>
    </AdminLayout>
  );
};

export default AdminEditorial;
