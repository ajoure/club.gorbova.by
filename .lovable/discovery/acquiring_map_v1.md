# Discovery: карта платёжной архитектуры (acquiring_map_v1)

Дата: 2026-06-02. Подготовлено перед добавлением Stripe как второго эквайринга.

## 1. Объёмы (на момент discovery)

| Таблица | Строк | Комментарий |
|---|---|---|
| `payments_v2` | 5 927 | provider: bepaid=5627, admin=289, admin_test=10 (+новые с момента предыдущего среза) |
| `orders_v2` | 3 662 | provider: NULL=2615 (legacy), getcourse=621, bepaid=330, historical_import=78, admin=18 |
| `subscriptions_v2` | 1 228 | provider в `meta` (snapshot), канонический provider — в `provider_subscriptions` |
| `provider_subscriptions` | 706 | provider: bepaid=706 (единственный) |
| `payment_links` | 105 | колонка `provider` ОТСУТСТВУЕТ → расширение в Фазе 1 |
| `integration_instances` | — | уже мульти-provider; bePaid creds читаются через `provider='bepaid'` |

CHECK constraint на `provider` нигде НЕ установлен (только тривиальные на `public_url`). Это упрощает добавление Stripe как text-значения.

## 2. Write-paths (создание заказов / платежей / подписок)

### 2.1. One-time checkout
- `supabase/functions/_shared/create-payment-checkout.ts` — единая SOT для one-time (`isOneTime: true`) и pay-now (1145 строк). Хардкод `provider:'bepaid'` на строке 1027 (см. bepaid_hardcodes.csv).
- `supabase/functions/admin-create-payment-link/index.ts` — direct админ-checkout.
- `supabase/functions/public-checkout/index.ts` — JWT-less оплата по `/pay/:token` (memory: `public-checkout-architecture`).
- `supabase/functions/admin-create-public-link/index.ts` — единственный writer в `payment_links` (memory: `public-link-writer-standard`).

### 2.2. Recurring / installments
- `bepaid-create-subscription`, `bepaid-create-subscription-checkout`, `bepaid-admin-create-subscription-link` — создание подписок, в т.ч. finite (`billing_cycles=N`).
- `bepaid-create-token` — токенизация карты для последующих MIT-зарядов.

### 2.3. MIT / saved card
- `direct-charge` — заряд по сохранённому токену.
- `admin-manual-charge` — админский off_session заряд (363, 699: provider='bepaid').

### 2.4. Service / reconciliation
- `bepaid-auto-process`, `bepaid-polling-backfill`, `bepaid-sync-orchestrator`, `bepaid-uid-resync`, `bepaid-subscription-audit-cron`.

## 3. Webhook / async ingest
- `bepaid-webhook` (6058 строк) — единственный inbound от bePaid: terminal status, recurring, refunds, ERIP, installments, чек-callbacks.
- `payment-methods-webhook` — апдейты PM/token.
- `bepaid-fetch-transactions`, `bepaid-readonly-pull`, `bepaid-raw-transactions` — pull-fallback.

## 4. Документы / чеки
- `bepaid-fetch-receipt`, `bepaid-get-receipt`, `bepaid-get-payment-docs`, `bepaid-receipts-backfill`, `bepaid-receipts-cron`, `bepaid-receipts-2026-backfill-cron`, `bepaid-docs-backfill`, `bepaid-discrepancy-alert`.

## 5. Канонические downstream-точки (НЕ ТРОГАЕМ)

| Точка | Назначение |
|---|---|
| `grant-access-for-order` (+ `provider_linked_subscription_resolver`) | единственный writer доступов из заказа (memory: `canonical-write-path-standard`, `provider-linked-extend-priority`) |
| `record_refund_atomic` RPC | SOT записи refund (memory: `refund-canonical-write-path`) |
| `admin-repair-refund-recording` | recovery refund-аудита |
| `consume-payment-link` (`_shared/consume-payment-link.ts`) | инкремент `current_uses`, идемпотентность через `orders_v2.meta.payment_link_counted=true` |
| `_shared/entitlement-sync.ts` | GREATEST-семантика entitlements |
| `_shared/access-resolver.ts` | unified resolver доступа |
| `_shared/crm-routing.ts` | привязка к воронкам/этапам |
| `telegram-grant-access` | DM-инвайт (memory: `canonical-grant-write-path`) |
| `document-auto-generate` | автогенерация документов |

