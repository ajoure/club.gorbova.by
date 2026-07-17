# Решение по плану: **RETURN — исходная задача сокращена и частично заменена Trial-спринтом**

План качественно закрывает corrective retry-patch и правильно запрещает создание второго trial/MIT-контура. Но он **не закрывает первоначальную задачу целиком**:

1. внутренняя рассрочка на заданное количество платежей;
2. создание из карточки контакта ссылок по конкретным кнопкам продукта;
3. поддержка обычной оплаты, внутренней рассрочки, счёта и банковской рассрочки.

В текущем плане третий блок вынесен в «отдельный спринт», а вместо него добавлена крупная реализация provider-managed Trial. Это изменение scope без согласования.

---

## Что в плане сделано правильно

### Corrective retry-patch

A1–A4 правильные:

- capability должен проверяться до создания заказа;
- effective provider strategy должна сохраняться;
- ошибка должна иметь машинный код;
- legacy-значение должно отличаться от явного `0`.

A7 также правильный: поле задержки первого платежа нельзя показывать рабочим, пока оно только сохраняется в metadata и не меняет payload провайдера.

### Переиспользование Trial

Discovery нужен. В коде действительно уже существуют три разных исторических механизма:

- бесплатный no-card trial;
- MIT-tokenization;
- provider-managed bePaid subscription с `plan.plan + plan.trial`.

Старый builder уже формировал trial amount, trial interval, основную сумму и основной период.

MIT сейчас отключён, а в админке прямо указано, что внутреннее автосписание после trial платформенно выключено.

Старая subscription-ветка в `bepaid-create-token` находится после hard guard и фактически недостижима.

Поэтому запрет на новую edge-функцию, новый MIT и второй builder обоснован.

---

# Что план упустил

## 1. Из исходной задачи исключены ссылки из карточки контакта

В плане написано:

```text
AdminPaymentLinkDialog — отдельный спринт

```

Но это не дополнительная задача. Это половина исходного требования.

Сейчас `AdminPaymentLinkDialog` работает только с активными:

```text
offer_type = pay_now

```

Резолвер, список видимых офферов и ручной выбор отбрасывают `invoice` и `bank_installment`.

Следовательно, итог текущего плана будет таким:

```text
Внутренняя рассрочка исправлена
Invoice из контакта отсутствует
RR из контакта отсутствует

```

Это нельзя объявить завершением исходной задачи.

### Требуемая корректировка

Блок контактных ссылок можно выполнять после corrective patch, но он должен оставаться **частью того же master-DoD**.

```text
A. Retry corrective
B. Internal installment completion
C. Contact action links
D. Trial Discovery
E. Trial implementation — только после отдельного согласования

```

`SPRINT STATUS: GREEN` запрещён до завершения блока C.

---

## 2. Trial Implementation B2–B7 — расширение scope, а не обязательная часть текущей задачи

Ваше замечание было:

> Проверить существующий Trial и ничего не дублировать.

Для этого обязательно требуется **B1 Discovery**.

Но из замечания не следует, что в текущем спринте нужно немедленно:

- переделывать `PaymentDialog`;
- расширять trial UI;
- переносить provider-managed trial;
- изменять webhook lifecycle;
- проводить отдельный paid-trial E2E.

Это самостоятельный платёжный scope с высоким риском.

### Правильная граница

В текущем спринте:

```text
B1 Trial Discovery           : REQUIRED
B2–B7 Trial implementation   : HOLD AFTER DISCOVERY

```

После Discovery должен быть отдельный отчёт:

```text
что работает;
что недостижимо;
что дублируется;
что переиспользовать;
какие production trial-офферы существуют;
какой точный root-fix предлагается.

```

Только после согласования этого отчёта переходить к коду Trial.

Иначе план ушёл в сторону: основной contact-link scope отложен, а значительно более крупный Trial scope включён в обязательный DoD.

---

## 3. В B2 используется несуществующий канонический тип `offer_type='regular'`

В плане:

```text
для offer_type='regular'

```

Но текущая модель обычной подписки использует:

```text
offer_type = pay_now
meta.recurring.is_recurring = true

```

Админский интерфейс также определяет подписку через recurring metadata, а `offer_type='trial'` обрабатывает отдельно.

Нужно заменить:

```text
offer_type='regular'

```

на:

```text
offer_type='pay_now'
и meta.recurring.is_recurring=true

```

Иначе разработчик может добавить новый неканонический тип либо написать недостижимую ветку.

