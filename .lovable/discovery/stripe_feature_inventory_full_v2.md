# D11. Stripe Feature Inventory (v2)

Заменяет `stripe_feature_inventory_full.md` (v1 оставлен в истории). Категории: **MVP / Phase 4 / Future**.

## MVP (внедряем в Phase 3)

### Checkout
- **Что делает:** хостед-страница оплаты Stripe (one-time и `mode=subscription`).
- **Зачем:** минимизирует риск PCI, поддерживает 3DS/SCA, Apple/Google Pay из коробки.
- **Используем:** да, основной flow.
- **Преимущество:** скорость интеграции, локализация, native Portal-link на success.

### Payment Links
- **Что делает:** готовая ссылка на оплату без кода.
- **Зачем:** «Оплатить» из писем/мессенджеров, разовые продажи консультаций.
- **Используем:** да, как Stripe-аналог bePaid public links.
- **Преимущество:** меньше custom-кода на public-checkout.

### Subscriptions
- **Что делает:** автосписания.
- **Зачем:** клубы/членство.
- **Используем:** да (после консультационного пилота).
- **Преимущество:** Smart Retries, Portal self-service.

### Subscription Schedules
- **Что делает:** ограниченное число платежей с автоматическим завершением.
- **Зачем:** рассрочки (3/6/12 платежей).
- **Используем:** да.
- **Преимущество:** Stripe сам считает iterations и закрывает подписку, не нужен наш installment-counter.

### Customer Portal
- **Что делает:** самообслуживание (карта/история/инвойсы/отмена).
- **Зачем:** убирает необходимость собственного UI карт в MVP.
- **Используем:** да.
- **Преимущество:** zero-maintenance UI замены карты, SCA-compliant.

### Setup Intents
- **Что делает:** привязка карты без оплаты.
- **Зачем:** будущий собственный кабинет; не основной MVP-flow, но архитектурно зарезервирован.
- **Используем:** опционально; готовим архитектурное место.
- **Преимущество:** карта прикрепляется до первого списания (важно для подписок с trial — Phase 4+).

### Smart Retries
- **Что делает:** автоматические повторные попытки списания.
- **Зачем:** снижение churn при сбоях карты.
- **Используем:** defaults Stripe.
- **Преимущество:** без нашего кастомного retry-движка.

### Automatic Card Updater
- **Что делает:** автоматическое обновление истёкших карт.
- **Зачем:** снижение churn на смене карт.
- **Используем:** включаем в Billing settings, ничего в коде.
- **Преимущество:** silent renewal.

## Phase 4 (следующая очередь)

### Coupons
Скидки по правилам Stripe. Архитектурное место: `tariff_offers.meta.stripe.coupon_id`.

### Promotion Codes
Промокоды поверх Coupons. Архитектурное место: `payment_links.meta.stripe.promo_code`.

### Invoices (manual)
B2B-инвойсы по `send_invoice`. Сейчас не нужно (ЭСЧФ — bePaid-only), но интересно для иностранных клиентов Stripe.

### Billing Analytics
Stripe Sigma/Billing dashboards. Используем как complement к нашей аналитике.

## Future / пока не нужно

| Feature | Почему сейчас не нужно |
|---|---|
| Tax | Налоги ведём по-своему (РБ), Stripe Tax не покрывает наш кейс. |
| Connect | Маркетплейс не строим. |
| Revenue Recovery (advanced) | Хватит Smart Retries defaults. |
| Radar | Объёмы малы; включим при росте. |
| Quotes | Используем CRM. |
| Sigma | Custom analytics через свою аналитику. |
| Terminal / Issuing / Treasury / Climate | Нерелевантно. |

## Возможности Stripe, которые желательно подготовить архитектурно уже сейчас (обязательный раздел)

Даже если они не входят в MVP, резервируем место в модели данных / API-контрактах:

| Возможность | Поддерживается Stripe из коробки | Требует изменений в нашей архитектуре | Нужно ли резервировать место в модели данных |
|---|---|---|---|
| Checkout Session branding | да (Branding settings) | нет (настраивается в Dashboard per account) | нет |
| Customer Portal branding | да | нет | нет |
| Promotion Codes | да | нужен `payment_links.meta.stripe.promo_code` + ветка в create-checkout | да (meta) |
| Coupons | да | `tariff_offers.meta.stripe.coupon_id` | да (meta) |
| Invoices (manual send_invoice) | да | новая ветка в create-flow + status mapping | да (meta + новый тип `orders_v2.kind='stripe_invoice'`) |
| Setup Intent | да | edge `stripe-create-setup-intent` (план в MVP-резерве) | да (meta.stripe.setup_intent_id) |
| Saved Payment Methods | да (на стороне Customer) | snapshot `default_payment_method` в meta | да (snapshot, не SOT) |
| Multiple Payment Methods | да (Checkout `payment_method_types`) | конфиг per `account_code` + per `business_stream` | да (конфиг) |
| Apple Pay | да (auto в Checkout) | требует домен-верификации per account_code | организационно |
| Google Pay | да (auto) | то же | организационно |
| SEPA Direct Debit | да | mandate-flow, новый webhook-набор | да (meta.payment_method_type) |
| BLIK | да | per-country config Checkout | да (meta) |
| Bancontact | да | per-country config | да (meta) |
| iDEAL | да | per-country config | да (meta) |

**Архитектурное обязательство:** в `payment_links` / `orders_v2` / `payments_v2` сохраняем `meta.payment_method_type` и `meta.stripe.promo_code/coupon_id` как опциональные ключи уже на этапе Phase 3 implementation, чтобы Phase 4 включался без миграций.

## SOT / Локально / Stripe / Recovery / Multi-account
- SOT возможностей = Stripe (settings и behavior).
- Локально храним только конфигурацию использования (per `account_code`, per `business_stream`).
- Recovery возможностей = настройка в Stripe Dashboard, наша БД не реплицирует.
- Multi-account: brand/payment_method_types/Apple Pay domains настраиваются per `account_code` независимо.
