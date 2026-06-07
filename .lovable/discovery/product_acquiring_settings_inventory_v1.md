# Discovery: Product Acquiring Settings Inventory (Phase 5-A)

Дата: 2026-06-07. Режим: read-only. Цель — зафиксировать текущее состояние, контракт `meta.acquiring`, точки кода и безопасный план backfill перед Phase 5-B.

---

## 1. Текущая карта `tariff_offers`

Срез БД (`tariff_offers`, всего 38):

| Метрика | Значение |
|---|---|
| Всего offers | 38 |
| Активных (`is_active=true`) | 26 |
| С `meta.stripe.price_id` | **1** (id `6f306cbc-…`, tariff `31f75673-…`, 100 BYN, account `stripe_poland`) |
| Installment (`is_installment=true`) | 0 |
| С существующим `meta.acquiring` | 0 |
| Конфликтов в `meta` (наличие `acquiring` + `stripe` одновременно) | 0 |

**Вывод:** поле `meta.acquiring` свободно, ни один offer его не использует. Бэкфилл безопасен.

Единственный Stripe-offer на момент discovery:
```
offer_id  = 6f306cbc-24e8-4589-b6f3-2dca9e4d0c8e
tariff_id = 31f75673-a7ae-420a-b5ab-5906e34cbf84
amount    = 100.00
meta.stripe = {
  account_code = stripe_poland
  product_id   = prod_UdwjYeet4QFbtW
  price_id     = price_1Teeq26UYJj2vm0GPXHSLKlz
  price_snapshot.currency = byn
  business_stream = consultations
  ...
}
```

## 2. `acquiring_connections`

Одна активная запись:

| provider | account_code | status | test_mode | is_default |
|---|---|---|---|---|
| stripe | stripe_poland | active | true | true |

bePaid конфигурируется через глобальные secrets/credentials (`_shared/bepaid-credentials.ts`), а не через `acquiring_connections`. **Backlog:** возможный перевод bePaid в `acquiring_connections` — вне scope Phase 5.

## 3. `payment_links`

Существующие поля провайдера:

| Поле | Тип | CHECK |
|---|---|---|
| `provider` | text NOT NULL | `provider IN ('bepaid','stripe','admin','admin_test','admin_test_direct')` |
| `provider_mode` | text | `provider_mode IN ('fixed','customer_choice')` |
| `account_code` | text | — |
| `profile_code` | text | — |
| `business_stream` | text | — |
| `meta` | jsonb | — |

Срез:

| provider | total | fixed | customer_choice |
|---|---|---|---|
| bepaid | 114 | 114 | 0 |
| stripe | 8 | 8 | 0 |

**Ключевая находка:**
- `provider` колонка имеет жёсткий CHECK и **NOT NULL** → значение `null` ИЛИ `'multi'` использовать нельзя без миграции.
- Уже существует `provider_mode` с `customer_choice` — это идеальный канал для multi-provider режима без новых миграций.

**Решение (финализировано):** для multi-provider ссылок `provider` = `'bepaid'` (как «дефолтный» из массива), а решение принимается по полям:
- `provider_mode = 'customer_choice'` → показывать выбор;
- `meta.allowed_payment_providers = ['bepaid','stripe']` — реальный массив;
- `meta.default_provider = 'bepaid'` — какой подсветить и какой брать в admin checkout по умолчанию.

Это не требует ALTER CHECK и не ломает existing rows.

## 4. Контракт `tariff_offers.meta.acquiring` (финал Phase 5-A)

```json
{
  "allowed_payment_providers": ["bepaid", "stripe"],
  "default_provider": "bepaid",
  "customer_choice_enabled": true,
  "stripe": {
    "account_code": "stripe_poland",
    "product_id": "prod_...",
    "price_id": "price_...",
    "currency": "EUR",
    "mode": "test"
  }
}
```