---

## 4. Не определена семантика `installment_count`

В админке поле сейчас описано как:

> Максимальный срок рассрочки. Реальное число платежей выберет клиент или администратор.

Но `public-create-installment-link` использует `offer.installment_count` сразу как фактическое количество платежей:

```text
selected_installment_months = installment_count
billing_cycles = installment_count

```

Получаются разные контракты:

```text
Админка:
installment_count = максимум

Публичный writer:
installment_count = фактическое N

```

### Нужно выбрать единый канон

Рекомендуемый:

```text
max_months / installment_count
→ максимально допустимое число платежей;

selected_installment_months
→ фактическое число платежей конкретной ссылки/заказа;

billing_cycles
→ selected_installment_months.

```

Тогда:

- из карточки контакта администратор выбирает `2..max_months`;
- на публичной странице либо клиент выбирает `2..max_months`, либо кнопка явно задаёт фиксированное число;
- writer никогда не подменяет maximum фактическим количеством без явного решения.

Это должно войти в DoD.

---

## 5. Не определена политика суммы при делении на 3/4/N

Сейчас используется:

```ts
perPaymentByn = Math.round(totalByn / selectedMonths);
totalInstallmentByn = perPaymentByn * selectedMonths;

```

То есть:

```text
100 BYN / 3
→ 33 BYN × 3
→ 99 BYN

```

или:

```text
101 BYN / 3
→ 34 BYN × 3
→ 102 BYN

```

Сейчас система может незаметно изменить итоговую стоимость.

### В плане требуется отдельное бизнес-решение

Для provider-managed finite subscription сумма каждого цикла обычно одинаковая. Поэтому выбрать один канон:

#### Вариант 1 — строгая делимость

```text
total_kopecks % billing_cycles === 0

```

Иначе оффер не сохраняется или ссылка не создаётся.

#### Вариант 2 — корректировка общего итога

Показывать до создания:

```text
Цена продукта: 100 BYN
Фактическая сумма рассрочки: 99,99 BYN
3 × 33,33 BYN

```

Отклонение допускается только в копейках, не в целых BYN.

#### Вариант 3 — первый платёж отличается

Требует доказанной provider-схемы через trial/initial amount и не должен внедряться скрыто.

Текущее округление до целого BYN необходимо запретить либо явно утвердить как бизнес-правило.

---

## 6. A5 уже реализован — это verify, а не новая работа

В актуальном `public-create-installment-link` уже стоит:

```ts
payment_type: 'subscription'

```

и сохраняются:

```text
as_finite_subscription=true
billing_cycles=installment_count

```

`admin-create-public-link` также уже переводит installment-link в `subscription`.

Поэтому A5 нужно переименовать:

```text
A5. Verify both writers use payment_type='subscription'

```

Также удалить устаревший комментарий в `admin-create-public-link`, который всё ещё утверждает, что installment-ссылка всегда `one_time`, хотя ниже код ставит `subscription`.

---

## 7. A3 неправильно возлагает provider error на writer’ы

`public-create-installment-link` и `admin-create-public-link` только создают ссылку. Они не вызывают bePaid и не выполняют provider capability gate.

Поэтому они не могут «прокинуть» ошибку, которая возникнет позже в `create-payment-checkout`, если не выполняют отдельный preflight.

Каноническая цепочка:

```text
create-payment-checkout
→ public-checkout
→ PublicPayPage / frontend

```

Именно там должны сохраняться:

```json
{
  "error": "provider_unlimited_attempts_not_supported",
  "message": "..."
}

```

Writer’ы должны:

- валидировать `null / 0 / 1..10`;
- сохранять retry policy;
- не подменять значение;
- опционально делать capability preflight, только если это отдельное явно принятое решение.

---

## 8. Trial SOT пока сформулирован слишком расплывчато

В B6 указано:

```text
подтверждённый recurring-флаг

```

Но не определено, какое поле является источником истины.

Существуют одновременно:

```text
auto_charge_after_trial
auto_charge_offer_id
auto_charge_amount
requires_card_tokenization
meta.recurring.is_recurring

```

До реализации B2 необходимо после Discovery зафиксировать точное правило, например:

```text
no_card_trial:
  amount = 0
  requires_card_tokenization = false

provider_managed_trial:
  offer_type = trial
  requires_card_tokenization = true
  auto_charge_after_trial = true
  trial_days >= 1
  regular amount resolvable

```

Это только пример. Финальное правило должно следовать production-данным.

