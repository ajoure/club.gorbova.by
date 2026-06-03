# Phase 3 Discovery — Index (v2)

Обновлён с учётом утверждённых решений (токенизация, Customer Portal, Schedule, миграция, multi-account, пилот «Платная консультация») и правок пользователя (D9/D10/D11 расширены, D12 добавлен, DoD усилен).

## Утверждённые архитектурные решения

1. **Токенизация карт.** Stripe = SOT для карт. Свой слой хранения токенов не строим. Используем `Customer`, `PaymentMethod`, `SetupIntent`, `Subscription`. Локально — только ссылки в `meta`.
2. **Customer Portal.** MVP управления картами/историей/документами/отменой — нативный Stripe Billing Portal. Свой UI откладываем; путь миграции на собственный кабинет через Stripe API описан в discovery.
3. **Бесконечные подписки vs рассрочки.** Клубы/членство → `Subscription`. Рассрочки/finite N → `Subscription Schedule` (`iterations=N`, `end_behavior=cancel`).
4. **Миграция между эквайрингами.** На одном продукте — одна активная подписка независимо от провайдера. Любая смена = строго `cancel → supersede → create new`. Токены карт между провайдерами никогда не переносим.
5. **Multi-Stripe + Multi-Business Stream.** Один Stripe-аккаунт может обслуживать много `business_stream`; один `business_stream` со временем может переехать на другой `account_code`. Аналитика поддерживает разрезы `provider / account_code / business_stream / product / tariff`.
6. **Первый пилот = «Платная консультация».** Технический пилот на разовых платежах. **Финальное подтверждение архитектуры** — повторный 10-пунктовый Runtime Verification на клубе.

## Жёсткие freeze (наследуются из Phase 2)
- bePaid recurring изолирован, не модифицируется.
- `subscriptions_v2` / `provider_subscriptions` — SOT, расширение только через `meta.*`.
- `record_refund_atomic_multi`, `grant-access-for-order`, bePaid edge-функции — не трогаем.

## Deliverables

| # | Файл | Тема |
|---|------|------|
| D1 | `stripe_subscriptions_capabilities_v1.md` | Карта возможностей Subscriptions/Schedule |
| D2 | `stripe_subscriptions_object_mapping_v1.md` | Маппинг объектов Stripe ↔ наши таблицы |
| D3 | `stripe_vs_bepaid_subscription_parity_v1.md` | Матрица паритета и зон несовместимости |
| D4 | `stripe_subscription_lifecycle_contract_v1.md` | Жизненный цикл + SOT-контракт |
| D5 | `stripe_subscriptions_webhook_plan_v1.md` | Webhook + Lost Webhook Recovery |
| D6 | `stripe_subscriptions_ui_admin_inventory_v1.md` | Admin + пользовательские экраны |
| D7 | `stripe_subscriptions_open_questions_v1.md` | Открытые вопросы |
| D8 | `stripe_subscriptions_risk_register_v1.md` | Реестр рисков |
| D9 | `provider_migration_strategy_v1.md` | Миграция подписок + миграция способов оплаты |
| D10 | `multi_account_stripe_architecture_v1.md` | Multi-Stripe + Multi-Business Stream |
| D11 | `stripe_feature_inventory_full_v2.md` | Реестр возможностей Stripe + reserve-сейчас блок |
| D12 | `stripe_data_ownership_matrix_v1.md` | Матрица владения данными (SOT-таблица) |

## Обязательная структура каждого документа (DoD)

В каждом D1–D12 присутствуют разделы:
1. **SOT** — что является источником истины для темы документа.
2. **Что хранится локально** — таблицы/колонки/meta-ключи в нашей БД.
3. **Что хранится в Stripe** — какие объекты Stripe владеют данными.
4. **Recovery** — что делать при потере webhook/рассинхроне/частичном падении.
5. **Multi-account** — как тема ведёт себя при нескольких Stripe-аккаунтах и нескольких business_stream.

Без этих разделов документ считается неполным.

## Definition of Done Phase 3 Discovery
- Созданы D1–D12 (this batch).
- Approve пользователя.
- Никаких изменений кода, миграций, edge-функций, UI, секретов.
- Open Phase 2 micro-items (prior_refunded double-count; follow-up runtime refund-ветки) — в deferred.
