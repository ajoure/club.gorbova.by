# да, согласен, с учетом правок:

1. **Не создавать REBILL-order только для теста §F mismatch.**  
В тесте 7 написано противоречиво: сначала «§F guard срабатывает внутри grant-access-for-order», потом «REBILL-order при этом всё равно НЕ создаётся, потому что mismatch ловится ДО invoke grant». Нужно зафиксировать одно правило:  
**если recurring autocharge имеет SBS mismatch — REBILL-order не создаётся, payment не перепривязывается, grant не вызывается, только audit/manual_review.**
2. **Локальный** `guardSbsTariffMatch()` **в** `rebillFlow` **не должен дублировать бизнес-логику §F вручную.**  
Нужно переиспользовать общий helper/contract из §F или вынести shared pure-guard. Иначе через месяц снова появятся две разные логики.
3. **Уточнить** `provider_payment_id` **в** `orders_v2`**.**  
Перед кодом проверить, что поле реально существует. Если нет — использовать только `meta.materialized_from_payment_uid`. Нельзя писать в несуществующее поле.
4. **Order number standard привести к production-паттерну.**  
Сейчас указано `REBILL-<first12(provider_payment_id)>`, а ранее были `REBILL-7a64cd04-3d0`. Нужно использовать один текущий production-паттерн, чтобы не плодить два стандарта номеров.
5. `off mode` **не должен писать audit всегда.**  
В плане раньше фигурировал `bepaid.rebill.disabled`, сейчас в тесте ожидается отсутствие новых audit. Оставить так:  
**mode=off полностью обходит новый path и не пишет новые audit**, иначе будет шум в логах.
6. `dry_run` **не должен менять runtime-поведение webhook.**  
В режиме `dry_run` старый путь должен продолжить работать как сейчас, а новый path должен только логировать planned payload. Уточнить, что dry_run не ломает фактическую обработку платежа.
7. `mode=on` **не включать и не добавлять secret без отдельного approve.**  
В DoD написано «env присутствует». Лучше: код читает env с default `off`; production secret не менять, если он не нужен. Любое изменение secrets — отдельное подтверждение.
8. **Full-refund guard проверить по фактическому порядку webhook.**  
Если refund приходит позже отдельным webhook, то autocharge уже мог вызвать grant. В этом patch достаточно:
  &nbsp;
  - не grant при known full-refund до grant;
  - refund handler корректно ставит refunded state.  
  Но отмена уже выданного доступа при последующем full refund — это отдельный scope, не смешивать.
9. `grant-access-for-order` **по REBILL-order должен быть доказан тестом.**  
Добавить отдельный тест/fixture: REBILL-order с `bepaid_subscription_id` совпадает с subscription_v2 → grant делает extend нужной subscription, не создает новую.
10. **Atomicity описать в proof.**  
Если `orders_v2` создан, а `payments_v2` insert/update упал, повторный webhook должен безопасно завершить процесс. В proof указать retry/idempotency поведение.
11. **Никакого** `UPDATE payments_v2.order_id` **в production при** `off/dry_run`**.**  
Это очевидно, но зафиксировать явно. Любая перепривязка существующего payment — только при `mode=on`.
12. **Тесты должны быть offline/mocked.**  
Никаких реальных bePaid credentials, реального webhook или production Supabase в тестах.
13. **Отчет после выполнения должен отдельно подтвердить §F regression.**  
Не только тест внутри `bepaid-webhook`, но и повторный прогон тестов `grant-access-for-order`, чтобы guard не сломался.
14. **DoD добавить список changed files и no migration proof.**  
В финальном отчете: diff-summary, список файлов, тесты, proof, migrations=0, production DML=0, kill-switch default off.

&nbsp;

С этими правками план можно запускать. Главное: **код можно писать, production** `on` **не включать, data-repair не делать**.

&nbsp;

План: §A REBILL Materialization code-patch

## 0. Scope и границы

