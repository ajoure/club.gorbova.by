да, согласен, с учетом правок:

1. Материализовать **только rebill-платежи**, не первый платёж parent-order.
2. Перед INSERT проверить, есть ли уже order с:
  &nbsp;
  - `meta.materialized_from_payment_id = payments_v2.id`
  - или `provider_payment_id = payments_v2.provider_payment_id`  
  Если есть — skip, не создавать дубль.
3. `payments_v2.order_id` переносить только для платежей, у которых:
  - `status='succeeded'`
  - `order_id = parent_order_id`
  - `paid_at` в другом месяце, чем `parent.meta.deal_month`
  - нет уже materialized child-order.
4. `grant-access-for-order` после материализации лучше **не запускать по умолчанию**. Это не выдача доступа, а нормализация CRM/order history. Month-gate починится через `orders_v2.meta.deal_month`.
5. В `orders_v2.meta` обязательно добавить:
  - `source='rebill_materialization'`
  - `parent_order_id`
  - `materialized_from_payment_id`
  - `original_parent_deal_month`
  - `deal_month`
  - `do_not_grant_access=true`
  - `materialization_run`
6. В dry-run отдельно показать:
  - сколько новых child-orders будет создано;
  - сколько payments будет перепривязано;
  - сколько skipped как already_materialized;
  - сколько skipped из-за missing `paid_at/deal_month/provider_payment_id`.
7. Execute делать только после отдельного dry-run отчёта, не сразу.

&nbsp;

&nbsp;

План:

## Контекст и диагноз

Проведена разведка по двум продуктам за 2026 год:


| Продукт                                     | paid orders | succeeded payments | Δ (лишние платежи) |
| ------------------------------------------- | ----------- | ------------------ | ------------------ |
| Gorbova Club (BUSINESS/CHAT/FULL/ИДЕОЛОГИЯ) | 551         | 788                | ~237               |
| Бухгалтерия как бизнес (Ежемесячный доступ) | 80          | 112                | ~32                |
| **Итого**                                   | **631**     | **900**            | **~269**           |


**Корневая причина** (на примере Вероники Матук, order `edb760eb…`, BUSINESS, deal_month=`2026-02`):
подписка bePaid (`sbs_…`) делает rebill каждый месяц. Webhook `bepaid-webhook` добавляет каждое успешное списание в `payments_v2` с тем же `order_id` исходной сделки. **Новый `orders_v2` для следующего месячного периода не создаётся.** В итоге у клиента: 1 сделка (deal_month=2026-02) и 3 успешных платежа (фев/март/апр). RPC `has_month_purchase_bulk` читает только `orders_v2.meta.deal_month` — и для марта/апреля видит «нет покупки» → доступ к контенту блокируется.

Все 269 «лишних» платежей нужно поднять до уровня самостоятельных paid-сделок.

## Цель

Привести 2026 год к инварианту:
**1 успешный платёж = 1 успешная сделка с правильным `deal_month` = записью в кабинете и Kanban**, не сломав ни один действующий доступ. Только данные, без новых функций/таблиц/RPC.

Скоуп: только `Gorbova Club` (`11c9f1b8…`) и `Бухгалтерия как бизнес` (`85046734…`), только период `[2026-01-01; 2027-01-01)`, только статусы `succeeded` платежей и `paid` сделок.

## Принципы

1. **Без новых сущностей.** Используем существующие `orders_v2`, `payments_v2`, `subscriptions_v2`, `crm_pipelines/stages`, RPC `has_month_purchase_bulk`, edge `grant-access-for-order` (он уже идемпотентный и алиасный к продлению того же тарифа — см. memory `extend-tariff-match-required`).
2. **Доступы не трогаем.** `entitlements`, `access_rules`, `subscriptions_v2` остаются как есть. Создание дочерних paid-ордеров **только заполняет историю** (deal_month) и не вызывает revoke/extend. `grant-access-for-order` для дочерних ордеров вызываем в режиме «idempotent extend на тот же tariff_id» — если у пользователя уже есть подписка на тот же тариф с access_end_at >= ожидаемого периода, операция no-op (что подтверждается canonical-write-path standard).
3. **rule_engine синтетика исключена** (memory `synthetic-order-analytics-safety`). Уже подтверждено: synthetic_paid=0 в скоупе.
4. **Каждое действие — через миграцию + audit_logs** (`actor_type='system'`, `actor_label='rebill_orders_materialization_2026'`).
5. **Dry-run перед каждым шагом**, hard-stop, если численные guard-ы не сходятся.

