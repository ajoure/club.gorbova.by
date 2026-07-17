# Решение по плану: **RETURN — направление верное, но полный scope пока не закрыт**

План больше не уходит в Trial и возвращён к основной задаче:

- внутренняя рассрочка `2..N`;
- повторные попытки;
- уведомления перед каждым автоматическим платежом;
- ссылки из карточки контакта;
- invoice и банковская рассрочка;
- Trial только как Discovery.

Но перед исполнением нужно добавить несколько обязательных пунктов. Без них уведомления будут работать частично, а invoice/RR-ссылки через `/pay/:token` не заработают.

---

# Что в плане правильно

## 1. Уведомления действительно нужно отделить от продления доступа

Сейчас UI уже сохраняет:

```text
pre_due_reminders_days
notify_before_each_charge
notify_grace_events
timezone

```

и предоставляет выбор `7 / 3 / 1 день`.

Но действующий cron жёстко перебирает `[7,3,1]` и выбирает записи по `subscriptions_v2.access_end_at`, а не по дате очередного списания.

Поэтому новая отдельная ветка **«Предстоящий автоплатёж»** необходима.

## 2. `installment_payments` нужно переиспользовать

Таблица уже хранит:

- номер платежа;
- общее число платежей;
- сумму;
- дату;
- статус;
- связь с заказом и подпиской.

График создаётся идемпотентно. Это правильный источник для определения `платёж №X из N`; второй календарь создавать нельзя.

## 3. Рассрочка не является автопродлением

`subscriptions_[v2.auto](http://v2.auto)_renew` для finite installment уже устанавливается в `false`.

Поэтому отдельные тексты без фразы «автопродление активно» — обязательны.

## 4. Семантика количества платежей уже частично реализована

`AdminPaymentLinkDialog` уже содержит:

```text
selectedInstallmentMonths
installmentMaxMonths

```

и проверяет выбранное значение `2..max`.

Это нужно доделать, а не создавать новый механизм выбора срока.

---

# Обязательные корректировки Stage B

## B1. Не создавать второй источник настроек оффера

В плане предлагается новый канон:

```text
tariff_offers.meta.charge_notifications

```

При этом существующий интерфейс подписки уже пишет настройки в:

```text
tariff_offers.meta.recurring.*

```

Если начать сохранять одновременно оба объекта, появятся две настройки для одной функции.

### Правильный контракт

На уровне **оффера**:

```text
обычная подписка
→ существующие meta.recurring.pre_due_reminders_days
→ meta.recurring.notify_before_each_charge
→ meta.recurring.notify_grace_events
→ meta.recurring.timezone

внутренняя рассрочка
→ meta.installment.charge_notifications

```

Shared-компонент UI допустим, но он должен уметь работать с разными путями хранения.

На уровне **созданной подписки** должен появляться единый нормализованный snapshot:

```text
meta.charge_notifications

```

или:

```text
meta.installment.charge_notifications

```

Для runtime нельзя каждый день читать текущий оффер: изменение оффера не должно задним числом менять настройки уже оформленной рассрочки.

### Precedence при создании

```text
1. payment_links.meta.installment.charge_notifications
2. tariff_offers.meta.installment.charge_notifications
3. legacy tariff_offers.meta.recurring.*
4. defaults

```

Сначала link snapshot, затем live offer, а не наоборот.

---

## B2. Пробросить настройки через все writer’ы

В плане указан только `admin-create-public-link`. Этого недостаточно.

Добавить:

```text
admin-create-public-link
public-create-installment-link
public-checkout
_shared/create-payment-checkout

```

Цепочка должна быть:

```text
offer configuration
→ payment_links snapshot
→ public-checkout extraMeta
→ orders_v2
→ subscriptions_v2
→ provider_subscriptions

```

Иначе настройки будут работать для ссылки из карточки контакта, но не для ссылки, созданной на публичном лендинге.

---

## B3. Исправить условие показа UI

В плане указано:

```text
payment_type='subscription'
selected_installment_months>=2

```

Но в редакторе оффера нет `selected_installment_months`: это значение конкретной покупки или ссылки.

### Условия в `AdminProductDetailV2`

Обычная подписка:

