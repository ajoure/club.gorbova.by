да, согласен, с учетом правок:

# **План принят**

Правильная архитектура:

```text
Stripe = платёжный провайдер
document_scenarios + templates + executors = SOT документов
```

Новые executor, шаблоны и отдельную Stripe-document архитектуру не создавать.

Однако execute разделить на последовательные этапы.

---

# **Порядок выполнения**

## **Этап I — Runtime deployment gate**

Сначала задеплоить уже выполненный mapping:

```text
stripe → card
bepaid → card
```

Только после runtime PASS настраивать pilot-сценарий.

Причина: если сначала записать `document_scenarios`, production backend со старой версией shared-кода может продолжить определять Stripe не как `card`, и сценарий не сматчится.

### **Разрешённый deploy scope**

Только подтверждённые consumers:

```text
canonical-document-generate-strict
canonical-document-payment-hook
canonical-document-regenerate
canonical-document-generate
canonical-deal-document-overrides
document-field-resolver-v2
document-field-resolver-v2-snapshot
```

Перед deploy повторно проверить dependency graph. Если какая-либо функция фактически не импортирует изменённый код — не деплоить её без причины.

Frontend:

```text
src/utils/derivePaymentChannel.ts
```

опубликовать через штатный Lovable Publish в рамках того же runtime gate.

### **Runtime DoD**

Подтвердить фактическими вызовами:

```text
stripe → card
bepaid card → card
bepaid ERIP → erip
admin → other
admin_test/test_payment → card
```

Также:

- build clean;
- frontend/backend mirror совпадают;
- версии/timestamps 7 функций зафиксированы;
- `ai_generated_documents` до/после не изменился;
- bePaid regression PASS.

Proof:

```text
.lovable/proofs/stripe_document_payment_channel_runtime_v1.md
```

---

# **Этап II — Pilot document_scenarios**

После runtime gate настроить только один оффер:

```text
f71b5ed3-27dd-419d-b922-ad529192b58a
Несрочная консультация
```

## **Использовать штатный admin UI**

Приоритетный способ настройки:

```text
OfferDocumentScenariosCard.tsx
```

Не делать прямой SQL, если UI позволяет сохранить тот же канонический JSON.

SQL допустим только если UI технически недоступен, с отдельным объяснением и STOP-guards.

---

# **Коррекция pilot JSON**

Не придумывать отличия от рабочего BPiZ без доказанной необходимости.

## **Individual**

В BPiZ используется:

```text
requires_required_requisites = true
```

В proposed JSON указано `false`.

Перед записью проверить, какие реквизиты реально нужны шаблону `7caee05d`.

Если шаблон использует ФИО, адрес или иные обязательные данные клиента, оставить:

```json
"requires_required_requisites": true
```

Не ослаблять требования только потому, что платёж прошёл через Stripe.

## **Legal entity**

Для Stripe card payment нужен матч:

```text
payer_type = legal_entity
payment_channels содержит card
```

`bank_transfer` добавлять только если этот оффер действительно поддерживает банковский перевод. Сейчас offer Stripe-only, поэтому базовый pilot:

```json
"payment_channels": ["card"]
```

Не добавлять несуществующий способ оплаты «на будущее».

---

# **Exact pilot JSON**

После проверки required requisites использовать канонический вариант:

```json
[
  {
    "id": "<NEW_UUID_V4>",
    "is_enabled": true,
    "payer_type": "individual",
    "payment_channels": ["card"],
    "template_id": "7caee05d-0410-4b2f-85b7-f7af1463cac5",
    "executor_id": "d0c7fe75-1192-40a9-bbae-b652b69e6882",
    "requires_required_requisites": true
  },
  {
    "id": "<NEW_UUID_V4>",
    "is_enabled": true,
    "payer_type": "legal_entity",
    "payment_channels": ["card"],
    "template_id": "4fa3160f-f979-4dbe-b069-5b0cb2c7bb05",
    "executor_id": "d0c7fe75-1192-40a9-bbae-b652b69e6882",
    "requires_required_requisites": true
  }
]
```

