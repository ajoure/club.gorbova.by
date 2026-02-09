PATCH P0.9.6 — ВЫПОЛНЕН 2026-02-09

## Что сделано

### SQL миграции
1. **trg_close_superseded_subscriptions** — триггер на subscriptions_v2: при INSERT/UPDATE status→active/trial автоматически закрывает старые подписки того же user+product (status='superseded', auto_renew=false)
2. **cascade_order_cancellation(order_id, reason)** — SQL-функция для каскадной деактивации entitlements/subscriptions/grants при отмене заказа
3. **expire_stale_entitlements(batch_limit)** — SQL-функция для истечения entitlements с expires_at < now(), SKIP LOCKED, batch 500
4. **find_wrongly_revoked_users()** — RPC переписана: JOIN через product_club_mappings для проверки привязки access↔club_id
5. **subscription_status enum** — добавлены значения 'superseded' и 'expired_reentry'
6. **pg_cron** — expire-stale-entitlements-hourly (каждый час :15)

### Data fixes
- Марина Лойко: `5d26ed52` → status=superseded, auto_renew=false ✅
- Grant `d0f24bd9` (7500084 в Бухгалтерию) → revoked ✅
- Grant `af20c944` (1@ajoure.by в Gorbova Club) → revoked ✅
- 23 просроченных entitlements → expired ✅

### Edge Functions
- **subscription-charge/index.ts** — добавлен SUPERSEDED CHECK: перед списанием проверяет наличие newer active sub на тот же product_id. Если есть — помечает текущую как superseded и SKIP charge.

### UI
- **AutoRenewalsTabContent.tsx** — dedup по user_id+product_name: показывает только "лучшую" подписку (max access_end_at), дубликаты скрыты.

## SQL-пруфы
- Лойко: `SELECT status, auto_renew FROM subscriptions_v2 WHERE id='5d26ed52...'` → superseded, false
- Гранты: оба revoked с причиной
- Stale entitlements: 0
- RPC find_wrongly_revoked_users(): [] (пустой — нет ложных кандидатов)

## Файлы изменены
| Файл | Изменение |
|------|-----------|
| supabase/functions/subscription-charge/index.ts | +50 строк superseded guard |
| src/components/admin/payments/AutoRenewalsTabContent.tsx | +15 строк dedup reduce |
| SQL миграции (3 штуки) | trigger + 3 functions + enum + cron |
