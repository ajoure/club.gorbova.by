# Rebill Idempotency Fix — 2026-05

## Diagnose
public-link подписка `SUB-LINK-MNHH6TU2`, sub `a25168db…`, order `2e0b6eaa…`.
- 02.04.26 — первичный grant, `access_end_at=2026-05-02 12:00:00Z`.
- 02.05.26 13:15:27Z — bePaid rebill (`payment 0e713a34`, `is_recurring=true`, `bepaid_subscription_id=sbs_f018657539d76377`).
- `bepaid-webhook` → `grant-access-for-order` → `skip_already_fulfilled` (entitlement+sub уже есть на этот `order_id`).
- Ответ содержал `subscription_id` только внутри `existing` → `grantedSubscriptionV2Id=null` → INLINE-блок продления пропущен.
- webhook_event `2e22be24…` outcome=processed, но `subscription_v2_id=null`.
- Деньги списаны, доступ остался на 02.05 12:00Z.

## Fix (deployed)
- **Fix-1** `grant-access-for-order/index.ts` — в `skip_already_fulfilled` подняты `subscription_id`, `subscription_v2_id`, `entitlement_id` на верхний уровень ответа.
- **Fix-2** `bepaid-webhook/index.ts` — broader fallback lookup для `grantedSubscriptionV2Id`:
  1) `subscriptions_v2.order_id=linkOrder.id`,
  2) `meta->'extended_by_orders' ? linkOrder.id`,
  3) legacy by user+product без фильтра `entitlements.status='active'`.
  INLINE-блок продления (subv2 + entitlements + telegram_access) идёт даже при `already_fulfilled`.
- Инварианты: GREATEST по датам, EOD Europe/Minsk через `endOfDayAppTz`, overshoot guard ≤1.5×access_days.

## Backfill (executed)
Migration `20260503-093942` — single-row canonical repair для `a25168db…`.
Target: `calcCalendarMonthEnd(2026-05-02T12:00Z)` → `endOfDayAppTz(Europe/Minsk)` = **2026-06-02 23:59:59 Minsk = 2026-06-02 20:59:59+00**.

| object | before | after |
|---|---|---|
| `subscriptions_v2.status` | expired | active |
| `subscriptions_v2.access_end_at` | 2026-05-02 12:00:00+00 | 2026-06-02 20:59:59+00 |
| `subscriptions_v2.next_charge_at` | 2026-05-02 12:00:00+00 | 2026-06-02 20:59:59+00 |
| `subscriptions_v2.billing_type / auto_renew` | mit / true | provider_managed / true |
| `entitlements.expires_at` (57525f51) | 2026-06-01 20:59:59+00 | 2026-06-02 20:59:59+00 |
| `telegram_access.active_until` (club fa547c41) | 2026-05-03 12:00:00+00 | 2026-06-02 20:59:59+00 |
| audit `rebill_backfill_2026_05.fixed` | — | inserted |

## Verify
- subscription `active`, access > old ✅
- entitlement синхронизирован (GREATEST) ✅
- telegram_access продлён ✅
- audit `rebill_backfill_2026_05.fixed` присутствует, повторный запуск миграции — no-op (idempotency guard по audit) ✅
- dry-run пострадавших (recurring `succeeded` без `bepaid.webhook.link_order_dates_updated` ±15 мин) — Елена больше не входит, других строк не обнаружено.

## Не трогалось
Первичный grant, installment-ветка, `subscriptions_v2` schema, other providers, manual queue. Same-day drift correction остаётся закрытой (`microcorrection_rollback_2026_05_03`).

## Follow-up (отдельной задачей)
Мониторинг/alert: успешный recurring `payments_v2` без сопровождающего `bepaid.webhook.link_order_dates_updated` в окне 15 минут — alert.
