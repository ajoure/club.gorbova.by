
# PATCH-H (BLOCKER): Обязательный Fallback из `provider_subscriptions`

## Проблема

| Факт | Значение |
|------|----------|
| Записей в `provider_subscriptions` (provider='bepaid') | **9** |
| UI показывает | **0** ("Подписки не найдены") |
| bePaid list API возвращает | Пустой список |
| Текущий fallback источник | `subscriptions_v2.meta.bepaid_subscription_id` (37 записей) |

### Корневая причина

1. bePaid list API возвращает пустой список (возможно, устаревшие creds или подписки в другом shop_id)
2. Fallback делает `GET /subscriptions/{id}` для 37 ID из `subscriptions_v2.meta`
3. bePaid возвращает 404 для большинства этих ID (они старые/несуществующие)
4. Результат: 0 подписок в UI, хотя в `provider_subscriptions` есть 9 актуальных записей

### Требование

UI должен показывать **минимум 9 записей** (из `provider_subscriptions`), даже если bePaid API недоступен.

---

## Решение: Алгоритм fallback в `bepaid-list-subscriptions`

```text
1. Попробовать bePaid list API по статусам
   ├── Успех → использовать результат
   └── Пустой/ошибка → fallback:

2. FALLBACK (обязательный):
   a) Загрузить ВСЕ записи из provider_subscriptions (provider='bepaid')
   b) Для каждой записи: попробовать GET /subscriptions/{id} (батчами, limit 20)
   c) Если details получен → merge с данными из provider_subscriptions
   d) Если details НЕ получен → всё равно вернуть запись с флагом details_missing=true

3. Результат:
   - subscriptions[]: ВСЕ записи из provider_subscriptions (минимум 9)
   - stats.total = 9 (а не 0)
   - debug: api_list_count, provider_subscriptions_count, details_fetched_count, details_failed_count
```

---

## Технические изменения

### Файл: `supabase/functions/bepaid-list-subscriptions/index.ts`

#### 1. Изменить источник fallback IDs

Текущий код (строки 165-176):
```typescript
// Collect subscription IDs we know about (for linking)
const { data: dbSubs } = await supabase
  .from('subscriptions_v2')
  .select('id, user_id, meta, status')
  .not('meta->bepaid_subscription_id', 'is', null);
```

Нужно добавить использование `provider_subscriptions` как ОСНОВНОГО fallback источника.

#### 2. Новый алгоритм fallback (заменить строки 234-272)

