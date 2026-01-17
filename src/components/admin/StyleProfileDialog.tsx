import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle,
  RefreshCw,
  Loader2,
  MessageSquare,
  Database,
  Sparkles,
  Quote,
  ListChecks,
  User,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface StyleProfile {
  tone?: string;
  tone_details?: string;
  personality_traits?: string[];
  avg_length?: string;
  emojis?: {
    used?: boolean;
    frequency?: string;
    examples?: string[];
  };
  structure?: {
    uses_numbering?: boolean;
    uses_paragraphs?: boolean;
    typical_structure?: string;
  };
  formatting?: {
    uses_dashes?: boolean;
    uses_emphasis?: boolean;
    html_tags_used?: string[];
  };
  characteristic_phrases?: string[];
  communication_patterns?: string[];
  vocabulary_level?: string;
  target_audience?: string;
  writing_guidelines?: string[];
}

interface StyleResult {
  success: boolean;
  posts_analyzed: number;
  katerina_messages: number;
  data_source: string;
  style_profile: StyleProfile;
}

interface StyleProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: StyleResult | null;
  onRelearn: () => void;
  isRelearning: boolean;
}

const dataSourceLabels: Record<string, string> = {
  katerina_gorbova_chat: "Сообщения @katerinagorbova",
  combined: "Комбинированные источники",
  news_content: "Опубликованные новости",
  channel_archive: "Архив канала",
};

export const StyleProfileDialog: React.FC<StyleProfileDialogProps> = ({
  open,
  onOpenChange,
  result,
  onRelearn,
  isRelearning,
}) => {
  if (!result || !result.style_profile) return null;

  const profile = result.style_profile;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Стилевой профиль изучен
          </DialogTitle>
          <DialogDescription>
            ИИ проанализировал сообщения и создал профиль стиля Екатерины Горбовой
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-4">
            {/* Statistics Cards */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3 text-center">
                  <MessageSquare className="h-4 w-4 mx-auto mb-1 text-primary" />
                  <div className="text-lg font-bold">{result.posts_analyzed}</div>
                  <div className="text-xs text-muted-foreground">Проанализировано</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <User className="h-4 w-4 mx-auto mb-1 text-primary" />
                  <div className="text-lg font-bold">{result.katerina_messages}</div>
                  <div className="text-xs text-muted-foreground">От Екатерины</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <Database className="h-4 w-4 mx-auto mb-1 text-primary" />
                  <div className="text-sm font-medium truncate">
                    {dataSourceLabels[result.data_source] || result.data_source}
                  </div>
                  <div className="text-xs text-muted-foreground">Источник</div>
                </CardContent>
              </Card>
            </div>

            {/* Summary Section */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Итоговое резюме
              </h4>
              
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  <strong>Стиль Екатерины:</strong>{" "}
                  {profile.tone_details || 
                    `${profile.tone || 'Экспертный'}, с характерным использованием профессиональной терминологии и эмпатичным подходом к аудитории.`}
                </p>
                
                <div>
                  <strong>ИИ будет использовать:</strong>
                  <ul className="list-disc list-inside mt-1 ml-2 space-y-0.5">
                    <li>Тон: {profile.tone || 'экспертный'}</li>
                    <li>Длина сообщений: {profile.avg_length || 'средняя'}</li>
                    <li>Эмодзи: {profile.emojis?.used ? 
                      `да, ${profile.emojis.frequency || 'умеренно'}` : 'не используются'}</li>
                    <li>Структура: {profile.structure?.typical_structure || 'с абзацами'}</li>
                    <li>Лексика: {profile.vocabulary_level || 'профессиональная'}</li>
                  </ul>
                </div>
                
                {profile.writing_guidelines && profile.writing_guidelines.length > 0 && (
                  <div>
                    <strong>Ключевые правила:</strong>
                    <ol className="list-decimal list-inside mt-1 ml-2 space-y-0.5">
                      {profile.writing_guidelines.slice(0, 3).map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            </div>

            {/* Tone Section */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Тон и стиль
              </h4>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{profile.tone || "Не определён"}</Badge>
                {profile.avg_length && (
                  <Badge variant="outline">Длина: {profile.avg_length}</Badge>
                )}
                {profile.vocabulary_level && (
                  <Badge variant="outline">Лексика: {profile.vocabulary_level}</Badge>
                )}
              </div>
              {profile.tone_details && (
                <p className="text-sm text-muted-foreground">{profile.tone_details}</p>
              )}
            </div>

            {/* Personality Traits */}
            {profile.personality_traits && profile.personality_traits.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">✨ Характерные черты</h4>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  {profile.personality_traits.map((trait, i) => (
                    <li key={i}>{trait}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Characteristic Phrases */}
            {profile.characteristic_phrases && profile.characteristic_phrases.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Quote className="h-4 w-4 text-primary" />
                  Типичные фразы
                </h4>
                <div className="flex flex-wrap gap-2">
                  {profile.characteristic_phrases.slice(0, 8).map((phrase, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      "{phrase}"
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Communication Patterns */}
            {profile.communication_patterns && profile.communication_patterns.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">💬 Паттерны общения</h4>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  {profile.communication_patterns.map((pattern, i) => (
                    <li key={i}>{pattern}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Writing Guidelines */}
            {profile.writing_guidelines && profile.writing_guidelines.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" />
                  Правила для ИИ
                </h4>
                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                  {profile.writing_guidelines.map((guideline, i) => (
                    <li key={i}>{guideline}</li>
                  ))}
                </ol>
              </div>
            )}

            {/* Emojis & Structure */}
            <div className="grid grid-cols-2 gap-4">
              {profile.emojis && (
                <div className="space-y-1">
                  <h4 className="text-sm font-medium">Эмодзи</h4>
                  <p className="text-sm text-muted-foreground">
                    {profile.emojis.used ? `Да, ${profile.emojis.frequency}` : "Не используются"}
                  </p>
                  {profile.emojis.examples && profile.emojis.examples.length > 0 && (
                    <p className="text-lg">{profile.emojis.examples.join(" ")}</p>
                  )}
                </div>
              )}
              {profile.structure && (
                <div className="space-y-1">
                  <h4 className="text-sm font-medium">Структура</h4>
                  <p className="text-sm text-muted-foreground">
                    {profile.structure.typical_structure || "Не определена"}
                  </p>
                </div>
              )}
            </div>

            {/* Target Audience */}
            {profile.target_audience && (
              <div className="space-y-1">
                <h4 className="text-sm font-medium">🎯 Целевая аудитория</h4>
                <p className="text-sm text-muted-foreground">{profile.target_audience}</p>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={onRelearn}
            disabled={isRelearning}
          >
            {isRelearning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Переобучить
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            Подтвердить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
