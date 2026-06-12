# PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 — Approve A proof

**Status:** Approve A = PASS (код + локальные тесты).
**Deploy:** NOT YET. **Historical execute:** NOT YET. **Live runtime events:** NOT YET.

---

## 1. Before architecture

До патча Stripe card data писался тремя независимыми inline-блоками:

| Точка | Файл | Что писало | Что не писало |
|---|---|---|---|
| `checkout.session.completed` | `stripe-webhook/index.ts:348-362` | `card_brand`, `card_last4`, `card_holder` (DB columns) | `meta.stripe.payment_method_details`, `payment_method_id`, `wallet.type` |
| `payment_intent.succeeded` | `stripe-webhook/index.ts:447-461` | то же | то же |
| `targeted single` | `stripe-card-data-fetch/index.ts` (PATCH-STRIPE-CARD-DATA-V1) | DB columns + `meta.card_data_fetched_at` (legacy путь) | `payment_method_details`, `payment_method_id`, `wallet` |
| `invoice.paid` | — | **не писало вообще** | весь snapshot |

Discovery inventory (на момент A): `payments_v2 WHERE provider='stripe'` = 3 строки. `card_last4` = 1. `meta.stripe.payment_method_details` = 0. `meta.stripe.payment_method_id` = 0.

---

## 2. Final dependency graph

```
              ┌──────────────────────────────────────────┐
              │  _shared/stripe/card-extract.ts          │
              │    (pure sanitizer + PCI denylist)       │
              └────────────────────▲─────────────────────┘
                                   │ import
              ┌────────────────────┴─────────────────────┐
              │  _shared/stripe/card-enrichment.ts       │
              │   - resolveStripeCardSource (GET PI)     │
              │   - buildSanitizedCardSnapshot           │
              │   - persistStripeCardSnapshot (SINGLE)   │
              │   - enrichStripePaymentCardData (orch.)  │
              │   - resolvePaymentIntentFromRow          │
              │   - isCardSnapshotComplete               │
              └─▲──────────────────▲──────────────────▲──┘
                │                  │                  │
       stripe-webhook   stripe-card-data-fetch  stripe-card-data-fetch-bulk
       (3 events,        (single super_admin)    (bulk super_admin,
        preloaded                                  dry_run default)
        charge)
```

Запрещено:
- HTTP-вызов одной edge function из другой;
- импорт `index.ts` чужой edge function;
- второй параллельный Stripe-fetch / DB-update.

Подтверждено grep'ом (см. §6).

---

## 3. Canonical JSON storage shape

```json
"meta.stripe": {
  "payment_method_details": {
    "type": "card",
    "card": {
      "brand": "visa",
      "last4": "4242",
      "wallet": { "type": "apple_pay" } | null,
      "funding": "credit" | null,
      "country": "PL" | null
    }
  },
  "payment_method_id": "pm_xxx",
  "charge_id": "ch_xxx",
  "payment_intent_id": "pi_xxx",
  "card_data_source": "payment_intent.succeeded",
  "card_data_sources_seen": ["checkout.session.completed", "payment_intent.succeeded"],
  "card_data_fetched_at": "2026-06-12T..."
}
```

Плюс DB-колонки: `payments_v2.card_brand`, `card_last4`, `card_holder`.

**Совместимость с readers** (read-only):

| Reader | Путь | Работает с новым shape? |
|---|---|---|
| `src/utils/extractStripeCardFromMeta.ts` (`pickCard`) | `meta.stripe.payment_method_details.card.{brand,last4,wallet.type}` | ✅ да — `pickCard(payment_method_details)` берёт `.card` |
| `supabase/functions/_shared/document-resolver-v2/payment-channel.ts` | DB-колонки `card_last4`, провайдер, и meta.payment_method | ✅ да — channel-логика читает плоские поля и `meta.payment_method_details.type` опосредованно |
| `src/utils/derivePaymentChannel.ts` | то же | ✅ да |

Существующий `extractStripeCardFromMeta.pickCard` поддерживает несколько legacy-форматов (включая `meta.stripe.card`, `meta.stripe.payment_method.card`), writer всё равно пишет один канонический формат.

**Запрещено** (legacy paths, не используются writer-ом):
- `meta.card_data_fetched_at`
- `meta.card_data_source`
- плоский `meta.stripe.payment_method_details = { brand, last4 }` без `card.*`

---

## 4. Удалённые inline write-path

```bash
$ rg -n "PATCH-LIVE-CARD" supabase/functions/
# (no output) — оба блока удалены
```

