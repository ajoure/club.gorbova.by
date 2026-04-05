import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Video, Plus, Radio, Shield, Send, PlayCircle, AlertTriangle,
  ChevronDown, Zap, AlertCircle, Lightbulb, Info, ImageOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HELP_SECTIONS, QUICK_START_STEPS, type HelpSection, type HelpCallout, type HelpIllustration } from "./liveEventsHelpContent";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Video, Plus, Radio, Shield, Send, PlayCircle, AlertTriangle,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function IllustrationPlaceholder({ illustration }: { illustration: HelpIllustration }) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-6 flex flex-col items-center gap-3 text-center">
      <Badge variant="outline" className="absolute top-2 right-2 text-[10px] bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700">
        Временная схема
      </Badge>
      <ImageOff className="h-10 w-10 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{illustration.alt}</p>
        <p className="text-[11px] text-muted-foreground/70">{illustration.description}</p>
        <p className="text-[10px] italic text-muted-foreground/50">Скриншот будет добавлен позже</p>
      </div>
    </div>
  );
}

function CalloutBlock({ callout }: { callout: HelpCallout }) {
  const styles = {
    important: "bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200",
    error: "bg-red-50 border-red-300 text-red-900 dark:bg-red-950/30 dark:border-red-700 dark:text-red-200",
    tip: "bg-blue-50 border-blue-300 text-blue-900 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-200",
  };
  const icons = {
    important: <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />,
    error: <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />,
    tip: <Lightbulb className="h-4 w-4 shrink-0 mt-0.5" />,
  };
  const labels = { important: "Важно", error: "Ошибка", tip: "Совет" };

  return (
    <div className={cn("flex gap-2 p-3 rounded-lg border text-sm", styles[callout.type])}>
      {icons[callout.type]}
      <div>
        <span className="font-semibold">{labels[callout.type]}:</span>{" "}
        {callout.text}
      </div>
    </div>
  );
}

function SectionContent({ section, detailed }: { section: HelpSection; detailed: boolean }) {
  const Icon = ICON_MAP[section.icon] || Info;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">{section.title}</h3>
      </div>

      {!detailed ? (
        <>
          <p className="text-sm text-muted-foreground">{section.shortContent}</p>
          {section.illustration && <IllustrationPlaceholder illustration={section.illustration} />}
        </>
      ) : (
        <>
          {section.illustration && <IllustrationPlaceholder illustration={section.illustration} />}

          {section.paragraphs?.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed" dangerouslySetInnerHTML={{
              __html: p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`(.*?)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>')
            }} />
          ))}

          {section.steps && section.steps.length > 0 && (
            <ol className="space-y-2 pl-0">
              {section.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-medium">{step.text}</div>
                    {step.detail && (
                      <div className="text-muted-foreground text-xs mt-0.5">{step.detail}</div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {section.callouts?.map((c, i) => (
            <CalloutBlock key={i} callout={c} />
          ))}
        </>
      )}
    </div>
  );
}

function HelpBody() {
  const [mode, setMode] = useState<"brief" | "detailed">("brief");

  return (
    <div className="space-y-6">
      {/* Mode switcher */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as "brief" | "detailed")}>
        <TabsList className="w-full">
          <TabsTrigger value="brief" className="flex-1">Кратко</TabsTrigger>
          <TabsTrigger value="detailed" className="flex-1">Подробно</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Quick start */}
      <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-sm">Быстрая памятка</h3>
        </div>
        <ol className="space-y-1.5 text-sm">
          {QUICK_START_STEPS.map((step, i) => (
            <li key={i} className="flex gap-2">
              <Badge variant="outline" className="h-5 w-5 p-0 justify-center shrink-0 text-xs">{i + 1}</Badge>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {HELP_SECTIONS.map((section) => (
          <Collapsible key={section.id}>
            <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted/50 transition-colors text-left group">
              <div className="flex items-center gap-2">
                {(() => {
                  const Icon = ICON_MAP[section.icon] || Info;
                  return <Icon className="h-4 w-4 text-muted-foreground" />;
                })()}
                <span className="font-medium text-sm">{section.title}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-3 pb-4 pt-1">
                <SectionContent section={section} detailed={mode === "detailed"} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      {/* Dual CTA blocks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t">
        <a
          href="/admin/docs?domain=live_events&mode=manual"
          className="flex items-start gap-3 rounded-lg border bg-primary/5 p-4 hover:bg-primary/10 transition-colors group"
        >
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 shrink-0">
            <Info className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm group-hover:text-primary transition-colors">📚 Техническая документация</p>
            <p className="text-xs text-muted-foreground mt-0.5">Архитектура, API, схемы данных — для разработчиков</p>
          </div>
        </a>
        <a
          href="/admin/docs?domain=live_events_testing&mode=manual"
          className="flex items-start gap-3 rounded-lg border bg-emerald-500/5 p-4 hover:bg-emerald-500/10 transition-colors group"
        >
          <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-emerald-500/10 shrink-0">
            <Shield className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">📋 Инструкция для тестировщика</p>
            <p className="text-xs text-muted-foreground mt-0.5">Пошаговый гайд, зелёные/красные зоны — для сотрудников</p>
          </div>
        </a>
      </div>
    </div>
  );
}

export function LiveEventsHelpDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Справка: Эфиры
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 pr-4 overflow-y-auto">
          <HelpBody />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
