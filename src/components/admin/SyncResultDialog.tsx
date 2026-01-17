import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Calendar, FileText, Zap, MessageSquare, Users, User, Brain } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface SyncResult {
  total_messages: number;
  katerina_messages?: number;
  katerina_meaningful?: number;
  audience_messages?: number;
  audience_meaningful?: number;
  unique_users?: number;
  synced_katerina?: number;
  earliest_date?: string;
  latest_date?: string;
  ready_for_style?: boolean;
  ready_for_audience_analysis?: boolean;
  // Legacy fields for backward compatibility
  meaningful_messages?: number;
  synced?: number;
  ready_for_analysis?: boolean;
  author?: string;
}

interface SyncResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: SyncResult | null;
  onLearnStyle?: () => void;
  onAnalyzeAudience?: () => void;
  isLearnStyleLoading?: boolean;
  isAnalyzeLoading?: boolean;
}

export function SyncResultDialog({ 
  open, 
  onOpenChange, 
  result, 
  onLearnStyle,
  onAnalyzeAudience,
  isLearnStyleLoading,
  isAnalyzeLoading,
}: SyncResultDialogProps) {
  if (!result) return null;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "—";
    try {
      return format(new Date(dateStr), "dd MMMM yyyy", { locale: ru });
    } catch {
      return dateStr;
    }
  };

  const getDaysDiff = () => {
    if (!result.earliest_date || !result.latest_date) return null;
    try {
      const start = new Date(result.earliest_date);
      const end = new Date(result.latest_date);
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays;
    } catch {
      return null;
    }
  };

  const days = getDaysDiff();
  
  // Support both new and legacy format
  const katerinaCount = result.katerina_meaningful ?? result.meaningful_messages ?? 0;
  const audienceCount = result.audience_meaningful ?? 0;
  const usersCount = result.unique_users ?? 0;
  const readyForStyle = result.ready_for_style ?? result.ready_for_analysis ?? katerinaCount >= 5;
  const readyForAudience = result.ready_for_audience_analysis ?? audienceCount >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            История чата синхронизирована
          </DialogTitle>
        </DialogHeader>

        {/* Статистика */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <MessageSquare className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{result.total_messages}</p>
              <p className="text-xs text-muted-foreground">Всего сообщений</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <p className="text-2xl font-bold">{usersCount}</p>
              <p className="text-xs text-muted-foreground">Пользователей</p>
            </CardContent>
          </Card>
        </div>

        {/* Разбивка по типам */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <User className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Екатерина</span>
              </div>
              <p className="text-xl font-bold text-primary">{katerinaCount}</p>
              <p className="text-xs text-muted-foreground">для анализа стиля</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-medium">Аудитория</span>
              </div>
              <p className="text-xl font-bold text-amber-600">{audienceCount}</p>
              <p className="text-xs text-muted-foreground">для анализа ЦА</p>
            </CardContent>
          </Card>
        </div>

        {/* Период */}
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Период охвата</span>
            {days !== null && (
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {days} {days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">С: </span>
              <span className="font-medium">{formatDate(result.earliest_date)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">По: </span>
              <span className="font-medium">{formatDate(result.latest_date)}</span>
            </div>
          </div>
        </div>

        {/* Резюме */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
          <h4 className="font-medium flex items-center gap-2 mb-2 text-sm">
            <FileText className="h-4 w-4" />
            Что дальше
          </h4>
          <div className="text-sm text-muted-foreground space-y-2">
            <div className="flex items-start gap-2">
              <Zap className="h-4 w-4 mt-0.5 text-primary shrink-0" />
              <div>
                <strong className="text-foreground">Обучить стилю</strong>
                {readyForStyle ? (
                  <span className="text-green-600"> — {katerinaCount} сообщений готовы</span>
                ) : (
                  <span className="text-amber-600"> — нужно минимум 5 сообщений</span>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Brain className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
              <div>
                <strong className="text-foreground">Анализ аудитории</strong>
                {readyForAudience ? (
                  <span className="text-green-600"> — {audienceCount} сообщений готовы</span>
                ) : (
                  <span className="text-amber-600"> — нужно минимум 10 сообщений</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-wrap">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          {readyForStyle && onLearnStyle && (
            <Button onClick={onLearnStyle} disabled={isLearnStyleLoading}>
              <Zap className="h-4 w-4 mr-2" />
              {isLearnStyleLoading ? "Анализ..." : "Обучить стилю"}
            </Button>
          )}
          {readyForAudience && onAnalyzeAudience && (
            <Button 
              variant="secondary" 
              onClick={onAnalyzeAudience} 
              disabled={isAnalyzeLoading}
              className="bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-900 dark:hover:bg-amber-800 dark:text-amber-100"
            >
              <Brain className="h-4 w-4 mr-2" />
              {isAnalyzeLoading ? "Анализ..." : "Анализ ЦА"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