Старые inline блоки:
- `stripe-webhook/index.ts:348-362` → заменён вызовом `enrichStripePaymentCardData({ source: 'checkout.session.completed', preloadedCharge: latest })`
- `stripe-webhook/index.ts:447-461` → заменён вызовом `enrichStripePaymentCardData({ source: 'payment_intent.succeeded', preloadedCharge: latest })`

Старый `stripe-card-data-fetch/index.ts` (161 строка собственной логики) → thin wrapper над `enrichStripePaymentCardData({ source: 'targeted_fetch' })`.

```bash
$ rg -n "payments_v2'.*\.update\(\{.*card_(brand|last4|holder)" supabase/functions/
# (no output) — единственный writer card-полей теперь card-enrichment.ts (line 448 — это SELECT, не UPDATE)
```

---

## 5. Список файлов (diff-summary)

| Файл | Тип | Назначение |
|---|---|---|
| `supabase/functions/_shared/stripe/card-extract.ts` | NEW | Pure sanitizer + PCI post-condition scan |
| `supabase/functions/_shared/stripe/card-enrichment.ts` | NEW | Единственный writer + orchestration |
| `supabase/functions/_shared/stripe/card-enrichment.test.ts` | NEW | 20 unit + integration test cases |
| `supabase/functions/stripe-webhook/index.ts` | MODIFIED | (a) удаление 2 inline PATCH-LIVE-CARD блоков; (b) вызовы единого writer-а в checkout/PI/invoice.paid |
| `supabase/functions/stripe-card-data-fetch/index.ts` | REFACTORED | thin (auth + validation + вызов shared service) |
| `supabase/functions/stripe-card-data-fetch-bulk/index.ts` | NEW | Bulk admin (dry_run default, concurrency ≤3, limit max 200) |

Webhook integration points (точные строки после правок):
- `dispatch()` → ветка `STRIPE_SUBSCRIPTION_EVENT_TYPES`: после возврата `onInvoicePaid` с `payment_id` вызывается enrichment с `source='invoice.paid'`. Lifecycle НЕ повторяется — enrichment только обновляет card snapshot.
- `checkout.session.completed`: enrichment вызывается ВНУТРИ существующего try-блока after Stripe API `expand=latest_charge`, с `preloadedCharge=latest` (без второго fetch).
- `payment_intent.succeeded`: то же.

---

## 6. Unit / integration test results

```
deno test --allow-all --no-check supabase/functions/_shared/stripe/card-enrichment.test.ts

running 20 tests from ./supabase/functions/_shared/stripe/card-enrichment.test.ts
extract: raw input with exp_month/exp_year/fingerprint does NOT throw ... ok (0ms)
extract: charge without card returns empty ... ok (0ms)
extract: null/undefined safe ... ok (0ms)
assertNoPciFields: throws on synthetic leak in output ... ok (0ms)
assertNoPciFields: deep scan finds nested forbidden key ... ok (0ms)
assertNoPciFields: clean payload passes ... ok (0ms)
resolvePI: single source wins ... ok (0ms)
resolvePI: conflicting sources STOP ... ok (0ms)
resolvePI: no PI anywhere ... ok (0ms)
isCardSnapshotComplete: all pieces required ... ok (0ms)
enrich: positive stripe row → updated ... ok (1ms)
enrich: refund (amount<0) → invalid, no update ... ok (0ms)
enrich: bepaid row → invalid ... ok (0ms)
enrich: complete snapshot → skipped_complete ... ok (0ms)
enrich: ambiguous (2 positive rows per PI) → ambiguous ... ok (0ms)
enrich: account_code mismatch → invalid ... ok (0ms)
enrich: invalid PI format → invalid (no DB write) ... ok (0ms)
enrich: no charge data → no_data ... ok (0ms)
enrich: wallet NOT overwritten by event without wallet ... ok (0ms)
enrich: sources_seen dedup ... ok (0ms)

ok | 20 passed | 0 failed (11ms)
```

### Покрытие по правкам

