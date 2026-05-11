/**
 * FieldPickerPopover — стабильный picker FLD-полей для разметки DOCX.
 *
 * Принципы:
 *  - НЕ использует cmdk/Command/CommandList — у них регулярно ломается вертикальный скролл.
 *  - Структура с фиксированным header + фиксированным input + скроллируемым списком.
 *  - 2 шага: сначала выбор поля, затем формат/падеж через FieldFormatPicker.
 *  - Все строки на русском.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RegistryFieldRef } from "@/utils/templateAutoSuggest";
import { FieldFormatPicker } from "./FieldFormatPicker";
import type { FieldCase, FieldFormat } from "./extensions/FieldChipNode";

const CATEGORY_LABELS_RU: Record<string, string> = {
  executor: "Исполнитель", customer: "Заказчик", client: "Клиент",
  product: "Продукт", tariff: "Тариф", offer: "Оффер",
  legal_details: "Реквизиты", order: "Заказ", subscription: "Подписка",
  payment: "Платёж", company: "Компания", telegram_member: "Telegram-участник",
  custom: "Пользовательские", deal: "Сделка", document: "Документ", system: "Системные поля",
};

export interface FieldPickerResult {
  fld: string;
  format: FieldFormat | null;
  caseModifier: FieldCase | null;
  data_type: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Текущая позиция якоря (виртуальная) — { x, y } в координатах окна. */
  anchor: { x: number; y: number } | null;
  /** Контекст для шапки picker'а. */
  contextLabel: string;
  /** Уже выбранный FLD (для подсветки текущего поля при режиме «изменить»). */
  currentFld?: string | null;
  refs: RegistryFieldRef[];
  onPick: (result: FieldPickerResult) => void;
  /** Если true — пропускает шаг «формат/падеж» и сразу отдаёт результат с null modifiers.
   *  Используется для messages-контекста (рассылки/email/telegram), где сериализуется legacy {{token_key}}. */
  simple?: boolean;
  /** Если задан — токены вне этого набора показываются как disabled с подписью «Недоступно для сообщений».
   *  null/undefined = все поддерживаются (DOCX-контекст). */
  supportedTokenKeys?: Set<string> | null;
  /** Подпись для disabled-токенов. По умолчанию: «Недоступно для сообщений». */
  unsupportedLabel?: string;
}

export function FieldPickerPopover({
  open, onOpenChange, anchor, contextLabel, currentFld, refs, onPick, simple = false,
  supportedTokenKeys = null, unsupportedLabel = "Недоступно для сообщений",
}: Props) {
  const [query, setQuery] = useState("");
  const [pickedField, setPickedField] = useState<RegistryFieldRef | null>(null);

  // Сброс шагов при открытии нового контекста
  useEffect(() => {
    if (open) {
      setQuery("");
      setPickedField(null);
    }
  }, [open, contextLabel]);

  // Фильтрация + группировка по категориям
  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? refs.filter((r) => {
          const hay = `${r.field_public_id} ${r.token_key} ${r.ui_label} ${r.category}`.toLowerCase();
          return hay.includes(q);
        })
      : refs;
    const map = new Map<string, RegistryFieldRef[]>();
    for (const r of filtered) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    }
    return Array.from(map.entries());
  }, [refs, query]);

  const totalFiltered = filteredGroups.reduce((acc, [, items]) => acc + items.length, 0);

  // Виртуальный якорь для Popover
  const anchorStyle: CSSProperties = anchor
    ? { position: "fixed", left: anchor.x, top: anchor.y, width: 1, height: 1 }
    : { position: "fixed", left: -9999, top: -9999, width: 1, height: 1 };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span style={anchorStyle} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        avoidCollisions
        collisionPadding={16}
        sticky="always"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Не закрывать picker, если клик/фокус ушёл обратно в редактор-источник.
          const t = e.target as HTMLElement | null;
          if (t?.closest?.('.ProseMirror') || t?.closest?.('[contenteditable="true"]')) e.preventDefault();
        }}
        onWheelCapture={(e) => e.stopPropagation()}
        className="docx-field-picker-popover p-0 bg-popover border shadow-lg z-[100] overflow-hidden"
      >
        {/* Header — контекст */}
        <div className="shrink-0 px-3 py-2 border-b bg-muted/40">
          <div className="text-[11px] font-medium text-foreground truncate" title={contextLabel}>
            {contextLabel || "Выбор FLD-поля"}
          </div>
        </div>

        {pickedField ? (
          // Шаг 2: формат / падеж
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="px-3 py-2 border-b text-[11px] text-muted-foreground flex items-center justify-between gap-2">
              <span className="truncate">
                Поле: <span className="font-mono">{pickedField.field_public_id}</span> · {pickedField.ui_label}
              </span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setPickedField(null)}>
                ← Назад
              </Button>
            </div>
            <FieldFormatPicker
              dataType={pickedField.data_type}
              fieldPublicId={pickedField.field_public_id}
              fieldLabel={pickedField.ui_label}
              onCancel={() => setPickedField(null)}
              onConfirm={(sel) => {
                onPick({
                  fld: pickedField.field_public_id,
                  format: sel.format,
                  caseModifier: sel.caseModifier,
                  data_type: pickedField.data_type ?? null,
                });
              }}
            />
          </div>
        ) : (
          <>
            {/* Search input — фиксированный */}
            <div className="shrink-0 px-3 py-2 border-b">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию, FLD или ключу…"
                className="h-8 text-xs"
              />
            </div>

            {/* Список — единственная скроллируемая область */}
            <div className="docx-field-picker-list min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
                <div>
                  {totalFiltered === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      Ничего не найдено
                    </div>
                  ) : (
                    filteredGroups.map(([cat, items]) => (
                      <div key={cat} className="py-1">
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/30 sticky top-0">
                          {CATEGORY_LABELS_RU[cat] ?? cat}
                        </div>
                        <div>
                          {items.map((r) => {
                            const isSelected = currentFld === r.field_public_id;
                            return (
                              <button
                                key={r.field_public_id}
                                type="button"
                                onClick={() => {
                                  if (simple) {
                                    onPick({ fld: r.field_public_id, format: null, caseModifier: null, data_type: r.data_type ?? null });
                                  } else {
                                    setPickedField(r);
                                  }
                                }}
                                className={cn(
                                  "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent/50 focus:bg-accent focus:outline-none",
                                  isSelected && "bg-accent/40",
                                )}
                              >
                                <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100 text-primary" : "opacity-0")} />
                                <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-[88px]">
                                  {r.field_public_id}
                                </span>
                                <span className="flex-1 truncate">{r.ui_label}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{r.data_type}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 px-3 py-2 border-t flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                Полей: {totalFiltered}
              </span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpenChange(false)}>
                <X className="h-3 w-3 mr-1" /> Отмена
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
