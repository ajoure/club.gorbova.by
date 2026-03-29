

# План: Устранение ложных срабатываний INV-20 и INV-22 (v4)

---

## DIAGNOSE (перед любым фиксом)

### SQL 0a — разбивка 290 по provider

```sql
SELECT coalesce(o.provider, '__NULL__') AS provider, count(*) cnt
FROM orders_v2 o
LEFT JOIN payments_v2 p ON p.order_id = o.id
WHERE o.status = 'paid' AND p.id IS NULL
GROUP BY o.provider ORDER BY cnt DESC;
```

### SQL 0b — есть ли bePaid-заказы с provider != 'bepaid'

```sql
SELECT count(*) cnt
FROM orders_v2 o
WHERE o.status = 'paid'
  AND (o.provider IS NULL OR o.provider != 'bepaid')
  AND (
    o.bepaid_subscription_id IS NOT NULL
    OR (o.meta->>'bepaid_subscription_id') IS NOT NULL
  );
```

### SQL 1 — разбивка 290 по reconcile_source

```sql
SELECT o.reconcile_source, count(*) cnt
FROM orders_v2 o
LEFT JOIN payments_v2 p ON p.order_id = o.id
WHERE o.status = 'paid' AND p.id IS NULL
GROUP BY o.reconcile_source ORDER BY cnt DESC;
```

### SQL 2 — 20 примеров ТОП-источника

```sql
SELECT o.id, o.order_number, o.reconcile_source, o.provider,
       o.bepaid_subscription_id, o.created_at, o.meta
FROM orders_v2 o
LEFT JOIN payments_v2 p ON p.order_id = o.id
WHERE o.status = 'paid' AND p.id IS NULL
ORDER BY o.created_at DESC LIMIT 20;
```

### INV-22 dry-run

```sql
SELECT s.id, s.user_id, s.profile_id, s.auto_renew, s.status, s.access_end_at,
       ps.id as ps_id, ps.state, ps.renew_at, ps.active_to
FROM subscriptions_v2 s
JOIN provider_subscriptions ps ON ps.subscription_v2_id = s.id
WHERE s.auto_renew = true AND s.status = 'active'
  AND (
    ps.state IN ('expired','canceled','failed','redirecting')
    OR (ps.id IS NOT NULL AND ps.renew_at IS NULL AND ps.active_to IS NULL)
  );
```

---

## FIX 1: INV-20 — безопасный фильтр (allowlist не перебивается denylist)

### Ключевое правило

bePaid-marked заказы проверяются **всегда** (denylist по reconcile_source их НЕ исключает). Только non-bepaid заказы фильтруются по reconcile_source.

### WHERE-условие (единый SQL-фрагмент для RPC и fallback)

```sql
WHERE o.status = 'paid'
  AND NOT EXISTS (SELECT 1 FROM payments_v2 p WHERE p.order_id = o.id)
  AND (
    -- (A) bePaid-marked → проверяем ВСЕГДА, denylist не применяется
    o.provider = 'bepaid'
    OR o.bepaid_subscription_id IS NOT NULL
    OR (o.meta->>'bepaid_subscription_id') IS NOT NULL
    -- (B) non-bepaid → проверяем только если не known non-payment source
    OR (
      (o.provider IS NULL OR o.provider != 'bepaid')
      AND o.bepaid_subscription_id IS NULL
      AND (o.meta->>'bepaid_subscription_id') IS NULL
      AND (
        o.reconcile_source IS NULL
        OR o.reconcile_source NOT IN (
          'getcourse_historical', 'rule_engine', 'bepaid_archive_import'
        )
      )
    )
  )
```

### Применение — строго идентично в 2 местах

