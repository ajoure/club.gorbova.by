# да, согласен, с учетом правок:

1. **Не использовать test clock как основной путь**

Для runtime G33–G40 основной путь:

```text
Hosted Checkout / Portal / Stripe Dashboard retry
```

`test clock` — только fallback, если Dashboard retry недоступен. Иначе можно получить сценарий, который отличается от реального lifecycle.

2. **Portal link для клиента в админке**

Кнопку «Создать Portal link для клиента» делать только если это уже безопасно поддержано текущей функцией.

Если `stripe-create-customer-portal-session` строго проверяет `subscription.user_id = auth.uid()`, то админ не сможет создать portal link от имени клиента. Тогда:

```text
не обходить ownership guard
```

а вынести admin-generated portal link в backlog / отдельный PATCH.

3. **Notification не должен блокировать webhook**

Если `send-transactional-email` падает:

```text
invoice.payment_failed webhook всё равно processed
```

Email failure пишется в audit/manual_review, но не переводит provider_event в failed.

4. **G37 уточнить**

При recovery через `invoice.paid`:

- если это уже существующий invoice после failed, order/payment/grant должны создаться один раз;
- если order уже был создан ранее — повторно не создавать;
- proof должен показать idempotency по `invoice_id`.

5. **G34 уточнить**

Если email отправляется через `send-transactional-email`, proof должен показать:

- `idempotencyKey`;
- отсутствие дубля при replay;
- что текст письма содержит ссылку только на Stripe Portal, а не на свою форму карты.

6. **H Final Failure**

Оставить только audit/manual_review.

Не менять status в `canceled/unpaid` вручную, если это не пришло из Stripe webhook status. Source of Truth — Stripe webhook.

После этих правок план можно запускать.

Уточнение к Phase 3.4.

Никаких англоязычных технических названий в UI быть не должно.

Термины Portal Link, Customer Portal, Dunning, Smart Retry, Recovery, Failed Payment, Past Due, Retry Payment допустимы только в коде, логах, proof и audit action.

В клиентском и админском UI все названия должны быть на русском языке и понятны пользователю.

Использовать такие UI-названия:

Клиентский UI:

- Управлять подпиской

- Обновить карту

- Обновить карту для оплаты

- Платёж не прошёл

- Доступ пока сохранён

- Следующая попытка оплаты

- Подписка активна

- Подписка отменяется в конце периода

- Подписка восстановлена

Админский UI:

- Проблема с оплатой

- Ожидает повторной оплаты

- Подписка требует внимания

- Открыть подписку

- Открыть управление подпиской

- Отправить клиенту письмо для обновления карты

- Повторная оплата прошла

- Оплата восстановлена

Перед дальнейшей реализацией Phase 3.4 сделать UI language sweep по уже созданным Stripe-разделам:

- админка подписок;

- клиентский кабинет подписки;

- кнопки управления Stripe;

- Customer Portal CTA;

- cancel/cancel_now/cancel_at_period_end UI;

- past_due/recovery/dunning UI;

- email-шаблоны;

- toast-сообщения;

- empty states;

- error messages.

DoD:

- все видимые пользователю строки на русском языке;

- никаких Portal Link / Customer Portal / Dunning / Recovery / Past Due в UI;

- proof содержит список найденных и исправленных строк;

- если строка остаётся на английском, объяснить почему и где она находится.

&nbsp;

&nbsp;

План: Phase 3.4 — Stripe Dunning + Smart Retries + Failed Payment Recovery

## Контекст

Phase 3.3 = FULL PASS. Customer Portal работает, `invoice.payment_failed` уже маркирует подписку `past_due`, доступ не отзывается. Сейчас не хватает управляемого recovery-контура: фиксации failure-снапшота, нотификации клиенту, recovery CTA в Portal, админской видимости past_due и корректного выхода через `invoice.paid`.

## Жёсткие правила

- Только русский язык, add-only.
- bePaid не трогаем (`bepaid-*`, статусы, синки).
- `grant-access-for-order` не меняем.
- `stripe-webhook` расширяем add-only, без переписывания.
- Доступ (`entitlements`, `access_rules`, `telegram_access`) напрямую не трогаем.
- Никакого raw card data, своих форм карт, ручных списаний.
- Никаких helper edge functions для триггера событий (PCI §10.3).
- Только Stripe test mode, Smart Retries — настройка в Stripe, не дублируем.
- Никаких новых таблиц без отдельного approve.

