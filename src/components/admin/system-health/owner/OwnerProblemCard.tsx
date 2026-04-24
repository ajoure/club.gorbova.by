import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertOctagon, ChevronDown, Copy, Check, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { humanizeInvariant } from "@/lib/system-health/invariant-humanize";
import { buildPatchForProblem } from "@/lib/system-health/patch-generator";

interface Props {
  code: string;
  count: number;
}

export function OwnerProblemCard({ code, count }: Props) {
  const d = humanizeInvariant(code);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const patch = buildPatchForProblem({ code, count, problemType: d.problemType });
    try {
      await navigator.clipboard.writeText(patch);
      setCopied(true);
      toast.success("PATCH скопирован — вставьте в Lovable");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <Card className="border-red-200 dark:border-red-900">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg p-2 bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 flex-shrink-0">
            <AlertOctagon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="destructive">{d.code}</Badge>
              <Badge variant="outline" className="text-xs">требует исправления</Badge>
            </div>
            <h3 className="mt-2 text-lg font-semibold leading-tight">{d.ownerTitle}</h3>
            {/* Крупный однострочный итог */}
            <p className="mt-1 text-base text-foreground/90 font-medium">
              {d.ownerSummary}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleCopy} className="gap-2">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Скопировано" : "Скопировать PATCH для Lovable"}
          </Button>
          {d.relatedRoute && (
            <Button asChild variant="outline" size="sm">
              <Link to={d.relatedRoute} className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Открыть {d.relatedRouteLabel ?? "связанный раздел"}
              </Link>
            </Button>
          )}
        </div>

        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? "Скрыть подробности" : "Показать подробности"}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3 text-sm">
            <Section label="Что произошло">{d.whatHappened}</Section>
            <Section label="Почему это важно">{d.whyItMatters}</Section>
            {d.whyNotAutofixed && <Section label="Почему не чиним автоматически">{d.whyNotAutofixed}</Section>}
            {d.consequenceOfInaction && <Section label="Что будет, если не починить">{d.consequenceOfInaction}</Section>}
            <Section label="Что нужно сделать">{d.suggestedFix}</Section>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}