```text
offer_type='pay_now'
meta.recurring.is_recurring=true
payment_method!='internal_installment'

```

Внутренняя рассрочка:

```text
offer_type='pay_now'
payment_method='internal_installment'
max_months >= 2

```

`selected_installment_months` показывается и выбирается только:

- на публичной форме покупки;
- в `AdminPaymentLinkDialog`;
- при создании конкретной ссылки.

---

## B4. `notification_outbox` пока не подтверждена

В репозитории не удалось подтвердить существование `notification_outbox`.

Нельзя писать в плане:

> существующая таблица

до проверки схемы.

### Discovery gate перед B6

Проверить:

- существует ли таблица;
- колонки;
- уникальные индексы;
- RLS;
- существующий dispatcher;
- поддерживает ли Telegram и email.

Если таблицы нет, выбрать одно решение:

### Предпочтительный вариант

Добавить специализированную таблицу доставки:

```text
notification_outbox
id
idempotency_key UNIQUE
channel
recipient_user_id
event_type
payload
status
attempts
scheduled_at
sent_at
last_error
meta

```

### Либо переиспользовать текущую идемпотентность

Существующий reminder-код уже проверяет успешные записи в `telegram_logs` и `email_logs`.

Но для строгой атомарной блокировки лучше unique `idempotency_key`, а не схема `SELECT → SEND → INSERT`, допускающая гонку.

---

## B5. Расчёт дня должен учитывать timezone конкретной подписки

Недостаточно:

```ts
daysUntilCharge = Math.ceil(diff / 24h)

```

Это даст ошибки около полуночи и при переходах времени.

Нужно использовать существующие timezone helpers и сравнивать **локальные даты**:

```text
today date key в policy.timezone
charge date key в policy.timezone
difference in calendar days

```

Текущий reminder уже использует `todayDateKey`, `dayWindowUtc` и `APP_TZ`, но новая ветка должна учитывать timezone конкретного snapshot, а не один глобальный timezone.

Практический алгоритм:

1. выбрать provider subscriptions с `next_charge_at` в диапазоне ближайших 8 дней;
2. для каждой записи загрузить policy;
3. вычислить локальную дату в `policy.timezone`;
4. проверить попадание в `reminder_days`.

---

## B6. Уточнить источник времени для installment

План говорит:

```text
provider_subscriptions.next_charge_at — абсолютный SOT

```

Но не описывает случай, когда он отсутствует.

### Канон

```text
если provider_subscriptions.next_charge_at валиден
→ использовать его;

иначе
→ использовать installment_payments.due_date как schedule fallback;
→ audit installment.provider_next_charge_missing;
→ в сообщении писать «плановая дата списания».

```

При расхождении более 6 часов:

```text
effective_charge_at = provider next_charge_at
audit installment.schedule_provider_drift

```

После каждого успешного или неуспешного provider event необходимо обновлять:

- текущую строку `installment_payments`;
- `provider_[subscriptions.next](http://subscriptions.next)_charge_at`;
- следующую pending-строку;
- номер уже оплаченного цикла.

Без этого уведомление сработает только перед вторым платежом, но не перед третьим и четвёртым.

---

## B7. Проверять существование pending-платежа прежде, чем уведомлять

Даже если у провайдера осталось старое `next_charge_at`, напоминание после последнего платежа запрещено.

Для finite installment требуется одновременно:

```text
provider subscription активна
AND существует ближайший installment_payments.status='pending'
AND payment_number <= total_payments

```

После платежа `N`:

```text
pending installment_payments = 0
→ reminders = 0
→ subscription local state = completed
→ auto_renew=false

```

---

## B8. Не использовать предполагаемые event names bePaid

В плане перечислены:

```text
failed
retry_scheduled
final_failure
card_declined
stopped

```

Пока не подтверждено, что bePaid присылает события именно с такими названиями.

Перед реализацией B7 нужно составить матрицу реальных payload:


| Provider payload/status             | Наше событие                   |
| ----------------------------------- | ------------------------------ |
| неудачное очередное списание        | `installment_charge_failed`    |
| провайдер оставил возможность retry | `installment_retry_pending`    |
| попытки исчерпаны                   | `installment_retry_exhausted`  |
| подписка остановлена                | `installment_stopped`          |
| успешный цикл                       | `installment_charge_succeeded` |


