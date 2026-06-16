# PATCH-PACKAGE-CUSTOM-FIELDS-V1 — Итерация 2 proof

**Дата:** 2026-06-16
**Статус:** Core code-complete. Runtime UAT (D1–D8) — в работе пользователя.

## Сделано

### Часть A — Канонизация `{{pf-XXXXXX}}` через shared classifier

**Создан единый источник истины классификации плейсхолдеров:**

- `supabase/functions/_shared/placeholderClassifier.ts` — canonical (Deno + browser portable, pure).
- `src/lib/documents/placeholderClassifier.ts` — frontend mirror (byte-identical).
- `src/lib/documents/placeholderClassifier.parity.test.ts` — parity-check: упадёт при любом расхождении.

API:

```ts
classifyPlaceholder(inside): PlaceholderClassification
evaluatePlaceholderInScope(inside, scope: 'billing' | 'package' | 'unknown')
extractPackageFieldTokens(text): string[]
```

**Виды токенов:**

| Kind                  | Синтаксис                              | Допустимые scope            |
| --------------------- | -------------------------------------- | --------------------------- |
| `field`               | `field:FLD-XXXXXX[\|...]`              | billing / package / unknown |
| `package_field`       | `pf-XXXXXX[\|...]`                     | package / unknown           |
| `package_role`        | `ln-XXXXXX[\|...]`                     | package / unknown           |
| `package_requisite`   | `package.<ul\|ip\|fl>.FLD-XXXXXX[\|…]` | package / unknown           |
| `legacy_role_format`  | `package.role.PKR-*` / `package.roles.*` | всегда invalid            |
| `legacy_namespace`    | `document.*` / `executor.*` / …        | всегда invalid              |

**Модификаторы (строгий парсинг):**

- `format=words|text` — для field / pf / package.*.
- `format=full|short|signature_short` — для ln.
- `case=nominative|genitive|dative|accusative|instrumental|prepositional`.
- Любой другой ключ → `unknown_modifier`.
- Известный ключ с недопустимым значением → `invalid_modifier_value`.
- Никаких permissive `(\|[^}]+)?` — старый поведение полностью устранено.

**Scope-гейт (синтаксический):**

- `billing`: только `field` валиден. Любой package/ln/pf → `reason: 'package_token_outside_package_context'`.
- `package`: все 4 канонических вида.
- `unknown`: все 4 канонических вида (фактический binding-гейт выполняется выше).

### Часть A3 — точки потребления

