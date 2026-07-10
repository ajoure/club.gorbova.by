# RR provider contract — требования до Gate A.2

Reconciler-ветка `confirm_created` **не активируется** до заполнения этого документа подтверждёнными данными (документация РР или test-response).

## Обязательные вопросы

### 1. `getOrderStatus` и восстановление payment_url
- [ ] Возвращает ли `POST /{external_id}/getOrderStatus` поле, содержащее `payment_url` (`link`)?
- [ ] В каком поле именно (`link`, `payment_url`, `redirect_url`, …)?
- [ ] Возвращается ли URL для заявок в статусе `new`/`approved`/`processing`?
- [ ] Существует ли отдельный endpoint получения URL, если `getOrderStatus` его не возвращает?

### 2. Идемпотентность повторного `createOrder`
- [ ] Что возвращает `POST /createOrder` при передаче того же `order.id`?
  - вариант A: 200 с тем же `link` (истинная идемпотентность);
  - вариант B: 4xx conflict / validation error;
  - вариант C: создаёт новую заявку с тем же external ID (двойной заказ).
- [ ] Есть ли документированный «reuse-safe» endpoint?

**Пока не подтверждён вариант A — повторный `createOrder` c прежним external ID ЗАПРЕЩЁН.** Recovery работает только через `rr_finalize_created_order` с URL из `meta.rr.rr_payment_url_recovered`.

### 3. Definitive `not_found`
- [ ] Точный HTTP status для «заявка не найдена».
- [ ] Точное поле/код ответа (например `error.code = "not_found"`).
- [ ] Минимальное количество проверок до вывода «terminal not_created» (например 3 подряд с интервалом).
- [ ] Grace period после `createOrder`, в течение которого `not_found` возможен из-за eventual consistency.
- [ ] Различие test/prod endpoint (разные URL, разные коды).
- [ ] Правило, после которого отсутствие заявки считается окончательным.

**До заполнения** — любой `not_found` → `reconciliation_status='operator_required'` (не автоматический terminal).

### 4. Retry/backoff policy
- [ ] Максимальное число автоматических попыток reconcile.
- [ ] Backoff (например 30s → 2m → 10m → 30m).
- [ ] Какие ошибки повторяемы (5xx, timeout, network) vs. terminal (4xx с определённым кодом).
- [ ] Запрет повторной проверки terminal-заказа (`initiation_status ∈ ('created','failed')`).

### 5. Формат `link` / URL валидация
- [ ] Host allowlist (домены РР).
- [ ] TLS обязателен (`https:` only).
- [ ] Есть ли expiry на URL, требует ли refresh.

## Пример test-response

Заполнить фактическими ответами test-endpoint РР (в preview/test env, не в production):

```
# createOrder success
{ ... }

# createOrder duplicate external_id
{ ... }

# getOrderStatus существующей заявки
{ ... }

# getOrderStatus несуществующей
{ ... }
```

## Влияние на state machine

- Пункт 1 подтверждён → активируется ветка `rr_reconcile_confirm_created` в reconciler.
- Пункт 2 подтверждён A → допускается опциональный fallback повторного `createOrder`; иначе — запрещён.
- Пункт 3 заполнен → активируется автоматический переход в `rr_finalize_order_not_created`.
- Пункт 4 заполнен → активируется cron reconciler с backoff.

Пока пункты не подтверждены — reconciler в Gate A.2 работает только по веткам `operator_required` (безопасный default).
