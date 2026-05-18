# PATCH-TG-REVOKE-2 (revised) — execute proof

**Snapshot:** `2026-05-18T13:00:00+00:00`
**Executed at:** `2026-05-18 20:18:49.93535+00`
**Режим:** EXECUTE — единственный разрешённый DML: 3× INSERT в `telegram_access_queue`.

## 1. Pre-insert guards (все пройдены)

| guard | результат |
|---|:---:|
| admin/staff/founder роль у 3 user_id (`user_roles`) | ✅ 0 rows |
| active entitlement по club mapping | ✅ none |
| active subscription_v2 по club mapping | ✅ none |
| paid order window покрывает snapshot | ✅ none (см. proof 2A) |
| `in_chat=true OR in_channel=true` на snapshot | ✅ обе=true (Gorbova) |
| pending/processing revoke в `telegram_access_queue` | ✅ 0 rows |

## 2. Затронуты ровно 3 строки

| id | user_id | club_id | action | status | customer |
|---|---|---|---|---|---|
| `57a8f1f6-53ec-4d8d-88c2-ef26415352eb` | `f7690c11-1e72-4c65-a525-26ddff89b28a` | `fa547c41` Gorbova Club | revoke | pending | Юлия Станкевич |
| `8ae82d41-f0ff-4674-b5d9-6415fc6e486f` | `a1830fb9-f92d-4f90-91e4-98a516093eb6` | `fa547c41` Gorbova Club | revoke | pending | **Наталья Морозевич (F3)** |
| `b62888e6-abd9-4ac5-b557-10ca2882e982` | `ea1427e2-844f-4b13-a144-0fe1d5d256a6` | `fa547c41` Gorbova Club | revoke | pending | Ирина Протасевич |

`meta` каждой строки:
- `source = 'repair'`
- `patch = 'PATCH-TG-REVOKE-2'`
- `reason = 'expired_platform_access_but_still_member_verified_non_admin'`
- `snapshot_at = '2026-05-18T13:00:00+00:00'`
- `customer`, `email`, `last_paid_at`, `expected_access_until` (трейс из proof 2A)

## 3. Исключены и НЕ затронуты (admin/staff/founder/manual)

| customer | причина |
|---|---|
| Сергей Федорчук (`7500084@gmail.com`) | admin/staff — do_not_touch |
| Ирина Гаринова (`irenessa@yandex.ru`) | admin/staff — do_not_touch |
| Катерина Горбова (`ceo@ajoure.by`) | founder/admin — do_not_touch |
| Алима Ассистент (`imamalievaalima8@gmail.com`) | admin/staff/GIFT — manual |

## 4. Исключены и НЕ затронуты (paid BUSINESS, DATA repair)

Эти 6 пользователей **не получили revoke** — у них активные оплаты BUSINESS, окно покрывает snapshot. Уйдут в отдельный патч `PATCH-DATA-REPAIR-MISSING-ENT` через `grant-access-for-order`.

| customer | last_paid_at | expected_until |
|---|---|---|
| **Екатерина Белозор** | 2026-04-22 18:00 | 2026-05-22 18:00 |
| Екатерина Юролайть | 2026-04-22 09:54 | 2026-05-22 09:54 |
| Елена Краковская | 2026-04-24 19:00 | 2026-05-24 19:00 |
| Любовь Пилецкая | 2026-04-24 09:30 | 2026-05-24 09:30 |
| Марина Босак | 2026-04-28 07:15 | 2026-05-28 07:15 |
| Марта Леоненко | 2026-04-27 06:45 | 2026-05-27 06:45 |

## 5. Запреты — соблюдены

- 0 прямых вызовов Telegram API
- 0 UPDATE/DELETE `telegram_club_members`
- 0 изменений `subscriptions_v2`
- 0 изменений `entitlements`
- 0 изменений `access_rules`
- 0 вызовов `grant-access-for-order`
- 0 вызовов provider/bePaid API
- 0 изменений secrets / mode
- 0 затронутых admin/founder/staff
- 0 затронутых 6 paid-BUSINESS кандидатов

## 6. Post-insert verify

```
SELECT count(*) FROM telegram_access_queue WHERE meta->>'patch'='PATCH-TG-REVOKE-2';
-- 3
```

F3 Наталья Морозевич — присутствует ✅
Admins/founders/staff — отсутствуют ✅
6 paid BUSINESS — отсутствуют ✅
Дубликатов нет (UNIQUE index `(user_id, club_id, subscription_id, action) WHERE status IN ('pending','processing')` не сработал) ✅

## 7. DoD

| | |
|---|:---:|
| Создано ровно 3 queue rows | ✅ |
| F3 Наталья Морозевич включена | ✅ |
| admins/founders/staff не затронуты | ✅ |
| 6 paid BUSINESS repair-кейсов не затронуты | ✅ |
| Proof создан | ✅ |

## 8. Следующий шаг

**PATCH-DATA-REPAIR-MISSING-ENT** (6 пользователей с активной оплатой BUSINESS) — read-only dry-run перед execute через canonical `grant-access-for-order`. Требует отдельного approve.