```typescript
// PATCH-H: MANDATORY fallback to provider_subscriptions
if (allSubscriptions.length === 0 && (providerSubs?.length || 0) > 0) {
  console.log(`[bepaid-list-subs] API list empty, using provider_subscriptions fallback (${providerSubs?.length} records)`);
  
  let detailsFetched = 0;
  let detailsFailed = 0;
  
  for (const ps of providerSubs || []) {
    const psId = ps.provider_subscription_id;
    if (!psId || fetchedIds.has(psId)) continue;
    
    // Try to get details from bePaid API
    try {
      const url = `https://api.bepaid.by/subscriptions/${psId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authString}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data?.subscription) {
          detailsFetched++;
          fetchedIds.add(psId);
          allSubscriptions.push({
            id: psId,
            status: data.subscription.state || data.subscription.status || ps.state || 'unknown',
            state: data.subscription.state,
            plan: data.subscription.plan,
            created_at: data.subscription.created_at,
            next_billing_at: data.subscription.next_billing_at,
            credit_card: data.subscription.credit_card,
            customer: data.subscription.customer,
          });
          continue; // Got details, skip placeholder
        }
      }
    } catch (e) {
      console.warn(`[bepaid-list-subs] Failed to fetch details for ${psId}: ${e}`);
    }
    
    // CRITICAL: Add placeholder from DB even if API failed
    detailsFailed++;
    fetchedIds.add(psId);
    allSubscriptions.push({
      id: psId,
      status: ps.state || 'unknown',
      state: ps.state,
      plan: undefined,
      created_at: undefined,
      next_billing_at: undefined,
      credit_card: undefined,
      customer: undefined,
      // Mark as details_missing for UI
      _details_missing: true,
    });
  }
  
  console.log(`[bepaid-list-subs] Fallback complete: ${detailsFetched} fetched, ${detailsFailed} failed (placeholders created)`);
}
```

#### 3. Добавить флаг `details_missing` в интерфейс SubscriptionWithLink

```typescript
interface SubscriptionWithLink {
  // ... existing fields ...
  details_missing?: boolean;  // True if bePaid API didn't return details
}
```

#### 4. Передавать флаг в result (строки 284-323)

```typescript
// In result mapping:
details_missing: !!(sub as any)._details_missing,
```

#### 5. Исправить debug объект (строки 348-356)

Текущий:
```typescript
debug: {
  pages_fetched: allSubscriptions.length > 0 ? 'multiple' : 'fallback',  // ПЛОХО: string
  fallback_ids_count: bepaidIdToOurSub.size,  // НЕВЕРНО: не provider_subscriptions
}
```

Исправить на:
```typescript
debug: {
  creds_source: credentials.source,
  integration_status: credentials.instanceStatus || null,
  statuses_tried: ['active', 'trial', 'cancelled', 'past_due'],
  api_list_count: apiListCount,  // NEW: сколько получили из list API
  provider_subscriptions_count: providerSubs?.length || 0,  // NEW
  details_fetched_count: detailsFetched,  // NEW
  details_failed_count: detailsFailed,  // NEW
  result_count: result.length,
}
```

---

### Файл: `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`

#### 1. Добавить `details_missing` в интерфейс

```typescript
interface BepaidSubscription {
  // ... existing fields ...
  details_missing?: boolean;
}
```

#### 2. Показывать badge для записей без деталей

В таблице добавить индикатор:
```typescript
{sub.details_missing && (
  <Badge variant="outline" className="text-xs text-amber-600">
    Нет деталей
  </Badge>
)}
```

#### 3. Обновить DebugInfo интерфейс

```typescript
interface DebugInfo {
  creds_source?: 'integration_instance' | 'env_vars';
  integration_status?: string | null;
  statuses_tried?: string[];
  api_list_count?: number;  // NEW
  provider_subscriptions_count?: number;  // NEW
  details_fetched_count?: number;  // NEW
  details_failed_count?: number;  // NEW
  result_count?: number;
}
```

#### 4. Обновить debug popover

```typescript
<PopoverContent className="w-80">
  <div className="text-xs space-y-1">
    <div><strong>Источник creds:</strong> {debugInfo?.creds_source}</div>
    <div><strong>Статус интеграции:</strong> {debugInfo?.integration_status || 'N/A'}</div>
    <div><strong>API list:</strong> {debugInfo?.api_list_count ?? 'N/A'}</div>
    <div><strong>В provider_subscriptions:</strong> {debugInfo?.provider_subscriptions_count}</div>
    <div><strong>Details получены:</strong> {debugInfo?.details_fetched_count}</div>
    <div><strong>Details failed:</strong> {debugInfo?.details_failed_count}</div>
    <div><strong>Итого результат:</strong> {debugInfo?.result_count}</div>
  </div>
</PopoverContent>
```

---

## Ключевое правило

**Даже если bePaid API полностью недоступен, UI должен показывать записи из `provider_subscriptions` с пометкой "Нет деталей".**

---

## DoD (Definition of Done)

### DoD-H1: SQL пруф
```sql
SELECT count(*) FROM provider_subscriptions WHERE provider = 'bepaid';
-- Expected: 9
```

### DoD-H2: Edge response
```json
{
  "subscriptions": [ /* 9 items */ ],
  "stats": { "total": 9, ... },
  "debug": {
    "api_list_count": 0,
    "provider_subscriptions_count": 9,
    "details_fetched_count": X,
    "details_failed_count": Y,
    "result_count": 9
  }
}
```

### DoD-H3: UI proof
- Карточка "Всего" показывает **9** (не 0)
- Таблица содержит 9 строк
- Записи без деталей помечены "Нет деталей"

### DoD-H4: Edge logs
```
[bepaid-list-subs] API list empty, using provider_subscriptions fallback (9 records)
[bepaid-list-subs] Fallback complete: X fetched, Y failed (placeholders created)
Found 9 total subscriptions, Z orphans
```

---

## Приоритет

**BLOCKER** — без этого исправления UI бесполезен (показывает 0 при 9 реальных записях).
