да, согласен, с учетом правок:

1. **В Stage 1 не проверять “parent.updated_at не менялся” как hard FAIL.**  
`updated_at` мог измениться технически не из-за H5. Главное — проверить, что не менялись критичные поля parent:

```text
status
paid_amount
final_price
meta
deal_date
pipeline_id
pipeline_stage_id
```

`updated_at` можно фиксировать как warning, не blocker.

2. **Для Telegram проверить обе таблицы/источника, которые реально используются.**  
Не только `telegram_club_members`, но и фактические таблицы проекта, если используются:

```text
telegram_access
telegram_club_members
telegram_channel_members
telegram_access_queue
telegram_logs / telegram_messages только для подтверждения событий
```

3. **Paid orders с access-window > cutoff не определять эвристикой.**  
Если у order нет прямого access window, брать только через:

```text
subscription_v2
entitlement
access_rules
tariff access_days + paid_at/deal_date как справочный расчёт
```

И помечать как `expected_access_window`, а не факт доступа.

4. **Secondary/bonus access не считать ошибкой, если нет SOT-правила.**  
Для `bonus/secondary` сначала доказать источник:

```text
tariff_offers.meta.bonus_products / included_products
access_rules
product_fulfillment
products_v2.meta
```

Если правила нет — `no_rules_configured`, не `missing_secondary_access`.

5. **Добавить отдельный блок “H5 не должен был выдавать доступ”.**  
В proof явно подтвердить:

```text
REBILL-orders H5 имеют meta.do_not_grant_access=true
по H5 REBILL-orders не вызывался grant-access-for-order
не появились новые entitlements/subscriptions/Telegram из-за H5
```

6. **Для access audit добавить приоритет источников истины.**

```text
1. entitlements — техническая видимость
2. subscriptions_v2 — подписка/окно доступа
3. access_rules / tariff_offers — что должно быть выдано
4. Telegram membership — внешний факт, не замена platform access
```

7. **В CSV добавить поля для быстрого принятия решений:**

```text
customer
email
product
tariff
gap_class
severity
recommended_action
source_order
subscription_id
entitlement_id
telegram_expected
telegram_actual
secondary_expected
secondary_actual
```

8. **Severity добавить отдельно от gap_class.**

```text
critical — платный активный пользователь без primary access
high — Telegram/secondary отсутствует при наличии правила
medium — расхождение дат
low — no_rules_configured / informational
```

9. **Команда на запуск:**

```text
План H5-final verification + access consistency audit подтверждаю.

Выполни строго read-only:

- Stage 1: verify H5-final-bulk-remaining against DB;
- Stage 2: собрать remaining manual_review / skipped;
- Stage 3–5: access consistency audit после 17.05.2026;
- Stage 6: final status board.

Учти правки:
- parent.updated_at не hard blocker, проверять критичные поля parent;
- Telegram проверять по фактическим таблицам проекта;
- paid order access window считать только через subscription/entitlement/access rules;
- secondary/bonus считать missing только при наличии доказанного SOT-правила;
- добавить severity и recommended_action;
- отдельно подтвердить, что H5 REBILL не выдавал доступ и имеет do_not_grant_access=true.

Запрещено:
- DML;
- grant-access-for-order;
- Telegram grant/revoke;
- provider API;
- изменения subscriptions_v2 / entitlements / access_rules / secrets / mode;
- auto-fix.

Artifacts:
.lovable/proofs/h5_final_verification_status_board_2026_05.md
.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.md
.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.csv
```

После этого отчёта уже можно будет отдельно решать, что чинить: доступы, Telegram, secondary/bonus или оставшиеся refund/manual-review платежи.

&nbsp;

План: H5-final verification + access consistency audit

Режим: **read-only**. Никаких DML, grant-access, Telegram/provider API, изменений secrets/mode. Любые исправления — только отдельным approve после отчёта.

## Цель

1. Подтвердить, что отчёт `H5-final-bulk-remaining` (70 REBILL / 70 repointed payments) соответствует фактическому состоянию БД.
2. Зафиксировать всё, что осталось вне clean execute (manual_review / skipped / orphan).
3. Сделать аудит активных доступов с окончанием после `2026-05-17 00:00:00+00` и сверить их с правилами продукта/тарифа.

## Stage 1 — Verify H5 report against DB

SQL по `orders_v2` / `payments_v2` / `audit_logs`. Проверяем:

- `orders_v2`: count(meta.run='h5_final_bulk_remaining_2026_05') = 70; все REBILL-%; у каждого `meta.source='h5_historical_repair'`, `meta.do_not_grant_access=true`, `parent_order_id` валиден; ровно 1 payment на REBILL.
- `payments_v2`: count(meta.rebill_materialization.run=...) = 70; каждый указывает на REBILL; ни один больше не висит на parent.
- Parent orders: каждый сохранил ≥1 succeeded non-refund payment; parent.meta/updated_at не менялись после snapshot.
- Контрольные ассерты: `b458870d → REBILL-b458870d-cfa`, `5fc22e49 → REBILL-5fc22e49-9e1`, `8c78c039` остался на `SUB-LINK-MLNYCZPF`, `ffb88444 → REBILL-ffb88444-c5d`, `b9d946d4 / 0f854c28 / 6bfead3b` не тронуты.
- Sanity vs baseline: `subscriptions_v2` (449), `entitlements` (931), `provider_subscriptions` (565), Σepoch(access_end_at)/Σepoch(expires_at) совпадают; `refunds`, `telegram_club_members`, `access_rules` без изменений (по updated_at > snapshot).

