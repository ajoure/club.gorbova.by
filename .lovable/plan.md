да, согласен, с учетом правок:

1. **Phase 5 сразу не делать целиком**

План правильный по направлению, но слишком большой для одного execute.

Разделить:

```text
Phase 5-A — Discovery + Contract
Phase 5-B — Offer Settings UI + Backfill
Phase 5-C — Runtime Provider Selection
Phase 5-D — Admin Override
```

Сейчас можно запускать только:

```text
Phase 5-A Discovery
```

---

2. **Не делать миграцию до Discovery**

Бэкфилл `tariff_offers.meta.acquiring` пока не выполнять.

Сначала discovery должен ответить:

- сколько offer’ов;
- сколько имеют `meta.stripe.price_id`;
- сколько имеют `payment_type=installment`;
- какие offer’ы сейчас реально используются;
- есть ли существующие `meta.acquiring`;
- нет ли конфликтов в `meta`.

---

3. **Уточнить структуру** `meta.acquiring`

Добавить в Discovery финальный контракт:

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

Почему добавить `default_provider`:

- если включены оба провайдера, админ должен понимать, какой способ будет выбран по умолчанию;
- admin checkout должен стартовать с default;
- customer choice может быть включён/выключен отдельно.

---

4. **Не использовать** `payment_links.provider = null` **без проверки CHECK**

В плане есть:

```text
payment_links.provider = null или multi
```

Перед этим нужно проверить DB CHECK.

До discovery не утверждать.

Предварительно лучше:

```text
payment_links.provider = 'bepaid' | 'stripe'
payment_links.meta.provider_mode = 'auto' | 'forced'
payment_links.meta.allowed_payment_providers = [...]
```

Но финально — после discovery.

---

5. **Публичный UX: названия доработать**

Для клиента лучше использовать:

```text
Карта белорусского банка
Карта иностранного банка
```

Подписи:

```text
Карта белорусского банка
Для карт банков Республики Беларусь

Карта иностранного банка
Для карт банков Европы, США и других стран
```

Не писать «международная карта», потому что белорусская Visa/Mastercard тоже формально международная карта.

---

6. **Admin UI может показывать бренды**

В админке можно писать:

```text
bePaid
Stripe
```

Но рядом должна быть бизнес-расшифровка:

```text
bePaid — карты банков Беларуси
Stripe — карты иностранных банков
```

---

7. **Admin override должен быть отдельно подтверждён**

Фраза:

```text
override provider не обязан входить в allowed_payment_providers
```

опасная.

Это разрешить можно, но только для `super_admin`.

Для обычного `admin`:

```text
override только среди allowed_payment_providers
```

Для `super_admin`:

```text
override любой активный provider
```

И обязательно audit.

---

8. **Stripe settings должны быть на уровне offer, не продукта**

В рамках этой фазы не добавлять настройки Stripe на продукт/тариф глобально.

Только:

```text
tariff_offers.meta.acquiring.stripe
```

Product/Tariff defaults — future phase.

---

9. **Добавить install­ment guard**

Если offer = рассрочка:

```text
Stripe disabled
```

UI:

```text
Stripe пока не поддерживает рассрочку
```

Backend:

```text
400 stripe_installment_not_supported
```

---

10. **DoD Phase 5-A**

Discovery должен вернуть:

```text
1. Текущая карта tariff_offers.
2. Контракт meta.acquiring.
3. Матрица provider selection.
4. Где будет UI в существующей вкладке "Оплата".
5. Какие DB CHECK есть у payment_links.provider.
6. Безопасный план backfill.
7. Runtime gates для 5-B/5-C/5-D.
```

После этого — отдельный approve на реализацию.

&nbsp;

План: Phase 5 — Product Acquiring Settings & Provider Selection

## Цель

Перенести управление эквайрингом (bePaid / Stripe) с уровня ручных meta-полей на уровень UI кнопки оплаты (Offer). Поддержать мульти-provider режим, пользовательский выбор «Белорусская / Международная карта» и админский override. bePaid, Stripe, grant-access, webhook, lifecycle — НЕ трогаем.