Источник — реальные ветки `bepaid-webhook`, provider response и существующие логи.

Не использовать старую `subscription-charge`: там сохранилась логика внутреннего MIT и собственный счётчик попыток. Provider-managed рассрочку должен обслуживать webhook, не внутренний charge-runner.

---

## B9. Нужен единый delivery helper

Фраза «через существующий notification pipeline» слишком общая.

Сейчас email и Telegram формируются непосредственно внутри `subscription-renewal-reminders`.

Для reminder и webhook потребуется один shared helper, например:

```text
_shared/send-charge-notification.ts

```

Он должен:

- принимать уже подготовленный шаблон;
- отправлять email;
- отправлять Telegram;
- писать одинаковый delivery result;
- поддерживать idempotency key;
- не содержать расчёт графика или бизнес-логику.

Это не новая edge-функция и не новый платёжный контур.

---

## B10. Определить поведение первого платежа

Для стандартной finite installment:

```text
платёж №1 — сразу при оформлении;
уведомления 7/3/1 до него не отправляются;
первый объект для reminder — платёж №2.

```

Это соответствует текущему графику: первая строка создаётся как `succeeded`, остальные — `pending`.

---

# Семантика N: план нужно усилить

## На публичной странице пока нет выбора N

`AdminPaymentLinkDialog` уже позволяет выбрать срок, но публичный writer лендинга может продолжать использовать максимальное значение оффера как фактическое.

Нужно зафиксировать UI-контракт:

### Карточка контакта

```text
администратор выбирает N = 2..max_months

```

### Публичная кнопка продукта

При `max_months > 2` клиент должен увидеть выбор:

```text
2 платежа
3 платежа
...
max_months

```

Либо кнопка должна иметь отдельный явный fixed count.

Нельзя молча использовать maximum как выбранное значение.

### Канон данных

```text
tariff_offers.installment_count / meta.installment.max_months
→ maximum;

payment_links.meta.installment.selected_installment_months
→ выбранное N;

orders_v2.meta.installment.selected_installment_months
→ выбранное N;

subscriptions_v2.meta.installment.billing_cycles
→ выбранное N;

bePaid plan.billing_cycles
→ выбранное N.

```

---

# Суммы: Stage B9 требует точного алгоритма

Текущий writer округляет:

```ts
Math.round(totalByn / N)

```

то есть до целых BYN.

UI также показывает округление до целых BYN и допускает изменение полной цены.

## Новый общий helper

Нужен единый расчёт, например:

```text
_shared/calculate-installment-plan.ts
src/lib/calculateInstallmentPlan.ts

```

Вход:

```text
total_amount_kopecks
selected_cycles

```

Выход:

```text
per_payment_kopecks
effective_total_kopecks
rounding_delta_kopecks
rounding_mode

```

Алгоритм должен быть один на backend и frontend.

### Важное бизнес-ограничение

Если bePaid требует одинаковую сумму каждого цикла, точное совпадение возможно не всегда.

Например:

```text
10000 копеек / 3 = 3333,333...

```

Нужно выбрать канон:

```text
per_payment = round_half_up(total/N)
effective_total = per_payment × N
rounding_delta = effective_total − requested_total

```

И показать до создания:

```text
3 × 33,33 BYN = 99,99 BYN
Разница округления: −0,01 BYN

```

Допустимый delta:

```text
abs(rounding_delta_kopecks) < N

```

При большей разнице — controlled error.

Расчёт суммы на frontend не является источником истины: backend пересчитывает заново.

---

# Smoke-матрицу нельзя выполнять полностью живыми bePaid-заказами

Матрица:

```text
4 значения N × 2 интервала × 3 retry policy

```

может создать до 24 реальных provider subscriptions.

### Правильный verify

## Unit/integration без провайдера

Проверить все комбинации:

- payload builder;
- округление;
- policy;
- billing cycles;
- snapshots;
- reminder selection;
- final-cycle stop.

## Provider smoke

Достаточно:

1. `N=3`, interval `30`, retry `5`;
2. `N=4`, interval `15`, provider default;
3. controlled `retry=0` без capability — без внешнего вызова.

