import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";

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
  created_at: string;
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
  const [activeTab, setActiveTab] = useState("drafts");
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [editForm, setEditForm] = useState({ title: "", summary: "", effective_date: "" });
  
  // Publication options
  const [publishToSite, setPublishToSite] = useState(true);
  const [publishToTelegram, setPublishToTelegram] = useState(true);

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

  // Run scraper mutation
  const runScraperMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("monitor-news", {
        body: { limit: 10 },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Парсинг завершён: ${data.totalItems} новых новостей`);
      queryClient.invalidateQueries({ queryKey: ["editorial-news"] });
      queryClient.invalidateQueries({ queryKey: ["news-sources-all"] });
    },
    onError: (error) => {
      toast.error(`Ошибка парсинга: ${error.message}`);
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
          <TabsList>
            <TabsTrigger value="drafts" className="flex items-center gap-2">
              <Edit className="h-4 w-4" />
              Входящие
              {draftNews && draftNews.length > 0 && (
                <Badge variant="secondary">{draftNews.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="queued" className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              В очереди
              {queuedNews && queuedNews.length > 0 && (
                <Badge variant="secondary">{queuedNews.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="sent" className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Опубликовано
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Настройки
              {healthStats && healthStats.error > 0 && (
                <Badge variant="destructive">{healthStats.error}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

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
                <Button onClick={handleAddSource}>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить
                </Button>
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
                        <TableHead>Категория</TableHead>
                        <TableHead className="w-20">Приор.</TableHead>
                        <TableHead>Последний скан</TableHead>
                        <TableHead className="w-24">Действия</TableHead>
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
                            <TableCell>
                              <div className="flex gap-1">
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
          <DialogContent className="max-w-2xl">
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
                  Поддерживается HTML: &lt;b&gt;жирный&lt;/b&gt;, &lt;i&gt;курсив&lt;/i&gt;, &lt;u&gt;подчёркнутый&lt;/u&gt;
                </p>
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
      </div>
    </AdminLayout>
  );
};

export default AdminEditorial;
