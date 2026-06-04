# GAP-C.1 — Existing Stripe Objects Discovery (proof v1)

Дата: 2026-06-04
Режим: read-only.
Цель: убедиться, что для пилотного оффера `6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`
нет уже созданных `prod_*` / `price_*` ни в нашей БД, ни в Stripe (account `stripe_poland`, test mode),
чтобы исключить риск создания дубликата на этапе GAP-C provisioning.

## 1. Инструменты

- DB read-only через `psql` (`SELECT` по 8 источникам).
- Read-only edge function **`stripe-discovery-objects`** (super_admin guard,
  без мутаций, фолбэк через `_shared/acquiring/vault.ts → readAcquiringSecret('stripe', 'stripe_poland', 'secret_key')`).
- Stripe REST API: `GET /v1/products?limit=100&active=...`, `GET /v1/prices?limit=100&active=...`.

## 2. DB Discovery — результаты

| Источник | Метрика | Значение | Вывод |
|---|---|---|---|
| `tariff_offers` (пилот `6f306cbc…`) | `meta->'stripe'` | `NULL` | чисто |
| `tariff_offers` (все) | офферов с `meta ? 'stripe'` | `0 / 38` | чисто |
| `products_v2` | строк с `meta ? 'stripe'` | `0` | чисто |
| `bepaid_product_mappings` | `provider='stripe'` | `0` | чисто |
| `provider_subscriptions` | `provider='stripe' OR provider_subscription_id LIKE 'sub_%'` | `0 / 712` | чисто |
| `payment_links` | `meta` содержит `price_*` или `prod_*` | `0` | чисто |
| `payments_v2` | `meta ? 'stripe'` или содержит `price_*/prod_*` | `33` записей с подстрокой `price_`/`prod_` — все ложные срабатывания (substring в `amount_source=tariff_price_fallback`, `full_payment_offer_id` и т. п.); реальный Stripe id найден только в `1` записи `meta.source='admin_stripe_sandbox_simulation'` с `checkout_session_id=cs_sim_*` (это симулированный sandbox-cs, не настоящий `cs_*`/`price_*`) | чисто |
| `payment_settings` | ключи с `stripe` или значения с `price_/prod_` | `0` | чисто |
| `acquiring_connections` (`stripe_poland`) | `status=active`, `test_mode=true`, currencies включают `byn` | ✅ | готов |

## 3. Stripe API Discovery (acct `acct_1Tc88d6UYJj2vm0G`, PL, test mode)

Вызов `GET /functions/v1/stripe-discovery-objects?account_code=stripe_poland&tariff_offer_id=6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e`
вернул HTTP 200, response (`summary` блок):

```json
{
  "products_active_total": 0,
  "products_all_total": 5,
  "products_has_more": false,
  "prices_active_total": 5,
  "prices_all_total": 5,
  "prices_has_more": false,
  "matching_products_for_offer": 0,
  "matching_prices_for_offer": 0
}
```

`db_offer_meta_stripe` = `null`.

### 3.1 Все 5 Stripe Products в test-аккаунте

| `prod_id` | `name` | `active` | `metadata.purpose` | `metadata.do_not_use` |
|---|---|---|---|---|
| `prod_Udupbe3GRUEJdK` | `GAPA_PLN_PROBE_DO_NOT_USE` | `false` | `gap_a_byn_capability_proof` | `true` |
| `prod_UdupelYtLY2cHl` | `GAPA_EUR_PROBE_DO_NOT_USE` | `false` | `gap_a_byn_capability_proof` | `true` |
| `prod_UduppXgssKcQWi` | `GAPA_BYN_PROBE_DO_NOT_USE` | `false` | `gap_a_byn_capability_proof` | `true` |
| `prod_UdupC3Ie9jQQjW` | `GAPA_BYN_PROBE_DO_NOT_USE` | `false` | `gap_a_byn_capability_proof` | `true` |
| `prod_Udup1KuyJVCgni` | `GAPA_BYN_PROBE_DO_NOT_USE` | `false` | `gap_a_byn_capability_proof` | `true` |

### 3.2 Все 5 Stripe Prices

Все 5 привязаны к продуктам из 3.1, имеют `metadata.purpose = "gap_a_byn_capability_proof"`,
`unit_amount = 100` (диагностические), валюты `pln / eur / byn / byn / byn`,
`recurring = month/1 | year/1 | null` (включая один one-time для проверки контракта).

Ни один из 5 prices/products **не имеет** `metadata.tariff_offer_id`,
и ни один **не привязан** к нашему пилотному офферу `6f306cbc…`.

## 4. Вердикт C.1

| Критерий | Результат |
|---|---|
| Существующий Product для пилотного оффера в Stripe | **не найден** (0 совпадений) |
| Существующий Price для пилотного оффера в Stripe | **не найден** (0 совпадений) |
| Существующий mapping в БД (`tariff_offers.meta.stripe`) | **не найден** (NULL) |
| Legacy mapping (`bepaid_product_mappings`, `provider_subscriptions`, `payment_links`, `payments_v2`, `payment_settings`) | **не найден** |
| `acquiring_connections.stripe_poland` готов к provisioning | ✅ |
| Риск дубликата при provisioning | **отсутствует** |

**C.1 = PASS.** Можно переходить к C.2–C.7 (provisioning idempotency + write-path + dry-run + execute).

## 5. Backlog (отдельно, не блокирует GAP-C)

- 5 диагностических Stripe объектов GAP-A (`GAPA_*_DO_NOT_USE`, все `active=false`) — оставить как есть, метка `do_not_use=true` уже гарантирует, что они не будут переиспользованы. Stripe не позволяет удалять Products/Prices — только архивировать (уже сделано).
- `stripe-discovery-objects` оставляется в проекте как постоянный read-only diagnostic для будущих provisioning-проверок и аудитов.

## 6. Что было НЕ затронуто

- Никаких `POST /v1/products`, `POST /v1/prices`, мутаций `tariff_offers.meta` — Discovery полностью read-only.
- bePaid pipeline не затронут.
- Никаких миграций.

## 7. Следующий шаг

GAP-C.2–C.7: написать `admin-provision-stripe-price` с idempotent контрактом
(C.2), audit trail (C.5), multi-account dual-write (C.6), обязательным
dry-run режимом, и прогнать через STOP-GATE C.7 на пилотном оффере
`6f306cbc…` (BYN 100.00, `recurring=month/1`, account `stripe_poland`).
