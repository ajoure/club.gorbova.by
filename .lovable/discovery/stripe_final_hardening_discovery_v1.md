# STRIPE-FINAL-HARDENING-SPRINT-V1 — Phase 0 Discovery (read-only)

**Дата:** 2026-06-11
**Режим:** read-only (SQL SELECT + rg/code--view). Никаких write/update/delete/deploy.
**Артефакт:** этот файл.
**Источники:** `subscriptions_v2`, `provider_subscriptions`, `payments_v2`, `orders_v2`, `tariff_offers`, `ai_generated_documents`, `pg_class`, code search.

---

## Executive summary

| # | Блок | Состояние | Краткий вывод |
|---|------|-----------|---------------|
| 0.1 | Stripe subscriptions inventory | Минимальный объём (4 sub, 1 реальная) | Bulk cancel сейчас не нужен — нечего массово отменять. Дождаться роста когорты. |
| 0.2 | Stripe billing period | Метаданные периода НЕ сохраняются (interval/anchor/period_end = 0/4) | Расхождение с bePaid — есть backlog `stripe_billing_period_mode_v2.md`. Не блокер Phase 1. |
| 0.3 | Stripe card data coverage | 0 из 3 платежей имеют brand/last4 | Подтверждает backlog `stripe_card_data_enrichment_v2.md`. |
| 0.4 | Stripe documents inventory | 1 платёж с `receipt_url`, hosted_invoice/invoice_pdf = 0 | Drawer-патч имеет смысл, но материал тонкий. |
| 0.5 | **Документная генерация (счёт-акт)** | **Frontend rules — provider-agnostic. Snapshot — есть hardcode `provider === 'bepaid' ? 'card' : ...`. Stripe paid order существует, но `offer_id IS NULL` и `ai_generated_documents` пусто.** | **Phase 1 FIX REQUIRED, см. ниже.** |
| 0.6 | Backup tables snapshot | 23 backup/snapshot таблиц, суммарно ~5 MB | Все RLS off, владельцы помечены датой. Удаление — отдельная задача (Phase 6). |

---

## 0.1 Stripe subscriptions inventory

```sql
SELECT COUNT(*), status, ps_sub_id LIKE 'sub_%' AS real, auto_renew
FROM subscriptions_v2 s JOIN provider_subscriptions ps
  ON ps.subscription_v2_id=s.id AND ps.provider='stripe'
GROUP BY ...;
```

Факт:
- total = **4**
- active = 0
- canceled = 1
- pending = 3
- past_due = 0
- distinct statuses: `[canceled, pending]`
- `provider_subscription_id LIKE 'sub_%'` = **1** (реальная Stripe sub)
- `provider_subscription_id LIKE 'pending:%'` = **3**
- `auto_renew=true` = **0**

**Вывод:** база для bulk cancel сейчас пустая (нет active с auto_renew=true). `PATCH-STRIPE-BULK-CANCEL-V2` можно отложить до набора когорты ≥10 активных Stripe-подписок.

---

## 0.2 Stripe billing period

```sql
SELECT … FROM provider_subscriptions WHERE provider='stripe';
```

Факт (4 строки):
- `meta.stripe.interval`: NULL (0/4)
- `meta.stripe.interval_count`: NULL (0/4)
- `meta.stripe.billing_cycle_anchor`: NULL (0/4)
- `meta.stripe.current_period_end`: NULL (0/4)
- `meta.stripe.collection_method`: NULL (0/4)

**Вывод:** webhook/poller не записывает period-метаданные в `provider_subscriptions.meta.stripe`. Это уже зафиксировано в `.lovable/backlog/stripe_billing_period_mode_v2.md`. Не блокер для Phase 1 (документы), но обязателен для будущего «Stripe = bePaid по биллингу».

---

## 0.3 Stripe card data coverage

```sql
SELECT … FROM payments_v2 WHERE provider='stripe';
```

Факт:
- total = **3** (succeeded=2, refunded=1)
- with card brand/last4 (meta.stripe.card.last4 ИЛИ provider_response.charges[0].payment_method_details.card.last4) = **0**
- has payment_intent_id = **0**
- has charge_id (`ch_*`) = **0**
- has payment_method_id (`pm_*`) = **0**

**Вывод:** ни одна Stripe-оплата не имеет даже PI/charge id в нашей схеме → enrich-by-stripe-api возможен только по retrieve через `provider_response.id` (если это PI/charge). Подтверждает `stripe_card_data_enrichment_v2.md`.

---

## 0.4 Stripe documents inventory

```sql
SELECT … FROM payments_v2 WHERE provider='stripe';
```

Факт:
- `receipt_url` непустой = **1 из 3**
- `provider_response.hosted_invoice_url` = **0**
- `provider_response.invoice_pdf` = **0**
- `provider_response.charges[0].receipt_url` = **0**
- refund rows = **1**

**Вывод:** drawer-патч (Stripe-документы рядом с bePaid receipt) даст пользу для 1 платежа сейчас. Можно реализовать, но эффект низкий до накопления данных. **Не блокер Phase 1.**

---

