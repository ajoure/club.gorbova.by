## План: финальное закрытие PATCH-PACKAGE-CUSTOM-FIELDS-V1

Закрываем три открытых пункта DoD: anti-divergence migration, runtime активацию шаблона, DOCX e2e (D7 200 + 422). Patch остаётся открытым до сбора всех proof.

---

### Шаг 1. Перевод `TemplateMarkupDialog` на shared classifier

Файл: `src/components/ai-documents/TemplateMarkupDialog.tsx`

- Удалить локальные `MOD_TAIL`, `RE_LN_ROLE` и тело `classifyTemplateToken`.
- Перевести `classifyTemplateToken(token, scope)` на обёртку поверх `classifyPlaceholder` из `src/lib/documents/placeholderClassifier.ts`:
  - вход — `{{...}}` целиком; внутри снять `{{`/`}}` и передать в shared classifier;
  - сопоставить `kind` shared classifier → существующий `TokenKind` UI (`field` / `package` / `ln` / `pf` / `legacy` / `package_in_billing` / `unknown`);
  - scope-гейт `package_in_billing` оставить локальным (он про scope, не про parse).
- Не менять контракт TokenKind и call-sites (`isMarkupValid`, рендер highlight'ов).

### Шаг 2. Перевод `PackageTemplateValidationPanel` на shared classifier

Файл: `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx`

- Удалить локальные `RX_PACKAGE_REQ`, `RX_PACKAGE_ROLE_LN`, `RX_PACKAGE_FIELD_PF`.
- Внутри функции `classify(inside, ...)` заменить regex-ветви на `classifyPlaceholder(inside)`:
  - `kind=billing_field` → существующая ветка package_req;
  - `kind=package_role` (`ln-`) → ветка ln (с сохранением логики «другой пакет» через `lnMap`/`packageTemplateId`);
  - `kind=package_field` (`pf-`) → ветка pf (с сохранением `assignedFieldSet`, `pfMap`, `packageTemplateId`);
  - `kind=legacy_role` / `kind=invalid` → текущие сообщения.
- Сохранить точные коды/тексты диагностики (UI и тесты на них не должны сломаться).
- Логику unused-assignment pass и сбор pf-токенов через `inside.match(/^pf-\d{6}/)` оставить, либо подменить на shared helper, но без поведенческих изменений.

### Шаг 3. Parity-доказательство

- Расширить `src/lib/documents/placeholderClassifier.parity.test.ts` или добавить отдельный snapshot-тест: на наборе токенов (валидные `field:`, `ln-`, `pf-`, `package.ul/ip/fl.FLD-…`, легаси, мусор, модификаторы валидные/невалидные) — результаты `classifyPlaceholder` совпадают с тем, что ожидают оба UI-валидатора.
- Прогнать `vitest` + `deno test`, зафиксировать счётчики в proof.

### Шаг 4. Runtime активация «1. Приказ о проведении годового…»

- Через `supabase--read_query` получить текущий `document_templates` (id, scope, `validation_status`, привязка к package через `document_package_template_items`) до повторной проверки.
- Открыть `/admin/documents`, повторить strict-валидацию шаблона.
- Зафиксировать в proof:
  - количество ошибок (ожидание: 0);
  - финальный `validation_status` после активации;
  - `document_template_id`, `package_template_id`, `package_id` (DB-binding идентификаторы);
  - скриншот/выдержку UI.

### Шаг 5. Runtime D7 — 200 + реальная подстановка + snapshot

- Подготовить минимальный package-шаблон с тремя токенами: `{{pf-XXXXXX}}`, `{{pf-XXXXXX|format=full}}`, и одним соседним `{{ln-XXXXXX}}` (для регрессии).
- Запустить `canonical-document-generate-strict` через `supabase--curl_edge_functions` от реальной сессии пакета, в которой pf-значение заполнено.
- Скачать DOCX → распаковать (`extract_document.py`) → подтвердить:
  - HTTP 200;
  - подстановка `{{pf-XXXXXX}}` соответствует raw value;
  - модификатор `|format=full` применён (rendered ≠ raw там, где это ожидается);
  - в `ai_generated_documents.meta.tokens_snapshot[]` появилась запись `provider='pf'` с `public_id`, `label`, `data_type`, `raw_value`, `rendered_value`, `default_kind_applied`, дедуп по `pf-XXXXXX` соблюдён;
  - `ln-`/`FLD-` записи не затронуты (add-only).

### Шаг 6. Runtime D7 — 422 pf_required_value_missing

- На той же конфигурации очистить обязательное pf-значение и повторить запрос.
- Зафиксировать:
  - HTTP 422, body `code = pf_required_value_missing`, перечислены все недостающие `pf-XXXXXX`;
  - запись в `ai_generated_documents` НЕ создана (`select count(*)` до/после);
  - `tokens_snapshot[]` не дополнен фиктивными pf-элементами;
  - аудит содержит запись об ошибке (если предусмотрено существующим pipeline — не добавляем новый audit).

### Шаг 7. Финальная таблица DoD и закрытие proof

Дополнить `.lovable/proofs/package_custom_fields_2026-06-16_iteration2.md` (или создать `_final.md`) разделом «Final DoD» с колонками: пункт / статус (PASS/FAIL/deferred) / proof-ссылка. Таблица должна закрыть:

| # | Пункт | Ожидание |
|---|---|---|
| 1 | Shared classifier — единственная точка parse pf/ln/field/package | Шаги 1–3 |
| 2 | TemplateMarkupDialog без локальных regex | Шаг 1 + parity |
| 3 | PackageTemplateValidationPanel без локальных regex | Шаг 2 + parity |
| 4 | Vitest + Deno полностью зелёные | Шаг 3 |
| 5 | Runtime активация «1. Приказ…» — 0 ошибок | Шаг 4 |
| 6 | DOCX e2e 200 + замена + modifier + snapshot add-only | Шаг 5 |
| 7 | DOCX e2e 422 без документа и без snapshot | Шаг 6 |
| 8 | `ln-` / `FLD-` / billing context — без регрессий | Шаги 3, 5 |

Patch закрывается только когда все 8 строк = PASS.

---

### Что НЕ делается в этом проходе

- Никаких новых SmartDateKind, новых полей в snapshot, новых audit-каналов.
- `canonical-document-generate-strict`, `ai-generate-document-package`, миграции и edge-конфиг — без изменений (B5 уже зафиксирован).
- `placeholderClassifier.ts` (frontend и `_shared`) не меняется по контракту; правки допустимы только если parity-тест выявит реальный гэп — тогда отдельным mini-шагом перед Шагом 3.

### Риски

- Различия в текстах ошибок UI после миграции на shared classifier — закрываем mapping-слоем в обоих компонентах, без изменения сообщений.
- Runtime D7 может потребовать дозаполнения пакета (минимум одного `session_participant` и одного pf-значения) — выполняется через существующий UI или прямые `insert` в подготовительной фазе шага 5; не считается изменением кода.
