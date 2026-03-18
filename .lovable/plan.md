# да, согласен, с учетом правок:

&nbsp;

&nbsp;

## **1) PATCH B (truth extract) — обязателен рефактор порядка выполнения**

&nbsp;

&nbsp;

Сейчас по вашему описанию truth-extract стоит “на линии 117”, до получения existingPs. Так нельзя.

&nbsp;

**Правка:**

&nbsp;

- Делайте **двухэтапно**:
  &nbsp;
  1. **PRE**: сразу после const sub = ... извлекаем truth **только из API-ответа** (sub.*, sub.subscription.*, data.*) — без raw_data.
  2. **POST**: после fetch existingPs и (если нужно) после autolink — делаем **FINAL truth extract** с fallback на existingPs.raw_data.*.
  &nbsp;

&nbsp;

&nbsp;

**И только FINAL truth используем для:**

&nbsp;

- provider_[subscriptions.next](http://subscriptions.next)_charge_at
- subscriptions_[v2.next](http://v2.next)_charge_at/access_end_at
- access chain (entitlements / telegram grants)
- audit missing_truth_fields

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **2) PATCH B1 (SELECT raw_data) — точная правка**

&nbsp;

&nbsp;

Да, **обязательно**:

```
.select('meta, subscription_v2_id, user_id, raw_data')
```

Без этого fallback невозможен.

&nbsp;

---

&nbsp;

&nbsp;

## **3) PATCH A (autolink) — добавить обязательный STOP-guard по “чужому продукту”**

&nbsp;

&nbsp;

В Priority 4 (user_id + product_id fallback) добавьте правило:

&nbsp;

- если product_id не удалось получить из additional_data (API или raw_data) → **НЕ линковать** по user-only.
  Audit: autolink_failed_no_product_id.

&nbsp;

&nbsp;

Иначе есть риск привязать к чужой подписке.

&nbsp;

---

&nbsp;

&nbsp;

## **4) PATCH C (access chain) — entitlements upsert по product_id + product_code**

&nbsp;

&nbsp;

Вы правильно делаете upsert по (user_id, product_id). Но при INSERT обязателен product_code (из products_v2.code), иначе дальше будут несостыковки.

&nbsp;

**Правка:**

&nbsp;

- STOP: если products_v2.code отсутствует → audit access_chain_skipped_no_product_code, не вставлять entitlement.

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **5) PATCH C (telegram grants) — обновлять 1 “максимальный” активный, но не уменьшать**

&nbsp;

&nbsp;

Правильно, но уточнение:

&nbsp;

- При UPDATE: end_at = GREATEST(end_at, accessEndAt)
- При NULL end_at: считать как 0 (или просто обновлять на accessEndAt)

&nbsp;

&nbsp;

И фиксируйте в audit: какой grant обновили (id).

&nbsp;

---

&nbsp;

&nbsp;

## **6) PATCH D (UI) — queryKey и autosync**

&nbsp;

&nbsp;

Согласен.

&nbsp;

**Доп. guard (обязателен):**

&nbsp;

- перед invalidate ключа: если !contact?.user_id → не инвалидировать contact-provider-subscriptions (неправильный key).

&nbsp;

&nbsp;

---

&nbsp;

&nbsp;

## **7) DoD — добавить обязательный артефакт “почему Мялик не исправилась”**

&nbsp;

&nbsp;

Сейчас по факту: subscription_v2_id NULL → sync не применял цепочку. В DoD нужно:

&nbsp;

- Скрин/лог: bepaid.sync.autolinked_subscription_v2 для этой подписки
- Затем bepaid.subscription.sync_dates
- Затем bepaid.sync.access_chain_applied

&nbsp;

&nbsp;

Без этих трёх подряд — считать баг не закрытым.

&nbsp;

---

&nbsp;

В остальном план корректный и закрывает ваши цели (даты из bePaid, online sync через next_charge_at, доступы через access_end_at + access chain, и UI обновление без F5) при условии выполнения правок выше.

&nbsp;

Plan: Fix Sync — Autolink, Truth Extract, Access Chain (4 Patches, 2 Files)

## Build Error

The `@swc/core` native binding error is an infrastructure issue (not caused by code). Resolves on retry.

## Confirmed Root Causes

- `subscription_v2_id` IS NULL → sync skips all propagation (lines 182-224)
- `meta.provider_snapshot` has no truth fields despite `raw_data` containing them
- `existingPs` SELECT (line 151) doesn't include `raw_data` → can't use as fallback
- `next_charge_at` stays NULL → UI shows nothing
- Cancel mutation (line 762) and create mutation (line 832) invalidate wrong queryKey
- `autoSyncRunRef` (line 797-798) blocks re-runs

## 4 Patches

### PATCH A: Autolink `subscription_v2_id` — `bepaid-get-subscription-details/index.ts`

Insert after line 156 (`if (existingPs) {`), before line 157.

When `!existingPs.subscription_v2_id`:

**Priority 1 — tracking_id → `subv2:{uuid}`:**

- Source: `sub.tracking_id || existingPs.raw_data?.tracking_id || (existingPs.meta as any)?.tracking_id`
- Regex: `/subv2:([0-9a-f-]{36})/i` → direct subscription_v2_id

**Priority 2 — tracking_id → `{order_uuid}_{offer_uuid}`:**

- Split by `_`, first segment if valid UUID → query `subscriptions_v2 WHERE order_id = :uuid LIMIT 2`
- If 1 result → link. If 0 or >1 → continue (audit only, not fail)

**Priority 3 — `additional_data.order_id`:**

- Source: `sub.additional_data?.order_id || existingPs.raw_data?.additional_data?.order_id`
- Same query as P2

