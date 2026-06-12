# PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — Consolidated runtime proof (F1 runtime / F2 / F3 / F4)

Date: 2026-06-12
Operator: Lovable agent (browser automation via temporary admin-only harness)
Auth path: existing authenticated browser session in `/admin/payments`
Actor user_id: `05cd3754-d589-4d90-97d1-89ba2bee610b`
Actor roles (`user_roles_v2 → roles.code`): `user`, `admin`, `super_admin` ✓
Account scope: `stripe_poland`

## Final verdicts

| Phase | Status |
|---|---|
| F1 deploy | PASS (предыдущий отчёт) |
| F1 runtime RBAC (super_admin token-path) | PASS |
| F2 SQL inventory | PASS |
| F2 bulk dry-run runtime | PASS |
| F3 targeted execute #1 | PASS |
| F3 targeted execute #2 (idempotency) | PASS |
| F4 verify (snapshot / PCI / lifecycle / audit / UI / bePaid) | PASS |

**PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 = CLOSED WITH DEFERRED LIVE UAT**

Live webhook UAT по трём source-path остаётся deferred до первой реальной Stripe-операции — см. `.lovable/backlog/stripe_card_enrichment_live_uat_v1.md`.

## 1. Three runtime calls — raw JSON

### 1.1 Dry-run
```json
{
  "startedAt": "2026-06-12T20:11:18.213Z",
  "finishedAt": "2026-06-12T20:11:19.916Z",
  "request": { "account_code": "stripe_poland", "limit": 50, "force_refresh": false, "dry_run": true },
  "data": {
    "ok": true,
    "dry_run": true,
    "account_code": "stripe_poland",
    "candidate_count": 2,
    "candidates": [
      { "payment_id": "2d40bc7e-e69f-4633-88d5-102561e49a54", "payment_intent_id": "pi_3TgMkD6UYJj2vm0G1ZUpRzvH", "verdict_pre": "ENRICHABLE" },
      { "payment_id": "00b39954-8180-44b7-8627-c84a0d63c9ef", "payment_intent_id": "pi_3TgWoM6UYJj2vm0G1L9yYCCe", "verdict_pre": "ENRICHABLE" }
    ]
  },
  "error": null
}
```
✓ candidates = 2, ambiguous = 0, conflicting = 0 (отсутствуют в payload — соответствуют 0). Совпадает с F2 SQL inventory.

### 1.2 Execute #1
```json
{
  "startedAt": "2026-06-12T20:11:41.736Z",
  "finishedAt": "2026-06-12T20:11:45.563Z",
  "request": { "account_code": "stripe_poland", "limit": 50, "force_refresh": false, "dry_run": false },
  "data": {
    "ok": true, "dry_run": false, "account_code": "stripe_poland", "candidate_count": 2,
    "summary": { "updated": 2, "skipped_complete": 0, "no_data": 0, "invalid": 0, "ambiguous": 0,
                  "retryable_no_payment_row": 0, "conflicting_payment_intent_ids": 0, "error": 0 }
  },
  "error": null
}
```
✓ updated + no_data + skipped_complete = 2; errors = 0.

### 1.3 Execute #2 (idempotency)
```json
{
  "startedAt": "2026-06-12T20:12:13.299Z",
  "finishedAt": "2026-06-12T20:12:14.653Z",
  "request": { "account_code": "stripe_poland", "limit": 50, "force_refresh": false, "dry_run": false },
  "data": {
    "ok": true, "dry_run": false, "account_code": "stripe_poland", "candidate_count": 0,
    "summary": { "updated": 0, "skipped_complete": 0, "no_data": 0, "invalid": 0, "ambiguous": 0,
                  "retryable_no_payment_row": 0, "conflicting_payment_intent_ids": 0, "error": 0 }
  },
  "error": null
}
```
✓ updated = 0, errors = 0. candidate_count = 0 — резолвер кандидатов отфильтровал уже обогащённые строки в ALREADY_COMPLETE; идемпотентность подтверждена.

## 2. SQL before/after (payments_v2)

### Before (F2 inventory, 2026-06-12 pre-run)
2 строки provider='stripe' имели verdict ENRICHABLE (см. `.lovable/proofs/stripe_card_enrichment_v2_inventory.md`).

