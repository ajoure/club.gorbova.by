# Sprint 11 — Field-ID Discovery Proof

> Этап 1 плана `.lovable/plan.md` (ID-first DOCX цикл, strict).

## 1. Что есть в БД

### `fields_registry` (SOT для полей)

| column | type | назначение |
|---|---|---|
| `id` | uuid | внутренний UUID (для FK) |
| `public_id` | text | стабильный публичный ID `FLD-XXXXXX` (auto-trigger `trg_fields_registry_public_id`) |
| `entity_type` | text | домен поля (`document`, `customer`, `executor`, `legal_details`, …) |
| `key` | text | стабильный технический ключ; **UNIQUE** глобально (`fields_registry_key_unique`) |
| `label` | text | человекочитаемое название (UI) |
| `data_type` | text | string / number / date / boolean / money |

```
SELECT MAX(public_id), COUNT(*) FROM fields_registry;
-- max=FLD-000102, count=102
```

Существующие entity_type:

| entity_type | count |
|---|---|
| agenda | 1 |
| decision | 1 |
| document | 3 |
| entity | 6 |
| entity_person | 6 |
| legal_details | 47 |
| meeting | 15 |
| package | 8 |
| person | 12 |
| product | 2 |

### `document_token_registry` (157 строк)

Колонки: `token_key`, `ui_label`, `category`, `source_type`, `field_id` (uuid → `fields_registry.id`), `resolver_key`, `data_type`, `is_required`, `display_order`, `example_value`, `description`, `archived_at`.

Сводка:

| category | source_type | total | with_field_id |
|---|---|---:|---:|
| contact | system | 6 | 0 |
| customer | system | 14 | 0 |
| customer.signer | system | 4 | 0 |
| deal | system | 18 | 0 |
| document | system | 30 | 0 |
| executor | system | 15 | 0 |
| legal_details | custom_field | 47 | **47** |
| offer | system | 7 | 0 |
| product | system | 4 | 0 |
| system | system | 6 | 0 |
| tariff | system | 6 | 0 |
| **итого** |  | **157** | **47** |

→ **110 токенов без `field_id`**, все они — `source_type='system'`, исторически резолвились через текстовый `resolver_key` (=`token_key`).

## 2. Классификация и план backfill (классы A/B/C)

Согласно плану, slепой массовый INSERT запрещён. Каждый токен размечен действием:

- **`link_existing`** — `fields_registry` уже содержит ровно такой `key`; нужен только UPDATE `document_token_registry.field_id`.
- **`create_real`** — реальное поле сущности (контакт, клиент, реквизиты, продукт, кнопка, сделка); создаём строку в `fields_registry` с правильным `entity_type` + `key`.
- **`create_computed`** — вычисляемое (сумма прописью, дата, период, валюта прописью, `system.today`, и т.п.); создаём с `entity_type` соответствующим домену; `document_token_registry.source_type` остаётся `system` + `resolver_key` сохраняется.
- **`needs_manual_review`** — пока не используется (всех 110 удалось разнести по A/B; см. таблицу).

### 2.1. `link_existing` (3)

| token_key | matches `fields_registry.key` | public_id |
|---|---|---|
| `document.number` | `document.number` | FLD-000069 |
| `document.date` | `document.date` | FLD-000070 |
| `document.date_short` | `document.date_short` | FLD-000071 |

### 2.2. `create_real` (≈80)

`contact.*` (6), `customer.*` (14), `customer.signer.*` (4), `executor.*` (15), `offer.*` (7), `product.*` (4), `tariff.*` (6), `deal.*` (18 — включая `order.*` алиасы исторические; пара `deal.amount` и `order.amount` маппятся на отдельные `key`-и без потери смысла).

Маппинг `category → entity_type`: точка `.` заменяется на `_`:
- `customer.signer` → `customer_signer`
- остальные — без изменений.

### 2.3. `create_computed` (≈27)

`document.*`, кроме трёх уже существующих:

`document.contract_number, document.contract_date, document.act_number, document.act_date, document.service_name, document.service_description, document.service_unit, document.service_quantity, document.service_price, document.service_amount, document.amount_words, document.currency_major, document.currency_minor, document.payment_due_days, document.execution_days, document.service_period_from, document.service_period_to, document.months_count, document.prepayment_percent, document.prepayment_amount, document.discount_amount, document.first_payment, document.bank_credit_price, document.final_payment_amount, document.deal_currency, document.usd_byn_rate, document.payment_date`

