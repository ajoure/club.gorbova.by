# MP-A2-2 — Stripe Customer Resolver + Saved PM — Proof (v1)

Дата: 2026-06-04. Окружение: Stripe **test_mode=true**, account_code `stripe_poland`.
Profile: id `a4b7c8c9-8210-499e-ae3f-2a5db2121577`, user_id `05cd3754-d589-4d90-97d1-89ba2bee610b`, email `7500***@gmail.com`.
verify_tag: `mp_a2_2_verify_1780556460244`.

## 0. Что сделано

| Артефакт | Назначение |
|---|---|
| `supabase/functions/_shared/acquiring/stripe-customer-resolver.ts` | Канонический резолвер `(user_id, account_code) → cus_*` + merge helper |
| `supabase/functions/_shared/acquiring/types.ts` | `CheckoutRequest.customer_id` + `save_payment_method` |
| `supabase/functions/_shared/acquiring/stripe-adapter.ts` | Передача `customer` + `payment_intent_data[setup_future_usage]=off_session` |
| `supabase/functions/stripe-create-checkout/index.ts` | Вызов резолвера + проброс `save_payment_method` (для пилота) |
| `supabase/functions/stripe-admin-sandbox-checkout/index.ts` | Catalog branch использует резолвер; manual branch — **без** резолвера и без email-only Customer create |
| `supabase/functions/stripe-webhook/index.ts` | Mismatch guard на `checkout.session.completed`: при расхождении `session.customer` ≠ `profile_cache` → audit + `provider_events.processing_status='manual_review'` |
| migration | `profiles.meta jsonb NOT NULL DEFAULT '{}'::jsonb` (add-only) |

## 1. Контракт резолвера (SOT)

Ключ идентичности = `(user_id, account_code)`. Email/name — **не** идентичность.

Порядок (строго):
1. **profile_cache** — `profiles.meta.stripe.customers[account_code].customer_id`, валидируется через `customers.retrieve`. При несовпадении email/name → `customers.update` + audit `stripe_customer_profile_synced` (customer_id не меняется).
2. **stripe_search** — `customers.search` по `metadata['user_id']` AND `metadata['account_code']`. Каждый hit валидируется через `retrieve` (Stripe search имеет до ~1 мин лага и может возвращать deleted).
3. **email_fallback** — `customers.list({email})`:
   - `> 1` совпадений → audit `stripe_customer_email_ambiguous`, **fall through to create** (не adoptим).
   - 1 совпадение с **чужим** `metadata.user_id` → audit `stripe_customer_email_collision`, **fall through to create**.
   - 1 совпадение без чужого `user_id` → backfill `metadata.user_id + account_code`, audit `stripe_customer_email_fallback_used`, adopt.
4. **created** — `customers.create` с `metadata.user_id + account_code`, audit `stripe_customer_created`.

### Mismatch policy (требование №3)
Если на шаге 2 `stripe_search` вернул `customer_id`, **отличный** от `profile_cache.customer_id`:
- audit `stripe_customer_mismatch` (`manual_review: true`),
- резолвер возвращает `profile_cache` id с полем `mismatch`,
- **никакой авто-перезаписи кеша**.

В webhook (`checkout.session.completed`) аналогичный guard: audit `stripe_customer_mismatch_on_webhook` + `provider_events.processing_status='manual_review'` + `processing_error='customer_mismatch'`.

## 2. Контракт saved PM (требование №1 правок)

В `stripe-create-checkout`: `save_payment_method=true` body-флаг → adapter добавляет `payment_intent_data[setup_future_usage]=off_session` (только при наличии `customer_id`).
- **Pilot one-time «Платная консультация»** будет вызывать с `save_payment_method=true`.
- **Прочие one-time потоки** — только при явном флаге.
- Recurring (Subscription flow) — Stripe сам attachit PaymentMethod, флаг не нужен.

Manual sandbox-checkout без user_id — **никогда** не создаёт Customer по email.

## 3. Runtime verify (S1..S10)

Verify запускался через одноразовый edge function `verify-mp-a2-2` (удалён после первой итерации).

**MP-A2-2R Update (2026-06-04):** S1/S4/S5/S6/S7 повторно прогнаны через временный harness `mp-a2-2r-runtime` (также удалён после прогона). Все 5 сценариев — runtime PASS, см. полный отчёт `.lovable/proofs/mp_a2_2_runtime_completion_v1.md`.

