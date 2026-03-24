import { useState } from "react";
import { useDocumentTemplates } from "@/hooks/useDocumentTemplates";
import { useDocumentPackages, useDocumentPackageItems } from "@/hooks/useDocumentPackages";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Loader2, Settings, Upload, PenLine, Package, Building2 } from "lucide-react";
import { GenerateAiDocumentDialog } from "./GenerateAiDocumentDialog";
import { GenerateAiDocumentPackageDialog } from "./GenerateAiDocumentPackageDialog";
import { AiDocumentTemplatesManager } from "./AiDocumentTemplatesManager";
import { AiDocumentPackagesManager } from "./AiDocumentPackagesManager";
import { CorporateWizard } from "@/components/corporate/CorporateWizard";
import type { DocumentTemplate } from "@/hooks/useDocumentTemplates";
import type { DocumentPackageTemplate } from "@/hooks/useDocumentPackages";

function PackageItemCount({ packageId }: { packageId: string }) {
  const { items } = useDocumentPackageItems(packageId);
  return <>{items.length}</>;
}

export function AiDocumentsGenerateView() {
  const { templates, isLoading } = useDocumentTemplates();
  const { packages, isLoading: packagesLoading } = useDocumentPackages();
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<DocumentPackageTemplate | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [packageWizardOpen, setPackageWizardOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [packagesManagerOpen, setPackagesManagerOpen] = useState(false);
  const [corporateWizardOpen, setCorporateWizardOpen] = useState(false);

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

  // Filter active packages matching search
  const filteredPackages = packages.filter((p) => {
    if (!p.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasTemplates = filtered.length > 0;
  const hasPackages = filteredPackages.length > 0;
  const hasContent = hasTemplates || hasPackages;

  const handleGenerate = (tpl: DocumentTemplate) => {
    setSelectedTemplate(tpl);
    setWizardOpen(true);
  };

  if (isLoading || packagesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header: search + CTAs */}
        {hasContent && (
          <div className="flex items-center gap-3 flex-wrap">
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
              Шаблоны
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPackagesManagerOpen(true)}
            >
              <Package className="h-4 w-4 mr-2" />
              Пакеты
            </Button>
          </div>
        )}

        {!hasContent ? (
          <GlassCard className="text-center py-12">
            <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Нет доступных AI-шаблонов</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Сначала загрузите шаблон DOCX, затем сможете заполнить и сформировать документ.
            </p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => setManagerOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Загрузить шаблон
              </Button>
              <Button variant="outline" onClick={() => setPackagesManagerOpen(true)}>
                <Package className="h-4 w-4 mr-2" />
                Создать пакет
              </Button>
            </div>
          </GlassCard>
        ) : (
          <div className="space-y-6">
            {/* Corporate documents section */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Корпоративные документы
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <GlassCard className="flex flex-col">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold leading-tight truncate">Годовое собрание ООО/ОДО</h3>
                      <div className="flex gap-1.5 mt-1">
                        <Badge variant="outline" className="text-xs">Корпоративный</Badge>
                        <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">Новое</Badge>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2 flex-1">
                    Полный пакет документов для годового собрания участников или решения единственного участника
                  </p>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setCorporateWizardOpen(true)}
                  >
                    <PenLine className="h-4 w-4 mr-2" />
                    Начать
                  </Button>
                </GlassCard>
              </div>
            </div>

            {/* Package cards */}
            {hasPackages && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Пакеты документов
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredPackages.map((pkg) => (
                    <GlassCard key={pkg.id} className="flex flex-col">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 rounded-lg bg-accent/50 shrink-0">
                          <Package className="h-5 w-5 text-accent-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold leading-tight truncate">{pkg.name}</h3>
                          <div className="flex gap-1.5 mt-1">
                            <Badge variant="outline" className="text-xs">Пакет</Badge>
                            <Badge variant="secondary" className="text-xs">
                              <PackageItemCount packageId={pkg.id} /> док.
                            </Badge>
                          </div>
                        </div>
                      </div>
                      {pkg.description && (
                        <p className="text-sm text-muted-foreground mb-4 line-clamp-2 flex-1">
                          {pkg.description}
                        </p>
                      )}
                      {!pkg.description && <div className="flex-1" />}
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => {
                          setSelectedPackage(pkg);
                          setPackageWizardOpen(true);
                        }}
                      >
                        <PenLine className="h-4 w-4 mr-2" />
                        Заполнить пакет
                      </Button>
                    </GlassCard>
                  ))}
                </div>
              </div>
            )}

            {/* Single template cards */}
            {hasTemplates && (
              <div>
                {hasPackages && (
                  <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Одиночные шаблоны
                  </h3>
                )}
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
              </div>
            )}
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

      <AiDocumentPackagesManager
        open={packagesManagerOpen}
        onOpenChange={setPackagesManagerOpen}
      />

      <GenerateAiDocumentPackageDialog
        open={packageWizardOpen}
        onOpenChange={(v) => {
          setPackageWizardOpen(v);
          if (!v) setSelectedPackage(null);
        }}
        packageTemplate={selectedPackage}
      />
    </>
  );
}
