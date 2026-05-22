## План: финальный verify по bePaid receipts 2026 backfill v2

## Жёсткие правила исполнения

- Только read-only verify, кроме обновления proof-файла.

- Нельзя менять:

  - payments_v2.amount

  - payments_v2.status

  - payments_v2.order_id

  - subscriptions_v2

  - entitlements

  - access_rules

- Write-scope уже выполненного backfill допускается только исторически:

  - payments_v2.receipt_url

  - provider_response.transaction.receipt_url

  - meta.receipt_backfill_*

- Новых update/delete/migration не делать.

- План и отчет о выполненной работе должны быть на русском языке.

- Вся переписка, пояснения, proof и результаты — только на русском языке.

## Контекст

Edge: `bepaid-receipts-2026-backfill-cron`

Cron:

- schedule: `*/5 * * * *`

- schedule_id=50

- active=true

Scope:

- provider: bePaid / bePaid subscription

- status='succeeded'

- paid date >= 2026-01-01

- amount > 50 BYN

- amount <= 50 BYN / 1 BYN исключены

Предыдущий промежуточный снимок:

- total=2 998

- filled=313

- bepaid_endpoint_not_found=650

- no_uid_skipped=8

- untouched=2 027

Предварительный root cause 404:

часть `provider_payment_id` — это локальные UUID материализации / subscription rebill / statement import, а не реальные bePaid transaction UID. Такие чеки физически не выдаются bePaid.

---

# Шаг 1. Cron movement proof

Проверить:

1. `schedule_id=50` активен.

2. Сколько cron-вызовов было после последнего отчета.

3. Есть ли errors в edge logs.

4. Были ли:

   - 5xx abort;

   - timeout;

   - rate-limit;

   - hard abort;

   - unexpected exception.

В отчет добавить таблицу:

| metric | value |

|---|---:|

| schedule_id | 50 |

| active | true/false |

| schedule | */5 * * * * |

| runs_after_previous_report | N |

| last_run_at | timestamp |

| edge_errors | N |

| timeout | N |

| rate_limit | N |

| api_5xx | N |

| aborted | yes/no |

| conclusion | cron completed / still running / blocked |

---

# Шаг 2. Финальная cohort-таблица

Снять финальную cohort-таблицу по текущему scope:

Scope фильтр:

- provider in bePaid / bePaid subscription variants

- status='succeeded'

- date >= 2026-01-01

- amount > 50 BYN

Нужно вывести:

| metric | count |

|---|---:|

| eligible_total | N |

| with_receipt_url | N |

| missing_receipt_url | N |

| untouched_without_receipt_and_terminal_reason | N |

| no_uid_skipped | N |

| test_payment_skipped | N |

| subscription_phantom_uid_skipped | N |

| rebill_materialized_skipped | N |

| bepaid_endpoint_not_found | N |

| api_5xx | N |

| timeout | N |

| rate_limit | N |

Критерий:

- если `untouched_without_receipt_and_terminal_reason = 0` → блок можно закрывать как classified;

- если `> 0` → блок не закрывать, указать точную причину:

  - cron еще не дошел;

  - selection bug;

  - terminal reason не пишется;

  - race;

  - другая причина.

---

# Шаг 3. Финальная классификация missing

Сформировать таблицу:

| reason | count | business meaning | action |

|---|---:|---|---|

| receipt_url filled | N | чек доступен | ничего не делать |

| no_uid_skipped | N | нет bePaid UID | manual_review / чек не подтянуть автоматически |

| bepaid_endpoint_not_found | N | bePaid transaction не найден по UID | historical no-receipt / чек не выдается bePaid |

| subscription_phantom_uid_skipped | N | не реальный transaction UID | не подтягивать чек |

| rebill_materialized_skipped | N | локальная материализация, не чековая транзакция | не подтягивать чек |

| test_payment_skipped | N | тестовая / не реальная оплата | исключено корректно |

| api_5xx / timeout / rate_limit | N | временная ошибка API | если N>0 — нужен retry patch |

---

# Шаг 4. Проверка amount <= 50 BYN

Проверить:

- count по `amount <= 50` с batch_id / marker `bepaid_receipts_2026_backfill` должен быть 0 для нового V2 job.