## Этапы (Diagnose → Plan → Dry run → Execute → Verify)

### A. Discovery (read-only)

Зафиксировать в `.lovable/discovery/stripe_dunning_inventory_v1.md`:

- текущие ветки `invoice.payment_failed` и `invoice.paid` в `stripe-webhook` и `_shared/stripe-subscription-resolver.ts`;
- где и как сейчас выставляется `subscriptions_v2.status='past_due'` и `provider_subscriptions.state`;
- текущая форма `subscriptions_v2.meta.stripe` и `provider_subscriptions.meta.stripe`;
- существующая email/notification инфраструктура (`send-transactional-email`, шаблоны, очередь, suppression);
- админский UI подписок (фильтры, бейджи, страница деталей);
- наличие/отсутствие CRM stage-механики для failed payment;
- зафиксировать, какие audit-actions уже используются для Stripe portal/subscription.

**DoD:** discovery-файл создан, код не менялся.

### B. Failed Payment State (add-only в резолвере)

В `_shared/stripe-subscription-resolver.ts` расширить обработчик `invoice.payment_failed`:

- merge в `subscriptions_v2.meta.stripe` и `provider_subscriptions.meta.stripe`:
  ```
  last_payment_failed_at, last_failed_invoice_id,
  last_failed_payment_intent_id, last_failure_reason,
  attempt_count, next_payment_attempt,
  dunning_status: "past_due_grace"
  ```
- `subscriptions_v2.status='past_due'`, `provider_subscriptions.state='past_due'` (как сейчас);
- НЕ создаём `orders_v2`, `payments_v2`, не вызываем `grant-access-for-order`, не трогаем entitlements/rules/telegram;
- audit: `stripe.dunning.payment_failed` с `invoice_id`, `attempt_count`, `reason`.

### C. Customer Recovery Link

- Использовать существующий `stripe-create-customer-portal-session` без изменений API.
- В кабинете пользователя (`SubscriptionDetailSheet` / Purchases) для подписки в `past_due` показать CTA «Обновить карту через Stripe Portal», открывающий существующий portal-flow.
- Никакого нового card UI, никакого SetupIntent на нашей стороне.

### D. Notification (один раз на invoice)

- Если `send-transactional-email` готов и есть email домен — создать app-template `stripe-payment-failed` (React Email, бренд-стиль), отправлять при первом `invoice.payment_failed` per `invoice_id` через `supabase.functions.invoke('send-transactional-email', { idempotencyKey: 'stripe-dunning-<invoice_id>' })`.
- Тело: «Платёж по подписке не прошёл. Доступ пока сохранён. Обновите карту в Stripe Portal.» + CTA на Portal + `next_payment_attempt`, если есть.
- Если email-инфраструктура не готова — audit-only `stripe.dunning.notification_skipped_no_email` + backlog-запись; не падать.
- Cooldown: `idempotencyKey` на `invoice_id` + `template_name` гарантирует отсутствие дублей при replay.

### E. Admin UI: Past Due Subscriptions (read-only расширение)

- В существующем админ-списке подписок добавить фильтр/бейдж «Stripe past_due» (по `provider='stripe'` + `subscriptions_v2.status='past_due'`).
- В строке/деталях показать: клиент, продукт, тариф, сумма, валюта, `invoice_id`, `attempt_count`, `next_payment_attempt`, `last_failure_reason`.
- Кнопки: «Открыть подписку» (существующий sheet), «Создать Portal link для клиента» (вызов существующего `stripe-create-customer-portal-session` от имени клиента, с audit).
- Никакого ручного списания, никакого нового write-path.

### F. Successful Recovery (`invoice.paid` после failed)

В существующей ветке `invoice.paid` (add-only):

- если `meta.stripe.dunning_status` ∈ {`past_due_grace`}, после успешной материализации заказа через канонический `grant-access-for-order`:
  - `subscriptions_v2.status='active'`, `provider_subscriptions.state='active'`;
  - merge `meta.stripe`: `dunning_status='recovered'`, `recovered_at`, `recovered_invoice_id`, очистить `last_failure_reason`/`attempt_count` (snapshot в `meta.stripe.previous_failure`);
  - audit `stripe.dunning.recovered`.
- Идемпотентность по `provider_events_idem_unique` (event_id) — никаких дублей order/payment/grant.

