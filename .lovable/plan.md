да, согласен, с учетом правок:

MP-A2-2 можно approve к execute.

&nbsp;

Правки перед execute:

&nbsp;

1. В пункте 2.1 уточнить:

   setup_future_usage ставить не только для recurring продуктов.

   

   Для цели MP-A2-2 нам нужно доказать сохранение карты на one-time пилоте.

   

   Поэтому:

   - для пилотного one-time checkout «Платная консультация» ставить setup_future_usage='off_session';

   - для остальных one-time потоков — только если явно включён флаг save_payment_method;

   - для recurring — по необходимости Stripe сам сохраняет PM в Subscription flow.

&nbsp;

2. Manual branch sandbox-checkout без real user_id может оставаться без resolver.

   Но если в manual форме указан email, не создавать Customer только по email.

   Это должно быть явно зафиксировано:

   - no user_id → no customer resolver;

   - email-only customer creation запрещён.

&nbsp;

3. S9 multi-account:

   временная запись второго account_code должна быть создана только в test environment и удалена после verify.

   В proof показать cleanup:

   - created test connection;

   - used;

   - removed/disabled;

   - no active fake connection remains.

&nbsp;

4. provider_events для customer mismatch:

   если создание provider_events без Stripe event_id технически неудобно, допустимо использовать audit_logs + отдельный proof/manual_review table.

   Но нельзя молча продолжать без видимого статуса.

   Минимум:

   - audit;

   - UI/логическая причина manual_review;

   - proof.

&nbsp;

5. Для email_fallback:

   не использовать Customer без metadata.user_id, если в Stripe найдено больше одного Customer с таким email.

   В этом случае:

   - audit email_ambiguous;

   - create new Customer;

   - не делать backfill metadata чужому/неоднозначному Customer.

&nbsp;

