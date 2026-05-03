# Microcorrection Rollback — 2026-05-03 (EOD Minsk invariant)

**Дата:** 2026-05-03
**Инвариант:** доступ всегда заканчивается в 23:59:59 Europe/Minsk дня окончания оплаченного периода / планового списания. Разница только во времени внутри одного дня — НЕ overshoot.

## Backup

`public._microcorrection_rollback_2026_05_03_backup` — снимок до отката.

| source_table       | rows |
|--------------------|-----:|
| subscriptions_v2   | 118  |
| entitlements       | 114  |

Захвачены поля: access_end_at, next_charge_at, expires_at, meta (полный JSON), marker, captured_at.

## Затронутые маркеры

- `bepaid_overshoot_backfill_2026_05` — 76 строк
- `inv22_overshoot_backfill_2026_05_v3.1` — 42 строки
- Итого: **118 подписок**

## Pre-rollback (нуждались в подъёме до 23:59:59 Минск)

| marker                                | subs | need_end_bump | need_nc_bump |
|---------------------------------------|-----:|--------------:|-------------:|
| bepaid_overshoot_backfill_2026_05     |   76 |            68 |           68 |
| inv22_overshoot_backfill_2026_05_v3.1 |   42 |            36 |           32 |

Entitlements с тем же днём, но временем раньше 23:59:59: **102 строки**.

## Execute

1. UPDATE `subscriptions_v2.access_end_at` → 23:59:59 Europe/Minsk того же дня для всех 118 строк.
2. UPDATE `subscriptions_v2.next_charge_at` → 23:59:59 Europe/Minsk того же дня (где не NULL).
3. UPDATE `entitlements.expires_at` → 23:59:59 Europe/Minsk дня (только если день совпадал и время раньше). Затронуто **101 строка** (3 из 102 уже были на 23:59:59 на момент апдейта).
4. В `subscriptions_v2.meta` добавлены маркеры `rollback_to_eod_minsk_2026_05_03_at` и `rollback_to_eod_minsk_2026_05_03_marker_was`.

## Audit

`audit_logs.action='microcorrection.rollback_to_eod_minsk_2026_05_03'`:

| тип    | count |
|--------|------:|
| subscriptions | 118 |
| entitlements  | 101 |
| **total**     | **219** |

Каждая запись содержит `before_*` / `after_*` значения, marker, reason.

## Verify

```
WITH affected AS (
  SELECT id, access_end_at, next_charge_at,
    eod_minsk(access_end_at) as eod_end,
    eod_minsk(next_charge_at) as eod_nc
  FROM subscriptions_v2
  WHERE meta->>'rollback_to_eod_minsk_2026_05_03_marker_was' IS NOT NULL
)
SELECT count(*) total, COUNT(*) FILTER (WHERE access_end_at < eod_end) still_low_end,
       COUNT(*) FILTER (WHERE next_charge_at IS NOT NULL AND next_charge_at < eod_nc) still_low_nc
FROM affected;

→ total=118, still_low_end=0, still_low_nc=0  ✅

ent_still_low (entitlements с тем же днём но временем < 23:59:59 Минск)
→ 0  ✅
```

## Spot-check

| email             | subscription_id                          | access_end_at (UTC)     | в Минске           |
|-------------------|------------------------------------------|-------------------------|--------------------|
| 6972333@mail.ru   | aa5cb927-22d8-4575-afc8-0b55d08ad0fa     | 2026-05-04 20:59:59+00  | 04.05 23:59:59 ✅ |
| lena_times@mail.ru| 8a880ae9-6480-4c2e-a8fe-0939405ccd29     | 2026-05-03 20:59:59+00  | 03.05 23:59:59 ✅ |

## bepaid-webhook guard

`supabase/functions/bepaid-webhook/index.ts`:
- Кандидат `bepaidActiveTo` уже проходит через `endOfDayAppTz(...)` (Europe/Minsk EOD) на строках 1503 и 2755 — значит intra-day разница автоматически нормализуется к 23:59:59 Минск и НЕ считается overshoot.
- Overshoot guard (строки 2736-2807) срабатывает только когда bePaid `active_to` уезжает на следующий цикл сверх tolerance (`access_days * 1.5`) — то есть на день/месяц/цикл вперёд, а не на часы внутри того же дня.
- Дополнительной правки кода не требуется: same-day shrink был внесён исключительно одноразовыми backfill-скриптами (`bepaid_overshoot_backfill_2026_05`, `inv22_overshoot_backfill_2026_05_v3.1`), которые уже удалены.

## Уведомления / revoke

- Никаких новых Telegram/email уведомлений не отправлено.
- Никаких revoke по этим строкам не выполнено.
- Snapshot `_inv22_overshoot_snapshot` оставлен историческим артефактом; в дальнейшем используется только инвариант EOD Минск.

## DoD

- [x] Backup `_microcorrection_rollback_2026_05_03_backup` (118 + 114 = 232 строки).
- [x] same-day shrink subs = 0.
- [x] entitlements within same day < 23:59:59 = 0.
- [x] audit `microcorrection.rollback_to_eod_minsk_2026_05_03` = 219.
- [x] 6972333@mail.ru → 04.05.2026 23:59:59 Minsk.
- [x] lena_times@mail.ru → 03.05.2026 23:59:59 Minsk.
- [x] webhook guard работает по EOD-Минск (через `endOfDayAppTz`).
- [x] уведомления / revoke — НЕ выполнялись.

Тема закрыта.
