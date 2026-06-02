# Open questions перед началом Фазы 1 / Фазы 2

Дата: 2026-06-02. Ответы нужны от пользователя до старта реализации.

## БЛОКЕРЫ (без ответа не стартуем Фазу 2)

### Q1. Валюта Stripe-аккаунта
- В какой стране зарегистрирован Stripe-аккаунт пользователя?
- Какие валюты settlement доступны (USD / EUR / GBP / PLN / BYN)?
- Какая валюта будет presentment (что видит плательщик)?
- Нужен ли Adaptive Pricing (Stripe конвертирует BYN → settlement-валюту автоматически, +2% к комиссии)?

**Почему блокер:** от ответа зависит схема `provider_product_mappings.currency`, валюта в Checkout Session, и UX (показывать ли курс на странице оплаты).

### Q2. Какие продукты подключаем к Stripe в первую очередь
- Все продукты сразу или подмножество (например, только для иностранных клиентов / только новые)?
- Будут ли продукты, доступные ТОЛЬКО через Stripe (без bePaid-аналога)?
- Будут ли продукты доступные ОБОИМ провайдерам (тогда нужен `provider_mode='customer_choice'` на public link — Фаза 3)?

**Почему блокер:** определяет объём `provider_product_mappings` для бэкфилла и UI селектора в админке.

## ВАЖНЫЕ (нужны до Фазы 1.4 — UI)

### Q3. Как админ выбирает провайдер при создании ссылки
Варианты:
- **A.** Всегда выбирает явно (selector в `CreatePublicLinkDialog`, default bePaid).
- **B.** Определяется по продукту (если у продукта есть Stripe-mapping → Stripe, иначе bePaid).
- **C.** Гибрид: default по продукту, но можно переопределить.

**Рекомендация плана:** A (явный выбор, default bePaid) — минимум магии.

### Q4. customer_choice mode на /pay/:token
- В MVP давать плательщику выбор bePaid/Stripe?
- Или MVP = только `fixed` (один провайдер на ссылку)?

**Рекомендация плана:** MVP = только `fixed`. `customer_choice` готовим как future-compatible (колонка `provider_mode`), но UI = Фаза 3+.

### Q5. Recurring через Stripe — MVP или Фаза 3?
- Подписки через Stripe в Фазе 2 (риск: больше webhook-логики)?
- Или MVP = one-time + refund + public link, recurring отдельным спринтом?

**Рекомендация плана:** включить в Фазу 2 минимальный recurring (`mode=subscription` + `invoice.paid` webhook), без installment schedule. Installment + dunning = Фаза 3.

## КОНФИГУРАЦИОННЫЕ (нужны до Фазы 2.2 — secrets)

### Q6. Stripe Tax
- Включаем `automatic_tax=true` сразу или оставляем `false` (текущая bePaid-логика inclusive)?
- Есть ли Tax Registrations в Stripe Dashboard?

**Рекомендация плана:** в MVP `automatic_tax=false`, `tax_behavior=inclusive` (паритет с bePaid). Включение — отдельный спринт.

### Q7. Где хранить Stripe `customer_id`
- Новая колонка `provider_subscriptions.provider_customer_id`?
- Или `meta.stripe_customer_id`?
- Или новая таблица `provider_customers (user_id, provider, customer_id)`?

**Рекомендация плана:** новая колонка `provider_customers (id, profile_id, provider, provider_customer_id, default_payment_method_id, meta, created_at, updated_at)` — провайдер-agnostic, переиспользуется для будущих провайдеров.

## ФИСКАЛЬНЫЕ / ЛЕГАЛ (вне MVP — фиксируем как backlog)

### Q8. ЭСЧФ / чеки для Stripe-оплат
- Что делаем с ЭСЧФ для оплат через Stripe? Варианты:
  - Не выдаём (Stripe-оплаты = иностранные клиенты, без ЭСЧФ).
  - Подключаем сторонний фискалайзер (Atol, Modulkassa, MTBank API и т.п.).
  - bePaid выписывает ЭСЧФ pro-forma за Stripe-оплату (юридически спорно).

**Рекомендация плана:** в MVP — НЕ выдаём; явное предупреждение в `purchaseDocumentRules` для provider='stripe'. Решение по фискализации — отдельный legal-спринт.

### Q9. Customer Portal в MVP
- Нужен ли Stripe Billing Portal (отмена подписки, смена карты) в Фазе 2?
- Или MVP = только админ-UI отмены через `stripe-cancel-subscription`?

**Рекомендация плана:** MVP = только админ-action. Portal = BACKLOG.

## SAFETY-NET (фиксируем как требования)

### S1. Идемпотентность webhook
- Каждый Stripe-event обрабатывается ровно один раз.
- Дубли delivery → `provider_events.processing_status='duplicate'`, без побочных эффектов.

### S2. Live vs Sandbox
- Сначала всё работает в **test mode** (`sk_test_*`).
- Переключение на live — отдельная кнопка в `/admin/integrations/acquiring` после proof файла `.lovable/proofs/stripe_sandbox_payment_v1.md`.

### S3. Rollback plan
- Если что-то пошло не так — отключаем Stripe-интеграцию в админке (флаг `is_active=false` на `integration_instances`), новые ссылки/checkout не создаются, старые висят как есть.
- bePaid НЕ затрагивается ни при каких сценариях.

---

## Status

| ID | Status | Owner | Deadline |
|---|---|---|---|
| Q1 | ⏳ awaiting user | user | до Фазы 2 |
| Q2 | ⏳ awaiting user | user | до Фазы 2 |
| Q3 | 💡 plan default = A | user (confirm) | до Фазы 1.4 |
| Q4 | 💡 plan default = fixed-only MVP | user (confirm) | до Фазы 1.4 |
| Q5 | 💡 plan default = recurring в Фазе 2 | user (confirm) | до Фазы 2 |
| Q6 | 💡 plan default = automatic_tax=false | user (confirm) | до Фазы 2.2 |
| Q7 | 💡 plan = новая `provider_customers` | user (confirm) | до Фазы 2.2 |
| Q8 | 🔒 BACKLOG (legal) | — | — |
| Q9 | 🔒 BACKLOG (Customer Portal) | — | — |