Остальные комбинации покрыть тестами builder’а.

## Reminder smoke

Добавить dry-run/simulation режим существующей функции:

```text
не отправлять email/TG;
не создавать новый checkout;
вернуть выбранную подписку;
payment_number;
days_before;
rendered subject/text;
idempotency_key.

```

Затем один контролируемый реальный Telegram/email test.

---

# Обязательные корректировки Stage C

## C1. Не использовать несуществующие offer types

В системе:

```text
обычная оплата          → offer_type='pay_now'
подписка                → pay_now + meta.recurring.is_recurring=true
внутренняя рассрочка    → pay_now + payment_method='internal_installment'
invoice                 → offer_type='invoice'
банковская рассрочка    → offer_type='bank_installment'

```

`subscription` и `installment_full_price` не должны использоваться как `offer_type`, если таких значений нет в DB constraint.

`AdminPaymentLinkDialog` сейчас фильтрует только активные `pay_now`.

При выборе конкретного оффера нужно удалить старый fallback, который позволяет взять другой `pay_now` и переопределить его тип. Для нового action-link контракта exact `offer_id` должен быть обязательным.

---

## C2. `public-checkout` не может открыть React-dialog

В плане:

```text
public-checkout роутит invoice → InvoiceCheckoutDialog

```

Это архитектурно неверно.

`public-checkout` — edge-функция. Сейчас GET возвращает данные ссылки, POST создаёт платёжный checkout.

`InvoiceCheckoutDialog` может открыть только frontend `PublicPayPage`.

### Правильная архитектура

```text
GET public-checkout
→ возвращает link_kind + безопасные данные;

PublicPayPage
→ switch(link_kind):

payment
  → существующий payment UI
  → POST public-checkout

invoice
  → InvoicePublicLinkFlow
  → public invoice endpoint

bank_installment
  → BankInstallmentPublicLinkFlow
  → public-rr-installment-initiate

```

Сейчас `PublicPayPage` содержит только payment-flow и ожидает `redirect_url` от `public-checkout`.

Поэтому в технические файлы обязательно добавить:

```text
src/pages/PublicPayPage.tsx

```

---

## C3. Invoice endpoint сейчас закрыт JWT-wall

В `supabase/config.toml`:

```text
invoice-checkout-issue
verify_jwt = true

```

Публичная `/pay/:token`-страница не сможет вызвать эту функцию для незалогиненного клиента.

### Безопасные варианты

Предпочтительно:

```text
public-invoice-link-issue
verify_jwt=false

```

Но функция обязана:

- принимать только `url_token`;
- сервером загружать payment link;
- проверять `link_kind='invoice'`;
- проверять active/expires/max_uses;
- брать `offer_id`, сумму, product/tariff только из ссылки;
- переиспользовать shared invoice issue logic;
- не доверять данным frontend.

Либо изменить текущий endpoint на dual-auth, но тогда потребуется снять platform JWT-wall и реализовать сильную проверку токена внутри. Отдельный public wrapper безопаснее.

Это не второй invoice-engine: бизнес-логику нужно вынести в shared helper и переиспользовать.

---

## C4. RR endpoint должен валидировать action link

`public-rr-installment-initiate` уже публичный, но для contact link он должен принимать:

```text
url_token

```

Сервер обязан проверить:

- `link_kind='bank_installment'`;
- точный `offer_id`;
- активность ссылки;
- срок;
- лимит;
- contact/user binding;
- idempotency.

Frontend не должен иметь возможность заменить `offer_id` в запросе.

---

## C5. `payment_links.provider=NULL` требует полноценной миграции

Текущий writer прямо отмечает, что `provider` не допускает `NULL`, и для customer-choice вынужден записывать фиктивный `bepaid`.

Поэтому миграция должна включать не только `link_kind`:

1. `link_kind` с default `payment`;
2. backfill существующих строк;
3. `provider` nullable;
4. `account_code` nullable;
5. `provider_mode` nullable для non-payment links;
6. новые CHECK constraints:

```text
link_kind='payment'
→ provider required
→ payment_type required

link_kind in ('invoice','bank_installment')
→ provider IS NULL
→ account_code IS NULL
→ provider_mode IS NULL

```