Если фактический анализ шаблона докажет, что для ФЛ обязательные реквизиты не нужны, это отдельно отразить в proof и только тогда поставить `false`.

`document_defaults` не добавлять.

---

# **Pilot STOP-guards**

Перед сохранением подтвердить:

```text
offer_id точный
offer is_active = true
document_scenarios отсутствует
template FL active
template UL active
executor active
document_type = act
meta.acquiring сохранён
Stripe settings сохранены
```

После сохранения:

- повторное применение не создаёт дубли сценариев;
- `meta.acquiring` и остальные ключи не изменены;
- SYSTEM ACTOR audit создан;
- before/after snapshot зафиксирован.

Proof:

```text
.lovable/proofs/stripe_consultation_document_scenarios_pilot_v1.md
```

---

# **Pilot verify**

На тестовом заказе 2 USD разрешено только:

1. фактический backend resolver output;
2. frontend resolver output;
3. UI availability proof.

Ожидаемо:

```text
resolved_offer_id = f71b5ed3-...
payment_channel = card
source = scenario
matched_scenario != null
template_id != null
can_generate = true
```

Реальный документ не создавать.

Не вызывать writer, не присваивать номер, не создавать запись в `ai_generated_documents`.

Также подтвердить:

- сумма резолвится как `2.00`;
- валюта резолвится как `USD`;
- значения берутся из order/payment;
- `products_v2.currency='BYN'` не подменяет фактическую валюту заказа.

---

# **Этап III — Rollout на остальные четыре оффера**

Сейчас:

```text
NOT APPROVED
```

Approve на rollout выдаётся только после pilot PASS.

Перед rollout вернуть отчёт:

- runtime gate PASS;
- pilot scenario сохранён;
- backend/frontend resolver PASS;
- `USD` и сумма резолвятся корректно;
- шаблоны и реквизиты разрешаются без ошибок;
- bePaid regression PASS;
- production-документ по 2 USD не создан.

После этого подготовить точный список четырёх офферов и per-offer before/after.

Для каждого оффера создавать новые уникальные `scenario.id`, не копировать одинаковый UUID между офферами.

---

# **Дополнительный guard**

Проверить, не активирует ли наличие `document_scenarios` автоматическую генерацию через:

```text
canonical-document-payment-hook
```

Для консультаций должен остаться только ручной режим.

Если payment hook автоматически генерирует документ по любому enabled scenario, до pilot добавить явный guard существующей конфигурацией, а не новой архитектурой.

Нельзя случайно включить автогенерацию актов для консультаций.

---

# **Статусы approve**

```text
I. Runtime deployment gate = APPROVED
II. Pilot document_scenarios на f71b5ed3 = APPROVED после runtime PASS
III. Rollout на остальные 4 оффера = NOT APPROVED до pilot proof
```

Выполняй сначала runtime deployment gate. После PASS переходи к pilot. Rollout не начинать.

&nbsp;

План (revised): PATCH-STRIPE-CONSULTATION-DOCUMENT-SCENARIOS-V1 + RUNTIME-DEPLOYMENT-GATE

Архитектурный реcет: Stripe = только платёжный провайдер. SOT документа = `tariff_offers.meta.document_scenarios[]` + `document_templates` + `executors`, уже используемые в BPiZ. Никаких новых executor / шаблонов / PL-логики в этом патче. Discovery только; execute не начинать.

================================================================

1. Архитектурный принцип (фиксируется в плане)

================================================================

- bePaid payment → existing document flow.
- Stripe payment → ровно тот же existing document flow.
- Единственная техническая разница для документа: `provider='stripe'`, `payment_channel='card'` (уже закрыто в коде PATCH-STRIPE-DOCUMENT-ACT-CHECK-V1; ждёт runtime gate).
- Источник истины для исполнителя/реквизитов/шаблона/нумерации — `tariff_offers.meta.document_scenarios[].{template_id, executor_id, …}`, а НЕ Stripe account.
- Сравнение `acquiring_connections.business_name` ↔ `executors.full_name` из текущего scope **исключено**.
- `PATCH-STRIPE-EXECUTOR-V1` и `PATCH-STRIPE-CONSULTATION-TEMPLATE-V1` из обязательных блокеров **сняты**. Появятся только если discovery докажет технический дефицит существующего канона.