Правила:
- `allowed_payment_providers`: non-empty массив из `bepaid|stripe`. При length=1 → жёсткий provider, выбор не показывается, `customer_choice_enabled` игнорируется.
- `default_provider`: должен входить в `allowed_payment_providers`. Используется:
  - в admin checkout как initial selection;
  - в UI Offer как «выбран по умолчанию у пользователя».
- `customer_choice_enabled`: применимо только если length≥2. Если `false` → пользователю показывается `default_provider` без выбора.
- `stripe.*` обязателен ⟺ `stripe ∈ allowed_payment_providers`. `stripe.price_id` — required.
- Installment-guard (Phase 5-B): если `tariff_offers.payment_method = 'internal_installment'` → `allowed_payment_providers` **не может** содержать `stripe`. Backend 400 `stripe_installment_not_supported`.

## 5. Точки кода (call-sites чтения провайдера / Stripe price_id)

| Файл | Что читает | Назначение |
|---|---|---|
| `supabase/functions/_shared/create-stripe-checkout.ts:407–520` | `offer.meta.stripe.price_id`, `product_id` | Создание Stripe Checkout Session |
| `supabase/functions/_shared/stripe-pre-create-subscription.ts:42–333` | `price_id`, `stripe_product_id` от вызывающего | Pre-create Stripe Subscription |
| `supabase/functions/_shared/stripe-subscription-resolver.ts:834–1133` | `meta->stripe->>price_id` (lookup по invoice price → offer_id) | Webhook resolver — **не трогать** |
| `supabase/functions/public-checkout/index.ts` | `payment_links.provider` | Public checkout entry |
| `supabase/functions/admin-create-public-link/index.ts` | `provider`, `account_code` входными параметрами | Создание Public Link |
| `supabase/functions/_shared/create-payment-checkout.ts` | роутер bepaid↔stripe | Admin checkout writer |
| `supabase/functions/_shared/acquiring/stripe-adapter.ts`, `bepaid-adapter.ts`, `default-account.ts`, `vault.ts` | acquiring_connections | Provider adapters |
| `src/components/admin/AdminPaymentLinkDialog.tsx` | provider select | UI создания payment link |
| `src/pages/admin/AdminProductDetailV2.tsx:1727–1768` | вкладки offer dialog (`main / payment / renewal / documents / extra`) | **Точка вставки нового UI** |
| `src/components/admin/product/OfferRowCompact.tsx` | `payment_method`, `is_installment` | Карточка offer |

## 6. Где будет UI (Phase 5-B)

- **Файл:** `src/pages/admin/AdminProductDetailV2.tsx`, диалог редактирования offer.
- **Вкладка:** существующая `payment` («Оплата»), **новой вкладки не создаём**.
- **Место:** под существующим блоком «Способ оплаты (100% / Банковская рассрочка)».
- **Новый блок:** «Доступные способы приёма оплаты» (две checkbox-карточки).
- **Условный блок:** «Настройки Stripe» (account_code из `acquiring_connections.where(provider='stripe', status='active')`, product_id, price_id, currency, mode) — отображается только при включённом чекбоксе Stripe.

Названия для пользователя (фронт `/pay/:token`, PaymentDialog) — финализировано:
- «**Карта белорусского банка**» — для карт банков Республики Беларусь (bePaid).
- «**Карта иностранного банка**» — для карт банков Европы, США и других стран (Stripe).

В админке допустимо «bePaid — карты банков Беларуси / Stripe — карты иностранных банков».

## 7. Безопасный план backfill (исполняется в Phase 5-B, НЕ сейчас)

Условия:
1. **Идемпотентность:** `WHERE meta->'acquiring' IS NULL`.
2. **Правило:**
   - `meta->'stripe'->>'price_id' IS NOT NULL` → `allowed_payment_providers=['bepaid','stripe']`, `default_provider='bepaid'`, `customer_choice_enabled=true`, `stripe` копируется из `meta.stripe` (account_code, product_id, price_id, currency из `price_snapshot.currency`, mode из `livemode`).
   - иначе → `allowed_payment_providers=['bepaid']`, `default_provider='bepaid'`, `customer_choice_enabled=false`, `stripe=null`.
