

# План: Восстановление целостности системы "1 Payment = 1 Order"

## Текущее состояние (диагностика)

| Метрика | Значение | Статус |
|---------|----------|--------|
| Orphan payments | 1675 | ⚠️ Нужен backfill |
| Trial mismatch | 0 | ✅ Исправлено |
| Backfill orders без product_id | 690 | ⚠️ Нужна очистка |
| Помечены needs_manual_mapping | 20 | ✅ Работает |
| Доступ выдан backfill-orders | 0 | ✅ Защита работает |
| Текущий enum order_status | failed, paid, refunded | Нет needs_mapping |

## Критические проблемы для решения

1. **690 "плохих" backfill orders** — созданы до PATCH 6, без product_id, засоряют UI
2. **Advisory lock не работает** — RPC `pg_try_advisory_lock` не существует в Supabase
3. **UI не скрывает проблемные сделки** — needs_mapping статус отсутствует

---

## PATCH 1: Database Migration — добавить enum + SQL functions

**Тип:** Migration (структура БД)

```sql
-- 1. Добавить новое значение в enum order_status
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'needs_mapping';

-- 2. Создать функции для advisory lock
CREATE OR REPLACE FUNCTION public.try_backfill_lock(p_lock_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT pg_try_advisory_lock(p_lock_id);
$$;

CREATE OR REPLACE FUNCTION public.release_backfill_lock(p_lock_id bigint)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT pg_advisory_unlock(p_lock_id);
$$;
```

---

## PATCH 2: Data Migration — пометить 690 backfill orders

**Тип:** Data update (через insert tool, НЕ migration)

```sql
-- Пометить backfill orders без product_id как needs_mapping
UPDATE orders_v2
SET 
  status = 'needs_mapping',
  meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'requires_manual_mapping', true,
    'mapping_reason', 'no_product_recovered_backfill',
    'marked_at', now()::text,
    'marked_by', 'backfill_cleanup_patch'
  )
WHERE meta->>'source' IN ('orphan_payment_fix', 'orphan_backfill')
  AND product_id IS NULL
  AND status != 'needs_mapping';

-- Audit log для трассировки
INSERT INTO audit_logs (action, actor_type, actor_user_id, actor_label, meta)
VALUES (
  'orders.backfill_cleanup',
  'system',
  NULL,
  'patch-cleanup-690-orders',
  jsonb_build_object(
    'orders_updated', (SELECT count(*) FROM orders_v2 WHERE status = 'needs_mapping'),
    'reason', 'no_product_recovered_backfill',
    'executed_at', now()::text
  )
);
```

---

## PATCH 3: admin-backfill-renewal-orders — использовать SQL advisory lock

**Файл:** `supabase/functions/admin-backfill-renewal-orders/index.ts`

**Изменения (строки 103-148):**

```typescript
// ============= PATCH 3: PROPER ADVISORY LOCK =============
if (!dryRun) {
  // Try to acquire lock via SQL function
  const { data: lockAcquired, error: lockError } = await supabase
    .rpc('try_backfill_lock', { p_lock_id: BACKFILL_ADVISORY_LOCK_ID });
  
  if (lockError) {
    console.error('Lock acquisition error:', lockError);
    // Fallback to audit_logs check
    const { data: recentRun } = await supabase
      .from('audit_logs')
      .select('id, created_at')
      .eq('action', 'subscription.renewal_backfill_running')
      .eq('actor_label', 'admin-backfill-renewal-orders')
      .gte('created_at', new Date(Date.now() - 60000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (recentRun) {
      return new Response(JSON.stringify({
        success: false,
        error: 'already_running',
        message: 'Another backfill is currently running (fallback check).',
        running_since: recentRun.created_at,
      }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  } else if (lockAcquired === false) {
    return new Response(JSON.stringify({
      success: false,
      error: 'already_running',
      message: 'Another backfill is currently running. Please wait.',
    }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  
  // Mark as running (for UI visibility + fallback)
  await supabase.from('audit_logs').insert({
    action: 'subscription.renewal_backfill_running',
    actor_type: 'system',
    actor_user_id: null,
    actor_label: 'admin-backfill-renewal-orders',
    meta: { /* ... */ },
  });
}
```

**В конце функции (release lock):**

```typescript
// Release advisory lock in finally
if (!dryRun) {
  await supabase.rpc('release_backfill_lock', { p_lock_id: BACKFILL_ADVISORY_LOCK_ID }).catch(err => {
    console.error('Failed to release lock:', err);
  });
}
```

---

## PATCH 4: grant-access-for-payment — блок для backfill orders

**Файл:** `supabase/functions/grant-access-for-payment/index.ts`

**Добавить после строки 85 (после получения resolvedOrderId):**

```typescript
// ============= PATCH 4: Check if resolved order is backfill-source =============
if (resolvedOrderId) {
  const { data: orderCheck } = await supabase
    .from('orders_v2')
    .select('meta')
    .eq('id', resolvedOrderId)
    .single();
  
  const orderMeta = (orderCheck?.meta || {}) as Record<string, any>;
  const orderSource = orderMeta.source || '';
  
  if (['orphan_payment_fix', 'orphan_backfill'].includes(orderSource)) {
    await supabase.from('audit_logs').insert({
      action: 'access.grant_blocked_backfill_order',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'grant-access-for-payment',
      meta: {
        payment_id: paymentId,
        order_id: resolvedOrderId,
        order_source: orderSource,
        reason: 'backfill_order_cannot_grant',
      },
    });
    
    return new Response(
      JSON.stringify({
        success: false,
        error: 'backfill_order_blocked',
        message: 'Backfill orders cannot grant access. Manual review required.',
        paymentId,
        orderId: resolvedOrderId,
      }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
```