Плюс `system.*` (6): `system.today, system.today_long, system.today_ru, system.now, system.year, system.month`.

(Часть «document.*» формально хранит реальные поля документа — служебно от computed их отличает только то, что значения возникают на этапе генерации/snapshot и не редактируются как реквизиты сущности. Для целей реестра это не принципиально — `entity_type='document'`/`'system'` достаточно.)

### 2.4. `needs_manual_review` (0)

Все 110 удалось разнести по A/B.

### 2.5. Результат миграции (выполнено)

```sql
SELECT COUNT(*) total, COUNT(field_id) with_field_id
FROM document_token_registry WHERE archived_at IS NULL;
-- total | with_field_id
-- ------+--------------
--   157 |           157
```

Счётчик `public_id_sequences[entity_type='field']`: `last_value=212` (был 50, синхронизирован до фактического `MAX` перед INSERT).

Примеры новых `FLD-XXXXXX`:

| token_key | ui_label | public_id |
|---|---|---|
| system.month | Текущий месяц (01-12) | FLD-000212 |
| system.year | Текущий год | FLD-000211 |
| system.now | Сейчас (дата+время) | FLD-000210 |
| system.today_ru | Сегодня прописью | FLD-000209 |
| document.payment_date | Дата оплаты / дата ведения | FLD-000208 |
| document.usd_byn_rate | Курс USD/BYN | FLD-000207 |
| document.deal_currency | Сделка: валюта | FLD-000206 |
| document.final_payment_amount | Окончательный расчёт, сумма | FLD-000205 |

## 3. Текущие точки runtime, которые читают старые `token_key`

(требуется заменить на `public_id`-резолв в Этапах 3–10):

- `supabase/functions/_shared/document-render.ts` — текущий резолвер по строкам `document.*`, `executor.*`, `customer.*`, `cf.*`.
- `src/lib/token-resolver.ts` — `{{cf.product.<UUID>}}`, `{{cf.legal_details.FLD-...|UUID}}` (последний сохраняем до отдельного решения по cf-legal: он уже работает по `public_id`).
- `src/lib/tokens/tokenRegistry.ts` — клиентский справочник.
- `src/components/ai-documents/PlaceholdersCatalogTab.tsx` — каталог UI.
- `src/components/ai-documents/TokenizedRichInput.tsx` — placeholder picker.
- `src/components/ai-documents/AliasesTab.tsx` — alias-вкладка (отдельно: вне новой pipeline).
- `supabase/functions/canonical-template-validate/index.ts`.
- `supabase/functions/canonical-document-generate/index.ts`.
- `supabase/functions/_shared/document-data-snapshot.ts` (Sprint 10) — формат snapshot.
- `src/components/admin/DealDocumentsCard.tsx`.

## 4. Целевая схема (после Этапа 2)

```
document_token_registry
  ├── token_key  (deprecated, не читается новой pipeline; оставлен для legacy/UI поиска)
  ├── field_id   ─►  fields_registry.id  (UUID, FK)
  └── ...

fields_registry
  ├── id         (UUID, FK target)
  └── public_id  (FLD-XXXXXX, единственный publishable ID для DOCX/manifest/snapshot)

DOCX:                                     {{field:FLD-XXXXXX}}
document_template_versions.token_manifest [{ field_id, field_public_id, placeholder, location, required }]
orders_v2.meta.document_data.fields[FLD-XXXXXX] = { value, source, label, updated_at }
```

## 5. Подтверждение «do not touch» legacy

- `generated_documents` — не используется новым каталогом, не модифицируется.
- `documents_canonical_generation_enabled` — `false` (TBD verify в финальном proof).
- `documents_service_act_auto_generation_enabled` — `false` (TBD verify).
- Email/Telegram — не подключаются.

## 6. Следующий шаг

Этап 2 — миграция backfill (см. отдельный SQL-патч): создаёт ~107 новых строк в `fields_registry`, проставляет `document_token_registry.field_id` для всех 110 токенов. Идемпотентность через `ON CONFLICT (key) DO NOTHING` и `UPDATE … WHERE field_id IS NULL`.

После миграции:

```sql
SELECT
  COUNT(*) FILTER (WHERE field_id IS NOT NULL) AS with_field_id,
  COUNT(*) AS total
FROM document_token_registry
WHERE archived_at IS NULL;
-- expected: 157 / 157
```
