import { useEffect } from "react";
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
 * v2: любые стадии воронки доступны для маппинга — менеджер сам решает, какая
 * стадия означает «успех», «отказ» и «в работе». Никаких ограничений по
 * stage_type. Внутренние UUID скрыты от пользователя.
 */
export function OfferCrmRoutingSection({ value, onChange }: Props) {
  const enabled = value?.enabled === true;
  const { pipelines, isLoading: pipelinesLoading } = usePipelines();
  const pipelineId = value?.pipeline_id ?? null;
  const { stages, isLoading: stagesLoading } = usePipelineStages(pipelineId);

  const handleToggle = (next: boolean) => {
    if (!next) {
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
    onChange({
      ...value,
      pipeline_id: newPipelineId,
      stage_on_pending: "",
      stage_on_success: "",
      stage_on_failed: "",
    });
  };

  // Авто-подстановка дефолтов при смене воронки: первая открытая → pending,
  // первая closed_won → success, первая closed_lost → failed. Если таких нет —
  // оставляем пусто, пользователь выберет любые стадии вручную.
  useEffect(() => {
    if (!enabled || !value || !pipelineId || stagesLoading || stages.length === 0) return;
    if (value.stage_on_pending && value.stage_on_success && value.stage_on_failed) return;
    const firstOpen = stages.find((s) => s.stage_type === "open");
    const firstWon = stages.find((s) => s.stage_type === "closed_won");
    const firstLost = stages.find((s) => s.stage_type === "closed_lost");
    onChange({
      ...value,
      stage_on_pending: value.stage_on_pending || firstOpen?.id || stages[0]?.id || "",
      stage_on_success: value.stage_on_success || firstWon?.id || stages[0]?.id || "",
      stage_on_failed: value.stage_on_failed || firstLost?.id || stages[0]?.id || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagesLoading, pipelineId, stages.length]);

  const hasDuplicates = enabled && value
    ? new Set([value.stage_on_pending, value.stage_on_success, value.stage_on_failed].filter(Boolean)).size !==
      [value.stage_on_pending, value.stage_on_success, value.stage_on_failed].filter(Boolean).length
    : false;

  return (
    <div className="space-y-3 rounded-lg border-t border-border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <Label className="text-sm font-medium">Привязка к воронке продаж (CRM)</Label>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>
      <p className="text-xs text-muted-foreground">
        При оплате через эту кнопку автоматически создаётся сделка в выбранной воронке и перемещается между стадиями по результату оплаты. Можно выбрать любые стадии — система не накладывает ограничений.
      </p>

      {enabled && value && (
        <div className="space-y-3 pt-2">
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

          {pipelineId && stages.length === 0 && !stagesLoading && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                В выбранной воронке нет стадий. Добавьте стадии в Kanban — здесь они появятся автоматически.
              </AlertDescription>
            </Alert>
          )}

          {pipelineId && stages.length > 0 && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Стадия при создании заказа *</Label>
                <Select
                  value={value.stage_on_pending || undefined}
                  onValueChange={(v) => onChange({ ...value, stage_on_pending: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите стадию…" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Стадия при успешной оплате *</Label>
                <Select
                  value={value.stage_on_success || undefined}
                  onValueChange={(v) => onChange({ ...value, stage_on_success: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите стадию…" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Стадия при неуспешной оплате *</Label>
                <Select
                  value={value.stage_on_failed || undefined}
                  onValueChange={(v) => onChange({ ...value, stage_on_failed: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите стадию…" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {hasDuplicates && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Все три стадии должны быть разными.
                  </AlertDescription>
                </Alert>
              )}

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Применяется к новым оплатам через эту кнопку. Закрытые сделки автоматикой не изменяются — повторные платежи создают новую сделку.
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
  if (!value || value.enabled !== true) return null;
  if (!value.pipeline_id) return "Выберите воронку CRM";
  if (!value.stage_on_pending || !value.stage_on_success || !value.stage_on_failed) {
    return "Заполните все три стадии CRM";
  }
  const set = new Set([value.stage_on_pending, value.stage_on_success, value.stage_on_failed]);
  if (set.size !== 3) return "Стадии CRM должны различаться";
  return null;
}
