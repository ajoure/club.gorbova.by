

# План: Fix Autolink + Truth Dates + Access Chain + Notifications + UI

## Статус целей

| Цель | Статус | Причина |
|------|--------|---------|
| 1. Truth dates (не +30) | ❌ | `subscription_v2_id=NULL` → некуда писать |
| 2. Не закрывать доступ утром | ✅ | grace 72h + billing-day protection |
| 3. failed_attempt → дата | ⚠️ | В `provider_subscriptions` есть, дальше не propagates |
| 4. Успешное списание → продление | ❌ | Без линка access chain не выполняется |
| 5. Платежи в карточке | ✅ | Фильтры корректны |
| 6. Grace 72h | ✅ | `hasValidAccess` + guards |
| 7. Sync кнопка + авто | ⚠️ | Работает, но autolink внутри fails silently |

**Root cause всех ❌/⚠️: строка 277 — `'pending'` в enum filter.**

---

## PATCH 1: Autolink enum fix + error logging + effectiveSubV2Id

**Файл:** `supabase/functions/bepaid-get-subscription-details/index.ts`

### 1a. Строка 277: убрать `pending`

```
БЫЛО:  .in('status', ['active', 'trial', 'past_due', 'pending'])
СТАЛО: .in('status', ['active', 'trial', 'past_due'])
```

### 1b. Строка 272: добавить error destructuring

```typescript
const { data: candidates, error: candidatesError } = await supabase
  .from('subscriptions_v2')
  // ...

if (candidatesError) {
  console.error(`[autolink] Priority 4 query error:`, candidatesError.message);
  await supabase.from('audit_logs').insert({
    action: 'bepaid.sync.autolink_query_error',
    actor_type: 'system',
    actor_label: 'bepaid-get-subscription-details',
    meta: { subscription_id, priority: 4, error: candidatesError.message },
  });
}
```

### 1c. Priority 4 расширение (нет product_id → fallback по user_id only)

После блока `autolink_failed_no_product_id` (строка 264–270), добавить fallback:

```typescript
// Priority 4b: user_id only — single active subscription
if (!linkedSubV2Id && existingPs.user_id) {
  const { data: userSubs, error: userSubsError } = await supabase
    .from('subscriptions_v2')
    .select('id')
    .eq('user_id', existingPs.user_id)
    .in('status', ['active', 'trial', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(2);

  if (userSubsError) {
    console.error(`[autolink] Priority 4b query error:`, userSubsError.message);
  } else if (userSubs && userSubs.length === 1) {
    linkedSubV2Id = userSubs[0].id;
    autolinkSource = 'user_only_single_sub';
  } else if (userSubs && userSubs.length !== 1) {
    await supabase.from('audit_logs').insert({
      action: 'bepaid.sync.autolink_ambiguous_or_none',
      actor_type: 'system',
      actor_label: 'bepaid-get-subscription-details',
      meta: { subscription_id, user_id: existingPs.user_id, candidates: userSubs?.length ?? 0 },
    });
  }
}
```

### 1d. Строка 344: `effectiveSubV2Id` вместо мутации

```typescript
// БЫЛО (строка 344):
existingPs.subscription_v2_id = linkedSubV2Id;

// СТАЛО (строка 179 + 344):
// Строка 179: добавить
let effectiveSubV2Id = existingPs.subscription_v2_id;

// Строка 344: заменить на
effectiveSubV2Id = linkedSubV2Id;
```

### 1e. Все обращения к `existingPs.subscription_v2_id` после autolink → `effectiveSubV2Id`

Затронутые строки: 422, 437, 442, 460, 470, 482, 599, 631.

---

## PATCH 2: Propagation guard → effectiveSubV2Id

**Файл:** тот же

Строка 422:
```
БЫЛО:  if (existingPs.subscription_v2_id && (truthNextCharge || truthAccessEnd))
СТАЛО: if (effectiveSubV2Id && (truthNextCharge || truthAccessEnd))
```

Все `.eq('id', existingPs.subscription_v2_id)` внутри PATCH-B5/C/D → `.eq('id', effectiveSubV2Id)`.

Если `effectiveSubV2Id` is null после autolink:
```typescript
await supabase.from('audit_logs').insert({
  action: 'bepaid.sync.skip_propagation_no_subv2',
  actor_type: 'system',
  actor_label: 'bepaid-get-subscription-details',
  meta: { provider_subscription_id: subscription_id, user_id: existingPs.user_id },
});
```

