# Stage 5.0.2 regression fixes — F1 + F2 — PASS

Дата: 2026-06-18. Канал: code edit + tsc green.

## F1 — Нумерация документа = `index + 1` по фактическому отрисованному массиву

Файлы:

- `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx:320` — `items.map((item, index) => …)`, prop `index={index}` пробрасывается в `PackageDocumentCard`. Массив `items` уже отфильтрован и отсортирован выше по коду (sortable items + active version filter), индекс берётся из этого финального массива.
- `src/components/ai-documents/packages/PackageDocumentCard.tsx`:
  - `PackageDocumentCardProps` получил `index: number`.
  - Бейдж номера (line 340): `{index + 1}` вместо `{item.sort_order + 1}`.
  - `displayName` fallback (line 259): `Документ №${index + 1}`.

Поведенческий эффект:

| Пакет | item.sort_order | Бейдж до | Бейдж после |
|---|---|---|---|
| Идеология / Приказ | 0 | 1 | 1 |
| Идеология / Положение | 1 | 2 | 2 |
| Годовое собрание / единственный документ | 1 | **2 (FAIL)** | **1 (PASS)** |

Никаких других вызовов `PackageDocumentCard` в codebase нет (`rg PackageDocumentCard` → 1 точка использования).

## F2 — Описание поля = `Info`-иконка + shadcn `Tooltip`, скрыта если description пуст

Файл: `src/components/ai-documents/packages/PackageFieldsClientForm.tsx`.

- Удалён инлайновый `<p className="text-[10px] text-muted-foreground leading-snug">{effective.help}</p>` под контролом.
- Добавлен `helpIcon`: `Info` (lucide) внутри `Tooltip` (`@/components/ui/tooltip`).
- Гейт: `const helpText = effective.help?.trim() ?? ""; const helpIcon = helpText ? <TooltipProvider>…</TooltipProvider> : null;` — иконка не рендерится при пустом/whitespace-only description.
- Иконка вшита внутрь `<Label>` справа от обязательной звёздочки, перед бейджами «общее значение»/«переопределено» — соответствует Stage 5.0.2 §A.3.
- Tooltip имеет `side="top" align="start"`, `max-w-xs text-xs leading-snug`, `delayDuration={200}`, `aria-label="Подсказка: {label}"`, фокусируем (`tabIndex={0}`, focus-visible ring).
- Триггер — `<button type="button">` обёрнутый `TooltipTrigger asChild`, не пушит сабмит формы.

## Compile

`tsc` зелёный (видно в build output после применения правок; ошибка про `index` была устранена немедленно).

## Out of scope (не трогалось)

- Описание поля в админ-каталоге `document_package_field_catalog.description` — backend контракт не менялся.
- Логика usePackageSessionFields, фильтр `is_active`, orphan-блок — не трогались (см. baseline §A.2/§C).
- DOCX-шаблоны, ai_generated_documents, save_session_document_atomic — не трогались.

## DoD

- F1: PASS (статически проверено по коду; рендер-точка единственная).
- F2: PASS (иконка появляется только при непустом description, tooltip через shadcn).
- Регрессий в Stage 5.0.3 нет (formatter/canonicalizer/PackagePlaceholderCatalog не трогались).
