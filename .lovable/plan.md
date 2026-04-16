# да, согласен, с учетом правок:

&nbsp;

1. В PATCH A зафиксируй, что discovery должен искать **сначала shared/canonical runtime-source**, а не только docs и ui primitives. Приоритет:
  &nbsp;
  - existing shared component
  - approved runtime pattern
  - только если ничего нет — add-only extract в shared
  &nbsp;
2. В артефакте discovery по каждому паттерну дай не только found / not found, но и итоговое решение:
  &nbsp;
  - canonical source
  - reuse as-is / extract to shared
  - какие файлы будут переведены
  - какие локальные самодельные элементы будут удалены
  &nbsp;
3. Для таблицы отдельно добавь проверку, что parity должна быть не только визуальная, но и **поведенческая**:
  &nbsp;
  - drag column
  - resize column
  - select row
  - select all
  - row click
  - persistence в localStorage
    Это должно быть частью DoD PATCH A.
  &nbsp;
4. Для календаря зафиксируй жёстко: если canonical date picker уже найден в проекте, использовать **ровно его контракт**, без новой локальной реализации на shadcn “по мотивам”.
5. В PATCH A добавь отдельный пункт cleanup:
  &nbsp;
  - удалить все временные/самодельные wrappers, styles и toolbar-слои, которые появились в /admin/forms и не совпадают с canonical source
  - в финальном отчёте показать список удалённых самодельных компонентов/стилей
  &nbsp;
6. В PATCH B для policy лучше сразу проверить точное имя роли в has_role_v2 по текущим canonical enum/данным проекта и не хардкодить предположение. Если в системе стандарт — super_admin, использовать его; если есть историческая совместимость, показать proof.
7. В PATCH B добавь dry-run proof до execute:
  &nbsp;
  - сколько site_form будет удалено
  - сколько preorder будет удалено
  - сколько training будет пропущено
    Сначала dry-run summary, потом execute, потом DB/UI proof.
  &nbsp;
8. В DoD PATCH B добавь отдельно:
  &nbsp;
  - удаление реально работает **из bulk bar во всех relevant tabs**, а не только в одной вкладке
  - после удаления counts обновились в Все, Анкеты сайта, Предзаписи, По продуктам, Экспорт
  &nbsp;
9. Не менять PATCH 1 data-layer и PATCH 2 detail-viewer reuse — только literal-reuse canonical UI и точечный bulk-delete fix, без расширения scope.

&nbsp;

&nbsp;

В целом план правильный и уже намного лучше сформулирован. Можно запускать именно в таком порядке: сначала Discovery + PATCH A, потом только PATCH B.

&nbsp;

План: PATCH 4 — discovery canonical UI + parity `/admin/forms` + bulk delete fix

## Этап 0 — Discovery canonical UI source of truth (обязателен до PATCH A)

Цель: не утверждать «контакты — эталон», а доказать через системное сканирование, какой компонент/паттерн уже принят как канонический. Артефакт discovery — отдельная таблица source-of-truth, прикладывается до начала реализации.

### Скоуп discovery

1. **Shared UI kit / registry** — проверить наличие глобальных директорий и реестров:
  - `src/components/ui/*` (shadcn primitives)
  - `src/components/admin/table/*` (уже есть `SortableResizableTableHead`)
  - `src/components/admin/*` (общие admin-компоненты: `BulkActionsBar`, `ColumnSettings`, `GlassFilterPanel`)
  - `src/components/shared/*` если существует
  - `docs/ENGINEERING_RULES.md` и `mem://ui/*` — есть ли явный документированный стандарт
2. **Поиск всех runtime-использований** для каждого паттерна:
  - Таблица с DnD/resize/select: grep по `SortableResizableTableHead`, `useDragSelect`, `useColumnsState`
  - Календарь: grep по `<Calendar`, `react-day-picker`, `<DatePicker`, `type="date"`
  - Filters bar: grep по `GlassFilterPanel`, pill-style кнопкам, `ContactFiltersBar`
  - Status chips: grep по `getStatusBadge`, `Badge` с `bg-{color}-500/20`
3. **Ранжирование кандидатов** по критериям:
  - Уже вынесен в `shared` layer? → высший приоритет
  - Используется на ≥2 страницах? → runtime-эталон
  - Только на 1 странице? → кандидат на extract
  - Имеет конфликтующие версии? → блокер, требует консолидации до reuse

### Артефакт discovery (обязателен)

Таблица source-of-truth, прикладывается до PATCH A:


| Паттерн           | Канонический источник                                           | Тип (shared / runtime / нет) | Где уже используется | Решение для `/admin/forms`   |
| ----------------- | --------------------------------------------------------------- | ---------------------------- | -------------------- | ---------------------------- |
| Table shell       | TBD                                                             | TBD                          | TBD                  | reuse / extract / new        |
| Header DnD/resize | `src/components/admin/table/SortableResizableTableHead.tsx`     | shared                       | contacts, forms      | literal reuse (уже на месте) |
| Multi-select hook | `src/hooks/useDragSelect.ts` (если найден)                      | TBD                          | TBD                  | TBD                          |
| BulkActionsBar    | `src/components/admin/BulkActionsBar.tsx`                       | shared                       | TBD                  | reuse                        |
| ColumnSettings    | `src/components/admin/ColumnSettings.tsx`                       | shared                       | TBD                  | reuse                        |
| Date picker       | TBD (есть ли уже approved pattern с shadcn `Popover+Calendar`?) | TBD                          | TBD                  | TBD                          |
| Filters bar       | TBD (`GlassFilterPanel` vs `ContactFiltersBar` pill-style)      | TBD                          | TBD                  | TBD                          |
| Status chip       | TBD                                                             | TBD                          | TBD                  | TBD                          |