---

## PATCH 3: AdminPaymentLinkDialog queryKey fix

**Файл:** `src/components/admin/AdminPaymentLinkDialog.tsx`, строка 193

```
БЫЛО:  queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions'] });
СТАЛО: queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions', userId] });
```

`userId` уже доступен как проп (строка 46).

---

## PATCH 4: Notifications — defense-in-depth fallback в hasActiveSBS

**Файл:** `supabase/functions/subscription-renewal-reminders/index.ts`, функция `hasActiveSBS` (строка 49)

Текущий inner join (`subscriptions_v2!inner`) fails when `subscription_v2_id=NULL`. Добавить fallback после основной проверки:

```typescript
async function hasActiveSBS(supabase, userId, productId): Promise<boolean> {
  if (!productId) return false;

  // Existing inner join logic (строки 53-77) — оставить как есть
  // ...

  // Defense-in-depth: check provider_subscriptions directly (unlinked subs)
  if (!found) {
    const { data: directPS } = await supabase
      .from('provider_subscriptions')
      .select('id, state, next_charge_at')
      .eq('user_id', userId)
      .in('state', ['active', 'past_due', 'failed_attempt'])
      .not('next_charge_at', 'is', null)
      .limit(5);

    if (directPS && directPS.length > 0) {
      console.warn(`[reminders] hasActiveSBS fallback: user ${userId} has ${directPS.length} unlinked active provider_subscriptions`);
      await supabase.from('audit_logs').insert({
        action: 'reminders.sbs_fallback_hit',
        actor_type: 'system',
        actor_label: 'subscription-renewal-reminders',
        meta: { user_id: userId, product_id: productId, ps_count: directPS.length },
      });
      return true;
    }
  }

  return false;
}
```

---

## PATCH 5: UI — "Доступ до" fallback из provider_snapshot

**Файл:** `src/components/admin/ContactDetailSheet.tsx`

### 5a. Добавить `meta` в select (строка 733)

```
БЫЛО:  id, provider, state, provider_subscription_id,
       next_charge_at, amount_cents, currency, card_brand, card_last4, created_at,
       subscription_v2_id,
СТАЛО: id, provider, state, provider_subscription_id,
       next_charge_at, amount_cents, currency, card_brand, card_last4, created_at,
       subscription_v2_id, meta,
```

### 5b. AccessEnd fallback (строка 1871)

```typescript
// БЫЛО:
const accessEnd = sub.subscriptions_v2?.access_end_at;

// СТАЛО:
const metaObj = (sub.meta || {}) as Record<string, any>;
const accessEnd = sub.subscriptions_v2?.access_end_at
  || metaObj?.provider_snapshot?.active_to
  || null;
const accessEndSource = sub.subscriptions_v2?.access_end_at ? 'db' : 'provider';
```

### 5c. Бейдж источника (строка 1928–1932)

```tsx
{accessEnd && (
  <p className="text-xs text-muted-foreground">
    Доступ до: {formatPaymentTimeIANA(accessEnd, 'Europe/Warsaw')}
    {accessEndSource === 'provider' && (
      <Badge variant="outline" className="ml-1 text-[9px]">provider</Badge>
    )}
  </p>
)}
```

---

## Сводка файлов

| Файл | Патчи | Тип |
|------|-------|-----|
| `supabase/functions/bepaid-get-subscription-details/index.ts` | 1, 2 | Edge |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | 3 | UI |
| `supabase/functions/subscription-renewal-reminders/index.ts` | 4 | Edge |
| `src/components/admin/ContactDetailSheet.tsx` | 5 | UI |

Все изменения **add-only**. Единственное удаление — слово `'pending'` из массива enum values.

---

## DoD (обязательная верификация после деплоя)

1. Sync `sbs_2ba8ec82d7d5c39b` → `subscription_v2_id != NULL`
2. `subscriptions_v2.access_end_at` = endOfDayWarsaw(truth `active_to`)
3. `entitlements.expires_at >= access_end_at`
4. `telegram_access_grants.end_at >= access_end_at`
5. Audit logs: `autolinked_subscription_v2`, `sync_dates`, `access_chain_applied`
6. UI: "Доступ до" виден (с бейджем `provider` если orphan, `db` если linked)
7. AdminPaymentLinkDialog → cancel → список обновляется без F5