### After
```
                  id                  |     provider_payment_id     | card_brand | card_last4 | meta_brand | meta_last4
--------------------------------------+-----------------------------+------------+------------+------------+-----------
 00b39954-8180-44b7-8627-c84a0d63c9ef | pi_3TgWoM6UYJj2vm0G1L9yYCCe | visa       | 3587       | visa       | 3587
 2d40bc7e-e69f-4633-88d5-102561e49a54 | pi_3TgMkD6UYJj2vm0G1ZUpRzvH | visa       | 3587       | visa       | 3587
```
✓ DB-колонки `card_brand`/`card_last4` совпадают с `meta.stripe.payment_method_details.card.{brand,last4}` — приоритет согласован.

## 3. Audit (real super_admin actor)

```
 1141b50f… | admin.stripe.card_data_bulk_dry_run  | actor 05cd3754… | candidate_count=2, candidate_payment_ids=[2d40bc7e…,00b39954…]
 61405346… | stripe.card_enrichment.updated       | actor 05cd3754… | payment 2d40bc7e…, pi_3TgMkD…, source=bulk_fetch, http=200
 1dfe3031… | stripe.card_enrichment.updated       | actor 05cd3754… | payment 00b39954…, pi_3TgWoM…, source=bulk_fetch, http=200
 1d79e84b… | admin.stripe.card_data_bulk_run      | actor 05cd3754… | summary.updated=2, errors=0
 dabb7c30… | admin.stripe.card_data_bulk_run      | actor 05cd3754… | summary.updated=0, errors=0  (idempotency run)
```
✓ Все audit-записи с реальным `actor_user_id` super_admin; body-передачи user_id нет; `actor.type="user"`.

## 4. PCI scan

| Scope | Forbidden keys (number/cvc/cvv/exp_month/exp_year/pan) |
|---|---|
| `payments_v2.meta` (provider=stripe) | **0** |
| `audit_logs.meta` (window 20:00–20:15 UTC) | **0** (нет колонки `payload`, проверено `meta::text`; не найдено) |

✓ PCI clean.

## 5. Lifecycle invariants (window 20:10–20:15 UTC)

| Table | Rows touched |
|---|---|
| `orders_v2` | 0 |
| `subscriptions_v2` | 0 |
| `entitlements` | 0 |
| `access_rules` | 0 |

✓ Enrichment не задел ни одной бизнес-сущности.

## 6. bePaid regression

`SELECT COUNT(*) FROM payments_v2 WHERE provider='bepaid' AND updated_at > '2026-06-12 20:10:00+00'` → **0**.
✓ bePaid рядом не лежал.

## 7. UI proof

Скриншот `/admin/payments` с тремя JSON-блоками harness (dry-run + execute #1 + execute #2):
`./stripe_card_enrichment_v2_harness_ui.png`

## 8. Temporary harness — lifecycle

- Создан: `src/components/admin/payments/_StripeEnrichmentHarness.tsx` (admin-only, `useRbac().isSuperAdmin` guard, не показывает JWT/секреты).
- Mount-точка: `PaymentsTabContent.tsx` (1 строчка импорта + 1 строчка JSX).
- После сбора proof в этом же патче:
  - Файл `_StripeEnrichmentHarness.tsx` **удалён** (`rm`).
  - Импорт и mount в `PaymentsTabContent.tsx` **удалены**.
- Финальное визуальное состояние UI — без harness; в git diff harness отсутствует.

## 9. Source-path coverage (для CLOSED-with-deferred-UAT)

| Source-path | Runtime proof now | Coverage |
|---|---|---|
| Webhook (charge.succeeded / payment_intent.succeeded / invoice.paid) | DEFERRED | первая реальная Stripe-оплата, см. backlog |
| Bulk admin enrichment (`stripe-card-data-fetch-bulk`) | PASS | dry-run + execute + idempotency, реальные строки |
| Single admin enrichment (`stripe-card-data-fetch`) | DEPLOY PASS, runtime DEFERRED | покрыт shared writer-тестами (20/20) и косвенно bulk-вызовом |

## 10. Stop / FAIL conditions check

| Condition | Result |
|---|---|
| F2 ambiguous/conflicting > 0 | ❌ (0/0) — no stop |
| F3 run #2 updated ≠ 0 | ❌ (0) — pass |
| F4 PCI scan > 0 hits | ❌ (0) — pass |
| F4 lifecycle invariant violated | ❌ (0) — pass |
| Any `stripe-webhook` deploy during F1–F4 | ❌ — не деплоился (config.toml блок не менялся, deploy не вызывался) |

Все защитные условия соблюдены.
