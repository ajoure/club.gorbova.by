/**
 * Воркшоп «Формирование внешнего продукта» — хардкод-блок для урока «Шаг 3».
 *
 * Состоит из 4 справочников (типы клиентов / сложность / сервис / ответственность)
 * и калькулятора цен по портфелю клиентов из Шага 2.
 *
 * State хранится в user_lesson_progress.response по block_id (как у ChecklistBlock).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Sparkles,
  Users,
  Layers,
  Headphones,
  ShieldCheck,
  Calculator,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  loadPortfolioFromPreviousLesson,
  type PortfolioRow,
} from "@/lib/loadPortfolioFromPreviousLesson";
import { logTrainingEvent } from "@/lib/auditTrainingActions";

/* ──────────────────────────── Типы данных ──────────────────────────── */

export interface ClientTypeRow {
  id: string;
  name: string;
  description: string;
  conclusion: string;
  base_price: number;
}
export interface CoeffRow {
  id: string;
  name: string;
  description: string;
  conclusion: string;
  coefficient: number;
  price: number;
}
export interface PortfolioPricingRow {
  client_row_id: string;
  client: string;
  current_price: number;
  client_type_id: string | null;
  complexity_ids: string[];
  service_id: string | null;
  responsibility_ids: string[];
  conclusion: string;
}

export interface ImportMeta {
  source_lesson_id: string | null;
  source_lesson_title: string | null;
  source_block_id: string | null;
  imported_count: number;
  imported_at: string | null;
  empty_reason?: "no_previous_lesson" | "no_user_response" | "no_rows";
}

export interface ExternalProductState {
  client_types: ClientTypeRow[];
  complexity: CoeffRow[];
  service_levels: CoeffRow[];
  responsibility: CoeffRow[];
  portfolio_pricing: PortfolioPricingRow[];
  import_meta: ImportMeta | null;
  completed_at: string | null;
}

interface Props {
  blockId: string;
  lessonId: string;
  /** ID урока-источника портфеля (Шаг 2). Берётся из lesson_blocks.content.source_lesson_id */
  sourceLessonId?: string | null;
  /**
   * Опциональный callback для канонической записи через useUserProgress.saveBlockResponse.
   * Вызывается ПОСЛЕ прямого upsert (он остаётся для дебаунс-автосейва), чтобы локальный
   * progress-state в LessonBlockRenderer/useUserProgress инвалидировался корректно.
   */
  onCanonicalSave?: (payload: Record<string, unknown>, completed: boolean) => Promise<boolean> | void;
}

/* ──────────────────────────── Хелперы ──────────────────────────── */

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ??
    `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`);

const fmt = (n: number) =>
  Number.isFinite(n)
    ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(
        Math.round(n * 100) / 100
      )
    : "—";

const emptyClientType = (): ClientTypeRow => ({
  id: uid(),
  name: "",
  description: "",
  conclusion: "",
  base_price: 0,
});
const emptyCoeff = (): CoeffRow => ({
  id: uid(),
  name: "",
  description: "",
  conclusion: "",
  coefficient: 1,
  price: 0,
});

const DEFAULT_STATE: ExternalProductState = {
  client_types: [emptyClientType()],
  complexity: [emptyCoeff()],
  service_levels: [emptyCoeff()],
  responsibility: [emptyCoeff()],
  portfolio_pricing: [],
  import_meta: null,
  completed_at: null,
};

const mergeState = (raw: unknown): ExternalProductState => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<ExternalProductState>;
  return {
    client_types: Array.isArray(r.client_types) && r.client_types.length
      ? r.client_types
      : DEFAULT_STATE.client_types.map((x) => ({ ...x, id: uid() })),
    complexity: Array.isArray(r.complexity) && r.complexity.length
      ? r.complexity
      : DEFAULT_STATE.complexity.map((x) => ({ ...x, id: uid() })),
    service_levels: Array.isArray(r.service_levels) && r.service_levels.length
      ? r.service_levels
      : DEFAULT_STATE.service_levels.map((x) => ({ ...x, id: uid() })),
    responsibility: Array.isArray(r.responsibility) && r.responsibility.length
      ? r.responsibility
      : DEFAULT_STATE.responsibility.map((x) => ({ ...x, id: uid() })),
    portfolio_pricing: Array.isArray(r.portfolio_pricing) ? r.portfolio_pricing : [],
    import_meta: r.import_meta && typeof r.import_meta === "object" ? r.import_meta as ImportMeta : null,
    completed_at: typeof r.completed_at === "string" ? r.completed_at : null,
  };
};

