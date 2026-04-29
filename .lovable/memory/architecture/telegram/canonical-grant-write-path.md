---
name: Canonical Telegram Grant Write-Path
description: Auto-grant Telegram DM goes ONLY through grant-access-for-order → telegram-grant-access. telegram_access_queue is reserved for explicit manual sources (reinvite/manual_bulk/repair/admin_backfill).
type: constraint
---

## Single canonical path

Любая автоматическая выдача Telegram-доступа после оплаты/продления идёт ТОЛЬКО так:

```
payment / renewal
  → grant-access-for-order
  → telegram-grant-access
  → telegram_messages mirror (для UI админа)
```

`bepaid-webhook` для подписок (`WEBHOOK-SUBSCRIPTION`, context=`subscription_renewal`) и для разовых платежей (`WEBHOOK-LINK-ORDER`) сам вызывает `grant-access-for-order`. Никаких параллельных путей.

## Decommissioned (НЕ использовать)

1. **DB-trigger `subscription_grant_telegram` на `subscriptions_v2`** — DISABLED, функция `trg_subscription_grant_telegram()` = no-op. Не включать без явного разрешения и восстановления тела.
2. **`subscription-charge` → `telegram_access_queue.upsert(action='grant')`** — удалено. Renewal grant идёт только через bepaid-webhook → grant-access-for-order.

## telegram_access_queue: только manual

`telegram-process-access-queue` принимает item ТОЛЬКО если `meta.source ∈ {reinvite, manual_bulk, repair, admin_backfill}`. Любая другая запись помечается `status='skipped'`, `last_error='legacy_auto_grant_disabled'` и пишет в `audit_logs` событие `telegram.legacy_queue_skip` (видно в `/admin/telegram/diagnostics` → Audit Logs).

Все ручные источники, которые пишут в queue, ОБЯЗАНЫ ставить `meta.source` из этого списка. Колонок `source` / `priority` в таблице нет — кладём в `meta` jsonb.

## Откат

Эмерджентно: `ALTER TABLE subscriptions_v2 ENABLE TRIGGER subscription_grant_telegram;` + восстановить тело функции из git (миграция `20260429181943_*`). Source-guard в queue-обработчике откатывать отдельно.

## Why

Раньше работали два конкурирующих пути одновременно: canonical (`grant-access-for-order`) и legacy (subscriptions_v2 trigger → queue → process-access-queue → telegram-grant-access). Это давало по 2 DM «Доступ открыт!» на каждую успешную оплату. Постфильтры/idempotency-guards не решали проблему детерминированно: триггер AFTER INSERT успевал создать queue-item раньше, чем canonical путь успевал записать `tracking_id` маркеры. Решение — отрезать legacy-путь у источника.
