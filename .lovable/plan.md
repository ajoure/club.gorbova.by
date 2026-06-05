# да, согласен, с учетом правок:

1. **Усилить G25 (PCI sweep)**

Недостаточно только:

```bash
rg -n "card_number|\"number\"\s*:|exp_month|exp_year|cvc"
```

Добавить поиск по:

```bash
rg -n "payment_methods.create"
rg -n "tokens.create"
rg -n "confirmCard"
rg -n "card:"
rg -n "number:"
rg -n "payment_method_data"
rg -n "pm_card_"
```

Цель — убедиться, что нигде не остался скрытый путь создания карт сервером.

---

2. **PCI-gate сделать не только на zod**

Сейчас указан только входной reject.

Добавить DoD:

- code-review всех Stripe-вызовов;
- ни один вызов Stripe SDK не содержит:

```ts
card: { ... }
```

или

```ts
payment_method_data.card
```

или

```ts
payment_method_types + card payload
```

на стороне сервера.

То есть проверяем не только вход, но и исходящие вызовы.

---

3. **Добавить SYSTEM ACTOR proof**

Для действий:

```text
cancel_at_period_end
cancel_now
```

обязательно подтвердить:

```text
audit_logs.actor_type='system'
actor_user_id IS NULL
actor_label заполнен
```

если действие инициировано webhook либо системным процессом.

&nbsp;

Для admin-action:

```text
actor_type='user'
```

Доказательство включить в G20/G22.

---

4. **Уточнить cancel_now**

Сейчас есть риск двойной записи:

```text
admin action
→ canceled

subscription.deleted
→ canceled
```

Добавить явно:

```text
customer.subscription.deleted
должен быть idempotent
```

Если статус уже:

```text
canceled
```

то только audit/update meta.

Без повторной бизнес-логики.

---

5. **Усилить G22**

Добавить отдельную проверку:


| **Проверка**        | **Ожидание** |
| ------------------- | ------------ |
| Telegram membership | не изменён   |
| access_rules        | Δ=0          |
| entitlements rows   | Δ=0          |


Сейчас это подразумевается, но лучше сделать явным proof.

---

6. **PCI remediation**

Добавить отдельный пункт:

```text
Подтвердить, что в git diff / deployed files
отсутствуют любые новые helper-функции,
принимающие payment_method, card_data,
PAN или test-card параметры напрямую.
```

Это закрывает риск повторения `stage25-g15-trigger` под другим именем.

---

7. **Следующий этап заранее зафиксировать в backlog**

После закрытия Phase 3.2 сохранить как следующий блок:

```text
Phase 3.3
Stripe Customer Portal + Self-Service Cancellation
```

Но не реализовывать в текущем спринте.

---

После этих дополнений план выглядит готовым к реализации и соответствует мастер-спринту без выхода за scope.

&nbsp;

План: Phase 3.2 — Stripe Subscription Actions MVP (v2, с учётом Stripe PCI warning)

## Контекст обновления

Stripe прислал письмо (req_SR4WPqmV1IYvAc): на нашем test-аккаунте зафиксирована передача полного номера карты в API. Источник — одноразовый helper `stage25-g15-trigger` из G15-прогона, который вызывал `payment_intents/{id}/confirm` с raw PAN вместо `pm_card_*` test token. Функция уже удалена, но факт остался в Stripe Radar/compliance журнале.

Этот план дополняет Phase 3.2 жёстким PCI-гейтом, чтобы исключить повторение, и фиксирует remediation по уже произошедшему инциденту.

## Цель Phase 3.2 (без изменений)

Cancel at period end + immediate cancel + sync + admin UI + audit + bePaid non-regression.
НЕ входит: pause/resume/schedules/installments/Customer Portal/dunning/migration/live mode.

## Жёсткие правила (дополнено)

Прежние правила сохраняются + добавляются:

- **PCI-гейт (новое, критично):** запрещено передавать в Stripe API любые «сырые» данные карт — PAN, CVC, exp — даже в test mode. Любые объекты `card: { number, cvc, exp_month, exp_year }` в payload запрещены. Допустимы только:
  - `payment_method: 'pm_card_visa' | 'pm_card_chargeDeclined' | 'pm_card_*'` (test PaymentMethod tokens);
  - `payment_method: 'pm_*'`, созданный через Stripe.js / Checkout / Elements;
  - `setup_intent` / `payment_intent` confirm только по `pm_*` id, без `card` object.
