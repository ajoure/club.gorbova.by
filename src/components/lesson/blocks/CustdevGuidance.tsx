import { useState } from "react";
import { Info } from "lucide-react";
import { Portal as TooltipPortal } from "@radix-ui/react-tooltip";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { getCustdevGuidance, questionExamples } from "./custdev-guidance";

export function CustdevHelp({ label }: { label: string }) {
  const help = getCustdevGuidance(label);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  if (!help) return null;
  const content = (
    <>
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-1.5">{help.explanation}</p>
      {help.example && (
        <p className="mt-2 border-l-2 border-border pl-2.5">
          <span className="font-medium">Пример:</span>
          {help.example}
        </p>
      )}
    </>
  );
  return (
    <Popover
      open={popoverOpen}
      onOpenChange={(open) => {
        setPopoverOpen(open);
        if (open) setTooltipOpen(false);
      }}
    >
      <TooltipProvider delayDuration={250}>
        <Tooltip
          open={!popoverOpen && tooltipOpen}
          onOpenChange={setTooltipOpen}
        >
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Подсказка: ${label}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-7 sm:w-7"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              side="top"
              className="max-w-[min(22rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed break-words font-normal"
            >
              {content}
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        aria-label={`Подсказка: ${label}`}
        align="start"
        side="bottom"
        collisionPadding={16}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(22rem,calc(100vw-2rem))] max-h-[70dvh] overflow-y-auto p-3 text-xs leading-relaxed break-words"
      >
        {content}
      </PopoverContent>
    </Popover>
  );
}

export function CustdevFieldLabel(
  { label, htmlFor }: { label: string; htmlFor?: string },
) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Label htmlFor={htmlFor} className="min-w-0 leading-snug">{label}</Label>
      <CustdevHelp label={label} />
    </div>
  );
}

const sections = {
  prepare: [
    "Выберите, кого будете изучать",
    "Добавьте группу клиентов, опишите её и составьте вопросы о прошлом опыте. Для начала достаточно одного сегмента и одного подходящего вопроса; обычно исследуют 1–3 сегмента.",
  ],
  interviews: [
    "Поговорите с клиентами и запишите ответы",
    "Выберите сегмент, добавьте респондента вручную или из портфеля. Записывайте ответы и уточнения словами человека. Когда разговор закончен, выберите статус «Проведено».",
  ],
  analysis: [
    "Превратите ответы в проверенные потребности",
    "Сначала выделите цитаты, затем объедините их по смыслу. Проверьте источники, названия и оценки и утвердите потребности. ИИ предлагает вариант — окончательное решение принимаете вы.",
  ],
  positioning: [
    "Объясните, для кого и как вы работаете",
    "Сначала сформулируйте общее позиционирование компании, затем адаптируйте его для выбранного сегмента. После редактирования нажмите «Оставить мой вариант» или примите отдельное предложение ИИ.",
  ],
  usp: [
    "Сформулируйте конкретное предложение",
    "Добавьте УТП для сегмента: проблема → результат → механизм → реальное доказательство, если оно есть. Сохраните итоговый текст кнопкой «Оставить мой вариант УТП». Без доказательств предложение остаётся гипотезой.",
  ],
} as const;

export function CustdevSectionGuide(
  { section }: { section: keyof typeof sections },
) {
  const [title, explanation] = sections[section];
  return (
    <div
      className="rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground"
      data-testid={`custdev-guide-${section}`}
    >
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1">{explanation}</p>
    </div>
  );
}

export function CustdevQuestionGuide({ group }: { group: number }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Пример открытого вопроса: «{questionExamples[group - 1]}» Сформулируйте
      свой вопрос под ваш сегмент.
    </p>
  );
}
