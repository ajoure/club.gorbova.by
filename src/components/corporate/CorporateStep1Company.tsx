/**
 * CorporateStep1Company — выбор юрлица и отчётного года.
 */

import { useState } from "react";
import { useAiEntities } from "@/hooks/useAiEntities";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/GlassCard";
import { Building2, Loader2, ArrowRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  onSelect: (legalDetailsId: string, reportYear: number) => Promise<void>;
  isCreating: boolean;
}

export function CorporateStep1Company({ onSelect, isCreating }: Props) {
  const { allEntities, isLoading } = useAiEntities();
  const currentYear = new Date().getFullYear();
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");
  const [reportYear, setReportYear] = useState(currentYear - 1);

  // Filter only legal entities and entrepreneurs with UNP
  const legalEntities = (allEntities ?? []).filter(
    (e) => e.client_type === "legal_entity" || e.client_type === "entrepreneur"
  );

  const selectedEntity = legalEntities.find((e) => e.id === selectedEntityId);

  const handleContinue = async () => {
    if (!selectedEntityId) return;
    await onSelect(selectedEntityId, reportYear);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">Выбор общества</h3>
        <p className="text-sm text-muted-foreground">
          Выберите юридическое лицо для формирования корпоративных документов.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>Юридическое лицо</Label>
          <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Выберите общество..." />
            </SelectTrigger>
            <SelectContent>
              {legalEntities.map((entity) => {
                const name =
                  entity.client_type === "legal_entity"
                    ? entity.leg_name
                    : entity.ent_name;
                const unp =
                  entity.client_type === "legal_entity"
                    ? entity.leg_unp
                    : entity.ent_unp;
                return (
                  <SelectItem key={entity.id} value={entity.id}>
                    {name || "Без названия"}
                    {unp ? ` (УНП: ${unp})` : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Отчётный год</Label>
          <Input
            type="number"
            className="mt-1 max-w-[200px]"
            value={reportYear}
            onChange={(e) => setReportYear(Number(e.target.value))}
            min={2000}
            max={currentYear}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Год, за который проводится годовое собрание
          </p>
        </div>
      </div>

      {/* Selected entity card */}
      {selectedEntity && (
        <GlassCard className="p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {selectedEntity.client_type === "legal_entity"
                  ? selectedEntity.leg_name
                  : selectedEntity.ent_name}
              </p>
              {(selectedEntity.client_type === "legal_entity"
                ? selectedEntity.leg_unp
                : selectedEntity.ent_unp) && (
                <p className="text-muted-foreground">
                  УНП:{" "}
                  {selectedEntity.client_type === "legal_entity"
                    ? selectedEntity.leg_unp
                    : selectedEntity.ent_unp}
                </p>
              )}
              {selectedEntity.grp_status_name && (
                <p className="text-muted-foreground">
                  Статус МНС: {selectedEntity.grp_status_name}
                </p>
              )}
            </div>
          </div>
        </GlassCard>
      )}

      <Button
        className="w-full"
        disabled={!selectedEntityId || isCreating}
        onClick={handleContinue}
      >
        {isCreating ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4 mr-2" />
        )}
        Продолжить
      </Button>
    </div>
  );
}
