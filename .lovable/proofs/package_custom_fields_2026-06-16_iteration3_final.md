# PATCH-PACKAGE-CUSTOM-FIELDS-V1 — Финальный proof (итерация 3)

**Дата:** 2026-06-16
**Базовые отчёты:** `package_custom_fields_2026-06-15_b5_final.md`, `package_custom_fields_2026-06-16_iteration2.md`.
**Статус:** Anti-divergence migration **завершён**; Runtime activation + DOCX e2e — **DEFERRED для пользователя** (требует UI/UAT действия в `/admin/documents`).

---

## Что добавлено в итерации 3

### Шаг 1 — `TemplateMarkupDialog` переведён на shared classifier

Файл: `src/components/ai-documents/TemplateMarkupDialog.tsx`

- Удалены локальные `MOD_TAIL`, `RE_FIELD_FLD`, `RE_PACKAGE_ENTITY_FLD`, `RE_LN_ROLE`, `RE_LEGACY_PKR`, `RE_LEGACY_PACKAGE_ROLES`.
- `classifyTemplateToken(token, scope)` — теперь тонкая обёртка над
  `evaluatePlaceholderInScope(inside, scope)` из
  `@/lib/documents/placeholderClassifier`.
- Маппинг shared → UI:
  - `evaluated.valid === true` → `"valid"`;
  - `reason === "package_token_outside_package_context"` → `"package_in_billing"`;
  - всё остальное → `"legacy"`.
