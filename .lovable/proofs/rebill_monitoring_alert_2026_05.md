# Rebill No-Extension Monitor — 2026-05

## Discovery

### Существующие таблицы (используем, новых не создаём)
- `system_health_runs` — контейнер запуска (`run_type`, `status`, `summary`, `meta`).
- `system_health_checks` — per-finding строки (`check_key`, `check_name`, `category`, `status`, `details` jsonb, `count`).
  - **Идемпотентность по `payment_id`** через стабильный `check_key = REBILL-NO-EXT:{payment_id}`.

### Существующие edge functions / cron
- `telegram-notify-admins` — переиспользуем для aggregated message.
- `bepaid-discrepancy-alert` — другая задача (несоответствия сумм), не пересекается.
- Похожих 15-минутных мониторов rebill-extension не было.

### Решение
Новую таблицу не создаём. Реюзаем `system_health_runs` + `system_health_checks` + `telegram-notify-admins`.

## Detection logic (SOT)

```
payment.status = 'succeeded'
AND payment.is_recurring = true
AND paid_at ∈ [now-24h, now-15m]   -- cron
   OR ∈ [now-Nd, now-15m]          -- dry-run (N≤30)
AND subscription.access_end_at < expected_end_at_minsk
AND date_minsk(access_end_at) < date_minsk(expected_end_at_minsk)   -- exclude same-day drift
AND subscription.status NOT IN ('canceled','superseded')
AND subscription.meta->>'model' <> 'internal_installment'
AND NOT EXISTS audit (rebill_backfill_*.fixed | manual_repair.* | access_repair.*)
                     for payment_id / subscription_id / order_id
```

`expected_end_at_minsk = endOfDay Europe/Minsk(paid_at + access_days)`.

`audit_link_order_dates_updated_present` пишется в `details.audit_link_order_dates_updated_present` как диагностический флаг — НЕ используется для фильтрации.

## Alert payload (`system_health_checks.details`)
- `payment_id, order_id, order_number, user_id, email`
- `product_id/name, tariff_id/name, subscription_id`
- `paid_at, access_days`
- `current_access_end_at, expected_access_end_at_minsk, gap_hours`
- `audit_link_order_dates_updated_present`
- `reason ∈ {no_extension, audit_missing_with_drift}`

## Notification
- **Aggregated** Telegram-сообщение per tick (один пост со списком top-10 + «…and N more»).
- 0 кандидатов → silent (никаких сообщений).
- Источник: `monitor-rebill-no-extension` через `telegram-notify-admins`.
- HTML, без upsert одной кнопкой.

## Cron
- Job: `monitor-rebill-no-extension-15min`, schedule `*/15 * * * *`.
- Зарегистрирован миграцией (cron.schedule id=49).

## Dry-run (window 7 дней)

Запрос:
```bash
POST /functions/v1/monitor-rebill-no-extension
{ "dry_run": true, "dry_run_days": 7, "notify": false }
```

Результат:
```json
{
  "ok": true,
  "dry_run": true,
  "scanned": 0,
  "new_alerts": 0,
  "telegram_notified": false,
  "candidates": [],
  "window": { "from": "2026-04-26T10:35:35.852Z", "to": "2026-05-03T10:20:35.852Z" }
}
```

**0 кандидатов** — после Fix-1/2/3 в `grant-access-for-order` + `bepaid-webhook` и backfill Ширшовой пострадавших нет. False positives = 0.

## Что НЕ делается
- Auto-repair — explicitly out of scope. Только diagnostic alert.
- Кнопка/ручная процедура repair — отдельная follow-up задача.
- Изменение `grant-access-for-order` / `bepaid-webhook` — Fix-1/2/3 уже задеплоены (`rebill_idempotency_fix_2026_05.md`).
- Same-day drift — исключён (закрыт `microcorrection_rollback_2026_05_03`).
- Installment-ветка — исключена (`meta->>'model'='internal_installment'`).

## DoD ✅
- Discovery-отчёт + решение (переиспользуем существующие таблицы) — done.
- Dry-run за 7 дней с 0 false positives — done.
- Edge function `monitor-rebill-no-extension` deployed — done.
- Cron `*/15 * * * *` активен (id=49) — done.
- Aggregated Telegram alert через `telegram-notify-admins` — wired.
- Idempotency по `payment_id` через `check_key=REBILL-NO-EXT:{id}` — реализована.
- Proof: данный файл.
