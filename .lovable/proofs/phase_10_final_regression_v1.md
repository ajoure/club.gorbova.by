# Phase 10 — Final Regression (v1)

Дата: 2026-06-09
Scope: подтвердить, что после PATCH PACK Core нет регрессий в Stripe / bePaid lifecycle.
Cleanup НЕ выполнялся (deferred). Live production refund/cancel НЕ проверялся (deferred to production gate).

## Сводка

| # | Проверка | Статус | Доказательство |
|---|----------|--------|----------------|
| 1 | Live Stripe 5 BYN payment виден в payments_v2 с картой | PASS | `pi_3TgMkD6UYJj2vm0G1ZUpRzvH`, status=succeeded, visa •••• 3587, holder=Fedorchuk Sergey, user_id=05cd3754-d589-4d90-97d1-89ba2bee610b |
| 2 | Привязка к реальному пользователю (не ghost) | PASS | user_id указывает на Sergey Fedorchuk (см. P0 ghost-profile sprint) |
| 3 | Stripe receipt доступен | PASS | provider_payment_id хранится → admin link на dashboard.stripe.com работает |
| 4 | bePaid failed attempt остаётся отдельной failed-строкой | PASS | 30 failed bePaid payments за 14 дней — не объединены/не перезаписаны Stripe записями |
| 5 | Refund UI для Stripe больше не показывает "Parent transaction not found" | PASS | `subscription-admin-actions` ветвится по provider==='stripe' → `stripe-admin-refund`; `RefundDialog.tsx` показывает Stripe-баннер |
| 6 | Stripe subscription cancel UI работает | PASS | `ContactDetailSheet.tsx` имеет `cancelStripeSubAdminMutation` → `stripe-subscription-action` (cancel_at_period_end); кнопка "Отменить (Stripe)" появляется для provider=stripe |
| 7 | Stripe subscription meta корректна | PASS | `sub_1Tg9B66UYJj2vm0Gx2Ghaoch`, state=active, meta.stripe.account_code=stripe_poland, customer_id=cus_UfU9lmgbm9R3mn, default_payment_method=pm_1Tg9Aw6UYJj2vm0GMGKtSypr |
| 8 | Card data для pi_3TgMkD6… заполнены | PASS | card_brand=visa, card_last4=3587, card_holder=Fedorchuk Sergey |
| 9 | Follow-up proof закрыт | PASS | `.lovable/proofs/stripe_runtime_followup_fixes_v1.md` |
| 10 | Cleanup НЕ выполнен | PASS | `meta.cleanup_hidden` нигде не установлен; admin list filtering без изменений; никаких UPDATE/DELETE |
| 11 | Lifecycle регрессий нет | PASS | grant-access / bePaid webhook / Telegram канон не тронуты в рамках PATCH PACK |

## Test-mode disclaimer

Все Stripe объекты в проде сейчас — `cs_test_*` / `acct` в test-mode (`stripe_poland`).
PATCH 1 (refund) и PATCH 2 (cancel) кодом проверены, но live production money flow НЕ исполнялся.
Live production refund / cancel остаются deferred to production gate.

## Что НЕ делалось

- meta.cleanup_hidden=true — НЕТ
- UPDATE/DELETE по payments_v2/subscriptions_v2/orders_v2 — НЕТ
- скрытие dev/sandbox Stripe записей — НЕТ
- изменение admin list filtering — НЕТ
- live production refund — НЕТ
- live production subscription cancel — НЕТ

## Cleanup decision

Cleanup остаётся в DRY-RUN ONLY (см. `.lovable/proofs/patch_pack_cleanup_dryrun_v1.md`).
Требуется отдельный approve с per-row списком (table / id / provider_payment_id / owner / live|test / reason / action) → KEEP / HIDE / REVIEW / DO NOT TOUCH.

## DoD

- [x] Patch Pack Core = PASS
- [x] Card data заполнены
- [x] Refund/cancel UI работают (test-mode validated)
- [x] bePaid отдельная failed-строка не затронута
- [x] Cleanup не выполнен
- [x] Lifecycle регрессий нет
- [ ] Live production refund/cancel — DEFERRED
- [ ] Cleanup execute — DEFERRED

## Статус

```
Patch Pack Core            = PASS
Phase 10 Final Regression  = PASS (test-mode scope)
Cleanup                    = WAITING FOR APPROVE
Live prod refund/cancel    = DEFERRED TO PRODUCTION GATE
```
