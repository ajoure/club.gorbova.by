# Discovery: payment_provider_profiles (профили настроек платёжной кнопки)

Дата: 2026-06-02. Цель — не повторять одни и те же настройки вручную на сотнях тарифов.

## 1. Будущая сущность

| Поле | Тип | Назначение |
|---|---|---|
| `id` | uuid PK | — |
| `code` | text UNIQUE | `stripe_standard_eur`, `stripe_subscription_eur` и т.д. |
| `name` | text | человекочитаемое |
| `provider` | text | `bepaid` | `stripe` |
| `account_code` | text | ссылка на acquiring_account |
| `default_currency` | text | `EUR`, `PLN`, `USD` |
| `payment_method_types` | text[] | `['card','apple_pay','google_pay']` |
| `mode` | text | `payment` | `subscription` | `setup` |
| `tax_behavior` | text | `inclusive` (default) | `exclusive` |
| `locale` | text | `ru`, `en`, `pl` |
| `metadata` | jsonb | свободные поля |
| `is_active` | bool | — |
| `created_at` | timestamptz | — |

## 2. Use-cases

1. **Create profile** — админ задаёт настройки → сохраняется как именованный шаблон.
2. **Clone profile** — копирование с переименованием.
3. **Assign to tariff_offer** — `tariff_offers.meta.profile_code = 'stripe_standard_eur'`.
4. **Override per payment_link** — `payment_links.profile_code` overrides tariff.
5. **Fallback на дефолтный профиль аккаунта** — если не указан нигде.

## 3. Резолвер

```
resolveProfile(tariff, link, account) =
  link.profile_code
  ?? tariff.meta.profile_code
  ?? account.default_profile_code
  ?? throw 'no_profile_resolved'
```

## 4. MVP реализация (без таблицы)

На MVP таблицу НЕ создаём. Вместо неё:

- `tariff_offers.meta.stripe_profile = { currency, payment_method_types, mode, tax_behavior, locale }` — inline.
- Helper `resolveProfile(tariff, link, account)` в `_shared/acquiring/profile-resolver.ts`.
- Дефолтные inline-профили хранятся как const-объекты в коде.

Таблица создаётся в Фазе 3, когда профилей станет 5+ и появится UI управления.

## 5. Шаблоны inline-профилей на старт

⚠️ **Только валюты, подтверждённые для Stripe Poland**. BYN/RUB добавляются после discovery (см. `stripe_currency_support_v1.md`).

| Код | Currency | Mode | PM types | Назначение |
|---|---|---|---|---|
| `stripe_standard_eur` | EUR | payment | card, apple_pay, google_pay | one-time EU |
| `stripe_standard_pln` | PLN | payment | card, blik, p24, apple_pay, google_pay | one-time PL |
| `stripe_standard_usd` | USD | payment | card, apple_pay, google_pay | one-time US |
| `stripe_subscription_eur` | EUR | subscription | card | recurring EU |

После Q discovery валют (Фаза 1 §6 в currency_support):
- если EUR/PLN/USD подтверждены — профили активны;
- BYN/RUB — НЕ создаём профили, для этих валют система автоматически предлагает bePaid.

## 6. Будущие профили (после расширения)

- `stripe_documents_eur` — для платных документов с inv requirement.
- `stripe_club_eur` — для клубных подписок.
- `stripe_consulting_eur` — для консультаций (с capture_method=manual?).

## 7. DoD
- ✅ Поля сущности зафиксированы.
- ✅ Резолвер описан.
- ✅ MVP реализация без таблицы — inline в `tariff_offers.meta`.
- ✅ Только подтверждаемые Stripe Poland валюты в стартовых шаблонах.
