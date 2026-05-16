да, согласен, с учетом правок:

1. **В Step 1 не останавливать весь план, если count ≠ 7.**  
Лучше так:

```text
Если count ≠ 7:
- всё равно выполнить read-only классификацию 4 уже найденных out-of-scope пар;
- зафиксировать новый count как blocker для execute;
- H3.x-b-execute не approve до нового H4 preconditions.
```

2. **Уточнить “4 пары” как конкретный список после пересчёта.**  
В proof обязательно показать:
  - какие 3 пары исключены как уже описанные;
  - какие 4 пары вошли в текущий H3.x-b2;
  - если появились новые пары сверх 7 — вынести их в отдельный список `new_out_of_scope_not_classified`.
3. `telegram_access` **может не быть фактической таблицей.**  
Использовать фактическую схему проекта:
  &nbsp;
  &nbsp;
  - `telegram_access`, если есть;
  - `telegram_club_members`;
  - `telegram_access_queue`;
  - или фактический equivalent.  
  В proof указать, какие таблицы реально существуют.
4. `access_rules subject_type='subscription'` **не предполагать заранее.**  
Сначала schema verification. Если такого поля/значения нет — использовать JSON/text search и отметить `field_missing`.
5. **Классификация** `post_H3xa_deploy` **должна использовать точное время deploy H3.x-a.**  
В proof указать deploy timestamp, а не просто “после deploy”.
6. **Добавить проверку, связаны ли пары с сегодняшним/последним bePaid autocharge.**  
Для каждой из 4 пар показать:
  - была ли создана в результате autocharge;
  - public checkout;
  - admin action;
  - webhook;
  - sync/polling.  
  Это важно для решения, виноват ли H3.x-a или другой flow.
7. **Root-fix verdict должен быть строгим:**
  - `confirmed` — если все 4 legacy/pre-deploy;
  - `incomplete` — если есть post-H3.x-a duplicate через защищённый flow;
  - `not_applicable` — если duplicate создан manual/admin flow вне H3.x-a;
  - `inconclusive` — если не хватает audit/order linkage.
8. **Planned execute пока не формировать как действие.**  
Для каждой пары писать только:
  - `likely_safe_execute_candidate`;
  - `manual_review`;
  - `defer_until_lock`;
  - `needs_more_discovery`.  
  Без конкретных update-инструкций до execute-plan.
9. **Добавить запрет на provider API.**  
Не только cancel/create, но и live pull, если это не read-only через уже сохранённые данные. Если нужен live provider pull — отдельное approve.
10. **Добавить итоговый блок “что это меняет для H4 mode=on”.**

&nbsp;

```text
H4 remains blocked / unblocked only if:
- no post-H3.x-a duplicates from protected flows;
- all 7 pairs classified;
- safe execute plan prepared or manual_review accepted.
```

После этих правок план можно запускать как read-only классификацию.

&nbsp;

План: H3.x-b2 — classify 4 out-of-scope duplicate subscription pairs

## Цель

Read-only классификация 4 дополнительных duplicate-пар `subscriptions_v2`, выявленных в H3.x-b dry-run (всего 7 пар, 3 уже описаны). Понять происхождение каждой пары, проверить, не сломался ли root-fix H3.x-a, и подготовить решение: объединить все 7 пар в один execute-plan или разделить на `safe_execute` / `manual_review`.

## Жёсткие ограничения (запрещено)

- DML любого вида (UPDATE/INSERT/DELETE) на проде.
- Любые migrations.
- Любой вызов `bepaid-cancel-subscriptions`, `bepaid-create-subscription*`, `grant-access-for-order`, `telegram-*`, `direct-charge`.
- Изменение секрета `BEPAID_REBILL_MATERIALIZATION` (остаётся `dry_run`).
- Включение `mode=on` где-либо.
- Любые правки edge functions, RPC, триггеров, cron jobs.
- Любые действия по 3 уже описанным парам (`1b68252b`, `3c6d812a`, `7261e727`) — они out of scope для этого плана.

Разрешено только: `SELECT` запросы через `supabase--read_query` / `supabase--analytics_query` и запись proof-файла.

## Scope

Ровно 4 пары: `total active duplicates − 3` из H3.x-b dry-run. Если глобальный `COUNT(*)` изменится (стало не 7, а больше) — STOP plan, отдельный H4 preconditions audit.

## Шаги (read-only)

1. **Глобальный пересчёт duplicate-пар.**
  `SELECT user_id, product_id, COUNT(*), array_agg(id ORDER BY created_at)` из `subscriptions_v2` где `status IN ('active','trial','past_due')` GROUP BY → HAVING COUNT > 1.
  - Если итог ≠ 7 — STOP, фиксируем в proof, новый H4.
  - Исключаем 3 пары из H3.x-b → получаем target list из 4.
2. **Schema verification** (повторно, без доверия памяти):
  - подтвердить колонки `subscriptions_v2`: `id, user_id, product_id, tariff_id, status, auto_renew, access_end_at, last_paid_at, next_charge_at, billing_type, created_at, updated_at, meta`;
  - `provider_subscriptions`: `subscription_v2_id, external_subscription_id, state, provider, last_synced_at, meta`;
  - `orders_v2` linkage: `subscriptions_v2.meta.initial_order_id`, `meta.checkout_order_id`, `meta.extended_by_orders[]`;
  - `payments_v2.order_id`, `entitlements.user_id/product_id/expires_at/source_order_id/meta.source_subscription_v2_id`;
  - `telegram_access` (active_until, club_id), `access_rules` (subject_type='subscription').
