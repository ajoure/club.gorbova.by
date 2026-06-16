# да, согласен, с учетом правок:

1. Перед утверждением, что генераторы уже поддерживают `long / full / short / signature_short`, провести read-only проверку фактического resolver-контракта. Классификатор лишь разрешает синтаксис; он не доказывает корректный рендеринг. Добавить тесты именно преобразования:
  - `FLD-000010 + long`;
  - `FLD-000014 + signature_short`;
  - `FLD-000014 + short`;
  - `FLD-000372 + full`.
2. Если resolver не поддерживает хотя бы один из форматов, исправить его в рамках этого же PATCH до Runtime UAT. Нельзя активировать шаблон, который проходит классификацию, но падает или возвращает raw value при генерации.
3. В `PlaceholderFormat` проверить весь итоговый union. Он должен содержать все реально разрешённые значения:
  &nbsp;
  ```text
  words | text | full | short | signature_short | long
  ```
  Добавлять только `long` допустимо лишь при доказательстве, что остальные четыре уже присутствуют.
4. Сохранить parity SOT ↔ edge mirror после изменения format-set. В proof приложить не только результаты одинаковых тестов, но и результат существующего parity/hash-контроля.
5. После изменения `_shared/placeholderClassifier.ts` обязательно повторно задеплоить `canonical-template-apply-markup` и зафиксировать deployment proof. Иначе runtime продолжит использовать старый whitelist.
6. В D-Activate не хардкодить значение `validation_status='active'`, если фактическая схема разделяет `validation_status` и `is_active`. Зафиксировать реальные поля до/после:
  &nbsp;
  ```text
  validation_status
  is_active
  active_version_id
  ```
  Успех: ошибок `0`, валидный статус и реально активная версия.
7. В D7-200 не требовать нового поля `format` внутри `tokens_snapshot[]`, если его нет в утверждённом snapshot-контракте. Формат доказать через:
  - исходный manifest/raw token;
  - фактически отрендеренный текст DOCX;
  - существующие snapshot-поля без изменения их схемы.
8. Добавить отрицательные resolver-тесты: формат, синтаксически разрешённый для namespace `package_requisite`, но неприменимый к конкретному типу значения, не должен приводить к молчаливому повреждению данных. Он должен либо корректно вернуть исходное значение по существующему контракту, либо дать каноническую ошибку — фактическое поведение зафиксировать в proof.
9. D7-422 выполнять только после подтверждения, что используемый обязательный `pf-XXXXXX` действительно присутствует в DOCX этого шаблона, назначен данному item и имеет `effective_required=true`. Иначе тест не доказывает required-gate.
10. Итоговый proof должен отдельно показывать:
  - classifier tests;
  - resolver/format tests;
  - edge deployment;
  - runtime activation;
  - DOCX 200 с визуальной и XML-проверкой;
  - 422 с `count(*)` до/после.

Все остальные пункты плана сохраняются add-only.

&nbsp;

План: PATCH-PACKAGE-CUSTOM-FIELDS-V1 — fix invalid_modifier_value для package.{ul|ip|fl}

## Diagnose

Шаблон «1. Приказ о проведении годового общего собрания участников ООО» падает с 2 ошибками:

- `{{package.ul.FLD-000010|format=long}}` → `invalid_modifier_value` (FLD-000010 = «Форма собственности», `long` = полная расшифровка «Общество с ограниченной ответственностью»).
- `{{package.ul.FLD-000014|format=signature_short}}` → `invalid_modifier_value` (FLD-000014 = «Руководитель ФИО», `signature_short` = «И.И.Иванов»).

Причина: в `placeholderClassifier.ts` для ветки `package_requisite` (`package.{ul|ip|fl}.FLD-XXXXXX`) разрешён только `FORMATS_BILLING = {words, text}`. При этом фронт-каталог `src/utils/packagePlaceholderCatalog.ts` (Sprint 3K/3L) **сам генерит** токены с `format=long|short|signature_short|full` для FLD-000010 (org_form) и FLD-000014 / FLD-000372 (имена). Это рассинхрон каталога и валидатора, а не ошибка пользователя в шаблоне.

Память-канон: `package.ul/ip` — реюз `client_legal_details`, `package.fl` — `legal_details_persons`; namespace package_requisite одновременно держит и биллинговые поля (суммы/даты — нужны `words|text`), и поля-персоналии/орг-форма (нужны `full|short|signature_short|long`).

## Scope

