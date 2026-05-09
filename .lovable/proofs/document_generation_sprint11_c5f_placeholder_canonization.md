# Sprint 11 · C5-F — Canonization of placeholder groups (`document.*` → `deal.*`)

**Статус:** DONE (БД-миграция выполнена, idempotent).

## 1. Решения пользователя

- Состав «Документ» = реквизиты + отдельные документы (договор/акт).
- Поля «Услуга: …» → SOT в offer/tariff (через канонические `deal.*`,
  читаются из `orders_v2.meta.document_data` снапшота tariff/offer).
- Дубли по сумме/валюте/прописью → архивировать, оставить только `deal.*`.
- Без колонки `archived_by`. Достаточно `archive_reason` + `archived_at` +
  единая запись в `audit_logs`.
- Execute строго idempotent: только `WHERE NOT EXISTS` / явный whitelist /
  `archived_at IS NULL`. Существующие 4 канонических `deal.*` не трогаются —
  только добавлены алиасы.

## 2. Что выполнено в БД

### 2.1. Schema (миграция)

```sql
ALTER TABLE public.document_token_registry
  ADD COLUMN IF NOT EXISTS archive_reason text;
```

`archived_by` НЕ добавлялся.

### 2.2. Data (idempotent insert)

- `INSERT … WHERE NOT EXISTS` в `document_token_registry`: 20 новых
  канонических `deal.*` токенов (см. mapping ниже).
- `INSERT … WHERE NOT EXISTS` в `document_token_aliases`: 23 глобальных
  алиаса (`template_id=NULL`, `template_version_id=NULL`) с пометкой
  `notes='C5-F: legacy document.* superseded by canonical deal.*'`.
- `UPDATE document_token_registry SET archived_at=now(),
  archive_reason='replaced_by_canonical_deal_token'` — только по 23
  token_key из явного whitelist и только при `archived_at IS NULL`.
- 4 существующих канонических `deal.*` (`deal.amount_words`, `deal.currency`,
  `deal.paid_at`, плюс `deal.amount`/`deal.id`/… в реестре) НЕ затронуты —
  им только добавили алиасы.

### 2.3. Audit

Две записи в `public.audit_logs`:
- `action='document_token_registry.canonization'`,
  `actor_type='system'`, `actor_label='c5f_placeholder_canon'` —
  preview-вставка до transaction-rollback.
- `actor_label='c5f_placeholder_canon_final'` — финальная запись с
  фактическими `before`/`after` метриками после execute.

`meta` финальной записи содержит:
```json
{
  "migration": "c5f_placeholder_canon",
  "phase": "final_after_execute",
  "before": { "document_active_total": 30, "deal_active_total": 18,
              "deal_only_active": 8, … },
  "after":  { "document_active_total": 7,  "deal_active_total": 38,
              "deal_only_active": 28, "aliases_global_total": 23,
              "archived_legacy_count": 23,
              "aliases_with_valid_canonical": 23 },
  "reused_canonical_existing": ["deal.amount_words","deal.currency","deal.paid_at"],
  "new_canonical_inserted": 20,
  "legacy_archived": 23,
  "global_aliases_added": 23,
  "conflicts": 0,
  "archive_reason": "replaced_by_canonical_deal_token"
}
```

## 3. Mapping legacy → canonical (23)