================================================================
2. Что НЕ создаём в этом патче
================================================================

- новые `executors`;
- новые `document_templates`;
- новые банковские реквизиты / юр. сущности;
- новые правила нумерации;
- новый workflow «момент оказания услуги»;
- никакой Stripe-специфичной document-архитектуры.

================================================================
3. Existing BPiZ document flow — рабочий пример
================================================================

3.1 Рабочий BPiZ-оффер (product_id=11c9f1b8-0355-4753-bd74-40b42aa53616):

```
offer_id (FULL)     : c5781abf-0376-4e1f-91dc-99773906ee77
offer_id (BUSINESS) : bc0f7a90-df41-4a86-b2ea-2a1234d0d534

document_scenarios (одинаковая структура у обоих):
  [
    { id, is_enabled:true, payer_type:"individual",
      payment_channels:["card","erip","apple_pay","google_pay"],
      template_id : 7caee05d-0410-4b2f-85b7-f7af1463cac5,   // Счёт-акт ФЛ
      executor_id : d0c7fe75-1192-40a9-bbae-b652b69e6882,   // ЗАО "АЖУР инкам"
      requires_required_requisites:true },
    { id, is_enabled:true, payer_type:"legal_entity",
      payment_channels:["bank_transfer"],
      template_id : 4fa3160f-f979-4dbe-b069-5b0cb2c7bb05,   // Счёт-акт ЮЛ
      executor_id : d0c7fe75-1192-40a9-bbae-b652b69e6882,
      requires_required_requisites:true }
  ]
document_defaults: { generate_act:true, service_name, unit, … }   // не обязательно для consultation
```

Оба шаблона активны (`document_templates.is_active=true`, `document_type='act'`, scope='act') и используют `file_name_template` с `{{field:FLD-…}}` (биллинговые токены, скоп `billing`).

3.2 UI/SOT, которым это настраивается:

- компонент: `src/components/admin/product/OfferDocumentScenariosCard.tsx` (Sprint 12);
- путь: страница редактирования тарифа/оффера в админке продукта;
- storage: `tariff_offers.meta.document_scenarios[]` (массив) + опционально `document_defaults`;
- writer: тот же admin-UI через стандартный update `tariff_offers.meta` (см. `useTariffOffers`);
- frontend mirror: `src/utils/resolveDocumentScenario.ts` + `src/lib/documents/purchaseDocumentRules.ts`;
- backend mirror: `supabase/functions/_shared/document-scenario-resolver.ts` + `supabase/functions/_shared/purchase-document-rules.ts`.

3.3 Путь «Сформировать документ» (как сейчас в /purchases для BPiZ):

- кнопка `canGenerateDocument(order, payments, tariffOffers, ctx)` → `isOfferDocumentEnabled` → `resolveDocumentScenario(meta, payment_channel, payer_type)`;
- если scenario найден → вызов `canonical-document-generate-strict` с `order_id`;
- внутри функции: `snapshotOrderDocumentData(order)` (сумма/валюта/клиент/payment_channel) + `derivePaymentChannel(payment_row)` → выбор scenario → рендер по `template_id` + `executor_id` → запись в `ai_generated_documents`.

Для Stripe-оплаты этот же путь работает, потому что `derivePaymentChannel({provider:'stripe',…})` уже возвращает `'card'` (после Phase 1 кода). Ждёт только runtime gate (часть B).

================================================================
4. Валюта документа — берётся из order/payment, не из products_v2
================================================================