## 0.5 Документная генерация / счёт-акт (КРИТИЧНЫЙ БЛОК)

### Frontend / shared rules

`src/lib/documents/purchaseDocumentRules.ts`:

```ts
const EXCLUDED_PROVIDERS = new Set([
  "admin", "admin_test", "admin_test_direct",
  "manual", "virtual", "internal_test",
]);
export function isRealPayment(p) {
  if (String(p.status).toLowerCase() !== "succeeded") return false;
  return !EXCLUDED_PROVIDERS.has(String(p.provider).toLowerCase());
}
```

✅ **Provider-agnostic.** `stripe` НЕ в denylist → Stripe-платёж проходит `hasRealSucceededPayment`. Backend mirror `supabase/functions/_shared/purchase-document-rules.ts` (упомянут в комментарии) — следующий шаг проверки в Phase 1.

`supabase/functions/canonical-document-generate-strict/`:
- rg по `bepaid` → **только** `SELECT 'id, status, provider, …'` (выбор полей платежа, никаких хардкодов).
- ✅ генератор сам по себе provider-agnostic.

### Реальные хардкоды (из `.lovable/discovery/bepaid_hardcodes.csv` + проверено заново)

| Файл | Строка | Проблема |
|------|--------|----------|
| `supabase/functions/_shared/document-render.ts` | 452 | `const method = provider === 'bepaid' ? 'card' : (provider \|\| 'unknown')` — Stripe → method='stripe', label='stripe', НЕ 'card'. В документе появится «Способ оплаты: stripe» вместо «Банковская карта». |
| `supabase/functions/_shared/document-data-snapshot.ts` | 358 | Та же логика в snapshot для `ai_generated_documents.data` — попадает в шаблон. |
| `supabase/functions/_shared/document-resolver-v2/payment-channel.ts` | docstring + логика | `derivePaymentChannel` не учитывает `provider='stripe'` явно: без `meta.payment_method` и без `card_last4` Stripe-платёж даст `channel='other'` → **`document_scenarios[]` НЕ матчится** → fallback на `defaults` или `no_template`. |

### БД-факты

```sql
stripe_paid_orders            = 1
stripe_orders_with_docs       = 0
offers_with_scenarios (всего) = 6
distinct_stripe_offers        = 0  -- orders_v2.offer_id IS NULL для Stripe-заказа
```

Единственный Stripe paid order (`849c68b7-7296-4660-8265-841bc57f7aa5`):
- `offer_id = NULL` → `resolveOfferForOrder` пойдёт по `tariff_id` fallback;
- `scenarios_count` неизвестен (offer не резолвится);
- `has_doc = false` — документ ни разу не генерировался.

### Вывод по 0.5

Hardcode bePaid в проекте **есть**, но он не блокирует *появление* кнопки «Сформировать» в /purchases (rules чистые). Он блокирует **корректность** документа: channel и method-label сейчас будут wrong для Stripe, и `document_scenarios[]` не сматчится по каналу.

Дополнительный блокер по данным: Stripe paid order не имеет `offer_id` и не имеет `document_scenarios[]` у соответствующего оффера → даже после фикса hardcode документ выпадет в `no_template` / `disabled`.

---

## 0.6 Backup tables snapshot

23 таблицы (~5 MB), все `RLS off`, ни одна не используется production кодом:

| Таблица | rows | size |
|---------|------|------|
| `_orders_orphan_cleanup_2026_05_backup` | 572 | 1280 kB |
| `rev_7101ed3c_backup` | 443 | 1048 kB |
| `_stripe_cleanup_2026_06_backup_provider_events` | 122 | 392 kB |
| `_backup_entitlement_tariff_id_backfill_2026_05` | 336 | 304 kB |
| `lesson_progress_state_backup_byn_2026_05` | 63 | 288 kB |
| `_microcorrection_rollback_2026_05_03_backup` | 232 | 280 kB |
| `lesson_progress_state_backup_byn_x3_revert_2026_05_13` | 63 | 280 kB |
| `provider_subscriptions_synthetic_cleanup_backup_2026_05` | 73 | 264 kB |
| `_orders_cohort_b_cleanup_2026_05_backup` | 20 | 256 kB |
| `_inv22_overshoot_snapshot` | 118 | 216 kB |
| `_stripe_cleanup_2026_06_backup_orders` | 31 | 120 kB |
| `subscriptions_v2_repair_backup_2026_05` | 5 | 80 kB |
| `system_health_discovery_snapshots` | 8 | 80 kB |
| `telegram_access_repair_backup_2026_05` | 5 | 48 kB |
| `entitlements_repair_backup_2026_05` | 5 | 48 kB |
| `_stripe_cleanup_2026_06_backup_subscriptions` | 25 | 40 kB |
| `_stripe_cleanup_2026_06_backup_payments` | 22 | 24 kB |
| `_stripe_cleanup_2026_06_backup_provider_subs` | 16 | 24 kB |
| `_stripe_cleanup_2026_06_backup_access_grant_ledger` | 11 | 24 kB |
| `rev_7101ed3c_ops` | 0 | 16 kB |
| `_backup_entitlement_delete_byn_2026_05_shulyak` | 1 | 16 kB |
| `_stripe_cleanup_2026_06_backup_entitlements` | 5 | 16 kB |
| `_stripe_cleanup_2026_06_backup_payment_links` | 13 | 16 kB |

