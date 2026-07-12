# да, согласен, с учетом правок:

План в целом правильный, но до реализации нужно исправить несколько архитектурных моментов. Иначе soft-delete, дедупликация и выдача доступа могут работать противоречиво.

# Обязательные правки к плану

## 1. Не создавать отдельный discovery-файл

Раздел:

```text
.lovable/discovery/payments_management_v2.md

```

убрать.

Diagnose и последующие отчёты добавлять в существующий:

```text
.lovable/plan.md

```

строго append-only отдельными разделами:

```text
## PATCH-PAYMENTS-MANAGEMENT-V2 — DIAGNOSE
## PATCH-PAYMENTS-MANAGEMENT-V2 — PLAN
## PATCH-PAYMENTS-MANAGEMENT-V2 — DRY RUN
## PATCH-PAYMENTS-MANAGEMENT-V2 — EXECUTE
## PATCH-PAYMENTS-MANAGEMENT-V2 — VERIFY

```

Не создавать новый документ только для discovery.

---

## 2. Не ослаблять уникальность платежа partial-индексом

Предложение:

```sql
UNIQUE (provider, provider_payment_id)
WHERE is_deleted = false

```

не принимать автоматически.

Оно позволит после soft-delete создать новую активную строку с тем же внешним ID. Это противоречит recreation guard: повторный webhook потенциально сможет создать второй платёж вместо заблокированного tombstone.

Целевая модель:

```text
удалённая строка остаётся tombstone
внешний provider_payment_id остаётся занятым
повторный webhook на тот же ID → ignored_admin_deleted
новая строка не создаётся

```

Поэтому в Diagnose сначала определить существующий dedup key:

- `provider_payment_id`;
- `external_id`;
- `provider_event_id`;
- `import_ref`;
- комбинация provider + external identifier.

После этого:

- сохранить глобальную уникальность tombstone;
- upsert должен находить удалённую строку;
- если `is_deleted=true`, не восстанавливать её;
- писать audit/orphan event.

Partial unique допустим только если отдельно создаётся полноценная неизменяемая таблица tombstones с глобальной уникальностью. Для текущего патча это излишне.

---

## 3. Soft-delete требует обновления всех читателей, не только UI

Недостаточно добавить:

```text
is_deleted=false

```

в `useUnifiedPayments`.

Нужно провести inventory всех читателей `payments_v2`:

- статистические RPC;
- серверные hooks;
- reconciliation;
- бухгалтерские отчёты;
- CRM;
- карточка сделки;
- CSV;
- PaymentDocumentsDrawer;
- refunds;
- комиссии;
- recurring lifecycle;
- admin stats;
- payment queues.

Каждый финансовый расчёт должен использовать только активные платежи:

```sql
COALESCE(is_deleted, false) = false

```

Иначе платёж исчезнет из таблицы, но останется в выручке или `paid_amount`.

В Diagnose обязательно дать таблицу:


| Reader            | Сейчас учитывает deleted | Требуется изменение |
| ----------------- | ------------------------ | ------------------- |
| `/admin/payments` | &nbsp;                   | &nbsp;              |
| статистика        | &nbsp;                   | &nbsp;              |
| order totals      | &nbsp;                   | &nbsp;              |
| reconciliation    | &nbsp;                   | &nbsp;              |
| CSV               | &nbsp;                   | &nbsp;              |
| CRM               | &nbsp;                   | &nbsp;              |


---

## 4. При soft-delete нужно определить судьбу связи с заказом

План одновременно говорит:

- soft-delete сохраняет запись;
- платёж отвязывается от сделки.

Это нужно формализовать.

При `payment_only`:

```text
payments_v2.is_deleted = true
payments_v2.order_id = NULL
старый order_id сохраняется в deletion_context/audit

```

Добавить:

```text
deletion_context jsonb

```

либо сохранить полный before snapshot в `audit_logs`.

В нём должны быть:

- прежний `order_id`;
- profile/contact;
- company;
- product/tariff;
- provider external ID;
- сумма;
- валюта.

Контакт и компания физически не меняются и не удаляются.

Если принято решение оставить `order_id` на soft-deleted строке для аудита, тогда это уже не «отвязать». В UI и расчётах она должна полностью игнорироваться. Выбрать один контракт и явно зафиксировать его после Diagnose.

---

## 5. Удаление платежа и сделки должно учитывать другие платежи

Режима:

```text
payment_only
payment_and_order

```

недостаточно, если сделка содержит несколько платежей.