- `products_v2.currency='BYN'` для «Платной консультации» — это лендинг-валюта, НЕ обязательная валюта документа.
- Документ должен использовать фактическую `orders_v2.currency` + `orders_v2.final_price` / `paid_amount`, а также `payments_v2.amount` / `payments_v2.currency`.
- Текущий шаблон `7caee05d` (Счёт-акт ФЛ) использует `{{field:FLD-…}}` для суммы/валюты, которые резолвятся из заказа (см. `document-resolver-v2/resolver.ts` + `_shared/typed-fld-mapping.ts`). Это означает: USD/EUR/PLN/BYN — динамические значения.
- **Дефицит шаблона по валюте заранее НЕ предполагаем.** Доказательство достаточности существующих FLD-полей выполняется в pilot (см. §6) на реальной первой Stripe-оплате — не на технической 2 USD.
- Если pilot покажет фактический дефицит (нет FLD для валюты, неверный формат числа, отсутствует НДС/налоги PL, и т.д.) → отдельный backlog PATCH-CONSULT-TEMPLATE-CURRENCY-V1. До этого момента **доп. шаблон не создаём**.

================================================================
5. Discovery Step B по-новому (без Stripe-юр. вопросов)
================================================================

5.1 Рабочий пример BPiZ — см. §3.1. Шаблоны `7caee05d` (FL) и `4fa3160f` (UL) + исполнитель `d0c7fe75` — действующая комбинация продакшна.

5.2 UI/SOT настройки — см. §3.2. Тот же `OfferDocumentScenariosCard.tsx` будет открыт для каждого консультационного оффера через стандартный admin-путь редактирования тарифа.

5.3 Техническая применимость к консультациям (НЕ юридическая):

- `document_type='act'` доступен ✅;
- `template_id` выбирается из списка активных шаблонов ✅;
- сумма динамическая (из `orders_v2.final_price`) ✅;
- валюта динамическая (из `orders_v2.currency`) ✅ (см. §4 — подтверждается pilot-проверкой);
- реквизиты исполнителя берутся из `executors` по `executor_id` сценария ✅;
- клиентские реквизиты — из заказа/профиля / `client_legal_details` ✅;
- `payment_channel='card'` поддерживается scenario с `payment_channels:["card",…]` ✅.

5.4 Exact JSON для pilot-оффера (`f71b5ed3-…`, «Несрочная консультация»):

```jsonc
// tariff_offers.meta.document_scenarios (полная замена, write-only-canonical)
[
  {
    "id": "<uuid v4>",
    "is_enabled": true,
    "payer_type": "individual",
    "payment_channels": ["card"],
    "template_id": "7caee05d-0410-4b2f-85b7-f7af1463cac5",
    "executor_id": "d0c7fe75-1192-40a9-bbae-b652b69e6882",
    "requires_required_requisites": false
  },
  {
    "id": "<uuid v4>",
    "is_enabled": true,
    "payer_type": "legal_entity",
    "payment_channels": ["card", "bank_transfer"],
    "template_id": "4fa3160f-f979-4dbe-b069-5b0cb2c7bb05",
    "executor_id": "d0c7fe75-1192-40a9-bbae-b652b69e6882",
    "requires_required_requisites": true
  }
]
```

`document_defaults` для pilot НЕ устанавливаем (сценарий имеет приоритет, defaults — fallback).

================================================================
6. Pilot → Rollout на 5 офферов
================================================================

Все 5 офферов идентичны по природе (pay_now, full_payment, one-time, consultation, acquiring=stripe_poland) → одинаковый сценарий применим ко всем.

Pilot:

- 1 оффер: `f71b5ed3-27dd-419d-b922-ad529192b58a` (Несрочная консультация).
- Способ настройки: штатный admin-UI (`OfferDocumentScenariosCard`) либо точечный SQL-патч (если UI-путь не доступен текущему оператору).
- Resolver proof:
  - `canGenerateDocument(...)` для тестового payload (provider='stripe', card) → `enabled=true, source='scenario'`;
  - bePaid regression: офферы FULL/BUSINESS по-прежнему дают тот же scenario.
- Без production-номера: на технической 2 USD операции номер не присваиваем (§8).

Rollout (после pilot PASS на первой реальной Stripe-оплате или подтверждённом resolver-доказательстве):

