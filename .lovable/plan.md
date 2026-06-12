да, согласен, с учетом правок:

Одобряю **только Step A**. Step B и Step C пока не выполнять.

да, согласен, с учетом правок:

**Approve A — Step A backfill**

**orders_v2.offer_id**

Разрешаю выполнить восстановление offer_id для одной доказуемо связанной Stripe-строки:

order_id = 849c68b7-7296-4660-8265-841bc57f7aa5

offer_id = f71b5ed3-27dd-419d-b922-ad529192b58a

Код не менять. Edge functions не деплоить. Step B и Step C не начинать.

**1. Усилить STOP-guards Step A**

В UPDATE orders_v2 обязательно дополнительно проверить:

provider = 'stripe'

status = 'paid'

offer_id IS NULL

payment_link_id = 'c5f28396-a7ce-4575-ba27-b2ab45eb80c9'

tariff_id = '1020fce2-d6c3-4dc0-b9e1-c2566c8ba129'

product_id = '9d0d6de8-4b0e-477f-b6c4-ab7def8268f6'

В той же транзакции повторно доказать, что:

payment_links.offer_id = f71b5ed3-27dd-419d-b922-ad529192b58a

tariff_[offers.id](http://offers.id) = f71b5ed3-27dd-419d-b922-ad529192b58a

tariff_[offers.is](http://offers.is)_active = true

tariff_offers.tariff_id совпадает

product_id совпадает

Если pre-flight count не равен ровно 1 — ROLLBACK и STOP.

Если UPDATE ... RETURNING вернул не ровно одну строку — ROLLBACK и STOP.

**2. SYSTEM ACTOR audit**

Audit-запись создать в той же транзакции.

Обязательный фактический результат:

actor_type = 'system'

actor_user_id = NULL

actor_label = 'Stripe offer_id backfill'

action = 'stripe.order_offer_id.backfilled'

Metadata должна содержать:

order_id

old_offer_id

new_offer_id

tariff_id

product_id

payment_link_id

resolution_source

proof_file

patch

Не ограничиваться SQL-текстом — показать реально созданную строку из audit_logs.

**3. Post-execute proof Step A**

После COMMIT подтвердить:

- before: offer_id=NULL;
- after: установлен f71b5ed3-…;
- rowcount первого execute = 1;
- повторный идентичный UPDATE = 0;
- SYSTEM ACTOR audit row существует;
- другие Stripe и bePaid orders не изменены;
- meta.acquiring и прочие поля заказа не повреждены;
- orphan/guard-check пройден.

Proof:

.lovable/proofs/stripe_offer_scenarios_v1_[stepA.md](http://stepA.md)

Статус после выполнения:

PATCH-STRIPE-OFFER-SCENARIOS-V1 / Step A = PASS

Это ещё не означает, что генерация счёта-акта закрыта.

&nbsp;

**Обязательные правки перед Step B**

**4. Step B выделить в отдельный дочерний патч**

Поскольку готового аналога не существует и сценарий создаётся с нуля, оформить:

PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1

Он должен опираться на каноническую схему document_scenarios, а не на предполагаемую структуру JSON.

До approve B предоставить:

- точную схему всех полей сценария из действующего SOT;
- выбранное юридическое лицо;
- executor_id;
- вид документа: акт либо счёт-акт;
- template_id;
- статус и содержимое шаблона;
- поддержку USD;
- правила нумерации;
- file_name_template;
- обязательные реквизиты плательщика;
- точный JSON before/after;
- rollback.

**5. Учесть все пять консультационных офферов**

Сейчас пустые сценарии обнаружены не у одного, а у всех пяти активных офферов консультаций.

До Step B предоставить матрицу:

offer_id

название тарифа

разовый/рекуррентный платёж

вид услуги

вид документа

executor_id

template_id

document_scenario

Нужно определить:

- один общий сценарий подходит всем пяти офферам;
- либо для разных консультаций нужны разные сценарии/шаблоны.

Не закрывать Stripe-документы настройкой только одного оффера, если остальные четыре останутся без возможности формирования документов.

Допустимый порядок:

1. один оффер как pilot;
2. resolver/UI proof;
3. затем контролируемый rollout на остальные четыре оффера отдельным списком и с отдельными guards.

&nbsp;

**Решение по операции 2 USD**

Фиксируем:

Вариант B — операция считается технической тестовой оплатой.

Основания:

- символическая сумма 2 USD;
- recurring subscription для услуги, которая по смыслу выглядит разовой;
- платёж использовался для технической проверки Stripe lifecycle.

По этому заказу запрещено создавать production-счёт-акт, который:

- займёт реальный номер;
- попадёт в бухгалтерский реестр;
- останется как реальный документ оказанной услуги.

Для Step C использовать:

1. безопасный preview/dry-run без записи и без номера, если он существует;
2. либо будущий реальный Stripe-заказ на консультацию;
3. либо отдельную тестовую среду.

Если preview-режима нет и реального заказа нет — Step C ожидает подходящую операцию.

&nbsp;

**Обязательный runtime deployment gate перед Step C**

PATCH-STRIPE-DOCUMENT-ACT-CHECK-V1 изменил код, но edge functions не передеплоивались.

Следовательно, production runtime пока может продолжать использовать старое правило:

stripe ≠ card

До Step C необходимо:

1. Определить точные edge functions, которые импортируют изменённые shared-файлы.
2. Подготовить минимальный deploy-plan только для этих функций.
3. Перед деплоем показать diff и список функций.
4. После деплоя получить runtime proof:
5. Провести bePaid regression.

Не делать глобальный redeploy всех edge functions.

&nbsp;

**Approve status**

Step A = APPROVED

Step B = NOT APPROVED

Step C = NOT APPROVED

Выполни только Step A и верни фактический proof. После этого подготовь полностью конкретизированный план дочернего патча PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1 и отдельный runtime deployment gate.

&nbsp;

# План v2: PATCH-STRIPE-OFFER-SCENARIOS-V1 — Diagnose / Dry-run (read-only)

Дополнение к v1 по замечаниям. Approve разделён на **A / B / C**. Execute не начинать.

---

## 0. Что нового в v2

- Зафиксирован критический факт: **bePaid-аналога нет.** Все 5 активных офферов продукта `9d0d6de8-…` (Платная консультация) — Stripe-only, ни у одного нет `document_scenarios`/`document_defaults`. Поэтому Step B нельзя описывать как «скопировать с bePaid».
- Step A выделен в самостоятельный data-integrity backfill (approve A).
- Step B превращается в отдельный «создать сценарий с нуля по каноническому SOT» (approve B, требует дополнительной discovery бухгалтерии и юр.лица).
- Step C (e2e generation) — отдельный approve, и только после явного решения по вопросу «тестовая операция или нет».

---

## 1. Устранение противоречия в resolver (до execute)

Запустить локально текущий `canGenerateDocument` для `order_id=849c68b7-…` и зафиксировать в proof фактический объект:

```ts
{
  resolved_offer_id: null,
  resolve_source: 'none',
  resolve_reason: 'no_offer_id_no_tariff_id' | 'multiple_or_zero_active_offers',
  // fallback по tariff_id=1020fce2-… даёт active.length === 1 (f71b5ed3-…),
  // поэтому фактически resolve_source ожидается 'single_active_tariff_offer'
  matched_scenario: null,
  template_id: null,
  availability_reason: 'disabled', // ожидается, не 'no_offer'
  can_generate: false,
}
```

Цель — доказать в proof, что блокер составной:

1. `orders_v2.offer_id IS NULL` — формальный пробел целостности заказа (даже если fallback закрывает резолв).
2. У целевого оффера `f71b5ed3-…` `document_scenarios=NULL` И `document_defaults=NULL` → `isOfferDocumentEnabled` отдаёт `enabled=false, reason='disabled'`.

Уточнение к v1: в v1 было сказано «reason='no_offer'» — это неточно. Фактически fallback срабатывает и резолвит оффер, но дальше `reason='disabled'`. Это меняет приоритет: **сам по себе Step A не разблокирует кнопку «Сформировать документ»** — необходим Step B.

---

## 2. Step A — самостоятельный data-integrity backfill (Approve A)

### 2.1 Pre-flight (повторно проверить перед execute)


| Проверка                                                        | Ожидание                                 |
| --------------------------------------------------------------- | ---------------------------------------- |
| `payment_links.offer_id WHERE id='c5f28396-…'`                  | `= f71b5ed3-27dd-419d-b922-ad529192b58a` |
| `tariff_offers WHERE tariff_id='1020fce2-…' AND is_active=true` | ровно 1 строка, `id=f71b5ed3-…`          |
| `tariff_offers.tariff_id` совпадает с `orders_v2.tariff_id`     | да (`1020fce2-…`)                        |
| `tariffs.product_id` совпадает с `orders_v2.product_id`         | да (`9d0d6de8-…`)                        |
| `tariff_offers.is_active`                                       | `true`                                   |
| `orders_v2.offer_id IS NULL`                                    | `true`                                   |


Если любое расхождение — STOP, эскалация.

### 2.2 Execute в одной транзакции

```sql
BEGIN;

-- dry-run count: must return 1
SELECT count(*) FROM orders_v2
WHERE id='849c68b7-7296-4660-8265-841bc57f7aa5'
  AND offer_id IS NULL
  AND tariff_id='1020fce2-d6c3-4dc0-b9e1-c2566c8ba129'
  AND product_id='9d0d6de8-4b0e-477f-b6c4-ab7def8268f6';

-- single-row backfill with STOP-guards
UPDATE orders_v2
SET offer_id = 'f71b5ed3-27dd-419d-b922-ad529192b58a',
    meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
      'offer_id_backfill_2026_06', jsonb_build_object(
        'source','payment_links.offer_id + single_active_tariff_offer',
        'payment_link_id','c5f28396-a7ce-4575-ba27-b2ab45eb80c9',
        'old_offer_id', null,
        'new_offer_id','f71b5ed3-27dd-419d-b922-ad529192b58a',
        'patch','PATCH-STRIPE-OFFER-SCENARIOS-V1.stepA',
        'backfilled_at', now()
      ))
WHERE id='849c68b7-7296-4660-8265-841bc57f7aa5'
  AND offer_id IS NULL
  AND tariff_id='1020fce2-d6c3-4dc0-b9e1-c2566c8ba129'
RETURNING id, offer_id;

-- SYSTEM ACTOR audit, same transaction
INSERT INTO audit_logs (actor_type, actor_user_id, actor_label, action, target_table, target_id, metadata)
VALUES (
  'system', NULL, 'Stripe offer_id backfill',
  'stripe.order_offer_id.backfilled',
  'orders_v2', '849c68b7-7296-4660-8265-841bc57f7aa5',
  jsonb_build_object(
    'order_id','849c68b7-7296-4660-8265-841bc57f7aa5',
    'old_offer_id', null,
    'new_offer_id','f71b5ed3-27dd-419d-b922-ad529192b58a',
    'tariff_id','1020fce2-d6c3-4dc0-b9e1-c2566c8ba129',
    'product_id','9d0d6de8-4b0e-477f-b6c4-ab7def8268f6',
    'payment_link_id','c5f28396-a7ce-4575-ba27-b2ab45eb80c9',
    'resolution_source','payment_links.offer_id + single_active_tariff_offer',
    'proof_file','.lovable/proofs/stripe_offer_scenarios_v1_stepA.md',
    'patch','PATCH-STRIPE-OFFER-SCENARIOS-V1.stepA'
  )
);

COMMIT;
```

Перед commit (внутри той же транзакции) уточнить точные имена колонок `audit_logs` (`actor_type/actor_user_id/actor_label/action/target_table/target_id/metadata`) и при необходимости адаптировать INSERT — это часть pre-flight проверки.

### 2.3 Post-execute proof (Approve A return)

1. `RETURNING` → ровно 1 строка `(id, offer_id=f71b5ed3-…)`.
2. Повторный idempotent UPDATE → 0 rows.
3. `SELECT * FROM audit_logs WHERE action='stripe.order_offer_id.backfilled' AND target_id='849c68b7-…';` — реальная строка с `actor_type='system'`, `actor_user_id IS NULL`, `actor_label='Stripe offer_id backfill'`, metadata содержит все 7 ключей.
4. Orphan/guard-check: `SELECT id, offer_id, tariff_id FROM orders_v2 WHERE id='849c68b7-…';` показывает новый offer_id.
5. Rollback (на случай отката):
  ```sql
   UPDATE orders_v2
   SET offer_id = NULL,
       meta = meta - 'offer_id_backfill_2026_06'
   WHERE id='849c68b7-7296-4660-8265-841bc57f7aa5'
     AND offer_id='f71b5ed3-27dd-419d-b922-ad529192b58a';
  ```

Step A ценность: целостность заказа восстановлена, отчётность/аналитика по `offer_id` корректна, не зависит от Step B.

---

## 3. Step B — НЕЛЬЗЯ копировать с аналога, потому что аналога нет

### 3.1 Discovery аналогов (выполнена)

Все активные офферы продукта `9d0d6de8-… (Платная консультация, slug=consultation.gorbova.by)`:


| offer_id     | tariff_name                         | acquiring.default_provider | document_scenarios | document_defaults |
| ------------ | ----------------------------------- | -------------------------- | ------------------ | ----------------- |
| `f71b5ed3-…` | Несрочная консультация (target)     | stripe                     | NULL               | NULL              |
| `25880f13-…` | Срочная консультация                | stripe                     | NULL               | NULL              |
| `7a333f66-…` | Стратегия защиты по уголовным делам | stripe                     | NULL               | NULL              |
| `369c911a-…` | Групповая консультация              | stripe                     | NULL               | NULL              |
| `c244bbd4-…` | Помощь при проверке                 | stripe                     | NULL               | NULL              |


**Вывод:** ни одного bePaid pay-now оффера с настроенными `document_scenarios` у продукта нет. Все 5 офферов одинаково «пустые». **Аналога для копирования не существует.**

### 3.2 Источник из других продуктов — проверка совместимости запрещена «по умолчанию»

Любой шаблон/сценарий из другого продукта не соответствует целевому по как минимум одному из обязательных критериев:

- услуга («консультация» vs «обучение»/«клуб»);
- юридическое лицо исполнителя (для Stripe Poland исполнитель отличается от bePaid BY);
- вид документа (счёт-акт для обучения ≠ акт оказанных услуг для консультации);
- валюта (USD vs BYN);
- момент оказания (после факта консультации vs после оплаты курса);
- правила нумерации;
- условия возврата.

**Поэтому Step B нельзя выполнять как «копирование».** Он превращается в отдельный план **создания сценария с нуля по каноническому SOT**.

### 3.3 Новый под-план Step B (не execute, до approve B нужно собрать)

Перед approve B бизнес/бухгалтерия должны определить и предоставить:

1. **Юр.лицо исполнителя** для Stripe Poland операций (executor_id в `executors`, для USD-консультаций). Если такого исполнителя нет — STOP и отдельный PATCH на создание `executors` + банковские реквизиты USD.
2. **Шаблон документа** в `document_templates`:
  - `id` существует и `is_active=true`;
  - вид = акт оказанных услуг (или счёт-акт — нужно решение);
  - поддержка валюты USD;
  - привязка к выбранному `executor_id`;
  - валидный `file_name_template`;
  - сконфигурированная нумерация (`document_number_sequences`) для этого шаблона/года/юр.лица.
   Если шаблон отсутствует — STOP и отдельный PATCH-STRIPE-TEMPLATE-V1 (создать шаблон, не часть текущего патча).
3. **Сценарий**: `payer_type` (`individual`/`entrepreneur`/`legal_entity`), `payment_channels=['card']`.

### 3.4 Целевой JSON-патч Step B (до approve B)

Before snapshot (зафиксирован):

```json
{
  "document_scenarios": null,
  "document_defaults": null
}
```

Proposed after (пример формы; конкретные UUID заполняются после 3.3):

```json
{
  "document_scenarios": [
    {
      "id": "<uuid>",
      "payer_type": "individual",
      "payment_channels": ["card"],
      "template_id": "<TEMPLATE_UUID>",
      "executor_id": "<EXECUTOR_UUID>",
      "requires_required_requisites": false,
      "is_enabled": true
    }
  ]
}
```

UPDATE — JSON merge, без перезаписи всей `meta`:

```sql
-- pre-check: scenarios/defaults ещё NULL (защита от race)
SELECT meta->'document_scenarios' AS s, meta->'document_defaults' AS d
FROM tariff_offers WHERE id='f71b5ed3-27dd-419d-b922-ad529192b58a';

UPDATE tariff_offers
SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
  'document_scenarios', <PROPOSED_JSON>,
  'stripe_offer_scenarios_v1', jsonb_build_object(
    'before', jsonb_build_object('document_scenarios', null, 'document_defaults', null),
    'patched_at', now(),
    'patch','PATCH-STRIPE-OFFER-SCENARIOS-V1.stepB'
  ))
WHERE id='f71b5ed3-27dd-419d-b922-ad529192b58a'
  AND (meta->'document_scenarios') IS NULL
  AND (meta->'document_defaults') IS NULL
RETURNING id, meta->'document_scenarios', meta->'acquiring';
```

Сохраняются: `meta.acquiring.*` (stripe settings/price_id/account_code), `__backfill_marker__` и все прочие ключи.

Rollback Step B:

```sql
UPDATE tariff_offers
SET meta = (meta - 'document_scenarios' - 'stripe_offer_scenarios_v1')
WHERE id='f71b5ed3-27dd-419d-b922-ad529192b58a';
```

### 3.5 Таблица source→target (до approve B заполнить полностью)


| Поле               | source_offer | target_offer (f71b5ed3-…)                    |
| ------------------ | ------------ | -------------------------------------------- |
| product_id         | —            | 9d0d6de8-… (Платная консультация)            |
| tariff_id          | —            | 1020fce2-… (Несрочная консультация)          |
| offer_type         | —            | (NULL — нужно явно проставить?)              |
| payment_type       | —            | (NULL — recurring через Stripe sub)          |
| is_recurring       | —            | true (sub_1TgWoO…, period_start=period_end?) |
| legal_entity       | —            | **TBD** (Stripe Poland — какой `executors`)  |
| document_type      | —            | **TBD** (акт vs счёт-акт)                    |
| template_id        | —            | **TBD**                                      |
| template_status    | —            | **TBD**                                      |
| document_scenarios | —            | NULL                                         |
| document_defaults  | —            | NULL                                         |


Все ячейки source — пусто, потому что **аналога нет**. Approve B без заполнения правой колонки невозможен.

---

## 4. Шаблон — проверка до Step B (часть discovery 3.3)

До approve B на каждом кандидате `template_id` подтвердить:

- `document_templates.id` существует, `is_active=true`;
- `document_type` соответствует выбранному виду документа для консультации;
- поддержка валюты USD (либо явная универсальность);
- `executor_id` шаблона = выбранному юр.лицу Stripe Poland;
- `file_name_template` валиден (см. mem `Document File Name Template`);
- настроена нумерация (`document_number_sequences`/`document_number_counters`).

Запрещено в рамках этого патча менять: `document_templates`, `file_name_template`, нумерацию, canonical writer. Если требуется — отдельный PATCH-STRIPE-TEMPLATE-V1.

---

## 5. Решение по тестовости заказа (блокер approve C)

Целевой Stripe order:

- `id=849c68b7-7296-4660-8265-841bc57f7aa5`
- amount = `2.00 USD`
- Stripe sub = `sub_1TgWoO6UYJj2vm0Gjc9P0jxH`, invoice `in_1TgWoM…`
- product = «Платная консультация / Несрочная консультация»

Признаки тестовой операции: символическая сумма 2 USD, recurring monthly для одноразовой по смыслу услуги «консультация». Признак реальной операции: Stripe `mode=live`, `account_code=stripe_poland`.

Approve C требует явного фиксирования одного из вариантов:

- **Вариант A — допустим для реального документа.** Тогда генерация в production через `canonical-document-generate-strict`, реальный номер, запись в `ai_generated_documents`, документ остаётся в системе.
- **Вариант B — заказ тестовый.** Тогда execute генерации запрещён в production. Альтернативы: (а) preview/dry-run генератора без записи и без номера (если поддерживается canonical writer — нужна отдельная discovery); (б) ручной тестовый Stripe order на согласованный продукт/сумму; (в) staging без production-нумерации.

Без письменного решения approve C не открывать.

---

## 6. Проверка возвратов/отмены до Step C

Зафиксировано (dry-run):


| Поле                                 | Значение                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `orders_v2.status`                   | `paid`                                                                                 |
| `payments_v2.status`                 | `succeeded`                                                                            |
| `payments_v2(status='refunded').sum` | `0`                                                                                    |
| Stripe subscription                  | `sub_1TgWoO…` — состояние подписки на момент генерации проверить отдельно перед Step C |


Перед approve C повторно подтянуть фактический статус Stripe subscription через `stripe-get-subscription-details` (read-only). Если sub отменён/refund появился — генерация только по правилам корректировочного документа, в данный патч это не входит.

---

## 7. Разделение approve

### Approve A — Step A (самостоятельно)

- Backfill одного `orders_v2.offer_id`.
- Return: before/after, rowcount=1, повторный=0, SYSTEM ACTOR audit row из `audit_logs`, orphan-check.
- Proof: `.lovable/proofs/stripe_offer_scenarios_v1_stepA.md`.

### Approve B — Step B (после Step A + полной discovery 3.3)

- Заполненная таблица source→target.
- Полный JSON-патч before/after.
- Template proof (id/active/type/currency/executor/file_name/нумерация).
- Rollback.
- Решение «тестовый/реальный» (вариант A или B).
- Proof: `.lovable/proofs/stripe_offer_scenarios_v1_stepB.md`.

### Approve C — Step C (e2e generation, после A+B)

- Повторный вызов `canGenerateDocument` → `can_generate=true`, `template_id=...`, `matched_scenario=...`.
- `/purchases` показывает кнопку «Сформировать документ» на этом заказе.
- Однократный вызов `canonical-document-generate-strict` (idempotency_key).
- Verify: ровно 1 запись в `ai_generated_documents`, корректный PDF.
- bePaid regression на контрольном заказе.
- Proof: `.lovable/proofs/stripe_offer_scenarios_v1_stepC.md`.

---

## 8. Финальный DoD PATCH-STRIPE-OFFER-SCENARIOS-V1 = PASS

- `orders_v2.offer_id` восстановлен однозначно по двойному источнику.
- SYSTEM ACTOR audit row в `audit_logs` реально существует и содержит все 7 ключей метаданных.
- На целевом оффере `f71b5ed3-…` настроен доказуемо корректный сценарий документа (шаблон/исполнитель/валюта/юр.лицо проверены).
- `canGenerateDocument({order, payments, tariffOffers, ctx})` возвращает `canGenerate=true` с непустым `template_id` и совпадающим сценарием.
- В UI `/purchases` Stripe order виден, кнопка «Сформировать документ» активна.
- Решение «тестовый/реальный» зафиксировано и применено.
- Создание документа допустимо с учётом статусов order/payment/refund/sub.
- PDF содержит: правильного клиента, услугу, сумму, валюту, юр.лицо, реквизиты, payment_channel=`card`.
- В `ai_generated_documents` ровно одна запись по этому order.
- bePaid regression: один контрольный bePaid paid order того же типа сценария продолжает генерировать документ без изменений (или прямо отмечено отсутствие такого контроля, потому что у продукта нет bePaid-аналога — тогда regression выполняется на другом продукте с настроенными сценариями).
- Нет дублирующихся документов и нет дублирующихся номеров.
- Proofs A/B/C содержат: SQL до/после, скриншоты UI, PDF, фактические audit-строки, фактический output resolver.

---

## 9. Ближайший шаг

Жду **только approve A** (Step A — backfill offer_id и audit). Параллельно бизнес/бухгалтерия начинает discovery 3.3 для Step B (executor + шаблон + вид документа + нумерация USD). После выполнения Step A вернусь с заполненной таблицей source→target, полным JSON и предложением по варианту A/B тестовости — это станет основанием для approve B.

Execute не начинаю. Phase 1 не передеплоиваю. Код не меняю.