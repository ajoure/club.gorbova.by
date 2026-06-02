# Discovery: матрица настроек Stripe в нашей админке

Дата: 2026-06-02. Цель — администратор максимально редко заходит в Stripe Dashboard. Карта описывает, что настраивается у нас и что улетает в Stripe API.

## 1. Глобальные настройки интеграции
Локация: `/admin/integrations/acquiring` (новая страница, Фаза 1).

| Настройка | У нас | Уходит в Stripe |
|---|---|---|
| Аккаунт (`account_code`) | селектор + ключи | — |
| Secret Key / Publishable Key | поле в форме → Cloud secret | — (только для нашего API вызова) |
| Webhook URL | копируется из UI | вставляется в Stripe Dashboard вручную (one-time) |
| Webhook secret | поле в форме → Cloud secret | — |
| Whitelist валют | multiselect | — (фильтр на нашей стороне) |
| Дефолтные payment_method_types | multiselect (`card`, `apple_pay`, `google_pay`, `blik`, `p24`, `sepa_debit`) | в каждый Checkout Session |
| Дефолтный профиль настроек | селектор | — |

## 2. Настройки продукта
Локация: `AdminProductsDocs` → вкладка «Эквайринг» (новая, Фаза 2).

| Настройка | У нас | Уходит в Stripe |
|---|---|---|
| Mapping → Stripe Product | кнопка «Создать в Stripe» | `POST /v1/products` |
| product.metadata.business_stream | автоматически | metadata |
| product.metadata.account_code override | опционально | metadata |
| Tax code (Backlog) | селектор `txcd_*` | `product.tax_code` |

## 3. Настройки тарифа
Локация: `tariff_offers` editor → вкладка «Эквайринг» (Фаза 2).

| Настройка | У нас | Уходит в Stripe |
|---|---|---|
| Mapping → Stripe Price | кнопка «Создать Price» | `POST /v1/prices` |
| recurring interval | селектор | `price.recurring.interval` |
| recurring interval_count | input | `price.recurring.interval_count` |
| tax_behavior | селектор (default inclusive) | `price.tax_behavior` |
| Валюта | селектор из whitelist аккаунта | `price.currency` |
| profile_code (override продукта) | селектор | — (применяется на checkout) |

## 4. Настройки платёжной кнопки / ссылки
Локация: `CreatePublicLinkDialog` (Фаза 1) + Pricing block в Site Builder.

| Настройка | У нас | Уходит в Stripe |
|---|---|---|
| Провайдер | select (bepaid|stripe, default из продукта) | — |
| `account_code` | select (на MVP single-value) | — |
| Валюта | селектор | `currency` в Checkout Session |
| payment_method_types | multiselect (наследуется из профиля) | `payment_method_types[]` |
| Профиль настроек | селектор | — |

## 5. Настройки подписки
Локация: AdminSubscriptionsV2 → действия (Phase 2).

| Настройка | У нас | Уходит в Stripe |
|---|---|---|
| Trial period (Backlog) | input | `subscription.trial_period_days` |
| Recurring (читается из tariff) | readonly | — |
| Finite cycles (installment) | кнопка | `subscription_schedule.phases[].iterations` |
| Pause | кнопка | `subscription.pause_collection` |
| Resume | кнопка | `subscription.pause_collection=null` |

## 6. Настройки документов

| Настройка | У нас | Уходит в Stripe |
|---|---|---|
| Receipt email (default on) | toggle на аккаунте | Dashboard auto |
| Invoice (per-tariff opt-in, Phase 2) | toggle | `POST /v1/invoices` |
| ЭСЧФ | **bePaid-only** | — |

## 7. Что НЕЛЬЗЯ настраивать из нашей админки (только Stripe Dashboard)

Эти зоны принципиально остаются в Stripe Dashboard. Не тянуть их в нашу систему:

- **Payouts / Payout schedule** — банковские выплаты на расчётный счёт.
- **Банковские счета** (Bank accounts) — добавление/удаление счёта для payouts.
- **KYC / Verification / Identity** — верификация бизнеса.
- **Ownership / Representatives / Directors** — данные владельцев/руководства.
- **Business profile** — название, MCC, URL бизнеса.
- **Tax Registrations** — регистрация для Stripe Tax (Backlog).
- **Account settings** — общие настройки аккаунта (branding, public details, statement descriptor).
- **Team members / Roles** — управление сотрудниками Stripe.
- **Connected accounts / Stripe Connect** — мульти-merchant архитектура.
- **Fraud rules / Radar custom rules** — кастомные правила Radar.
- **Disputes evidence submission** — загрузка доказательств по спорам (на старте).
- **Compliance documents** — соглашения, terms of service.

**Почему**: эти зоны требуют идентификации, юридической ответственности и аудит-следов на стороне Stripe. Дублирование в нашей админке создаёт фантомное состояние и риск рассинхрона.

## 8. DoD
- ✅ Все 6 разделов покрыты.
- ✅ Раздел «нельзя из нашей админки» зафиксирован — для предотвращения скоупа «затащить весь Dashboard внутрь».
- ✅ Указано, где настройка живёт у нас и что улетает в Stripe.
