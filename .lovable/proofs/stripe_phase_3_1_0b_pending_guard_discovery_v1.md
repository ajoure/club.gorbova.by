# Phase 3.1.0-B — Pending Guard Discovery (Stage A)

Дата: 2026-06-04
Статус: PASS — guard может быть добавлен add-only.

## A.1 Аудит существующих pending rows после Phase 3.1.0 migration

```sql
SELECT count(*) AS pending_count FROM subscriptions_v2 WHERE status='pending';
-- → 0
```

Результат: **0 строк** с `status='pending'` в БД. Это ожидаемо (enum добавлен, но ни один writer пока не использует значение). Источников pending на момент discovery нет.

## A.2 Точки создания subscriptions_v2 (writers)

Найдено через `rg "\.from\(['\"]subscriptions_v2['\"]\)" supabase/functions/` + filter по insert/upsert контексту:

| File | Lines | Контекст | Будет создавать pending? |
|---|---|---|---|
| `_shared/create-payment-checkout.ts` | 841, 974, 1014, 1084 | Подписочный checkout (admin/token-flow), pre-create active/past_due | Нет (текущая логика). Stripe-обёртка может расшириться pre-create pending — это Phase 3.1 MVP scope. |
| `bepaid-create-token/index.ts` | 268 | bePaid token flow | Нет (active flow). |
| `bepaid-create-subscription/index.ts` | 99, 367 | bePaid создание подписки | Нет. |
| `bepaid-create-subscription-checkout/index.ts` | 530, 698, 762 | bePaid subscription checkout | Нет. |
| `bepaid-admin-create-subscription-link/index.ts` | 87, 353 | bePaid admin link | Нет. |
| `payments-reconcile/index.ts` | 656 | Reconcile | Нет. |

Вывод: **ни один существующий writer не вставляет `status='pending'`**. Pre-create pending будет только в Phase 3.1 MVP (Stripe writer). Guard в этом mini-plan только готовится.

## A.3 Текущие вызовы subscription-conflict.ts

`checkSubscriptionConflict` / `classifySameProductState` зовутся из:
- `_shared/create-payment-checkout.ts`
- `bepaid-create-subscription-checkout/index.ts`

Stripe writer ещё не существует — подключение нового `checkPendingCheckoutConflict` в реальный flow откладывается до Phase 3.1 MVP (DoD: обязательно перед первым `INSERT pending`).

## A.4 Readers status='pending' (re-check Phase 3.1.0 audit)

`ALL_READERS_SAFE=true` подтверждён в `stripe_phase_3_1_0_pending_readers_audit_v1.md`. Ключевые точки:
- `grant-access-for-order` — whitelist `active|trial|past_due`, pending исключается.
- `resolve-effective-access` — `neq('status','canceled')` + защитный фильтр по `next_charge_at IS NOT NULL`. Pending будет иметь `next_charge_at=NULL` (контракт MVP) и не пройдёт.
- `subscription-renewal-reminders` — whitelist `active`, pending исключается.
- `telegram-grant-access` — идёт только через `grant-access-for-order`, pending исключён.
- broadcast/audience filters по `subscriptions_v2.status` — whitelist, pending исключается.

STOP-GATE A: пройден. Reader, трактующий pending как grantable/active/billable, не найден.

## A.5 Stripe pre-create writer (контракт, без реализации)

- Имя: **`stripe-create-subscription-checkout`** (новая edge function, Phase 3.1 MVP).
- Контракт обязательного pre-check (фиксируется в MVP plan):
  1. `checkPendingCheckoutConflict({user_id, product_id, tariff_id, provider:'stripe'})`
  2. Если `pending_conflict` → вернуть существующий `checkout_session_id` (если жив) либо `409 pending_in_progress`.
  3. Если `stale_pending` → caller имеет право вызвать `admin-cleanup-stale-pending-subscriptions` (manual) или пометить cleanup_candidate и продолжить с новой записью (политика финализируется в MVP).
  4. Только после `no_pending` + `classifySameProductState() == no_existing` → `INSERT pending`.

## A.6 TTL источник

`subscriptions_v2.created_at` (NOT NULL, default now()) достаточно для TTL. Доп. поля не требуются. `PENDING_TTL_MS = 24h`.

## A.7 STOP проверки

- ✅ Cleanup НЕ требует новых RLS/RPC/grants — пишет только `UPDATE subscriptions_v2 SET status, auto_renew, meta` и `DELETE FROM provider_subscriptions WHERE ...` (RLS уже разрешает service_role).
- ✅ Никаких изменений `subscriptions_v2`/`provider_subscriptions` schema.
- ✅ bePaid path не затрагивается.

Stage A: **PASS**. Переход к Stage B.