## Stage 2 — Remaining broken/skipped cases

Single таблица всех, кто остался вне clean execute. Колонки: customer, email, payment_id, amount, paid_at, current_order, reason, recommended_next_action.

Категории:

- `manual_review:refund_or_tariff_upgrade_flow` (b9d946d4 — Хрущёва)
- `manual_review:refund_related` (0f854c28)
- `manual_review:parent_would_be_orphaned` (6bfead3b, ab0ffa83 и т.п.)
- `manual_review:sbs_unresolved`
- `intentionally_kept_initial` (8c78c039 — collective guard)
- `skip_done` (ffb88444)
- `orphan refund rows`

Источник: `h5_refresh_v2_frozen_candidates_2026_05.csv` minus 70 executed + актуальный re-scan по `payments_v2` за окно H5.

## Stage 3 — Access consistency audit

`cutoff = '2026-05-17 00:00:00+00'`.

Собрать union users с любым из:

- `subscriptions_v2.access_end_at > cutoff`
- `entitlements.expires_at > cutoff` (или `expires_at IS NULL` со status='active')
- `telegram_club_members.access_status='ok'` или active membership
- paid `orders_v2` (включая REBILL), у которого access-окно > cutoff

Для каждого (user × product) собрать строку: customer, email, product, tariff, source_order, latest_payment, subscription_v2 (id/status/access_start_at/access_end_at/tariff_id/auto_renew), entitlement (id/status/expires_at/product_id/meta.tariff_id/source_order_id), Telegram (expected/actual/active_until/access_status), access_rules expectation (product/Telegram/training/bonus).

## Stage 4 — Product rules validation

Сверка по `access_rules` / `tariff_offers` / `products_v2`:

- **Primary entitlement**: продукт/тариф требует доступ → entitlement существует, `expires_at ≥ subscription.access_end_at` (или объяснение), `product_id` и `meta.tariff_id` совпадают с заказом.
- **Subscription**: recurring → есть `subscriptions_v2`; status соответствует фактическому доступу; access_end_at > cutoff если доступ активен.
- **Telegram**: если `access_rules` требует — есть активная связь; если не требует — отсутствие не ошибка; если TG есть без entitlement/subscription → anomaly.
- **Bonus/secondary**: правила есть → проверить вторичные entitlements; правил нет → `no_rules` (не ошибка); правила есть и доступа нет → `missing_secondary_access`.

## Stage 5 — Gap classification

Проставить `gap_class` ∈ { ok, missing_primary_entitlement, missing_subscription, subscription_without_entitlement, entitlement_without_subscription, telegram_without_platform_access, missing_telegram_access, expired_entitlement_but_active_subscription, access_end_mismatch, tariff_mismatch, missing_secondary_access, manual_review_required, no_rules_configured }.

## Stage 6 — Final status board

Сводная таблица:


| Блок                             | Статус    | Count | Комментарий   |
| -------------------------------- | --------- | ----- | ------------- |
| H5 clean REBILL repaired         | PASS/FAIL | …     | факт vs отчёт |
| Remaining manual_review payments | …         | …     | по категориям |
| Active subscriptions after 17.05 | …         | …     | …             |
| Active entitlements after 17.05  | …         | …     | …             |
| Missing primary access           | …         | …     | …             |
| Missing Telegram access          | …         | …     | …             |
| Missing secondary/bonus access   | …         | …     | …             |
| Access-rule gaps                 | …         | …     | by gap_class  |


## Артефакты

- `.lovable/proofs/h5_final_verification_status_board_2026_05.md` — финальный статус-борд + Stage 1–2.
- `.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.md` — Stage 3–5: methodology, ассерты, аномалии.
- `.lovable/proofs/h5_access_consistency_audit_after_2026_05_17.csv` — построчная таблица (user × product) с gap_class.

## Запрещено

DML/INSERT/UPDATE/DELETE; grant-access-for-order; Telegram grant/revoke; provider API; изменения subscriptions_v2 / entitlements / access_rules / secrets / mode; auto-fix.

## DoD

1. H5-final-bulk-remaining подтверждён или зафиксировано расхождение.
2. Полный список оставшихся manual_review / skipped собран.
3. Аудит активных доступов после 17.05.2026 собран по всем пользователям.
4. Для каждого (user × product): есть/нет доступа, срок, соответствие правилам, Telegram, secondary/bonus.
5. Все проблемы классифицированы `gap_class`.
6. БД не менялась — подтверждено сравнением счётчиков/sum'ов с pre-execute baseline.