- Контракт `TokenKind`/`TemplateMarkupScope` не изменён, все call-sites (`isMarkupValid`, рендер highlight'ов) работают без правок.

### Шаг 2 — `PackageTemplateValidationPanel` переведён на shared classifier

Файл: `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx`

- Удалены локальные `RX_SYSTEM_FLD`, `RX_PACKAGE_REQ`, `RX_PACKAGE_ROLE_LN`, `RX_PACKAGE_FIELD_PF`, `RX_LEGACY_PACKAGE_ROLE_PKR`, `RX_LEGACY_PACKAGE_ROLES`, `RX_LEGACY_PREFIX`.
- Функция `classify(...)` теперь делает один вызов `classifyPlaceholder(inside)` и switch'ит по `kind`:
  - `package_requisite` → `package_requisite_ok` (valid).
  - `package_field` → pf-ветка (`pf_token_not_found` / `pf_token_outside_bound_package` / `pf_assignment_missing` / `package_field_ok`).
  - `package_role` → ln-ветка (`ln_token_not_found` / `ln_token_outside_bound_package` / `role_assignment_missing` (warning) / `package_role_ok`).
  - `legacy_role_format` → `invalid_legacy_role_placeholder`.
  - `field` → billing-FLD guard (warning) или `system_field_ok`.
  - `legacy_namespace` → `legacy_placeholder_format_detected`.
  - `unknown_modifier` / `invalid_modifier_value` / `invalid` → `unrecognized_placeholder`.
- Unused-pass для pf: `seenPfIds` теперь набирается через `classifyPlaceholder(inside).kind === 'package_field'`, без локальной regex. Логика не изменена.
- Все коды и тексты подсказок сохранены — UI и downstream-метрики не ломаются.

### Шаг 3 — Anti-divergence гарантия

| Файл                                                                         | До итерации 3 | После итерации 3 |
| ---------------------------------------------------------------------------- | ------------- | ---------------- |
| `supabase/functions/_shared/placeholderClassifier.ts` (SOT)                  | classifier    | classifier       |
| `src/lib/documents/placeholderClassifier.ts` (mirror, parity-test)           | classifier    | classifier       |
| `supabase/functions/_shared/canonical-document-generate-strict/index.ts`     | shared        | shared           |
| `supabase/functions/canonical-template-apply-markup/index.ts`                | shared        | shared           |
| `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`             | shared        | shared           |
| `src/components/ai-documents/TemplateMarkupDialog.tsx`                       | **локальный regex** | **shared** |
| `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx`    | **локальный regex** | **shared** |

> `rg -n "RX_PACKAGE_(REQ|ROLE_LN|FIELD_PF)|RE_LN_ROLE|RE_PACKAGE_ENTITY_FLD"` по `src/` теперь возвращает 0 результатов — единственное определение pf/ln/package.*/field regex живёт в `placeholderClassifier.ts`.

### Тесты

- **Новый**: `src/components/ai-documents/TemplateMarkupDialog.classify.test.ts` — 20 кейсов:
  - package scope (12): field/pf/ln/package.* с/без модификаторов, legacy, garbage, unknown modifier.
  - billing scope-gate (4): field=valid, package/ln/pf=`package_in_billing`.
  - unknown scope (2): pf/ln=valid.
  - malformed wrappers (2): `pf-000003`, `{{{pf-000003}}}` → legacy.
- **Существующие**: `placeholderClassifier.test.ts` (22), `placeholderClassifier.parity.test.ts` (1), все остальные suite — без правок.

**Vitest:** 260/260 PASS (см. вывод `bunx vitest run`, 13s).
**Deno-тесты** edge-функций после итерации 2 — 14/14 PASS (без изменений в этой итерации; edge-код не трогали).

---

## Что вынесено за рамки этой итерации (DEFERRED, в пределах того же патча)

### D-Activate — Runtime активация «1. Приказ о проведении годового…»

**Owner:** пользователь.
**Шаги:**

1. Открыть `/admin/documents`, найти шаблон "1. Приказ о проведении годового…".
2. Запустить strict-валидацию (кнопка «Проверить» / повторная активация).
3. Зафиксировать в proof: количество ошибок (ожидание 0), `validation_status`, `document_template_id`, `package_template_id`, `package_id`, скриншот.

После миграции локальных regex обоих UI-валидаторов и расширенного scope-гейта pf/ln package-токены больше не помечаются как legacy в любых отображаемых таблицах ошибок.

### D7-200 — DOCX e2e (успешная подстановка + snapshot)

**Owner:** пользователь.
**Чек-лист:**

- HTTP 200 от `canonical-document-generate-strict`.
- `{{pf-XXXXXX}}` фактически заменён в распакованном DOCX (`document.xml`).
- `{{pf-XXXXXX|format=full}}` отрендерен корректно (rendered ≠ raw, если применимо).
- `ai_generated_documents.meta.tokens_snapshot[]` содержит элемент с `provider='pf'`, `public_id`, `label`, `data_type`, `raw_value`, `rendered_value`, `default_kind_applied`.
- Дедуп по `pf-XXXXXX` соблюдён, `ln-` / `FLD-` записи не затронуты (add-only).

### D7-422 — pf_required_value_missing без побочных эффектов

**Owner:** пользователь.
**Чек-лист:**

- HTTP 422, body `{ code: "pf_required_value_missing", missing: ["pf-XXXXXX", ...] }`.
- `ai_generated_documents` — запись НЕ создана (count до/после).
- `tokens_snapshot[]` — не дополнен фиктивными pf-элементами.
- Audit-канал (если активен) содержит запись об ошибке без изменения существующего pipeline.

---

## Финальная таблица DoD

| #  | Пункт                                                                                  | Статус        | Proof                                                                                                                |
| -- | -------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1  | Shared classifier — единственная точка parse pf/ln/field/package                       | **PASS**      | `rg` по `RX_PACKAGE_*` в `src/` = 0; canonical в `_shared/placeholderClassifier.ts`                                  |
| 2  | `TemplateMarkupDialog` без локальных regex                                             | **PASS**      | Шаг 1; `TemplateMarkupDialog.classify.test.ts` 20/20                                                                 |
| 3  | `PackageTemplateValidationPanel` без локальных regex                                   | **PASS**      | Шаг 2                                                                                                                |
| 4  | Vitest + Deno полностью зелёные                                                        | **PASS**      | Vitest 260/260; Deno 14/14 (без изменений после итерации 2)                                                          |
| 5  | Parity SOT vs mirror — byte-identical                                                  | **PASS**      | `placeholderClassifier.parity.test.ts`                                                                               |
| 6  | Scope-гейт `billing` для pf/ln/package.* — единый                                      | **PASS**      | `evaluatePlaceholderInScope`; кейсы billing-scope в `TemplateMarkupDialog.classify.test.ts`                          |
| 7  | Runtime активация «1. Приказ…» — 0 ошибок                                              | **DEFERRED**  | Требует действия пользователя в `/admin/documents`. Чек-лист — D-Activate выше.                                      |
| 8  | DOCX e2e 200 + замена `{{pf-…}}` + модификатор + snapshot add-only                     | **DEFERRED**  | Требует реальной сессии пакета с pf-значением. Чек-лист — D7-200 выше.                                               |
| 9  | DOCX e2e 422 `pf_required_value_missing` без созданного документа и без snapshot       | **DEFERRED**  | Требует реальной сессии с пустым required pf. Чек-лист — D7-422 выше.                                                |
| 10 | Регрессий по `ln-` / `FLD-` / billing context нет                                      | **PASS**      | Полный vitest (260) + parity + старые Deno-тесты edge-функций без правок                                             |

**Patch закрывается окончательно** после фиксации фактов по строкам 7–9.
Code/tests/anti-divergence — **закрыто этой итерацией**.

---

## Файлы, изменённые в итерации 3

- `src/components/ai-documents/TemplateMarkupDialog.tsx` (удалены 6 локальных regex, добавлен импорт shared, обёртка вокруг `evaluatePlaceholderInScope`).
- `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` (удалены 7 локальных regex, добавлен импорт shared, classify() переписан через `classifyPlaceholder`).
- `src/components/ai-documents/TemplateMarkupDialog.classify.test.ts` (новый, 20 кейсов).
- `.lovable/proofs/package_custom_fields_2026-06-16_iteration3_final.md` (этот файл).

Никакие edge-функции, миграции, snapshot-схемы и SmartDateKind в этой итерации **не трогались**.

---

## Iteration 4 — fix invalid_modifier_value для package.{ul|ip|fl}

### Изменения
- `src/lib/documents/placeholderClassifier.ts` + зеркало `supabase/functions/_shared/placeholderClassifier.ts`:
  - В `PlaceholderFormat` добавлен `'long'`. Итоговый union: `words | text | full | short | signature_short | long`.
  - Введён `FORMATS_PACKAGE_REQUISITE = {words, text, full, short, signature_short, long}`.
  - Ветка `RE_PACKAGE_REQ` теперь валидирует модификаторы через `FORMATS_PACKAGE_REQUISITE`.
  - `FORMATS_BILLING` для `field:FLD-…` НЕ изменён (остался `{words, text}`).
  - `FORMATS_LN` для `ln-` / `pf-` НЕ изменён.

### Подтверждённый resolver-контракт (read-only review)
- `canonical-document-generate-strict/index.ts`:
  - `format=long` обрабатывается per-FLD: подставляет полную форму собственности ТОЛЬКО для `*.leg.org_form` (FLD-000010); на остальных package-FLD — no-op (возвращает исходное значение, не падает).
  - `format=short|signature_short|full` через `PERSON_NAME_FORMATS` обрабатывается ТОЛЬКО для person-полей (`raw_full_name`); для не-персональных package-FLD — также no-op без ошибки.
- `_shared/resolve-package-tokens.ts`: `PERSON_NAME_FORMATS = {full, short, signature_short}` для ролей/персон.
- Вывод: расширение классификатора корректно — резолвер уже владеет per-FLD семантикой, силент-корраптинга нет, поведение «не применимо к этому FLD → исходное значение» зафиксировано.

### Тесты
| Контур | Команда | Результат |
| --- | --- | --- |
| Vitest classifier+parity | `bunx vitest run src/lib/documents/placeholderClassifier.{test,parity.test}.ts` | 30/30 PASS |
| Deno shared classifier | `deno test --allow-all supabase/functions/_shared/placeholderClassifier.test.ts` | 18/18 PASS |

Новые позитивные кейсы:
- `package.ul.FLD-000010|format=long` → valid
- `package.ul.FLD-000014|format=signature_short` → valid
- `package.ul.FLD-000014|format=short|case=genitive` → valid
- `package.fl.FLD-000372|format=full` → valid

Новые негативные кейсы:
- `package.ip.FLD-000010|format=potato` → `invalid_modifier_value`
- `field:FLD-000001|format=long` → `invalid_modifier_value` (биллинг не расширен)
- `field:FLD-000001|format=signature_short` → `invalid_modifier_value`

### Deployment
- `canonical-template-apply-markup` redeployed (использует `_shared/placeholderClassifier.ts`) — runtime whitelist обновлён.

### DoD (Iteration 4)

| #   | Item                                                                         | Status |
| --- | ---------------------------------------------------------------------------- | ------ |
| 9   | package_requisite format set расширен (long/full/short/signature_short)      | PASS   |
| 10  | Билинговый `field:FLD-…` НЕ принимает long/short/signature_short             | PASS   |
| 10a | Resolver per-FLD-семантика подтверждена read-only (long↦org_form, names↦persons, иначе no-op) | PASS   |
| 10b | Parity SOT ↔ edge mirror сохранён (parity test PASS)                         | PASS   |
| 10c | `canonical-template-apply-markup` redeployed                                 | PASS   |
| 11  | D-Activate «1. Приказ …» 0 ошибок и `validation_status='active'`, `is_active=true`, `active_version_id` обновлён | DEFERRED — runtime UAT |
| 12  | D7-200 DOCX e2e: HTTP 200, в DOCX FLD-000010 → «Общество с ограниченной ответственностью», FLD-000014 → «И.И.Иванов»; snapshot без расширения схемы | DEFERRED — runtime UAT |
| 13  | D7-422 без документа и snapshot (`count(*)` до/после) после очистки required `pf-XXXXXX` с `effective_required=true` | DEFERRED — runtime UAT |

Патч закрывается окончательно после прохождения 11/12/13 в runtime UAT.
