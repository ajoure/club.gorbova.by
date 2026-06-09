# Phase L-2 — Live Stripe Webhook Secret Saved (READY, verify by L-4)

Status: **READY — WILL BE VERIFIED BY FIRST LIVE PAYMENT (L-4)**
Date: 2026-06-09
Scope: Live Stripe Production Gate, шаг L-2

## Что сделано (вне агента, пользователем)

1. В Stripe Dashboard подтверждён существующий webhook endpoint:
   - Name: `Gorbova Stripe Webhook`
   - URL: `https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/stripe-webhook`
   - Status: **Active**
   - Mode: **live**
   - Новый endpoint **не создавался**.
2. Скопирован live `whsec_...` из карточки endpoint.
3. Live `whsec_...` сохранён через UI:
   `/admin/integrations/payments` → Stripe → Edit `stripe_poland` → поле «Webhook signing secret» → Save.
4. Поток записи: `StripeConnectionDialog` → `acquiring-save-connection` → RPC `admin_save_acquiring_secret` → Vault.
   - `secrets--add_secret` **не использовался**.
   - Прямых записей в Supabase secrets / `acquiring_connections` **не было**.
   - Код `stripe-webhook` **не менялся**.
   - bePaid **не трогали**.
   - `tariff_offers.meta.acquiring` **не трогали**.

## Почему L-2 не закрыт отдельным dashboard test event

В текущем Stripe Workbench UI кнопки **Send test webhook** на карточке endpoint нет / недоступна для этой версии Dashboard. Это **не блокер**: live signature verification будет доказан первым реальным live-платежом в L-4 (см. DoD ниже).

## DoD L-2 (закрывается вместе с L-4)

После первого реального live-платежа в `provider_events` должна появиться строка со всеми следующими полями одновременно:

| Поле                | Ожидание                |
|---------------------|-------------------------|
| `provider`          | `stripe`                |
| `account_code`      | `stripe_poland`         |
| `livemode`          | `true`                  |
| `signature_valid`   | `true`                  |
| `processing_status` | `processed`             |
| `processing_error`  | `null`                  |

Если `signature_valid=false` или `processing_status` ≠ `processed` — live `whsec` сохранён неверно, возвращаемся к шагу 3 (повторно скопировать `whsec` из того же endpoint и пересохранить через UI).

## Запреты, соблюдённые на L-2

- ❌ не создавать новый webhook endpoint (используется существующий active);
- ❌ `secrets--add_secret` не использовать;
- ❌ прямой INSERT/UPDATE в Vault / `acquiring_connections` запрещён;
- ❌ менять код `stripe-webhook` запрещено;
- ❌ создавать `stripe_poland_test` сейчас — вынесено в Phase 9-C backlog;
- ❌ менять bePaid запрещено;
- ❌ требовать у пользователя «Send test webhook» в Dashboard запрещено (кнопки нет).

## Следующий шаг

Phase **L-4** — первый минимальный live one-time payment.
- contact: Федорчук Сергей / 7500084@gmail.com
- provider: Stripe, account_code: `stripe_poland`
- payment_type: one_time
- currency: EUR или PLN
- amount: минимальная безопасная сумма
- продукт: безопасный минимальный offer (консультация / Global Hub)

После оплаты — Verify SQL по `provider_events` и `payments_v2` (см. L-4 proof).
