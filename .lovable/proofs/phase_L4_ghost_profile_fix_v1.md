# Phase L4 — Ghost Profile Fix v1

## 1. Root cause

`public.normalize_order_user_id()` приоритетно искал профиль по `profiles.id = NEW.user_id`. Ghost-профиль `05cd3754-d589-4d90-97d1-89ba2bee610b` создан с `id`, равным auth.users.id Сергея (`05cd3754…`), но без `profiles.user_id`. Поэтому при INSERT в `orders_v2`/`payments_v2` сначала матчился ghost — и `profile_id` ставился в ghost, а реальный профиль `a4b7c8c9…` (где `user_id=05cd3754…`) использовался только в else-ветке.

## 2. Профили (до)

| id | user_id | email | created_at | роль |
|---|---|---|---|---|
| `a4b7c8c9-8210-499e-ae3f-2a5db2121577` | `05cd3754…610b` | 7500084@gmail.com | 2025-12-25 | **реальный Сергей** |
| `05cd3754-d589-4d90-97d1-89ba2bee610b` | NULL | 7500084+dev@gmail.com | 2026-06-06 | ghost |
| `7a942227-e274-4e3f-8ed0-08195fc11542` | NULL | 7500084+stripe-smoke@gmail.com | 2026-06-07 | ghost |

## 3. Trigger migration (Phase 1)

Функция `public.normalize_order_user_id()` переписана:

1. **Priority 1** — lookup по `profiles.user_id = NEW.user_id` → `profile_id := found.id; RETURN`.
2. **Priority 2** — fallback `profiles.id = NEW.user_id`. Если найден с `user_id IS NOT NULL` → нормализация (`user_id := resolved_auth_id`, `meta._user_id_normalized=true`).
3. **Priority 3** — ghost (профиль `id == NEW.user_id`, `user_id IS NULL`) → пометка `_is_ghost_profile=true, _ghost_reason='profile_id_without_user_id'`.

Имя триггера/таблицы/`SECURITY DEFINER`/`search_path` не менялись.

Симуляция: `SELECT id FROM profiles WHERE user_id='05cd3754…'` → `a4b7c8c9…` (реальный). Новый порядок гарантирует, что любые будущие orders Сергея сразу получат правильный `profile_id`.

## 4. Dry-run repoint (Phase 2)

| scope | rows |
|---|---|
| orders_v2 (ghost1 + user=Сергей) | 8 |
| payments_v2 (ghost1 + user=Сергей) | 6 |
| orders_v2 (ghost2 7a942227) | 0 |
| payments_v2 (ghost2 7a942227) | 0 |
| subscriptions_v2 (ghost1) | 4 |
| entitlements (ghost1) | 1 |
| access_grant_ledger (ghost1) | 8 |

Все строки имеют `user_id = 05cd3754…` (auth Сергея) и `profile_id = ghost1`. Связь однозначна — repoint безопасен.

## 5. Executed repoint

```sql
UPDATE orders_v2 SET profile_id='a4b7c8c9-8210-499e-ae3f-2a5db2121577',
  meta = meta || jsonb_build_object('_repoint_ghost_fix_p0', now()::text, '_repoint_from_profile_id','05cd3754…')
WHERE user_id='05cd3754…' AND profile_id='05cd3754…';          -- 8 rows

UPDATE payments_v2 SET profile_id='a4b7c8c9…'
WHERE user_id='05cd3754…' AND profile_id='05cd3754…';          -- 6 rows

UPDATE subscriptions_v2 SET profile_id='a4b7c8c9…'
WHERE user_id='05cd3754…' AND profile_id='05cd3754…';          -- 4 rows

UPDATE entitlements SET profile_id='a4b7c8c9…'
WHERE user_id='05cd3754…' AND profile_id='05cd3754…';          -- 1 row

UPDATE access_grant_ledger SET profile_id='a4b7c8c9…'
WHERE user_id='05cd3754…' AND profile_id='05cd3754…';          -- 8 rows
```

## 6. Final FK check (Phase 3)

Прогон по всем 27 public-таблицам с колонкой `profile_id`: `0` ссылок на `05cd3754…` и `7a942227…` после repoint.

## 7. Ghost profile DELETE

```sql
DELETE FROM profiles
WHERE id IN ('05cd3754-d589-4d90-97d1-89ba2bee610b','7a942227-e274-4e3f-8ed0-08195fc11542')
  AND user_id IS NULL;
```