- **Запрет on-server card collection:** ни одна edge function, ни тест-помощник, ни helper-скрипт не имеют права принимать на вход номер карты. Сбор карты — только через Stripe-hosted Checkout, Payment Element или Stripe.js на клиенте.
- **Запрет одноразовых helper-функций для прогона гейтов:** временные edge functions вида `stage25-*-trigger` создавать запрещено. Все runtime-прогоны (G19–G24 и будущие) идут через канонические пути: Hosted Checkout, admin UI, webhook replay через Stripe CLI / Dashboard.
- Прежние правила: только русский, DIAGNOSE→PLAN→DRY RUN→EXECUTE→VERIFY, add-only, bePaid и `grant-access-for-order` не трогаем, прямой revoke доступа запрещён, `entitlements`/`access_rules` напрямую не меняем, связи только по UUID, test mode only.

---

## Шаги Phase 3.2

### A. Discovery (read-only, без изменений)

Зафиксировать в proof:

- существующие UI-элементы карточки подписки;
- существующие cancel-actions (`subscription-actions`, `subscription-admin-actions`) и bePaid baseline;
- актуальные поля `subscriptions_v2` и `provider_subscriptions` (cancel_*, meta);
- где admin UI рендерит статус подписки Stripe.

### B. Edge Function `stripe-subscription-action`

Provider-aware endpoint (расширить существующий, без дублирования).

**Input:**

```json
{ "subscription_v2_id": "uuid", "action": "cancel_at_period_end | cancel_now", "dry_run": true }
```

**Правила:**

- Только `provider='stripe'`; bePaid → `not_supported` STOP.
- Stripe sub находим строго через `provider_subscriptions.provider_subscription_id`, должен начинаться с `sub_`.
- `dry_run=true` ничего не меняет, возвращает plan.
- Auth: admin / super_admin через `getClaims` + role check.
- **PCI-гейт в коде:** никаких параметров вида `card`, `number`, `cvc`, `exp_month`, `exp_year` во входе и в исходящих Stripe-вызовах. Schema-валидация zod должна отклонять такие поля HTTP 400.

### C. cancel_at_period_end

- **Stripe:** `subscription.update(cancel_at_period_end=true)`.
- **БД:** `subscriptions_v2.meta` ← `cancel_at_period_end=true`, `cancel_requested_at`, `cancel_source='admin'`. `status` НЕ переводим в canceled. `ps.state` оставляем до webhook.
- Доступ не трогаем.

### D. cancel_now

- **Stripe:** `subscription.cancel()`.
- **БД:** `subscriptions_v2.status='canceled'`, `ps.state='canceled'`, `cancel_reason='admin_stripe_cancel_now'`, `canceled_at=now()`.
- Доступ живёт до `entitlements.expires_at`, Telegram не кикаем.

### E. Webhook compatibility

Подтвердить, что `customer.subscription.deleted` и `customer.subscription.updated` корректно фиксируют результат и идемпотентность через `provider_events_idem_unique` сохраняется.

### F. Admin UI

Две кнопки в карточке Stripe-подписки: **«Отменить в конце периода»** и **«Отменить сейчас»**.

- видимость только при `provider='stripe'`;
- confirmation modal: «доступ не будет отозван немедленно», «Telegram revoke не выполняется», «действие будет отражено в Stripe».
- для bePaid zero-diff.

### G. Audit

Поля: `actor_type`, `actor_user_id`, `actor_label`, `subscription_v2_id`, `provider_subscription_id`, `provider='stripe'`, `action`, `dry_run`, `result`, `stripe_subscription_id`, `before_state`, `after_state`.

### Stop-gates

subscription не найдена / не Stripe / sub_id не `sub_*` / account_code mismatch / уже canceled / нет прав / Stripe API error / **PCI-violation в payload** (новое).

---

## NEW. Stripe PCI Compliance Remediation

### H. Дисциплина PCI (одноразовое исправление прошлого инцидента)

1. **Подтвердить удаление** edge function `stage25-g15-trigger` (уже удалена в Stage 2.5 cleanup) — проверить отсутствие в `functions.registry.txt` и в Supabase Functions list.
2. **Code sweep (read-only):** `rg -n "card_number|\"number\"\s*:|exp_month|exp_year|cvc" supabase/functions/` — убедиться, что нигде в стрипо-вых функциях нет работы с raw PAN. Зафиксировать вывод в proof.
3. **Документ-политика:** добавить в `.lovable/docs/edge-functions-standards.md` секцию «Stripe PCI rules» (запрет raw card data на сервере, разрешённые test tokens, запрет временных helper-функций).
4. **Acknowledge письма Stripe:** зафиксировать в proof request_id `req_SR4WPqmV1IYvAc`, дату, описание корня причины и принятые меры. Это первое и (по политике) последнее уведомление — никаких настроек в Stripe Dashboard НЕ менять, флаг «разрешить raw PAN» НЕ включать.