Перед удалением показать:

```text
По сделке найдено платежей: N
Текущий платёж: X
Другие платежи: Y

```

Если есть другие платежи, возможны только явно подтверждённые варианты:

### A. Только текущий платёж

```text
текущий payment soft-delete
сделка остаётся
остальные платежи остаются
order totals пересчитываются

```

### B. Текущий платёж и сделка, остальные платежи сохранить

```text
текущий payment soft-delete
canonical delete-order
другие payments отвязать от order

```

### C. Сделка и все её платежи

```text
canonical delete-order
все связанные payments soft-delete

```

Вариант C должен требовать отдельного подтверждения со списком всех платежей и общей суммой.

Если существующий delete-order helper не поддерживает вариант B, не расширять scope молча: отразить это в Diagnose и предложить минимальное расширение canonical helper.

---

## 6. Добавить обязательный dry-run удаления

До фактического удаления `admin-payment-delete` должен поддерживать:

```text
dry_run = true

```

Dry-run возвращает:

- платёж;
- сделку;
- другие платежи сделки;
- связанные entitlement sources;
- subscription lineage;
- provider events;
- statement/reconcile связи;
- что будет soft-deleted;
- что будет отвязано;
- что будет пересчитано;
- что будет заблокировано.

Execute разрешён только с checksum/token результата dry-run, чтобы между preview и удалением не изменился состав связей.

Пример:

```text
preview_token
payment_version / updated_at
order_version / updated_at

```

---

## 7. Ручной grant-access возможен только через сделку/order

План допускает standalone payment и одновременно опциональный grant-access.

Нужно разделить:

### Standalone payment

```text
order_id = null
доступ не выдаётся

```

### Payment, связанный со сделкой

```text
order_id заполнен
order totals пересчитаны
полная оплата подтверждена
grant-access-for-order разрешён

```

Если администратор выбрал продукт/тариф, но не выбрал сделку:

- либо доступ недоступен;
- либо сначала создаётся canonical order через существующий admin-create-order/deal path.

Создавать entitlement напрямую или вызывать `grant-access-for-order` без полноценного заказа запрещено.

---

## 8. Ручное создание должно иметь свою идемпотентность

Одной проверки `provider_payment_id` недостаточно: администратор может дважды нажать кнопку.

В `admin-payment-create` добавить обязательный:

```text
idempotency_key

```

Он генерируется UI один раз при открытии/отправке формы и переиспользуется при retry.

Server-side:

```text
actor_user_id + idempotency_key

```

должны возвращать существующий результат, а не создавать новый платёж.

Дополнительно:

- внешний ID — provider-level dedup;
- idempotency key — request-level dedup.

---

## 9. Canonical origin нужно сначала проверить

Правило:

```text
manual_admin

```

логичное, но до миграции нужно проверить текущий CHECK и фактические значения origin.

Не переименовывать существующие origin:

- `rr_installment`;
- Stripe origins;
- bePaid origins;
- imports.

Добавить только:

```text
manual_admin

```

если его ещё нет.

Метка UI:

```text
origin = manual_admin → Вручную
всё остальное → Авто

```

---

## 10. RBAC в плане указан неточно

Не фиксировать:

```ts
has_role_v2(uid, 'superadmin')

```

В текущем проекте legacy helper может принимать `superadmin`, а canonical role code в `user_roles_v2` ранее использовался как `super_admin`. Текущий healthcheck, например, вызывает legacy `has_role(..., 'superadmin')`, а не `has_role_v2` с этой строкой.

В Diagnose определить и переиспользовать ровно тот helper, который используется текущим canonical удалением сделки.

Ожидаемый принцип:

```text
admin OR super_admin

```

Но конкретную функцию и enum не угадывать.

---

## 11. Edge-функции должны быть internal admin-only и не доверять frontend

`admin-payment-create` и `admin-payment-delete` должны:

1. проверить JWT;
2. получить user ID сервером;
3. проверить canonical admin role;
4. загрузить payment/order из БД;
5. повторно проверить все связи;
6. не принимать из UI:
  - контакт как доверенный факт;
  - сумму сделки;
  - наличие доступа;
  - число связанных платежей;
  - provider mode;
  - статус полной оплаты.

Frontend передаёт только выбор пользователя. Все последствия рассчитываются сервером.

---

## 12. Для ручного RR нельзя подделывать battle/test как provider event

В форме RR-платежа поле mode не должно автоматически браться из текущего режима интеграции и выглядеть как реальная операция РР.