- Старые V1-маркеры до фильтра допускаются, но их нужно явно отделить.

В отчет добавить:

| check | result |

|---|---:|

| V2 markers on amount <= 50 | 0 / N |

| V1 legacy markers on amount <= 50 | N |

| 1 BYN auth/card-binding excluded | yes/no |

Вывод:

- 1 BYN / auth-probe / card binding должны быть исключены из V2.

---

# Шаг 5. Safety proof

Подтвердить, что за время V2 job не менялись запрещенные сущности/поля:

| object/field | changed_by_job | result |

|---|---:|---|

| payments_v2.amount | 0 | OK |

| payments_v2.status | 0 | OK |

| payments_v2.order_id | 0 | OK |

| subscriptions_v2 | 0 | OK |

| entitlements | 0 | OK |

| access_rules | 0 | OK |

Если нет отдельного audit/versioning по этим таблицам — проверить через available backup/snapshot/diff/logs и прямо указать метод проверки.

---

# Шаг 6. UI proof `/purchases`

Проверить 2–3 реальных платежа, где receipt_url был подтянут:

Для каждого:

- открыть `/purchases`;

- кнопка «Скачать чек» появилась;

- ссылка открывается;

- URL вида `merchant.bepaid.by/customer/transactions/...`.

Проверить 1–2 missing/historical no-receipt:

- кнопка «Скачать чек» не появляется;

- это корректно, потому что receipt_url отсутствует и terminal reason объясняет почему.

В отчет:

| order/payment | receipt_url status | UI button | URL opens | result |

|---|---|---|---|---|

| sample 1 | filled | yes | yes | OK |

| sample 2 | filled | yes | yes | OK |

| sample 3 | filled | yes | yes | OK |

| missing sample 1 | terminal missing | no | n/a | OK |

---

# Шаг 7. Samples

Добавить в proof:

## 10 successfully filled receipt_url

| payment_id | order_id | provider_payment_id | receipt_url | amount | paid_at |

|---|---|---|---|---:|---|

## 10 missing with terminal reason

| payment_id | order_id | provider_payment_id | terminal_reason | amount | business explanation |

|---|---|---|---|---:|---|

---

# Шаг 8. Обновить proof-файл

Обновить файл:

`.lovable/proofs/bepaid_receipts_2026_backfill_v2_2026_05_22.md`

Добавить секции:

1. `Final after-cron verify`

2. `Cron movement proof`

3. `Final missing classification`

4. `Amount <= 50 exclusion proof`

5. `Safety proof`

6. `UI /purchases confirmation`

7. `Samples filled`

8. `Samples missing`

9. `Final status`

---

# Шаг 9. Итоговый статус

Если:

- `untouched_without_receipt_and_terminal_reason = 0`;

- все missing имеют terminal reason;

- нет новых api_5xx / timeout / rate_limit;

- amount <= 50 не попали в V2;

- safety proof OK;

- UI `/purchases` OK;

то статус:

`completed/classified`

Если `untouched > 0`:

- блок не закрывать;

- указать точную причину;

- составить следующий patch в формате:

  - Problem

  - Cause

  - Dry-run

  - Execute

  - STOP-guards

  - DoD

&nbsp;

План: бэкфилл offer_id 2026 по двум клубам

### Контекст и факты (по БД)

Сделки 2026 года (`deal_date ∈ [2026-01-01, 2027-01-01)`):


| Продукт                | id                                     | Всего | Paid | Paid >50 BYN | Paid >50 без offer_id | Любого статуса без offer_id |
| ---------------------- | -------------------------------------- | ----- | ---- | ------------ | --------------------- | --------------------------- |
| Gorbova Club           | `11c9f1b8-0355-4753-bd74-40b42aa53616` | 1 038 | 821  | 755          | **3**                 | 176                         |
| Бухгалтерия как бизнес | `85046734-2282-4ded-b0d3-8c66c8f5bc2b` | 153   | 126  | 124          | **0**                 | 12                          |


Из них для проблемных (`offer_id IS NULL` либо `offer_id` указывает на оффер без `document_scenarios`) tariff_id всегда заполнен — значит безопасно сопоставить по tariff_id.