| Файл                                                                  | Что сделано                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`      | удалены локальные RX_PACKAGE_*, `strictValidate` использует `evaluatePlaceholderInScope('unknown')`. Новые коды ошибок: `pf_unsupported_modifier`, `invalid_modifier_value`, `package_token_outside_package_context`. |
| `supabase/functions/canonical-template-apply-markup/index.ts`         | удалены локальные RX_PACKAGE_*. Манифест дополнен полями `public_id`, `format`, `case_modifier` для package-aware токенов; `package_token_kind: 'package_field'` для pf. |
| `src/components/ai-documents/packages/PackageTemplateValidationPanel.tsx` | **не тронут в этой итерации** — у него собственная контекст-aware логика (DB lookup catalog) и он уже правильно работает с pf-. Перевод на shared classifier — отложен (нерискованный refactor). |
| `src/components/ai-documents/TemplateMarkupDialog.tsx`                | **не тронут в этой итерации** — он используется только для chip-рендера и не блокирует активацию. Перевод на shared — отложен. |

### Часть A4 — manifest сохраняет pf-токены

В `template_versions.token_manifest` для каждого pf-токена:

```json
{
  "field_public_id": null,
  "placeholder": "{{pf-000003}}",
  "is_package_token": true,
  "package_token_kind": "package_field",
  "public_id": "pf-000003",
  "format": null,
  "case_modifier": null
}
```

### Часть A5 — контекст-гейт активации

В `canonical-template-apply-markup` после классификации:

1. Если в шаблоне есть хотя бы один pf-* токен, выполняется SELECT по `document_package_template_items WHERE template_id = srcVer.template_id`.
2. Если binding отсутствует → каждый pf-* получает `validation_error.code = 'package_token_outside_package_context'`.
3. `validation_status` становится `'invalid'`, что в свою очередь блокирует `canonical-template-activate-version` (он требует `validation_status = 'valid'`).

`document_package_template_items` — это реальная FK-связь `template_id ↔ package_template_id`. Никаких `meta.package_bound=true` bypass'ов.

### Часть B — 11 новых SmartDateKind

**Сводка:** 4 month + 4 quarter + 3 year = **11** новых значений.

| Период    | Kinds                                                                                  |
| --------- | -------------------------------------------------------------------------------------- |
| Месяц     | `first_day_of_prev_month`, `last_day_of_prev_month`, `first_day_of_next_month`, `last_day_of_next_month` |
| Квартал   | `first_day_of_prev_quarter`, `last_day_of_prev_quarter`, `first_day_of_next_quarter`, `last_day_of_next_quarter` |
| Год       | `prev_year`, `current_year`, `next_year` (4-значное число строкой)                     |

**Текущие** месяц/квартал/год покрыты уже существующими `first_day_of_month` / `last_day_of_month` / `first_day_of_quarter` / `last_day_of_quarter` / `first_day_of_year` / `last_day_of_year`.

#### Безопасные конструкторы (без `addMonths`)

Все anchor-даты строятся через `new Date(Y, M ± n, day)`:

- `first_day_of_prev_month = new Date(Y, M - 1, 1)`
- `last_day_of_prev_month  = new Date(Y, M, 0)`
- `first_day_of_next_quarter = new Date(Y, Q + 3, 1)` где `Q = Math.floor(M / 3) * 3`
- и т.д.

Конструктор автоматически нормализует переходы Q1→Q4 предыдущего года, Q4→Q1 следующего, январь↔декабрь, високосный февраль, конец месяца 29/30/31. Проверено unit-тестами.

#### Datetime контракт

- start anchor → `YYYY-MM-DDT00:00:00.000`
- end anchor   → `YYYY-MM-DDT23:59:59.999`
- timezone     → Europe/Minsk (соответствует существующему UI prefill контракту)
- формат       → локальная строка без суффикса timezone (совместимо с существующим session_field_value)

#### UI-фильтр и авто-сброс

В `PackageFieldsManager.tsx`:

- `allowedSmartDateKindsForType(type)` — жёсткий список разрешённых kind'ов:
  - `year` → `['none','prev_year','current_year','next_year']`
  - `date | datetime` → date/week/month/quarter/year-anchors **без** year-shift
  - все остальные типы → `[]` (селект скрыт)
- При смене типа (до сохранения) `defaultKind` авто-сбрасывается в `'none'`, если несовместим.

### Backend smart-date контракт

Аудит подтвердил: backend (`canonical-document-generate-strict`, `ai-generate-document-package`) читает `options.default_kind` **только** как строку для записи в `tokens_snapshot[].default_kind_applied`. Никакого пересчёта kind'ов нет. Новые 11 kinds совместимы как строки сразу, без изменений в edge-функциях.

## Тесты

**Vitest (frontend):** 45 passed / 45 total

- `src/lib/documents/placeholderClassifier.test.ts` — 22 теста (classify + scope + extract).
- `src/lib/documents/placeholderClassifier.parity.test.ts` — 1 тест (byte-identity zeroes & ones).
- `src/lib/packageFields/smartDate.test.ts` — 22 теста (включая граничные кейсы: январь→дек, декабрь→янв, Q1↔Q4, високосный 29.02.2024, конец месяца 31.01.2025, новогодние сдвиги для prev/next_year, datetime 00:00 / 23:59:59.999).

**Deno (edge):** 14 passed / 14 total (включая 6 для нового classifier).

**Ранее зелёные:** 15/15 (`pf-required-gate`, `resolve-package-tokens.pf`, `resolve-package-tokens.smoke`) — не тронуты.

## Deploy

- `canonical-template-apply-markup` — задеплоен в превью.

## DoD (итерация 2)

| #   | Проверка                                                                                 | Статус                                                  |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Shared classifier создан, парность фронт↔edge проверяется тестом                          | ✅ PASS                                                 |
| 2   | `pf-XXXXXX` — `valid` синтаксис в strict-валидаторе                                       | ✅ PASS (unit + Deno)                                   |
| 3   | `pf-XXXXXX\|unknown=x` → `pf_unsupported_modifier`; `\|format=potato` → `invalid_modifier_value` | ✅ PASS (raw в classifier; маппинг в UI коде)         |
| 4   | Edge сохраняет pf в `manifest.tokens[]` с `kind:'package_field'`                          | ✅ DEPLOYED                                             |
| 5   | `package_token_outside_package_context` блокирует pf в не-package-bound шаблоне           | ✅ DEPLOYED (проверка `document_package_template_items`)|
| 6   | 11 новых SmartDateKind (4+4+3), 0 дублей с существующими                                  | ✅ PASS                                                 |
| 7   | Date constructors без `addMonths`, все граничные кейсы                                    | ✅ PASS (vitest)                                        |
| 8   | datetime: start=00:00, end=23:59:59.999, Europe/Minsk                                      | ✅ PASS (vitest)                                        |
| 9   | UI-фильтр жёсткий по data_type + авто-сброс при смене типа                                 | ✅ PASS (manual code review + B4 hook tested)           |
| 10  | Backend никогда не вычисляет новые kinds                                                   | ✅ PASS (read-only по grep)                             |
| 11  | 15 ранее существующих Deno-тестов всё ещё PASS                                             | ✅ PASS                                                 |
| 12  | TemplateMarkupDialog + PackageTemplateValidationPanel перевод на shared                    | ⏸ DEFERRED (нерискованный refactor, не блокирует user) |
| 13  | DOCX e2e (D7: A=200, B=422) на реальном `{{pf-000002}}`                                    | ⏸ DEFERRED → runtime UAT                                |
| 14  | Реальные audit_logs строки в proof                                                         | ⏸ DEFERRED → runtime UAT                                |

## Что осталось пользователю (Runtime UAT)

1. Открыть `/admin/documents → Шаблоны документов → «1. Приказ…»` и убедиться что валидация теперь возвращает 0 ошибок (pf-* распознаются).
2. Активировать шаблон (он привязан к пакету через `document_package_template_items`).
3. Открыть `Пакеты документов → Поля пакета → Добавить поле`, выбрать тип «Год» — увидеть в «Значение по умолчанию» 3 новых опции (Прошлый/Текущий/Будущий год).
4. То же для типа «Дата» — увидеть 8 новых опций (4 месяц + 4 квартал).
5. Создать тестовое поле с default = `next_year`, открыть анкету — ожидается автозаполнение `2027`.

## Технические заметки

- `parseStrictToken` в `canonical-template-apply-markup` остался как dead-code (используется только внутри удалённого блока, но не вызывается). Можно подчистить в следующей итерации.
- `ALLOWED_FORMATS`/`ALLOWED_CASES` в том же файле используются на client-input sanitize (replacements pre-processing) — не удаляем.
- `pf_unsupported_modifier` экспонируется в UI как маппинг поверх `unknown_modifier` / `invalid_modifier_value` (когда токен начинается с `pf-`). Внутри classifier остаются точные коды.