7. индекс по `(url_token, status)`;
8. generated Supabase TypeScript types;
9. все SELECT/INSERT mappings.

---

## C6. Consumption различается по типу ссылки

План говорит consume после создания order/subscription/invoice. Для обычной оплаты это может изменить текущую семантику.

В `bepaid-webhook` уже используется `consumePaymentLinkForOrder`, то есть payment-link consume связан с provider result.

### Канон

```text
payment
→ сохранить существующий consume после успешного платежа;

invoice
→ consume после успешного создания счёта;

bank_installment
→ consume после успешного создания RR order и получения payment_url.

```

Создание checkout URL само по себе не должно расходовать обычную платёжную ссылку.

---

## C7. Идемпотентность action links

Нужен не просто `current_uses++`, а атомарный RPC/helper:

```text
consume_public_action_link(
  link_id,
  action_kind,
  action_id,
  idempotency_key
)

```

Требования:

- один action создаётся максимум один раз;
- повторный запрос возвращает существующий invoice/order;
- increment и status transition выполняются атомарно;
- внешний RR/invoice success не дублируется при сетевом retry;
- ошибка consume после внешнего success не приводит к повторному внешнему действию.

---

## C8. Сумма только с сервера

`AdminPaymentLinkDialog` сейчас отправляет amount с клиента.

Для invoice и RR:

```text
amount = tariff_offers.amount

```

сервером.

Для payment-ссылок custom admin amount можно оставить как существующий explicit override, но он должен сохраняться с audit.

---

## C9. Сохранить существующую отправку ссылки контакту

Диалог уже умеет:

- создать публичную ссылку;
- отправить её в Telegram;
- оставить ссылку созданной, даже если Telegram не отправился.

Новый UI должен переиспользовать этот flow для всех `link_kind`, меняя:

- текст;
- кнопку;
- тип действия.

Не создавать отдельную Telegram-отправку для invoice и RR.

---

# Файлы, забытые в плане

Добавить к списку:

```text
supabase/functions/public-create-installment-link/index.ts
src/pages/PublicPayPage.tsx
supabase/config.toml
supabase/functions/_shared/send-charge-notification.ts
supabase/functions/_shared/calculate-installment-plan.ts
src/lib/calculateInstallmentPlan.ts
public invoice link endpoint или shared invoice issue helper
migration для idempotency/outbox, если таблицы нет
generated Supabase database types
tests для policy / installment calculation / reminder selection

```

Также после изменения `_shared` нужно передеплоить все entrypoint bundles, которые его импортируют. Изменение shared-файла само не обновляет уже развёрнутые функции.

---

# Исправленный порядок выполнения

```text
1. Stage B schema/runtime discovery
   - notification_outbox
   - provider state values
   - реальные bePaid webhook events
   - next_charge_at lifecycle

2. Shared installment calculation
   - N
   - копейки
   - rounding delta

3. Charge policy normalization
   - offer config
   - link snapshot
   - subscription snapshot

4. Writers
   - admin public link
   - public installment link
   - public checkout
   - shared checkout

5. Installment lifecycle
   - schedule rows
   - payment success/failure mapping
   - next pending
   - final completion

6. Reminder branch
   - timezone
   - 7/3/1
   - templates
   - idempotency
   - failure events

7. Stage B tests + limited provider smoke

8. Stage C DB migration
   - link_kind
   - nullable provider
   - constraints
   - action idempotency

9. Stage C backend branches
   - payment
   - invoice
   - RR

10. PublicPayPage branches

11. AdminPaymentLinkDialog exact offer picker

12. Stage C E2E

13. Trial Discovery document

14. Consolidated deploy report

15. Frontend Publish only after explicit command

```

---

# Финальный DoD, который должен заменить текущий

