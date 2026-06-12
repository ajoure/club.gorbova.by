# PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 / F2 — Historical inventory

Дата: 2026-06-12
Этап: F2 (read-only)
Verdict: **PASS — no ambiguous / no conflicting; F3 разрешён к запуску**

## Метод

Inventory построен SQL-резолвером PI с тем же приоритетом, что и `_shared/stripe/card-enrichment.ts → resolvePaymentIntentFromRow`:

1. `meta.stripe.payment_intent_id`
2. `provider_payment_id` если соответствует `^pi_`
3. `meta.stripe.invoice.payment_intent`
4. `meta.provider_response.stripe.payment_intent_id`

`CONFLICTING_PAYMENT_INTENT_IDS` = >1 уникальное значение среди источников. `AMBIGUOUS` = >1 положительная Stripe-payment row с одним и тем же выбранным PI.

Snapshot completeness: `card_brand` + `card_last4` + `meta.stripe.payment_method_details.card` + `meta.stripe.payment_method_id` + `meta.stripe.charge_id` (зеркало `isCardSnapshotComplete`).

## Counts

| Metric | Value |
| --- | --- |
| total Stripe rows | 3 |
| positive payments | 2 |
| refund rows | 1 |
| ENRICHABLE | 2 |
| ALREADY_COMPLETE | 0 |
| NO_PAYMENT_INTENT | 0 |
| REFUND_INHERITS_PARENT | 1 |
| AMBIGUOUS | 0 |
| CONFLICTING_PAYMENT_INTENT_IDS | 0 |

## Per-row

| payment_id | amount | account_code | pi_chosen | pi_sources | verdict |
| --- | --- | --- | --- | --- | --- |
| 2d40bc7e-e69f-4633-88d5-102561e49a54 | 5.00 | stripe_poland | pi_3TgMkD6UYJj2vm0G1ZUpRzvH | 1 | ENRICHABLE (есть card_brand/card_last4, но нет canonical pmd/pm_id/charge_id) |
| 0da381ef-1286-4432-b929-c9df7502b5d4 | -5.00 | — | — | 0 | REFUND_INHERITS_PARENT |
| 00b39954-8180-44b7-8627-c84a0d63c9ef | 2.00 | stripe_poland | pi_3TgWoM6UYJj2vm0G1L9yYCCe | 1 | ENRICHABLE (нет card data) |

## Account_code distribution

- `stripe_poland`: 2 positive ENRICHABLE
- (refund row не имеет account_code; не используется для backfill)

## Bulk dry-run

**DEFERRED_REQUIRES_OPERATOR_JWT.** SQL-резолвер уже доказал: бэкендный candidate-selector (`pickCandidatesFromDb` в `stripe-card-data-fetch-bulk/index.ts:65-94`) использует ту же логику (фильтр `provider='stripe'`, `amount>0`, `provider_payment_id LIKE 'pi_%'`, account_code по `meta.stripe.account_code`/`meta.account_code`, completeness через `isCardSnapshotComplete`). Ожидаемый dry-run результат:
```
candidate_count = 2
candidates = [
  { payment_id: "2d40bc7e-...", payment_intent_id: "pi_3TgMkD6UYJj2vm0G1ZUpRzvH", verdict_pre: "ENRICHABLE" },
  { payment_id: "00b39954-...", payment_intent_id: "pi_3TgWoM6UYJj2vm0G1L9yYCCe", verdict_pre: "ENRICHABLE" }
]
updated = 0 (dry_run=true → нет execute)
```

Cross-check выполняется автоматически на старте F3 (run #1 SQL-counts vs response.summary). При расхождении → `INVENTORY_RESOLVER_MISMATCH`, F3 abort.

## Stop-condition

`AMBIGUOUS = 0` и `CONFLICTING_PAYMENT_INTENT_IDS = 0` → F2 не блокирует F3.

## Verdict F2

**PASS.** F3 targeted execute разрешён по `account_code='stripe_poland'` для 2 candidate (`pi_3TgMkD6UYJj2vm0G1ZUpRzvH`, `pi_3TgWoM6UYJj2vm0G1L9yYCCe`) после операторского запуска bulk dry-run и подтверждения candidate_count==2.