| Требование плана | Тест |
|---|---|
| Raw input с `exp_month/exp_year/fingerprint` не падает | `extract: raw input with exp_month/exp_year/fingerprint does NOT throw` |
| Forbidden ключи отсутствуют в OUTPUT | тот же + `enrich: positive stripe row → updated` (assertFalse includes) |
| `pci_violation` при искусственной утечке в output | `assertNoPciFields: throws on synthetic leak in output` |
| Stripe positive → update | `enrich: positive stripe row → updated` |
| Refund (amount<0) → reject | `enrich: refund (amount<0) → invalid, no update` |
| bePaid → reject | `enrich: bepaid row → invalid` |
| Complete snapshot → skip | `enrich: complete snapshot → skipped_complete` |
| Partial snapshot → non-destructive merge | `enrich: wallet NOT overwritten ...` |
| Conflicting PI → STOP | `resolvePI: conflicting sources STOP` |
| Duplicate positive rows per PI → ambiguous | `enrich: ambiguous ...` |
| Wallet не затирается событием без wallet | `enrich: wallet NOT overwritten ...` |
| sources_seen dedup | `enrich: sources_seen dedup` |
| Account_code mismatch → invalid | `enrich: account_code mismatch → invalid` |
| Invalid PI format → no DB write | `enrich: invalid PI format → invalid` |
| `no_data` verdict при пустом Charge | `enrich: no charge data → no_data` |

Lifecycle-инварианты (`invoice.paid` не создаёт повторно payment/order, enrichment-failure не ломает activation) обеспечены архитектурно:
- writer не вызывает `INSERT` в `payments_v2` / `orders_v2`;
- вызов в webhook обёрнут в try/catch с `never re-throw`;
- pre-condition `payment.amount > 0` блокирует попытку записи refund.

---

## 7. Code-level PCI proof

### Sanitizer denylist (whitelist-only извлечение)

`_shared/stripe/card-extract.ts` строит snapshot **только** из явного whitelist (`brand`, `last4`, `wallet.type`, `funding`, `country`). Всё остальное из raw Stripe input игнорируется, в том числе `exp_month`, `exp_year`, `fingerprint`, `number`, `pan`, `cvc`, `cvv`.

### Post-condition scan

`assertNoPciFields(payload, label)` рекурсивно сканирует output и бросает `pci_violation:<label>:<key>` при обнаружении ключа из:

```ts
const PCI_DENYLIST = new Set([
  'number', 'pan', 'cvc', 'cvv', 'exp_month', 'exp_year', 'fingerprint',
]);
```

Точки вызова:
- `extractCardFromCharge` → сразу после построения snapshot;
- `persistStripeCardSnapshot` → дважды: на merged `payment_method_details` и на финальном `updates` payload перед UPDATE;
- `writeEnrichmentAudit` → на каждом audit `meta`.

### Audit-snapshot whitelist

`audit_logs.meta` для всех verdict'ов содержит только: `payment_id, payment_intent_id, account_code, http_status, stripe_error_type, stripe_error_code, source, reason, retryable, updated_fields, request_id, actor`. `card_holder`, полное Stripe response body, `payment_method_details`, billing_details не пишутся.

---

## 8. Подтверждение отсутствия deploy

Никаких вызовов `supabase deploy` / `deploy_edge_functions` / live runtime events не выполнялось. Только запись файлов и локальный `deno test`.

---

## 9. Подтверждение отсутствия исторических UPDATE

```bash
# Никаких INSERT/UPDATE на payments_v2 / orders_v2 / audit_logs в проде не выполнено.
# psql / supabase--insert / supabase--migration не вызывались для этого патча.
```

Inventory исторических Stripe rows не пересчитывался для Approve C — это будет отдельный Approve C dry-run.

---

## 10. Точный proposed deploy scope для Approve B

```
supabase/functions/stripe-webhook/
supabase/functions/stripe-card-data-fetch/
supabase/functions/stripe-card-data-fetch-bulk/
```

Shared модули (`_shared/stripe/card-extract.ts`, `_shared/stripe/card-enrichment.ts`) деплоятся как часть бандла каждой из этих трёх функций (стандарт Lovable Cloud — shared deno-imports собираются автоматически).

Внешних зависимостей нет:
- `card-extract.ts` — чистый TS;
- `card-enrichment.ts` импортирует только `card-extract.ts`;
- edge functions переиспользуют существующие helpers (`acquiring/auth-guard`, `acquiring/vault`, `cors`) — уже задеплоены.

Несвязанные edge functions деплоить не нужно.

---

## Статусы

- **Approve A — PASS** (код + локальные тесты).
- **Approve B — NOT YET** (deploy + isolated runtime + bePaid regression + PCI proof).
- **Approve C — NOT YET** (inventory с verdicts → dry-run → targeted execute).

Жду команду на Approve B (deploy 3 функций + изолированный test event).
