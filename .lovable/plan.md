# План Stripe Integration — статус

## Текущий этап: Discovery v1.1 ЗАКРЫТ

Discovery v1 (5 артефактов) → расширен до v1.1 (+6 артефактов с правками пользователя):

- `.lovable/discovery/acquiring_map_v1.md` (+ дельта v1.1 в конце)
- `.lovable/discovery/bepaid_hardcodes.csv`
- `.lovable/discovery/stripe_api_capabilities_v1.md`
- `.lovable/discovery/stripe_vs_bepaid_gap_matrix.md`
- `.lovable/discovery/acquiring_accounts_model_v1.md` ⭐ v1.1
- `.lovable/discovery/business_stream_classification_v1.md` ⭐ v1.1
- `.lovable/discovery/stripe_feature_inventory_full.md` ⭐ v1.1
- `.lovable/discovery/stripe_admin_configuration_matrix.md` ⭐ v1.1
- `.lovable/discovery/payment_provider_profiles_model_v1.md` ⭐ v1.1
- `.lovable/discovery/stripe_currency_support_v1.md` ⭐ v1.1
- `.lovable/discovery/stripe_object_mapping_v1.md` ⭐ v1.1
- `.lovable/discovery/stripe_metadata_contract_v1.md` ⭐ v1.1
- `.lovable/discovery/open_questions_stripe_v2.md` ⭐ v1.1 (заменяет v1)

## Применённые правки пользователя в v1.1

1. ✅ BYN/RUB — только бизнес-whitelist, без гарантии Stripe-поддержки; UI fallback на bePaid.
2. ✅ Restricted API key убран из обязательных open questions; старт через стандартный Secret Key.
3. ✅ Добавлен `stripe_object_mapping_v1.md` (Products/Tariffs/Links/Orders/Subscriptions/Payments/Refunds ↔ Stripe).
4. ✅ Добавлен `stripe_metadata_contract_v1.md` (обязательное/опциональное/immutable/downstream).
5. ✅ Из стартовых профилей удалены `stripe_standard_byn` и `stripe_standard_rub`.
6. ✅ В `stripe_admin_configuration_matrix.md` добавлен раздел «Что НЕЛЬЗЯ настраивать из нашей админки».

## Следующий этап: Фаза 1 — provider abstraction (без согласования)

По требованию патча «Не блокировать Фазу 1» — переходим к реализации:

1. Миграция: `payment_links` += `provider`, `provider_mode`, `account_code`, `profile_code`, `business_stream` (все nullable / с дефолтом).
2. `_shared/acquiring/` (новый каталог): `types.ts`, `bepaid-adapter.ts` (facade), `index.ts` (`resolveAdapter`), `secrets.ts` (`getAcquiringSecret`), `profile-resolver.ts`, `business-stream-resolver.ts`.
3. Рефакторинг `_shared/create-payment-checkout.ts`: принимает `provider` параметром, default `'bepaid'`. Никаких изменений поведения для bePaid-вызовов.
4. UI: новая страница `/admin/integrations/acquiring` с карточкой Stripe (status: not_configured).
5. UI: фильтр `provider` в `/admin/payments/*` и `/admin/payments/links` (single-value на старте).
6. Discovery валют через Stripe API — первая operational задача Фазы 1 (заполняет `stripe_currency_support_v1.md` §2).

**Строго add-only**, bePaid поведение не меняется, ноль diff'ов в `bepaid-*` функциях.

## Фаза 2 (после Фазы 1)
Stripe-adapter (sandbox), edge-функции `stripe-create-checkout`, `stripe-webhook`, `stripe-create-refund`, `stripe-list-subscriptions`, `provider_events` ledger, secrets `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`.