```text
RETRY POLICY                         : PASS
INSTALLMENT N=2..12                  : PASS
MAX_MONTHS != SELECTED_N             : PASS
BILLING_CYCLES = SELECTED_N          : PASS
INFINITE = FALSE                     : PASS
AUTO_RENEW = FALSE                   : PASS

AMOUNT CALCULATION IN KOPECKS        : PASS
ROUNDING DELTA EXPLICIT              : PASS
HIDDEN WHOLE-BYN PRICE CHANGE        : 0

INSTALLMENT_PAYMENTS COUNT = N       : PASS
PAYMENT 1 SUCCEEDED AFTER WEBHOOK    : PASS
NEXT PAYMENT RESOLUTION              : PASS
FINAL PAYMENT COMPLETES PLAN         : PASS
POST-FINAL REMINDERS                 : 0

REMINDER POLICY SNAPSHOT             : PASS
REMINDER ENABLED FLAG HONORED        : PASS
REMINDER DAYS HONORED                : PASS
TIMEZONE HONORED                     : PASS
PAYMENT 2..N REMINDERS               : PASS
INSTALLMENT TEXT, NO AUTO-RENEW COPY : PASS
EMAIL + TELEGRAM                     : PASS
REMINDER IDEMPOTENCY                 : PASS

FAILED CHARGE NOTIFICATION           : PASS
RETRY EXHAUSTED NOTIFICATION         : PASS
REAL PROVIDER EVENT MAPPING          : PASS
INTERNAL MIT CHARGE RUNNER           : NOT USED

CONTACT EXACT OFFER PICKER           : PASS
CONTACT ONE-TIME LINK                : PASS
CONTACT SUBSCRIPTION LINK            : PASS
CONTACT INTERNAL INSTALLMENT LINK    : PASS
CONTACT INVOICE LINK                 : PASS
CONTACT RR LINK                      : PASS

PUBLICPAY LINK_KIND ROUTING          : PASS
INVOICE PUBLIC AUTH                  : TOKEN-VALIDATED
RR PUBLIC AUTH                       : TOKEN-VALIDATED
NON-PAYMENT PROVIDER NULL            : PASS
ACTION LINK IDEMPOTENCY              : PASS
ATOMIC CONSUME                       : PASS

REGRESSION BEPAID                    : PASS
REGRESSION STRIPE                    : PASS
REGRESSION PUBLIC /CB                : PASS
TRIAL DISCOVERY                      : DOCUMENT ONLY
FRONTEND PUBLISH                     : HOLD
MASTER SPRINT STATUS                 : IN PROGRESS

```

## Итог

План покрывает примерно **75–80%** необходимого scope. Он не ушёл от глобальной задачи, но в текущем виде пропускает:

- публичный выбор `N`;
- lifecycle платежей №2..N;
- timezone-safe reminders;
- подтверждение notification outbox;
- реальное сопоставление bePaid events;
- публичную JWT-проблему invoice;
- frontend routing в `PublicPayPage`;
- разные правила consume для payment/invoice/RR;
- полный DB contract nullable provider.

После добавления этих пунктов план закрывает весь исходный спринт, а не только UI и создание первой finite subscription.

&nbsp;

План: Stage B + Charge Notifications + Stage C. Frontend publish — HOLD до финального E2E.

## Stage B — Charge Notifications (в существующем `subscription-renewal-reminders`)

### B1. Shared-контракт политики уведомлений

- Новый файл `supabase/functions/_shared/charge-notification-policy.ts`:
  - Тип `ChargeNotificationPolicy = { enabled, reminder_days:number[], timezone, notify_on_failure, notify_on_retry_exhausted }`.
  - `resolveChargeNotificationPolicy(meta)` — читает канон `meta.charge_notifications`, fallback на legacy `meta.recurring.{pre_due_reminders_days, notify_before_each_charge, notify_grace_events, timezone}`.
  - Дефолты для legacy без snapshot: `enabled=true, reminder_days=[7,3,1], timezone='Europe/Minsk', notify_on_failure=true, notify_on_retry_exhausted=true`.
- Клиентское зеркало `src/lib/chargeNotificationPolicy.ts` — те же дефолты и опции `[7,3,1]`.

### B2. Writer: сохранение snapshot

- В `_shared/create-payment-checkout.ts` (subscription branch, installment):
  - Резолвить policy из `tariff_offers.meta.charge_notifications` (fallback `payment_links.meta`).
  - Записывать `meta.installment.charge_notifications` в `orders_v2`, `subscriptions_v2`, `provider_subscriptions` (add-only, не ломать существующий `meta.installment.retry_policy`).
