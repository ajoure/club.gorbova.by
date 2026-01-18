import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  RefreshCw,
  Quote,
  ThumbsUp,
  ThumbsDown,
  Minus,
  Brain,
  MessageSquare,
  Calendar,
  AlertCircle,
  HelpCircle,
  MessageCircle,
  CheckCircle,
  XCircle,
  Lightbulb,
} from "lucide-react";
import { LoyaltyPulse } from "./LoyaltyPulse";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LoyaltyProof {
  quote: string;
  date: string;
  sentiment: "positive" | "negative" | "neutral";
  context?: string;
}

interface CommunicationStyle {
  tone: string;
  keywords_to_use: string[];
  topics_to_avoid: string[];
  recommendations: string;
}

interface ContactLoyaltyTabProps {
  contact: {
    id: string;
    telegram_user_id?: string | number | null;
    loyalty_score?: number | null;
    loyalty_ai_summary?: string | null;
    loyalty_status_reason?: string | null;
    loyalty_proofs?: LoyaltyProof[] | unknown[] | null;
    loyalty_analyzed_messages_count?: number | null;
    loyalty_updated_at?: string | null;
    communication_style?: CommunicationStyle | null;
  };
}

const getStatusLabel = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return "Нет данных";
  if (score <= 2) return "Хейтер";
  if (score <= 4) return "Недоволен";
  if (score <= 6) return "Нейтрально";
  if (score <= 8) return "Лояльный";
  return "Адепт/Фанат";
};

const getStatusColor = (score: number | null | undefined): string => {
  if (score === null || score === undefined) return "bg-muted text-muted-foreground";
  if (score <= 2) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  if (score <= 4) return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
  if (score <= 6) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  if (score <= 8) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
};

const getSentimentIcon = (sentiment: string) => {
  switch (sentiment) {
    case "positive":
      return <ThumbsUp className="w-3 h-3 text-green-500" />;
    case "negative":
      return <ThumbsDown className="w-3 h-3 text-red-500" />;
    default:
      return <Minus className="w-3 h-3 text-muted-foreground" />;
  }
};

