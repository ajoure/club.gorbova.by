# P2 — Telegram stale projections / grace cleanup: NO-OP after code switch

Дата: 2026-05-22 (Minsk)
Контекст: после миграции revoke/kick/grace flow с `hasValidAccess` на `hasCommercialAccess`.

## Метрики

| metric | value |
|---|---|
| `stale_projections_no_commercial` (telegram_access state_chat/state_channel = 'member', но нет active entitlement и нет live subscriptions_v2 active/past_due/trial) | **0** |
| Enum `subscription_status` содержит `in_grace`? | **нет** (grace моделируется иначе — через `access_end_at` и `cancel_reason`, отдельной queue нет) |

## Вывод
Кандидатов на controlled execute по revoke / kick / grace expiration **нет**. Code switch на `hasCommercialAccess` сам по себе выровнял состояние; ручной cleanup не требуется.

## SQL (read-only)
```sql
SELECT COUNT(*) FROM telegram_access ta
WHERE (ta.state_chat='member' OR ta.state_channel='member')
  AND NOT EXISTS (
    SELECT 1 FROM entitlements e
    WHERE e.user_id=ta.user_id AND e.status='active'
      AND (e.expires_at IS NULL OR e.expires_at>now())
  )
  AND NOT EXISTS (
    SELECT 1 FROM subscriptions_v2 s
    WHERE s.user_id=ta.user_id
      AND s.status IN ('active','past_due','trial')
      AND (s.access_end_at IS NULL OR s.access_end_at>now())
  );
-- 0
```

## Decision
**Close P2 as no-op.** При появлении ненулевых stale-кандидатов в будущем — запустить controlled execute через `telegram-revoke-access` (canonical writer) с rowcount guard.
