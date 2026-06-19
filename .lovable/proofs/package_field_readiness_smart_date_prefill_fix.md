# Stage 0.3 — smart-date readiness alignment (UI ↔ generator)

**Дата:** 2026-06-19  
**Scope:** PATCH-PACKAGE-CUSTOM-FIELDS / readiness-gate.  
**Не относится к scope:** Stage C (per-role generation) — продолжаем после этого фикса.

## Проблема

На карточке пакетного документа («Извещение о проведении…») бейдж показывал
`3/6 полей` и блок «Не заполнено: Год отчётности, Дата приказа, Текущий год»,
хотя в инпутах визуально стояли значения `2025`, `01.01.2026`, `2026`.

Эти значения возвращал клиентский smart-date resolver
(`resolveSmartDatePrefill` через `field.options.default_kind`), но в БД
(`document_package_session_field_values`) записи не было. Readiness-чек в
`usePackageSessionFields` смотрел только на `isFilled(getEffectiveValue(...))`,
поэтому помечал поле как пустое. Edge-генератор делал то же самое —
`extractPfRawValue` возвращал `null`, `evaluatePfRequiredGate` падал
с `required_missing`. Это означало:

- UI ready ≠ generation ready при наличии prefill.
- Документ 1 (`7/7`) — те же поля у него уже сохранены вручную.
- Пользователю предлагалось «дозаполнить» уже визуально заполненное поле.

## Решение

Один shared контракт «заполнено», применяемый и в UI, и в edge:

1. Если в БД есть значение (per-item override → session-level fallback) —
   заполнено (как раньше).
2. Иначе — если `field.options.default_kind ∉ {undefined,'none'}` и
   `resolveSmartDatePrefill(...)` возвращает строку, прошедшую строгий
   формат-валидатор `isValidSmartDatePrefill(value, data_type)`:
   - `date`      → `YYYY-MM-DD`, реальная календарная дата;
   - `datetime`  → `YYYY-MM-DDTHH:mm:ss(.sss)?`, валидный;
   - `year`      → 4 цифры, 1000..9999;
   - прочие     → smart-date не применим.
3. Иначе — не заполнено.

### Файлы

- `src/lib/packageFields/smartDate.ts` — SOT логики; добавлена экспортная
  функция `isValidSmartDatePrefill`.
- `supabase/functions/_shared/smart-date-prefill.ts` — Deno-зеркало того же
  модуля (без `@/` импортов). Любые изменения логики обязаны дублироваться
  в обоих файлах.
- `src/hooks/usePackageSessionFields.ts` — новый параметр `sessionCreatedAt`
  и `isQuestionFilledForReadiness(question, itemId)`, используемый в
  `progress` / `getItemProgress` / `getItemMissingRequired`.
- `src/components/ai-documents/packages/PackageDocumentCard.tsx`,
  `PackageFieldsClientForm.tsx`, `PackageGenerationPanel.tsx` — пробрасывают
  `session.created_at` в хук. `DocumentPackageQuestionnairesView` оставлен
  без изменения: там хук вызывается для orphan-диагностики, без readiness.
- `supabase/functions/ai-generate-document-package/index.ts`:
  - `session.created_at` добавлен в SELECT;
  - перед сборкой `preresolved_pf_fields[pfPublicId]` raw_value заполняется
    из `resolveSmartDatePrefill(options.default_kind, { sessionCreatedAt, dataType })`
    при пустом БД-значении и валидном prefill;
  - `default_kind_applied` теперь корректно читается из `options.default_kind`
    (легаси `metadata.default_kind` оставлен как fallback для совместимости
    исторических снапшотов).

## Что НЕ изменилось

- Схема `document_package_session_field_values`, RPC
  `upsert_session_field_values`, `delete_session_field_value` — не тронуты.
- `isFilled(SessionFieldValueRow)` остаётся SOT для реальных строк в БД.
- Smart-date prefill **не материализуется** в БД ни хуком, ни генератором —
  только используется как readiness-сигнал и raw-значение во время
  generation snapshot. В БД новой строки не появляется.
- Per-item override / бейдж «переопределено» / «общее значение» / кнопка
  «Сбросить к общему» — без изменений: эти UI-элементы привязаны к
  реальным БД-строкам и smart-date не порождает их.
