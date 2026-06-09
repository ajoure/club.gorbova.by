# Backlog — Live Stripe post-payment follow-ups

Отложено из P0 (закрыт `.lovable/proofs/phase_L4_live_one_time_pass_v1.md` + `.lovable/proofs/phase_L4_ghost_profile_fix_v1.md`). Каждый пункт — отдельный PATCH.

## F7 — Historical Stripe card data backfill
**Симптом:** для исторических Stripe-платежей до PATCH-LIVE-CARD (2026-06-09) `payments_v2.card_brand/card_last4/card_holder` = NULL.
**Что сделать:** один batch, который пройдёт по `payments_v2 WHERE provider='stripe' AND card_brand IS NULL AND provider_payment_id LIKE 'pi_%'`, дёрнет Stripe `payment_intents/{id}?expand[]=latest_charge` через `readAcquiringSecret('stripe', account_code, 'secret_key')` и UPDATE-нет card fields. Требует отдельного approve перед массовой записью.

## F2 — Webinar access rule mismatch
**Симптом:** entitlement у не-админа есть (`fabd7e5a…`, продукт `62a522a5`, до 09.07.26), вебинар не открывается.
**Гипотеза:** `access_rules` для `product_id=62a522a5` имеет `grant_target_type='training_content'` но `target_ref=8b1fb03e…` указывает на папку KB, а не на конкретный `training_contents`-узел. Resolver не матчит.
**Что сделать:** discovery `access_rules` 6b1a950d, сравнить с рабочим вебинаром, исправить `grant_target_type`/`target_ref`. См. memory `Training Content Resolver Rules`.

## F3 — Stripe subscription cancel/actions
**Симптом:** тестовая Stripe-подписка `sub_1Tg9B66…` в карточке висит, кнопка отмены пишет «доступно только для bePaid».
**Гипотеза:** `SubscriptionActionsSheet` читает `subscription.provider`, а в `subscriptions_v2` такой колонки нет → всегда `undefined` → отдаёт generic local cancel вместо `StripeSubscriptionActionsBlock`.
**Что сделать:** derive provider из `meta.stripe.subscription_id` / `meta.bepaid` в `SubscriptionActionsSheet.tsx`, прокидывать в `StripeSubscriptionActionsBlock` (там уже есть `cancel_now` / `cancel_at_period_end`).

## F4 — Stripe refund из админки
**Симптом:** refund Stripe-платежа из UI не работает.
**Что сделать:** discovery: проверить `record_refund_atomic_multi` + edge `stripe-refund` на полноту Stripe-flow. Тест возврата 5 BYN на `2d40bc7e…` (живая карта).
**См.:** memory `Refund Canonical Write-Path` — SOT уже `record_refund_atomic`.

## F5 — Saved cards: stale + provider-compat
**Симптом:** 4 «привязанные» карты в карточке Сергея — давно отвязаны.
**Что сделать:**
1. UI-фильтр `card_profile_links` по `detached_at IS NULL` / `status='active'` (или бейдж «отвязана»).
2. Provider-badge: bePaid token vs Stripe payment_method.
3. На `/pay/:token` для Stripe не показывать bePaid-saved-card как доступную.

## F6 — Unified «Подписки» tab + provider badge
**Симптом:** вкладка называется «Подписки BePaid», непонятно где Stripe.
**Что сделать:** переименовать в «Подписки», добавить колонку/бейдж провайдера (bePaid/Stripe).

## (Возможный) F7 — Deal binding
Если по итогам UI-проверки выяснится, что Stripe-платежи не привязываются к deal в CRM — отдельный PATCH. Сейчас в P0 не подтверждаем.

## Sandbox Stripe-платежи без owner
10 строк `payments_v2 provider=stripe` остались с `user_id=NULL` после P0 backfill — это тест-заказы (`a103db41`, `c12ccda3`, `0feb0660`, `6dbf5ee1`) без owner в самом `orders_v2`. Это нормально для admin sandbox. Если потребуется атрибуция — только через ручной linking из админки.
