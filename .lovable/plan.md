# да, согласен, с учетом правок:

&nbsp;

&nbsp;

## **1) PATCH 1–2 (UI поиск/статусы)**

&nbsp;

&nbsp;

- failed_attempt — **валидный статус подписки bePaid**, его нужно добавить в STATUS_LABELS и в badge/фильтры. 
- Автопереключение statusFilter → "all" при ручном вводе searchQuery и после “Получить из bePaid по ID” — ок, но добавить STOP-guard: не перезаписывать выбранный фильтр, если пользователь сам уже поставил "all".

&nbsp;

&nbsp;

&nbsp;

## **2) PATCH 3 (bepaid-list-subscriptions): не добавлять** 

## **X-Api-Version: 3**

##  **«наугад»**

&nbsp;

&nbsp;

В доке по Subscriptions нет требования X-Api-Version для [https://api.bepaid.by/subscriptions](https://api.bepaid.by/subscriptions) (пример — обычный POST с basic auth). 

Правка плана:

&nbsp;

- Сначала зафиксировать **факт**: логировать status, headers, и первые N символов body при items_count=0 (без PII).
- Проверить, что для list используется корректная авторизация **Basic shop_id:secret_key** и правильный base URL [api.bepaid.by](http://api.bepaid.by).
- Accept: application/json / Content-Type: application/json — да, можно добавить как безопасное улучшение.
- maxPages увеличивать только после подтверждения, что API реально возвращает items.

&nbsp;

&nbsp;

&nbsp;

## **3) PATCH 4 (backfill user_id/profile_id): только через доказуемые связи, без догадок**

&nbsp;

&nbsp;

- Если subscription_v2_id есть → брать subscriptions_v2.user_id (источник истины).
- Если есть meta.order_id → брать orders_v2.user_id (fallback).
- Парсинг tracking_id допустим только если формат гарантирован (иначе fail-open + лог warning).

&nbsp;

&nbsp;

&nbsp;

## **4) PATCH 5 (data fix): без хардкод-**

## **user_id**

##  **в SQL**

&nbsp;

&nbsp;

Убрать точечный апдейт с прямым user_id='...'. Вместо этого:

&nbsp;

- сделать **dry-run**: список provider_subscriptions где user_id is null и есть subscription_v2_id/meta.order_id;
- затем **execute** апдейт через join на subscriptions_v2/orders_v2 (однозначно выводимый user_id), с rowcount-guard и audit_log.

&nbsp;

&nbsp;

&nbsp;

## **5) Доп. правка по смыслу “не создавать токенизацию случайно”**

&nbsp;

&nbsp;

Если в payment-link generation используется widget/checkout, убедиться, что для one-time ссылок не добавляются recurring contracts (contract: ['recurring','card_on_file']), т.к. это включает сохранение/токены. 

&nbsp;

Investigation: bePaid Subscription `sbs_937389c41f7daaa7` Not Found in Search

## Root Causes Found

I invoked the `bepaid-list-subscriptions` edge function and confirmed the subscription **IS returned by the backend** (last item in the 334-item response, line 8225). The data is correct:

- `id: sbs_937389c41f7daaa7`, `status: failed_attempt`, `linked_profile_name: Alexandra Sermyazhko`
- Properly linked to order, subscription_v2, and user

The bug is in the **UI layer**, not the backend. Three issues combine to make it unfindable:

### Bug 1: Default status filter hides non-standard states

When a user opens `/admin/payments/bepaid-subscriptions` WITHOUT a `?search=` param, the default filter is `"active"` (line 311). The state `failed_attempt` is not `active`, so it's hidden. Only when navigating WITH `?search=sbs_...` does the filter switch to `"all"`.

**Critical scenario**: User uses "Получить из BePaid по ID" (line 1518), backfill succeeds, `refetch()` runs, but the user is **already on the page without `?search=**`, so the status filter remains `"active"` → subscription hidden.

### Bug 2: `failed_attempt` not in STATUS_LABELS

The status `failed_attempt` is missing from `STATUS_LABELS` (line 199-213). It renders as raw text `failed_attempt` instead of a human-readable label. It also can't be actively filtered for since `StatusFilter` type doesn't include it.

### Bug 3: bePaid list API returns 0 items

The debug output shows `api_list_count: 0`. The bePaid API list endpoint (`/subscriptions?page=1&per_page=50`) returns 200 but 0 items. All 334 subscriptions come entirely from DB-first fallback. This isn't a search blocker (DB-first works), but it means **no fresh data syncs from bePaid** — states, next_billing_at, and card data never get updated from the API.

### Additional issue: Backfill doesn't set `user_id`

The `admin-bepaid-backfill-subscriptions` function (line 129-155, `buildProviderSubRecord`) doesn't resolve or set `user_id`/`profile_id` on the `provider_subscriptions` record, even when `subscription_v2_id` is available. The list function works around this via order linkage, but the raw DB record remains orphaned.

---

## Plan

### PATCH 1: UI — Status filter auto-switch when searching (BepaidSubscriptionsTabContent.tsx)

When user types a search query manually (not from URL), auto-switch status filter to `"all"` to prevent hiding results:

```typescript
// In the search input onChange handler:
if (newSearchQuery.trim() && statusFilter !== "all") {
  setStatusFilter("all");
}
```

Also: after "Получить из BePaid по ID" succeeds (line 1528), set the search query to the fetched ID and force status filter to "all":

```typescript
setSearchQuery(fetchByIdValue.trim());
setStatusFilter("all");
refetch();
```

### PATCH 2: UI — Add `failed_attempt` to STATUS_LABELS (BepaidSubscriptionsTabContent.tsx)

```typescript
const STATUS_LABELS: Record<string, string> = {
  // ... existing entries
  failed_attempt: 'Ошибка оплаты',  // ← add
};
```

Add `failed_attempt` case to `getStatusBadge` — render as red/destructive badge (similar to `failed`).

### PATCH 3: Backend — Fix bePaid list API pagination (bepaid-list-subscriptions)

The API returns 0 items from `api.bepaid.by/subscriptions`. This is likely an authentication header format issue or API version change. Fix:

1. Add `X-Api-Version: 3` header to the list fetch (currently missing, but present in other bePaid calls like `admin-reconcile-processing-payments`)
2. Add `Accept: application/json` header (already present for details but might be needed for list)
3. Log the actual response body when `items_count === 0` to diagnose the API response format
4. Increase `maxPages` from 6 to 10 (to handle up to 500 subscriptions)

### PATCH 4: Backend — Backfill resolves user_id (admin-bepaid-backfill-subscriptions)

In `buildProviderSubRecord` and the update path, resolve `user_id` from:

1. `subscription_v2_id` → look up `subscriptions_v2.user_id`
2. `tracking_id` (from raw data) → parse `subv2:{id}:order:{order_id}` → look up `orders_v2.user_id`

This ensures the `provider_subscriptions` record gets properly linked after backfill.

### PATCH 5: Data fix — Update `sbs_937389c41f7daaa7` right now

SQL migration to set `user_id` on the specific record:

```sql
UPDATE provider_subscriptions
SET user_id = 'f4dba33b-6afb-4360-a7ee-a94f58858ae2'
WHERE provider_subscription_id = 'sbs_937389c41f7daaa7'
  AND user_id IS NULL;
```

Also run a bulk fix for all `provider_subscriptions` with `subscription_v2_id` set but `user_id` NULL.

---

## Files Changed


| File                                                              | Change                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx` | Add `failed_attempt` to STATUS_LABELS + badge; auto-switch filter to "all" on search; set search query after fetch-by-ID |
| `supabase/functions/bepaid-list-subscriptions/index.ts`           | Add API headers (X-Api-Version, Accept); log 0-item response body; increase maxPages to 10                               |
| `supabase/functions/admin-bepaid-backfill-subscriptions/index.ts` | Resolve user_id from subscription_v2_id or tracking_id during backfill                                                   |
| SQL migration                                                     | Fix user_id for sbs_937389c41f7daaa7 + bulk fix all orphaned provider_subscriptions with known subscription_v2_id        |


## Deploy

- `bepaid-list-subscriptions`
- `admin-bepaid-backfill-subscriptions`