6. В финальный grep добавить:

   ```text

   payment_method_details

   card

   exp_month

   exp_year

Но классифицировать: чтение из Stripe API для proof допустимо, сохранение локально запрещено.

7. В proof не публиковать полные email/имена/секреты.  
Можно маскировать:
  - email: [7500***@gmail.com](mailto:7500***@gmail.com)
  - customer_id/payment_method id можно показывать полностью;
  - card details не показывать.

После этих правок можно запускать MP-A2-2 execute.

Ключевое: для пилота консультаций нужно именно сохранить карту на one-time checkout, иначе MP-A2-2 не докажет свою цель.

&nbsp;

# План: Stripe Phase 3.1 — MP-A2-2 (v3)

**Stripe Customer Resolver + Saved Payment Method**

Режим: plan-mode. Execute только после approve. После принятия MP-A2-2 — сразу Pilot Readiness Review без отдельного approve.

---

## 0. Контекст и инварианты

- **SOT идентичности Customer:** пара `(user_id, account_code)`. Один пользователь = **разные** Stripe Customer в разных аккаунтах. Никогда не сливаем кросс-аккаунт.
- **Email и name НЕ являются ключом идентичности.** Они могут меняться без создания нового Customer.
- **Add-only** хранилище: `profiles.meta.stripe.customers[<account_code>] = { customer_id, created_at, last_synced_at, source }`. Никакой миграции схемы, никаких новых таблиц.
- **bePaid freeze**: ни один файл `bepaid-*`, `_shared/create-payment-checkout.ts`, `bepaid_*` таблицы не трогаем.
- **Test mode only.** Live ключи не вводятся, не используются.
- **Карты локально не хранятся.** Stripe = SOT по PaymentMethod.

---

## 1. Customer Resolver — контракт

Новый shared-модуль `supabase/functions/_shared/acquiring/stripe-customer-resolver.ts`.

Сигнатура:

```ts
resolveStripeCustomer(supabase, stripe, {
  user_id: string,
  account_code: string,
  email: string,
  name?: string,
}): Promise<{
  customer_id: string,
  source: 'profile_cache' | 'stripe_search' | 'email_fallback' | 'created',
  mismatch?: { profile_customer_id: string, stripe_customer_id: string }
}>
```

### Порядок поиска (строго):

1. **profile_cache** — `profiles.meta.stripe.customers[account_code].customer_id`. Если есть → `stripe.customers.retrieve()` для валидации (не deleted). Hit → return.
2. **stripe_search** — `stripe.customers.search({ query: "metadata['user_id']:'<uid>' AND metadata['account_code']:'<code>'" })`. Hit → записать в profile cache (`source: 'stripe_search'`) → return.
3. **email_fallback** — `stripe.customers.list({ email })`. Если найден Customer **без** `metadata.user_id` или с тем же `user_id` → backfill metadata (`user_id`, `account_code`) → записать в profile cache (`source: 'email_fallback'`) → **отдельный audit `stripe_customer_email_fallback_used**` (warning-level) → return.
  - Если найден Customer с **другим** `metadata.user_id` → **не использовать**, перейти к шагу 4 + audit `stripe_customer_email_collision`.
4. **created** — `stripe.customers.create({ email, name, metadata: { user_id, account_code, business_stream? } })` → записать в profile cache (`source: 'created'`) → return.

### Mismatch policy (требование №3)

Если на шаге 2 `stripe_search` вернул `customer_id`, **отличный** от `profiles.meta.stripe.customers[account_code].customer_id`:

- **НЕ перезаписывать автоматически.**
- Audit `stripe_customer_mismatch` с обоими id.
- Запись в `provider_events` с `processing_status='manual_review'` и тегом `reason='stripe_customer_mismatch'`.
- Резолвер возвращает `profile_cache` customer_id (старое поведение, без изменений), вместе с полем `mismatch`.
- Решение о merge — только ручной операцией супер-админа отдельным mini-plan.

### Email/name change (требование №6)

- При hit на шаге 1/2 если `email` или `name` в Stripe отличается от текущего → `stripe.customers.update({ email, name })`. `customer_id` **не меняется**. Audit `stripe_customer_profile_synced` (info-level).

---

## 2. Интеграция в Stripe checkout/webhook

### 2.1 `stripe-create-checkout` / `stripe-admin-sandbox-checkout` (catalog branch)

- Перед созданием `checkout.sessions.create` вызвать `resolveStripeCustomer(...)`.
- Передать `customer: customer_id` в session payload.
- В `payment_intent_data` добавить `setup_future_usage: 'off_session'` (для recurring продуктов — по resolver `tariff_offers.meta.recurring.is_recurring`; для one-time не ставим, чтобы не платить за хранение PM без нужды).
- Manual branch sandbox-checkout — **без resolver** (нет реального user_id), как сейчас.

### 2.2 `stripe-webhook`

- На `checkout.session.completed`: если `session.customer` != `profile_cache[account_code]` → audit `stripe_customer_mismatch_on_webhook` + `manual_review`, **не перезаписывать**.
- Иначе: `mergeStripeCustomerIntoProfile()` обновляет `last_synced_at`.

---

## 3. Хранилище в `profiles.meta.stripe.customers`

Структура (add-only JSON merge, без миграции):

```json
{
  "stripe": {
    "customers": {
      "stripe_poland": {
        "customer_id": "cus_...",
        "created_at": "2026-06-03T...",
        "last_synced_at": "2026-06-03T...",
        "source": "stripe_search"
      },
      "stripe_eu": { "customer_id": "cus_...", ... }
    }
  }
}
```

Helper `mergeStripeCustomerIntoProfile(supabase, user_id, account_code, payload)` — единственная точка записи. Использует `profiles` UPDATE с jsonb merge (`meta = meta || jsonb_build_object(...)`).

---

## 4. Saved Payment Method — гарантии и gap

### Что делаем:

- `customer` присутствует в Checkout Session → Stripe автоматически attach PaymentMethod к Customer после успешной оплаты (при `setup_future_usage`).
- Локально PaymentMethod **не хранится**. Никаких `card_number`, `pan`, `fingerprint`, `last4` колонок не добавляем.
- В UI пользователь видит сохранённые карты **только** через Stripe (Customer Portal или Payment Element в follow-up).

### Известный gap (фиксируется в proof):

- Stripe Checkout `mode=payment` (one-time) **не показывает picker сохранённых карт** автоматически — он только сохраняет новую. Чтобы пользователь мог выбрать сохранённую карту, нужен один из двух follow-up'ов:
  - **Вариант A:** Customer Portal — кнопка «Управлять способами оплаты» в кабинете.
  - **Вариант B:** Перевод checkout-флоу на Payment Element (Embedded) с явным `payment_method_types` + `customer` — позволяет picker.
- Решение по follow-up'у выносим в backlog `.lovable/backlog/stripe_saved_pm_followup.md` (создаётся в proof). MP-A2-2 это **не реализует** — только фиксирует gap.

---

## 5. Verify (runtime, test_mode)

Все сценарии — на `stripe_poland` (single account). Multi-account S9 — на симуляции второго account_code через временную запись в `acquiring_connections` (test-only, удалить после verify).


| #      | Сценарий                                                                                             | Ожидание                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| S1     | Новый user, нет profile cache → create                                                               | `source='created'`, metadata.user_id + account_code в Stripe                                 |
| S2     | Повторная покупка тем же user → profile cache hit                                                    | `source='profile_cache'`, тот же `customer_id`                                               |
| S3     | Чистый profile cache, но Customer существует в Stripe (metadata) → search hit                        | `source='stripe_search'`, cache заполнен                                                     |
| S4     | Email fallback: Customer без metadata.user_id, email совпал                                          | `source='email_fallback'`, audit `email_fallback_used`, metadata backfilled                  |
| S5     | Email collision: Customer с **чужим** user_id в metadata                                             | НЕ использован, audit `email_collision`, создан новый Customer                               |
| S6     | Смена email пользователя → повторная покупка                                                         | `customer_id` тот же, в Stripe email обновлён, audit `profile_synced`                        |
| S7     | Смена name пользователя → повторная покупка                                                          | `customer_id` тот же, name обновлён, audit `profile_synced`                                  |
| S8     | Mismatch: ручная подмена `profile.customer_id` ≠ `stripe.search`                                     | НЕ перезаписан, audit `mismatch`, `provider_events.processing_status='manual_review'`, proof |
| **S9** | **Один user, два account_code (`stripe_poland` + временный `stripe_test_eu`) → два разных Customer** | Два разных `cus_*`, profile.meta.customers содержит обе записи независимо                    |
| S10    | Saved PM: после S1 проверить через Stripe API `paymentMethods.list({ customer, type: 'card' })`      | PM существует, `pm.customer === customer_id` (требование №5)                                 |


### Доказательства для proof

- Реальные `cus_*` и `pm_*` id для каждого сценария.
- Dump Stripe API `customers.retrieve(cus_*)` и `paymentMethods.list({ customer })` (не Dashboard screenshot).
- JSON-фрагмент `profiles.meta.stripe.customers` **до** и **после** каждого ключевого сценария (требование №7) — минимум для S1, S2, S6, S9.
- Audit log entries для S4, S5, S6, S8.

### Финальный grep (требование №8)

В конце MP-A2-2 — `rg -n "card_number|pan|fingerprint|last4"` по `supabase/functions/`, `src/`. Допускаются только:

- Существующие bePaid-related упоминания (не трогаем).
- Возможные UI labels вида «последние 4 цифры» без сохранения значения.

Никаких новых записей карт в БД проекта.

---

## 6. Артефакты


| Файл                                                               | Назначение                                       |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| `supabase/functions/_shared/acquiring/stripe-customer-resolver.ts` | Резолвер + merge helper                          |
| `supabase/functions/stripe-create-checkout/index.ts`               | Edit: вызов resolver, передача `customer`        |
| `supabase/functions/stripe-admin-sandbox-checkout/index.ts`        | Edit: catalog branch использует resolver         |
| `supabase/functions/stripe-webhook/index.ts`                       | Edit: webhook merge + mismatch guard             |
| `.lovable/proofs/mp_a2_2_customer_resolver_v1.md`                  | RU proof, 10 сценариев, до/после JSON, grep, gap |
| `.lovable/backlog/stripe_saved_pm_followup.md`                     | Customer Portal vs Payment Element decision      |


---

## 7. Out of scope

- bePaid (полностью заморожен).
- Live mode.
- Любые миграции схемы / новые таблицы.
- Реальная реализация Customer Portal / Payment Element (только gap в backlog).
- Авто-merge mismatched customer_id.
- Кросс-аккаунт слияние Customer.

---

## 8. DoD MP-A2-2

1. Resolver создан, ключ идентичности = `(user_id, account_code)`.
2. Email — никогда не первичный ключ, только последний шаг + отдельный audit.
3. Mismatch не правится автоматически (audit + manual_review).
4. S9 (multi-account, два Customer для одного user) — PASS.
5. S10 — `PaymentMethod.customer === customer_id` подтверждён через Stripe API.
6. S6/S7 — email/name change не создаёт нового Customer.
7. Proof содержит `profiles.meta.stripe.customers` до/после.
8. Финальный grep `card_number|pan|fingerprint|last4` — чисто.
9. bePaid freeze runtime подтверждён.
10. Phase 2 regression 10/10 — без изменений.

---

## 9. Next step после approve

Execute MP-A2-2 → сразу **Pilot Readiness Review** (без отдельного approve между ними, по решению пользователя) → gate 10/10 → Stage C Runtime Pilot.