### G. Repeated Failure

- Повторный `invoice.payment_failed` по тому же `invoice_id` или новой попытке: инкремент `attempt_count`, обновление `next_payment_attempt`, audit `stripe.dunning.retry_failed`.
- Уведомление НЕ дублируется (cooldown по `idempotencyKey=stripe-dunning-<invoice_id>`).

### H. Final Failure / Unpaid / Canceled

- При `customer.subscription.updated` со `status ∈ {unpaid, canceled}` после dunning:
  - merge `meta.stripe.dunning_status='final_failure'` / `canceled_after_dunning`;
  - audit `stripe.dunning.final_failure` / `stripe.dunning.canceled_after_dunning`;
  - доступ НЕ отзываем — revoke policy вынесен в отдельный Phase 3.5;
  - запись `manual_review` HTTP 200.

## Runtime Proof G33–G40 (Stripe test mode)

Все гейты прогоняются на тестовой подписке в `stripe_poland`. В Stripe Dashboard симулируем failed retry через test clock или `4000000000000341` (failed on auth), затем recovery через смену PM на `4242` и `Retry payment`.

- **G33** `invoice.payment_failed` → `subscriptions_v2.status=past_due`, `provider_subscriptions.state=past_due`, `meta.stripe.last_failed_invoice_id/attempt_count/next_payment_attempt/dunning_status='past_due_grace'`, Δ=0 по entitlements/rules/telegram.
- **G34** Уведомление: запись в `email_send_log` с `template='stripe-payment-failed'` или audit `stripe.dunning.notification_skipped_no_email`; replay того же event_id → дубля нет.
- **G35** Customer Portal recovery link создаётся (`bps_*`), ведёт в Stripe Portal; no raw card data в логах.
- **G36** Подписка видна в админ-фильтре «Stripe past_due» с корректными полями.
- **G37** После `invoice.paid` → `status='active'`, `dunning_status='recovered'`, один `orders_v2`/`payments_v2`, entitlements продлены через канонический grant.
- **G38** Replay G33 и G37 событий через Stripe Dashboard → `provider_events` reuse (idem unique), без дублей order/payment/notification.
- **G39** На всём окне past_due: Δ=0 по `entitlements`, `access_rules`, `telegram_access`; revoke не вызывался.
- **G40** bePaid: `bepaid_*`, bePaid subscriptions/orders/payments — Δ=0; функции `bepaid-*` не редактировались.

## Stop-gates

Останавливаемся и логируем `manual_review` HTTP 200, если: provider ≠ stripe; нет `subscription_v2_id`/`customer_id`/`invoice_id`; signature invalid; Stripe API error; попытка править bePaid/access/Telegram напрямую; попытка card UI или raw card data.

## Файлы (ожидаемые изменения)

- `supabase/functions/_shared/stripe-subscription-resolver.ts` (add-only ветки failure/recovery snapshot)
- `supabase/functions/stripe-webhook/index.ts` (add-only маршрутизация audit/notification, без переписывания)
- `supabase/functions/_shared/transactional-email-templates/stripe-payment-failed.tsx` + регистрация в `registry.ts` (если email готов)
- Админ UI подписок: фильтр/бейдж past_due + кнопка Portal link (frontend only)
- Кабинет подписки: recovery CTA в `SubscriptionDetailSheet` (frontend only)
- `.lovable/discovery/stripe_dunning_inventory_v1.md`
- `.lovable/proofs/stripe_phase_3_4_dunning_recovery_v1.md`
- `.lovable/plan.md` (отметка Phase 3.4 = FULL PASS после прогона)

Новых таблиц не создаём.

## DoD

Phase 3.4 = FULL PASS только если G33–G40 = PASS, failure snapshot материализован, клиент имеет recovery-путь через существующий Stripe Portal, админ видит past_due, успешный retry возвращает `active` + `dunning_status='recovered'`, replay/идемпотентность подтверждены, Δ=0 по доступу и bePaid в течение grace, PCI guard соблюдён, proof содержит SQL before/after, `event_id`, `invoice_id`, `subscription_id`, audit rows.

## Что НЕ делаем

Авто-revoke после failed; своя форма карты; ручное списание; пересоздание Portal; pause/resume; Subscription Schedule; installments; миграция bePaid→Stripe; live mode; изменения bePaid/access/Telegram revoke.