**Priority 4 — user_id + product_id fallback:**

- `product_id` from `sub.additional_data?.product_id || existingPs.raw_data?.additional_data?.product_id`
- Query: `subscriptions_v2 WHERE user_id AND product_id AND status IN ('active','trial','past_due','pending') ORDER BY created_at DESC LIMIT 2`
- STOP: if 0 → audit `autolink_failed_no_candidates`; if >1 → audit `autolink_ambiguous`; if 1 → link

**On success:**

- `UPDATE provider_subscriptions SET subscription_v2_id = :id`
- If `subscriptions_v2.billing_type != 'provider_managed'` → update to `provider_managed` + audit
- Set local variable so rest of function proceeds with linked subscription
- Audit: `bepaid.sync.autolinked_subscription_v2` with `{ source, ids }`

### PATCH B: Multi-path truth extraction — `bepaid-get-subscription-details/index.ts`

**B1: Update SELECT (line 151):** add `raw_data` to the select:

```
.select('meta, subscription_v2_id, user_id, raw_data')
```

**B2: Replace lines 117-118** with multi-path extraction using `pickFirst` helper:

```typescript
function pickFirst(...vals: any[]): any {
  return vals.find(v => v != null && v !== '') ?? null;
}

const truthNextCharge = pickFirst(
  sub.renew_at, sub.next_billing_at,
  sub.subscription?.renew_at, sub.subscription?.next_billing_at,
  data.renew_at, data.next_billing_at,
  existingPs?.raw_data?.renew_at, existingPs?.raw_data?.next_billing_at
);
const truthAccessEnd = pickFirst(
  sub.active_to, sub.valid_till,
  sub.subscription?.active_to, sub.subscription?.valid_till,
  data.active_to, data.valid_till,
  existingPs?.raw_data?.active_to, existingPs?.raw_data?.valid_till
);
```

Note: `existingPs` is declared at line 149 but assigned at line 154. The truth extraction currently runs at line 117, before `existingPs` is available. Solution: move truth extraction to after line 154 (inside the `if (existingPs)` block), and keep a preliminary extraction without raw_data fallback for the snapshot builder.

**B3: Update snapshot** (lines 121-138) to store truth values and `raw_keys: Object.keys(sub)` for diagnostics.

**B4: Update `provider_subscriptions.next_charge_at**` unconditionally (already done at line 171) — will now have actual values from multi-path extraction.

**B5: STOP-guard:** if all truth null after multi-path → audit `bepaid.sync.missing_truth_fields`, skip date propagation.

### PATCH C: Apply access chain — `bepaid-get-subscription-details/index.ts`

Insert after line 220 (after subscriptions_v2 dates synced), inside the `if (existingPs.subscription_v2_id)` block.

Only execute if `truthAccessEnd` is non-null → compute `accessEndAt = endOfDayWarsaw(truthAccessEnd)`.

**C1: Read product info:**

```typescript
const { data: subV2Full } = await supabase
  .from('subscriptions_v2')
  .select('user_id, product_id, products_v2(id, code)')
  .eq('id', existingPs.subscription_v2_id)
  .maybeSingle();
```

**C2: Entitlements** — upsert by `(user_id, product_id)`:

- Query existing: `entitlements WHERE user_id AND product_id`
- If exists: `UPDATE expires_at = GREATEST(expires_at, accessEndAt), status = 'active'`
- If not exists: `INSERT (user_id, product_id, product_code, status='active', expires_at=accessEndAt)`
- Audit: `bepaid.sync.entitlement_extended`

**C3: Telegram grants** — extend latest active:

- Get `club_id` from `product_club_mappings WHERE product_id AND is_active = true`
- STOP if no mapping → audit `bepaid.sync.no_club_mapping`
- Query: `telegram_access_grants WHERE user_id AND club_id AND status IN ('active','granted') ORDER BY end_at DESC NULLS LAST LIMIT 1`
- If found: `UPDATE end_at = GREATEST(end_at, accessEndAt)`
- If not found: `INSERT (user_id, club_id, source='bepaid_sync', source_id=provider_subscription_id, status='active', start_at=now, end_at=accessEndAt)`
- Audit: `bepaid.sync.access_chain_applied`

**C4: STOP-guard:** if `product_id` null → audit `bepaid.sync.access_chain_skipped`, skip.

### PATCH D: UI fixes — `ContactDetailSheet.tsx`

**D1: Line 762** — change `['contact-provider-subscriptions']` → `['contact-provider-subscriptions', contact?.user_id]`

**D2: Line 832** — same fix

**D3: Lines 793, 797-798** — remove `autoSyncRunRef` declaration and one-shot block. Add guard before sync loop (line 813): `if (syncBepaidSubMutation.isPending) return;`

## Files Changed


| File                                                          | Patches                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `supabase/functions/bepaid-get-subscription-details/index.ts` | A (autolink), B (truth extract + raw_data select), C (access chain) |
| `src/components/admin/ContactDetailSheet.tsx`                 | D (queryKey + autoSync)                                             |


## Deploy

- `bepaid-get-subscription-details`

## Data Fix

After deploy, batch-invoke sync for 19 orphaned subscriptions.

## DoD for `sbs_2ba8ec82d7d5c39b`

1. `provider_subscriptions.subscription_v2_id` NOT NULL (autolinked)
2. `subscriptions_v2.billing_type` = `provider_managed`
3. `provider_subscriptions.next_charge_at` = bePaid truth
4. `subscriptions_v2.access_end_at` = `endOfDayWarsaw(active_to)`
5. `entitlements.expires_at` >= `access_end_at`
6. `telegram_access_grants` latest `end_at` >= `access_end_at`
7. UI refreshes without F5 after sync