### Также отсутствует precedence суммы после trial

Нужно определить:

```text
1. auto_charge_offer_id?
2. auto_charge_amount?
3. основной pay_now offer?
4. tariff original price?

```

Нельзя оставить silent fallback на случайную цену.

Без этого provider-managed trial может списывать не ту сумму.

---

# Исправленный master-план

## Этап A. Corrective retry patch

Оставить A1–A7 с поправками:

```text
A1 capability до mutations
A2 effective snapshot
A3 error через checkout chain
A4 missing=provider_default, 0=unlimited, 1..10=limited
A5 verify subscription writers
A6 полный UI 1..10 + default + unlimited
A7 delay UI hidden

```

Дополнительно:

```text
A8 при controlled error:
orders_v2 created = 0
subscriptions_v2 created = 0
provider_subscriptions created = 0
audit business failure = 1

```

---

## Этап B. Завершение внутренней рассрочки

Это основной scope, который сейчас недостаточно выделен.

### B1. Единый контракт срока

```text
max_months
selected_installment_months
billing_cycles

```

### B2. Единый контракт суммы

Зафиксировать:

```text
offer amount
per-cycle amount
effective total
rounding delta

```

Не допускать скрытого изменения цены на целые BYN.

### B3. Все writer’ы

Проверить:

```text
admin-create-public-link
public-create-installment-link
payment-dialog bridge при наличии
public-checkout compatibility

```

### B4. Provider payload

Проверить:

```json
{
  "infinite": false,
  "billing_cycles": 3,
  "number_payment_attempts": 5,
  "plan": {
    "amount": "...",
    "interval": 30,
    "interval_unit": "day"
  }
}

```

### B5. Snapshot

Во всех сущностях:

```text
orders_v2
subscriptions_v2
provider_subscriptions
audit_logs

```

### B6. Lifecycle

Проверить:

```text
первый платёж;
следующий платёж;
последний платёж;
завершение после N циклов;
ошибка;
исчерпание retry;
ручная отмена;
отсутствие лишнего автопродления.

```

---

## Этап C. Ссылки из карточки контакта — вернуть в исходный scope

### C1. Выбор конкретной кнопки продукта

Не резолвить только `payment_type`. Администратор должен выбирать точный активный `offer_id`.

Список:

```text
pay_now
pay_now + internal_installment
invoice
bank_installment

```

### C2. Классификация действия

```text
link_kind='payment'
link_kind='invoice'
link_kind='bank_installment'

```

Внутренняя рассрочка остаётся:

```text
link_kind='payment'
payment_type='subscription'
meta.installment...

```

### C3. Контекстный UI


| Оффер                | CTA                                    |
| -------------------- | -------------------------------------- |
| разовая оплата       | Создать ссылку на оплату               |
| подписка             | Создать ссылку на подписку             |
| внутренняя рассрочка | Создать ссылку на рассрочку            |
| invoice              | Создать ссылку для оформления счёта    |
| bank installment     | Создать ссылку на банковскую рассрочку |


### C4. Non-acquiring actions

Для invoice/RR:

```text
provider = NULL
account_code = NULL
provider_mode = NULL

```

Без фиктивного `bepaid`.

### C5. `/pay/:token`

Явные ветки:

```text
payment
invoice
bank_installment

```

### C6. Consumption

После успешного:

```text
invoice создан;
RR order создан;
payment checkout создан;

```

одноразовая ссылка атомарно consume’ится.

### C7. CRM

RR создаёт заказ через существующий:

```text
public-rr-installment-initiate
resolveOrderRouting

```

Invoice использует существующий invoice-flow.

---

## Этап D. Trial Discovery

Оставить B1 текущего плана:

```text
код;
миграции;
production offers;
runtime paths;
keep/merge/delete;
SOT;
price precedence;
webhook lifecycle.

```

Но после Discovery:

```text
STOP
REPORT
APPROVAL

```

---

## Этап E. Provider-managed Trial

Только после отдельного одобрения Discovery:

```text
canonical writer extension;
shared plan builder;
PaymentDialog routing;
trial admin UI;
paid trial E2E;
dead code cleanup.

```

Этот этап не должен блокировать завершение внутренней рассрочки и контактных ссылок, пока delay UI скрыт.

---

# Обновлённый DoD исходной задачи