Stripe-интеграция подключается ПЕРЕД этими точками. Все они остаются provider-agnostic и читают `payments_v2.provider`, `orders_v2.provider`, `provider_subscriptions.provider` как text.

## 6. Поля-крючки, на которых уже стоит мульти-providerность

```
payments_v2:           provider TEXT, provider_payment_id TEXT, payment_token, card_last4/brand/holder,
                       meta.payment_method, meta.payment_channel, refunds JSONB, refunded_amount,
                       origin TEXT, import_ref, reference_payment_id
orders_v2:             provider TEXT, provider_payment_id, bepaid_subscription_id (legacy-имя — НЕ переименовываем)
subscriptions_v2:      meta JSONB (snapshot provider)
provider_subscriptions: provider TEXT, provider_subscription_id, card_token, state
payment_links:         meta JSONB (provider колонка отсутствует — добавляется в Фазе 1)
integration_instances: provider TEXT, config JSONB, config_secrets JSONB (готово для Stripe)
```

## 7. Edge-функции по namespace (для Фазы 1)

- **bePaid namespace (50+ функций)** — `bepaid-*`, `admin-bepaid-*`, `admin-bepaid-backfill*`, `admin-bepaid-reconcile-*`. НЕ рефакторим, НЕ переименовываем.
- **Provider-agnostic write/read (трогаем минимально)**:
  - `_shared/create-payment-checkout.ts` — добавляется `provider` параметр (default 'bepaid')
  - `_shared/document-render.ts:452`, `_shared/document-data-snapshot.ts:358` — provider-маппинг расширяется
  - `_shared/document-resolver-v2/payment-channel.ts` — комментарий + ветка для 'stripe'
- **Admin-utility**: `admin-create-payment-link`, `admin-create-public-link`, `admin-link-payment-to-order`, `admin-manual-charge`, `admin-materialize-queue-payments`, `admin-fix-*`, `admin-purge-*`, `admin-reconcile-*` — оставляем как есть; Stripe-эквиваленты создаются как параллельные `stripe-*` функции.
- **Новые (Фаза 2)**: `stripe-create-checkout`, `stripe-create-subscription`, `stripe-webhook`, `stripe-get-payment-details`, `stripe-list-subscriptions`, `stripe-cancel-subscription`, `stripe-create-refund`, `stripe-charge-saved-pm`.

## 8. Frontend-точки касания

- `src/hooks/useUnifiedPayments.tsx` — провайдер-фильтр (хардкод bepaid в 5 местах).
- `src/hooks/usePaymentsServerStats.ts` — `p_provider: 'bepaid'` (нужен мульти).
- `src/components/admin/payments/*` — PaymentsTabContent, AutoRenewalsTabContent, PaymentsFilters, RefundDialog, Inv22ResolverPanel.
- `src/components/admin/deals/DealsFiltersBar.tsx` — фильтр по providerу.
- `src/utils/derivePaymentChannel.ts` — резолвер канала (комментарий упоминает bepaid).
- `src/components/integrations/*`, `src/hooks/useIntegrations.tsx` — карточки интеграций (готово к Stripe-карточке).

## 9. Что НЕ покрывает Stripe из существующего bePaid-сценария

- ЭСЧФ / РБ-фискализация (54-ФЗ аналог) — Stripe не выдаёт; решается отдельно в backlog `.lovable/discovery/open_questions_stripe_v1.md`.
- ЕРИП — only-BY, остаётся в bePaid; Stripe не предлагать как замену.
- Bank statement CSV import (`bepaid-archive-import`, `bepaid-report-import`, `admin-import-bepaid-statement-csv`) — Stripe выгружает иначе (Sigma / Balance Reports); вне MVP.

## 10. Готовность БД к мульти-провайдеру

| Готово ✓ | Дополнить (Фаза 1) |
|---|---|
| `payments_v2.provider` (text, без CHECK) | CHECK-constraint в одобренном списке значений |
| `provider_subscriptions.provider` (text) | то же CHECK |
| `orders_v2.provider` (text) | то же CHECK |
| `integration_instances.provider` (text) | + provider='stripe' через UI Фазы 1.6 |
| — | `payment_links.provider TEXT NOT NULL DEFAULT 'bepaid'` + CHECK |
| — | `payment_links.provider_mode TEXT NOT NULL DEFAULT 'fixed'` (fixed / customer_choice) |
| — | новая таблица `provider_events` (idempotency ledger, см. Фаза 2.3) |