## Принципы (жёстко)

- Никаких новых webhook, никаких изменений в grant-access-for-order, stripe-webhook, bepaid-webhook, subscriptions-reconcile, Telegram lifecycle.
- Никаких новых providers сверх bepaid+stripe.
- Пользователь НЕ видит слов «bePaid» / «Stripe» — только «Белорусская карта» / «Международная карта».
- SOT эквайринга кнопки = `tariff_offers.meta.acquiring` (расширение существующего meta, без новых таблиц).

---

## Этап 5.0 — Discovery (read-only)

Артефакт: `.lovable/discovery/product_acquiring_settings_inventory_v1.md`

Зафиксировать:

- Структура `products_v2`, `tariffs`, `tariff_offers`, `payment_links`, `acquiring_connections`.
- Все точки чтения `meta.stripe.price_id`, `meta.stripe.product_id`, `provider`, `account_code`, `currency` (rg по фронту и edge functions).
- Текущие call-sites: `public-checkout`, `admin-create-public-link`, `createPaymentCheckout`, `stripe-subscription-resolver`, `CreatePublicLinkDialog`, форма редактирования Offer (вкладка «Оплата»).
- Карта «Продукт → Тариф → Offer → (Stripe Price | bePaid)».

DoD: список call-sites + контракт нового `meta.acquiring`.

---

## Этап 5.1 — Offer Acquiring Settings (UI вкладки «Оплата»)

Без новой вкладки. Дописываем в существующую `Кнопка оплаты → Редактировать → Оплата`.

Под блоком «Способ оплаты (100% / Рассрочка)» добавить:

**Доступные способы приёма оплаты**

- ☑ Белорусские карты (bePaid)
- ☑ Международные карты (Stripe)

Хранение:

```json
tariff_offers.meta.acquiring = {
  "allowed_payment_providers": ["bepaid", "stripe"],
  "stripe": {
    "account_code": "...",
    "product_id": "prod_...",
    "price_id": "price_...",
    "currency": "EUR",
    "mode": "test" | "live"
  }
}
```

PATCH 5.1-A: блок «Настройки Stripe» (account / product_id / price_id / валюта / test|live) показывается только если включён чекбокс «Международные карты». Подтягивается список Stripe accounts из `acquiring_connections`.

Валидация на save:

- `allowed_payment_providers.length >= 1` (нельзя выключить оба).
- Если включён `stripe` → `stripe.price_id` обязателен.
- bePaid не требует доп. полей (используется существующая глобальная конфигурация).

---

## Этап 5.2 — Provider Policy (без отдельного поля)

Политика выводится из длины массива `allowed_payment_providers` — отдельный `provider_policy` НЕ заводим:

- length=1 → жёсткий provider, без выбора.
- length>1 → пользовательский выбор на фронте.

---

## Этап 5.3 — Frontend Checkout Selection (`/pay/:token` и PaymentDialog)

Новый shared helper `resolveOfferProviders(offer)` → `{ providers, requiresUserChoice }`.

UI:

- `providers.length === 1` → редирект/инициализация checkout соответствующего provider без UI выбора.
- `providers.length > 1` → экран «Выберите карту для оплаты»:
  - ○ Белорусская банковская карта — Visa / Mastercard банков Беларуси
  - ○ Международная банковская карта — Visa / Mastercard банков Европы, США и других стран
- Слова «bePaid» / «Stripe» на фронте запрещены (вводим линтер-rg в CI как backlog).

Поведение в `public-checkout`: принимает опциональный `provider_choice` (`bepaid|stripe`), валидирует, что он входит в `allowed_payment_providers` offer’а, иначе 400.

---

## Этап 5.4 — Admin Checkout Override

В админской форме создания оплаты:

Блок «Способ оплаты»:

- ○ По настройке кнопки (default, подпись: «Белорусская карта» / «Международная карта»)
- ○ Белорусская карта (bePaid)
- ○ Международная карта (Stripe)