- Только **код + Deno-тесты + proof**.
- **0 production DML** (никаких ручных INSERT/UPDATE в `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, `telegram_*`).
- **0 миграций**. Если по ходу выяснится, что нужен новый partial UNIQUE или индекс — выносим отдельным под-планом и согласуем перед кодом.
- **Без data-repair Ларисы**, без sweep, без backfill.
- Production включение `BEPAID_REBILL_MATERIALIZATION=on` — **не в этом этапе**. По умолчанию `off`.

## 1. Kill-switch

Новый env-флаг в `bepaid-webhook`:

```
BEPAID_REBILL_MATERIALIZATION = off | dry_run | on
default = off
```

Поведение:

- `off` — текущее поведение webhook без изменений. Новый код-путь полностью обойдён. Это safe-by-default состояние production.
- `dry_run` — выполняется весь новый decision-flow (resolve recurring → resolve REBILL-order target → idempotency check → conflict detection), но:
  - НЕ создаётся новый `orders_v2` REBILL-row;
  - НЕ перепривязывается `payments_v2.order_id`;
  - НЕ вызывается `grant-access-for-order` по REBILL-order;
  - пишется audit `bepaid.rebill.dry_run` со всем планируемым payload (что бы было создано / куда бы привязали / какой grant вызвали).
- `on` — полный путь с реальными INSERT/UPDATE через каноничные write-paths. Включается только отдельным approve после verify dry_run на проде.

Флаг читается **один раз на старте handler** и логируется в каждый audit (`mode: off|dry_run|on`).

## 2. Точный call graph в bepaid-webhook

Узлы — функции/модули, стрелки — порядок вызова. Новые блоки помечены `[NEW]`.

```text
bepaid-webhook (handler)
  ├─ verify signature
  ├─ parse payload → { transaction, subscription_id?, uid (provider_payment_id), status, amount, paid_at, ... }
  ├─ resolveContext()                               // существующее
  │     → { parent_order, subscription_v2, product_id, tariff_id, user_id, profile_id, sbs }
  │
  ├─ classifyPayment()                              // существующее + расширение
  │     → kind ∈ { initial | recurring_autocharge | refund | unknown }
  │     recurring_autocharge признаки:
  │       - есть subscription_id (sbs) И
  │       - найдена subscriptions_v2 с этим sbs И
  │       - status ∈ {successful, paid} И
  │       - НЕ initial-charge (есть предыдущие successful payments под этим sbs ИЛИ flag в payload)
  │
  ├─ if kind == recurring_autocharge AND mode != off:
  │     [NEW] rebillFlow.run({ parent_order, subscription_v2, payment_payload, mode })
  │              │
  │              ├─ guardSbsTariffMatch()           // §F пере-используется как есть
  │              │     → если mismatch: skip + audit (как сейчас) + return
  │              │
  │              ├─ idempotencyCheck()              // [NEW]
  │              │     SELECT orders_v2 WHERE provider='bepaid'
  │              │                       AND provider_payment_id = uid
  │              │     → existing? return { idempotent:true, order_id } БЕЗ повторных INSERT/grant
  │              │
  │              ├─ conflictCheck()                 // [NEW]
  │              │     SELECT payments_v2 WHERE provider_payment_id = uid
  │              │     → если есть, но привязан к ДРУГОМУ order (не REBILL для этого uid)
  │              │       → audit 'bepaid.rebill.conflict_uid' + meta.manual_review=true
  │              │       → return { skipped:true, reason:'conflict_uid' }
  │              │
  │              ├─ buildRebillOrderPayload()       // [NEW] чистый builder, тестируемый
  │              │     order_number = 'REBILL-' || substr(uid,1,12)
  │              │     status='paid', final_price=amount, paid_amount=amount
  │              │     provider='bepaid', provider_payment_id=uid
  │              │     bepaid_subscription_id = sbs
  │              │     pipeline_id/stage_id = parent.pipeline_id/stage_id
  │              │     created_at=paid_at, deal_date=paid_at
  │              │     meta = { source:'bepaid_rebill', payment_flow:'bepaid_subscription_charge',
  │              │              parent_order_id, materialized_from_payment_uid: uid,
  │              │              materialization_run:'bepaid_webhook_rebill_v1' }
  │              │
  │              ├─ if mode == 'dry_run':
  │              │     audit 'bepaid.rebill.dry_run' { planned_order_payload, planned_payment_link, planned_grant_call }
  │              │     return { dry_run:true }
  │              │
  │              └─ if mode == 'on':
  │                    INSERT orders_v2 (REBILL row)            // канон. write-path: тот же helper, что сейчас
  │                    INSERT/UPSERT payments_v2 с order_id = REBILL.id, provider_payment_id=uid
  │                          (если payment уже существовал на parent_order — UPDATE order_id на REBILL.id;
  │                           решение фиксируется в proof, не делаем DELETE)
  │                    invoke grant-access-for-order { order_id: REBILL.id }
  │                          → внутри сработает §F guard и canonical extend/grant logic
  │                    audit 'bepaid.rebill.materialized' { rebill_order_id, uid, sbs, parent_order_id, grant_result }
  │
  ├─ else if kind == refund:
  │     [NEW-rule] refund linking:
  │         resolve target order = orders_v2 WHERE provider_payment_id = parent_uid
  │         → если найден REBILL-order — refund пишется через RPC record_refund_atomic
  │           против ИМЕННО этого REBILL-order (не parent initial)
  │         → full-refund guard (см. §3.5): grant НЕ продлевается
  │
  └─ else: текущее поведение
```

## 3. Где что определяется

### 3.1 Recurring autocharge detection

- модуль: `supabase/functions/bepaid-webhook/classify_payment.ts` ([NEW] чистый билдер) либо in-place расширение существующего classifier;
- сигналы: `subscription_id` в payload + найден `subscriptions_v2` row + НЕ первый платёж под этим sbs (есть предыдущий `payments_v2.provider_payment_id` под этим sbs ИЛИ `subscriptions_v2.status='active'` уже было до этого webhook).

### 3.2 Создание / переиспользование REBILL-order

- модуль: `supabase/functions/bepaid-webhook/rebill_flow.ts` ([NEW]).
- Переиспользуется через `idempotencyCheck` (см. call graph).
- Создаётся через `buildRebillOrderPayload` + единый INSERT helper (не writeRaw).

### 3.3 Создание payment

- Сначала идемпотентность по `provider_payment_id`.
- Если payment уже есть, привязан к parent — UPDATE его `order_id` на REBILL.id (только в `mode=on`).
- Если payment отсутствует — INSERT с `order_id=REBILL.id`.
- Никаких side-effect insert'ов до прохождения idempotency + conflict checks.

### 3.4 Вызов grant

- ТОЛЬКО `invoke('grant-access-for-order', { order_id: REBILL.id })`.
- Никогда — по `parent_order_id`.
- Никаких прямых INSERT в `subscriptions_v2`/`entitlements`/`access_rules`/`telegram_*` из webhook.
- §F guard внутри `grant-access-for-order` остаётся единственным охранником SBS-mismatch.

### 3.5 Full-refund guard

- Перед `invoke grant`:
  - читаем суммарно по REBILL-order: `paidSum` vs `refundedSum` (та же формула, что в `partial-refund-state` memory);
  - если `refundedSum + 0.01 >= paidSum` (full refund на момент webhook) — grant НЕ вызывается;
  - audit `bepaid.rebill.skip_grant_full_refunded`.
- Это покрывает кейс «refund прилетел раньше / в той же пачке, что и autocharge-success retry».

### 3.6 Audit

Все события — в `audit_logs`:

- `bepaid.rebill.dry_run`
- `bepaid.rebill.materialized`
- `bepaid.rebill.idempotent_skip`
- `bepaid.rebill.conflict_uid`
- `bepaid.rebill.skip_grant_full_refunded`
- `bepaid.rebill.disabled` (mode=off, для observability — раз в N webhook'ов либо всегда, решаем в коде по объёму)

Каждый audit обязательно содержит: `mode`, `uid`, `sbs`, `parent_order_id`, `rebill_order_id?`, `payment_flow`, `decision`.

### 3.7 Duplicate uid (повторный webhook того же платежа)

- `idempotencyCheck` по `orders_v2.provider_payment_id=uid` → найден REBILL → return `idempotent_skip` без INSERT, без grant, audit только `idempotent_skip`.
- 0 дубликатов orders, 0 дубликатов payments, 0 повторных grant.

### 3.8 Conflict uid (тот же uid, но привязан к ЧУЖОМУ order)

- `conflictCheck` ловит ситуацию, когда `payments_v2.provider_payment_id=uid` есть, но соответствующий order — не REBILL для этого uid (например, исторический misбилд).
- Действие: НЕ создаём REBILL, НЕ вызываем grant, audit `conflict_uid`, `orders_v2.meta.manual_review=true` через **merge** (как в §F).
- Возврат HTTP 200, чтобы bePaid не ретраил бесконечно.

### 3.9 Partial / full refund

- partial — refund пишется атомарно через `record_refund_atomic` против REBILL-order, classifier UI показывает amber «Частичный возврат» по существующей формуле.
- full — то же + flag учитывается следующими webhook'ами этого же sbs (если внезапно прилетит ещё один success на тот же uid — отсечётся idempotency; если новый uid — пройдёт как новый REBILL-order, что корректно).

## 4. Новые/изменяемые файлы

```text
supabase/functions/bepaid-webhook/index.ts                  [edit] — встраивание rebillFlow за kill-switch
supabase/functions/bepaid-webhook/rebill_flow.ts            [NEW]  — pure orchestrator (функция, принимает deps)
supabase/functions/bepaid-webhook/rebill_builders.ts        [NEW]  — buildRebillOrderPayload, full-refund check
supabase/functions/bepaid-webhook/rebill_flow_test.ts       [NEW]  — Deno tests (см. §5)
supabase/functions/bepaid-webhook/rebill_builders_test.ts   [NEW]  — Deno unit tests чистых билдеров
.lovable/proofs/inv_bepaid_rebill_materialization_code_patch_2026_05.md  [NEW]
```

Чистые билдеры в отдельных модулях — чтобы тестировать без сети, как сделано для §F.

## 5. Тесты (Deno, оффлайн, fakes для supabase client)

Обязательные кейсы:

1. **autocharge creates REBILL-order** (mode=on, mocked client):
  - kind=recurring_autocharge, нет существующего uid, sbs+tariff match;
  - ожидание: 1 INSERT orders_v2 c order_number='REBILL-...', payment.order_id=REBILL.id, 1 invoke grant-access-for-order с REBILL.id;
  - audit: `bepaid.rebill.materialized`.
2. **payment linked to REBILL, not parent**:
  - предсуществующий payment с этим uid привязан к parent_order;
  - ожидание: UPDATE payments_v2.order_id → REBILL.id, parent_order не получает повторного grant.
3. **duplicate webhook idempotent**:
  - REBILL-order с этим uid уже существует;
  - ожидание: 0 INSERT, 0 invoke grant, audit `idempotent_skip`, HTTP 200.
4. **conflict uid → manual_review/audit**:
  - payment с этим uid есть, но привязан к чужому order, REBILL для uid отсутствует;
  - ожидание: 0 INSERT REBILL, 0 grant, audit `conflict_uid`, orders_v2.meta merge с `manual_review=true`.
5. **refund later links to REBILL payment**:
  - сначала materialized REBILL-order (fixture), затем приходит refund webhook с parent_uid;
  - ожидание: refund-row пишется против REBILL-order, не parent initial; classifier даёт partial/full корректно.
6. **full refunded order → no grant / no extend**:
  - перед autocharge webhook'ом для нового uid фикстурим REBILL с full refund (или одновременный refund в той же серии);
  - ожидание: full-refund guard не пускает grant, audit `skip_grant_full_refunded`.
7. **§F guard still passes** (anti-regression):
  - recurring autocharge, sbs mismatch с активной чужой подпиской;
  - ожидание: §F guard срабатывает внутри grant-access-for-order, новая sub-цепочка не создаётся, audit §F пишется как раньше; REBILL-order при этом всё равно НЕ создаётся, потому что mismatch ловится ДО invoke grant (rebillFlow зовёт guardSbsTariffMatch локально перед idempotencyCheck — синхронно с поведением grant-access-for-order, чтобы не плодить REBILL-orders без доступа).
8. **dry_run mode**:
  - всё то же, что в кейсе 1, но mode=dry_run;
  - ожидание: 0 INSERT/UPDATE orders_v2/payments_v2, 0 invoke grant, ровно 1 audit `bepaid.rebill.dry_run` с полным planned-payload.
9. **off mode**:
  - mode=off, recurring autocharge;
  - ожидание: новый код-путь не выполняется, поведение webhook идентично текущему (1 контрольный assert на отсутствие новых audit'ов).

Запуск: `supabase--test_edge_functions { functions: ["bepaid-webhook"] }`. Цель: 9/9 passed.

## 6. Anti-side-effect инварианты (фиксируются в proof)

- `subscriptions_v2`: 0 production INSERT/UPDATE из этого патча (всё идёт через invoke grant-access-for-order, который уже под §F).
- `entitlements`: 0.
- `access_rules`: 0.
- `telegram_*`: 0.
- `orders_v2`: INSERT REBILL-row только в `mode=on`; UPDATE meta — только merge при `conflict_uid`/`manual_review`.
- `payments_v2`: INSERT/UPDATE order_id только в `mode=on` под uid идемпотентность.
- `audit_logs`: записи по событиям §A.
- Миграций — 0.

## 7. DoD

- Код залит: `bepaid-webhook` index + 2 новых модуля + 2 test-файла.
- `BEPAID_REBILL_MATERIALIZATION` env присутствует, default `off` (фактическое значение в проде остаётся `off` — сам флаг при необходимости добавляется через secrets, без включения).
- Deno tests 9/9 passed (отчёт в proof).
- Proof-файл `inv_bepaid_rebill_materialization_code_patch_2026_05.md`:
  - diff-summary;
  - результаты тестов;
  - подтверждение `production DML = 0`, `migrations = 0`, `kill-switch=off`, `BEPAID_REBILL_MATERIALIZATION=on не включался`;
  - call graph (копия из §2);
  - перечень audit-кодов и их условий.
- §F regression-fixture зелёный (повторный прогон `grant-access-for-order` тестов).
- Никакого включения production `on`. Включение — отдельным approve после observability на dry_run.

## 8. Что НЕ входит в этап

- Sweep / repair исторических rebills (старые платежи, привязанные к parent initial-orders).
- Backfill REBILL-orders для уже произошедших autocharges.
- Изменения в UI сделок/платежей.
- Любые миграции БД.
- Production включение `mode=on`.

Эти пункты — отдельные под-планы после verify §A на dry_run.

---

После approve этого плана — выполняю code + tests + proof, **не трогая production data и не включая `on**`.