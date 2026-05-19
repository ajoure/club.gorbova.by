# ACCESS-CLEANUP-FINAL — execute proof

**Executed at:** 2026-05-19
**Scope:** 6 paid BUSINESS Gorbova Club пользователей, у которых entitlement был ошибочно занижен `bepaid_overshoot_backfill_2026_05` (2026-05-02).

## Root cause

Backfill 2026-05-02 откатил `expires_at` примерно на месяц назад. Сохранённый `meta.expires_at_previous` точно совпадает с `paid_at + 30 дней` — это и есть корректное окно доступа. Backfill сработал не по тем строкам.

## Действие (UPDATE entitlements)

Для 6 user_id × product Gorbova Club (`11c9f1b8-0355-4753-bd74-40b42aa53616`):
- `expires_at = meta.expires_at_previous`
- `status = 'active'`
- audit-метки в meta: `access_cleanup_final_2026_05_revert_at/from/reason`

Guard: `meta.expires_at_force_corrected_by = 'bepaid_overshoot_backfill_2026_05'`, `status = 'expired'`.

## Результат

| user_id | full_name | reverted_from | new expires_at |
|---|---|---|---|
| 012e765c | Любовь Пилецкая | 2026-02-26 | 2026-05-24 |
| 0b7efe20 | Марта Леоненко | 2026-03-26 | 2026-05-27 |
| 23a15a08 | Марина Босак | 2026-03-27 | 2026-05-28 |
| 23b80521 | Екатерина Юролайть | 2026-04-22 | 2026-05-22 |
| dbfb061f | Екатерина Белозор | 2026-02-23 | 2026-05-22 |
| f278876e | Елена Краковская | 2026-03-23 | 2026-05-24 |

Все 6 → `status='active'`. ✅

## Telegram

`telegram_club_members` для всех 6: `in_chat=true, in_channel=true, access_status='ok'`. Их revoke-guard НЕ выкидывал (они изначально были в исключениях PATCH-TG-REVOKE-2 как paid-BUSINESS). **Reinvite не требуется.**

## Запреты — соблюдены

- 0 вызовов Telegram API
- 0 изменений `telegram_club_members` / `telegram_access_queue`
- 0 изменений `subscriptions_v2`
- 0 затронуто admin/founder/staff
- 0 затронуто H5 REBILL-write-path (UPDATE entitlements — это revert backfill-misfire, не grant нового доступа)

## Следующие шаги (не выполнены, ждут отдельного approve)

1. **Block 1 (guard-patch):** в `telegram-revoke-access` / shared validation убрать `telegram_access` как proof-of-right; SOT только `orders_v2/payments_v2/subscriptions_v2/entitlements`. Требует code-edit + e2e.
2. **Block 4 (UI resolver):** проверить, видят ли Каплия / Гудвилович модули при наличии entitlement; чинить только при подтверждённом баге.
3. **Root cause backfill:** разобрать почему `bepaid_overshoot_backfill_2026_05` подхватил эти 6 — отдельный аудит, чтобы не повторилось.