### I. Корректировка протокола runtime-проверок (G19–G24)

- Все симуляции subscription-событий выполняются через канонические пути: Stripe Hosted Checkout, admin UI Phase 3.2, Stripe CLI `stripe trigger` / Dashboard «Send test webhook».
- Test PaymentMethods — только готовые токены `pm_card_visa`, `pm_card_chargeDeclined`, `pm_card_authenticationRequired` и т.п.
- Если для гейта нужен сценарий, не покрываемый Hosted Checkout (например, `customer.subscription.deleted` после `cancel_now`) — использовать Stripe CLI `stripe trigger customer.subscription.deleted` или вызвать наш собственный `stripe-subscription-action` (он уже идёт через Stripe API без PAN).

---

## Runtime Proof — гейты G19–G25


| Гейт            | Сценарий                                       | Метод                                          | Ожидание                                                                                                              |
| --------------- | ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **G19**         | dry_run cancel_at_period_end                   | UI / direct curl                               | Stripe API не вызван, БД не меняется, возвращён plan                                                                  |
| **G20**         | execute cancel_at_period_end                   | admin UI                                       | Stripe `cancel_at_period_end=true`; meta обновлена; status ≠ canceled; доступ не отозван                              |
| **G21**         | webhook `customer.subscription.updated`        | Stripe doставка после G20                      | webhook processed; meta синхронизирована; дублей нет                                                                  |
| **G22**         | execute cancel_now                             | admin UI                                       | Stripe canceled; `subscriptions_v2.status=canceled`; `ps.state=canceled`; entitlements не удалены; Telegram не кикнут |
| **G23**         | webhook `customer.subscription.deleted` replay | Stripe CLI re-deliver                          | idempotent; replay не создаёт дублей; доступ не отзывается напрямую                                                   |
| **G24**         | bePaid freeze                                  | SQL snapshot до/после                          | bePaid subscriptions/orders/payments/UI не изменились                                                                 |
| **G25 (новый)** | PCI sweep                                      | `rg` по `supabase/functions/` + список деплоев | 0 совпадений по raw-card паттернам; `stage25-g15-trigger` отсутствует; политика добавлена в docs                      |


## DoD

- `stripe-subscription-action` реализована (dry-run + execute, с PCI-валидацией входа).
- cancel_at_period_end и cancel_now работают.
- Webhook compatibility подтверждена.
- Admin UI actions добавлены только для Stripe, с confirmation modal.
- Audit пишется со всеми полями.
- G19–G25 = PASS.
- bePaid не затронут.
- `.lovable/docs/edge-functions-standards.md` дополнен секцией Stripe PCI.
- Acknowledgement Stripe-письма (req_SR4WPqmV1IYvAc) зафиксирован в proof.
- Proof: `.lovable/proofs/stripe_phase_3_2_subscription_actions_v1.md`.
- `.lovable/plan.md` обновлён.

## Что НЕ делаем

pause, resume, Subscription Schedule, installments, Customer Portal, dunning, migration bePaid→Stripe, live mode, изменения bePaid, изменения access revoke logic, **включение опции «разрешить raw PAN» в Stripe Dashboard**, **создание любых server-side card collection путей**.
---

## Phase 3.2 — Stripe Subscription Actions MVP (implementation log, 2026-06-05)

Status: code DONE; G19–G24 runtime gates pending (test mode).
Proof: `.lovable/proofs/stripe_phase_3_2_subscription_actions_v1.md`.

Delivered:
- edge function `stripe-subscription-action` (dry-run + execute, PCI входной guard, cancel_at_period_end и cancel_now);
- UI блок `src/components/admin/StripeSubscriptionActionsBlock.tsx` + интеграция в `SubscriptionActionsSheet` (рендерится только при `provider='stripe'`);
- `.lovable/docs/edge-functions-standards.md` секция 10 «Stripe PCI Rules» (запрет raw PAN, разрешённые test tokens, запрет одноразовых *-trigger функций);
- acknowledge письма Stripe `req_SR4WPqmV1IYvAc` (raw PAN warning) — без изменений настроек в Stripe Dashboard;
- G25 (PCI sweep) — PASS.

bePaid не затронут; `grant-access-for-order` не трогался; access revoke logic не менялась.

Next: прогон G19–G24 в test mode через admin UI после деплоя.