Ручная запись:

```text
provider = rr
origin = manual_admin

```

В metadata:

```json
{
  "manual_entry": true,
  "rr_mode_at_entry": "test|battle",
  "not_provider_confirmed": true
}

```

Она не должна:

- создавать `provider_events` как будто пришёл webhook;
- подтверждать RR healthcheck;
- учитываться как API reachability proof;
- считаться реальной боевой транзакцией РР.

Аналогично ручные Stripe/bePaid не подтверждают webhook runtime.

---

## 13. Банковская карточка

Для `bank` сделать отдельную полноценную секцию в glassmorphism UI.

Обязательные поля:

- банк;
- сумма;
- валюта;
- дата поступления;
- плательщик;
- назначение.

Дополнительные:

- номер платёжного поручения;
- банковский reference;
- УНП;
- номер счёта/инвойса;
- счёт получателя;
- комиссия;
- комментарий.

`bank_name` не ограничивать только Паритетбанком. Значение вводится или выбирается:

```text
Паритетбанк
другой банк

```

Provider при этом всегда:

```text
bank

```

---

## 14. UI glassmorphism

Использовать существующие дизайн-токены и компоненты проекта, а не отдельную стилизацию.

Требования:

```text
backdrop-blur
полупрозрачный background
тонкая border
адаптивный dark/light
мягкая shadow
без жёстко заданных несистемных цветов

```

Структура CreatePaymentDialog:

```text
Header
→ Провайдер
→ Основные данные
→ Связи
→ Данные провайдера
→ Учёт в сделке
→ Доступ
→ Итоговый preview
→ Сохранить

```

Перед сохранением показать итоговую карточку:

```text
Создаётся ручной платёж Stripe
1000 BYN
Сделка ORD-...
Будет зачтён в оплату
После оплаты доступ будет выдан

```

---

## 15. Добавить массовое удаление

Для очистки 12 RR-тестов нужен штатный bulk-flow.

В таблице:

```text
checkbox rows
Удалить выбранные

```

Bulk dry-run должен группировать:

- standalone;
- связанные со сделками;
- сделки с другими платежами;
- доступы;
- blocked items.

По умолчанию bulk выполняет только:

```text
payment_only
revoke_access = false

```

Удаление связанных сделок в bulk запрещено либо требует отдельного второго подтверждения по каждой сделке.

Операция должна вернуть результат по каждой строке:

```text
deleted
already_deleted
blocked
failed

```

---

# Исправленный порядок этапов

```text
1. Diagnose в .lovable/plan.md
2. Утверждение точной модели FK/dedup/RBAC
3. Миграция soft-delete + provider=bank + origin=manual_admin
4. Обновление всех readers на is_deleted=false
5. Canonical admin-payment-create
6. Canonical admin-payment-delete dry-run/execute
7. Интеграция с существующим delete-order helper
8. Recreation guard во всех provider upsert/reconcile paths
9. ProviderBadge + SourceBadge + фильтры
10. Glass CreatePaymentDialog
11. Glass DeletePaymentDialog
12. Bulk delete
13. Runtime smoke
14. Удаление 12 RR test payments
15. RR mode-lock
16. RR battle go-live

```

# Дополненный DoD

Кроме пунктов плана обязательно подтвердить:

```text
глобальный dedup tombstone сохранён
deleted платеж не восстанавливается webhook
все статистические readers исключают deleted
manual create защищён idempotency_key
standalone payment не выдаёт доступ
grant возможен только через canonical order
multi-payment deal deletion корректен
bulk delete 12 RR tests работает
manual RR/Stripe/bePaid не имитирует provider webhook

```

Статус:

```text
PATCH-PAYMENTS-MANAGEMENT-V2:
  PLAN APPROVED WITH CORRECTIONS
  DIAGNOSE AUTHORIZED
  CODE CHANGES BLOCKED UNTIL DIAGNOSE REPORT

```

Главное: после Diagnose не начинать сразу весь backend. Сначала принести точную карту текущего delete-order helper, dedup-ключей и всех readers `payments_v2`, чтобы согласовать фактическую схему без риска сломать платежи и подписки.

&nbsp;

План: PATCH-PAYMENTS-MANAGEMENT-V2

Формат: Diagnose → Plan → Dry run → Execute → Verify (docs/ENGINEERING_RULES.md).

## 0. Модель провайдеров (жёсткое правило)

Только 4 провайдера в `payments_v2.provider`:

