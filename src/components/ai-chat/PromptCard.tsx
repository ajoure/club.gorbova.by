import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, Archive, Eye, EyeOff } from "lucide-react";
import type { AiUserPrompt } from "@/hooks/useAiUserPrompts";

interface PromptCardProps {
  prompt: AiUserPrompt;
  onEdit: (prompt: AiUserPrompt) => void;
  onArchive: (id: string) => void;
  onToggleVisible: (id: string, current: boolean) => void;
}

const TYPE_LABELS: Record<string, string> = {
  chat: "Чат",
  file_analysis: "Анализ файлов",
  document_review: "Обзор документов",
  text_transform: "Трансформация текста",
};

export function PromptCard({ prompt, onEdit, onArchive, onToggleVisible }: PromptCardProps) {
  return (
    <GlassCard className="flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{TYPE_LABELS[prompt.type] || prompt.type}</Badge>
          {prompt.is_visible_in_chat && (
            <Badge variant="default" className="text-[10px]">В чате</Badge>
          )}
          {prompt.is_archived && (
            <Badge variant="secondary" className="text-[10px]">Архив</Badge>
          )}
          {!prompt.is_active && (
            <Badge variant="destructive" className="text-[10px]">Неактивен</Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(prompt)}>
              <Pencil className="h-4 w-4 mr-2" />
              Редактировать
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleVisible(prompt.id, prompt.is_visible_in_chat)}>
              {prompt.is_visible_in_chat ? (
                <><EyeOff className="h-4 w-4 mr-2" />Скрыть из чата</>
              ) : (
                <><Eye className="h-4 w-4 mr-2" />Показать в чате</>
              )}
            </DropdownMenuItem>
            {!prompt.is_archived && (
              <DropdownMenuItem onClick={() => onArchive(prompt.id)} className="text-destructive">
                <Archive className="h-4 w-4 mr-2" />
                Архивировать
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <h3 className="font-semibold mb-1 text-sm">{prompt.title}</h3>
      {prompt.description && (
        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{prompt.description}</p>
      )}
      <p className="text-[11px] text-muted-foreground/70 mt-auto">
        code: <span className="font-mono">{prompt.code}</span>
      </p>
    </GlassCard>
  );
}