Условия:

- Override доступен только `admin` / `super_admin` (через `useRbac`).
- При override провайдер не обязан входить в `allowed_payment_providers` offer’а — это легитимный admin-bypass; пишем `audit_logs.admin_provider_override` с `{ offer_id, offer_providers, chosen_provider, actor_id }`.
- Если выбран Stripe, но в offer нет `stripe.price_id` → блокируем с понятной ошибкой (нечем оплатить).

---

## Этап 5.5 — Public Links (`CreatePublicLinkDialog` + `admin-create-public-link`)

Заменить ручной select провайдера на:

**Провайдер ссылки**

- ○ Авто из настроек кнопки (default)
- ○ Принудительно: Белорусская карта (bePaid) — только admin
- ○ Принудительно: Международная карта (Stripe) — только admin

Логика:

- `auto` + offer single-provider → `payment_links.provider` фиксируется в этот provider.
- `auto` + offer multi-provider → `payment_links.provider = null` (или `multi`), резолв при клике через `resolveOfferProviders`.
- Override доступен только admin; при попытке Stripe без `stripe.price_id` → 400.

`payment_links_enriched_v` дополняется полем «эффективные провайдеры» для админского журнала.

---

## Этап 5.6 — Runtime Gates


| Gate | Сценарий                                                 | Expected                      |
| ---- | -------------------------------------------------------- | ----------------------------- |
| G81  | offer=[bepaid], `/pay/:token`                            | сразу bePaid checkout         |
| G82  | offer=[stripe], `/pay/:token`                            | сразу Stripe checkout         |
| G83  | offer=[bepaid,stripe], `/pay/:token`                     | экран выбора карты            |
| G84  | admin checkout, offer=[bepaid], override=stripe          | Stripe сессия, audit override |
| G85  | admin checkout, offer=[stripe], override=bepaid          | bePaid сессия, audit override |
| G86  | public link auto + offer multi                           | пользователь видит выбор      |
| G87  | webhook parity (bepaid-webhook, stripe-webhook diff = 0) | PASS                          |


Proof: `.lovable/proofs/phase_5_offer_acquiring_v1.md`.

---

## Технические детали

**Миграция:** только бэкфилл `tariff_offers.meta.acquiring.allowed_payment_providers` из текущего состояния:

- если есть `meta.stripe.price_id` → `["bepaid","stripe"]` (или `["stripe"]` если bePaid отключён глобально).
- иначе → `["bepaid"]`.
Идемпотентно, audit `phase5_acquiring_backfill_v1`. Никаких новых таблиц.

**Shared helper:** `src/utils/resolveOfferProviders.ts` + зеркало `supabase/functions/_shared/resolve-offer-providers.ts`. Единственный SOT интерпретации `meta.acquiring`.

**Edge functions затрагиваемые (только read + branch, без новых writer’ов):**

- `public-checkout` — принимает `provider_choice`, валидирует.
- `admin-create-public-link` — провайдер из auto/override.
- `createPaymentCheckout` (admin path) — override branch.

**Запрещено в Phase 5:**

- любые правки `grant-access-for-order`, `bepaid-webhook`, `stripe-webhook`, `stripe-subscription-resolver` (consume path), `subscriptions-reconcile`, Telegram lifecycle.
- новые таблицы, новые providers, новые webhook.

## Definition of Done

- Вкладка «Оплата» offer’а содержит блок «Доступные способы приёма оплаты» + условный блок Stripe.
- Bэкфилл `meta.acquiring` выполнен.
- `/pay/:token` и PaymentDialog показывают выбор «Белорусская/Международная карта» при multi-provider.
- Слова bePaid/Stripe не показываются конечному пользователю.
- Admin override работает с audit.
- Public Link: auto / forced bepaid / forced stripe (последние два — admin only).
- G81–G87 = PASS, proof-файл создан.
- bePaid и Stripe webhook diff = 0.