- В `admin-create-public-link`: пробрасывать `charge_notifications` из оффера в `payment_links.meta.charge_notifications`.

### B3. UI: единый компонент `ChargeNotificationSettings`

- Новый `src/components/admin/ChargeNotificationSettings.tsx`:
  - Чекбокс «Уведомлять перед каждым платежом».
  - Чекбоксы 7 / 3 / 1 день.
  - Select «Часовой пояс».
  - Чекбокс «Уведомлять при неудачном списании».
  - Чекбокс «Уведомлять при исчерпании попыток».
- Использовать в `AdminProductDetailV2.tsx`:
  - Для `payment_type='subscription'` (обычная подписка).
  - Для installment (`selected_installment_months>=2`) внутри блока рассрочки под заголовком «Уведомления об автоматических платежах».
- В installment-блоке скрыть/read-only параметры `charge_attempts_per_day`, `charge_times_local`, `grace_hours` с пояснением «Повторные попытки выполняются платёжным провайдером. Максимальное число задаётся настройкой „Попытки списания"».

### B4. Runtime: `subscription-renewal-reminders` — разделить две ветки

Ветка 1 (существующая): «Окончание доступа» — только для one-time / manual renewal / без auto charge. Источник: `subscriptions_v2.access_end_at`, `auto_renew=false`, без активного `provider_subscriptions`.

Ветка 2 (новая): «Предстоящее автоматическое списание».

- Для обычной provider-managed подписки:
  - Отбор по `provider_subscriptions.next_charge_at`, статус active/trialing.
- Для finite installment (`subscriptions_v2.meta.installment_count>=2`):
  - Отбор по ближайшему `installment_payments` (`status='pending'`, минимальный `payment_number`).
  - Effective time = `provider_subscriptions.next_charge_at` (SOT провайдера); при `abs(diff) > 6h` от `installment_payments.due_date` — audit `installment.schedule_provider_drift` и всё равно использовать provider time.
- Фильтрация по policy: `if (!policy.enabled || !policy.reminder_days.includes(daysUntilCharge)) skip`.

### B5. Шаблоны сообщений (installment)

- `subscription-renewal-reminders` рендерит installment-шаблоны отдельно от subscription-шаблонов. Никаких «Автопродление активно / отключить автопродление».
- 7 дней: «Предстоящий платёж по рассрочке. Через 7 дней будет автоматически списан платёж №{n} из {N}. Сумма: {amount} {currency}. Дата списания: {date}.»
- 3 дня: «Через 3 дня — платёж по рассрочке. Платёж №{n} из {N}, сумма {amount} {currency}.»
- 1 день: «Завтра будет списан платёж по рассрочке. Убедитесь, что на карте достаточно средств.»
- Каналы: Telegram + email (через существующие notification pipelines).

### B6. Идемпотентность

- Ключ: `installment_charge_reminder:{installment_payment_id}:{days_before}:{channel}`.
- Хранить в `notification_outbox` (существующая таблица; поле `idempotency_key`/`meta.key`, проверить схему перед реализацией). Если поля нет — использовать существующий unique-механизм таблицы.
- Audit events: `installment_charge_reminder_7d/3d/1d` в `audit_logs` с metadata `{subscription_id, provider_subscription_id, installment_payment_id, payment_number, total_payments, amount, currency, effective_charge_at, policy_source}`.

### B7. Failure notifications

- В `bepaid-webhook` (provider-managed installment ветка, `subv2:` tracking): при событиях failed/retry_scheduled/final_failure/card_declined/stopped проверить `policy.notify_on_failure` / `notify_on_retry_exhausted` и отправить уведомление в Telegram+email через существующий notification pipeline. Не создавать новую функцию.

### B8. Семантика количества платежей (аудит)

- Проверить: в UI и writer используется `selected_installment_months` (фактическое N), а не `installment_count/max_months`. `billing_cycles = selected_installment_months`. Исправить точки, где используется max как фактическое N.

### B9. Суммы в копейках

- Удалить округление до целого BYN в UI/writer рассрочки. Расчёт в копейках; per-payment точность 0,01 BYN; `rounding_delta` сохранять явно в `meta.installment.rounding_delta_kopecks`; фактический итог показывать в UI до создания ссылки.