```text
RETRY PRE-MUTATION GATE             : REQUIRED
RETRY DEFAULT / LIMITED / UNLIMITED : REQUIRED
EFFECTIVE RETRY SNAPSHOT            : REQUIRED

INSTALLMENT MAX VS SELECTED COUNT   : DEFINED
INSTALLMENT 3 PAYMENTS              : PASS
INSTALLMENT 4 PAYMENTS              : PASS
INSTALLMENT N PAYMENTS              : PASS
INSTALLMENT PRICE ROUNDING          : EXPLICIT, NO HIDDEN WHOLE-BYN DELTA
INSTALLMENT INTERVAL                : FROM OFFER
INSTALLMENT PAYMENT_TYPE            : SUBSCRIPTION
INSTALLMENT FINAL CYCLE             : STOPS AFTER N
INSTALLMENT AUTO_RENEW              : FALSE

CONTACT LINK — ONE-TIME             : PASS
CONTACT LINK — SUBSCRIPTION         : PASS
CONTACT LINK — INTERNAL INSTALLMENT : PASS
CONTACT LINK — INVOICE              : PASS
CONTACT LINK — BANK INSTALLMENT     : PASS
CONTACT EXACT OFFER_ID              : PASS
NON-ACQUIRING PROVIDER NULL         : PASS
ACTION LINK ATOMIC CONSUME          : PASS

TRIAL DISCOVERY                     : PASS
TRIAL NEW IMPLEMENTATION            : SEPARATE APPROVAL
INTERNAL MIT                        : REMAINS DISABLED
DIRECT-CHARGE                       : NOT REINTRODUCED

FRONTEND PUBLISH                    : HOLD
MASTER SPRINT STATUS                : RETURN

```

## Итог

План **не ушёл полностью в неправильную сторону**, но нарушил приоритет:

```text
Основную задачу contact links отложил,
а дополнительный Trial Discovery превратил
в обязательную крупную реализацию.

```

Правильная корректировка:

```text
A — закончить retry;
B — доказать внутреннюю рассрочку 3/4/N;
C — закончить ссылки из карточки контакта;
D — провести Trial Discovery;
E — Trial implementation только после отдельного согласования.

```

До выполнения C план не закрывает исходную задачу.

&nbsp;

План: узкий corrective patch по retry-policy + Trial Discovery (переиспользование существующего provider-managed trial). Все правки — без публикации до закрытия DoD.

## Часть A. Узкий corrective retry-patch (BLOCKERS)

### A1. Capability gate ДО любых INSERT (BLOCKER)

Файл: `supabase/functions/_shared/create-payment-checkout.ts`.

Порядок сейчас: `orders_v2 INSERT` → `subscriptions_v2 INSERT` → resolver → controlled error. Это оставляет мусор.

Правка:

- Перенести `resolveInstallmentRetryPolicy` + `resolveBepaidAttemptsValue` (с чтением `bepaidCreds.subscription_attempts_capability`) в блок валидации ДО первого INSERT.
- При `ProviderUnlimitedAttemptsNotSupportedError` — возвращать controlled error БЕЗ создания orders_v2 / subscriptions_v2 / CRM-сделки.
- Сохранить полученный `resolution` в переменной и переиспользовать ниже (не пересчитывать).

### A2. Effective retry snapshot (FAIL)

Сейчас `resolution.provider_strategy` вычисляется и выбрасывается (`void`).

Правка — сохранять в трёх местах (`orders_v2.meta.installment`, `subscriptions_v2.meta`, `provider_subscriptions.meta`) единый snapshot:

```json
{
  "retry_policy": {
    "mode": "limited|unlimited_requested",
    "configured_value": 0|1..10,
    "provider_strategy": "explicit_limit|native_zero|verified_large_sentinel",
    "provider_number_payment_attempts": <int>,
    "capability_proven": true|false,
    "capability_source": "integration_instances.config.subscription_attempts_capability",
    "resolved_at": "<iso>"
  }
}
```

Тот же snapshot — в audit-запись перед запросом к bePaid.

### A3. Machine-readable error code (FAIL)

Заменить длинный русский текст на канонический ответ:

```json
{
  "success": false,
  "error": "provider_unlimited_attempts_not_supported",
  "message": "Безлимитные попытки не подтверждены провайдером. Выберите значение от 1 до 10."
}
```

Прокинуть код в `public-create-installment-link` и `admin-create-public-link` без изменения UX-текста.

### A4. Legacy retry semantics: единый контракт (FAIL)

Канон:

```
meta.installment.max_charge_attempts отсутствует → provider_default = 3
явный 0                                          → unlimited_requested
1..10                                            → limited
```