- `bepaid`
- `stripe`
- `rr`
- `bank` (новый — ручной учёт банковских оплат по счёту)

Ручной ввод — это НЕ провайдер. Признак способа внесения хранится в `payments_v2.origin`:

- `webhook` / `api` / `file_import` — автомат
- `manual_admin` — ручной ввод любого из 4 провайдеров

Никаких `manual`, `other`, `custom` как провайдера. Существующий CHECK/enum на `provider` расширяется до `bank`, не более.

## 1. Инварианты

- Подписочная и grant-access логика (Stripe/bePaid/RR) не трогается.
- Контакт и компания никогда не удаляются вместе с платежом.
- Сделка удаляется ТОЛЬКО через существующий canonical delete-order helper — новый параллельный удалятор не пишем.
- Auto-платежи (webhook/api) нельзя редактировать как ручные; удалять — можно с записью tombstone.
- Soft-delete: `deleted_at`, `deleted_by`, `deleted_reason`, `is_deleted`. Скрытые записи не попадают в UI, статистику, CSV.
- Recreation guard: при повторном webhook на удалённую запись (по `(provider, provider_payment_id)` или `import_ref`) — не воскрешать, писать в `provider_webhook_orphans` / audit.
- Каждое создание/удаление в `audit_logs` (кто, что, до/после, причина).

## 2. Diagnose (обязательно до кода)

Собрать в короткий отчёт `.lovable/discovery/payments_management_v2.md`:

1. Canonical delete-order helper: RPC/edge-функция, что она делает с payments_v2, как её вызывает UI карточки сделки.
2. Все FK и логические связи `payments_v2` → `orders_v2`, `provider_events`, `access_grant_ledger`, `entitlement_sources`, `subscriptions_v2`, `order_notification_deliveries`, `payment_reconcile_queue`, `bepaid_statement_rows`.
3. Кто пересчитывает `orders_v2.paid_amount / status` (триггер? edge? RPC?). Переиспользовать существующий пересчётчик.
4. Точки reconcile/upsert для bepaid/stripe/rr, где нужен guard против воскрешения.
5. Текущее поведение фильтра `provider` в `PaymentsFilters.tsx`, `PaymentsStatsPanel`, CSV-экспорт, `PaymentsTable`.
6. Есть ли уже enum на `payments_v2.provider` или это text + CHECK.

Diagnose-отчёт — часть DoD этапа 1.

## 3. Backend (add-only)

### 3.1 Миграция

- Добавить колонки в `payments_v2`: `is_deleted bool default false`, `deleted_at timestamptz`, `deleted_by uuid`, `deleted_reason text`.
- Партиальный уникальный индекс `(provider, provider_payment_id) where is_deleted=false and provider_payment_id is not null` — сохранить дедуп, но позволить tombstone.
- Расширить допустимые значения `provider` до `{bepaid, stripe, rr, bank}` (CHECK или enum add value).
- Обновить существующие view/RLS/GRANT где нужно фильтровать `is_deleted=false`.

### 3.2 Edge / RPC (canonical)

- `admin-payment-create` (edge, admin-only): валидирует provider ∈ 4, origin='manual_admin', создаёт запись, опционально линкует к order, инициирует пересчёт сделки, опционально — grant-access через существующий canonical путь. Никогда не вставляет entitlement напрямую.
- `admin-payment-delete` (edge, admin-only): режимы `payment_only` | `payment_and_order`. В режиме `payment_and_order` дергает существующий canonical delete-order. Всегда soft-delete платежа, tombstone, audit_log, пересчёт сделки, опционально revoke access через canonical revoke.
- Guard в reconcile/upsert: перед upsert смотрит tombstone по `(provider, provider_payment_id)` и пропускает воскрешение с записью в orphans/audit.

Обе функции идемпотентны; повторный вызов на удалённой записи → no-op с audit.

## 4. Frontend

### 4.1 Общие

- Провайдер-модель: `type PaymentProvider = 'bepaid' | 'stripe' | 'rr' | 'bank'`, отдельная метка `SourceKind = 'auto' | 'manual'` (по origin).
- Красивые бейджи 4 провайдеров + маленький sublabel «Авто / Вручную». Единый компонент `ProviderBadge`, `SourceBadge`.
- Стиль: glassmorphism через существующий `GlassFilterPanel` / стеклянные карточки, консистентно с текущим админом.

### 4.2 Фильтры / статистика / CSV