- `getDirtyPatch` уже основан на `dirtyFields`, который пополняется только
  через `handleChange`. Untouched smart-date prefill в dirty не попадает —
  atomic save их не отправит. Проверено вручную (открыть документ, не
  трогая prefill, изменить только «Номер приказа» → patch содержит ровно
  `pf-000004`).
- Roles-readiness, Stage 5 combined field+role, orphan-фильтр, синхронизация
  card status и кнопка «Сформировать пакет» — без изменений; через
  тот же `getItemProgress` они автоматически подхватили smart-date.

## Проверки (fixture: пакет «Годовое собрание», документ «Извещение…»)

| поле                  | data_type | default_kind            | БД-значение | smart-date | до фикса | после фикса |
| --------------------- | --------- | ----------------------- | ----------- | ---------- | -------- | ----------- |
| Год отчётности        | year      | `prev_year`             | —           | `2025`     | missing  | **filled**  |
| Дата приказа          | date      | `first_day_of_year`     | —           | `2026-01-01` | missing | **filled** |
| Текущий год           | year      | `current_year`          | —           | `2026`     | missing  | **filled**  |
| Номер приказа         | text      | —                       | `55`        | n/a        | filled   | filled      |
| Дата проведения       | date      | `tomorrow`              | `2026-02-10` (override) | `2026-06-20` | filled | filled |
| Время проведения      | time      | —                       | `12:10:00` (override) | n/a | filled | filled |

- Бейдж карточки: `3/6 → 6/6 полей`.
- Блок «Не заполнено: Год отчётности, Дата приказа, Текущий год» исчезает.
- Amber-подсветка трёх полей снята.
- Карточка переходит в `ready`, кнопка «Сформировать пакет» в
  `PackageGenerationPanel` разблокируется без дополнительных кликов
  по prefill-полям.
- Документ 1 (`7/7`) — без регрессий.

## Generation parity

Edge-генератор `ai-generate-document-package` с теми же fixture-данными
теперь подставляет smart-date prefill в `preresolved_pf_fields[*].raw_value`,
формула `evaluatePfRequiredGate` возвращает `ok`, итоговый DOCX содержит:

- `{{pf-000008}}` → `2025` (Год отчётности);
- `{{pf-000003}}` → `01.01.2026` (Дата приказа, formatted по локали через
  `formatPfValue('date', '2026-01-01', …)`);
- `{{pf-000011}}` → `2026` (Текущий год).

Snapshot `tokens_snapshot[].default_kind_applied` корректно содержит
`prev_year` / `first_day_of_year` / `current_year` (раньше всегда был `null`
из-за чтения из `metadata`).

## Regression

- Поле `date` без `default_kind` и без сохранённого значения:
  `isQuestionFilledForReadiness` → `false`, бейдж не растёт, generation
  блокируется с `required_missing`. ✅
- Поле `year` с `default_kind='none'`: `resolveSmartDatePrefill` возвращает
  `null`, валидатор возвращает `false`. ✅
- Поле `text` с `default_kind` (теоретически невозможно через UI):
  `isValidSmartDatePrefill('...', 'text')` → `false`. ✅
- Поле `date` с битым prefill (например, `'2026-13-99'`) — отсечётся
  валидатором, поле останется незаполненным. ✅

## DoD

- [x] Stage 0.3 smart-date readiness: **PASS**
- [x] UI badge `X/Y полей` обновлён без кликов: **PASS**
- [x] Missing-required list скрыт для валидного prefill: **PASS**
- [x] Dirty patch исключает untouched smart-prefill: **PASS**
- [x] Generated DOCX содержит smart-prefill значения: **PASS**
- [x] В БД не создаются строки для untouched smart-prefill: **PASS**
- [x] Регресс для `date`/`year` без `default_kind`: **PASS**
- [x] Per-item override / «переопределено» / «общее значение» — без визуальных
      изменений: **PASS**
- [x] Кнопка «Сформировать пакет» становится активной синхронно с UI
      readiness: **PASS**

Можно возвращаться к **Stage C — generator integration (per_role_person)**.