### B10. Smoke (обязательный gate)

Матрица: N ∈ {2,3,4,12}; interval ∈ {15,30}; retry ∈ {provider_default, 5, 0-without-capability}.

- Unlimited-без-capability: `orders_v2/subscriptions_v2/provider_subscriptions = 0`, audit `pre_gate_blocked = 1`.
- Успех: `billing_cycles = N`, `infinite=false`, `auto_renew=false`, `installment_payments.count = N`, reminder срабатывает по payment №2 с корректным текстом, после payment N новых списаний и reminders нет.

---

## Stage C — Ссылки из карточки контакта

### C1. `AdminPaymentLinkDialog` — показать актуальные типы кнопок

Загружать `tariff_offers` продукта и предлагать выбор по `offer_type`:

- разовая (`full_payment` / `installment_full_price`);
- подписка (`subscription`);
- внутренняя рассрочка (installment с `selected_installment_months>=2`);
- сформировать счёт (`invoice`);
- банковская рассрочка (`bank_installment` / RR).

Администратор выбирает конкретный `offer_id`; для внутренней рассрочки — фактическое N от 2 до `max_months`.

### C2. `link_kind` в `payment_links`

- `link_kind ∈ {payment, invoice, bank_installment}` (add-only колонка/`meta.link_kind`, миграция без breaking).
- Для `invoice` и `bank_installment`: `provider=NULL, account_code=NULL, provider_mode=NULL`.

### C3. `/pay/:token` — явные ветки

`public-checkout` роутит по `link_kind`:

- `payment` → существующая ветка (one-time / subscription / installment).
- `invoice` → `InvoiceCheckoutDialog` flow (реквизиты юрлица + PDF + Telegram + email).
- `bank_installment` → RR `public-rr-installment-initiate`.
Атомарный consume ссылки: `current_uses++` только после успешного создания order/subscription/invoice.

### C4. CRM routing

RR-заказ и invoice-заказ создают `orders_v2` через существующий `resolveOrderRouting` (product/tariff binding + product_binding_fallback с корректным snapshot). Ничего не дублировать.

---

## Stage D — Trial Discovery (только документ)

Отдельный документ `.lovable/discovery/trial-provider-managed.md`: где сейчас упоминается trial в коде, какие провайдер-механизмы доступны (bePaid subscription trial, Stripe trial), матрица ограничений. Без реализации, без MIT, без direct-charge.

---

## DoD (сводно)

- Policy resolver + writer + shared UI: применяются в подписке и рассрочке.
- `subscription-renewal-reminders` уважает `reminder_days`, `enabled`; installment получает отдельные шаблоны и идемпотентные аудит-события.
- Failure/retry-exhausted уведомления идут из `bepaid-webhook`.
- Suma в копейках; `rounding_delta_kopecks` сохранён; UI показывает точный итог.
- Smoke-матрица (N,interval,retry) — PASS.
- `AdminPaymentLinkDialog` даёт админу выбрать любой тип кнопки продукта, `/pay/:token` роутит invoice и RR по `link_kind`.
- Публикацию НЕ запускать до финального E2E-отчёта.

## Технические файлы, которые будут изменены

- `supabase/functions/_shared/charge-notification-policy.ts` (new)
- `supabase/functions/_shared/create-payment-checkout.ts` (writer snapshot)
- `supabase/functions/subscription-renewal-reminders/index.ts` (две ветки, шаблоны, идемпотентность)
- `supabase/functions/bepaid-webhook/index.ts` (failure notifications)
- `supabase/functions/admin-create-public-link/index.ts` (`charge_notifications` snapshot, `link_kind`)
- `supabase/functions/public-checkout/index.ts` (ветки по `link_kind`)
- `src/lib/chargeNotificationPolicy.ts` (new)
- `src/components/admin/ChargeNotificationSettings.tsx` (new)
- `src/pages/admin/AdminProductDetailV2.tsx` (интеграция компонента, скрытие MIT-полей, суммы в копейках)
- `src/components/admin/AdminPaymentLinkDialog.tsx` (типы кнопок, offer picker)
- Миграция: `payment_links.link_kind` (add-only) + backfill из `meta`.