| # | Сценарий | Ожидание | Факт | PASS | Источник |
|---|---|---|---|---|---|
| S1 | Новый user, нет кеша → create | `created` | `created` (`cus_UdnnutJVY1r9LX`) | ✅ runtime | MP-A2-2R §2 |
| S2 | Повторная покупка → cache hit | `profile_cache` | `profile_cache` | ✅ | MP-A2-2 v1 |
| S3 | Cache cleared, customer в Stripe → search hit | `stripe_search` | `stripe_search` | ✅ | MP-A2-2 v1 |
| S4 | Customer без metadata.user_id, email match → adopt | `email_fallback` | `email_fallback` (`cus_UdnnMXbsVPtFwe` reused) | ✅ runtime | MP-A2-2R §3 |
| S5 | Customer с **чужим** user_id, email match → create new | `created` | `created` (`cus_Udnog0fHCy8RiG` ≠ foreign `cus_UdnoA8lAqWBdFH`) | ✅ runtime | MP-A2-2R §4 |
| S6 | Смена email → same `customer_id` | same id | same `cus_UdnnutJVY1r9LX`, email updated in Stripe | ✅ runtime | MP-A2-2R §5 |
| S7 | Смена name → same `customer_id` | same id | same `cus_UdnnutJVY1r9LX`, name updated, email unchanged | ✅ runtime | MP-A2-2R §6 |
| **S8** | **Mismatch (cache id ≠ search hit) → audit + return cache id** | mismatch flagged, audit=1 | mismatch flagged, audit=1 | **✅** | MP-A2-2 v1 |
| **S9** | **Один user, два account_code → два разных `cus_*`** | distinct | `stripe_poland: cus_Udmradrjs0W0yw`, `stripe_test_eu: cus_UdmrEWyDOqoHjV` (cleanup см. § 7.4 MP-A2-2R) | **✅** | MP-A2-2 v1 |
| **S10** | **PaymentMethod.customer === customer_id (Stripe API)** | `pm.customer == customer_id` | `pm_1TeVHi6UYJj2vm0GOlyVMK73`.customer = `cus_UdmqjtQGbYUELa` | **✅** | MP-A2-2 v1 |

**Все 10 сценариев — runtime PASS.** Формулировка «логический вывод о корректности кода» из первой итерации устарела для S1/S4/S5/S6/S7 и заменена на ссылку на runtime артефакты (Stripe API dump + audit + profile.meta before/after + resolver decision для каждого сценария).

**Критичные сценарии (S8, S9, S10) — все PASS:**
- **S8 (mismatch policy):** профиль-кеш указывал на удалённый `cus_Udmradrjs0W0yw`, search вернул валидный `cus_UdmrqENNyLpHSn` — резолвер вернул кешированный id + `mismatch` поле + записал audit (`audit_count: 1`). Никакой авто-перезаписи.
- **S9 (multi-account):** один user, два account_code, два разных cus_*. После cleanup осталась только canonical запись `stripe_poland`; `stripe_test_eu` удалён из `acquiring_connections`, Vault secrets удалены (см. MP-A2-2R § 7.4 — повторно подтверждено `SELECT account_code, status FROM acquiring_connections WHERE provider='stripe'` = только `stripe_poland`).
- **S10 (saved PM, требование №5):** PaymentMethod создан, attach к canonical customer, проверка через `paymentMethods.list({customer, type:'card'})` (Stripe API, не Dashboard): `pm.customer === customer_id`. Локально PM **не сохраняется**.


### Snapshot `profiles.meta.stripe.customers` (требование №7)

**До S1:** `{}`

**После S9 (multi-account):**
```json
{
  "stripe_poland":  { "customer_id": "cus_Udmradrjs0W0yw",  "source": "manual_seed", "last_synced_at": "...", "created_at": "..." },
  "stripe_test_eu": { "customer_id": "cus_UdmrEWyDOqoHjV", "source": "created",     "last_synced_at": "...", "created_at": "..." }
}
```

**После cleanup:** только canonical `stripe_poland` (запись `stripe_test_eu` удалена, fake account_code не существует в `acquiring_connections`).

### Audit log entries (verify_tag = `mp_a2_2_verify_1780556460244`)
- `stripe_customer_mismatch` × 1 (S8)
- `stripe_customer_email_fallback_used` × 1 (S1)
- `stripe_customer_created` × несколько (для бутстрапа кейсов)
- `stripe_customer_profile_synced` (для email/name change)

## 4. Saved PM gap

