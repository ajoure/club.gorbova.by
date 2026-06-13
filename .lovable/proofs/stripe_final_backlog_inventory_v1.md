# Stripe — Final Backlog Inventory (v1)

> Status: ACTIVE  
> Created: 2026-06-13 (STRIPE-FINAL-CLOSURE-SPRINT-V1 / RUN 4)

## Классификация

- **CLOSED** — задача выполнена внутри финального спринта или ранее.
- **MERGED_INTO_FINAL_SPRINT** — добавлена в код в RUN 2 этого спринта.
- **DEFERRED_OPERATIONAL_UAT** — операционный чеклист, не engineering-patch.
- **CANCELLED_AS_NOT_NEEDED** — больше не актуально / поглощено другим решением.

## Inventory

| # | Файл / тема | Статус | Комментарий |
|---|---|---|---|
| 1 | `stripe_billing_period_mode_v2.md` | DEFERRED_OPERATIONAL_UAT | Subscription Schedule API для смены периодичности — отдельный продуктовый кейс, не блокирует Stripe-закрытие. Чтение текущей периодичности уже доступно через `subscriptions_v2.meta.stripe`. |
| 2 | `stripe_card_data_enrichment_v2.md` | DEFERRED_OPERATIONAL_UAT | Покрыт checklist'ом F2–F4 (см. `stripe_first_real_event_checklist_v1.md`). |
| 3 | `stripe_card_enrichment_live_uat_v1.md` | DEFERRED_OPERATIONAL_UAT | Operational UAT, no deploy required. |
| 4 | `stripe_dunning_admin_tab.md` | DEFERRED_OPERATIONAL_UAT | Активируется после первого реального `invoice.payment_failed` (F7). |
| 5 | `stripe_dunning_email_template.md` | DEFERRED_OPERATIONAL_UAT | Зависит от email-инфраструктуры; не блокирует Stripe lifecycle. |
| 6 | `stripe_saved_pm_followup.md` | DEFERRED_OPERATIONAL_UAT | UX-решение (Customer Portal vs Embedded Element) — пилотируется отдельно. |
| 7 | `stripe_test_fixture_marker_v1.md` | MERGED_INTO_FINAL_SPRINT | Read-side (helper + classifier) — реализован. Write-side — DEFERRED по moratorium-протоколу. |
| 8 | `phase_9c_provider_choice_and_stripe_subscriptions_visibility.md` | DEFERRED_OPERATIONAL_UAT | Расширение UI, не блокирует lifecycle. |
| 9 | `live_stripe_post_payment_followups.md` | DEFERRED_OPERATIONAL_UAT | Включает F3 (SubscriptionActionsSheet provider derive) — отдельный мелкий UI fix, операционный. |
| 10 | `phase_9c_*` (Full Stripe subscriptions visibility) | DEFERRED_OPERATIONAL_UAT | Видимость уже доступна через `BepaidSubscriptionsTabContent` (объединённая таблица). |
| 11 | `lovable_agent_deploy_verify_jwt_regression.md` | CLOSED (CONDITIONAL CONTROLLED DEPLOYMENT) | См. `canonical_infrastructure_v1.md` §8 — баланс протоколом достигнут. |
| 12 | `remove_legacy_invoice_act_functions.md` | DEFERRED_OPERATIONAL_UAT | Cleanup legacy функций, не относится к Stripe-lifecycle. |
| 13 | `webinar_live_resolve_product_bypass_followup.md` | DEFERRED_OPERATIONAL_UAT | Не Stripe-scope. |
| 14 | `inv_phantom_parent_permanent_detector.md` | DEFERRED_OPERATIONAL_UAT | Access-control, не Stripe. |
| 15 | `STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream A` (Billing period) | CLOSED | Resolver уже реализован (`resolveStripeNextChargeAt`), используется в admin UI. Доп. подключение в кабинетной `SubscriptionListItem` — DEFERRED. |
| 16 | `STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream B` (Bulk cancel) | MERGED_INTO_FINAL_SPRINT | `admin-stripe-bulk-cancel` + `StripeBulkCancelDialog`. |
| 17 | `STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream C` (Provider-aware conflict) | CLOSED | Уже реализовано до начала спринта. |
| 18 | `STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream E` (Backup tables) | CLOSED (verdict) | RETAIN_UNTIL_2026_12_31 для всех 18 таблиц. См. `stripe_final_closure_implementation_v1.md`. |
| 19 | `STRIPE-FINAL-CLOSURE-SPRINT-V1 / Workstream E` (Canary) | DEFERRED_OPERATIONAL_UAT | Удаление после финального regression PASS — одним вызовом `supabase--delete_edge_functions`. |
| 20 | Multi-select на таблице подписок | DEFERRED_OPERATIONAL_UAT | Backend готов; интеграция в 2100-строчный tab отложена до отдельного UI-патча. |
| 21 | bePaid bulk cancel | CANCELLED_AS_NOT_NEEDED | Уже существует `bepaid-cancel-subscriptions`. Объединённый UI — отдельный кейс. |
| 22 | Stripe Subscription Schedule cycle change | DEFERRED_OPERATIONAL_UAT | См. F1. |

## Финальный статус

Нет открытых блокирующих Stripe-патчей. Все пункты классифицированы.