**Вывод:** объём незначителен, физическое удаление не срочно. Отдельная задача Phase 6 «backup cleanup». Ничего не трогаем в Phase 0.

---

## Найденные риски и hardcode (сводно)

1. `document-render.ts:452` — provider→method хардкод `bepaid → card`, всё остальное → as-is. **Влияет на Stripe-документ.**
2. `document-data-snapshot.ts:358` — то же в snapshot. **Зеркальный фикс.**
3. `derivePaymentChannel` (`payment-channel.ts`) — не имеет ветки для `provider='stripe'` без `meta.payment_method`/`card_last4` → channel='other'. **Влияет на матч `document_scenarios[]`.**
4. Данные: единственный Stripe paid order не имеет `offer_id` и не привязан к офферу с `document_scenarios[]`. Это **data-issue**, не код.

Все остальные `bepaid`-упоминания (см. `.lovable/discovery/bepaid_hardcodes.csv`) — либо в bepaid-only функциях, либо UI-фильтры (не влияют на генерацию документа).

---

## Phase 1 recommendation: **FIX REQUIRED (small) + data-followup**

### План `PATCH-STRIPE-DOCUMENT-ACT-CHECK-V1` (Phase 1, требуется отдельный approve)

**Цель:** Stripe paid order попадает в документный workflow с корректным channel='card' и method_label='Банковская карта', `document_scenarios[]` матчится так же, как для bePaid.

**Файлы (только код, минимально):**

1. `supabase/functions/_shared/document-resolver-v2/payment-channel.ts`
   - В `derivePaymentChannel` после блока `card_last4` добавить:
     ```ts
     if (row.provider === 'stripe') return 'card';
     ```
     (Stripe-эквайринг = карта; ApplePay/GooglePay в будущем определим через `meta.payment_method_details.type`).
   - Обновить docstring: добавить `'stripe'` в список known providers.

2. `supabase/functions/_shared/document-render.ts:452`
   - Заменить `provider === 'bepaid' ? 'card' : (provider || 'unknown')`
     на set-based маппинг `CARD_PROVIDERS = new Set(['bepaid','stripe'])` → `'card'`, иначе as-is.

3. `supabase/functions/_shared/document-data-snapshot.ts:358`
   - Зеркальный фикс той же логикой.

4. Frontend mirror `src/utils/derivePaymentChannel.ts` — добавить ветку `provider==='stripe' → 'card'`, чтобы fe-проверка scenario совпадала с backend.

**Проверка (Verify):**
- SQL: `SELECT id FROM orders_v2 WHERE id='849c68b7-...';` существует.
- Локально вызвать `canonical-document-generate-strict` ⛔ не в Phase 1 без approve — но в DoD прописать e2e: для Stripe paid order:
  - frontend rules → `canGenerateDocument.enabled = true`;
  - snapshot → `payment.method='card'`, `method_label='Банковская карта'`;
  - scenario match по `(payerType, channel='card')`.
- bePaid regression: тот же сценарий на любом bePaid succeeded order должен оставаться enabled=true и method='card' (`CARD_PROVIDERS` включает 'bepaid').

**Что НЕ делаем в Phase 1:**
- НЕ деплоим edge functions без явной команды (только правка кода + dry-run).
- НЕ создаём `document_scenarios[]` для Stripe-оффера. Это `PATCH-STRIPE-OFFER-SCENARIOS-V1` (data-only, отдельный план):
  - проверить `orders_v2.offer_id` у Stripe-заказа (NULL → backfill через `tariff_id → активный pay_now-offer` по существующему стандарту `offer-id-backfill-policy`);
  - проверить наличие `meta.document_scenarios[]` у offer; если нет — отдельный план настройки сценариев.
- НЕ трогаем backup-таблицы, billing period, card enrichment, drawer — это Phase 2..6.

### DoD Phase 1

PASS, если:
- frontend и backend mirror derivePaymentChannel возвращают `'card'` для Stripe;
- document-render и document-data-snapshot выдают `method='card'`, `method_label='Банковская карта'` для Stripe;
- bePaid-сценарий не меняет результат (regression OK на любом bePaid paid order через unit/smoke);
- зафиксировано в `.lovable/proofs/stripe_document_act_check_v1.md`:
  - SQL до/после (Stripe order, offer_id, scenarios_count);
  - rg-диффы по 3 файлам;
  - bePaid regression PASS;
  - явное упоминание, что data-followup (`PATCH-STRIPE-OFFER-SCENARIOS-V1`) остаётся открытым.

---

## Что вернуть пользователю

Phase 0 завершена. Phase 1 recommendation: **FIX REQUIRED** (узкая правка provider→channel mapping в 4 файлах), плюс отдельный data-followup `PATCH-STRIPE-OFFER-SCENARIOS-V1` для backfill `offer_id` и настройки `document_scenarios[]` у Stripe-оффера.

Ожидаю approve на Phase 1.