/* ──────────────────────────── Компонент ──────────────────────────── */

export function ExternalProductWorkshop({ blockId, lessonId, sourceLessonId = null, onCanonicalSave }: Props) {
  const [state, setState] = useState<ExternalProductState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [restoredFromSaved, setRestoredFromSaved] = useState(false);
  const [progressProof, setProgressProof] = useState<{
    checked_at: string;
    row_exists: boolean;
    block_completed: boolean;
    admin_source_ready: boolean;
    response_has_portfolio: boolean;
  } | null>(null);
  const skipNextSave = useRef(true);

  /* загрузка пользователя и state */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid_ = auth.user?.id ?? null;
      setUserId(uid_);
      if (!uid_) {
        setLoading(false);
        return;
      }
      const { data: row } = await supabase
        .from("user_lesson_progress")
        .select("response, completed_at")
        .eq("user_id", uid_)
        .eq("lesson_id", lessonId)
        .eq("block_id", blockId)
        .maybeSingle();
      if (cancelled) return;
      if (row?.response) {
        const merged = mergeState((row.response as { state?: unknown }).state ?? row.response);
        setState(merged);
        setRestoredFromSaved(true);
        setProgressProof({
          checked_at: new Date().toISOString(),
          row_exists: true,
          block_completed: !!row.completed_at,
          admin_source_ready: true,
          response_has_portfolio: merged.portfolio_pricing.length > 0,
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [blockId, lessonId]);

  /* автосохранение с дебаунсом */
  const debouncedState = useDebouncedValue(state, 800);
  useEffect(() => {
    if (loading || !userId) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      setSaveStatus("saving");
      const canPersistAsSubmitted =
        !!debouncedState.completed_at &&
        debouncedState.portfolio_pricing.length > 0 &&
        debouncedState.client_types.some((r) => r.name.trim().length > 0);
      const payload = {
        type: "external_product_workshop",
        state: debouncedState,
        is_submitted: canPersistAsSubmitted,
        submitted_at: canPersistAsSubmitted ? debouncedState.completed_at : null,
        saved_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("user_lesson_progress")
        .upsert(
          [
            {
              user_id: userId,
              lesson_id: lessonId,
              block_id: blockId,
              response: payload as never,
              completed_at: canPersistAsSubmitted ? debouncedState.completed_at : null,
            },
          ],
          { onConflict: "user_id,lesson_id,block_id" }
        );
      if (cancelled) return;
      setSaveStatus(error ? "error" : "saved");
      if (!error) {
        setTimeout(() => !cancelled && setSaveStatus("idle"), 1200);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedState, userId, lessonId, blockId, loading]);

  /* CRUD-помощники для справочников */
  const addClientType = () =>
    setState((s) => ({ ...s, client_types: [...s.client_types, emptyClientType()] }));
  const updClientType = (id: string, patch: Partial<ClientTypeRow>) =>
    setState((s) => ({
      ...s,
      client_types: s.client_types.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  const delClientType = (id: string) =>
    setState((s) => ({ ...s, client_types: s.client_types.filter((r) => r.id !== id) }));

  const addCoeff = (key: "complexity" | "service_levels" | "responsibility") =>
    setState((s) => ({ ...s, [key]: [...s[key], emptyCoeff()] }));
  const updCoeff = (
    key: "complexity" | "service_levels" | "responsibility",
    id: string,
    patch: Partial<CoeffRow>
  ) =>
    setState((s) => ({
      ...s,
      [key]: s[key].map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  const delCoeff = (
    key: "complexity" | "service_levels" | "responsibility",
    id: string
  ) => setState((s) => ({ ...s, [key]: s[key].filter((r) => r.id !== id) }));

  /* Импорт портфеля из Шага 2 */
  const handleImportPortfolio = useCallback(async () => {
    if (!userId) {
      toast.error("Нужно войти в личный кабинет");
      return;
    }
    setImporting(true);
    try {
      const result = await loadPortfolioFromPreviousLesson({
        currentLessonId: lessonId,
        userId,
        overrideSourceLessonId: sourceLessonId ?? undefined,
      });
      const importedAt = new Date().toISOString();
      if (!result.rows.length) {
        setState((s) => ({
          ...s,
          import_meta: {
            source_lesson_id: result.source_lesson_id,
            source_lesson_title: result.source_lesson_title,
            source_block_id: result.source_block_id,
            imported_count: 0,
            imported_at: importedAt,
            empty_reason: result.empty_reason,
          },
        }));
        const reason =
          result.empty_reason === "no_previous_lesson"
            ? "Не найден предыдущий урок с портфелем клиентов."
            : "Сначала заполните Шаг 2 «Анализ портфеля» — клиентов пока нет.";
        toast.warning(reason);
        return;
      }
      setState((s) => {
        const existing = new Map(s.portfolio_pricing.map((r) => [r.client_row_id, r]));
        const next: PortfolioPricingRow[] = result.rows.map((row: PortfolioRow) => {
          const prev = existing.get(row.row_id);
          return {
            client_row_id: row.row_id,
            client: row.client,
            current_price: row.monthly_income,
            client_type_id: prev?.client_type_id ?? null,
            complexity_ids: prev?.complexity_ids ?? [],
            service_id: prev?.service_id ?? null,
            responsibility_ids: prev?.responsibility_ids ?? [],
            conclusion: prev?.conclusion ?? "",
          };
        });
        return {
          ...s,
          portfolio_pricing: next,
          import_meta: {
            source_lesson_id: result.source_lesson_id,
            source_lesson_title: result.source_lesson_title,
            source_block_id: result.source_block_id,
            imported_count: result.rows.length,
            imported_at: importedAt,
          },
        };
      });
      setCompletionError(null);
      toast.success(`Импортировано клиентов: ${result.rows.length}`);
    } finally {
      setImporting(false);
    }
  }, [lessonId, sourceLessonId, userId]);

  /* Расчёт по строке портфеля */
  const computed = useMemo(() => {
    const ctIdx = new Map(state.client_types.map((r) => [r.id, r]));
    const cxIdx = new Map(state.complexity.map((r) => [r.id, r]));
    const svIdx = new Map(state.service_levels.map((r) => [r.id, r]));
    const rsIdx = new Map(state.responsibility.map((r) => [r.id, r]));

    return state.portfolio_pricing.map((row) => {
      const ct = row.client_type_id ? ctIdx.get(row.client_type_id) : undefined;
      const base = ct?.base_price ?? 0;

      const cxRows = row.complexity_ids.map((id) => cxIdx.get(id)).filter(Boolean) as CoeffRow[];
      const sv = row.service_id ? svIdx.get(row.service_id) : undefined;
      const rsRows = row.responsibility_ids.map((id) => rsIdx.get(id)).filter(Boolean) as CoeffRow[];

      const allCoeffRows = [...cxRows, ...(sv ? [sv] : []), ...rsRows];
      // Аддитивная дельта от base: каждый коэф применяется к base независимо,
      // результат коммутативен по порядку выбора (см. .lovable/plan.md).
      const coeffDeltaSum = allCoeffRows.reduce((acc, r) => acc + ((r.coefficient || 1) - 1), 0);
      const addonsSum = allCoeffRows.reduce((acc, r) => acc + (r.price || 0), 0);

      const price_by_coeff = base * (1 + coeffDeltaSum);
      const price_by_addons = base + addonsSum;

      const ref = row.current_price || 0;
      const diff_coeff = price_by_coeff - ref;
      const diff_addons = price_by_addons - ref;
      const pct_coeff = ref > 0 ? (diff_coeff / ref) * 100 : 0;
      const pct_addons = ref > 0 ? (diff_addons / ref) * 100 : 0;

      return {
        ...row,
        base,
        client_type_name: ct?.name ?? "",
        price_by_coeff,
        price_by_addons,
        diff_coeff,
        diff_addons,
        pct_coeff,
        pct_addons,
      };
    });
  }, [state]);

  const stats = useMemo(() => {
    if (!computed.length) return null;
    const avgCoeff = computed.reduce((a, r) => a + r.price_by_coeff, 0) / computed.length;
    const avgAddons = computed.reduce((a, r) => a + r.price_by_addons, 0) / computed.length;
    const avgCurrent = computed.reduce((a, r) => a + r.current_price, 0) / computed.length;
    const underpriced = computed.filter(
      (r) => r.price_by_coeff > r.current_price * 1.2 || r.price_by_addons > r.current_price * 1.2
    ).length;
    return { avgCoeff, avgAddons, avgCurrent, underpriced };
  }, [computed]);

  const dictsFilled = useMemo(() => {
    const has = (rows: { name: string }[]) => rows.some((r) => r.name.trim().length > 0);
    return (
      has(state.client_types) &&
      has(state.complexity) &&
      has(state.service_levels) &&
      has(state.responsibility)
    );
  }, [state.client_types, state.complexity, state.service_levels, state.responsibility]);

  const completionValidation = useMemo(() => {
    if (!dictsFilled) {
      return "Заполните хотя бы одну строку в каждом из блоков 1–4.";
    }
    if (state.portfolio_pricing.length === 0) {
      return "Загрузите портфель из Шага 2, чтобы завершить шаг.";
    }
    return null;
  }, [dictsFilled, state.portfolio_pricing.length]);
  const isCompleted = !!state.completed_at && !completionValidation;

  const refetchProof = useCallback(async () => {
    if (!userId) return;
    const { data: proofRow } = await supabase
      .from("user_lesson_progress")
      .select("completed_at, response, updated_at")
      .eq("user_id", userId)
      .eq("lesson_id", lessonId)
      .eq("block_id", blockId)
      .maybeSingle();
    const proofResponse = (proofRow?.response as { state?: ExternalProductState } | null)?.state;
    setProgressProof({
      checked_at: new Date().toISOString(),
      row_exists: !!proofRow,
      block_completed: !!proofRow?.completed_at,
      admin_source_ready: !!proofRow,
      response_has_portfolio: Array.isArray(proofResponse?.portfolio_pricing) && proofResponse.portfolio_pricing.length > 0,
    });
  }, [userId, lessonId, blockId]);

  const handleComplete = async () => {
    if (completionValidation) {
      setCompletionError(completionValidation);
      toast.warning(completionValidation);
      return;
    }
    const completedAt = new Date().toISOString();
    const nextState = { ...state, completed_at: completedAt };
    setState((s) => ({ ...s, completed_at: completedAt }));
    if (onCanonicalSave) {
      const payload = {
        type: "external_product_workshop",
        state: nextState,
        is_submitted: true,
        submitted_at: completedAt,
        saved_at: completedAt,
      };
      await onCanonicalSave(payload, true);
    }
    await refetchProof();
    // Audit log — best-effort
    void logTrainingEvent("training.external_product_workshop.completed", userId, {
      lesson_id: lessonId,
      block_id: blockId,
      student_user_id: userId,
      source: "student",
      client_types_count: nextState.client_types.filter((r) => r.name.trim()).length,
      portfolio_count: nextState.portfolio_pricing.length,
      completed: true,
    });
    setCompletionError(null);
    toast.success("Шаг 3 завершён");
  };
  const handleReopen = async () => {
    setState((s) => ({ ...s, completed_at: null }));
    if (onCanonicalSave) {
      const payload = {
        type: "external_product_workshop",
        state: { ...state, completed_at: null },
        is_submitted: false,
        submitted_at: null,
        saved_at: new Date().toISOString(),
      };
      await onCanonicalSave(payload, false);
    }
    await refetchProof();
    void logTrainingEvent("training.external_product_workshop.reopened", userId, {
      lesson_id: lessonId,
      block_id: blockId,
      student_user_id: userId,
      source: "student",
      completed: false,
    });
    toast("Можете редактировать данные");
  };

  const handleSelfExport = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      lesson_id: lessonId,
      block_id: blockId,
      user_id: userId,
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `external-product-${userId ?? "anon"}-${blockId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    void logTrainingEvent("training.student_response.exported", userId, {
      lesson_id: lessonId,
      block_id: blockId,
      student_user_id: userId,
      source: "student_self",
      format: "json",
    });
    toast.success("Ответ скачан");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загружаем ваш прогресс…
      </div>
    );
  }

  /* ─────────────────────── UI ─────────────────────── */
  return (
    <div className="space-y-6">
      {/* Hero */}
      <Card className="overflow-hidden border-border/60">
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-5 sm:px-8 py-6 sm:py-8">
          <Badge variant="secondary" className="mb-3 gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Воркшоп
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-2">
            Формирование внешнего продукта
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl">
            Не описываем «всё, что умеем», а собираем продукт, который можно повторить, объяснить и
            продать. Заполните 4 справочника и проверьте логику цены на реальном портфеле клиентов
            из Шага 2.
          </p>
          {saveStatus !== "idle" && (
            <div className="mt-4 text-xs text-muted-foreground flex items-center gap-1.5">
              {saveStatus === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
              {saveStatus === "saved" && <CheckCircle2 className="h-3 w-3 text-green-600" />}
              {saveStatus === "error" && <AlertTriangle className="h-3 w-3 text-destructive" />}
              {saveStatus === "saving" && "Сохраняем…"}
              {saveStatus === "saved" && "Сохранено"}
              {saveStatus === "error" && "Ошибка сохранения"}
            </div>
          )}
        </div>
      </Card>

      {/* ─── Блок 1. Тип клиента ─── */}
      <SectionCard
        icon={<Users className="h-5 w-5" />}
        index={1}
        title="Тип клиента"
        subtitle="Определите типовой контур клиента"
      >
        <div className="space-y-3">
          {state.client_types.map((row, idx) => (
            <div
              key={row.id}
              className="rounded-xl border border-border/60 bg-card p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Тип №{idx + 1}
                </span>
                {state.client_types.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => delClientType(row.id)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Название типа">
                  <Input
                    value={row.name}
                    onChange={(e) => updClientType(row.id, { name: e.target.value })}
                  />
                </Field>
                <Field label="Базовая цена, $">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={row.base_price || ""}
                    onChange={(e) =>
                      updClientType(row.id, { base_price: parseFloat(e.target.value) || 0 })
                    }
                  />
                </Field>
              </div>
              <Field label="Описание типа">
                <Textarea
                  value={row.description}
                  rows={2}
                  onChange={(e) => updClientType(row.id, { description: e.target.value })}
                />
              </Field>
              <Field label="Вывод по контуру">
                <Textarea
                  value={row.conclusion}
                  rows={2}
                  onChange={(e) => updClientType(row.id, { conclusion: e.target.value })}
                />
              </Field>
            </div>
          ))}
          <Button variant="outline" onClick={addClientType} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-1.5" /> Добавить тип клиента
          </Button>
        </div>
      </SectionCard>

      {/* ─── Блоки 2-4: коэффициент-таблицы ─── */}
      <CoeffSection
        icon={<Layers className="h-5 w-5" />}
        index={2}
        title="Сложность"
        subtitle="Определите контур сложности"
        rows={state.complexity}
        onAdd={() => addCoeff("complexity")}
        onUpdate={(id, p) => updCoeff("complexity", id, p)}
        onDelete={(id) => delCoeff("complexity", id)}
        nameLabel="Название участка"
      />

      <CoeffSection
        icon={<Headphones className="h-5 w-5" />}
        index={3}
        title="Сервис"
        subtitle="Определите уровень включённости и взаимодействия"
        rows={state.service_levels}
        onAdd={() => addCoeff("service_levels")}
        onUpdate={(id, p) => updCoeff("service_levels", id, p)}
        onDelete={(id) => delCoeff("service_levels", id)}
        nameLabel="Название уровня"
      />

      <CoeffSection
        icon={<ShieldCheck className="h-5 w-5" />}
        index={4}
        title="Ответственность"
        subtitle="Определите границы ответственности"
        rows={state.responsibility}
        onAdd={() => addCoeff("responsibility")}
        onUpdate={(id, p) => updCoeff("responsibility", id, p)}
        onDelete={(id) => delCoeff("responsibility", id)}
        nameLabel="Название уровня"
      />

      {/* ─── Блок 5. Калькулятор по портфелю ─── */}
      {!dictsFilled ? (
        <SectionCard
          icon={<Calculator className="h-5 w-5" />}
          index={5}
          title="Проверка цен по портфелю клиентов"
          subtitle="Доступно после заполнения блоков 1–4"
        >
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Сначала заполните блоки 1–4</AlertTitle>
            <AlertDescription>
              После того как вы заполните типы клиентов, сложность, сервис и ответственность —
              здесь появится возможность загрузить портфель из Шага 2 и проверить цены.
            </AlertDescription>
          </Alert>
        </SectionCard>
      ) : (
        <SectionCard
          icon={<Calculator className="h-5 w-5" />}
          index={5}
          title="Проверка цен по портфелю клиентов"
          subtitle="Загрузите портфель из Шага 2 и проверьте логику цены"
          action={
            <Button onClick={handleImportPortfolio} disabled={importing} variant="default" size="sm">
              {importing ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              Загрузить портфель из Шага 2
            </Button>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Источник</div>
              <div className="font-medium">{state.import_meta?.source_lesson_title || "Шаг 2"}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Загружено клиентов</div>
              <div className="font-medium">{state.import_meta?.imported_count ?? state.portfolio_pricing.length}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Дата загрузки</div>
              <div className="font-medium">
                {state.import_meta?.imported_at
                  ? new Date(state.import_meta.imported_at).toLocaleString("ru-RU")
                  : "—"}
              </div>
            </div>
          </div>

          {state.import_meta?.empty_reason && state.portfolio_pricing.length === 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Портфель пустой</AlertTitle>
              <AlertDescription>
                Источник найден, но клиенты не загружены. Проверьте заполнение Шага 2 и повторите загрузку.
              </AlertDescription>
            </Alert>
          )}

          {state.portfolio_pricing.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Портфель пока не загружен</AlertTitle>
              <AlertDescription>
                Нажмите «Загрузить портфель из Шага 2» — мы подтянем ваших клиентов из урока «Анализ
                портфеля». Если их там пока нет — сначала заполните Шаг 2.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {computed.map((row) => (
                <PortfolioRowCard
                  key={row.client_row_id}
                  row={row}
                  clientTypes={state.client_types}
                  complexity={state.complexity}
                  services={state.service_levels}
                  responsibility={state.responsibility}
                  onChange={(patch) =>
                    setState((s) => ({
                      ...s,
                      portfolio_pricing: s.portfolio_pricing.map((r) =>
                        r.client_row_id === row.client_row_id ? { ...r, ...patch } : r
                      ),
                    }))
                  }
                />
              ))}

              {stats && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Средняя текущая" value={fmt(stats.avgCurrent)} suffix="$" />
                  <Stat label="Средняя по коэф." value={fmt(stats.avgCoeff)} suffix="$" />
                  <Stat label="Средняя по надб." value={fmt(stats.avgAddons)} suffix="$" />
                  <Stat
                    label="Сильно недооценённых"
                    value={String(stats.underpriced)}
                    suffix={`из ${computed.length}`}
                  />
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {/* Proof-панели */}
      <Card className="border-border/60">
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold leading-tight">Проверка прогресса и сохранения</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Эти статусы подтверждают, что ответ сохранён в общей системе прогресса урока.
            </p>
          </div>
          {(completionError || completionValidation) && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Шаг пока нельзя завершить</AlertTitle>
              <AlertDescription>{completionError || completionValidation}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <ProofTile
              title="Сохранение в системе"
              ok={!!progressProof?.row_exists}
              text={progressProof?.row_exists ? "Ответ сохранён" : "Появится после завершения шага"}
            />
            <ProofTile
              title="Статус шага"
              ok={isCompleted}
              text={isCompleted ? "Шаг отмечен как завершённый" : "Шаг в процессе выполнения"}
            />
            <ProofTile
              title="Виден преподавателю"
              ok={!!progressProof?.admin_source_ready}
              text={progressProof?.admin_source_ready ? "Преподаватель видит ваш ответ" : "Появится у преподавателя после сохранения"}
            />
            <ProofTile
              title="Восстановление при перезагрузке"
              ok={restoredFromSaved}
              text={restoredFromSaved ? "Данные восстановлены из сохранения" : "Новая форма или страница ещё не перезагружалась"}
            />
          </div>
          {progressProof && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
              Автопроверка: шаг завершён — {progressProof.block_completed ? "да" : "нет"}; шаг засчитан — {progressProof.block_completed ? "да" : "нет"}; виден преподавателю — {progressProof.admin_source_ready ? "да" : "нет"}; ответ содержит портфель — {progressProof.response_has_portfolio ? "да" : "нет"}. Проверено: {new Date(progressProof.checked_at).toLocaleString("ru-RU")}.
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={refetchProof} disabled={!userId}>
              <RefreshCw className="h-4 w-4 mr-1.5" /> Обновить статусы
            </Button>
            <Button variant="outline" size="sm" onClick={handleSelfExport} disabled={!userId}>
              <Download className="h-4 w-4 mr-1.5" /> Скачать мой ответ
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <Card className="border-border/60 bg-gradient-to-br from-muted/40 to-transparent">
        <CardContent className="py-5 px-5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-end gap-4">
          {isCompleted ? (
            <div className="flex items-center gap-3">
              <Badge className="gap-1.5 bg-green-600 hover:bg-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Шаг завершён
              </Badge>
              <Button variant="outline" size="sm" onClick={handleReopen}>
                <RefreshCw className="h-4 w-4 mr-1.5" /> Редактировать
              </Button>
            </div>
          ) : (
            <Button onClick={handleComplete} size="lg">
              Завершить Шаг 3
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────────────────── Подкомпоненты ─────────────────────── */

function SectionCard({
  icon,
  index,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ReactNode;
  index: number;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              {icon}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Блок {index}
              </div>
              <h3 className="text-lg sm:text-xl font-semibold leading-tight break-words">
                {title}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            </div>
          </div>
          {action}
        </div>
        <Separator />
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tracking-tight">
        {value} <span className="text-sm font-normal text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

function ProofTile({ title, ok, text }: { title: string; ok: boolean; text: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />}
        {title}
      </div>
      <div className="mt-1 text-sm font-medium">{text}</div>
    </div>
  );
}

function CoeffSection({
  icon,
  index,
  title,
  subtitle,
  rows,
  onAdd,
  onUpdate,
  onDelete,
  nameLabel,
}: {
  icon: React.ReactNode;
  index: number;
  title: string;
  subtitle: string;
  rows: CoeffRow[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<CoeffRow>) => void;
  onDelete: (id: string) => void;
  nameLabel: string;
}) {
  return (
    <SectionCard icon={icon} index={index} title={title} subtitle={subtitle}>
      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div
            key={row.id}
            className="rounded-xl border border-border/60 bg-card p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Строка №{idx + 1}
              </span>
              {rows.length > 1 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(row.id)}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <Field label={nameLabel}>
              <Input
                value={row.name}
                onChange={(e) => onUpdate(row.id, { name: e.target.value })}
              />
            </Field>
            <Field label="Описание">
              <Textarea
                rows={2}
                value={row.description}
                onChange={(e) => onUpdate(row.id, { description: e.target.value })}
              />
            </Field>
            <Field label="Вывод">
              <Textarea
                rows={2}
                value={row.conclusion}
                onChange={(e) => onUpdate(row.id, { conclusion: e.target.value })}
              />
            </Field>
            <Field label="Коэффициент доплаты">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={row.coefficient ?? ""}
                onChange={(e) =>
                  onUpdate(row.id, { coefficient: parseFloat(e.target.value) || 0 })
                }
              />
            </Field>
          </div>
        ))}
        <Button variant="outline" onClick={onAdd} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-1.5" /> Добавить строку
        </Button>
      </div>
    </SectionCard>
  );
}

interface ComputedPortfolioRow extends PortfolioPricingRow {
  base: number;
  client_type_name: string;
  price_by_coeff: number;
  price_by_addons: number;
  diff_coeff: number;
  diff_addons: number;
  pct_coeff: number;
  pct_addons: number;
}

function PortfolioRowCard({
  row,
  clientTypes,
  complexity,
  services,
  responsibility,
  onChange,
}: {
  row: ComputedPortfolioRow;
  clientTypes: ClientTypeRow[];
  complexity: CoeffRow[];
  services: CoeffRow[];
  responsibility: CoeffRow[];
  onChange: (patch: Partial<PortfolioPricingRow>) => void;
}) {
  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const usableTypes = clientTypes.filter((t) => t.name.trim());
  const usableCx = complexity.filter((t) => t.name.trim());
  const usableSv = services.filter((t) => t.name.trim());
  const usableRs = responsibility.filter((t) => t.name.trim());

  const PriceBadge = ({
    label,
    value,
    diff,
    pct,
  }: {
    label: string;
    value: number;
    diff: number;
    pct: number;
  }) => {
    const positive = diff >= 0;
    return (
      <div className="rounded-lg border border-border/60 p-3 bg-muted/30">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">${fmt(value)}</div>
        <div
          className={`flex items-center gap-1 text-xs mt-0.5 ${
            positive ? "text-green-600" : "text-destructive"
          }`}
        >
          {positive ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {positive ? "+" : ""}
          {fmt(diff)} $ · {positive ? "+" : ""}
          {fmt(pct)}%
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Клиент</div>
          <div className="text-base sm:text-lg font-semibold break-words">{row.client}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Текущая цена: <span className="font-medium">${fmt(row.current_price)}</span>
            {row.base > 0 && (
              <>
                {" · "}База: ${fmt(row.base)}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Тип клиента">
          <Select
            value={row.client_type_id ?? ""}
            onValueChange={(v) => onChange({ client_type_id: v || null })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите тип" />
            </SelectTrigger>
            <SelectContent>
              {usableTypes.length === 0 && (
                <div className="p-2 text-xs text-muted-foreground">
                  Сначала заполните Блок 1
                </div>
              )}
              {usableTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} {t.base_price > 0 && `· $${fmt(t.base_price)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Сервис">
          <Select
            value={row.service_id ?? ""}
            onValueChange={(v) => onChange({ service_id: v || null })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите уровень сервиса" />
            </SelectTrigger>
            <SelectContent>
              {usableSv.length === 0 && (
                <div className="p-2 text-xs text-muted-foreground">
                  Сначала заполните Блок 3
                </div>
              )}
              {usableSv.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} · ×{t.coefficient} · +${fmt(t.price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Сложность (можно несколько)">
        <ChipPicker
          options={usableCx.map((t) => ({
            id: t.id,
            label: `${t.name} · ×${t.coefficient} · +$${fmt(t.price)}`,
          }))}
          selected={row.complexity_ids}
          onToggle={(id) =>
            onChange({ complexity_ids: toggleId(row.complexity_ids, id) })
          }
          emptyHint="Заполните Блок 2 «Сложность»"
        />
      </Field>

      <Field label="Ответственность (можно несколько)">
        <ChipPicker
          options={usableRs.map((t) => ({
            id: t.id,
            label: `${t.name} · ×${t.coefficient} · +$${fmt(t.price)}`,
          }))}
          selected={row.responsibility_ids}
          onToggle={(id) =>
            onChange({ responsibility_ids: toggleId(row.responsibility_ids, id) })
          }
          emptyHint="Заполните Блок 4 «Ответственность»"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PriceBadge
          label="Цена по коэффициентам"
          value={row.price_by_coeff}
          diff={row.diff_coeff}
          pct={row.pct_coeff}
        />
        <PriceBadge
          label="Цена по надбавкам"
          value={row.price_by_addons}
          diff={row.diff_addons}
          pct={row.pct_addons}
        />
      </div>

      <Field label="Вывод по клиенту">
        <Textarea
          rows={2}
          value={row.conclusion}
          placeholder="Занижена / завышена / требует пересмотра / не вписывается в продукт"
          onChange={(e) => onChange({ conclusion: e.target.value })}
        />
      </Field>
    </div>
  );
}

function ChipPicker({
  options,
  selected,
  onToggle,
  emptyHint,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  emptyHint: string;
}) {
  if (options.length === 0) {
    return <div className="text-xs text-muted-foreground italic">{emptyHint}</div>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className={`text-xs rounded-full border px-3 py-1.5 transition-colors ${
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card hover:bg-muted border-border/60"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
