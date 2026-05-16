# да, согласен, с учетом правок:

1. **Уточнить, что это только dry-run, без “canonical write-path” в execute.**  
В плане несколько раз упоминается `grant-access-for-order` как canonical write-path, но planned action включает:
  - cancel/supersede duplicate;
  - merge orders;
  - align entitlement;
  - Telegram active_until.
  Это уже не обычный `grant-access-for-order`, а отдельный repair flow. Поэтому в proof нужно явно разделить:

```text
grant-access-for-order — canonical writer для выдачи доступа;
H3.x-b-execute — отдельный approved repair duplicate subscriptions, не grant-access-for-order.
```

2. **В dry-run не обещать Telegram** `active_until`**, если такой таблицы/поля нет или называется иначе.**  
Сначала проверить фактическую Telegram-схему. Если `telegram_access` / `active_until` нет, использовать реальные таблицы/поля из проекта: `telegram_club_members`, `telegram_access`, `telegram_access_queue` или фактический эквивалент.
3. **Cancel provider subscription в execute — только после bePaid pull.**  
В planned action добавить:

```text
если duplicate имеет provider_subscriptions.state='active':
  сначала read/pull provider status через canonical bePaid function;
  если provider реально active — cancel provider;
  если provider уже dead/canceled — только local supersede;
  если provider API ambiguous/error — STOP/manual_review.
```

4. **Не перепривязывать orders через** `meta.subscription_v2_id`**, если есть другие поля связи.**  
В dry-run нужно проверить все возможные linkage-поля:
  - `orders_v2.subscription_v2_id`, если есть;
  - `orders_v2.origin_subscription_id`, если есть;
  - `orders_v2.meta.subscription_v2_id`;
  - `payments_v2`/`provider_subscriptions` linkage;
  - `extended_by_orders`.
5. **Добавить проверку** `extended_by_orders`**.**  
Для каждой пары показать:
  - в какой subscription лежит `extended_by_orders`;
  - есть ли дубли;
  - какие orders будут перенесены/объединены;
  - не потеряются ли lineage-цепочки.
6. **Добавить проверку entitlements по source subscription.**  
В dry-run недостаточно `(user_id, product_id)`. Нужно также показать:
  - `entitlements.order_id`;
  - `entitlements.source_order_id`, если есть;
  - `entitlements.meta.source_subscription_v2_id`;
  - `entitlements.meta.tariff_id`;
  - есть ли несколько entitlement по одному product/tariff.
7. **Priority chain canonical выбора дополнить provider safety.**  
Если duplicate имеет более высокий `access_end_at`, но canonical имеет единственную active provider subscription, нельзя автоматически выбрать duplicate canonical без проверки provider-связи. Добавить:

```text
если max access_end_at принадлежит sub без provider, а другая sub имеет active provider — planned action должен сохранить provider linkage на canonical или пометить manual_review.
```

8. **STOP guard по двум active provider subscriptions оставить жёстким.**  
Если обе sub имеют разные active bePaid SBS — не выбирать canonical, только manual_review.
9. **Финальный SELECT “должно быть ровно 3” формулировать как контроль, но не STOP всего плана.**  
Если найдено больше 3 duplicate-пар, текущие 3 можно всё равно описать read-only, но execute запрещён до нового scope. Лучше:

```text
если найдено >3 — dry-run по этим 3 завершить, но execute не approve; создать updated H4 preconditions.
```

10. **Добавить человекочитаемые имена в proof.**  
Первая колонка:

- имя/email пользователя;
- продукт;
- тариф;
- потом UUID в технических колонках.

11. **DoD добавить: no execute-ready без before/after rollback draft.**  
Для каждой `ready_for_execute` пары dry-run должен включать будущий rollback sketch:

- вернуть duplicate status;
- вернуть order meta;
- вернуть entitlement source;
- вернуть provider state невозможно без provider API — отдельно указать.

12. **Текущий шаг разрешён только как read-only dry-run.**  
Команда:

```text
Выполняй H3.x-b только как read-only dry-run.
Никакого execute, cancel provider, grant, telegram, DML, migrations.
После proof — отдельный approve на H3.x-b-execute.
```

После этих правок план можно запускать.

&nbsp;

