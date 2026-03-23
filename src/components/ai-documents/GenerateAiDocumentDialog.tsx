import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
import { Loader2, FileText, ChevronRight, ChevronLeft, Star } from "lucide-react";

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

  const { allEntities } = useAiEntities();
  const { allPersons } = useAiPersons();
  const { generate, isGenerating } = useAiDocuments();

  // Load links for selected entity
  const { links } = useEntityPersonLinks(entityId || null, null);

  // Active entities only
  const activeEntities = useMemo(
    () => allEntities.filter((e) => e.status === "active"),
    [allEntities]
  );

  const activePersons = useMemo(
    () => allPersons.filter((p) => p.is_active),
    [allPersons]
  );

  // Selected objects
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

  // Signer person from link
  const signerPerson = useMemo(() => {
    if (!selectedLink) return null;
    return allPersons.find((p) => p.id === selectedLink.person_id) ?? null;
  }, [selectedLink, allPersons]);

  // Sort links: is_primary first
  const sortedLinks = useMemo(
    () => [...links].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)),
    [links]
  );

  // Preview tokens
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
      // Reset
      setStep(1);
      setEntityId("");
      setPersonId("");
      setSignerLinkId("");
    } catch {
      // error handled in hook
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setStep(1);
      setEntityId("");
      setPersonId("");
      setSignerLinkId("");
    }
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
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            {template.name}
          </DialogTitle>
          <DialogDescription>
            {step === 1 ? "Выберите источники данных для документа" : "Проверьте заполнение полей"}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={step === 1 ? "default" : "secondary"} className="text-xs">1</Badge>
          <span>Данные</span>
          <ChevronRight className="h-3 w-3" />
          <Badge variant={step === 2 ? "default" : "secondary"} className="text-xs">2</Badge>
          <span>Проверка</span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            {/* Entity picker */}
            <div className="space-y-2">
              <Label>ЮЛ / ИП</Label>
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
            </div>

            {/* Person picker */}
            <div className="space-y-2">
              <Label>Физлицо</Label>
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
            </div>

            {/* Signer picker (from entity links) */}
            {entityId && (
              <div className="space-y-2">
                <Label>Подписант (из связей организации)</Label>
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
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button onClick={() => setStep(2)}>
                Далее
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {placeholders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                У шаблона нет зарегистрированных плейсхолдеров. Документ будет сформирован как есть.
              </p>
            ) : (
              <TokenPreviewTable tokens={tokens} />
            )}

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Назад
              </Button>
              <Button onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {missingCount > 0 ? `Сформировать (${missingCount} пустых)` : "Сформировать"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
