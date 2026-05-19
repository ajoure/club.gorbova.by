# PATCH-SUBV2-REVERT-BACKFILL-2026-05 — verified

## Объяснение

В прошлом проходе я починил только `entitlements`, но UI рекуррентной карточки («Gorbova Club / тариф / Начало / До / Попытка списания / Автопродление / bePaid») читается из `subscriptions_v2`. У этих же 6 пользователей был тот же misfire `bepaid_overshoot_backfill_2026_05` (2026-05-02), который откатил `subscriptions_v2.access_end_at` на ~месяц назад и пометил `status='expired'`. Поэтому в UI отображался обрубок-entitlement, а не нормальная подписочная карточка как у контрольной Черкашиной.

## Scope

Product `11c9f1b8-0355-4753-bd74-40b42aa53616` (Gorbova Club). Ровно 6 user_id:

| user_id | tariff_id | sbs | до revert | после revert |
|---|---|---|---|---|
| 012e765c (Пилецкая) | 31f75673 Стандартный | sbs_7e5cff12c9b9add6 | 2026-02-26 | **2026-05-24** |
| 0b7efe20 (Леоненко) | 7c748940 BUSINESS | sbs_dabc0c2c785c2e1e | 2026-03-26 | **2026-05-27** |
| 23a15a08 (Босак) | 7c748940 BUSINESS | sbs_44259b6b9d9cb6a5 | 2026-03-27 | **2026-05-28** |
| 23b80521 (Юролайть) | 7c748940 BUSINESS | sbs_55877a887df56951 | 2026-04-22 | **2026-05-22** |
| dbfb061f (Белозор) | 7c748940 BUSINESS | sbs_e101fba805137624 | 2026-02-23 | **2026-05-22** |
| f278876e (Краковская) | 7c748940 BUSINESS | sbs_7835fc346fe443c2 | 2026-03-23 | **2026-05-24** |

## Guard (UPDATE WHERE)

- `product_id = 11c9f1b8-...`
- `user_id IN (6 фиксированных)`
- `meta->>'access_end_at_corrected_by' = 'bepaid_overshoot_backfill_2026_05'`
- `meta ? 'access_end_at_previous'`
- `status = 'expired'`

## Изменения

- `access_end_at := (meta->>'access_end_at_previous')::timestamptz`
- `status := 'active'`
- merge в `meta`: `subv2_revert_backfill_2026_05_at/from/reason='bepaid_overshoot_backfill_misfire_for_paid_business'`

## Что НЕ менялось

- `auto_renew` — остался `true` у всех 6
- `meta.bepaid_subscription_id` — сохранён
- `meta.recurring_snapshot` — сохранён (`is_recurring=true`)
- `tariff_id`, `access_start_at` — без изменений
- `entitlements` — не трогались (уже починены ранее)
- `telegram_*` — не трогались
- `orders_v2` — не трогались, нового write-path не создавалось

## Verify (после execute)

Все 6 строк: `status='active'`, `access_end_at ∈ [2026-05-22 .. 2026-05-28]`, `auto_renew=true`, `bepaid_subscription_id` присутствует, `meta.subv2_revert_backfill_2026_05_at = true`.

UI карточка для Юролайть теперь должна отрисоваться нормально: «Gorbova Club / BUSINESS / Начало 22.03.26 / До 22.05.26 / Попытка списания 22.05.26 / Автопродление включено / bePaid» — как у Черкашиной.

## DoD

- [x] 6 строк `subscriptions_v2` → `active`
- [x] `access_end_at` = `paid_at + 30 дней` (через `access_end_at_previous`)
- [x] Никаких изменений в entitlements / telegram / orders_v2
- [x] Никаких вызовов `grant-access-for-order`, bePaid API, Telegram API
- [x] Admin/founder/staff не в скоупе
- [x] Proof создан

## Backlog (отдельной задачей, НЕ в этом патче)

Аудит логики `bepaid_overshoot_backfill_2026_05` (2026-05-02): почему она зацепила 6 живых paid-BUSINESS подписок с валидным `bepaid_subscription_id` и откатила `access_end_at` назад. См. core-rule `bePaid active_to Overshoot Guard` — нужно убедиться, что guard не срабатывает в обратную сторону на свежие активации.
