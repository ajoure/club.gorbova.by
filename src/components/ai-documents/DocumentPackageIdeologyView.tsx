/**
 * DocumentPackageIdeologyView — пользовательский вид пакета «Идеология».
 *
 * Фаза 1 (frontend-only):
 *   • Блок A. Состав пакета — read-only список активных шаблонов категории
 *     `ideology`, отображается через <StrictDocumentTemplatesManager readOnly>.
 *   • Блок B. Анкета — мультивыбор юрлиц/физлиц + роли (Исполнитель/Заказчик).
 *     Сохраняется ТОЛЬКО в localStorage по ключу
 *     `document_package_questionnaire_ideology_v1` (ID-driven, без display labels).
 *   • Блок C. Сформировать пакет — кнопка всегда disabled, генерация подключается
 *     во второй фазе.
 *
 * Не пишет в БД, не вызывает edge-functions, не создаёт batch-записи.
 */
import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Building2, Users, Save, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";
import { StrictDocumentTemplatesManager } from "./StrictDocumentTemplatesManager";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

function entityDisplayName(e: ClientLegalDetails): string {
  if (e.client_type === "legal_entity") return e.leg_name ?? "Юрлицо без названия";
  if (e.client_type === "individual_entrepreneur") return e.ent_name ?? "ИП без названия";
  return e.ind_full_name ?? "Физлицо без имени";
}

function entityUnp(e: ClientLegalDetails): string | null {
  if (e.client_type === "legal_entity") return e.leg_unp ?? null;
  if (e.client_type === "individual_entrepreneur") return e.ent_unp ?? null;
  return null;
}

const STORAGE_KEY = "document_package_questionnaire_ideology_v1";
const STORAGE_VERSION = 1;

interface QuestionnaireState {
  version: number;
  updatedAt: string;
  selectedEntityIds: string[];
  selectedPersonIds: string[];
  roles: {
    executorId?: string;
    customerId?: string;
  };
}

const EMPTY_STATE: QuestionnaireState = {
  version: STORAGE_VERSION,
  updatedAt: new Date(0).toISOString(),
  selectedEntityIds: [],
  selectedPersonIds: [],
  roles: {},
};

