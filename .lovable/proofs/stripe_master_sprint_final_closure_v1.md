# Stripe Master Sprint — финальное закрытие

Дата: 2026-06-10
Статус: **Stripe Master Sprint = CLOSED WITH BACKLOG**

## 1. Scope

Stripe добавлен как второй платёжный провайдер рядом с bePaid.
bePaid не заменён и не сломан. Все интеграции идут через единый
provider-aware слой:

```
UI (PublicPayPage / PaymentDialog / Consultation landing)
        │
        ▼
public-checkout  ──► createPaymentCheckout(provider) ──► createStripeCheckout
        │                                              └► bePaid branch (legacy)
        ▼
orders_v2 (provider='bepaid'|'stripe') ──► webhook (bepaid|stripe) ──► grant-access-for-order
```

Никаких новых SOT-таблиц, никаких параллельных fulfillment-веток.

## 2. Closed proofs

| Фаза | Proof |
|---|---|
| Live one-time Stripe | `.lovable/proofs/phase_L4_live_one_time_pass_v1.md` |
| Ghost profile fix | `.lovable/proofs/phase_L4_ghost_profile_fix_v1.md` |
| Stripe cleanup execute | `.lovable/proofs/patch_pack_cleanup_execute_v1.md` |
| Stripe refund hot-fix | `.lovable/proofs/stripe_refund_hot_fix_ord_26_00167_v1.md` · `.lovable/proofs/patch_stripe_refund_v1.md` |
| Stripe subscription cancel | `.lovable/proofs/patch_stripe_subscription_cancel_v1.md` |
| Stripe subscription payment-link amount override | `.lovable/proofs/stripe_subscription_payment_link_amount_override_v1.md` |
| Stripe link inline parity + pending cancel UI | `.lovable/proofs/stripe_link_inline_parity_and_pending_cancel_ui_v1.md` |
| Stripe subscription checkout materialization | `.lovable/proofs/stripe_subscription_checkout_materialization_v1.md` |
| Stripe cleanup final verify | `.lovable/proofs/stripe_cleanup_final_verify_v1.md` |
| Stripe UI provider parity cleanup (Stage 1/2A/2B/2C/2D/2E) | `.lovable/proofs/stripe_ui_provider_parity_cleanup_v1.md` |
| Hot-fix: Stripe-only консультация | `.lovable/proofs/stripe_consultation_oneoff_fix_v1.md` |

Файлов `stripe_subscription_inline_product_isolation_v1.md` в репо нет —
этот пункт покрыт `stripe_subscription_checkout_materialization_v1.md` +
`stripe_link_inline_parity_and_pending_cancel_ui_v1.md`.

## 3. Functional checklist

- [x] Stripe one-time payment — `phase_L4_live_one_time_pass_v1` + сегодняшний smoke (`73fbae30…`).
- [x] Stripe subscription checkout — `stripe_subscription_checkout_materialization_v1`.
- [x] Stripe custom amount / currency payment links — `stripe_subscription_payment_link_amount_override_v1`.
- [x] Stripe payment материализуется в `orders_v2/payments_v2` — `stripe-webhook` → `grant-access-for-order`.
- [x] Stripe subscription материализуется в `subscriptions_v2/provider_subscriptions` — `stripe-pre-create-subscription` + `stripe-subscription-resolver`.
- [x] Access grant через `grant-access-for-order` (нет ручных INSERT).
- [x] Refund recovery — `record_refund_atomic` (RPC) + `admin-stripe-repair-refund-recording`.
- [x] Stripe payments видны в «Платежах» — Stage 2C `stripe_ui_provider_parity_cleanup_v1`.
- [x] Stripe links видны в «Ссылках» — `payment_links` + `payment_links_enriched_v`.
- [x] Stripe subscriptions видны в «Подписках» — Stage 2A unified table.
- [x] PublicPayPage provider-clean — Stage 2E.
- [x] Лендинги (`/consultation` и аналогичные one-time продукты) уходят в Stripe, если оффер Stripe-only — сегодняшний hot-fix `stripe_consultation_oneoff_fix_v1`.
- [x] bePaid не сломан (см. §4).

## 4. bePaid freeze proof

- bePaid payments видны в `/admin/payments` (`useUnifiedPayments` фильтр provider).
- bePaid subscriptions видны в единой таблице (`useStripeSubscriptionsList` merge не трогает bePaid строки).
- bePaid auto-renewals видны (Stage 2B layout fix, default provider='bepaid').
- bePaid documents работают (Stage 2C — единая кнопка, регресс-скрин `04c`).
- bePaid checkout не изменён: для офферов с `allowed_payment_providers` ∈ {[],"bepaid"} → старый bePaid checkout без правок.
- `bepaid-webhook` и `_shared/create-payment-checkout.ts` bePaid-ветка — не тронуты (см. STOP-guard `bepaid active_to overshoot`).

## 5. Cleanup status

- Stripe-тестовый мусор удалён (`patch_pack_cleanup_execute_v1`, `stripe_cleanup_final_verify_v1`).
- Hard cleanup выполнен.
- Backup-таблицы созданы и сохранены:
  `_stripe_cleanup_2026_06_backup_orders`, `…_payments`, `…_subscriptions`,
  `…_provider_subs`, `…_provider_events`, `…_payment_links`,
  `…_entitlements`, `…_access_grant_ledger`.
- **STOP**: backup tables НЕ удалять без отдельного approval owner-а.

## 6. Accepted deviations

- 5 BYN Stripe payment был тестовым и полностью refunded.
  Access regrant не требуется.
- Отсутствие активного `entitlement` по refunded 5 BYN принято.
- 2 USD Stripe sub Сергея cancelled; access сохранён до `access_end_at` (Stage 1/2A).
- Stripe payment $2 → «Карта не определена» в UI: historical meta без card data (Stage 2E, backlog `PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2`).

## 7. Backlog carried over

| ID | Что осталось |
|---|---|
| PATCH-STRIPE-BULK-CANCEL-V2 | Bulk cancel Stripe-подписок из админки |
| PATCH-STRIPE-BILLING-PERIOD-MODE-V2 | UI редактирования `interval/interval_count` Stripe |
| PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 | Обогащение исторических payments_v2.meta.stripe.* card data |
| PATCH-STRIPE-DOCUMENTS-DRAWER-V2 | Расширенный документ-drawer Stripe (receipt + invoice + refund в одном) |
| PATCH-UNIFIED-SUBSCRIPTIONS-LIST-V2 | Любые остаточные расхождения provider-aware модели (если найдутся) |
| Saved cards provider compatibility | UX сохранённых карт для Stripe (сейчас Stripe выбор карты у провайдера) |
| Backup tables decision / cleanup | Только после отдельного approval owner-а |

Эти PATCH-и не блокируют production: основные payment / subscription /
refund / access flows закрыты и подтверждены.

## 8. Final verdict

**Stripe Master Sprint = CLOSED WITH BACKLOG**

Production-critical флоу закрыты и подтверждены runtime + UI proof.
Осознанные хвосты вынесены в backlog с явными ID и owner-actionable
формулировками.