- `PaymentsFilters.tsx`: значения провайдера — `all | bepaid | stripe | rr | bank`. Добавить фильтр «Способ внесения» (`all | auto | manual`).
- `PaymentsStatsPanel`, `PaymentsTable`, CSV — учитывать 4 провайдера, скрывать `is_deleted=true`.

### 4.3 Создание платежа

- Кнопка «Добавить платёж» в `AdminPaymentsHub` / шапке `PaymentsTabContent`.
- Drawer/Modal `CreatePaymentDialog` в стеклянном стиле, блоки A–E из ТЗ.
- Блок C «Данные провайдера» — динамическая схема:
  - `bepaid`: external id, комиссия, статус, дата;
  - `stripe`: charge/payment_intent id, комиссия, дата;
  - `rr`: rr order id, режим (test/battle read-only из настроек);
  - `bank`: банк, № платёжки, reference, плательщик, УНП, назначение, счёт/инвойс.
- Блок E: чекбокс «Выдать доступ после сохранения» (активен только при выбранном продукте/тарифе и статусе successful).
- Отправка → `admin-payment-create`.

### 4.4 Удаление платежа

- Действие «Удалить» в строке таблицы и в `PaymentDocumentsDrawer` (карточке платежа).
- `DeletePaymentDialog` (glassmorphism):
  - Показывает провайдер/сумма/дата/контакт/компания/сделка/продукт.
  - Radio: «Удалить только платёж» / «Удалить платёж и связанную сделку».
  - Если у сделки есть другие платежи — предупреждение о пересчёте.
  - Checkbox «Отозвать доступ, выданный этим платежом».
  - Textarea «Причина удаления» (обязательна).
- Отправка → `admin-payment-delete`.
- Если сделки нет — режим фиксирован `payment_only`, radio скрыт.

### 4.5 Реестр

- В `PaymentsTable` — новая колонка/бейдж провайдера (4 значения) и метка Авто/Вручную.
- `is_deleted` не отображаются; отдельный тумблер «Показать удалённые» — вне scope V2 (backlog).

## 5. Порядок исполнения (по этапам ENGINEERING_RULES)

1. **Diagnose** — отчёт `.lovable/discovery/payments_management_v2.md`. Утвердить.
2. **Backend миграция** (soft-delete колонки + `bank` в provider + индекс) — dry run по linter, apply.
3. **Edge `admin-payment-create` + `admin-payment-delete**` + guard в reconcile.
4. **Frontend фильтры/бейджи/CSV** на 4 провайдера + Auto/Manual.
5. **UI создания** — форма, 4 сценария.
6. **UI удаления** — confirm-modal с выбором судьбы сделки + revoke access.
7. **Runtime smoke** (см. §6).
8. **RR test cleanup** — через новый `admin-payment-delete` (payment_only), без спец-скрипта.
9. Только после DoD PASS — отдельно RR battle go-live (вне этого патча).

## 6. Runtime smoke (обязательно для DoD)

Создание: ручные bepaid / stripe / rr / bank; bank без сделки; bank со сделкой; частичный платёж; полный платёж с выдачей доступа.
Удаление: standalone payment; payment_only при существующей сделке; payment_and_order через canonical helper; с revoke access; повторное удаление (идемпотентность); проверка, что webhook на удалённый provider_payment_id не воскрешает запись.
Реестр: фильтры 4 провайдеров + Auto/Manual; статистика; CSV; soft-deleted невидимы.

## 7. Definition of Done

`PATCH-PAYMENTS-MANAGEMENT-V2: VERIFIED, PASS` со всеми пунктами §18 исходного ТЗ. Отчёт append-only в `.lovable/plan.md`.

## Технические детали

- Схема БД: только add-only колонки + расширение допустимых provider. Никакого drop/rename.
- Grant/revoke access вызываются исключительно через существующие canonical пути (`grant-access-for-order` и парный revoke), никаких прямых insert в `entitlements` / `access_grant_ledger`.
- Пересчёт `orders_v2` — через существующий пересчётчик, выявленный на этапе Diagnose. Если такого нет — маленькая SQL-функция `recalc_order_totals(order_id)` add-only.
- RLS: `admin-payment-create` / `admin-payment-delete` вызывают admin-only проверку `has_role_v2(uid,'admin') OR has_role_v2(uid,'superadmin')` (canonical RBAC v3, как в bepaid-get-receipt).
- Soft-delete фильтр `is_deleted=false` добавляется в клиентские запросы `payments_v2` и в существующие view.