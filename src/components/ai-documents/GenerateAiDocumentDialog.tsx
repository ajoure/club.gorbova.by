import { useState, useMemo, useEffect } from "react";
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
import { TokenPreviewTable } from "./TokenPreviewTable";
import { resolvePreviewTokens, type SnapshotData } from "@/utils/aiDocumentSnapshotResolver";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import { useEntityPersonLinks, type LinkRow } from "@/hooks/useEntityPersonLinks";
import { useAiDocuments } from "@/hooks/useAiDocuments";
import type { DocumentTemplate } from "@/hooks/useDocumentTemplates";
import { Loader2, FileText, ChevronRight, ChevronLeft, Star, AlertTriangle, History, RefreshCw } from "lucide-react";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template: DocumentTemplate | null;
}

export function GenerateAiDocumentDialog({ open, onOpenChange, template }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [entityId, setEntityId] = useState<string>("");
  const [personId, setPersonId] = useState<string>("");
  const [signerLinkId, setSignerLinkId] = useState<string>("");
  const [prefillSource, setPrefillSource] = useState<"history" | "fresh" | null>(null);
  const [prefillDocId, setPrefillDocId] = useState<string | null>(null);

  const { allEntities } = useAiEntities();
  const { allPersons } = useAiPersons();
  const { generate, isGenerating, documents } = useAiDocuments();

  const { links } = useEntityPersonLinks(entityId || null, null);

  const activeEntities = useMemo(
    () => allEntities.filter((e) => e.status === "active"),
    [allEntities]
  );

  const activePersons = useMemo(
    () => allPersons.filter((p) => p.is_active),
    [allPersons]
  );

  // Find last generated document for this template
  const lastDoc = useMemo(() => {
    if (!template?.id) return null;
    return documents.find((d) => d.template_id === template.id) ?? null;
  }, [documents, template?.id]);

  // No effect needed — banner visibility driven by lastDoc + prefillSource

  const applyPrefill = () => {
    if (!lastDoc) return;
    const meta = lastDoc.meta as Record<string, unknown> | null;
    const snapshot = lastDoc.snapshot as Record<string, unknown> | null;

    const eId = (meta?.selected_entity_id as string) || (lastDoc.legal_details_id as string) || "";
    const pId = (meta?.selected_person_id as string) || (lastDoc.person_id as string) || "";
    const sId = (meta?.selected_signer_link_id as string) || (lastDoc.signer_link_id as string) || "";

    setEntityId(eId);
    setPersonId(pId);
    setSignerLinkId(sId);
    setPrefillSource("history");
    setPrefillDocId(lastDoc.id);
    setShowPrefillChoice(false);
  };

  const startFresh = () => {
    setEntityId("");
    setPersonId("");
    setSignerLinkId("");
    setPrefillSource(null);
    setPrefillDocId(null);
    setShowPrefillChoice(false);
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

  const placeholders: string[] = template && Array.isArray(template.placeholders) ? template.placeholders : [];
  const previewData: SnapshotData = {
    entity: selectedEntity,
    person: selectedPerson as any,
    signerPerson: signerPerson as any,
    link: selectedLink,
  };
  const tokens = resolvePreviewTokens(placeholders, previewData);
  const missingCount = tokens.filter((t) => !t.filled).length;

  const handleGenerate = async () => {
    if (!template?.id) return;
    try {
      const result = await generate({
        template_id: template.id,
        legal_details_id: entityId || undefined,
        person_id: personId || undefined,
        signer_link_id: signerLinkId || undefined,
      });
      if (result.download_url) {
        window.open(result.download_url, "_blank");
      }
      onOpenChange(false);
      resetState();
    } catch {
      // error handled in hook
    }
  };

  const resetState = () => {
    setStep(1);
    setEntityId("");
    setPersonId("");
    setSignerLinkId("");
    setPrefillSource(null);
    setPrefillDocId(null);
    setShowPrefillChoice(false);
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
            <div className="p-2 rounded-xl bg-primary/10 shrink-0">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-left truncate">{template?.name ?? "Документ"}</SheetTitle>
              <SheetDescription className="text-left text-sm mt-0.5">
                {step === 1 ? "Выберите источники данных для документа" : "Проверьте заполнение полей"}
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
          </div>
          <Separator className="mt-3" />
        </SheetHeader>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 pb-24">
          {step === 1 && (
            <div className="space-y-5 max-w-2xl">
              {/* Prefill choice banner */}
              {showPrefillChoice && lastDoc && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <History className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Найден ранее созданный документ</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Вы можете использовать данные из последнего документа или заполнить заново.
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
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {prefillSource === "history" && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
                  <History className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="text-xs text-muted-foreground">Данные из последнего документа</span>
                </div>
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

          {step === 2 && (
            <div className="space-y-4 max-w-2xl">
              {placeholders.length === 0 ? (
                <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-amber-700 dark:text-amber-400">Плейсхолдеры не найдены</p>
                    <p className="text-muted-foreground mt-1">
                      В шаблоне не обнаружены токены для автозаполнения. Проверьте, что файл DOCX содержит токены в формате <code className="bg-muted px-1 rounded text-xs">{"{{имя}}"}</code>. Документ будет сформирован без подстановки данных.
                    </p>
                  </div>
                </div>
              ) : (
                <TokenPreviewTable tokens={tokens} />
              )}
            </div>
          )}
        </div>

        {/* Fixed Footer */}
        <div className="flex-shrink-0 border-t bg-background px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between max-w-2xl">
            {step === 1 ? (
              <>
                <div />
                <Button onClick={() => setStep(2)}>
                  Далее
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Назад
                </Button>
                <Button onClick={handleGenerate} disabled={isGenerating}>
                  {isGenerating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {missingCount > 0 ? `Сформировать (${missingCount} пустых)` : "Сформировать"}
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
