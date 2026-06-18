# Stage 5.0.4 — Visual / UI runtime proof (A, B, E, F)

Дата: 2026-06-18
Маршрут: `/admin/documents`

## A. Пакет «Идеология» — нумерация документов
Screenshot: `tool-results://screenshots/20260618-101809-027763.png`
- Пакет: «Идеология», ЮЛ привязано (АЖУР инкам · УНП 193405000).
- Документы:
  - `1` — Шаблон - Приказ об организации идеологической работы (+1 доп. участник).
  - `2` — Шаблон - Положение об организации идеологической работы.
- Нумерация: `1, 2` — сквозная по фактически отфильтрованному массиву (`index + 1`).
- **F1 PASS.**

## B. Пакет «Годовое собрание участников» — нумерация
Screenshot: `tool-results://screenshots/20260618-101823-581066.png`
- Единственный документ отображается как `1. Приказ о проведении годового общего собрания участников ООО`.
- Badge `7/7 полей`, статус «Сохранено».
- Ранее наблюдавшийся регресс (`2` вместо `1` из-за `sort_order + 1`) отсутствует.
- **F1 PASS.**

## F2. Tooltip на полях документа
Screenshot: `tool-results://screenshots/20260618-101839-972214.png` (карточка документа развёрнута)
- У каждого поля (`Номер приказа`, `Дата приказа`, `Дата и время проведения собрания`, `Дата извещения`)
  справа от названия — иконка `Info` (ⓘ), inline-`<p>` описаний нет.
- Иконка отображается только при непустом `description`.
- **F2 PASS.**

## E. Таблица «Плейсхолдеры для Word» — runtime контракт наименования

Source SOT: `src/utils/packagePlaceholderCatalog.ts` (PACKAGE_UL).
UI: `/admin/documents` → вкладка «Плейсхолдеры» → поиск по FLD-ID.

### E1. FLD-000011 — название (без формы собственности)
Screenshot: `tool-results://screenshots/20260618-101427-835885.png`
- Группа: «Пакет: ЮЛ».
- Название строки: «Название (без формы собственности)».
- Пример: **АЖУР инкам** (чистое имя, без формы и кавычек).
- Плейсхолдер: `{{package.ul.FLD-000011}}`.
- **PASS.**

### E2. FLD-000345 — краткое составное наименование
Screenshot: `tool-results://screenshots/20260618-101442-484596.png`
- Группа: «Пакет: ЮЛ».
- Название строки: «Краткое наименование».
- Пример: **ЗАО «АЖУР инкам»**.
- Плейсхолдер: `{{package.ul.FLD-000345}}`.
- (Также показывается legacy «Заказчик ЮЛ: Краткое название» с FLD-000345 — отдельная сущность billing-каталога, не пересекается с пакетом.)
- **PASS.**

### E3. FLD-000010 — форма собственности (кратко)
Screenshot (кратко): `tool-results://screenshots/20260618-101513-462705.png`
- Группа: «Пакет: ЮЛ».
- Название: «Форма собственности (кратко)».
- Default Пример: **ЗАО**.
- Плейсхолдер: `{{package.ul.FLD-000010}}`.

### E4. FLD-000010 — форма собственности с `|format=long`
Screenshot (Развёрнуто): `tool-results://screenshots/20260618-101707-974100.png`
- При переключении ToggleGroup на «Развёрнуто»:
  - Плейсхолдер становится `{{package.ul.FLD-000010|format=long}}`.
  - Пример показывает **Закрытое акционерное общество**.
- Mapping реализован через существующий словарь `ORG_FORM_SHORT_TO_FULL` из
  `src/lib/legal-entities/GrpAutofillService.ts`. Новых formatter-функций не создано;
  для default-режима поведение `package.ul.FLD-000010` не изменилось.
- **PASS.**

## Файлы, затронутые в Stage 5.0.4 E (минимальный фикс UI-примера)
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx`:
  - импорт `ORG_FORM_SHORT_TO_FULL`;
  - в рендере колонки «Пример» добавлен fallback на длинную форму при
    `supportsLong && pkgSettings.format === "long"`. Логика отдельно изолирована
    в IIFE, остальные строки не затронуты.

## Итоговый статус Stage 5.0.4
- A (Идеология numbering): PASS
- B (Годовое собрание numbering): PASS
- D (runtime naming long org form / clean name / negative quotes): PASS (см. `stage5_0_4_d_runtime_naming.md`)
- D-defer (short org form / short legal name runtime DOCX): DEFERRED → Stage 6 (тестовый шаблон)
- E (placeholder catalog table contract): PASS
- F (placeholder rendering: clean name / short / org forms): PASS
- F2 (tooltip via Info icon): PASS
- Billing regression: ещё не покрыт runtime — DEFERRED до общего runtime-прогона.

Stage 5.0.4 overall: PASS (с указанными deferred-ассертами).
