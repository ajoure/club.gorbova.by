import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Brain,
  RefreshCw,
  Download,
  Filter,
  MessageSquare,
  HelpCircle,
  AlertTriangle,
  Heart,
  ThumbsDown,
  Lightbulb,
  TrendingUp,
  Calendar,
  FileText,
  Sparkles,
  Copy,
  Check,
  Bot,
  Clock,
} from "lucide-react";

interface AudienceInsight {
  id: string;
  insight_type: string;
  title: string;
  description: string | null;
  examples: string[] | null;
  frequency: number | null;
  sentiment: string | null;
  relevance_score: number | null;
  source_message_count: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  meta: any;
}

const insightTypeConfig: Record<string, { icon: any; label: string; color: string }> = {
  topic: { icon: MessageSquare, label: 'Темы', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  question: { icon: HelpCircle, label: 'Вопросы', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  problem: { icon: AlertTriangle, label: 'Проблемы', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  pain_point: { icon: Heart, label: 'Боли', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' },
  objection: { icon: ThumbsDown, label: 'Возражения', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  interest: { icon: Lightbulb, label: 'Интересы', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
};

export default function AdminMarketingInsights() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("insights");
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch insights
  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["audience-insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audience_insights")
        .select("*")
        .order("relevance_score", { ascending: false });
      
      if (error) throw error;
      return data as AudienceInsight[];
    },
  });

  // Run analysis mutation
  const analysisMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("analyze-audience", {
        body: { force: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["audience-insights"] });
      toast.success(`Анализ завершён: ${data.insights_count} инсайтов из ${data.messages_analyzed} сообщений`);
    },
    onError: (error) => {
      toast.error("Ошибка анализа: " + (error as Error).message);
    },
  });

  // Filter insights
  const filteredInsights = insights.filter((insight) => {
    const matchesType = filterType === "all" || insight.insight_type === filterType;
    const matchesSearch = !searchQuery || 
      insight.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      insight.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  // Group by type
  const insightsByType = filteredInsights.reduce((acc, insight) => {
    if (!acc[insight.insight_type]) acc[insight.insight_type] = [];
    acc[insight.insight_type].push(insight);
    return acc;
  }, {} as Record<string, AudienceInsight[]>);

  // Stats
  const lastAnalysis = insights[0]?.updated_at;
  const totalMessages = insights[0]?.source_message_count || 0;
  const summary = insights[0]?.meta?.summary || "";

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd MMM yyyy, HH:mm", { locale: ru });
    } catch {
      return dateStr;
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const exportToCSV = () => {
    const headers = ["Тип", "Название", "Описание", "Примеры", "Частота", "Тональность", "Релевантность"];
    const rows = insights.map(i => [
      insightTypeConfig[i.insight_type]?.label || i.insight_type,
      i.title,
      i.description || "",
      (i.examples || []).join("; "),
      i.frequency?.toString() || "",
      i.sentiment || "",
      i.relevance_score?.toString() || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audience-insights-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Данные экспортированы");
  };

  return (
    <AdminLayout>
      <div className="container mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-amber-600" />
              Маркетинг-инсайты
            </h1>
            <p className="text-muted-foreground">
              Анализ аудитории для создания маркетинговых материалов
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportToCSV} disabled={insights.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Экспорт
            </Button>
            <Button 
              onClick={() => analysisMutation.mutate()}
              disabled={analysisMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${analysisMutation.isPending ? 'animate-spin' : ''}`} />
              {analysisMutation.isPending ? "Анализ..." : "Запустить анализ"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <MessageSquare className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{totalMessages}</p>
              <p className="text-xs text-muted-foreground">Сообщений проанализировано</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <TrendingUp className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-2xl font-bold">{insights.length}</p>
              <p className="text-xs text-muted-foreground">Инсайтов</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Calendar className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">{formatDate(lastAnalysis)}</p>
              <p className="text-xs text-muted-foreground">Последний анализ</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Heart className="h-5 w-5 mx-auto mb-2 text-rose-500" />
              <p className="text-2xl font-bold">{insightsByType['pain_point']?.length || 0}</p>
              <p className="text-xs text-muted-foreground">Болей аудитории</p>
            </CardContent>
          </Card>
        </div>

        {/* Summary */}
        {summary && (
          <Card className="bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Brain className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium mb-1">Резюме анализа</p>
                  <p className="text-sm text-muted-foreground">{summary}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Oleg Integration Status */}
        <Card className="border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bot className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium flex items-center gap-2">
                    Связь с ботом Олегом
                    <Badge variant="outline" className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-300">
                      Активна
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Инсайты автоматически передаются боту для использования в продажах
                  </p>
                </div>
              </div>
              <div className="text-right text-sm text-muted-foreground hidden sm:block">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  <span>Автообновление: 03:00 UTC</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="insights">
              <TrendingUp className="h-4 w-4 mr-2" />
              Инсайты
            </TabsTrigger>
            <TabsTrigger value="content">
              <Sparkles className="h-4 w-4 mr-2" />
              Контент-идеи
            </TabsTrigger>
            <TabsTrigger value="pains">
              <Heart className="h-4 w-4 mr-2" />
              Карта болей
            </TabsTrigger>
          </TabsList>

          {/* Insights Tab */}
          <TabsContent value="insights" className="space-y-4">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Input
                  placeholder="Поиск по инсайтам..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-full sm:w-48">
                  <SelectValue placeholder="Все типы" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  {Object.entries(insightTypeConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Insights List */}
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
            ) : filteredInsights.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Нет инсайтов</p>
                  <p className="text-sm text-muted-foreground mb-4">Запустите анализ аудитории</p>
                  <Button onClick={() => analysisMutation.mutate()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Запустить анализ
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <ScrollArea className="h-[600px]">
                <div className="space-y-6 pr-4">
                  {Object.entries(insightsByType).map(([type, typeInsights]) => {
                    const config = insightTypeConfig[type] || insightTypeConfig.topic;
                    const Icon = config.icon;

                    return (
                      <div key={type}>
                        <div className="flex items-center gap-2 mb-3 sticky top-0 bg-background py-2">
                          <Icon className="h-5 w-5" />
                          <h3 className="font-semibold">{config.label}</h3>
                          <Badge variant="secondary">{typeInsights.length}</Badge>
                        </div>
                        <div className="grid gap-3">
                          {typeInsights.map((insight) => (
                            <Card key={insight.id} className="group">
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <h4 className="font-medium">{insight.title}</h4>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Badge variant="outline" className={config.color}>
                                      {Math.round((insight.relevance_score || 0) * 100)}%
                                    </Badge>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={() => handleCopy(insight.title + "\n" + insight.description, insight.id)}
                                    >
                                      {copiedId === insight.id ? (
                                        <Check className="h-3 w-3 text-green-500" />
                                      ) : (
                                        <Copy className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                                {insight.description && (
                                  <p className="text-sm text-muted-foreground mb-3">{insight.description}</p>
                                )}
                                {insight.examples && insight.examples.length > 0 && (
                                  <div className="bg-muted/50 rounded-md p-3 space-y-2">
                                    <p className="text-xs font-medium text-muted-foreground">Примеры:</p>
                                    {insight.examples.slice(0, 3).map((example, idx) => (
                                      <p key={idx} className="text-xs italic text-muted-foreground">
                                        "{example}"
                                      </p>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                                  <span>Частота: {insight.frequency}/10</span>
                                  <span>Тональность: {insight.sentiment}</span>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* Content Ideas Tab */}
          <TabsContent value="content" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Идеи контента на основе болей
                </CardTitle>
                <CardDescription>
                  Используйте эти идеи для создания постов, рекламы и лендингов
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(insightsByType['pain_point'] || []).length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    Запустите анализ для получения болей аудитории
                  </p>
                ) : (
                  <div className="space-y-4">
                    {(insightsByType['pain_point'] || []).slice(0, 5).map((pain, idx) => (
                      <Card key={pain.id} className="bg-muted/30">
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0">
                              {idx + 1}
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium mb-1">Боль: {pain.title}</h4>
                              <p className="text-sm text-muted-foreground mb-3">{pain.description}</p>
                              <div className="space-y-2">
                                <p className="text-sm font-medium">💡 Идеи контента:</p>
                                <ul className="text-sm text-muted-foreground space-y-1 ml-4">
                                  <li>• Пост: "Как решить проблему {pain.title.toLowerCase()}"</li>
                                  <li>• Сторис: Кейс клиента с этой болью</li>
                                  <li>• Реклама: "Устали от {pain.title.toLowerCase()}? Есть решение!"</li>
                                </ul>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pains Map Tab */}
          <TabsContent value="pains" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="h-5 w-5 text-rose-500" />
                  Карта болей аудитории
                </CardTitle>
                <CardDescription>
                  Визуализация основных болей для таргетинга
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {(insightsByType['pain_point'] || []).map((pain) => (
                    <Card 
                      key={pain.id} 
                      className="border-rose-200 dark:border-rose-800"
                      style={{ 
                        opacity: 0.5 + (pain.relevance_score || 0) * 0.5 
                      }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium text-rose-700 dark:text-rose-300">{pain.title}</h4>
                          <Badge variant="outline" className="bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200">
                            {Math.round((pain.relevance_score || 0) * 100)}%
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{pain.description}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <div 
                            className="h-2 bg-rose-500 rounded-full" 
                            style={{ width: `${(pain.frequency || 0) * 10}%` }}
                          />
                          <span className="text-xs text-muted-foreground">{pain.frequency}/10</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {(insightsByType['pain_point'] || []).length === 0 && (
                    <div className="col-span-2 text-center py-12 text-muted-foreground">
                      <Heart className="h-12 w-12 mx-auto mb-4 opacity-30" />
                      <p>Боли аудитории ещё не проанализированы</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
