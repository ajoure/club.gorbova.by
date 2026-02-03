import React, { memo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Trash2 } from "lucide-react";
import { TimecodeInput } from "./TimecodeInput";

export interface KbQuestionInputData {
  question_number: number;
  title: string;
  full_question?: string;
  timecode?: string; // MM:SS or HH:MM:SS format for input
}

interface KbQuestionInputProps {
  data: KbQuestionInputData;
  onChange: (data: KbQuestionInputData) => void;
  onRemove: () => void;
  index: number;
}

/**
 * Single question input for KB lesson wizard
 */
export const KbQuestionInput = memo(function KbQuestionInput({
  data,
  onChange,
  onRemove,
  index,
}: KbQuestionInputProps) {
  return (
    <GlassCard className="relative p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          Вопрос {index + 1}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onRemove}
          title="Удалить вопрос"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`q-title-${index}`}>Суть вопроса</Label>
          <Input
            id={`q-title-${index}`}
            value={data.title}
            onChange={(e) => onChange({ ...data, title: e.target.value })}
            placeholder="Краткая суть вопроса"
          />
        </div>
        <div className="space-y-1.5 w-28">
          <Label htmlFor={`q-timecode-${index}`}>Таймкод</Label>
          <TimecodeInput
            value={data.timecode || ""}
            onChange={(v) => onChange({ ...data, timecode: v })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`q-full-${index}`}>Полный текст вопроса</Label>
        <Textarea
          id={`q-full-${index}`}
          value={data.full_question || ""}
          onChange={(e) => onChange({ ...data, full_question: e.target.value })}
          placeholder="Полный развернутый текст вопроса (опционально)..."
          rows={2}
        />
      </div>
    </GlassCard>
  );
});
