## Да, согласен, с учетом правок:

&nbsp;

1. **Блок 1 approve к execute.**
  PATCH-MODULE-FULFILLMENT-GAPS-ROUND-2 запускать по 14 order_id можно. Это ровно то, что нужно: закрыть подтвержденные paid + order_based_only + 0 entitlement + 0 exact sub через штатный grant-access-for-order.
2. **Блок 2 в текущем виде не approve к execute.**
  Массово **активировать / создавать product_access rules** сейчас нельзя. Это уже не точечный repair, а изменение общей модели доступа. Сначала нужен **dry-run impact proof**:
  &nbsp;
  - какие UI / resolver / guard реально читают именно product_access
  - изменит ли это видимость модулей для уже существующих пользователей
  - не появится ли доступ у тех, кому он не должен появиться
    Пока этого proof нет — **только discovery, без миграции**.
  &nbsp;
3. **cb_module_ip не трогать вообще.**
  Это оставить в hold как legacy_backfill_access. Без revoke, без regrant, без нормализации в этом спринте.
4. **Перед execute по 14 gaps добавить grouping по users и exact order list в артефакт.**
  Чтобы после выполнения было видно:
  &nbsp;
  - какой user
  - какой exact order
  - какой exact product_id
  - created entitlement id
  - created subscription id
  - changed access_end_at
    Один consolidated before/after CSV обязателен.
  &nbsp;
5. **После 14 вызовов обязателен повторный full re-scan по всем module products.**
  Не только по 14 order_id, а по всем order_based_only модулям:
  &nbsp;
  - paid orders
  - active entitlements
  - exact active subs
  - remaining gaps
    Нужно доказать, что после этого у нас не осталось новых дырок в той же группе.
  &nbsp;
6. **Webhook proof не блокирует execute по gaps.**
  PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-LIVE-PROOF оставить параллельно как proof-only. Не тормозить из-за него закрытие module fulfillment.
7. **Финальный consolidated результат этого спринта должен быть только такой:**
  &nbsp;
  - 14 gaps закрыты
  - остаток gaps по module products пересчитан
  - product_access rules пока **не менялись**, если нет отдельного impact-proof
  - отдельным следующим спринтом уже решать нормализацию model/rules
  &nbsp;
8. **Добавить жёсткий STOP-guard в план:**
  Если при after-scan выясняется, что активация product_access может поменять доступ хоть одному лишнему пользователю, этот блок автоматически переносится в отдельный discovery/execute sprint и не выполняется сейчас.

&nbsp;

&nbsp;

Итог: **делать сейчас надо только точечный execute по 14 gap-order через grant-access-for-order + полный before/after re-scan.**

**Массовую активацию/создание product_access rules пока не делать.**

&nbsp;

План: CONSOLIDATED MODULE EXECUTE — 3 патча одним пакетом

---

### Данные из БД на момент планирования

**14 fulfillment gaps** — paid orders с 0 active entitlements:


| Модуль                 | Кол-во gaps | Users                                            |
| ---------------------- | ----------- | ------------------------------------------------ |
| cb_module_catering     | 1           | 1502c12e                                         |
| cb_module_marketplaces | 4           | 1502c12e, 2b352bdf, 7c53b6af, f278876e           |
| cb_module_production   | 4           | 1502c12e, 5c6e6e0f, 7c53b6af, e748983f           |
| cb_module_retail       | 5           | 1502c12e, 5c6e6e0f, 7c53b6af, e748983f, f278876e |


**6 уникальных пользователей** затронуты.

**Ранее закрытые:** cb_module_construction (f278876e) и prd_08a84b2b7223 (3 users) — уже имеют active entitlements. Idempotency guard их защитит.

**Критическая находка по access_rules:**

- `product_access` правила **ВЫКЛЮЧЕНЫ** у 5 из 8 модулей (catering, construction, ip, production, pvt)
- `product_access` правила **ОТСУТСТВУЮТ** у retail и prd_08a84b2b7223
- Но `training_content` правила **АКТИВНЫ** у всех 8 — поэтому `isCurrentValidAccess` пройдёт
- `grant-access-for-order` **не проверяет** product_access rules для создания entitlement — создаёт напрямую по order

---

### Блок 1: PATCH-MODULE-FULFILLMENT-GAPS-ROUND-2

**Что:** Вызвать `grant-access-for-order` для каждого из 14 order_id с gap.

**Before-proof по каждому order (сохраняется в артефакт):**

- order.status = paid
- order.user_id не NULL
- order.product_id = exact module product
- entitlement_mode = order_based_only
- active_ent_count = 0 по product_id
- active_sub_count = 0 по product_id

**Порядок:**

1. SQL snapshot before (14 строк: order_id, user_id, product_code, ent_count, sub_count)
2. Последовательный вызов `grant-access-for-order` для каждого из 14 orders
3. SQL snapshot after (те же 14 строк + created_entitlement_id, created_subscription_id)
4. Scope leakage check: total entitlements/subscriptions before vs after = ровно +14/+14
5. Idempotency proof: повторный вызов одного order → `already_fulfilled: true`

**Артефакт:** `module_fulfillment_gaps_round2_before_after.csv`

**14 order_id для execute:**

```text
cb_module_catering:    63c36a18-2efb-42c2-9060-6ecadec8a814 (user 1502c12e)
cb_module_marketplaces: 243a2c95 (1502c12e), 00ca4946 (2b352bdf), f1c284d1 (7c53b6af), 9781e731 (f278876e)
cb_module_production:  4c5209e1 (1502c12e), b5a8eca6 (5c6e6e0f), 34ae0f30 (7c53b6af), cee45419 (e748983f)
cb_module_retail:      fad67bb7 (1502c12e), 12909f3f (5c6e6e0f), d2218e8e (7c53b6af), fe4809b1 (e748983f), f3c5ffb7 (f278876e)
```