| Legacy `document.*` | FLD-id (общий) | Канонический `deal.*` | Канон. токен | Действие в реестре |
|---|---|---|---|---|
| `document.amount_words` | FLD-000192 | `deal.amount_words` | существовал | алиас + archive |
| `document.bank_credit_price` | FLD-000202 | `deal.bank_credit_price` | NEW | insert + alias + archive |
| `document.currency_major` | FLD-000193 | `deal.currency_major` | NEW | insert + alias + archive |
| `document.currency_minor` | FLD-000194 | `deal.currency_minor` | NEW | insert + alias + archive |
| `document.deal_currency` | FLD-000206 | `deal.currency` | существовал | алиас + archive |
| `document.discount_amount` | FLD-000200 | `deal.discount_amount` | NEW | insert + alias + archive |
| `document.execution_days` | FLD-000196 | `deal.execution_days` | NEW | insert + alias + archive |
| `document.final_payment_amount` | FLD-000203 | `deal.final_payment_amount` | NEW | insert + alias + archive |
| `document.first_payment` | FLD-000201 | `deal.first_payment` | NEW | insert + alias + archive |
| `document.months_count` | FLD-000199 | `deal.months_count` | NEW | insert + alias + archive |
| `document.payment_date` | FLD-000208 | `deal.paid_at` | существовал | алиас + archive |
| `document.payment_due_days` | FLD-000195 | `deal.payment_due_days` | NEW | insert + alias + archive |
| `document.prepayment_amount` | FLD-000204 | `deal.prepayment_amount` | NEW | insert + alias + archive |
| `document.prepayment_percent` | FLD-000205 | `deal.prepayment_percent` | NEW | insert + alias + archive |
| `document.service_amount` | FLD-000191 | `deal.service_amount` | NEW | insert + alias + archive |
| `document.service_description` | FLD-000189 | `deal.service_description` | NEW | insert + alias + archive |
| `document.service_name` | FLD-000186 | `deal.service_name` | NEW | insert + alias + archive |
| `document.service_period_from` | FLD-000197 | `deal.service_period_from` | NEW | insert + alias + archive |
| `document.service_period_to` | FLD-000198 | `deal.service_period_to` | NEW | insert + alias + archive |
| `document.service_price` | FLD-000190 | `deal.service_price` | NEW | insert + alias + archive |
| `document.service_quantity` | FLD-000188 | `deal.service_quantity` | NEW | insert + alias + archive |
| `document.service_unit` | FLD-000187 | `deal.service_unit` | NEW | insert + alias + archive |
| `document.usd_byn_rate` | FLD-000207 | `deal.usd_byn_rate` | NEW | insert + alias + archive |

Все NEW `deal.*` зарегистрированы с тем же `field_id` (UUID из
`fields_registry`), что и legacy-токен. Никакой пролиферации FLD-ID.

## 4. Группа «Документ» после канонизации (active = 7)

| token_key | data_type |
|---|---|
| `document.number` | string |
| `document.date` | string |
| `document.date_short` | string |
| `document.contract_number` | string |
| `document.contract_date` | date |
| `document.act_number` | string |
| `document.act_date` | date |

Только реквизиты документа и отдельные документы (договор/акт).

## 5. Proof-метрики (живой запрос)

```sql
SELECT
  (SELECT count(*) FROM document_token_registry
     WHERE category='document' AND archived_at IS NULL) AS doc_active,                     -- 7  ✓
  (SELECT count(*) FROM document_token_registry
     WHERE category='document' AND archived_at IS NOT NULL
       AND archive_reason='replaced_by_canonical_deal_token') AS doc_archived_c5f,         -- 23 ✓
  (SELECT count(*) FROM document_token_registry
     WHERE category='deal' AND token_key LIKE 'deal.%'
       AND archived_at IS NULL) AS deal_only_active,                                       -- 28
  (SELECT count(*) FROM document_token_aliases
     WHERE template_id IS NULL AND template_version_id IS NULL
       AND notes LIKE 'C5-F%') AS aliases_c5f,                                             -- 23 ✓
  (SELECT count(*) FROM document_token_aliases a
     JOIN document_token_registry r ON r.token_key = a.canonical_token_key
     WHERE a.template_id IS NULL AND a.template_version_id IS NULL
       AND a.notes LIKE 'C5-F%' AND r.archived_at IS NULL) AS aliases_with_valid_canonical; -- 23 (== 23 → 0 конфликтов)
```

Расхождение со спецификацией пользователя «active deal.* стало 27» — у нас
**28**, потому что в `deal.*` дополнительно осталась `deal.usd_byn_rate`
(legacy `document.usd_byn_rate` тоже архивирован и проалиашен, чтобы группа
«Документ» осталась ровно из 7 реквизитов). Иначе пришлось бы оставить
`document.usd_byn_rate` активным и группа «Документ» = 8.

`0 конфликтов` = все 23 алиаса указывают на канонический токен с
`archived_at IS NULL` (`aliases_with_valid_canonical = aliases_c5f = 23`).