### Правила выбора source-of-truth

1. Если найден **shared канонический компонент** → literal reuse без изменений.
2. Если shared нет, но есть **runtime-эталон, используемый на ≥2 страницах** → объявить его source-of-truth, оформить add-only extract в `src/components/shared/` или `src/components/admin/*`, перевести `/admin/forms` на него. Существующие страницы переключить через импорт без поведенческих правок.
3. Если runtime-эталон есть только на 1 странице → подтвердить, что он соответствует другим UI-конвенциям проекта (consistency check), и только тогда брать как source-of-truth.
4. Если канонического нет вообще → создать новый shared компонент с обоснованием и пометкой «новый стандарт».

### Stop-gate

PATCH A не начинается, пока артефакт discovery не приложен и каждая строка таблицы source-of-truth не заполнена явным решением.

---

## PATCH A — literal reuse canonical UI в `/admin/forms`

Содержание зависит от результата discovery. Базовый каркас:

1. **Table shell**: `FormsHubTable.tsx` посадить на canonical обёртку из source-of-truth (вероятно `GlassCard` + canonical Table primitives). Удалить самодельные `rounded-lg border` + `bg-muted/30`.
2. **Date picker**: native `<Input type="date">` в `FormsHubFilters.tsx` заменить на canonical date-picker pattern из discovery. Если такого pattern нет в проекте — создать shared `<DateRangePicker>` на shadcn `Popover+Calendar` и пометить как новый стандарт.
3. **Filters bar**: привести к layout из source-of-truth (pill-style либо glass-panel — по результату discovery).
4. **Status chips**: применить canonical badge classes + `whitespace-nowrap`, расширить колонку `status` до 130px.
5. **ColumnSettings**: разместить в actions zone справа от фильтров (архитектурно отдельный компонент, не внутри `FormsHubFilters`).
6. **Удалить самодельный UI**: `FormsTableToolbar.tsx`, лишние `Card>CardContent` обёртки в tab-content файлах.

### DoD PATCH A

- Артефакт discovery приложен и обоснован.
- `/admin/forms` использует canonical/shared pattern, а не локальную вариацию.
- Mapping таблица: «эталонный компонент → где использовался → куда переиспользован → что удалено из самоделки».
- Visual proof: скриншоты `/admin/forms` ↔ source-of-truth страница (одинаковый фон, hover, selected, status chips).
- DnD/resize колонок одинаково работает на всех вкладках (`Все`, `Анкеты сайта`, `Предзаписи`, `Обучение`, `По продуктам`).
- Календарь — canonical date picker (не native).
- Status «В процессе» в одну строку.
- Zero regression: страницы, с которых берётся эталон, поведенчески не изменились.

---

## PATCH B — bulk delete fix (после approve PATCH A)

Причина уже найдена: на `site_form_submissions` отсутствует DELETE RLS policy.

1. **Миграция**:
  ```sql
   CREATE POLICY "Admins can delete submissions"
   ON public.site_form_submissions
   FOR DELETE TO authenticated
   USING (has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin'));
  ```
2. `**useFormsBulkDelete.ts**`: после `.delete()` явная проверка `count`. Если `summary.site_form.length > 0 && deletedSite === 0` → понятная ошибка «Нет прав на удаление». Лог в `audit_logs` (`action: 'bulk_delete_forms'`, `meta: { site, preorder, skipped_training }`).
3. `**FormsBulkActionsBar.tsx**`: показ inline-summary «Доступно: N • Пропущено (обучение): K» + confirm dialog с разбивкой по типам.
4. **Invalidate**: `forms-hub-data`, `forms-hub-products`, `admin-preregistrations`, `preregistration-stats`, `forms-hub-export-counts`.

### DoD PATCH B

- Mixed selection (site + preorder + training): confirm-dialog корректно показывает «N / M / K skip».
- DB proof: `SELECT count(*)` до/после показывает реальное удаление в `site_form_submissions` и `course_preregistrations`.
- Training-record после операции остаётся в БД и в UI.
- UI обновляется без reload, counts уменьшаются на всех вкладках.
- Selection сбрасывается, `BulkActionsBar` исчезает.
- Запись в `audit_logs` создана.

---

## Scope guard

- НЕ трогать `useFormsHubData.ts` (PATCH 1: server filters/pagination/exportMode/redirects).
- НЕ трогать detail viewers (`StudentProgressModal`, `PreregistrationDetailSheet`, form dialog).
- НЕ создавать новые table/filter/calendar engines без обоснования через discovery.
- Zero regression на страницах-источниках эталона.
- PATCH B запускается только после визуального approve PATCH A.