### Канонический mapping tariff_id → offer_id

Каждый из 5 тарифов имеет ровно один активный `pay_now`-оффер с настроенными `document_scenarios` (2 сценария). Это и есть «кнопка тарифа», на которую жалуется пользователь:


| Продукт                | Тариф       | tariff_id                              | Канонический offer_id                  |
| ---------------------- | ----------- | -------------------------------------- | -------------------------------------- |
| Gorbova Club           | BUSINESS    | `7c748940-dcad-4c7c-a92e-76a2344622d3` | `bc0f7a90-df41-4a86-b2ea-2a1234d0d534` |
| Gorbova Club           | CHAT        | `31f75673-a7ae-420a-b5ab-5906e34cbf84` | `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e` |
| Gorbova Club           | FULL        | `b276d8a5-8e5f-4876-9f99-36f818722d6c` | `c5781abf-0376-4e1f-91dc-99773906ee77` |
| Gorbova Club           | ИДЕОЛОГИЯ   | `b018e9be-53ce-4840-8034-e09f8e319080` | `d307b438-758c-4f1e-b7d5-fe32df7cae1c` |
| Бухгалтерия как бизнес | Стандартный | `c5981337-242b-49e8-8c99-64ccf8fac13e` | `88c6f10d-a0c6-47f3-9d90-980b3a86fe1c` |


Mapping зашивается в миграцию хардкодом — никаких эвристик по `is_primary`/`offer_type` в рантайме.

### Скоуп бэкфилла

Покрываем сразу обе подкатегории, чтобы «у всех было заполнено»:

1. `offer_id IS NULL` за 2026 по обоим продуктам (188 строк: 176 + 12).
2. `offer_id` указывает на устаревший/не настроенный оффер тарифа (например trial с 0 сценариев) при `status='paid'` за 2026 — отдельно проверяем и переписываем на канонический, только если новый оффер `is_active=true AND offer_type='pay_now'` и принадлежит тому же `tariff_id`. Сейчас таких 3 (CHAT trial `4f1163c9` × 3 paid orders по той же `tariff_id`).

Итого ~191 заказ. Все оплаты (paid, >50 BYN, без offer_id = 3 шт по Gorbova Club) попадают внутрь.

### Что НЕ трогаем

- `status`, `paid_amount`, `final_price`, `provider`, `tariff_id`, `product_id`, `user_id` — без изменений.
- `subscriptions_v2`, `entitlements`, `access_rules`, `payment_sessions`, `payment_links` — без изменений.
- Документы (`ai_generated_documents`) — не создаём задним числом, только разблокируем кнопку «Сформировать» в UI.
- Не запускаем `grant-access-for-order`.

### План работ

1. **Diagnose** — этот раздел (выполнен).
2. **Dry-run миграция** — `SELECT` по тем же условиям, печатает разбивку по продукту/тарифу/статусу и список затронутых `order_id`. Кладём результат в proof `.lovable/proofs/orders_v2_offer_id_backfill_2026_clubs.md`.
3. **Execute миграция** — `UPDATE orders_v2 SET offer_id = canonical, meta = meta || jsonb_build_object('offer_id_backfill_2026', jsonb_build_object('batch_id', ..., 'prev_offer_id', offer_id, 'reason', 'null'|'trial_offer_without_scenarios', 'applied_at', now()))` строго по списку условий выше.
4. **Audit** — одна сводная запись `audit_logs` (actor=`system`, action=`backfill_offer_id_2026_clubs`) с `meta = { batch_id, scope, mapping, before_counts, after_counts, affected_order_ids[] }`.
5. **Verify** — повторные запросы:
  - Paid >50 BYN без offer_id по 2026 двум продуктам = 0.
  - Любых без offer_id за 2026 двум продуктам = 0.
  - Нет paid сделок 2026, где offer указывает на оффер с `document_scenarios = 0` (по канону).
  - Spot-check сделки `#REBILL-…` Юлии Соваськовой на скриншоте: UI карточки показывает оффер и предлагает шаблон/исполнителя.