**Guards:**

- Не трогать cb_module_construction, prd_08a84b2b7223 — уже закрыты, idempotency guard отклонит
- Не трогать cb_module_ip — subscription_based, не в scope
- Не трогать cb_module_pvt — нет paid orders с gap

---

### Блок 2: PATCH-GRANULAR-MODULE-BINDING-NORMALIZATION

**Что:** Привести `product_access` rules к единому контракту.

**Текущее состояние:**

- 5 модулей: `product_access` rule есть, но **is_active = false** (catering, construction, ip, production, pvt)
- 2 модуля: `product_access` rule **отсутствует** (retail, prd_08a84b2b7223)
- 1 модуль: `product_access` rule **active** (marketplaces)

**Решение:**

- Для 5 модулей с inactive rules — **активировать** (`is_active = true`) через миграцию
- Для 2 модулей без rules — **создать** `product_access` rules через миграцию
- Результат: все 8 модулей = active product_access rule + active training_content rule

**Бизнес-модель каждого модуля (финальная):**


| Модуль                 | Модель                            | product_access | training_content |
| ---------------------- | --------------------------------- | -------------- | ---------------- |
| cb_module_catering     | dual_model                        | activate       | active           |
| cb_module_construction | dual_model                        | activate       | active           |
| cb_module_ip           | parent_only (subscription_based)  | keep inactive  | active           |
| cb_module_marketplaces | dual_model                        | active         | active           |
| cb_module_production   | dual_model                        | activate       | active           |
| cb_module_pvt          | standalone_only (нет paid orders) | activate       | active           |
| cb_module_retail       | dual_model                        | CREATE         | active           |
| prd_08a84b2b7223       | dual_model                        | CREATE         | active           |


**Исключение:** cb_module_ip — `subscription_based`, не `order_based_only`. Его `product_access` rule остаётся inactive. Доступ через backfill entitlements, не через orders.

**Файлы:** Только SQL-миграция. Без изменения edge functions или UI.

**DoD:**

- Все 7 order_based_only модулей имеют active product_access rule
- cb_module_ip остаётся без active product_access (subscription_based)
- Контракт: paid order → entitlement → product_access rule → training_content rule → видимость

---

### Блок 3: PATCH-BEPAID-WEBHOOK-PAYMENT-FLOW-LIVE-PROOF (параллельно)

**Что:** Проверить наличие первой live webhook-транзакции с заполненным `payment_flow`.

**Действия:**

1. SQL: все orders с `payment_flow LIKE 'bepaid%'` после 2026-04-06
2. Если есть — зафиксировать proof, закрыть тему
3. Если нет — оставить CONDITIONAL_PASS, проверить при следующем спринте

**Артефакт:** `webhook_payment_flow_live_proof.csv` (если есть данные)

---

### Порядок выполнения

1. **Before snapshot** — SQL по 14 orders
2. **Блок 1** — execute 14 grant-access-for-order вызовов
3. **After snapshot** — verify +14 entitlements, +14 subscriptions
4. **Блок 2** — SQL-миграция: activate/create product_access rules
5. **Блок 3** — SQL-proof по webhook payment_flow
6. **Финальный артефакт** — consolidated CSV

### STOP-guards

- Без revoke
- Без изменения training_modules.product_id
- Без изменения training_content rules
- cb_module_ip не трогать
- Scope leakage = 0

### Техническая секция

**Миграция для Блока 2 (SQL):**

```sql
-- Activate existing inactive product_access rules (5 modules, excluding ip)
UPDATE access_rules SET is_active = true, updated_at = now()
WHERE id IN (
  '1c6a6824-c4e7-4069-8c1f-388e5ab1ecde', -- catering
  'c4da1b02-56f6-4e4f-b7dc-b2ab2093f04d', -- construction
  '68cf63f1-c13d-47ca-bc45-a5f83aa6062b', -- production
  '07aa5a5d-48d0-4b75-aed7-982a60eecc0f'  -- pvt
);

-- Create missing product_access rules for retail and prd_08a84b2b7223
INSERT INTO access_rules (product_id, grant_target_type, target_ref, target_label, is_active, conditions)
VALUES
  ('abee24cd-5c8b-4111-a6cb-7dee7acf168c', 'product_access',
   'abee24cd-5c8b-4111-a6cb-7dee7acf168c',
   'Ценный бухгалтер | 1 ступень 2.0 | Модуль: Розничная торговля',
   true,
   '{"target_product_ids":["abee24cd-5c8b-4111-a6cb-7dee7acf168c"]}'::jsonb),
  ('64d9f812-617c-41a8-b3dc-bb113156d6f3', 'product_access',
   '64d9f812-617c-41a8-b3dc-bb113156d6f3',
   'Ценный бухгалтер | 1 ступень 2.0 | Модуль: Грузо- и пассажироперевозки',
   true,
   '{"target_product_ids":["64d9f812-617c-41a8-b3dc-bb113156d6f3"]}'::jsonb);
```

**Edge function вызовы для Блока 1:** 14 последовательных POST к `grant-access-for-order` с `{ "orderId": "..." }`.

**Ожидаемый результат спринта:**

- 14 fulfillment gaps закрыты
- Все 7 order_based_only модулей имеют полный контракт (product_access + training_content)
- Webhook payment_flow — статус зафиксирован
- 0 scope leakage