---

## PATCH 5: UI — скрыть needs_mapping по умолчанию

### 5.1 AdminDeals.tsx

**Файл:** `src/pages/admin/AdminDeals.tsx`

**Добавить в STATUS_CONFIG (строка ~67):**

```typescript
needs_mapping: { 
  label: "Требует маппинга", 
  color: "bg-purple-500/20 text-purple-600", 
  icon: AlertTriangle 
},
```

**Добавить state (после строки ~85):**

```typescript
const [showProblematic, setShowProblematic] = useState(false);
```

**Модифицировать filteredDeals (строки 250-272):**

```typescript
const filteredDeals = useMemo(() => {
  if (!deals) return [];
  
  // PATCH 5: Filter out needs_mapping by default
  let result = deals;
  if (!showProblematic) {
    result = result.filter(deal => deal.status !== 'needs_mapping');
  }
  
  // ... остальная логика фильтрации
}, [deals, search, activeFilters, profilesMap, getDealFieldValue, showProblematic]);
```

**Добавить Toggle в UI (рядом с фильтрами):**

```tsx
<div className="flex items-center gap-2 ml-4">
  <Switch 
    checked={showProblematic}
    onCheckedChange={setShowProblematic}
    id="show-problematic"
  />
  <Label htmlFor="show-problematic" className="text-sm text-muted-foreground cursor-pointer">
    Показать проблемные ({deals?.filter(d => d.status === 'needs_mapping').length || 0})
  </Label>
</div>
```

### 5.2 ContactDealsDialog.tsx

**Файл:** `src/components/admin/bepaid/ContactDealsDialog.tsx`

**Добавить в STATUS_CONFIG (строка ~26):**

```typescript
needs_mapping: { label: "Требует маппинга", color: "bg-purple-500/20 text-purple-600", icon: AlertTriangle },
```

**Модифицировать запрос (строка ~79):**

```typescript
// Фильтровать needs_mapping из подсчёта
.neq('status', 'needs_mapping')
```

**Или в useMemo:**

```typescript
const displayedDeals = useMemo(() => {
  if (!deals) return [];
  return deals.filter(d => d.status !== 'needs_mapping');
}, [deals]);
```

---

## Порядок применения

| Шаг | Действие | Тип | Риск |
|-----|----------|-----|------|
| 1 | PATCH 1: Добавить enum + SQL functions | Migration | Низкий |
| 2 | Deploy edge functions | Auto | — |
| 3 | PATCH 2: Пометить 690 orders | Data update | Средний (одноразово) |
| 4 | PATCH 3-4: Edge functions | Code | Низкий |
| 5 | PATCH 5: UI filtering | Frontend | Низкий |
| 6 | Продолжить backfill orphans | Execute | Контролируемый |
| 7 | Верифицировать DoD | SQL queries | — |

---

## DoD — SQL проверки после всех патчей

```sql
-- 1. Orphan payments оставшиеся (до backfill)
SELECT count(*) FROM payments_v2 
WHERE status='succeeded' AND amount>0 AND order_id IS NULL;

-- 2. Backfill orders без product теперь помечены
SELECT count(*) FROM orders_v2 
WHERE meta->>'source' IN ('orphan_payment_fix','orphan_backfill') 
  AND product_id IS NULL 
  AND status != 'needs_mapping';
-- Ожидаемо: 0

-- 3. Все 690 в статусе needs_mapping
SELECT count(*) FROM orders_v2 WHERE status = 'needs_mapping';
-- Ожидаемо: 690

-- 4. Payments с needs_manual_mapping
SELECT count(*) FROM payments_v2 WHERE meta->>'needs_manual_mapping' = 'true';

-- 5. Нет выдачи доступа по backfill
SELECT count(*) FROM audit_logs 
WHERE action LIKE 'access.%' 
  AND meta->>'order_source' IN ('orphan_payment_fix','orphan_backfill');
-- Ожидаемо: 0

-- 6. SYSTEM ACTOR proof
SELECT action, count(*) FROM audit_logs 
WHERE actor_type = 'system' AND actor_label LIKE '%backfill%'
GROUP BY action ORDER BY count DESC;
```

---

## UI DoD

- В списке сделок Admin: `needs_mapping` сделки скрыты по умолчанию
- Toggle "Показать проблемные (690)" отображает их
- В карточке контакта: `needs_mapping` сделки не учитываются в "Сделки (N)"
- Контакт "Ольга" с оплатами 55+100 показывает "Сделки (2)"

---

## Изменяемые файлы

| Файл | Тип изменения |
|------|---------------|
| Database migration | ADD enum value + 2 SQL functions |
| Data update (insert tool) | UPDATE 690 orders to needs_mapping |
| `supabase/functions/admin-backfill-renewal-orders/index.ts` | Proper advisory lock |
| `supabase/functions/grant-access-for-payment/index.ts` | Backfill order block |
| `src/pages/admin/AdminDeals.tsx` | UI filtering + toggle |
| `src/components/admin/bepaid/ContactDealsDialog.tsx` | Hide needs_mapping |

