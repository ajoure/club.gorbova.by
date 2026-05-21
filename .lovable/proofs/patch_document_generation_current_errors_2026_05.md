# PATCH-DOC-GENERATION-CURRENT-ERRORS-2026-05

## Problem
Три текущие проблемы по последним сделкам:
1. **Сергей Федорчук / FULL / `ORD-TEST-MPF8NM2B`** — на скрине шаблон/исполнитель «Источник не задан» (артефакт UI после первого создания; backend snapshot уже содержит scenario).
2. **Любовь Пилецкая / CHAT / `SUB-LINK-MPF8O42U`** — `bepaid-webhook` после GetCourse sync затёр `orders_v2.meta.document_data` (stale-meta overwrite); поверх — у неё нет реквизитов физлица.
3. **Сергей Федорчук / CHAT / `ORD-TEST-MPF8PW9G`** — документ создан, но `payment.amount` отдавал `"100,00 BYN"` (валюта в числовом плейсхолдере); отдельного `payment.amount_words` не было.

## Diagnose
- `audit_logs` по `SUB-LINK-MPF8O42U`: `document_data.snapshot_created` (08:39:06) → затем `bepaid.subscription.processed` (08:39:07). В коде `bepaid-webhook` три места `update orders_v2 set meta = { ...orderV2.meta, gc_* }` использовали локальный stale `orderV2.meta`, прочитанный до snapshot, и поэтому затирали `document_data`.
- `payments_v2` Сергея (`ORD-TEST-MPF8PW9G`): `amount=100, currency=BYN, provider=admin_test`. Snapshot писал в `FLD-000264` строку `formatMoney(...)`= `"100,00 BYN"`, что нарушает контракт: `payment.amount` — число, `payment.currency` — код валюты (`FLD-000265`).
- `fields_registry`: `max(public_id)=FLD-000369`, новый id = `FLD-000370`.
- Любовь Пилецкая: в `client_legal_details` `WHERE client_type='individual'` строк нет, в `individual_requisites` строк нет → блокировка по реквизитам ФЛ корректна.

## Execute

### 1. Каталог: новый плейсхолдер `payment.amount_words` (FLD-000370)
Миграция (idempotent):
- `fields_registry`: `entity_type='payment'`, `key='payment.amount_words'`, `label='Сумма платежа прописью'`, `data_type='string'`, `public_id='FLD-000370'`.
- `document_token_registry`: `token_key='payment.amount_words'`, `category='payment'`, `source_type='system'`, привязан к новому FLD.

Объединяющий `payment.amount_formatted` НЕ создаётся — комбинация делается двумя плейсхолдерами в DOCX: `{{payment.amount}} {{payment.currency}}` или через FLD аналогично.

### 2. `supabase/functions/_shared/standard-fields.ts`
- `FLD-000264 / payment.amount` теперь возвращает только число `"100,00"` (без `BYN`).
- `FLD-000370 / payment.amount_words` заполняется через канонический `formatAmountWithWordsByRublesAndKopecks(amount, payment.currency || order.currency || 'BYN')`.
- `FLD-000265 / payment.currency` без изменений (как было).

### 3. `supabase/functions/bepaid-webhook/index.ts` — stale-meta guard
Три места update `orders_v2.meta` после GetCourse sync теперь сначала перечитывают актуальный `meta` из БД и мержат поверх свежего объекта. Маркер в коде: `PATCH-DOC-STALE-META-2026-05`. Только три точечные правки, остальная логика webhook не тронута.

### 4. Repair `SUB-LINK-MPF8O42U`
Вызван canonical path `canonical-document-generate-strict` mode=`preview` → внутри идёт `snapshotOrderDocumentData(orderId, {mode:'rebuild'})`. Никаких ручных insert/update в `meta.document_data`.

Развернутые функции: `canonical-document-generate-strict`, `bepaid-webhook`.

## Verify

### SUB-LINK-MPF8O42U (Любовь Пилецкая)
| Поле | Значение | Проверка |
|---|---|---|
| `document_data.template_id` | `7caee05d-…` | ✓ восстановлен |
| `document_data.executor_id` | `d0c7fe75-…` | ✓ |
| `_provenance.scenario.source` | `scenario` | ✓ |
| `FLD-000264 payment.amount` | `55,00` | ✓ без валюты |
| `FLD-000265 payment.currency` | `BYN` | ✓ |
| `FLD-000370 payment.amount_words` | `55 (пятьдесят пять) рублей, 00 копеек` | ✓ |
| `FLD-000313 customer.ind.full_name` | пусто | ✓ блокировка по реквизитам ФЛ корректна |

### ORD-TEST-MPF8PW9G (Сергей Федорчук, CHAT)
| Поле | Значение | Проверка |
|---|---|---|
| `FLD-000264 payment.amount` | `100,00` | ✓ исправлено (раньше `100,00 BYN`) |
| `FLD-000265 payment.currency` | `BYN` | ✓ |
| `FLD-000370 payment.amount_words` | `100 (сто) рублей, 00 копеек` | ✓ новый плейсхолдер |
| `FLD-000192 document.amount_words` | `100 (сто) рублей, 00 копеек` | ✓ совпадает |

### ORD-TEST-MPF8NM2B (Сергей Федорчук, FULL)
- В БД template/executor/scenario уже заполнены (`source:scenario`), UI «Источник не задан» был артефактом первого snapshot — после нажатия «Создать документ» backend сделает rebuild и применит новый формат `payment.amount` / `payment.amount_words`. Snapshot этой сделки сейчас ещё в старом формате (`payment.amount="150,00 BYN"`) — переписан будет на ближайшем generate-вызове.

## Что НЕ менялось
- bePaid API не вызывался.
- `payments_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `provider_subscriptions`, Telegram — без изменений.
- Активный DOCX шаблон `7caee05d-…` не правился: `{{field:FLD-000264|format=words}}` всё ещё работает (отдаёт «сто»), но рекомендованная подстановка — `{{field:FLD-000370}}`. Замена в DOCX — отдельный template-version patch.
- Никаких новых orders/documents задним числом.

## Anti-regression (real bePaid)
SUB-LINK-MPF8O42U — реальный `provider=bepaid` платёж. После rebuild:
- `payment.amount` без валюты ✓
- `payment.currency` = `BYN` ✓
- `payment.amount_words` = «55 (пятьдесят пять) рублей, 00 копеек» ✓
- `document_data` больше не теряется после webhook (stale-meta guard включён).

## Почему прошлый статус "документ сформирован" был неполным
PDF generation success ≠ корректное заполнение реквизитов и сумм. Раньше успешная генерация скрывала, что `payment.amount` содержал валюту, а `document_data` Любови был стёрт webhook'ом. Теперь проверяем не только факт PDF, но и значения FLD.

## Backlog
- Отдельный template-version patch активного шаблона `7caee05d-…`: заменить `{{field:FLD-000264|format=words}}` на `{{field:FLD-000370}}` после approve.
- Backfill: пересоздать snapshot для исторических сделок, где `payment.amount` ещё в старом формате (только при следующем generate автоматически — массового sweep не требуется).