3. **Снимок каждой из 4 пар** (по 2 sub в паре):
  - profile: id / email / full_name;
  - product (id, name), tariff (id, name, access_days);
  - обе строки `subscriptions_v2` (все поля выше + полный `meta`);
  - все `provider_subscriptions` по обеим sub_v2_id (state, external_subscription_id, last_synced_at);
  - все `orders_v2`, ссылающиеся на любой из двух sub через `meta.initial_order_id` / `meta.checkout_order_id` / `meta.extended_by_orders[]` / `meta.subscription_v2_id`;
  - связанные `payments_v2` (status, amount, paid_at, provider_payment_id);
  - все `entitlements` пользователя по этому product_id (expires_at, source, meta.source_subscription_v2_id, meta.source_order_id, meta.tariff_id);
  - `telegram_access` / `telegram_access_queue` строки (active_until, club_id, source) — только чтение;
  - `access_rules` строки, ссылающиеся на любой из двух sub_v2_id;
  - `audit_logs` за окно `min(created_at) − 1d … max(updated_at) + 1d` по обоим sub_v2_id и связанным order_id (actions: `subscription.*`, `bepaid.*`, `grant-access-for-order.*`, `bepaid-webhook.*`, `bepaid_rebill.*`).
4. **Классификация источника появления** (per pair). Источник = один из:
  - `legacy_pre_H2` — обе sub созданы до даты deploy H2 root-pre-create guard;
  - `legacy_between_H2_and_H3xa` — созданы между H2 и H3.x-a deploy;
  - `post_H3xa_deploy` — хотя бы одна sub создана **после** даты deploy H3.x-a (см. proof H3.x-a);
  - `race_condition_B1` — обе sub созданы из одного `order_id` или в окне ≤5 минут от одного checkout-события;
  - `admin_manual` — есть запись `bepaid-admin-create-subscription-link` / ручной insert в audit_logs;
  - `unknown` — ни один из критериев не доказуем.
5. **Анализ root-fix H3.x-a.**
  - Если ≥1 пара = `post_H3xa_deploy` AND `race_condition_B1` → пометить root-fix как **incomplete**, эскалировать H3.x-a-migration (advisory lock / unique partial index) до execute.
  - Если все 4 = legacy → root-fix H3.x-a подтверждён рабочим, остаётся только cleanup.
  - Если admin_manual — фиксируем процесс-инцидент, root-fix не виноват.
6. **Risk checks per pair** (без действий):
  - оба `provider_subscriptions.state IN ('active','pending')` с **разными** `external_subscription_id` → `manual_review` (нельзя auto-merge);
  - один `external_subscription_id` повторяется в обеих sub → провайдер видит одну подписку, локальный split — безопасно для cleanup;
  - `GREATEST(access_end_at)` совпадает с canonical canonical-chain (provider safety > access_end_at > paid_orders_count > last_paid_at > updated_at) → если canonical имеет меньший `access_end_at`, чем дубль → STOP-guard `risk_access_reduction`;
  - есть `installment_payments.status='pending'` по любой sub → `manual_review`;
  - `access_rules` ссылается на duplicate sub_v2_id → `manual_review`.
7. **Финальное решение per pair** (только в proof, без execute):
  - `safe_execute_candidate` — нет ни одного STOP-guard, понятный canonical, rollback sketch применим;
  - `manual_review` — хотя бы один STOP-guard или unknown источник;
  - `defer_until_H3xa_migration` — пара post-H3.x-a race; cleanup только после advisory lock / unique index.
8. **Сводка по всем 7 парам** (3 из H3.x-b + 4 новые):
  - таблица: pair_id | source | provider_state | risk | verdict;
  - распределение по execute-bucket: `safe_execute_candidate` / `manual_review` / `defer_until_H3xa_migration`;
  - рекомендация: единый H3.x-b-execute (если все safe) ИЛИ split на 2 плана.

## Proof

`.lovable/proofs/h3x_duplicate_subscriptions_out_of_scope_classification_2026_05.md`

Структура:

1. Scope check (global duplicate count, 7 expected).
2. Schema verification (per table, field_missing markers).
3. Per pair (4 секции): snapshot → orders/payments → entitlements → telegram → audit timeline → source classification → risk checks → verdict + rollback applicability.
4. Root-fix H3.x-a assessment (verdict: confirmed / incomplete / inconclusive).
5. Aggregate table по 7 парам.
6. Рекомендация: единый execute-plan или split.
7. DoD: 0 DML, 0 migrations, 0 provider cancel, 0 grant, 0 telegram, secret `dry_run`, `mode=on` disabled, 3 in-scope пары не тронуты.

## DoD

- Proof существует и содержит все 7 пар в сводке + 4 новые в деталях.
- Каждой паре присвоен source и verdict.
- Дано явное заключение по root-fix H3.x-a.
- Production DML = 0, migrations = 0, edge function calls = 0 (кроме `read_query`).
- 3 in-scope пары из H3.x-b не упомянуты в planned actions.
- `BEPAID_REBILL_MATERIALIZATION = dry_run`, `mode=on` disabled.
- Сформирована рекомендация по структуре H3.x-b-execute (единый или split).

## После plan

Только после approve этого классификационного отчёта — отдельный план H3.x-b-execute (или два плана). Никаких execute до этого.