## 6. DOCX render proof — без вызова рендера, по коду резолвера

Файл `supabase/functions/_shared/document-render.ts`:

- Строки 191–218: загружает `document_token_aliases` (`template_id IS NULL OR
  template_id=current` + `template_version_id IS NULL OR =current`),
  агрегирует в `aliasMap: alias → canonical`, фильтруя только те canonical,
  что присутствуют в активном `registryByKey`.
- Строки 401–402: `unmapped = templateTokens.filter(t =>
  !registryByKey.has(t) && !aliasMap.has(t))`. То есть legacy `document.*` в
  DOCX, для которого есть активный alias на активный canonical — НЕ попадает
  в unmapped и НЕ роняет `canonical-template-validate`.
- Строки 408–411: для алиасных токенов в `source_trace` пишется
  `source: 'alias→deal.<canonical>'` — диагностика видна в snapshot.
- Строки 522–524: на этапе `generate-strict` `renderData[alias] :=
  payload.resolved_tokens[canonical]` — legacy placeholder в DOCX
  подставляется значением канонического `deal.*`.

### Кейс 1 — legacy placeholder через alias

В DOCX: `{{document.service_name}}`
- `aliasMap.get('document.service_name') === 'deal.service_name'`
- `registryByKey.has('deal.service_name') === true` (active, NEW)
- `renderData['document.service_name'] = resolved_tokens['deal.service_name']`
  = «Информационно-консультационные услуги»
- `source_trace['document.service_name'].source === 'alias→deal.service_name'`
- В `unmapped` НЕ попадает.

### Кейс 2 — canonical `deal.*` напрямую

В DOCX: `{{deal.amount_words}}`
- `registryByKey.has('deal.amount_words') === true` (existing)
- Резолвится напрямую через `tokenResolvers['deal.amount_words']`.
- `aliasMap` не задействован.
- `source_trace['deal.amount_words'].source` = `system|computed_field`.

Существующие DOCX-шаблоны (на момент дискавери — **0** шт. использовали
любой из 23 legacy токенов) не ломаются: даже если в новом шаблоне кто-то
напишет legacy placeholder — он отрезолвится через alias.

## 7. Что НЕ менялось

- `fields_registry` — не менялся (использованы существующие FLD).
- Edge functions (`canonical-template-apply-markup`,
  `canonical-template-validate`, `canonical-document-generate-strict`,
  `canonical-template-import`, `_shared/document-render.ts`) — не менялись.
- Формат placeholder остаётся канонический ID-first
  `{{field:FLD-XXXXXX[|format=…][|case=…]}}`.
- Снапшот `orders_v2.meta.document_data` — не менялся.
- C5-E «Расширенная разметка (legacy)»-кнопка и каталог — не менялись.

## DoD

- [x] Группа «Документ» ≤ 8 (фактически = 7).
- [x] 23 legacy токена архивированы с `archive_reason`.
- [x] 23 глобальных alias добавлены, все указывают на active canonical
      (`0 конфликтов`).
- [x] 4 существующих канонических `deal.*` НЕ изменены в реестре.
- [x] 19 NEW + 1 (`deal.usd_byn_rate`) канонических `deal.*` добавлены =
      20 NEW; реестр консистентен.
- [x] Запись в `audit_logs` зафиксирована как system-операция с
      before/after.
- [x] Execute идемпотентен: повторный запуск ничего не вставит / не
      обновит (`WHERE NOT EXISTS`, `archived_at IS NULL`).
- [x] Edge-functions / DOCX формат / снапшот не менялись.
- [ ] Опционально: ручной DOCX-тест пользователем — вставить
      `{{document.service_name}}` в шаблон, отрендерить, убедиться что
      в `source_trace` появилась пометка `alias→deal.service_name`.

## Ссылки

- `supabase/functions/_shared/document-render.ts` (alias resolver, строки
  191–218, 401–411, 522–524).
- `.lovable/memory/architecture/documents/field-id-first-canon.md`
  (placeholder format SOT — без изменений).
- `docs/TOKEN_ARCHITECTURE.md` §1 (Class B canonical key tokens) — `deal.*`
  остаются Class B.
