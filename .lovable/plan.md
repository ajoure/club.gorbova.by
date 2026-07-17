## Решение по плану: **RETURN до capability proof bePaid**

План в целом архитектурно правильный: отдельно разведены конечное число платежных циклов, политика повторных списаний, публичные ссылки invoice/RR и существующий acquiring-flow.

Но требование:

```text
NULL / отсутствует / 0
→ провайдер пытается списывать без ограничения

```

пока **не подтверждается источниками**.

Документация совместимого subscription API однозначно разделяет:

- `infinite` — бесконечное количество **платёжных циклов**;
- `billing_cycles` — конечное количество платежей;
- `number_payment_attempts` — конечное количество неудачных попыток перед отменой подписки;
- при отсутствии `number_payment_attempts` применяется значение `3`. ([BeGateway](https://doc.begateway.com/ru/payment_management/subscriptions/plans/))

Документация также говорит, что повторные попытки выполняются до успеха либо до исчерпания указанного количества. Она не определяет `0` как бесконечность. ([BeGateway](https://doc.begateway.com/ru/payment_management/subscriptions/plans/))

## Что в плане оставить

### 1. Внутренняя бизнес-семантика

Допустимо зафиксировать:

```text
meta.installment.max_charge_attempts = 0
или NULL / отсутствует
→ unlimited_requested

1..10
→ limited

```

Но до подтверждения провайдера значение `unlimited_requested` означает только **намерение системы**, а не доказанную возможность bePaid.

Правильный тип:

```ts
type InstallmentRetryPolicy =
  | {
      mode: "unlimited_requested";
      configured_value: 0;
    }
  | {
      mode: "limited";
      configured_value: number;
      max_attempts: number;
    };

```

Не называть режим просто `unlimited`, пока не доказано фактическое поведение провайдера.

### 2. Capability gate

Раздел capability probe обязателен и должен выполняться первым:

```text
number_payment_attempts omitted
number_payment_attempts = 0
number_payment_attempts = 1
number_payment_attempts = 10
number_payment_attempts = 9999

```

Для каждого варианта сохранить:

- request payload;
- HTTP status;
- response body;
- фактическое значение в созданном плане;
- результат повторного GET плана.

До прохождения этого теста production checkout с `unlimited_requested` должен возвращать:

```text
provider_unlimited_attempts_not_supported

```

## Что необходимо исправить

### 1. Не использовать `9999` без доказательства

Стратегия с большим sentinel допустима только после подтверждения:

- что API принимает значение;
- что оно не ограничено меньшим внутренним максимумом;
- что значение действительно сохраняется;
- что подписка не отменяется раньше из-за иных правил провайдера.

Без этого `9999` — неподтверждённый хардкод.

### 2. Не обещать «будет списывать, пока карту не отменят»

Документация делает важное различие:

- повторные попытки применяются, когда в подписке **уже были успешные платежи**;
- если самый первый платёж возвращает `failed` или `error`, подписка может сразу получить конечный неуспешный статус. ([BeGateway](https://doc.begateway.com/en/payment_management/subscriptions/subscriptions/))

Поэтому подсказка в UI должна быть такой:

> При поддержке провайдером система не ограничивает количество повторных попыток последующих списаний. Фактическое выполнение зависит от статуса подписки, ответа банка и правил платёжного провайдера.

Нельзя гарантировать:

> Будет списывать до тех пор, пока карта не будет отменена.

### 3. Не менять legacy-поведение скрыто

В плане отсутствующее поле у всех старых офферов автоматически становится `0`. Это меняет действующий provider default `3` на новое поведение.

Нужен отдельный выбор:

```text
Новые офферы:
default = 0 / unlimited_requested

Существующие офферы без поля:
до capability proof сохраняют legacy-provider-default

```

После подтверждения провайдера можно выполнить отдельный guarded backfill старых installment-офферов:

```json
{
  "max_charge_attempts": 0,
  "retry_policy_mode": "unlimited_requested"
}

```

с BEFORE snapshot и точным перечнем затронутых офферов.

### 4. Добавить третий режим для обратной совместимости

Каноническая модель должна различать:

```text
provider_default
limited
unlimited_requested

```

Пример:

```ts
type InstallmentRetryPolicy =
  | {
      mode: "provider_default";
      configured_value: null;
    }
  | {
      mode: "limited";
      configured_value: number;
      max_attempts: number;
    }
  | {
      mode: "unlimited_requested";
      configured_value: 0;
    };

```

Но поскольку пользовательское бизнес-правило требует «пусто = бесконечность», `provider_default` нужен только для уже существующих legacy-офферов и технической миграции.

## UI

После capability proof варианты:

```text
Без ограничения
1 попытка
2 попытки
...
10 попыток

```

До capability proof:

```text
Без ограничения — недоступно до подтверждения провайдера
1 попытка
2 попытки
...
10 попыток

```

Сохранение `0` разрешается, но активный checkout блокируется controlled error, пока capability не подтверждена.

## Provider mapping

### Подтверждено, что `0` поддерживается

```ts
number_payment_attempts: 0

```

Snapshot:

```json
{
  "retry_policy": {
    "mode": "unlimited_requested",
    "provider_strategy": "native_zero",
    "provider_number_payment_attempts": 0,
    "capability_proven": true
  }
}

```

### Подтверждён большой sentinel

```ts
number_payment_attempts: VERIFIED_SENTINEL

```

UI при этом должен говорить:

> Практически без ограничения

Snapshot:

```json
{
  "retry_policy": {
    "mode": "unlimited_requested",
    "provider_strategy": "verified_large_sentinel",
    "provider_number_payment_attempts": 9999,
    "capability_proven": true
  }
}

```

### Провайдер не поддерживает режим

```text
provider_unlimited_attempts_not_supported

```

Не восстанавливать для этого `direct-charge`: MIT runtime отключён и является отдельной архитектурой.

## Остальные разделы плана

### Внутренняя рассрочка

Одобрено:

```text
installment_count = 3/4/N
infinite = false
billing_cycles = installment_count
interval = offer.installment_interval_days
payment_type = subscription

```

### `first_payment_delay_days`

Оставить вне DoD, пока значение не будет реально преобразовано в поддерживаемую провайдером конструкцию. Простая запись в metadata ничего не меняет.

### Invoice и bank installment из карточки контакта

Одобрено при следующих условиях:

- отдельный `link_kind`;
- явные ветки в `PublicPayPage`;
- отсутствие фиктивного `provider='bepaid'`;
- серверная сумма из оффера;
- атомарный consume;
- идемпотентность invoice/RR action;
- `SitePageBySlug` не считается участником `/pay/:token`.

### Publish

Правильно:

```text
FRONTEND PUBLISH: HOLD

```

Публиковать только после:

1. capability proof;
2. typecheck;
3. edge deploy;
4. preview E2E;
5. отдельной команды.

## Исправленный финальный DoD

```text
PROVIDER ZERO SEMANTICS             : MUST BE PROVEN
PROVIDER OMITTED SEMANTICS          : DEFAULT 3, NOT UNLIMITED
LARGE SENTINEL                      : FORBIDDEN WITHOUT PROOF
INITIAL PAYMENT UNLIMITED RETRIES   : NOT GUARANTEED
SUBSEQUENT PAYMENT RETRIES          : PROVIDER-DEPENDENT

APP NULL / 0 SEMANTICS              : UNLIMITED_REQUESTED
LIMITED ATTEMPTS 1..10              : REQUIRED
LEGACY MISSING VALUE                : PRESERVE UNTIL MIGRATION
PROVIDER EFFECTIVE VALUE SNAPSHOT   : REQUIRED

INSTALLMENT COUNT 3/4/N             : REQUIRED
INSTALLMENT EFFECTIVE TYPE          : SUBSCRIPTION
INSTALLMENT INTERVAL FROM OFFER     : REQUIRED
ATTEMPTS IN PROVIDER PAYLOAD        : REQUIRED
ATTEMPTS IN ORDER/SUB/AUDIT         : REQUIRED

CONTACT LINK — PAYMENT              : REQUIRED
CONTACT LINK — INTERNAL INSTALLMENT : REQUIRED
CONTACT LINK — INVOICE              : REQUIRED
CONTACT LINK — BANK INSTALLMENT     : REQUIRED
ACTION LINK IDEMPOTENCY             : REQUIRED
NON-PAYMENT PROVIDER = NULL         : REQUIRED

FIRST PAYMENT DELAY                 : OUT OF SCOPE UNTIL PROVEN
FRONTEND PUBLISH                    : HOLD
PLAN STATUS                         : RETURN — CAPABILITY GATE

```

Итог: план можно передавать в работу, но **нельзя ставить `SPRINT STATUS: GREEN` и нельзя обещать бесконечные попытки**, пока тестовый либо письменный ответ bePaid не подтвердит конкретное значение API. Публичной bePaid-документации, подтверждающей семантику `number_payment_attempts=0`, найти не удалось; доступные совместимые источники подтверждают только конечный лимит и default `3`.

&nbsp;

План: внутренняя рассрочка, попытки списания и ссылки из карточки контакта

## Важное ограничение источников

В доступной документации совместимого bePaid subscription API параметр `number_payment_attempts` — это **конечное** количество неудачных попыток до отмены подписки. При отсутствии параметра применяется default 3; попытки прекращаются после исчерпания лимита. Значение 0 как «бесконечно» в документации не описано. Параметр `infinite` относится только к количеству платёжных циклов, а не к попыткам списания. (docs.pay-cross.com)

Поэтому нельзя просто удалить `number_payment_attempts`: это даст не бесконечность, а 3 попытки. План вводит требуемую бизнес-семантику **0/null = без ограничения**, но перед production требует подтвердить, как именно боевой API bePaid кодирует такой режим.

## Цель

1. Внутренняя рассрочка 3 / 4 / N платежей с интервалом, заданным в оффере.
2. Настройка «Попыток списания каждого платежа».
  - отсутствует / NULL / 0 → без ограничения;
  - 1..10 → строго указанное количество неудачных попыток.
3. Ссылки из карточки контакта для: обычной оплаты, внутренней рассрочки, счёта, банковской рассрочки РР.
4. **Publish frontend НЕ запускать** до отдельной команды.

---

## 0. Provider capability gate (обязательный shift-left)

Через тестовые credentials bePaid выполнить изолированный capability probe до реализации production mapping:

- план без `number_payment_attempts` (ожидание по докам — вернётся 3);
- план с `number_payment_attempts` ∈ {0, 1, 10, 9999}.

Для каждого — сохранить HTTP status, request/response payload, фактически возвращённое значение и статус подписки после исчерпания.

Стратегии выбора (одна из):

- **A. Нативная бесконечность** — только если bePaid подтвердит: `number_payment_attempts=0` означает без лимита. В payload передаём `0`.
- **B. Провайдерский sentinel** — если `0` не поддерживается, но принимается большое целое (напр. `9999`). UI-название режима: «Без ограничения со стороны системы»; в snapshot фиксируется `provider_strategy='large_sentinel'`.
- **C. Не поддерживается** — не имитируем поддержку. Writer возвращает controlled error `provider_unlimited_attempts_not_supported`. App-managed retries — отдельный billing-спринт, MIT direct-charge не восстанавливается.

Результат гейта фиксируется в `acquiring_connections.meta.subscription_attempts_capability` и в архитектурной памяти.

---

## 1. Каноническая модель попыток

Хранение — без новой колонки: `tariff_offers.meta.installment.max_charge_attempts`.


| Значение                      | Семантика       |
| ----------------------------- | --------------- |
| отсутствует                   | без ограничения |
| null                          | без ограничения |
| 0                             | без ограничения |
| 1..10                         | конечный лимит  |
| отрицательное / дробное / >10 | ошибка          |


**Замечание о legacy-офферах:** отсутствующее значение сейчас неявно даёт provider default 3. Нормализация в 0 меняет поведение старых офферов на «без ограничения». Это осознанное изменение бизнес-семантики; данные не мигрируем — правило действует за счёт `resolveInstallmentRetryPolicy`.

Shared helper (единственный парсер):

```ts
// supabase/functions/_shared/installment-retry-policy.ts
// + зеркало для клиента: src/lib/installmentRetryPolicy.ts
export type InstallmentRetryPolicy =
  | { mode: "unlimited"; configured_value: 0 }
  | { mode: "limited"; configured_value: number; max_attempts: number };

export function resolveInstallmentRetryPolicy(raw: unknown): InstallmentRetryPolicy {
  if (raw === null || raw === undefined || raw === "") return { mode: "unlimited", configured_value: 0 };
  const v = Number(raw);
  if (v === 0) return { mode: "unlimited", configured_value: 0 };
  if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error("invalid_installment_max_charge_attempts");
  return { mode: "limited", configured_value: v, max_attempts: v };
}
```

Ни один writer/checkout не парсит поле напрямую.

Provider adapter (в `_shared/create-payment-checkout.ts`):

```ts
function resolveBepaidAttemptsValue({ retryPolicy, capability }): 
  { mode: "limited"|"provider_zero"|"provider_large_sentinel"; payloadValue: number }
```

`capability` берётся из `acquiring_connections.meta.subscription_attempts_capability` (заполняется по итогам §0).

---

## 2. UI оффера

`src/pages/admin/AdminProductDetailV2.tsx`, блок «Рассрочка (внутренняя)»:

- Новое поле «Попытки списания каждого платежа»:
  - Опции: «Без ограничения» (=0), «1 попытка», … «10 попыток».
  - Default: 0.
  - Подсказка (нейтральная, до capability proof): «Если выбрано „Без ограничения" или значение не задано, система не завершает рассрочку из-за количества неудачных попыток. Повторные списания продолжаются по расписанию провайдера до успешной оплаты, окончания рассрочки, ручной отмены либо окончательного отказа со стороны провайдера.» Слово «бесконечно» не используем до §0.
- `offerForm.installment_max_charge_attempts: number`.
- Load: `attemptsRaw == null ? 0 : Number(attemptsRaw)`.
- Save: `metaToSave.installment.max_charge_attempts = offerForm.installment_max_charge_attempts ?? 0`.

Поле «первый платёж» / delay в UI этого спринта **не появляется**, пока его provider-передача не доказана (см. §3).

---

## 3. Интервал и задержка первого платежа

`supabase/functions/admin-create-public-link/index.ts`:

- В SELECT добавить `installment_interval_days`, `first_payment_delay_days`.
- Убрать хардкод `interval_days: 30`, `first_payment_delay_days: 0`.
- Строгая валидация:
  - `interval_days` ∈ Integer[1..365] иначе `invalid_installment_interval_days`.
  - `first_payment_delay_days` ∈ Integer[0..365] иначе `invalid_first_payment_delay_days`, **и** этот параметр сохраняем только в metadata; provider-передача первой отсрочки в bePaid в этом спринте не заявляется как реализованная фича — вынесена в backlog «trial/first-charge delay live proof».

---

## 4. Writer внутренней рассрочки

`admin-create-public-link` — installmentBlock:

```ts
const retryPolicy = resolveInstallmentRetryPolicy(offer.meta?.installment?.max_charge_attempts);
installmentBlock = {
  payment_method: "internal_installment",
  max_installment_months: offerInstallmentMaxMonths,
  selected_installment_months: sel,
  billing_cycles: sel,
  as_finite_subscription: true,
  interval_days: intervalDays,
  first_payment_delay_days: firstDelayDays,
  max_charge_attempts: retryPolicy.configured_value,
  retry_policy_mode: retryPolicy.mode,
  total_amount: totalByn,
  per_payment_amount: perPaymentByn,
  per_payment_amount_byn: perPaymentByn,
  total_installment_amount: totalInstallmentByn,
  rounding_mode: "round_half_up_byn",
};
payment_type = "subscription";
```

`public-create-installment-link/index.ts`:

- То же поведение через тот же shared resolver.
- Исправить `payment_type: "one_time"` → `"subscription"`.
- Записать `as_finite_subscription`, `billing_cycles=installment_count`, `max_charge_attempts`, `retry_policy_mode`.

---

## 5. Defensive compatibility в `public-checkout`

`supabase/functions/public-checkout/index.ts`:

```ts
max_charge_attempts: linkInstallment.max_charge_attempts == null ? 0 : Number(linkInstallment.max_charge_attempts),
retry_policy_mode:  linkInstallment.retry_policy_mode
  ?? (Number(linkInstallment.max_charge_attempts ?? 0) === 0 ? "unlimited" : "limited"),
```

Защита старых ссылок (`payment_type='one_time'` + installment meta):

```ts
const effectivePaymentType =
  linkInstallment && Number(linkInstallment.selected_installment_months) >= 2
    ? "subscription"
    : link.payment_type;
```

Передавать `payment_type: effectivePaymentType` в `createPaymentCheckout`.

---

## 6. Provider adapter (`_shared/create-payment-checkout.ts`)

```ts
const retryPolicy = resolveInstallmentRetryPolicy(installmentExtra.max_charge_attempts);
const providerAttempts = resolveBepaidAttemptsValue({
  retryPolicy,
  capability: bepaidCreds.subscription_attempts_capability,
});

// payload:
plan: {
  shop_id: Number(bepaidCreds.shop_id), currency: "BYN",
  title: planTitle, description: planDescription,
  plan: { amount, interval: intervalDays, interval_unit: "day" },
  infinite: false,               // billing_cycles конечен всегда
  billing_cycles: billingCycles,
  number_payment_attempts: providerAttempts.payloadValue,
}
```

`number_payment_attempts` **никогда не опускается** для unlimited — иначе провайдер применит default 3.

---

## 7. Snapshot & audit

`subscriptions_v2.meta`, `provider_subscriptions.meta`, `orders_v2.meta.installment`, checkout-audit и pre-request server log:

```json
{
  "installment": {
    "billing_cycles": 4,
    "interval_days": 30,
    "retry_policy": {
      "mode": "unlimited" | "limited",
      "configured_value": 0 | 1..10,
      "provider_strategy": "zero" | "large_sentinel" | "explicit_limit",
      "provider_number_payment_attempts": <fact>
    }
  }
}
```

Не логируем credentials и card tokens.

---

## 8. Ссылки из карточки контакта — архитектурный контракт

`/pay/:token` обслуживается `PublicPayPage → public-checkout`; SitePageBySlug там не задействован. Поэтому invoice и bank_installment требуют явных веток в `PublicPayPage`.

### DB migration

`payment_links` — новая колонка `link_kind text not null default 'payment' check (link_kind in ('payment','invoice','bank_installment'))`. Для `invoice` и `bank_installment`: `provider=null`, `account_code=null`, `provider_mode=null`. Обновить CHECK, чтобы не требовать `provider='bepaid'` для non-payment. RLS/GRANTs не меняются.

### 8A. `admin-create-public-link` — три server branches

```ts
switch (offer.offer_type) {
  case "pay_now":          return createPaymentLink();
  case "invoice":          return createInvoiceActionLink();
  case "bank_installment": return createBankInstallmentActionLink();
  default: return errorResponse("unsupported_offer_type_for_public_link", 400);
}
```

Payment — существующая логика.

Invoice / bank_installment ветки:

- `link_kind` соответствующий;
- `amount` берётся из `offer.amount` на сервере (client-value игнорируется);
- provider-поля = NULL;
- НЕ выполнять: acquiring validation, customer-choice validation, Stripe lookup, recurring promotion, internal installment расчёт.

### 8B. `AdminPaymentLinkDialog`

- Фильтр офферов: `["pay_now","invoice","bank_installment"]`.
- CTA-лейблы:
  - `pay_now` обычный → «Создать ссылку на оплату»;
  - `pay_now` + internal_installment → «Создать ссылку на рассрочку»;
  - `invoice` → «Создать ссылку для оформления счёта»;
  - `bank_installment` → «Создать ссылку на банковскую рассрочку».
- Для `invoice` / `bank_installment` скрыть: провайдер (bePaid/Stripe), тип payment/subscription, customer choice, сохранённые карты, настройки внутренней рассрочки.

### 8C. `PublicPayPage` — маршрутизация по `link_kind`

```tsx
if (linkInfo.link_kind === "invoice") {
  return <InvoicePublicLinkFlow token={token} offerId={linkInfo.offer_id} paymentLinkId={linkInfo.id} />;
}
if (linkInfo.link_kind === "bank_installment") {
  return <BankInstallmentPublicLinkFlow token={token} offerId={linkInfo.offer_id} paymentLinkId={linkInfo.id} />;
}
// иначе — существующий payment flow
```

- `InvoicePublicLinkFlow`: открывает существующий `InvoiceCheckoutDialog`, вызывает `invoice-checkout-issue` с `offer_id` и `payment_link_id`, после успеха — consume ссылки.
- `BankInstallmentPublicLinkFlow`: форма ФИО/телефон/email, вызов `public-rr-installment-initiate` с `offer_id` и `payment_link_id`, редирект на `pay.rrllc.ru/pay/...`; legacy `external_link` — только controlled fallback; после успешной инициации — consume ссылки.

### 8D. Idempotency & consumption

Новый shared RPC:

```sql
consume_public_action_link(p_link_id uuid, p_action_id uuid, p_action_kind text) returns void
```

- Условия: `status='active'`, не истекла, `current_uses < max_uses`.
- Повторный вызов с тем же `action_id` идемпотентен (см. `meta.action_ids[]` или отдельная таблица `payment_link_actions(link_id, action_id, kind)`).
- Атомарно: `current_uses += 1`; при достижении `max_uses` → `status='consumed'`.
- Вызывается из `invoice-checkout-issue` и `public-rr-installment-initiate` после успешного создания заказа / выдачи счёта.

---

## 9. Verify

### Unit

- `installment-retry-policy.test.ts`: undefined/null/""/0 → unlimited; 1/5/10 → limited; -1/1.5/11/"abc" → error.
- Routing по `offer_type`.
- Defensive promotion legacy one_time + installment meta → subscription.

### `tsgo`

Зелёный (клиент + edge shared).

### Live smoke

1. **Limited retry:** оффер `installment_count=3, interval_days=30, max_charge_attempts=5`. В payload bePaid: `infinite:false, billing_cycles:3, number_payment_attempts:5, plan.interval:30`.
2. **Unlimited:** `installment_count=4, interval_days=15, max_charge_attempts=0`. Snapshot: `retry_policy.mode='unlimited'`; payload содержит подтверждённое provider-значение согласно §0 (не опущение).
3. **Contact invoice:** карточка контакта → invoice offer → `/pay/:token` → `InvoiceCheckoutDialog` → счёт → email/TG/download → link consumed.
4. **Contact bank installment:** карточка контакта → bank_installment → `/pay/:token` → форма → `public-rr-installment-initiate` → индивидуальный `pay.rrllc.ru/pay/...` → CRM stage → link consumed.
5. **Регресс:** one-time bePaid, subscription bePaid, Stripe one-time, Stripe subscription, внутренняя рассрочка (без изменений semantics для существующих 3-attempts default проверить, что legacy офферы теперь идут unlimited — это ожидаемое поведение per §1).

### Deploy (после подтверждения плана)

`admin-create-public-link`, `public-create-installment-link`, `public-checkout`, `admin-create-payment-link`, `subscription-charge`, `subscription-renewal-reminders`, `invoice-checkout-issue`, `public-rr-installment-initiate`. Изменение `_shared` само по себе не обновляет bundles.

### Frontend Publish — HOLD

Не запускать до отдельной команды.

---

## DoD

```text
PROVIDER UNLIMITED CAPABILITY     : PROVEN
NULL / MISSING / 0 SEMANTICS      : UNLIMITED
LIMITED ATTEMPTS 1..10            : PASS
OMITTED PROVIDER PARAMETER        : FORBIDDEN FOR UNLIMITED
PROVIDER EFFECTIVE VALUE SNAPSHOT : PASS

INSTALLMENT COUNT 3/4/N           : PASS
INSTALLMENT EFFECTIVE TYPE        : SUBSCRIPTION
INSTALLMENT INTERVAL FROM OFFER   : PASS
ATTEMPTS IN PROVIDER PAYLOAD      : PASS
ATTEMPTS IN ORDER/SUB SNAPSHOTS   : PASS

CONTACT LINK — PAYMENT            : PASS
CONTACT LINK — INTERNAL INSTALL.  : PASS
CONTACT LINK — INVOICE            : PASS
CONTACT LINK — BANK INSTALLMENT   : PASS
ACTION LINK IDEMPOTENCY           : PASS
NON-PAYMENT PROVIDER = NULL       : PASS

REGRESSION ONE-TIME / SUB         : PASS
EDGE DEPLOY                       : PASS
FRONTEND PUBLISH                  : HOLD
SPRINT STATUS                     : READY AFTER CAPABILITY GATE
```

Ключевое правило реализации: `0/null` внутри системы = «без ограничения», но конкретное значение, отправляемое bePaid, выбирается только после capability proof §0.