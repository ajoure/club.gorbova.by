# План: PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 / Approve B

Точечный deploy + изолированный runtime-proof единого Stripe card writer'а. Historical backfill НЕ выполняется.

## 1. Pre-deploy gate (read-only)

- Прогнать `_shared/stripe/card-enrichment.test.ts` → ожидаемо 20/20 PASS.
- Typecheck/build clean.
- `rg` по `supabase/functions` подтверждает:
  - нет inline записи `card_brand`/`card_last4`/`meta.stripe.payment_method_details` вне `_shared/stripe/card-enrichment.ts`;
  - `stripe-webhook`, `stripe-card-data-fetch`, `stripe-card-data-fetch-bulk` импортируют только shared writer;
  - других потребителей shared-модулей нет (если есть — показать и обосновать перед deploy).
- Подтвердить scope deploy:
  ```
  stripe-webhook
  stripe-card-data-fetch
  stripe-card-data-fetch-bulk
  ```
- Никаких миграций, RPC, схем, secrets, frontend.

## 2. Точечный deploy

- `supabase--deploy_edge_functions` только для трёх функций выше.
- Зафиксировать в proof: `function_name`, deployment id, `deployed_at`, source ref.
- Не трогать: secrets, Stripe webhook endpoint, subscribed events, API keys, acquiring_connections, БД, frontend.

## 3. Изолированный runtime fixture

Приоритет A (test-mode) → B (контролируемая существующая техническая Stripe-оплата).

- Никаких новых production-продаж/заказов/подписок/entitlements/access.
- Fixture помечается `meta.test_payment=true` либо явно описан в proof как техническая.
- `stripe trigger` не используется для событий, попадающих в live commercial lifecycle.

## 4. Runtime proof трёх source-path

Подтвердить фактическую работу shared writer для:
- `checkout.session.completed`
- `payment_intent.succeeded`
- `invoice.paid`

Ожидание:
- первый источник — реальный enrichment (`updated=1`, sanitized snapshot);
- последующие по той же оплате — `verdict=skipped_complete` или non-destructive merge (wallet не теряется);
- повтор: `updated=0`.

Для `invoice.paid` отдельно доказать:
- используется существующий `onInvoicePaid` lifecycle;
- новых payment/order rows нет;
- access/entitlement повторно не выданы;
- `payment_links.current_uses` не увеличился;
- enrichment вызван ПОСЛЕ материализации `payment_id`.

## 5. Snapshot после enrichment (read-only SELECT)

Показать:
```
payments_v2.card_brand, card_last4, card_holder
meta.stripe.payment_method_details.{type, card.brand, card.last4, card.wallet.type, card.funding, card.country}
meta.stripe.{payment_method_id, charge_id, payment_intent_id, card_data_source, card_data_sources_seen, card_data_fetched_at}
```
Идентификаторы маскируются. Проверить: wallet не затёрт, NULL не перезаписал значение, `sources_seen` без дублей, `card_holder` отсутствует в audit.

## 6. Single + bulk runtime

- **Single** `stripe-card-data-fetch` под JWT super_admin, `force_refresh=false` → `skipped_complete`, audit actor = реальный user.
- **Bulk dry-run**: `{dry_run:true, account_code:"stripe_poland", limit:50}` → UPDATE=0, verdict-кандидаты возвращены, actor = super_admin, summary audit без card data.
- **Bulk execute** — ЗАПРЕЩЁН в Approve B (кроме уже использованной isolated fixture, не коммерческой).

## 7. PCI proof — `.lovable/proofs/stripe_card_enrichment_v2_pci.md`

- Code-level: тесты на отбрасывание `exp_month/exp_year/fingerprint`, искусственная утечка → `pci_violation`, writer не делает UPDATE после нарушения.
- DB scan:
  ```sql
  SELECT id FROM payments_v2 WHERE provider='stripe'
    AND meta::text ~* '"(number|pan|cvc|cvv|exp_month|exp_year|fingerprint)"\s*:';
  ```
  Ожидание: 0.
- Audit scan по `action LIKE 'stripe.%' OR 'admin.stripe.%'` тем же regex → 0.

## 8. bePaid regression

Контрольные bePaid payments до/после: строки и `meta` не изменены, webhook/sync не деплоились, UI показывает карту, shared writer отклоняет `provider='bepaid'`.

## 9. Lifecycle invariants (before/after)

`orders_v2`, `payments_v2`, `subscriptions_v2`, `provider_subscriptions`, `entitlements`, `payment_links.current_uses`, `ai_generated_documents` — counts без изменений (кроме card snapshot одной isolated row).

## 10. Proof файлы

- `.lovable/proofs/stripe_card_enrichment_v2_webhook_runtime.md` — deploy list/версии, build/test, fixture и его изоляция, verdict каждого source-path, before/after snapshot, idempotency, single fetch, bulk dry-run, lifecycle invariants, bePaid regression, audit actor, подтверждение отсутствия backfill.
- `.lovable/proofs/stripe_card_enrichment_v2_pci.md` — code/DB/audit PCI scans.

## DoD

Approve B = PASS если: deployed scope = 3 функции, единый writer в runtime, sanitized snapshot, idempotent, `invoice.paid` без повторной materialization, single+bulk auth/audit корректны, bulk dry-run без записи, PCI scans=0, bePaid не изменён, коммерческие сущности неизменны, proof собран.

После — STOP, вернуть `Approve B = PASS|FAIL`. Approve C не начинать.