- остальные 4 оффера: 25880f13, c244bbd4, 7a333f66, 369c911a;
- единый идентичный JSON;
- per-offer UPDATE с STOP-guards: `meta NOT containing 'document_scenarios'` (идемпотентность), `offer.is_active=true`, `template_id/executor_id exist & active`.

================================================================
7. Момент формирования — manual (как сейчас в BPiZ)
================================================================

Используем существующий ручной режим:

- пользователь жмёт «Сформировать документ» в `/purchases` после оплаты;
- никакого нового статуса услуги, CRM-триггера, payment-hook automation для консультаций НЕ вводим;
- если в будущем владелец проекта решит автоматизировать через `canonical-document-payment-hook` — отдельный патч, не в этом scope.

================================================================
8. Операция 2 USD (Stripe test order 849c68b7-…)
================================================================

- Техническая тестовая операция, остаётся таковой.
- НЕ присваивать production-номер.
- НЕ создавать реальный бухгалтерский документ.
- Использовать только:
  - resolver proof (frontend+backend: `canGenerateDocument` → enabled=true);
  - UI availability proof (кнопка «Сформировать» появилась в /purchases для этого заказа после A-patch).
- Если безопасного preview без записи нет в `canonical-document-generate-strict` (по текущему коду — не подтверждено) → дождаться первой реальной Stripe-оплаты консультации.

================================================================
9. Runtime deployment gate (часть B, независимый блок)
================================================================

Не зависит от executor/template работы. Только редеплой потребителей уже изменённых shared-файлов.

9.1 Минимальный deploy scope (7 функций, подтверждённые consumers):

```
canonical-document-generate-strict
canonical-document-payment-hook
canonical-document-regenerate
canonical-document-generate
canonical-deal-document-overrides
document-field-resolver-v2
document-field-resolver-v2-snapshot
```

9.2 Frontend (`src/utils/derivePaymentChannel.ts`) попадёт в production через штатный Publish Lovable; отдельного релиз-канала нет.

9.3 Runtime verify (proof `.lovable/proofs/stripe_document_payment_channel_runtime_v1.md`, после approve и deploy):

1. Build clean.
2. 7 функций задеплоены с timestamp.
3. Runtime-вызов `document-field-resolver-v2` (не grep):
  - stripe / no method → `card`;
  - bepaid / last4 → `card`;
  - bepaid / is_erip=true → `erip`;
  - admin без test_payment → `other` (regression);
  - admin_test + test_payment=true → `card` (regression).
4. Frontend resolver = backend resolver (shared cases, diff пуст).
5. bePaid regression на реальной оплате — канал тот же.
6. `ai_generated_documents` count до/после совпадает (gate не пишет ничего).

================================================================
10. Что возвращается этим планом
================================================================

- Точный рабочий пример BPiZ (offer + scenarios + template + executor).
- Существующий UI/SOT подключения документов к офферу (`OfferDocumentScenariosCard`).
- Exact `document_scenarios` JSON для pilot-оффера консультации.
- Подтверждение: сумма и валюта берутся из `orders_v2` / `payments_v2`, а не из `products_v2.currency`.
- Подтверждение: существующий шаблон использует реквизиты исполнителя из `executors` (`d0c7fe75`) и клиентские реквизиты из заказа/профиля.
- Pilot → rollout план на остальные 4 оффера через тот же канонический механизм.
- Отдельный минимальный runtime deployment gate (7 функций) без зависимости от executor/template работы.
- PATCH-STRIPE-EXECUTOR-V1 и PATCH-STRIPE-CONSULTATION-TEMPLATE-V1 — НЕ создаются. Появятся только если pilot докажет технический дефицит.

Execute не начинать. Ожидается approve на:
(I) точечный patch document_scenarios pilot-оффера `f71b5ed3-…` (точный JSON в §5.4);
(II) runtime deployment gate на 7 функций;
(III) rollout на оставшиеся 4 оффера после pilot PASS.

Эти три approve можно дать одним сообщением или по отдельности.