После DELETE: `SELECT … profiles WHERE id IN (ghost1, ghost2, real)` возвращает только реального Сергея `a4b7c8c9…`.

## 8. Stripe card data (Phase 4)

`supabase/functions/stripe-webhook/index.ts`: в обоих обработчиках (`checkout.session.completed`, `payment_intent.succeeded`) после fetch `payment_intents/{id}?expand[]=latest_charge` дополнительно записываем:

- `card_brand = latest.payment_method_details.card.brand`
- `card_last4 = latest.payment_method_details.card.last4`
- `card_holder = latest.billing_details.name`

в `payments_v2` через `UPDATE … WHERE id = payment_id`. Никакого влияния на signature/livemode/idempotency/receipt-materialization/grant. Try/catch — never re-throw.

## 9. Backfill для live Stripe `2d40bc7e…` (Phase 5)

Точечный backfill для одного `payments_v2.id='2d40bc7e-e69f-4633-88d5-102561e49a54'` / `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` выполняется через **resend события из Stripe Dashboard**:

1. Stripe Dashboard → Developers → Events → найти событие `payment_intent.succeeded` для `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` (2026-06-09).
2. Нажать **Resend**.
3. Обновлённый webhook поднимет `latest_charge` и заполнит `card_brand`, `card_last4`, `card_holder` в `payments_v2` для этой строки (UPSERT-safe, не дублирует).

Не делаем массового исторического backfill (вынесено в backlog F7).

## 10. UI Verify (Phase 6 — pending user check)

После Phase 1–4 ожидается:

- `/admin/payments`: строка 5 BYN Stripe `2d40bc7e…` → provider=Stripe, status=succeeded, контакт=Сергей Федорчук. После resend — карта Visa ****/holder и Stripe receipt.
- Карточка Сергея `a4b7c8c9…` → вкладка «Платежи» содержит live Stripe 5 BYN + 5 других Stripe-платежей за 06–09.06.
- Ghost-контакты `7500084+dev@gmail.com` / `7500084+stripe-smoke@gmail.com` отсутствуют в списке контактов.
- Failed bePaid `5b5cb22f…` остаётся отдельной failed-строкой (provider=bePaid).

## 11. Freeze confirmation

Не трогали: bePaid webhook, bePaid receipt, Stripe checkout creation, Stripe webhook signature/livemode/idempotency, grant-access lifecycle, Telegram, subscriptions reconcile, refund flow, access resolver, saved cards flow, tariff_offers/meta, миграции (кроме одной точечной функции триггера).

Entitlement `fabd7e5a…` остаётся active. Доступ Сергея не отзывался.

## 12. Files changed

- `supabase/migrations/<ts>_fix_normalize_order_user_id_lookup.sql` (новая)
- `supabase/functions/stripe-webhook/index.ts` (только 2 блока card capture)
- `.lovable/proofs/phase_L4_ghost_profile_fix_v1.md` (этот файл)
- `.lovable/backlog/live_stripe_post_payment_followups.md` (обновление)

Без изменений в `src/`, `_shared/`, `public-checkout`, `bepaid-*`, telegram, reconcile.

## 13. DoD

| # | Критерий | Статус |
|---|---|---|
| 1 | trigger приоритизирует `profiles.user_id` | ✅ migration applied |
| 2 | новые orders Сергея резолвятся на `a4b7c8c9…` | ✅ (после миграции — single profile match) |
| 3 | affected orders/payments repointed | ✅ 8/6 + 4/1/8 связанных |
| 4 | ghost профили удалены | ✅ DELETE 2 rows |
| 5 | live Stripe `2d40bc7e…` привязан к Сергею | ✅ profile_id=a4b7c8c9 |
| 6 | `/admin/payments` Stripe-строка | ⏳ ожидает user UI verify |
| 7 | карточка Сергея показывает Stripe | ⏳ ожидает user UI verify |
| 8 | failed bePaid отдельно | ✅ нетронут |
| 9 | entitlement active | ✅ нетронут |
| 10 | bePaid/Telegram/access без регрессии | ✅ нет изменений в этих модулях |
| 11 | card data: brand/last4/holder | ⏳ ожидает Stripe Dashboard resend для `2d40bc7e…`; будущие Stripe-платежи получают card автоматически |
