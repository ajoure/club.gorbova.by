import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  Brain, 
  MessageSquare, 
  HelpCircle, 
  AlertTriangle, 
  Heart, 
  ThumbsDown, 
  Lightbulb,
  TrendingUp,
  Calendar,
  RefreshCw
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface AudienceInsight {
  insight_type: 'topic' | 'question' | 'problem' | 'pain_point' | 'objection' | 'interest';
  title: string;
  description: string;
  examples: string[];
  frequency: number;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  relevance_score: number;
}

interface AudienceAnalysisResult {
  success: boolean;
  messages_analyzed: number;
  insights_count: number;
  insights: AudienceInsight[];
  summary: string;
  period?: {
    from?: string;
    to?: string;
  };
  cached?: boolean;
  message?: string;
}

interface AudienceInsightsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: AudienceAnalysisResult | null;
  onReanalyze?: () => void;
  isReanalyzing?: boolean;
}

const insightTypeConfig = {
  topic: { icon: MessageSquare, label: 'Тема', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  question: { icon: HelpCircle, label: 'Вопрос', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  problem: { icon: AlertTriangle, label: 'Проблема', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  pain_point: { icon: Heart, label: 'Боль', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200' },
  objection: { icon: ThumbsDown, label: 'Возражение', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  interest: { icon: Lightbulb, label: 'Интерес', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
};

const sentimentColors = {
  positive: 'text-green-600',
  negative: 'text-red-600',
  neutral: 'text-gray-600',
  mixed: 'text-amber-600',
};

export function AudienceInsightsDialog({ 
  open, 
  onOpenChange, 
  result, 
  onReanalyze,
  isReanalyzing 
}: AudienceInsightsDialogProps) {
  if (!result) return null;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd MMM yyyy", { locale: ru });
    } catch {
      return dateStr;
    }
  };

  // Group insights by type
  const groupedInsights = result.insights.reduce((acc, insight) => {
    if (!acc[insight.insight_type]) {
      acc[insight.insight_type] = [];
    }
    acc[insight.insight_type].push(insight);
    return acc;
  }, {} as Record<string, AudienceInsight[]>);

  // Sort by relevance within each group
  Object.keys(groupedInsights).forEach(key => {
    groupedInsights[key].sort((a, b) => b.relevance_score - a.relevance_score);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-amber-600" />
            Анализ аудитории
          </DialogTitle>
        </DialogHeader>

        {/* Статистика */}
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <MessageSquare className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-xl font-bold">{result.messages_analyzed}</p>
              <p className="text-xs text-muted-foreground">Сообщений</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <TrendingUp className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-xl font-bold">{result.insights_count}</p>
              <p className="text-xs text-muted-foreground">Инсайтов</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <Calendar className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-sm font-medium">
                {formatDate(result.period?.from)}
              </p>
              <p className="text-xs text-muted-foreground">
                — {formatDate(result.period?.to)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Резюме */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
          <p className="text-sm">{result.summary}</p>
        </div>

        {/* Инсайты по категориям */}
        <ScrollArea className="flex-1 max-h-[400px]">
          <div className="space-y-4 pr-4">
            {Object.entries(groupedInsights).map(([type, insights]) => {
              const config = insightTypeConfig[type as keyof typeof insightTypeConfig] || insightTypeConfig.topic;
              const Icon = config.icon;

              return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="h-4 w-4" />
                    <h4 className="font-medium text-sm">{config.label}ы ({insights.length})</h4>
                  </div>
                  <div className="space-y-2">
                    {insights.map((insight, idx) => (
                      <Card key={idx} className="p-3">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-medium text-sm">{insight.title}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="outline" className={config.color}>
                              {Math.round(insight.relevance_score * 100)}%
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{insight.description}</p>
                        {insight.examples.length > 0 && (
                          <div className="bg-muted/50 rounded p-2">
                            <p className="text-xs text-muted-foreground italic">
                              "{insight.examples[0]}"
                            </p>
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          {onReanalyze && (
            <Button 
              variant="secondary" 
              onClick={onReanalyze} 
              disabled={isReanalyzing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isReanalyzing ? 'animate-spin' : ''}`} />
              {isReanalyzing ? "Анализируем..." : "Переанализировать"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