План: H3.x-b — duplicate subscriptions repair dry-run (read-only)

## Статус и режим

**Только read-only dry-run.** Никакого execute, cancel provider, grant-access, telegram, DML, миграций, secrets, mode=on. После proof — отдельный approve на `H3.x-b-execute` как независимый repair flow (не `grant-access-for-order`).

## Цель

Подготовить read-only снапшот по 3 duplicate-парам `subscriptions_v2` и описать planned repair action **без выполнения**:

- `1b68252b…`
- `3c6d812a…`
- `7261e727…`

## Терминологическое разделение (важно)

- `grant-access-for-order` — canonical writer **для выдачи доступа** при оплате. В H3.x-b-execute **не используется**.
- `H3.x-b-execute` — отдельный approved repair flow для duplicate subscriptions. Имеет собственный набор операций (supersede, order rebind, entitlement merge, provider cancel), которые `grant-access-for-order` не делает.

В proof это разделение зафиксировать явно.

## Scope

МОЖНО: только `SELECT` по 3 указанным парам и связанным сущностям.

НЕЛЬЗЯ: любой DML; миграции; вызов мутирующих edge functions (`bepaid-cancel-subscriptions`, `grant-access-for-order`, `telegram-grant-access`, `telegram-revoke`, `subscription-actions`, `bepaid-get-subscription-details` с побочными эффектами); webhook replay; изменение `BEPAID_REBILL_MATERIALIZATION` (остаётся `dry_run`); включение `mode=on`.

## Шаги

### 1. Предварительная schema-проверка (фактическая, не предполагаемая)

Перед сбором данных подтвердить реальные имена колонок/таблиц:

- `orders_v2`: проверить наличие колонок `subscription_v2_id`, `origin_subscription_id`, `extended_by_order_id`/`extended_by_orders`; зафиксировать какие реально существуют.
- `entitlements`: проверить наличие `order_id`, `source_order_id`, `meta.source_subscription_v2_id`, `meta.tariff_id`.
- Telegram: подтвердить **фактические** таблицы и поля. Возможные варианты — `telegram_access`, `telegram_club_members`, `telegram_access_queue`. Зафиксировать какие действительно есть и какое поле описывает срок (`active_until` / `expires_at` / иное). В дальнейших шагах использовать только подтверждённые имена. Если ничего эквивалентного нет — пометить Telegram impact как `not_applicable` и не обещать пересчёт.
- `provider_subscriptions`: подтвердить `subscription_v2_id`, `state`, `external_subscription_id`.

Если какое-либо ожидаемое поле отсутствует — в proof явно записать как `field_missing`, без ассумпций.

### 2. Идентификация 3 пар

Подтянуть полные UUID для коротких маркеров (`1b68252b`, `3c6d812a`, `7261e727`) из H4 proof и/или `WHERE id::text LIKE '<short>%'`. Зафиксировать `pair_id` и для каждой пары:

- ФИО / email пользователя (для человекочитаемой колонки);
- Название продукта;
- Название тарифа (если разные у двух sub — оба).

### 3. Снапшот по каждой паре

Для каждой sub в паре собрать:

- `id`, `status`, `billing_type`, `auto_renew`, `access_start_at`, `access_end_at`, `next_charge_at`, `created_at`, `updated_at`;
- `meta.model`, `meta.tariff_access_days`, `meta.recurring`, `meta.amount_byn`;
- `provider_subscriptions[]`: `id`, `state`, `external_subscription_id`, `created_at`;
- `orders_v2[]` через **все подтверждённые linkage-поля** (`subscription_v2_id`, `origin_subscription_id`, `meta.subscription_v2_id`, и при наличии — `extended_by_*`), статус `paid`, исключая `meta.source='rule_engine'`. Для каждого order: `id`, `final_price`, `paid_at`, `meta.payment_flow`, `meta.tariff_id`, набор linkage-полей которыми он привязан;
- `payments_v2[]` по этим orders;
- `extended_by_orders` (если колонка/механизм существует): какая sub является «головой» цепочки, есть ли дубли цепочек, какие orders в цепочке;
- `entitlements[]` по `(user_id, product_id)`: `id`, `status`, `expires_at`, `order_id` (если есть), `source_order_id` (если есть), `meta.source_subscription_v2_id`, `meta.tariff_id`. Отметить случаи, когда на один `(product_id, tariff_id)` есть >1 entitlement;
- Telegram impact (только по подтверждённым в шаге 1 полям): какие записи существуют по `user_id` + `club_id` продукта, текущий срок (имя поля как в схеме), state.