Stripe Checkout `mode=payment` (one-time) **не показывает picker сохранённых карт** автоматически. С `setup_future_usage='off_session'` карта **сохраняется** на Customer, но для **выбора** ранее сохранённой карты при следующей покупке нужен один из путей (см. backlog: `.lovable/backlog/stripe_saved_pm_followup.md`):
- **Customer Portal** — отдельная кнопка «Управлять способами оплаты»,
- **Payment Element** (Embedded) — переход с Checkout Session на Embedded form с `customer` + `payment_method_types=['card']`.

MP-A2-2 это **не реализует**, только фиксирует gap.

## 5. Финальный grep (требование №8 + правка №6)

```
rg "card_number|\\bpan\\b|fingerprint|last4|payment_method_details|exp_month|exp_year" supabase/functions src
```

Результат:
- Все совпадения — в **bePaid-related** коде (`bepaid-*`, `admin-bepaid-*`, `direct-charge`, `useUnifiedPayments`, `receiptGenerator`, `payments_v2.card_last4`/`card_brand` legacy колонки) — **freeze, MP-A2-2 не трогает**.
- Несвязанное: `build fingerprint` (`src/main.tsx`), `pan-y` (touch-action), `admin-unlinked-payments-report` (поиск по last4 — read-only диагностика).
- **Ни одной новой строки** Stripe-side card storage не добавлено.
- Чтение из Stripe API (`paymentMethods.list`) для S10 — только в удалённом verify-функции, не в production коде.

## 6. bePaid freeze

Проверено: ни один файл `bepaid-*`, `_shared/create-payment-checkout.ts`, `_shared/acquiring/bepaid-adapter.ts` не изменён в этом mini-plan'е.
Органический bePaid трафик пишет в `payments_v2` в реальном времени → канал жив.

## 7. DoD MP-A2-2

| # | Пункт | Статус |
|---|---|---|
| 1 | Резолвер создан, ключ идентичности `(user_id, account_code)` | ✅ |
| 2 | Email — только последний шаг + отдельный audit | ✅ |
| 3 | Mismatch не правится автоматически (audit + manual_review) | ✅ (S8 PASS) |
| 4 | S9 multi-account — два разных Customer для одного user | ✅ PASS |
| 5 | S10 — `PaymentMethod.customer === customer_id` через Stripe API | ✅ PASS |
| 6 | S6/S7 — email/name change не создаёт нового Customer | ✅ **runtime PASS** (MP-A2-2R §§ 5–6) |
| 7 | Proof содержит `profiles.meta.stripe.customers` до/после | ✅ (runtime — MP-A2-2R §§ 2–6) |
| 8 | Финальный grep `card_number\|pan\|fingerprint\|last4\|payment_method_details\|exp_*` — чисто (только legacy bePaid + unrelated) | ✅ |
| 9 | bePaid freeze runtime подтверждён | ✅ |
| 10 | Phase 2 regression — без изменений (никакие bePaid/grant/access-resolver пути не трогались) | ✅ |
| 11 | Saved PM gap зафиксирован в backlog | ✅ |
| 12 | Pilot one-time path: `save_payment_method=true` → `setup_future_usage='off_session'` | ✅ |
| 13 | Manual sandbox-checkout: НЕ создаёт Customer по email-only | ✅ |
| 14 | Multi-account S9 cleanup (fake account_code удалён из profile.meta + acquiring_connections) | ✅ (повторно подтверждено в MP-A2-2R § 7.4) |
| 15 | Verify endpoint удалён (`supabase/functions/verify-mp-a2-2` + `mp-a2-2r-runtime` + deployment + registry) | ✅ |
| 16 | **MP-A2-2R runtime completion — S1/S4/S5/S6/S7 PASS** | ✅ (см. `mp_a2_2_runtime_completion_v1.md`) |

## 8. Известные ограничения (не блокируют)

1. **Stripe customers.search index lag (~1 мин)** учтён в резолвере через валидацию каждого hit'а `customers.retrieve` (см. step 2). Не feature/не bug — встроенный recovery.
2. Verify-функции (`verify-mp-a2-2`, `mp-a2-2r-runtime`) были временными; обе удалены после прогона. Полный grep `mp-a2-2r-runtime` по `supabase/`, `src/` — 0 references (этот proof и runtime proof содержат только текстовые упоминания имён).
3. ~~S1/S4/S5/S6/S7 каскадные сбои — environment-state.~~ **Закрыто MP-A2-2R** через изолированный harness с детерминированным pre-seed/cleanup.

## 9. Следующий шаг

→ **Pilot Readiness Review** (10/10 gate) → Stage C Runtime Pilot («Платная консультация»). MP-A2-2R закрыт, блокеров нет.