Расширить набор допустимых `format` именно для `package_requisite` так, чтобы он покрывал реально генерируемые каталогом значения, без расширения для билингового `field:FLD-…` и без касания smart-date / pf-/ ln- / scope-gate логики.

## Шаги

### 1. Канон формата (shared SOT)

`src/lib/documents/placeholderClassifier.ts` и зеркало `supabase/functions/_shared/placeholderClassifier.ts`:

- Добавить `FORMATS_PACKAGE_REQUISITE = new Set([...FORMATS_BILLING, 'full', 'short', 'signature_short', 'long'])`.
- В `classifyPlaceholder` для ветки `RE_PACKAGE_REQ` использовать `FORMATS_PACKAGE_REQUISITE` вместо `FORMATS_BILLING`.
- `FORMATS_BILLING` для `field:FLD-…` остаётся `{words, text}` — биллинг не расширяем.
- `FORMATS_LN` (для `ln-` и `pf-`) — без изменений.
- Добавить `'long'` в тип `PlaceholderFormat`.

### 2. Тесты parity и контракта

- `src/lib/documents/placeholderClassifier.test.ts`: добавить кейсы valid для
  - `package.ul.FLD-000010|format=long`
  - `package.ul.FLD-000014|format=signature_short`
  - `package.ul.FLD-000014|format=short|case=genitive`
  - `package.fl.FLD-000372|format=full`
  - и by-design invalid: `field:FLD-000001|format=long` → `invalid_modifier_value` (биллинг не расширен).
- Зеркальные кейсы в `supabase/functions/_shared/placeholderClassifier.test.ts`.
- Проверить, что существующий `placeholderClassifier.parity.test.ts` всё ещё PASS.
- Vitest по `packagePlaceholderCatalog.test.ts` уже ожидает эти токены — их не трогаем.

### 3. UI-валидатор (косвенно)

`PackageTemplateValidationPanel.tsx` уже зовёт shared `classifyPlaceholder` (Iteration 3), отдельных правок не требуется — 2 ошибки в «Приказе …» исчезают автоматически после правки канона.

### 4. Runtime UAT (deferred-блок из предыдущего отчёта закрывается здесь)

- D-Activate: открыть `/admin/documents` → «1. Приказ …» → «Проверка и исправление полей» → ошибок 0 → нажать «Активировать шаблон» → `validation_status='active'`, скрин.
- D7-200: e2e генерация DOCX по этому шаблону — HTTP 200, в итоговом DOCX `FLD-000010` подставлен как «Общество с ограниченной ответственностью», `FLD-000014` как «И.И.Иванов»; `tokens_snapshot[]` содержит записи с корректными `format`.
- D7-422: очистить required `pf-XXXXXX` поле в этом же пакете → HTTP 422 `pf_required_value_missing`, документ и snapshot не создаются.

### 5. Финализация DoD

Дописать в `.lovable/proofs/package_custom_fields_2026-06-16_iteration3_final.md` новые строки:


| #   | Item                                                                    | Status |
| --- | ----------------------------------------------------------------------- | ------ |
| 9   | package_requisite format set расширен (long/full/short/signature_short) | PASS   |
| 10  | Билинговый `field:FLD-…` НЕ принимает long/short/signature_short        | PASS   |
| 11  | D-Activate «1. Приказ …» 0 ошибок и active                              | PASS   |
| 12  | D7-200 DOCX e2e + snapshot                                              | PASS   |
| 13  | D7-422 без документа и snapshot                                         | PASS   |


Патч закрывается, только когда 9–13 = PASS.

## Что НЕ делаем

- Не расширяем `FORMATS_BILLING` для `field:FLD-…`.
- Не трогаем pf-/ln-/scope-gate, smart-date, миграции, edge config, `ai_generate_document_package`, `canonical-document-generate-strict` (резолверы уже корректно отдают long/short/signature_short).
- Не вводим per-FLD whitelist форматов — это отдельный backlog (UI каталог уже задаёт корректные модификаторы за пользователя).
- Не редактируем содержимое `.docx` шаблона пользователя.

## Технические файлы

- `src/lib/documents/placeholderClassifier.ts`
- `supabase/functions/_shared/placeholderClassifier.ts`
- `src/lib/documents/placeholderClassifier.test.ts`
- `supabase/functions/_shared/placeholderClassifier.test.ts`
- `.lovable/proofs/package_custom_fields_2026-06-16_iteration3_final.md`