## DoD фазы 0
- ✅ `acquiring_map_v1.md` создан.
- ✅ `bepaid_hardcodes.csv` — см. соседний файл.
- ✅ `stripe_api_capabilities_v1.md` — см. соседний файл.
- ✅ `stripe_vs_bepaid_gap_matrix.md` — см. соседний файл.
- ✅ `open_questions_stripe_v1.md` — см. соседний файл.
- 🚫 Никаких изменений в коде/БД.

---

## v1.1 patches applied (2026-06-02)

Discovery дополнен следующими артефактами (см. одноимённые файлы в `.lovable/discovery/`):

1. **acquiring_accounts_model_v1.md** — multi-account readiness без реализации multi-account. Helper `getAcquiringSecret(account_code, key_name)`, контракт `account_code` в `payment_links` / `payments_v2.meta` / `provider_subscriptions.meta` / `orders_v2.meta`.
2. **business_stream_classification_v1.md** — классификация платежей по бизнес-направлению (`accounting_school`, `consulting`, `documents`, `club`, `marketplace`). Приоритет источников: tariff_offers.meta → products.meta → orders_v2.meta → дефолт-резолвер по product_id.
3. **stripe_feature_inventory_full.md** — полный inventory возможностей Stripe (Платежи / Подписки / Каталог / Налоги / Документы / Маркетинг / Кабинет / Риски / Интеграции) с пометками `MVP | Phase2 | Backlog | NotUsed`.
4. **stripe_admin_configuration_matrix.md** — карта настроек: что админ настраивает у нас vs в Stripe Dashboard. Зафиксирован раздел «Что НЕЛЬЗЯ настраивать из нашей админки» (payouts, KYC, ownership, tax registrations и т.д.).
5. **payment_provider_profiles_model_v1.md** — профили настроек платёжной кнопки. На MVP — inline в `tariff_offers.meta.stripe_profile`, таблица в Фазе 3. Шаблоны: `stripe_standard_eur/pln/usd`, `stripe_subscription_eur` (без BYN/RUB до подтверждения).
6. **stripe_currency_support_v1.md** — бизнес-whitelist EUR/PLN/USD/BYN/RUB; фактическая поддержка определяется через `/v1/country_specs/PL` в Фазе 1; для неподдерживаемых валют UI автоматически предлагает bePaid.
7. **stripe_object_mapping_v1.md** — маппинг Products / Tariffs / Payment Links / Orders / Subscriptions / Payments / Refunds ↔ Stripe-сущности.
8. **stripe_metadata_contract_v1.md** — обязательные/опциональные/immutable поля metadata для всех Stripe-объектов.
9. **open_questions_stripe_v2.md** — заменяет v1; снят restricted-key-as-blocker; BYN/RUB переведены в discovery-dependent.

### Правка к §6 «Поля-крючки» (add-only)

К существующим мульти-providerным полям добавляются (в Фазе 1):

```
payment_links:          provider TEXT NOT NULL DEFAULT 'bepaid' (новая колонка)
                        provider_mode TEXT NOT NULL DEFAULT 'fixed' (fixed/customer_choice)
                        account_code TEXT NULL (single-account fallback)
                        profile_code TEXT NULL (override профиля)
                        business_stream TEXT NULL (override продукта)

orders_v2.meta.account_code      — snapshot аккаунта на момент заказа
orders_v2.meta.business_stream   — snapshot потока
orders_v2.meta.profile_code      — snapshot профиля

payments_v2.meta.account_code, .business_stream — наследуется из order

provider_subscriptions.meta.account_code — для будущей multi-account routing
tariff_offers.meta.stripe.price_id      — Stripe Price mapping (Phase 2)
tariff_offers.meta.stripe_profile       — inline профиль на MVP
tariff_offers.meta.business_stream      — explicit per-offer

products.meta.business_stream            — fallback per-product
products.meta.account_code_override      — опционально, override дефолта
```

Все поля **nullable / с дефолтом**, single-account режим работает без их заполнения. bePaid флоу не затрагивается.

### Discovery v1.1 — статус закрытия

После создания 9 артефактов выше discovery считается **закрытым**. По требованию патча «Не блокировать Фазу 1» — переходим к Фазе 1 (provider abstraction + payment_links расширение + adapter layer + раздел Integrations → Acquiring) без дополнительного согласования, при условии что критические ограничения Stripe не выявлены.

Discovery валют (§2 в `stripe_currency_support_v1.md`) выполняется в начале Фазы 1 как первая operational задача.