Правки:

- `supabase/functions/_shared/installment-retry-policy.ts` — ветка «missing» возвращает `{ mode: "provider_default", configured_value: null, max_attempts: 3 }` (новый режим), а не `unlimited_requested`.
- `src/lib/installmentRetryPolicy.ts` — синхронно.
- `src/pages/admin/AdminProductDetailV2.tsx` — убрать fallback `?? 3` при загрузке; для отсутствующего значения показывать отдельный item «По умолчанию (3)», отличный от «Без ограничения».
- `supabase/functions/public-checkout/index.ts` — убрать преобразование отсутствующего значения в `0`.

### A5. Public writer пишет `subscription` (PARTIAL)

`supabase/functions/public-create-installment-link/index.ts` — при записи новой ссылки `payment_type: "subscription"`. Defensive promotion в `public-checkout` оставить только как compatibility для уже созданных `one_time` записей.

### A6. UI 1..10 из общего helper (PARTIAL)

`AdminProductDetailV2.tsx` — использовать `INSTALLMENT_MAX_CHARGE_ATTEMPTS_OPTIONS` из `src/lib/installmentRetryPolicy.ts`, а не локальный список `1,2,3,5,10,0`. Добавить сверху отдельный item «По умолчанию (3)» = `null`.

### A7. First payment delay — временно убрать из UI (FAIL)

`first_payment_delay_days` в bePaid payload не уходит. До Discovery Trial:

- скрыть поле «Первый платёж через, дней» из редактируемого UI в `AdminProductDetailV2.tsx`;
- колонку/meta НЕ удалять;
- ничего не мигрировать.

Настоящая реализация — только через переиспользование trial (см. часть B), не как отдельный delay-engine.

## Часть B. Trial Discovery + переиспользование существующего provider-managed trial

Никаких новых edge-функций, таблиц, cron, MIT, direct-charge, второго builder'а не создаём.

### B1. Discovery (обязательно ДО кода)

Оформить `.lovable/discovery/trial-canonical-map.md`:

Поля (аудит по коду + миграциям + production-данным):

```
tariff_offers.offer_type
tariff_offers.trial_days
tariff_offers.auto_charge_amount
tariff_offers.auto_charge_after_trial
tariff_offers.auto_charge_offer_id
tariff_offers.requires_card_tokenization
tariff_offers.amount
tariff_offers.meta.recurring
tariff_offers.meta.acquiring
auto_charge_delay_days
first_payment_delay_days
```

Для каждого: где редактируется / где сохраняется / где читается runtime / используется ли / MIT vs provider-managed / есть ли активные офферы.

Runtime-пути:

```
PaymentDialog · bepaid-create-token · bepaid-create-subscription-checkout ·
_shared/create-payment-checkout · bepaid-webhook · grant-access-for-order ·
subscriptions_v2 · provider_subscriptions · access_rules · subscription-charge · direct-charge
```

Таблица keep/merge/delete по каждой ветке.

Production-аудит активных `offer_type='trial'` — вывод всех перечисленных полей, деление на 4 категории (free no-card / paid no-continue / paid + subscription / legacy MIT / противоречивые). Без backfill.

### B2. Канонический subscription writer — `bepaid-create-subscription-checkout`

Расширить существующую функцию (НЕ создавать новую):

- принимает `offer_id`, читает всё из БД (клиент не источник истины по суммам/срокам);
- для `offer_type='regular'` — текущий payload без изменений;
- для `offer_type='trial'` с provider-managed recurring — собирает `plan.plan` + `plan.trial` из существующих полей:
  - `trial.amount` ← `tariff_offers.amount` (trial-оффер), `trial.interval` ← `trial_days`;
  - `plan.amount` ← `auto_charge_amount` (или canonical regular источник), `plan.interval` ← existing recurring interval;
- строгая валидация ДО INSERT (amounts, days, interval, repeat-guard, active-sub conflict).

### B3. Shared helper (только чистая сборка plan)

`supabase/functions/_shared/build-bepaid-subscription-plan.ts`:

```ts
buildBepaidSubscriptionPlan({
  mode: "regular" | "trial" | "finite_installment",
  regularAmount, regularIntervalDays,
  trialAmount, trialDays,
  billingCycles, retryPolicy,
})
```

- НЕ создаёт заказ/подписку, НЕ вызывает bePaid;
- используется в `bepaid-create-subscription-checkout` и `_shared/create-payment-checkout` (finite installment) — устраняем расходящиеся builder'ы.

