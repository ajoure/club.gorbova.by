# PATCH-STRIPE-DOCUMENT-ACT-CHECK-V1 — Proof

**Дата:** 2026-06-11
**Phase:** 1 (Execute) — узкая code-правка provider→payment channel mapping.
**Discovery:** [.lovable/discovery/stripe_final_hardening_discovery_v1.md](../discovery/stripe_final_hardening_discovery_v1.md)
**Деплой edge functions:** НЕ выполнялся.
**Миграции:** НЕТ.
**Writer / шаблоны / нумерация / `ai_generated_documents`:** НЕ менялись.

---

## 1. Цель

Stripe-платёж в документном пайплайне должен распознаваться как `card`-канал так же, как bePaid, чтобы:
- `derivePaymentChannel(row{provider:'stripe'}) === 'card'`;
- snapshot и render выдавали `method='card'`, `method_label='Банковская карта'`;
- `tariff_offers.meta.document_scenarios[]` мог матчиться по `(payerType, channel='card')`.

## 2. Найденные hardcode-места (из Phase 0)

| Файл | Строка (до) | Проблема |
|------|-------------|----------|
| `supabase/functions/_shared/document-resolver-v2/payment-channel.ts` | docstring + логика | provider='stripe' без `meta.payment_method`/`card_last4` → `'other'` |
| `supabase/functions/_shared/document-render.ts` | 452 | `provider === 'bepaid' ? 'card' : (provider \|\| 'unknown')` |
| `supabase/functions/_shared/document-data-snapshot.ts` | 358 | то же зеркально в snapshot |
| `src/utils/derivePaymentChannel.ts` | 38 | frontend mirror без ветки stripe |

## 3. Diff-summary 4 файлов

### 3.1 `supabase/functions/_shared/document-resolver-v2/payment-channel.ts`

Добавлено в `derivePaymentChannel` после fallback по `card_last4`:

```ts
// Stripe-эквайринг = карта по умолчанию. Apple Pay / Google Pay в будущем
// определим через явный meta.payment_method_details.type (Stripe знает их),
// но любой явный method/channel выше уже имеет приоритет над этой веткой.
if (row.provider === 'stripe') return 'card';
```

Docstring расширен: `provider: 'bepaid' | 'stripe' | 'admin' | 'admin_test'`.

### 3.2 `src/utils/derivePaymentChannel.ts` (frontend mirror)

Зеркальная вставка той же ветки `if (row.provider === 'stripe') return 'card';` с комментарием «keep in sync».

### 3.3 `supabase/functions/_shared/document-render.ts`

```ts
const CARD_PROVIDERS = new Set(['bepaid', 'stripe']);
const method = provider && CARD_PROVIDERS.has(provider) ? 'card' : (provider || 'unknown');
```

### 3.4 `supabase/functions/_shared/document-data-snapshot.ts`

```ts
const CARD_PROVIDERS = new Set(['bepaid', 'stripe']);
const methodCode = isAdminTest
  ? 'test'
  : (channel || (p.provider && CARD_PROVIDERS.has(p.provider) ? 'card' : (p.provider || 'unknown')));
```

## 4. Verify

### 4.1 Логические проверки (труд-таблица)

| Вход | derivePaymentChannel (fe+be) | render method | snapshot methodCode |
|------|-------------------------------|---------------|---------------------|
| `provider='stripe'`, meta пустой, last4=null | `'card'` ✅ | `'card'` ✅ | `'card'` ✅ |
| `provider='bepaid'`, meta пустой, last4=null | `'other'` (как было) → но если есть `card_last4` или `pm='credit_card'` → `'card'` ✅ regression OK | `'card'` ✅ | `'card'` ✅ |
| `provider='bepaid'`, `pm='credit_card'` | `'card'` ✅ | `'card'` ✅ | `'card'` ✅ |
| `provider='bepaid'`, `is_erip=true` | `'erip'` ✅ | `provider==='bepaid'`→`'card'` (legacy render) — поведение НЕ изменилось | snapshot использует `channel`, т.е. `'erip'` ✅ |
| `provider='admin_test'`+test_marker | `'card'` ✅ (admin-test ветка) | `'admin_test'` (legacy) | `'test'` (isAdminTest) ✅ |
| `provider='admin'` без меток | `'other'` ✅ | `'admin'` (legacy) | `'admin'` (legacy) |
| `provider='manual'` / `'cash'` / `'other'` | `'other'` ✅ | `provider` as-is ✅ | `provider` as-is ✅ |