const getSentimentBadge = (sentiment: string) => {
  const config = {
    positive: { label: "Позитив", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
    negative: { label: "Негатив", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    neutral: { label: "Нейтрал", className: "bg-muted text-muted-foreground" },
  };
  const { label, className } = config[sentiment as keyof typeof config] || config.neutral;
  return <Badge variant="secondary" className={cn("text-xs", className)}>{label}</Badge>;
};

const getToneEmoji = (tone: string) => {
  const toneMap: Record<string, string> = {
    "Деловой": "🎯",
    "Дружеский": "😊",
    "Экспертный": "🎓",
    "Неформальный": "👋",
  };
  return toneMap[tone] || "💬";
};

export function ContactLoyaltyTab({ contact }: ContactLoyaltyTabProps) {
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const proofs = (contact.loyalty_proofs as LoyaltyProof[] | null) || [];
  const hasData = contact.loyalty_score !== null && contact.loyalty_score !== undefined;
  const commStyle = contact.communication_style as CommunicationStyle | null;

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      setIsAnalyzing(true);
      const { data, error } = await supabase.functions.invoke("analyze-contact-loyalty", {
        body: {
          profile_id: contact.id,
          telegram_user_id: contact.telegram_user_id,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // Optimistically update the contact in admin-contacts cache
      queryClient.setQueryData(["admin-contacts"], (oldData: any) => {
        if (!oldData) return oldData;
        return oldData.map((c: any) => {
          if (c.id === contact.id) {
            return {
              ...c,
              loyalty_score: data?.score,
              loyalty_ai_summary: data?.ai_summary,
              loyalty_status_reason: data?.reason,
              loyalty_proofs: data?.proofs || [],
              loyalty_analyzed_messages_count: data?.messages_analyzed,
              loyalty_updated_at: data?.loyalty_updated_at || new Date().toISOString(),
              communication_style: data?.communication_style,
            };
          }
          return c;
        });
      });

      // Also invalidate to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["contact-profile-details", contact.id] });
      
      if (data?.score === null) {
        toast.info("Нет сообщений для анализа");
      } else {
        toast.success(`Анализ завершён. Новая оценка: ${data?.score}/10`);
      }
    },
    onError: (error) => {
      toast.error("Ошибка анализа: " + (error as Error).message);
    },
    onSettled: () => {
      setIsAnalyzing(false);
    },
  });

  const formatProofDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMM yyyy", { locale: ru });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-4">
      {/* Main Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              Анализ лояльности
            </CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <HelpCircle className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>AI анализирует все сообщения клиента в Telegram-чатах и определяет уровень лояльности на основе тона, благодарностей и жалоб. Также выявляет сарказм и даёт рекомендации по общению.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 mb-4">
            <LoyaltyPulse 
              score={contact.loyalty_score ?? null} 
              size="lg" 
              showLabel 
            />
            <div className="flex-1">
              <Badge className={cn("text-sm px-3 py-1", getStatusColor(contact.loyalty_score))}>
                {getStatusLabel(contact.loyalty_score)}
              </Badge>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {contact.loyalty_analyzed_messages_count || 0} сообщений
                </span>
                {contact.loyalty_updated_at && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {format(new Date(contact.loyalty_updated_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                  </span>
                )}
              </div>
            </div>
          </div>

          <Button
            onClick={() => analyzeMutation.mutate()}
            disabled={isAnalyzing || !contact.telegram_user_id}
            variant={hasData ? "outline" : "default"}
            className="w-full"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isAnalyzing && "animate-spin")} />
            {isAnalyzing ? "Анализ..." : hasData ? "Пересчитать оценку" : "Запустить анализ"}
          </Button>

          {!contact.telegram_user_id && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Telegram не привязан — анализ невозможен
            </p>
          )}
        </CardContent>
      </Card>

      {/* Communication Style Recommendations */}
      {commStyle && commStyle.tone && (
        <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-blue-600" />
              Как общаться с клиентом
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Tone */}
            <div className="flex items-center gap-2">
              <span className="text-lg">{getToneEmoji(commStyle.tone)}</span>
              <span className="font-medium">Тон:</span>
              <Badge variant="outline" className="bg-background">
                {commStyle.tone}
              </Badge>
            </div>

            {/* Keywords to use */}
            {commStyle.keywords_to_use && commStyle.keywords_to_use.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400 mb-1.5">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Используйте:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {commStyle.keywords_to_use.map((keyword, idx) => (
                    <Badge 
                      key={idx} 
                      variant="secondary" 
                      className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 text-xs"
                    >
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Topics to avoid */}
            {commStyle.topics_to_avoid && commStyle.topics_to_avoid.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400 mb-1.5">
                  <XCircle className="w-3.5 h-3.5" />
                  Избегайте:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {commStyle.topics_to_avoid.map((topic, idx) => (
                    <Badge 
                      key={idx} 
                      variant="secondary" 
                      className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 text-xs"
                    >
                      {topic}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* AI Recommendation */}
            {commStyle.recommendations && (
              <div className="pt-2 border-t border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-muted-foreground italic">
                    {commStyle.recommendations}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* UX Fallback: Style not yet defined */}
      {hasData && !commStyle && (
        <Card className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <MessageCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1 text-sm">Стиль общения не определён</p>
                <p className="text-sm text-muted-foreground">
                  Нажмите «Пересчитать оценку», чтобы получить рекомендации по общению с клиентом
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Summary */}
      {contact.loyalty_ai_summary && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Brain className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="font-medium mb-1 text-sm">AI-резюме</p>
                <p className="text-sm text-muted-foreground italic">
                  {contact.loyalty_ai_summary}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reason */}
      {contact.loyalty_status_reason && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-1">Почему такая оценка?</p>
            <p className="text-sm text-muted-foreground">
              {contact.loyalty_status_reason}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Proofs */}
      {proofs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Quote className="w-4 h-4" />
              Доказательства ({proofs.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[300px]">
              <div className="p-4 space-y-3">
                {proofs.map((proof, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "p-3 rounded-lg border-l-4",
                      proof.sentiment === "positive" && "border-l-green-500 bg-green-50/50 dark:bg-green-950/20",
                      proof.sentiment === "negative" && "border-l-red-500 bg-red-50/50 dark:bg-red-950/20",
                      proof.sentiment === "neutral" && "border-l-muted-foreground bg-muted/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {getSentimentIcon(proof.sentiment)}
                        {getSentimentBadge(proof.sentiment)}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatProofDate(proof.date)}
                      </span>
                    </div>
                    <p className="text-sm italic">"{proof.quote}"</p>
                    {proof.context && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Контекст: {proof.context}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* No Data State */}
      {!hasData && !isAnalyzing && contact.telegram_user_id && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <AlertCircle className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground mb-2">Анализ ещё не проводился</p>
            <p className="text-xs text-muted-foreground">
              Нажмите "Запустить анализ" чтобы AI проанализировал историю сообщений
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