## План работ

### Шаг 1 — Полный аудит-отчёт (read-only)

Сгенерировать `.lovable/proofs/rebill_orders_audit_2026.md`:

- по каждому (`product_id`, `tariff_id`):
  - paid_orders, succeeded_payments, ожидаемое количество сделок (= succeeded_payments), дельта;
  - распределение «лишних» платежей по `to_char(paid_at,'YYYY-MM')`;
  - количество ордеров с `>1` succeeded платежом;
  - пересечение ордера и платежа по deal_month (сколько платежей попадают в чужой месяц);
- список всех «materialization-кандидатов» (payment_id → parent_order_id → ожидаемый deal_month → tariff_id, product_id, user_id, profile_id, amount, paid_at).

Stop-условие: дельта (лишние платежи) ≠ количеству кандидатов → STOP, ручная сверка.

### Шаг 2 — Pipeline/stage маппинг (read-only)

Для каждой пары (`product_id`, `tariff_id`) определить целевой `pipeline_id` и `pipeline_stage_id` (стадия типа «успешная»), используя ту же логику, что у parent-ордера: copy `pipeline_id` и `pipeline_stage_id` из родителя. Это удовлетворяет default-pipeline-scope и kanban-management.

Stop-условие: у parent нет pipeline_id/stage_id → попытаться разрешить через `crm_pipeline_product_bindings`; если не получилось — пометить кандидата как `pipeline_unresolved`, оставить NULL (memory `deal-assignment-rules-v2` это допускает).

### Шаг 3 — Dry-run материализации (миграция + транзакция, ROLLBACK)

В транзакции:

- для каждого «лишнего» payment строим payload `orders_v2` (новый id):
  - `user_id, profile_id, product_id, tariff_id` ← из parent;
  - `final_price, paid_amount, currency` ← из payment;
  - `status='paid'`;
  - `provider='bepaid'`, `provider_payment_id` ← payment.provider_payment_id;
  - `bepaid_subscription_id` ← из subscriptions_v2 этого parent (через `meta.bepaid_subscription_id`);
  - `created_at, updated_at, deal_date` ← `payment.paid_at`;
  - `meta`:
    - `deal_month` = `to_char(payment.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')`;
    - `payment_flow='bepaid_subscription_charge'`;
    - `source='rebill_materialization'`;
    - `parent_order_id=<parent>`;
    - `materialized_from_payment_id=<payment.id>`;
    - `materialization_run='rebill_orders_materialization_2026'`;
  - `pipeline_id, pipeline_stage_id` ← из шага 2;
  - `order_number` ← последовательность как у обычной вставки (если есть default — оставить; если нет — сгенерировать суффикс `-R{n}` от parent.order_number);
- `payments_v2.order_id` для этого payment **переключаем** с parent на новый order;
- генерируем `audit_logs` запись на каждое изменение;
- НЕ запускаем `grant-access-for-order`, НЕ трогаем `entitlements/access_rules/subscriptions_v2`;
- финальный `SELECT` сверяет инварианты (см. ниже) и затем `ROLLBACK`.

**Инварианты dry-run (hard-stop при нарушении):**

1. Сумма `paid_amount` всех новых orders = сумма amount материализуемых платежей.
2. После переноса: для скоупа выполняется `succeeded_payments_count = paid_orders_count`.
3. Все новые orders имеют непустой `deal_month` и валидный формат `YYYY-MM`.
4. Ни одна `subscriptions_v2.access_end_at` не уменьшилась (мы её не трогаем — проверка контрольная).
5. Ни одна запись в `entitlements` не изменена (контрольная).
6. Нет дубля `(provider, provider_payment_id)` в `orders_v2` после переноса (UNIQUE-safe).
7. Все новые orders имеют `tariff_id` строго из набора tariff_id parent-ов (tariff scope не дрейфит).

Артефакт: `.lovable/proofs/rebill_orders_dryrun_2026.md` — before/after counts по продукту×тарифу×месяцу + list 20 примеров.

