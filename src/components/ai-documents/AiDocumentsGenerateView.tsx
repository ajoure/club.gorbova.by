import { useState } from "react";
import { useDocumentTemplates } from "@/hooks/useDocumentTemplates";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Loader2, Settings, Upload, PenLine } from "lucide-react";
import { GenerateAiDocumentDialog } from "./GenerateAiDocumentDialog";
import { AiDocumentTemplatesManager } from "./AiDocumentTemplatesManager";
import type { DocumentTemplate } from "@/hooks/useDocumentTemplates";

export function AiDocumentsGenerateView() {
  const { templates, isLoading } = useDocumentTemplates();
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  // Filter: only ai/both scope, active, and search match
  const filtered = templates.filter((t) => {
    if (!t.is_active) return false;
    const scope = t.template_scope as string | undefined;
    if (scope && scope !== "ai" && scope !== "both") return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasTemplates = filtered.length > 0;

  const handleGenerate = (tpl: DocumentTemplate) => {
    setSelectedTemplate(tpl);
    setWizardOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header: search + single CTA, only when templates exist */}
        {hasTemplates && (
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск шаблонов..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManagerOpen(true)}
            >
              <Settings className="h-4 w-4 mr-2" />
              Управление шаблонами
            </Button>
          </div>
        )}

        {!hasTemplates ? (
          <GlassCard className="text-center py-12">
            <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Нет доступных AI-шаблонов</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Сначала загрузите шаблон DOCX, затем сможете заполнить и сформировать документ.
            </p>
            <Button onClick={() => setManagerOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Загрузить шаблон
            </Button>
          </GlassCard>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((tpl) => (
              <GlassCard key={tpl.id} hover className="flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold leading-tight truncate">{tpl.name}</h3>
                    <Badge variant="outline" className="mt-1 text-xs">
                      {tpl.document_type}
                    </Badge>
                  </div>
                </div>
                {tpl.description && (
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2 flex-1">
                    {tpl.description}
                  </p>
                )}
                {!tpl.description && <div className="flex-1" />}
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => handleGenerate(tpl)}
                >
                  <PenLine className="h-4 w-4 mr-2" />
                  Заполнить документ
                </Button>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      <GenerateAiDocumentDialog
        key={selectedTemplate?.id ?? "no-template"}
        open={wizardOpen}
        onOpenChange={(v) => {
          setWizardOpen(v);
          if (!v) setSelectedTemplate(null);
        }}
        template={selectedTemplate}
      />

      <AiDocumentTemplatesManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
      />
    </>
  );
}