### B4. Legacy `/subscriptions` в `bepaid-create-token`

- guard остаётся, ветка не разблокируется;
- в token-функции только: no-card trial + one-time + compat;
- удаление мёртвого кода — только после E2E-proof, отдельным шагом.

### B5. PaymentDialog маршрутизация

Порядок:

```
trial без карты                → bepaid-create-token (no-card branch)
trial с provider-managed sub   → bepaid-create-subscription-checkout
regular subscription           → bepaid-create-subscription-checkout
one-time                       → существующий one-time
internal installment           → public-create-installment-link
```

Режим — по server-side snapshot оффера, а не по клиентскому `isTrial`. Новую колонку не вводим — вычисляем из существующих полей.

### B6. Админский Trial-блок в `AdminProductDetailV2.tsx`

Не создавать второй интерфейс. Переработать существующий:

```
Режим после trial:
  ○ Только пробный доступ, без карты
  ○ Подписка через bePaid после пробного платежа
```

Маппинг на существующие поля: `trial_days`, `amount`, `auto_charge_amount`, `auto_charge_offer_id`, `requires_card_tokenization`, подтверждённый recurring-флаг. Никаких `trial_initial_amount`/`trial_regular_amount`.

### B7. First payment delay ⇄ Trial

Классификация:

- A: списать сейчас + первый основной через N дней → provider-managed trial (реализовано);
- B: 0 сейчас + первый через N дней → только после provider-proof (bePaid принимает `trial.amount=0` и сохраняет карту) — иначе не заявлять;
- C: finite installment (первый сейчас, второй через 30) → trial не нужен, обычная finite subscription.

До proof-сценария B поле в UI скрыто (см. A7).

## Часть C. HOLD

- Frontend publish: HOLD.
- `AdminPaymentLinkDialog` расширение (`link_kind: payment|invoice|bank_installment`, nullable provider fields, 3 server-ветки в `admin-create-public-link`, invoice/RR ветки в `PublicPayPage`, atomic consume, контекстный диалог, preview E2E) — отдельным этапом ПОСЛЕ закрытия A + B Discovery.

## DoD

```
A1 CAPABILITY PRE-MUTATION GATE     : PASS (нет orders_v2/subs при controlled error)
A2 EFFECTIVE RETRY SNAPSHOT         : PASS (orders/subs/provider_subs/audit)
A3 MACHINE-READABLE ERROR CODE      : PASS
A4 LEGACY RETRY SEMANTICS UNIFIED   : PASS (missing→default 3, 0→unlimited, 1..10→limited)
A5 PUBLIC WRITER SUBSCRIPTION       : PASS
A6 ATTEMPTS UI 1..10 SHARED         : PASS
A7 FIRST PAYMENT DELAY UI HIDDEN    : PASS

B1 TRIAL DISCOVERY MAP              : PASS
B1 ACTIVE TRIAL OFFERS AUDITED      : PASS
B2 CANONICAL SUB WRITER EXTENDED    : bepaid-create-subscription-checkout
B3 SHARED PLAN BUILDER              : _shared/build-bepaid-subscription-plan.ts
B4 LEGACY /subscriptions IN TOKEN   : NOT REACHABLE (guard kept)
B5 PAYMENTDIALOG ROUTING            : PASS
B6 ADMIN TRIAL UI UNIFIED           : PASS
B7 DELAY REUSES TRIAL SEMANTICS     : PASS

INTERNAL MIT                        : REMAINS DISABLED
DIRECT-CHARGE                       : NOT REINTRODUCED
NEW PARALLEL DELAY ENGINE           : FORBIDDEN
ORDERS_V2 / SUBS_V2 / PROVIDER_SUBS : SINGLE ROW EACH
WEBHOOK DUPLICATES                  : 0

E2E:
  no-card trial                     : PASS
  paid provider-managed trial       : PASS (plan.plan + plan.trial payload verified)
  regular bePaid subscription       : PASS
  finite installment + retry policy : PASS
  unlimited без capability          : controlled error, нет INSERT
  legacy offers без max_charge_att. : provider_default=3, checkout проходит

FRONTEND PUBLISH                    : HOLD
```

Порядок исполнения после аппрува: A1→A2→A3→A4→A5→A6→A7 → B1 (Discovery доклад) → согласование → B2..B7. AdminPaymentLinkDialog — отдельный спринт.