function loadFromStorage(): QuestionnaireState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== STORAGE_VERSION) {
      return EMPTY_STATE;
    }
    return {
      version: STORAGE_VERSION,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      selectedEntityIds: Array.isArray(parsed.selectedEntityIds)
        ? parsed.selectedEntityIds.filter((x: unknown) => typeof x === "string")
        : [],
      selectedPersonIds: Array.isArray(parsed.selectedPersonIds)
        ? parsed.selectedPersonIds.filter((x: unknown) => typeof x === "string")
        : [],
      roles: {
        executorId: typeof parsed?.roles?.executorId === "string" ? parsed.roles.executorId : undefined,
        customerId: typeof parsed?.roles?.customerId === "string" ? parsed.roles.customerId : undefined,
      },
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function DocumentPackageIdeologyView() {
  const aiEntities = useAiEntities();
  const aiPersons = useAiPersons();

  const [state, setState] = useState<QuestionnaireState>(EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate из localStorage один раз
  useEffect(() => {
    setState(loadFromStorage());
    setHydrated(true);
  }, []);

  // Игнорируем ID, которых уже нет в данных
  const validEntityIds = useMemo(
    () => new Set(aiEntities.allEntities.map((e) => e.id)),
    [aiEntities.allEntities],
  );
  const validPersonIds = useMemo(
    () => new Set(aiPersons.allPersons.map((p) => p.id)),
    [aiPersons.allPersons],
  );

  const filteredState = useMemo<QuestionnaireState>(() => ({
    ...state,
    selectedEntityIds: state.selectedEntityIds.filter((id) => validEntityIds.has(id)),
    selectedPersonIds: state.selectedPersonIds.filter((id) => validPersonIds.has(id)),
    roles: {
      executorId: state.roles.executorId && (validEntityIds.has(state.roles.executorId) || validPersonIds.has(state.roles.executorId))
        ? state.roles.executorId : undefined,
      customerId: state.roles.customerId && (validEntityIds.has(state.roles.customerId) || validPersonIds.has(state.roles.customerId))
        ? state.roles.customerId : undefined,
    },
  }), [state, validEntityIds, validPersonIds]);

  const toggleEntity = (id: string) => {
    setState((prev) => ({
      ...prev,
      selectedEntityIds: prev.selectedEntityIds.includes(id)
        ? prev.selectedEntityIds.filter((x) => x !== id)
        : [...prev.selectedEntityIds, id],
    }));
  };

  const togglePerson = (id: string) => {
    setState((prev) => ({
      ...prev,
      selectedPersonIds: prev.selectedPersonIds.includes(id)
        ? prev.selectedPersonIds.filter((x) => x !== id)
        : [...prev.selectedPersonIds, id],
    }));
  };

  const setRole = (role: "executorId" | "customerId", id: string | undefined) => {
    setState((prev) => ({
      ...prev,
      roles: { ...prev.roles, [role]: id },
    }));
  };

  const handleSave = () => {
    const payload: QuestionnaireState = {
      ...filteredState,
      version: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      setState(payload);
      toast.success("Анкета сохранена локально");
    } catch (e: any) {
      toast.error(`Не удалось сохранить: ${e?.message ?? e}`);
    }
  };

  // Опции для ролей — только из уже выбранных
  const roleOptions = useMemo(() => {
    const opts: { id: string; label: string; kind: "entity" | "person" }[] = [];
    for (const id of filteredState.selectedEntityIds) {
      const e = aiEntities.allEntities.find((x) => x.id === id);
      if (e) opts.push({ id, label: `${e.short_name ?? "—"}${e.unp ? ` · УНП ${e.unp}` : ""}`, kind: "entity" });
    }
    for (const id of filteredState.selectedPersonIds) {
      const p = aiPersons.allPersons.find((x) => x.id === id);
      if (p) opts.push({ id, label: p.full_name ?? "—", kind: "person" });
    }
    return opts;
  }, [filteredState, aiEntities.allEntities, aiPersons.allPersons]);

  const hasSelection =
    filteredState.selectedEntityIds.length > 0 ||
    filteredState.selectedPersonIds.length > 0;

  return (
    <div className="space-y-4">
      {/* Блок A. Состав пакета (read-only) */}
      <GlassCard className="p-4">
        <StrictDocumentTemplatesManager
          embedded
          readOnly
          categoryFilter="ideology"
          title="Состав пакета «Идеология»"
          subtitle={
            <>Шаблоны документов, входящие в пакет. Список наполняется администратором.</>
          }
          emptyText="В пакете «Идеология» пока нет готовых шаблонов. Администратор добавит их позже."
        />
      </GlassCard>

      {/* Блок B. Анкета */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold">Анкета пакета</h2>
          <Badge variant="outline" className="text-[10px]">локально</Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Выберите юрлица / физлица из ваших реквизитов и назначьте роли сторон.
          Ответы сохраняются только в этом браузере.
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Юрлица */}
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="h-4 w-4 text-indigo-500" />
              <span className="text-sm font-medium">Юрлица / ИП</span>
              <Badge variant="secondary" className="text-[10px]">
                выбрано: {filteredState.selectedEntityIds.length}
              </Badge>
            </div>
            {aiEntities.isLoading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Загрузка…</div>
            ) : aiEntities.allEntities.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">
                Нет юрлиц. Добавьте их во вкладке «Реквизиты».
              </div>
            ) : (
              <ScrollArea className="h-48 pr-2">
                <div className="space-y-1">
                  {aiEntities.allEntities.map((e) => {
                    const checked = filteredState.selectedEntityIds.includes(e.id);
                    return (
                      <label
                        key={e.id}
                        className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-accent/40 cursor-pointer"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleEntity(e.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{e.short_name ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {e.unp ? `УНП ${e.unp}` : "без УНП"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Физлица */}
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-teal-500" />
              <span className="text-sm font-medium">Физлица</span>
              <Badge variant="secondary" className="text-[10px]">
                выбрано: {filteredState.selectedPersonIds.length}
              </Badge>
            </div>
            {aiPersons.isLoading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Загрузка…</div>
            ) : aiPersons.allPersons.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">
                Нет физлиц. Добавьте их во вкладке «Реквизиты».
              </div>
            ) : (
              <ScrollArea className="h-48 pr-2">
                <div className="space-y-1">
                  {aiPersons.allPersons.map((p) => {
                    const checked = filteredState.selectedPersonIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-accent/40 cursor-pointer"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => togglePerson(p.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{p.full_name ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {p.is_active ? "активен" : "архив"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        {/* Роли */}
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Исполнитель</Label>
            <Select
              value={filteredState.roles.executorId ?? ""}
              onValueChange={(v) => setRole("executorId", v || undefined)}
              disabled={roleOptions.length === 0}
            >
              <SelectTrigger className="h-9 text-xs mt-1">
                <SelectValue placeholder={roleOptions.length === 0 ? "Сначала выберите стороны" : "Выберите исполнителя"} />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((o) => (
                  <SelectItem key={`exec-${o.id}`} value={o.id} className="text-xs">
                    {o.kind === "entity" ? "🏢 " : "👤 "}{o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Заказчик</Label>
            <Select
              value={filteredState.roles.customerId ?? ""}
              onValueChange={(v) => setRole("customerId", v || undefined)}
              disabled={roleOptions.length === 0}
            >
              <SelectTrigger className="h-9 text-xs mt-1">
                <SelectValue placeholder={roleOptions.length === 0 ? "Сначала выберите стороны" : "Выберите заказчика"} />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((o) => (
                  <SelectItem key={`cust-${o.id}`} value={o.id} className="text-xs">
                    {o.kind === "entity" ? "🏢 " : "👤 "}{o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            {hydrated && filteredState.updatedAt && new Date(filteredState.updatedAt).getTime() > 0
              ? `Последнее сохранение: ${new Date(filteredState.updatedAt).toLocaleString("ru-RU")}`
              : "Анкета ещё не сохранялась"}
          </div>
          <Button size="sm" onClick={handleSave} disabled={!hydrated}>
            <Save className="h-4 w-4 mr-1" /> Сохранить анкету
          </Button>
        </div>
      </GlassCard>

      {/* Блок C. Сформировать пакет (всегда disabled в фазе 1) */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-orange-500" />
              Сформировать пакет
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Генерация пакета будет подключена во второй фазе.
            </p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" disabled>
                    <Sparkles className="h-4 w-4 mr-1" /> Сформировать пакет
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Генерация пакета будет подключена во второй фазе.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {!hasSelection && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Заполните анкету: выберите хотя бы одно юрлицо или физлицо.
          </div>
        )}
      </GlassCard>
    </div>
  );
}