6. **Memory** — обновить `mem://index.md` короткой ссылкой на новую memory `mem://commercial-logic/orders/offer-id-backfill-policy` (правило: «orders_v2.offer_id за исторические периоды можно проставлять только маппингом tariff_id → активный pay_now-оффер с document_scenarios; никаких эвристик»).
7. **Отчёт** — заполнить proof фактическими `before/after` числами и `batch_id`.

### DoD

- 0 заказов 2026 по `{Gorbova Club, Бухгалтерия как бизнес}` без `offer_id`.
- 0 заказов 2026 со статусом `paid` >50 BYN, где привязанный оффер не имеет `document_scenarios`.
- Карточка сделки в `/admin/communication` и страница `/purchases` корректно показывают шаблон и исполнителя для проверенной сделки `#REBILL-351b168a-681`; кнопка «Сформировать документ» активна.
- В `audit_logs` есть единственная сводная запись с `batch_id`, перечнем всех `order_id`, mapping и счётчиками before/after.
- Никаких изменений в `subscriptions_v2`, `entitlements`, `access_rules`, `payments*`.

### Технические детали миграции

Одна миграция в две стадии (без триггеров, без новых индексов):

```text
-- STAGE 1: NULL offer_id → canonical
UPDATE orders_v2 o
   SET offer_id = m.canonical_offer_id,
       meta = COALESCE(o.meta,'{}'::jsonb) || jsonb_build_object(
         'offer_id_backfill_2026', jsonb_build_object(
           'batch_id', '<uuid>',
           'prev_offer_id', NULL,
           'reason', 'offer_id_null',
           'applied_at', now()
         ))
  FROM (VALUES
    ('7c748940-...'::uuid,'bc0f7a90-...'::uuid),
    ('31f75673-...'::uuid,'6f306cbc-...'::uuid),
    ('b276d8a5-...'::uuid,'c5781abf-...'::uuid),
    ('b018e9be-...'::uuid,'d307b438-...'::uuid),
    ('c5981337-...'::uuid,'88c6f10d-...'::uuid)
  ) m(tariff_id, canonical_offer_id)
 WHERE o.product_id IN ('11c9f1b8-...','85046734-...')
   AND o.deal_date >= '2026-01-01' AND o.deal_date < '2027-01-01'
   AND o.tariff_id = m.tariff_id
   AND o.offer_id IS NULL;

-- STAGE 2: trial-offer без сценариев для paid >50
UPDATE orders_v2 o
   SET offer_id = m.canonical_offer_id,
       meta = COALESCE(o.meta,'{}'::jsonb) || jsonb_build_object(
         'offer_id_backfill_2026', jsonb_build_object(
           'batch_id', '<uuid>',
           'prev_offer_id', o.offer_id,
           'reason', 'trial_offer_without_scenarios',
           'applied_at', now()
         ))
  FROM tariff_offers off, (VALUES …same mapping…) m(tariff_id, canonical_offer_id)
 WHERE o.product_id IN ('11c9f1b8-...','85046734-...')
   AND o.deal_date >= '2026-01-01' AND o.deal_date < '2027-01-01'
   AND o.status = 'paid' AND COALESCE(o.paid_amount, o.final_price, 0) > 50
   AND o.offer_id = off.id
   AND o.tariff_id = m.tariff_id
   AND COALESCE(jsonb_array_length(off.meta->'document_scenarios'), 0) = 0
   AND o.offer_id <> m.canonical_offer_id;

-- AUDIT
INSERT INTO audit_logs(actor_type, action, meta) VALUES
  ('system','backfill_offer_id_2026_clubs', jsonb_build_object(
    'batch_id','<uuid>',
    'scope', jsonb_build_object('products', ARRAY['11c9f1b8-…','85046734-…'], 'year', 2026),
    'mapping', '<mapping json>',
    'before', '<dry-run counters>',
    'after',  '<post-update counters>',
    'affected_order_ids', ARRAY[...]
  ));
```

### Открытые риски

- Если у пользователя есть «несовпадение исторического тарифа и текущего pay_now-оффера по цене», UI документа всё равно использует **снимок** реквизитов из `document_scenarios` оффера, а не цену из заказа — поэтому коммерческая часть заказа не искажается. Принципиально риск минимален.
- Бэкфилл идемпотентен по `WHERE offer_id IS NULL` и `<> canonical`; повторный запуск ничего не сделает.