### Шаг 4 — Execute (та же миграция без ROLLBACK) при апруве

После апрува dry-run отчёта — выполнить тот же блок без ROLLBACK + те же контрольные SELECT-ы после COMMIT, дополненные:

- COUNT(*) FROM `orders_v2` WHERE meta.materialization_run='rebill_orders_materialization_2026' = N (ожидаемое);
- payments_v2 без order_id = 0;
- payments_v2, привязанных к parent сверх 1, = 0.

Если хоть один инвариант не выполнен — миграция падает, ничего не закоммичено (всё в одной транзакции).

### Шаг 5 — Опциональный idempotent grant-access (safety net)

Для каждого нового order вызвать `grant-access-for-order` (canonical write-path). По memory `extend-tariff-match-required` и `grant-access-idempotency` — для совпадающего `tariff_id` и уже активной подписки результат будет no-op + audit `skip_extend_tariff_mismatch`/`already_active`. Это страхует от расхождений без риска сократить доступ.

Гард: если `grant-access-for-order` вернул `decision != extended|already_active|no_change` — STOP, дальнейшие вызовы прекращаются, ручной разбор.

### Шаг 6 — Verify (read-only)

Артефакт `.lovable/proofs/rebill_orders_verify_2026.md`:

- per-product table: paid_orders == succeeded_payments;
- 0 ордеров с >1 succeeded payment;
- 100% paid orders имеют deal_month;
- spot-check Вероника Матук (`014f5822-01e2-42ec-aee1-df1c80d1ba18`): должны появиться отдельные сделки за фев/мар/апр по обоим продуктам;
- сверка `subscriptions_v2.access_end_at` до/после = идентичны;
- сверка `entitlements` (count + max(expires_at) per user) до/после = идентичны;
- проверка `month_gate_smoke_2026_05_01.md` зелёная.

## Технические детали (для ревью)

ASCII-схема того, что меняется для одного rebill-кейса:

```text
ДО:
orders_v2[parent, deal_month=2026-02, status=paid]
   └─ payments_v2[p1 fev, succeeded]
   └─ payments_v2[p2 mar, succeeded]   ← «лишний»
   └─ payments_v2[p3 apr, succeeded]   ← «лишний»

ПОСЛЕ:
orders_v2[parent, deal_month=2026-02, status=paid]
   └─ payments_v2[p1 fev]
orders_v2[child-mar, deal_month=2026-03, status=paid, parent_order_id=parent]
   └─ payments_v2[p2 mar]
orders_v2[child-apr, deal_month=2026-04, status=paid, parent_order_id=parent]
   └─ payments_v2[p3 apr]

subscriptions_v2[…]              ← НЕ трогаем
entitlements[…]                  ← НЕ трогаем
access_rules[…]                  ← НЕ трогаем
```

Затронутые таблицы: `orders_v2` (INSERT, ~269 строк), `payments_v2` (UPDATE order_id, ~269 строк), `audit_logs` (INSERT). Никаких новых функций, RPC, edge functions, schema changes.

## DoD

1. Артефакты: `rebill_orders_audit_2026.md`, `rebill_orders_dryrun_2026.md`, `rebill_orders_verify_2026.md`.
2. Per-product инвариант `paid_orders == succeeded_payments` выполнен.
3. Все новые orders имеют `meta.deal_month`, `parent_order_id`, `materialized_from_payment_id`, `materialization_run`.
4. `subscriptions_v2.access_end_at` и `entitlements.expires_at` побайтово равны pre-state (доступы не пострадали).
5. Spot-check Вероника Матук показывает раздельные сделки по месяцам в кабинете и в Kanban.
6. RPC `has_month_purchase_bulk` для затронутых пользователей возвращает `true` для всех месяцев, в которых был успешный платёж.
7. `month_gate_smoke_2026_05_01.md` зелёный.
8. Нет ни одного нового файла кода, RPC, edge function — только миграция данных + proof'ы.

После апрува переключаюсь в режим выполнения: Шаг 1 → Шаг 2 → Шаг 3 (dry-run + отчёт на ваш просмотр) → апрув → Шаг 4 → Шаг 5 → Шаг 6.