3. **Installment guard:** если `payment_method='internal_installment'` и `stripe` попал в allowed → `stripe` исключается из массива (на момент discovery таких 0).
4. **Audit:** одна сводная запись `phase5_acquiring_backfill_v1` с counters {total_processed, with_stripe, bepaid_only, installment_excluded}.
5. **Объём:** 38 offers, из них 1 со stripe, 37 — bepaid-only. Откат: `UPDATE … SET meta = meta - 'acquiring' WHERE meta->'acquiring'->>'_backfill'='phase5_v1'`.

## 8. Runtime gates для Phase 5-B/C/D

**Phase 5-B (UI + backfill):**
- G81-B: вкладка «Оплата» offer показывает блок «Доступные способы приёма оплаты» с актуальными значениями из `meta.acquiring`.
- G82-B: попытка снять оба чекбокса → блокировка с понятной ошибкой.
- G83-B: включение Stripe без price_id → save заблокирован.
- G84-B: installment + Stripe → блокировка `stripe_installment_not_supported`.
- G85-B: backfill идемпотентен (повторный запуск = 0 строк).

**Phase 5-C (Frontend selection):**
- G81-C: offer=[bepaid], `/pay/:token` → bePaid checkout без UI.
- G82-C: offer=[stripe], `/pay/:token` → Stripe checkout без UI.
- G83-C: offer=[bepaid,stripe] + `customer_choice_enabled=true` → экран выбора «Карта белорусского банка / Карта иностранного банка», слова bePaid/Stripe отсутствуют.
- G84-C: offer=[bepaid,stripe] + `customer_choice_enabled=false` → сразу `default_provider`.
- G85-C: `public-checkout` validates `provider_choice ∈ allowed_payment_providers` (400 иначе).

**Phase 5-D (Admin override + Public Links):**
- G81-D: admin checkout default = `default_provider` offer.
- G82-D: admin (роль `admin`) видит override только в пределах `allowed_payment_providers`.
- G83-D: super_admin может override на любой `active` provider из `acquiring_connections`, audit `admin_provider_override`.
- G84-D: Public Link `provider_mode='auto'` + single-provider offer → `provider` фиксируется.
- G85-D: Public Link `provider_mode='auto'` + multi-provider offer → `provider='bepaid'` (default) + `provider_mode='customer_choice'` + `meta.allowed_payment_providers`.
- G86-D: webhook parity (bepaid-webhook, stripe-webhook, grant-access-for-order, stripe-subscription-resolver) — git diff = 0.

## 9. Запрещено (на все фазы 5-B/C/D)

- Любые правки `grant-access-for-order`, `bepaid-webhook`, `stripe-webhook`, `stripe-subscription-resolver` (consume path), `subscriptions-reconcile`, Telegram lifecycle.
- Новые таблицы, новые providers, новые webhook endpoints.
- ALTER CHECK на `payment_links.provider` или `provider_mode`.
- Stripe-настройки на уровне product/tariff (только offer). Product/Tariff defaults — future phase.
- Слова «bePaid» / «Stripe» в публичном UI (`/pay/:token`, PaymentDialog, landing).

## 10. DoD Phase 5-A

- [x] Карта текущих `tariff_offers` зафиксирована (38 / 1 stripe / 0 installment / 0 acquiring).
- [x] Финальный контракт `meta.acquiring` зафиксирован (с `default_provider` + `customer_choice_enabled`).
- [x] Матрица provider selection описана.
- [x] Место UI в существующей вкладке «Оплата» указано (`AdminProductDetailV2.tsx:1729-1733`).
- [x] DB CHECK `payment_links.provider` и `provider_mode` зафиксированы, решение без миграции принято.
- [x] Безопасный план backfill (правила + audit + rollback) описан.
- [x] Runtime gates для 5-B/C/D разнесены по фазам.

→ **Ожидается approve на Phase 5-B.**