### 4. Diff-таблица по паре

Человекочитаемая первая колонка (пользователь / продукт / тариф), затем технические:
`sub_A` vs `sub_B` по: `status`, `access_end_at`, `auto_renew`, `provider_state`, `provider_sbs_external_id`, `paid_orders_count`, `last_paid_at`, `tariff_id`, `entitlements_count`, Telegram-срок.

### 5. Выбор canonical (priority chain c provider safety)

Применять последовательно, первая выполнившаяся побеждает:

1. Если только одна sub имеет `provider_subscriptions.state IN ('active','pending')` — она кандидат (provider safety приоритетнее access_end_at, чтобы не потерять live rebill).
2. Иначе — sub с большим `access_end_at`.
3. При равенстве — sub с большим количеством paid orders (не rule_engine).
4. При равенстве — sub со свежим `last_paid_at`.
5. При равенстве — sub со свежим `updated_at`.

Спец-случай: если шаг 2 выбирает sub **без** provider, а другая sub имеет active provider — пара помечается `manual_review` (нельзя одновременно сохранить и max access_end_at, и provider linkage без явного решения).

Для каждой пары зафиксировать: `canonical_sub_id`, `duplicate_sub_id`, какой шаг сработал, обоснование.

### 6. Planned action (описание для H3.x-b-execute, не выполняется)

Для каждой пары описать что **будет** сделано в отдельном approved execute:

1. **Keep canonical** + пересчёт `access_end_at = GREATEST(canonical, duplicate)` без снижения.
2. **Cancel/supersede duplicate** — только после провайдер-pull:
  - если duplicate имеет `provider_subscriptions.state IN ('active','pending')`:
    - сначала **read-only pull** через canonical bePaid read function (`bepaid-get-subscription-details` в read-режиме, без побочных эффектов);
    - если провайдер реально active → плановый `bepaid-cancel-subscriptions`, затем local `status='superseded'`, `auto_renew=false`;
    - если провайдер уже dead/canceled/expired → только local supersede;
    - если провайдер API ambiguous/error → **STOP / `manual_review**`, без cancel и без supersede;
  - если у duplicate нет active provider записи → сразу local supersede без provider-вызовов (режим `local_only_no_provider_subscription`).
   Режим явно зафиксировать в audit на этапе execute.
3. **Order rebind** — перепривязка orders, висящих на duplicate, через **все linkage-поля** которые подтверждены в шаге 1 (`subscription_v2_id`, `origin_subscription_id`, `meta.subscription_v2_id`, и `extended_by_*` если используется). Цель — сохранить полную lineage. Сами `orders_v2` не модифицируются деструктивно (только эти поля связи + audit `repair.h3xb.order_rebind`).
4. **Entitlement merge** — `expires_at = GREATEST(current, canonical.access_end_at)`. Обновить указатели на canonical: `meta.source_subscription_v2_id`, и при наличии — `source_order_id`. Если на `(product_id, tariff_id)` обнаружено >1 entitlement — отдельная подзадача (не выполнять автомерж в execute без явного решения).
5. **Telegram** — только если в шаге 1 подтверждены реальные таблицы/поля. Никакого revoke. Срок пересчитывается через GREATEST по подтверждённому полю. Если Telegram-схема `not_applicable` для этого продукта — Telegram-блок пропускается, об этом явно в proof.

### 7. STOP-guards (помечают пару `manual_review`, не выполняют действий)

Пара → `manual_review` если выполнено хотя бы одно:

