import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Video, Plus, Radio, Shield, Send, PlayCircle, AlertTriangle,
  ChevronDown, Zap, AlertCircle, Lightbulb, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HELP_SECTIONS, QUICK_START_STEPS, type HelpSection, type HelpCallout } from "./liveEventsHelpContent";
import { useMediaQuery } from "@/hooks/use-media-query";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Video, Plus, Radio, Shield, Send, PlayCircle, AlertTriangle,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
        <p className="text-sm text-muted-foreground">{section.shortContent}</p>
      ) : (
        <>
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

      {/* Link to tech docs */}
      <div className="text-center pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          Техническая документация доступна в{" "}
          <a href="/admin/system-docs?domain=live_events" className="text-primary hover:underline">
            Системной документации → Live Events v2
          </a>
        </p>
      </div>
    </div>
  );
}

export function LiveEventsHelpDialog({ open, onOpenChange }: Props) {
  const isDesktop = useMediaQuery("(min-width: 768px)");

  if (!isDesktop) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <Video className="h-5 w-5" />
              Справка: Эфиры
            </DrawerTitle>
          </DrawerHeader>
          <ScrollArea className="px-4 pb-6 overflow-y-auto" style={{ maxHeight: "70vh" }}>
            <HelpBody />
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    );
  }

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
