import { useState, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { resolvePreviewTokens, type SnapshotData } from "@/utils/aiDocumentSnapshotResolver";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import { useEntityPersonLinks, type LinkRow } from "@/hooks/useEntityPersonLinks";
import { useAiDocuments } from "@/hooks/useAiDocuments";
import { useDocumentPackageItems, useLastPackageBatch, type DocumentPackageTemplate } from "@/hooks/useDocumentPackages";
import { useDocumentTemplates } from "@/hooks/useDocumentTemplates";
import { useAiDocumentPackageGeneration } from "@/hooks/useAiDocumentPackageGeneration";
import {
  Loader2, Package, ChevronRight, ChevronLeft, Star,
  AlertTriangle, History, RefreshCw, CheckCircle2, XCircle, FileText,
} from "lucide-react";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  packageTemplate: DocumentPackageTemplate | null;
  onGenerationComplete?: () => void;
}

export function GenerateAiDocumentPackageDialog({
  open,
  onOpenChange,
  packageTemplate,
  onGenerationComplete,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [entityId, setEntityId] = useState("");
  const [personId, setPersonId] = useState("");
  const [signerLinkId, setSignerLinkId] = useState("");
  const [prefillSource, setPrefillSource] = useState<"history" | "fresh" | null>(null);

  const { allEntities } = useAiEntities();
  const { allPersons } = useAiPersons();
  const { profileId } = useAiDocuments();
  const { items } = useDocumentPackageItems(packageTemplate?.id ?? null);
  const { data: lastBatch } = useLastPackageBatch(packageTemplate?.id ?? null, profileId);
  const { templates } = useDocumentTemplates();
  const { generatePackage, isGenerating } = useAiDocumentPackageGeneration();
  const { links } = useEntityPersonLinks(entityId || null, null);

  const activeEntities = useMemo(
    () => allEntities.filter((e) => e.status === "active"),
    [allEntities]
  );
  const activePersons = useMemo(
    () => allPersons.filter((p) => p.is_active),
    [allPersons]
  );

  // Check if last batch has valid prefill data
  const hasPrefillData = useMemo(() => {
    if (!lastBatch?.meta) return false;
    const m = lastBatch.meta;
    return !!(m.selected_entity_id || m.selected_person_id || m.selected_signer_link_id);
  }, [lastBatch]);

  const applyPrefill = () => {
    if (!lastBatch?.meta) return;
    const m = lastBatch.meta;
    setEntityId((m.selected_entity_id as string) || "");
    setPersonId((m.selected_person_id as string) || "");
    setSignerLinkId((m.selected_signer_link_id as string) || "");
    setPrefillSource("history");
  };

  const startFresh = () => {
    setEntityId("");
    setPersonId("");
    setSignerLinkId("");
    setPrefillSource("fresh");
  };

  const selectedEntity = useMemo(
    () => allEntities.find((e) => e.id === entityId) ?? null,
    [allEntities, entityId]
  );
  const selectedPerson = useMemo(
    () => allPersons.find((p) => p.id === personId) ?? null,
    [allPersons, personId]
  );
  const selectedLink = useMemo(
    () => links.find((l) => l.id === signerLinkId) ?? null,
    [links, signerLinkId]
  );
  const signerPerson = useMemo(() => {
    if (!selectedLink) return null;
    return allPersons.find((p) => p.id === selectedLink.person_id) ?? null;
  }, [selectedLink, allPersons]);

  const sortedLinks = useMemo(
    () => [...links].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)),
    [links]
  );

  // Build template map for preview
  const tplMap = useMemo(() => {
    return new Map(templates.map((t) => [t.id, t]));
  }, [templates]);

  // Build preview data for each item
  const previewData: SnapshotData = {
    entity: selectedEntity,
    person: selectedPerson as any,
    signerPerson: signerPerson as any,
    link: selectedLink,
  };

  const itemPreviews = useMemo(() => {
    return items.map((item) => {
      const tpl = tplMap.get(item.template_id);
      const placeholders: string[] = tpl && Array.isArray(tpl.placeholders) ? tpl.placeholders : [];
      const tokens = resolvePreviewTokens(placeholders, previewData);
      const filled = tokens.filter((t) => t.filled).length;
      const missing = tokens.filter((t) => !t.filled).length;
      return {
        item,
        templateName: item.title_override || item.template_name || tpl?.name || "—",
        placeholderCount: placeholders.length,
        filledCount: filled,
        missingCount: missing,
        hasPlaceholders: placeholders.length > 0,
      };
    });
  }, [items, tplMap, previewData]);

  const totalMissing = itemPreviews.reduce((s, p) => s + p.missingCount, 0);

  const handleGenerate = async () => {
    if (!packageTemplate?.id) return;
    try {
      setStep(3);
      const result = await generatePackage({
        package_template_id: packageTemplate.id,
        legal_details_id: entityId || undefined,
        person_id: personId || undefined,
        signer_link_id: signerLinkId || undefined,
      });
      if (result.success) {
        onOpenChange(false);
        resetState();
        onGenerationComplete?.();
      }
    } catch {
      // error handled in hook
      setStep(2);
    }
  };

  const resetState = () => {
    setStep(1);
    setEntityId("");
    setPersonId("");
    setSignerLinkId("");
    setPrefillSource(null);
  };

  const handleClose = (v: boolean) => {
    if (!v) resetState();
    onOpenChange(v);
  };

  const linkLabel = (l: LinkRow) => {
    const parts = [l.person_full_name || "—"];
    if (l.role_label) parts.push(l.role_label);
    if (l.position_label || l.custom_position_text)
      parts.push(l.position_label || l.custom_position_text || "");
    return parts.join(" · ");
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className={SHEET_SHELL_CLASS}>
        {/* Fixed Header */}
        <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/50 shrink-0">
              <Package className="h-5 w-5 text-accent-foreground" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-left truncate">
                {packageTemplate?.name ?? "Пакет документов"}
              </SheetTitle>
              <SheetDescription className="text-left text-sm mt-0.5">
                {step === 1
                  ? "Выберите источники данных"
                  : step === 2
                  ? `Проверьте заполнение — ${items.length} документ(ов)`
                  : "Генерация пакета…"}
              </SheetDescription>
            </div>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3">
            <Badge variant={step === 1 ? "default" : "secondary"} className="text-xs">1</Badge>
            <span>Данные</span>
            <ChevronRight className="h-3 w-3" />
            <Badge variant={step === 2 ? "default" : "secondary"} className="text-xs">2</Badge>
            <span>Проверка</span>
            <ChevronRight className="h-3 w-3" />
            <Badge variant={step === 3 ? "default" : "secondary"} className="text-xs">3</Badge>
            <span>Генерация</span>
          </div>
          <Separator className="mt-3" />
        </SheetHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 pb-24">
          {/* Empty package guard */}
          {items.length === 0 && step === 1 && (
            <Card className="border-amber-300/50 bg-amber-50/50 dark:bg-amber-950/20 mb-4">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Пакет пуст</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Добавьте шаблоны в пакет через менеджер пакетов, чтобы начать генерацию.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
          {/* Step 1: Data selection */}
          {step === 1 && (
            <div className="space-y-5 max-w-2xl">
              {/* Prefill banner */}
              {hasPrefillData && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <History className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        {prefillSource === null && (
                          <>
                            <p className="text-sm font-medium">Найден ранее созданный пакет</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Вы можете использовать данные из прошлой генерации или заполнить заново.
                            </p>
                            <div className="flex gap-2 mt-3">
                              <Button size="sm" onClick={applyPrefill}>
                                <History className="h-3.5 w-3.5 mr-1.5" />
                                Использовать прошлые данные
                              </Button>
                              <Button size="sm" variant="outline" onClick={startFresh}>
                                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                Заполнить заново
                              </Button>
                            </div>
                          </>
                        )}
                        {prefillSource === "history" && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm">Данные из последней генерации</span>
                            <Button size="sm" variant="ghost" onClick={startFresh}>
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                              Заполнить заново
                            </Button>
                          </div>
                        )}
                        {prefillSource === "fresh" && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm">Заполнение вручную</span>
                            <Button size="sm" variant="ghost" onClick={applyPrefill}>
                              <History className="h-3.5 w-3.5 mr-1.5" />
                              Вернуть прошлые данные
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Entity picker */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <Label className="text-sm font-medium">ЮЛ / ИП</Label>
                  <Select value={entityId} onValueChange={(v) => { setEntityId(v); setSignerLinkId(""); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите организацию (необязательно)" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeEntities.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.leg_name || e.ent_name || e.ind_full_name || "Без названия"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {/* Person picker */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <Label className="text-sm font-medium">Физлицо</Label>
                  <Select value={personId} onValueChange={setPersonId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите физлицо (необязательно)" />
                    </SelectTrigger>
                    <SelectContent>
                      {activePersons.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name || "Без имени"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {/* Signer picker */}
              {entityId && (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <Label className="text-sm font-medium">Подписант (из связей организации)</Label>
                    {sortedLinks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        У выбранной организации нет связанных лиц.
                      </p>
                    ) : (
                      <Select value={signerLinkId} onValueChange={setSignerLinkId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите подписанта (необязательно)" />
                        </SelectTrigger>
                        <SelectContent>
                          {sortedLinks.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              <span className="flex items-center gap-1.5">
                                {l.is_primary && <Star className="h-3 w-3 text-amber-500 fill-amber-500" />}
                                {linkLabel(l)}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 2 && (
            <div className="space-y-4 max-w-2xl">
              <p className="text-sm text-muted-foreground">
                Будет сформировано {items.length} документ(ов). Проверьте заполнение каждого:
              </p>
              {itemPreviews.map((preview) => (
                <Card key={preview.item.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{preview.templateName}</p>
                          {preview.hasPlaceholders ? (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-muted-foreground">
                                {preview.filledCount}/{preview.placeholderCount} полей заполнено
                              </span>
                              {preview.missingCount === 0 ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300/30">
                                  {preview.missingCount} пустых
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 mt-1">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              <span className="text-xs text-amber-600">Плейсхолдеры не найдены</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Step 3: Generating */}
          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Генерируется {items.length} документ(ов)…
              </p>
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 border-t bg-background px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between max-w-2xl">
            {step === 1 && (
              <>
                <div />
                <Button onClick={() => setStep(2)}>
                  Далее
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Назад
                </Button>
                <Button onClick={handleGenerate} disabled={isGenerating}>
                  {isGenerating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {totalMissing > 0
                    ? `Сформировать пакет (${totalMissing} пустых)`
                    : "Сформировать пакет"}
                </Button>
              </>
            )}
            {step === 3 && (
              <>
                <div />
                <Button variant="outline" disabled>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Генерация…
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