1. После выбора canonical итоговый `access_end_at` пользователя **ниже** текущего `MAX(sub_A, sub_B)`.
2. **Обе** sub имеют `provider_subscriptions.state='active'` с **разными** `external_subscription_id` — жёстко: только manual_review, никакого автоматического выбора canonical.
3. Найден paid order/payment, который нельзя однозначно привязать ни к canonical, ни к duplicate ни по одному из linkage-полей.
4. `entitlement.expires_at` после planned merge получится ниже текущего.
5. У пользователя по тому же продукту найдена >1 duplicate-пара (scope creep на уровне пользователя).
6. Любая из sub имеет активный `installment_payments.status='pending'` (рассрочка — отдельный flow).
7. `access_rules` ссылается на duplicate `subscription_v2_id` явным полем (риск потери доступа).
8. Конфликт «max access_end_at у sub без provider vs другая sub с active provider» (см. шаг 5, спец-случай).
9. bePaid read-pull (в проекции, не в выполнении) выглядит ambiguous/недоступен — execute по такой паре без него запрещён.

### 8. Контроль общего scope (без жёсткого STOP всего плана)

Финальный SELECT — общее число active+conflict duplicate-пар.

- Если **=3** → dry-run и execute по 3 парам разрешены к approve.
- Если **>3** → текущие 3 описываются read-only до конца, **но execute approve запрещён**. Создаётся обновлённый H4-style preconditions для нового scope; execute переносится за этот рефреш.

### 9. Rollback sketch (обязательно для каждой `ready_for_execute` пары)

В proof для каждой `ready_for_execute` пары привести before/after rollback draft:

- restore `subscriptions_v2` (status, auto_renew, access_end_at, next_charge_at, meta) — по snapshot;
- restore `orders_v2` linkage-полей (значения до rebind по каждому поднятому полю);
- restore `entitlements.expires_at`, `meta.source_subscription_v2_id`, `source_order_id` — по snapshot;
- restore Telegram-полей (только если применимо);
- **отдельный пункт:** restore provider state через API **невозможен** — если provider уже отменён, откат на стороне bePaid требует ручной операции / новой подписки. Это явно зафиксировать.

Без готового rollback sketch — пара не получает `ready_for_execute`, только `manual_review`.

### 10. Proof

Создать `.lovable/proofs/h3x_duplicate_subscriptions_repair_dryrun_2026_05.md`:

- блок разделения терминов: `grant-access-for-order` vs `H3.x-b-execute` repair flow;
- schema-проверка из шага 1 (что есть / чего нет);
- по каждой паре: человекочитаемая шапка (имя, продукт, тариф) → snapshot → diff → canonical + обоснование → planned action → STOP-guard результат → rollback sketch;
- финальный вердикт по каждой паре: `ready_for_execute` или `manual_review`;
- контроль общего scope (=3 или >3) и его последствия;
- блок «Что НЕ делалось»: DML=0, миграции=0, мутирующие edge calls=0, secrets не менялись, `BEPAID_REBILL_MATERIALIZATION=dry_run`, `mode=on` не включался, Telegram revoke/grant не вызывались, webhook replay=0;
- следующий шаг: `H3.x-b-execute` — отдельный план + approve.

## DoD

- proof создан, содержит schema-проверку, snapshot, planned action, STOP-guard результат и rollback sketch по всем 3 парам;
- терминологическое разделение `grant-access-for-order` ≠ H3.x-b-execute зафиксировано явно;
- Telegram блок построен только на подтверждённых таблицах/полях (или `not_applicable`);
- production DML = 0; миграции = 0; secrets не менялись;
- `BEPAID_REBILL_MATERIALIZATION=dry_run`; `mode=on` не включался;
- мутирующие edge calls = 0; bePaid cancel/grant = 0; telegram revoke/grant = 0; webhook replay = 0;
- контроль общего scope выполнен (=3 → approve возможен; >3 → approve запрещён);
- по каждой паре финальный вердикт `ready_for_execute` или `manual_review`;
- ни одна пара не получает `ready_for_execute` без приложенного rollback sketch;
- следующий шаг — отдельный план `H3.x-b-execute` + approve.

## Что дальше

- `H3.x-b-execute` — отдельный план с явным approve: атомарная транзакция, rowcount guards, backup-таблицы (по образцу `recurring_repair_2026_05_execute_A`), pre-cancel provider read-pull, audit `repair.h3xb.*`. **Не** через `grant-access-for-order`.
- Только после execute + наблюдения за audit (новых duplicate-пар = 0 ≥ 7 дней) — повторный H4 preconditions перед `mode=on`.
- `mode=on` сейчас не включать.