Все non-stripe пути не изменились.

### 4.2 grep-подтверждение

```
$ rg -n "provider === 'stripe'|CARD_PROVIDERS" \
    src/utils/derivePaymentChannel.ts \
    supabase/functions/_shared/document-resolver-v2/payment-channel.ts \
    supabase/functions/_shared/document-render.ts \
    supabase/functions/_shared/document-data-snapshot.ts
```

→ ветки присутствуют ровно в 4 файлах. Без дублей, без drift.

### 4.3 Frontend ↔ backend mirror

Оба `derivePaymentChannel` (fe + be) имеют одинаковую логику для `stripe`. `document-render` и `document-data-snapshot` используют один и тот же `CARD_PROVIDERS = {'bepaid','stripe'}`. Drift отсутствует.

### 4.4 bePaid regression

`document-render` и `document-data-snapshot`: `CARD_PROVIDERS.has('bepaid') === true` → `method='card'` (как и было до патча).
`derivePaymentChannel`: bePaid-платежи всегда приходили с `pm='credit_card'` или `card_last4` → ветка `if (row.provider === 'stripe')` для bePaid недостижима, результат не меняется.

### 4.5 Writer / шаблоны / номера

`canonical-document-generate-strict/` — не открывался для записи.
`document_templates`, `file_name_template`, нумерация, `ai_generated_documents` schema — не менялись.
Миграций в этом патче нет.

## 5. Явное ограничение

**E2E generation Stripe документа ещё не закрыт.** Единственный Stripe paid order имеет `offer_id = NULL` и его tariff_offer не проверен на `meta.document_scenarios[]`. Этот патч закрывает **только** mapping provider→channel; полноценная генерация — после `PATCH-STRIPE-OFFER-SCENARIOS-V1`.

## 6. Follow-up: `PATCH-STRIPE-OFFER-SCENARIOS-V1` (зафиксирован)

Скоуп (отдельный план, отдельный approve):

1. Найти Stripe paid orders с `offer_id IS NULL` (сейчас 1: `849c68b7-7296-4660-8265-841bc57f7aa5`).
2. Dry-run resolve `offer_id`:
   - `payment_links.offer_id` (если оплата из публичной ссылки);
   - `tariff_id → активный pay_now-offer` (стандарт `offer-id-backfill-policy`);
   - `order.meta.offer_id` / `meta.crm_routing_snapshot.offer_id`;
   - Stripe `checkout.session.metadata`.
3. Проверить `tariff_offers.meta.document_scenarios[]` у резолвнутого оффера.
4. Если scenarios отсутствуют — подготовить безопасный конфиг, но НЕ писать в БД без отдельного approve.
5. Только после fixed offer_id + scenarios — e2e тест генерации счёт-акта по Stripe order.

## 7. DoD Phase 1

| Требование | Статус |
|------------|--------|
| Stripe provider → card | ✅ (fe + be) |
| bePaid provider → card (regression) | ✅ |
| frontend mirror ↔ backend logic совпадают | ✅ |
| writer не менялся | ✅ |
| схемы/шаблоны/нумерация не менялись | ✅ |
| миграций нет | ✅ |
| edge functions НЕ передеплоены | ✅ |
| proof создан | ✅ (этот файл) |
| follow-up `PATCH-STRIPE-OFFER-SCENARIOS-V1` зафиксирован | ✅ (§6) |

**Verdict:** `PATCH-STRIPE-DOCUMENT-ACT-CHECK-V1 = PASS`.