1. **Миграция**: `CREATE OR REPLACE FUNCTION inv20_paid_orders_without_payments` — CTE `missing` и `suppressed` получают этот WHERE вместо текущего.
2. **Nightly fallback** (строки 220-244 в `nightly-payments-invariants/index.ts`): заменить fallback-запрос на **вызов того же RPC** `supabase.rpc('inv20_paid_orders_without_payments')`. Это единственный способ гарантировать идентичность. Если RPC упал — логировать ошибку и НЕ пытаться fallback с другой логикой.

Текущий fallback (`from('orders_v2').select().eq('status','paid')...`) **удаляется** — он уже не нужен, потому что не может воспроизвести гибридный WHERE через JS-фильтры.

### Unknown_sources info-лог (regress guard)

После основных инвариантов, nightly выполняет info-запрос:

```sql
SELECT coalesce(o.provider,'__NULL__') AS provider,
       coalesce(o.reconcile_source,'__NULL__') AS reconcile_source,
       count(*) cnt
FROM orders_v2 o
WHERE o.status = 'paid'
  AND o.created_at > now() - interval '30 days'
GROUP BY 1, 2
ORDER BY cnt DESC
LIMIT 50;
```

Логируется как `level: 'info'`, не `failed`. `LIMIT 50` предотвращает тяжёлый scan.

---

## FIX 2: INV-22 — UPDATE + row-level audit

### Execute

UPDATE только exact id из dry-run: `SET auto_renew = false`.

### Audit — row-level (стандарт проекта)

**Единый actor_label**: `patch_inv20_inv22_fix`.

1 batch audit:
```json
{
  "action": "inv22.batch_auto_renew_disabled",
  "actor_type": "system",
  "actor_label": "patch_inv20_inv22_fix",
  "meta": { "subscription_count": 2, "reason": "INV-22: provider_subscription terminal state" }
}
```

N row-level audit (по каждой подписке):
```json
{
  "action": "inv22.subscription_auto_renew_disabled",
  "actor_type": "system",
  "actor_label": "patch_inv20_inv22_fix",
  "meta": {
    "subscription_v2_id": "...",
    "provider_subscription_id": "...",
    "old_auto_renew": true,
    "new_auto_renew": false,
    "ps_state": "expired",
    "ps_renew_at": null,
    "ps_active_to": "...",
    "access_end_at": "..."
  }
}
```

---

## Изменяемые компоненты

1. **Миграция SQL**: `CREATE OR REPLACE FUNCTION inv20_paid_orders_without_payments` — гибридный WHERE
2. **Edge function** `nightly-payments-invariants/index.ts`: удалить JS-fallback (строки 220-251), оставить только RPC-путь + unknown_sources info-лог
3. **Insert tool**: UPDATE 2 подписки + INSERT audit_logs (batch + row-level)

## Scope isolation

Фильтр применяется **только** к INV-20. INV-19, INV-21, INV-22 логика — не затрагивается. Add-only (кроме удаления fallback, который заменяется RPC).

## DoD

1. Диагностика SQL 0a/0b/1/2 выполнена, proof зафиксирован
2. INV-20 before: 290 → after: 0 (или только реальные bePaid без платежей)
3. **Proof bepaid-subset** (не увеличился после фикса):
   ```sql
   SELECT count(*)
   FROM orders_v2 o
   LEFT JOIN payments_v2 p ON p.order_id = o.id
   WHERE o.status='paid' AND p.id IS NULL
     AND (o.provider='bepaid'
          OR o.bepaid_subscription_id IS NOT NULL
          OR (o.meta ? 'bepaid_subscription_id'));
   ```
   Ожидание: 0 или только реальные проблемы (не скрыты фильтром).
4. INV-22 before: 2 → after: 0
5. audit_logs: 1 batch + 2 row-level записи, `actor_type='system'`, `actor_label='patch_inv20_inv22_fix'`, row-level включает `provider_subscription_id`, `ps_state`, `ps_renew_at`, `ps_active_to`
6. Regress guard: unknown provider/reconcile_source логируются как info с `LIMIT 50`
7. Другие инварианты не затронуты

