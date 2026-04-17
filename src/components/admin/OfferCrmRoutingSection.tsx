import { useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Target } from "lucide-react";
import { usePipelines } from "@/hooks/usePipelines";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import type { CrmRoutingConfig } from "@/hooks/useTariffOffers";

interface Props {
  value: CrmRoutingConfig | undefined;
  onChange: (next: CrmRoutingConfig | undefined) => void;
}

/**
 * UI-секция «Привязка кнопки оплаты к воронке (CRM)».
 * - Layer A: routing применяется только к offer-driven первичной оплате.
 * - При смене pipeline дефолты пересчитываются по semantic stage_type.
 * - Блокирует валидное сохранение если у воронки нет open / closed_won / closed_lost.
 */
export function OfferCrmRoutingSection({ value, onChange }: Props) {
  const enabled = value?.enabled === true;
  const { pipelines, isLoading: pipelinesLoading } = usePipelines();
  const pipelineId = value?.pipeline_id ?? null;
  const { stages, isLoading: stagesLoading } = usePipelineStages(pipelineId);

  const semantic = useMemo(() => {
    const open = stages.filter((s) => s.stage_type === "open");
    const won = stages.find((s) => s.stage_type === "closed_won");
    const lost = stages.find((s) => s.stage_type === "closed_lost");
    return { open, won, lost };
  }, [stages]);

  const missingSemantic: string[] = [];
  if (pipelineId && !stagesLoading) {
    if (semantic.open.length === 0) missingSemantic.push("«В работе» (open)");
    if (!semantic.won) missingSemantic.push("«Успешно» (closed_won)");
    if (!semantic.lost) missingSemantic.push("«Отказ» (closed_lost)");
  }
  const semanticOk = pipelineId && missingSemantic.length === 0;

  const handleToggle = (next: boolean) => {
    if (!next) {
      // disable → удалить весь routing-блок целиком
      onChange(undefined);
      return;
    }
    onChange({
      enabled: true,
      pipeline_id: "",
      stage_on_pending: "",
      stage_on_success: "",
      stage_on_failed: "",
    });
  };

  const handlePipelineChange = (newPipelineId: string) => {
    if (!value) return;
    // Сбрасываем стадии — дефолты подставит useEffect когда загрузятся новые stages
    onChange({
      ...value,
      pipeline_id: newPipelineId,
      stage_on_pending: "",
      stage_on_success: "",
      stage_on_failed: "",
    });
  };

  // Auto-defaults при загрузке стадий новой воронки
  useMemo(() => {
    if (!enabled || !value || !pipelineId || stagesLoading) return;
    if (value.stage_on_pending && value.stage_on_success && value.stage_on_failed) return;
    if (!semanticOk) return;
    onChange({
      ...value,
      stage_on_pending: value.stage_on_pending || semantic.open[0]?.id || "",
      stage_on_success: value.stage_on_success || semantic.won?.id || "",
      stage_on_failed: value.stage_on_failed || semantic.lost?.id || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagesLoading, pipelineId, semanticOk]);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium">Привязка к воронке продаж (CRM)</Label>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>
      <p className="text-xs text-muted-foreground">
        При оплате через эту кнопку автоматически создаётся сделка в выбранной воронке и перемещается между стадиями по результату оплаты.
      </p>

      {enabled && value && (
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="space-y-1.5">
            <Label className="text-xs">Воронка *</Label>
            <Select
              value={value.pipeline_id || undefined}
              onValueChange={handlePipelineChange}
              disabled={pipelinesLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите воронку…" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {pipelineId && missingSemantic.length > 0 && !stagesLoading && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                В выбранной воронке отсутствуют обязательные семантические стадии: {missingSemantic.join(", ")}. Routing нельзя сохранить.
              </AlertDescription>
            </Alert>
          )}

          {pipelineId && semanticOk && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Стадия при создании заказа (open) *</Label>
                <Select
                  value={value.stage_on_pending || undefined}
                  onValueChange={(v) => onChange({ ...value, stage_on_pending: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите…" />
                  </SelectTrigger>
                  <SelectContent>
                    {semantic.open.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {value.stage_on_pending && (
                  <p className="text-[10px] text-muted-foreground font-mono">ID: {value.stage_on_pending}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Стадия при успешной оплате (closed_won) *</Label>
                <Select
                  value={value.stage_on_success || undefined}
                  onValueChange={(v) => onChange({ ...value, stage_on_success: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите…" />
                  </SelectTrigger>
                  <SelectContent>
                    {semantic.won && (
                      <SelectItem value={semantic.won.id}>{semantic.won.name}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {value.stage_on_success && (
                  <p className="text-[10px] text-muted-foreground font-mono">ID: {value.stage_on_success}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Стадия при неуспешной оплате (closed_lost) *</Label>
                <Select
                  value={value.stage_on_failed || undefined}
                  onValueChange={(v) => onChange({ ...value, stage_on_failed: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите…" />
                  </SelectTrigger>
                  <SelectContent>
                    {semantic.lost && (
                      <SelectItem value={semantic.lost.id}>{semantic.lost.name}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {value.stage_on_failed && (
                  <p className="text-[10px] text-muted-foreground font-mono">ID: {value.stage_on_failed}</p>
                )}
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Применяется только к новым первичным оплатам через эту кнопку. Recurring/rebill, refund и ручные сделки в Kanban не перетираются.
                </AlertDescription>
              </Alert>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Сервер-сайд эквивалент валидации UI: возвращает null если ok или строку с ошибкой.
 * Используется в handleSaveOffer перед отправкой на сервер.
 */
export function validateCrmRoutingForSave(value: CrmRoutingConfig | undefined): string | null {
  if (!value || value.enabled !== true) return null; // disabled → ok
  if (!value.pipeline_id) return "Выберите воронку CRM";
  if (!value.stage_on_pending || !value.stage_on_success || !value.stage_on_failed) {
    return "Заполните все три стадии CRM";
  }
  const set = new Set([value.stage_on_pending, value.stage_on_success, value.stage_on_failed]);
  if (set.size !== 3) return "Стадии CRM должны различаться";
  return null;
}
