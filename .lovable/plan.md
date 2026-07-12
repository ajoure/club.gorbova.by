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
---

## PATCH-PAYMENTS-MANAGEMENT-V2 — DIAGNOSE

Diagnose-отчёт, append-only. Код не менялся, миграций не создавалось. Все данные получены read-only из БД и репозитория.

### D1. Фактические provider / origin в БД

`select provider, count(*) from payments_v2 group by 1`:

| provider     | count |
|--------------|-------|
| bepaid       | 5955  |
| admin        | 319   |
| rr           | 12    |
| admin_test   | 8     |
| stripe       | 5     |

`select origin, count(*) from payments_v2 group by 1`:

| origin              | count |
|---------------------|-------|
| bepaid              | 4315  |
| statement_sync      | 1672  |
| card_verification   | 229   |
| payment_link        | 57    |
| manual_adjustment   | 13    |
| rr_installment      | 12    |
| public_link         | 1     |
| (NULL)              | остальное |

Выводы:
1. Целевая модель «4 провайдера {bepaid, stripe, rr, bank}» пока НЕ соответствует данным: 319 строк `provider='admin'` и 8 строк `provider='admin_test'` не входят ни в одну из 4-х корзин. Это унаследованный ручной ввод.
2. Нужен отдельный шаг backfill/классификация ПЕРЕД включением жёсткого CHECK/enum, иначе миграция упадёт. Backfill не входит в scope V2 и должен быть отдельным подзадачей DIAGNOSE→PLAN до фактической миграции. До backfill CHECK нельзя ужесточать — только расширять список валидных значений допустимо.
3. `origin='manual_admin'` в БД отсутствует. `manual_adjustment` (13 строк) — семантически близкое legacy-значение, но НЕ равнозначно (использовалось для правок сумм, не для полноценного ручного создания). Не переиспользуем — добавляем новое `manual_admin`.
4. Никаких `custom / other / manual` в `provider` нет — целевое ограничение не конфликтует с реальными данными за пределами `admin/admin_test`.

### D2. Схема `payments_v2` и уникальные индексы

Провайдер-статус: `provider text` (без enum, без CHECK — легко расширяемо).

Существующие UNIQUE-индексы, критичные для дедупа/tombstone-стратегии:

- `idx_payments_v2_provider_uid` — `UNIQUE (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL`
- `idx_payments_v2_provider_unique` — дубликат того же (redundant)
- `uq_payments_v2_provider_payment` — ещё один дубликат
- `idx_payments_v2_unique_provider_payment_id` — `UNIQUE (provider_payment_id) WHERE provider_payment_id IS NOT NULL AND provider='bepaid'`
- `payments_v2_rr_one_succeeded_per_order` — `UNIQUE (order_id) WHERE provider='rr' AND status='succeeded'` — важно: не даст создать второй успешный RR-платёж на один order, даже после soft-delete первого.

Вывод по правке пункта 2 плана (глобальная уникальность tombstone):
- Три копии `UNIQUE(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL` уже дают требуемый глобальный dedup БЕЗ фильтра `is_deleted=false`. Соответственно, план сохраняем: **partial unique по `is_deleted=false` НЕ вводим**. Tombstone-строка остаётся в общем уникальном индексе и блокирует пересоздание с тем же `(provider, provider_payment_id)`.
- Ре-инкарнация RR-успеха на тот же order физически заблокирована `payments_v2_rr_one_succeeded_per_order`. Для восстановления после soft-delete нужен явный админский flow (в V2 не входит).
- Три redundant-индекса стоит унифицировать (drop лишних) отдельным cleanup-патчем; в scope V2 не входит.

### D3. Foreign keys и каскады

`payments_v2` → outbound:
- `order_id` → `orders_v2(id)` **ON DELETE CASCADE** — критично: удаление ордера физически удаляет все его платежи БД-каскадом. Soft-delete не «переживает» удаление ордера через FK, поэтому в режиме `payment_and_order` фактически будет hard-delete платежей вместе с ордером — это тот же уже используемый путь через `useDealsBulkDelete`.
- `profile_id` → `profiles(id)` **ON DELETE SET NULL** — контакт можно удалить без сноса платежа. Соответствует инварианту «контакт не удаляется вместе с платежом».
- `reference_payment_id` → self.

`payments_v2` → inbound (кого сломает hard-delete платежа):
- `installment_payments.payment_id` — **без ON DELETE**, значит hard-delete упадёт, если есть installment. Для installment-платежей нужен soft-delete (штатный путь V2).
- `statement_lines.payment_id` — то же, hard-delete упадёт при наличии импорта выписки.
- `payments_v2.reference_payment_id` — существующий bulk-delete нуллифицирует эти ссылки перед удалением (см. `useDealsBulkDelete`, Step B).

Вывод: soft-delete — единственный безопасный универсальный путь. Hard-delete допустим только через существующий caskadny order-delete flow.

### D4. Recompute / order totals

- Единственная существующая функция расчёта: `public.get_order_expected_paid(order_id)` — возвращает `SUM(amount) WHERE status='succeeded' AND amount>0`. Она НЕ пишет в `orders_v2` и НЕ учитывает `is_deleted` (колонки нет).
- Триггеров типа `%recalc%`, `%paid_amount%`, `%order_totals%` в БД **нет**.
- `orders_v2.paid_amount` пишется прикладной логикой (edge-функциями). Явного «canonical recalc» ни в БД, ни среди edge-функций не найдено (по имени; надо будет допройти на этапе PLAN — `payments-reconcile`, `refunds-recompute-order-status`, `admin-fix-payments-integrity` — кандидаты).
- Существующая функция `refunds-recompute-order-status/index.ts` пересчитывает статус ордера от refund-логики (не общий recalc).

Вывод: canonical recalc-функция отсутствует. В рамках V2 нужен минимальный `recalc_order_totals(order_id)` (SUM по активным успешным платежам с учётом будущего `is_deleted=false`), либо вызов существующего edge, если PLAN подтвердит его пригодность. Это add-only.

### D5. Canonical delete-order helper

Существующий canonical путь удаления сделки — `src/hooks/useDealsBulkDelete.ts`. Он:

1. Отменяет GetCourse для paid orders (`getcourse-cancel-deal`).
2. Удаляет `installment_schedules` → `subscriptions_v2`.
3. Отзывает TG-доступ, если у user_id нет других активных сделок/подписок.
4. Удаляет `access_grant_ledger`, `entitlements`.
5. Нуллифицирует inbound `payments_v2.reference_payment_id`, затем hard-delete `payments_v2` по `order_id`.
6. Hard-delete `orders_v2`.
7. Шлёт `send-access-revoked-notification`.

Дополнительно есть edge `admin-purge-payments-by-uid` (server-side purge). Дублирующего SQL RPC нет.

Оценка для V2:
- Это тот самый путь, который нужно вызывать в режиме `payment_and_order`.
- Он смешивает «удалить платёж + удалить сделку». Отдельного варианта «удалить сделку, но платежи оставить/переотвязать» (вариант B из правки §5 плана) НЕТ. В scope V2 расширение canonical helper под вариант B считаем **out of scope**, ограничиваемся вариантами A и C:
  - **A** — «payment_only»: soft-delete конкретного платежа, order остаётся, recalc.
  - **C** — «payment_and_order»: вызов `useDealsBulkDelete`-эквивалента (нужно вынести в server-side edge `admin-order-delete`, чтобы не дублировать логику на клиенте). Здесь платежи каскадно удаляются на уровне БД (`ON DELETE CASCADE`) — hard-delete, tombstone НЕ создаётся. Это принятый компромисс, зафиксировать в audit.
- Вариант B добавляется отдельным патчем; в UI dry-run это состояние помечаем как «недоступно в текущей версии», не молча деградируем.

### D6. RBAC

- Существующая RLS-политика на `payments_v2` использует legacy `has_role(auth.uid(), 'admin' | 'superadmin')` **И** RBAC v3 `has_admin_section_access(auth.uid(), 'payments', 'view'|'manage')`.
- Enum `app_role` содержит `admin` и `superadmin` (см. политику). Значение `super_admin` (с подчёркиванием) в legacy `has_role` в этой политике **не используется** — это будет ошибкой в edge-функции, повторять паттерн `bepaid-get-receipt` слепо нельзя.
- `refunds-recompute-order-status` использует прямой `select from user_roles ... in ('super_admin','admin','superadmin')` — оба варианта записаны через ИЛИ.

Вывод: для новых edge (`admin-payment-create`, `admin-payment-delete`) admin-check делаем через `has_admin_section_access(uid, 'payments', 'manage')` (canonical RBAC v3), НЕ через `has_role_v2`. Это соответствует существующей RLS-политике «RBAC v3: manage payments».

### D7. Readers `payments_v2` (частичный inventory)

Компоненты и хуки, читающие `payments_v2` (найдено `rg`), которым нужно скрывать `is_deleted=true` после патча:

- `src/pages/admin/AdminPayments*.tsx`
- `src/components/admin/payments/PaymentsTable.tsx`, `PaymentsStatsPanel.tsx`, CSV-экспорт
- `src/components/admin/DealDetailSheet.tsx` (список платежей в сделке)
- `src/hooks/useUnifiedPayments*` (если есть)
- Edge: `payments-reconcile`, `refunds-recompute-order-status`, `admin-payments-diagnostics`, `admin-fix-payments-integrity`, `admin-unlinked-payments-report`, `nightly-payments-invariants`, `grant-access-for-order`, `admin-purge-payments-by-uid`, `admin-materialize-queue-payments`, `payment-methods-*`

Полная таблица reader → «учитывает deleted?» → «требуется правка?» будет собрана на этапе PLAN (после утверждения Diagnose). Для V2 обязательным считаем обновление UI-readers + серверных путей, которые пишут `orders_v2.paid_amount` и выдают/отзывают access. Ночные джобы (invariants, diagnostics) — во второй итерации.

### D8. Grant-access

- Canonical выдача — `grant-access-for-order` (edge). Требует полноценный `orders_v2`. Прямых insert в `entitlements`/`access_grant_ledger` из V2-кода не будет.
- Ручной платёж → доступ только при: выбранной сделке (`order_id NOT NULL`), `status='succeeded'`, суммарные успешные платежи закрывают `orders_v2.paid_amount ≥ order.amount`. Проверка выполняется на сервере в `admin-payment-create`.
- Standalone-платёж (`order_id=null`) — доступ не выдаётся. UI-чекбокс «Выдать доступ» отключён до выбора сделки.

### D9. Идемпотентность и ручной ввод

- Внешний dedup через существующие UNIQUE `(provider, provider_payment_id)` работает только когда `provider_payment_id NOT NULL`. Для ручных `bank`-платежей admin может не заполнить `provider_payment_id` — тогда возможен дубль.
- Решение (add-only, в scope V2): `admin-payment-create` принимает обязательный `idempotency_key`; server-side хранит его в `payments_v2.meta.idempotency_key` и делает предварительный `SELECT ... WHERE meta->>'idempotency_key'=? AND created_by=?` перед INSERT. Возвращает существующую запись, если найдена.
- UI генерирует ключ при монтировании формы; при повторной отправке — тот же ключ.

### D10. Ручной RR / Stripe / bePaid не имитирует provider webhook

- В `admin-payment-create` для `provider ∈ {rr, stripe, bepaid}` записываем `payments_v2.meta.manual_entry=true`, `not_provider_confirmed=true`, `rr_mode_at_entry` (для RR) как в правке §12 плана.
- `provider_events` из этой функции НЕ создаём. RR healthcheck (`event_type='webhook_notification_received'`, guard из PATCH-RR-STATUS-TRUTHFUL-V1) остаётся строго по webhook-событиям.

### D11. Изменения к плану, зафиксированные Diagnose

1. **Partial unique index по `is_deleted=false` не создаём.** Существующие 3 копии `UNIQUE(provider, provider_payment_id)` уже дают глобальную защиту от воскрешения. Recreation guard в reconcile-путях сводится к: «перед upsert проверить существование строки — если найдена и `is_deleted=true`, залогировать orphan и НЕ обновлять».
2. **`provider` не превращаем в enum и не ужесточаем CHECK в V2.** Только расширение допустимых значений в клиентской модели/фильтрах до `{bepaid, stripe, rr, bank}`; строки `provider='admin'/'admin_test'` (327 шт.) остаются как есть до отдельного backfill-патча — они будут показаны в UI под меткой «legacy manual» (маленький пилюль в бейдже, без нарушения фильтра). В фильтре «провайдер» они группируются под «Прочее (legacy)» вне 4 канонических опций. Это compromise, чтобы миграция не упала и данные не потерялись.
3. **RBAC:** новые edge используют `has_admin_section_access(uid, 'payments', 'manage')`, не `has_role_v2(...,'super_admin')`.
4. **`admin-order-delete` (edge) — новый add-only wrapper** над логикой `useDealsBulkDelete`. Клиент вызывает его в режиме `payment_and_order`. Дублировать логику на клиенте запрещено.
5. **`recalc_order_totals(p_order_id uuid)` — новая SQL-функция**, add-only. Пересчитывает `orders_v2.paid_amount = SUM(amount) WHERE order_id=p_order_id AND status='succeeded' AND amount>0 AND COALESCE(is_deleted,false)=false`. Вызывается из `admin-payment-create` и `admin-payment-delete`.
6. **Вариант B** удаления («удалить сделку, платежи оставить/переотвязать») — вне scope V2, помечен как известное ограничение и в UI показывается как отключённая опция с подсказкой.
7. **Backfill `provider='admin'/'admin_test'` → нормальные значения** — отдельный подпатч, не блокирующий V2.

### D12. Открытые вопросы к утверждению перед PLAN

1. Подтверждаем ли «legacy manual» бейдж для 327 строк вместо жёсткой миграции provider? (Да/Нет)
2. Подтверждаем ли отсутствие варианта B удаления в V2? (Да/Нет)
3. Подтверждаем ли `recalc_order_totals` как единственный recalc-путь в V2? (Да/Нет)
4. Подтверждаем ли RBAC через `has_admin_section_access(...,'payments','manage')`? (Да/Нет)
5. Подтверждаем ли `admin-order-delete` (edge) вместо клиентского `useDealsBulkDelete` в режиме `payment_and_order`? (Да/Нет)

### Статус

```
PATCH-PAYMENTS-MANAGEMENT-V2:
  DIAGNOSE: DELIVERED
  PLAN: BLOCKED PENDING ANSWERS TO §D12
  CODE CHANGES: BLOCKED
```

Следующий шаг — ответы по §D12, затем append-only PLAN-раздел.

---

## PATCH-PAYMENTS-MANAGEMENT-V2 — PLAN (append-only, code changes still blocked)

Все §D12-решения приняты в редакции пользователя. Ниже — полный append-only PLAN, разбитый на безопасные фазы A–I. Ни одна строка кода не пишется до ревью PLAN.

### Инвариант провайдеров (жёсткий)

```
payments_v2.provider ∈ {bepaid, stripe, rr, bank}
```

Пятого фильтра "Прочее (legacy)" и legacy-бейджа не будет.
CHECK на 4 значения добавляется ТОЛЬКО после `noncanonical_provider_count = 0`.

Ручное происхождение — не provider, а признак `origin`:

```
origin='manual_admin'      → бейдж «Вручную»
origin='manual_adjustment' → бейдж «Корректировка» (13 существующих строк, не переименовывать)
все остальные origin       → бейдж «Авто»
```

---

### PATCH-PAYMENTS-PROVIDER-BACKFILL-V1 (Phase A, обязательный внутри V2)

Фактическое состояние БД (замер сейчас):

| provider   | meta.source          | count | комментарий                                                             |
|------------|----------------------|-------|-------------------------------------------------------------------------|
| admin      | admin_from_payment   | 117   | синтезированы из реальной bepaid-оплаты, есть `queue_payment_id`         |
| admin      | admin_grant          | 201   | админ-выдача доступа без реальных денег                                  |
| admin      | admin_deal_only      | 1     | требует ручной проверки                                                  |
| admin_test | (пусто)              | 8     | все с `meta.test_payment=true`                                           |

Все 327 строк имеют `origin='bepaid'` и `status='succeeded'`. Ни у одной нет `external_id` (колонки не существует), классификация ведётся по `meta`, `queue_payment_id`, `order_id`.

Правила классификации (dry-run обязателен, execute — отдельным подпатчем):

1. **admin_from_payment → bepaid.** Если `queue_payment_id` резолвится в `payment_reconcile_queue`/`bepaid_statement_rows` с валидным bepaid ID — установить `provider='bepaid'`, `provider_payment_id` от источника, `origin` оставить как есть. `meta.legacy_provider='admin'`, `meta.provider_backfilled_at=now()`.
2. **admin_grant → bank + manual_adjustment.** Реальных денег нет — это внутренняя бухгалтерская запись о выдаче доступа. `provider='bank'`, `origin='manual_adjustment'`, `meta.legacy_provider='admin'`, `meta.legacy_source='admin_grant'`. Если строка ссылается на реальный внешний платёж — переводится в п.1 вручную.
3. **admin_deal_only (1 строка) → manual review.** Одна строка, оставить в отчёте dry-run с фактическими значениями `id`, `order_id`, `amount`, `paid_at` и решить индивидуально (bepaid vs bank).
4. **admin_test (8 строк) → per-row решение:**
   - если `meta.test_payment=true` и есть связанный prod-заказ, не помеченный тестовым — эскалировать (возможен реальный платёж, ошибочно помеченный test);
   - если реальный тестовый fixture — удалить через новый штатный soft-delete механизм V2 (после фазы E);
   - если техническая корректировка — `provider='bank'`, `origin='manual_adjustment'`.

Ни одна строка не апдейтится без явного решения в dry-run отчёте. CHECK-констрейнт добавляется только после того, как `SELECT provider, count(*) FROM payments_v2 WHERE provider NOT IN ('bepaid','stripe','rr','bank') GROUP BY 1` возвращает 0 строк.

Артефакты Phase A:
- `docs/audits/2026-07-12-payments-provider-backfill-dryrun.md` — по-строчный отчёт;
- миграция `..._payments_provider_backfill.sql` (без CHECK);
- миграция `..._payments_provider_enforce_check.sql` (CHECK, отдельным коммитом после dry-run PASS).

---

### Phase B — Soft-delete schema + Reader/Writer inventory

Add-only миграция `..._payments_v2_soft_delete.sql`:

```sql
ALTER TABLE payments_v2
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS deletion_context jsonb;
CREATE INDEX IF NOT EXISTS payments_v2_is_deleted_idx ON payments_v2 (is_deleted) WHERE is_deleted = false;
```

Существующие 3 уникальных индекса `(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL` НЕ переопределяются: дедуп/tombstone уже глобально защищены — соответственно webhook, попытавшийся ре-создать soft-deleted строку, получит unique violation и должен интерпретироваться как «повторный webhook на удалённый платёж».

**Reader/Writer inventory (обязательно закончить до Phase C):**

| Место                                          | Роль                | Читает deleted? | Изменение                              |
|------------------------------------------------|---------------------|-----------------|----------------------------------------|
| `/admin/payments` list + фильтры               | reader              | нет             | добавить `is_deleted=false`            |
| `/admin/payments` stats RPC(-ы)                | reader              | нет             | исключить `is_deleted=true`            |
| CSV export                                     | reader              | нет             | исключить `is_deleted=true`            |
| `DealDetailSheet` payments panel               | reader              | нет             | исключить `is_deleted=true`            |
| `grant-access-for-order`                       | reader              | нет             | учитывать только `is_deleted=false`    |
| refund flows (bepaid/stripe)                   | reader+writer       | да              | tombstone читается, но refund блокируется на deleted parent |
| `payment-reconcile-*`, `bepaid-sync-*`         | reader+writer       | да              | resurrect-guard: не апдейтить/не воскрешать deleted        |
| integrity/health jobs                          | reader              | да              | видят deleted для диагностики          |
| CRM widgets / deals kanban                     | reader              | нет             | исключить `is_deleted=true`            |
| `statement_lines.payment_id` linking           | reader+writer       | да              | новые линки — только на живые; старые линки на deleted оставить как аудит |
| `installment_payments.payment_id`              | reader+writer       | нет             | недопустимо soft-удалять платёж с активной installment-строкой без обработки (см. Phase E) |
| subscription/recurring reconciler              | reader+writer       | нет             | исключить deleted из totals            |

Полный inventory заносится в `docs/audits/2026-07-12-payments-readers-writers.md` перед миграцией. Пока inventory не подписан — Phase C не стартует.

---

### Phase C — `recalc_order_totals(p_order_id uuid)` как единственный canonical recalc V2

Функция создаётся отдельной миграцией. Требования:

- учитывает только `is_deleted=false`;
- учитывает только финансово успешные статусы (`succeeded`; при наличии — `partially_refunded` с вычетом `refunded_amount`);
- денежное поле — `payments_v2.amount` (фактическая колонка; поля `paid_amount` в схеме нет);
- refunds учитываются как `SUM(amount) - SUM(refunded_amount) FILTER (...)`;
- обновляет в `orders_v2`: сумма зачтённых денег, остаток, переплата, дата последней успешной оплаты, платёжный статус сделки;
- **список разрешённых значений `orders_v2.status` берётся из фактической enum/CHECK и фиксируется в PLAN до реализации** (не выдумывается);
- вызывается только через SECURITY DEFINER edge/RPC, никогда напрямую с клиента.

`get_order_expected_paid` обновляется: `WHERE is_deleted = false`.

**Writers, изменяющие `orders_v2.paid_*` напрямую (перечислить до реализации, перевести последовательно, не одним коммитом):**
`bepaid-webhook`, `stripe-webhook`, `rr-webhook`, `payment-reconcile-*`, `admin-payment-*` (новые), `grant-access-for-order` (только чтение totals), `getcourse-cancel-deal`, миграционные backfill-скрипты. Полный список фиксируется в PLAN файле подпатча Phase C, каждый writer переводится на `recalc_order_totals` отдельным edge-коммитом с smoke.

Новые пути V2 (manual create, payment delete, bulk delete, payment↔order linking) — с первого дня используют только `recalc_order_totals`.

---

### Phase D — `admin-payment-create` (backend)

Edge функция, RBAC `has_admin_section_access(uid, 'payments', 'manage')`.

Тело:

```
{
  provider: 'bepaid'|'stripe'|'rr'|'bank',
  source_kind: 'auto'|'manual',
  amount, currency, status, paid_at,
  order_id?: uuid,
  contact_user_id?: uuid,
  provider_payment_id?: string,      // required if source_kind='auto'
  idempotency_key: string,           // MANDATORY (bank без provider_payment_id)
  meta_extra?: jsonb,
  grant_access?: boolean             // только с order_id и status='succeeded'
}
```

Инварианты:
- при `source_kind='manual'` → `meta.manual_entry=true`, `meta.not_provider_confirmed=true`, `provider_events` НЕ пишется, RR healthcheck НЕ дёргается;
- при `provider='rr'` в manual-режиме — тоже без RR healthcheck и без webhook-эмуляции;
- при `grant_access=true` — только через каноничный `grant-access-for-order`;
- всегда — запись в `audit_logs`;
- по завершении — вызов `recalc_order_totals(order_id)` при наличии `order_id`.

---

### Phase E — `admin-payment-delete` + `admin-order-delete` (backend, tombstone-safe)

Два edge, один RBAC (`has_admin_section_access ... 'manage'`).

**`admin-payment-delete`** — mode `payment_only`:
- soft-delete текущей строки (`is_deleted=true`, `deleted_at`, `deleted_by`, `deleted_reason`, `deletion_context = { mode: 'payment_only', order_id, provider, provider_payment_id, ... }`);
- запрет на удаление платежа с активной `installment_payments`-строкой (409, требуется предварительная обработка installment);
- при наличии `subscriptions_v2` — оставить subscription нетронутой; deleted платёж не воскрешается webhook-ом (см. resurrect-guard);
- `recalc_order_totals(order_id)`;
- optional `revoke_access` — только через `send-access-revoked-notification` + канонический revoke;
- `audit_logs`.

**`admin-order-delete`** — mode `payment_and_order` (single canonical server-side путь для удаления сделки):

Порядок (tombstone-safe, обязательный):

```
1. dry-run: собрать все платежи order_id;
2. soft-delete всех платежей:
     UPDATE payments_v2 SET
       is_deleted=true, deleted_at=..., deleted_by=..., deleted_reason=...,
       deletion_context = jsonb_build_object(
         'mode','payment_and_order',
         'order_id', order_id,
         'order_number', ...,
         'contact_user_id', user_id
       ),
       order_id = NULL          -- отвязать от order ДО удаления order
     WHERE order_id = :order_id;
3. installment_schedules / subscriptions_v2 → как в текущем useDealsBulkDelete;
4. entitlements / access_grant_ledger → как в текущем;
5. DELETE FROM orders_v2 WHERE id = :order_id
    -- ON DELETE CASCADE больше не уничтожит платежи, потому что order_id=NULL;
6. revoke TG-доступа (только если у user нет других живых деалов/подписок);
7. audit_logs.
```

Если конкретный FK не допускает `order_id=NULL` (проверить в Phase B inventory) — вводится отдельная таблица `payment_deletion_tombstones (payment_id, provider, provider_payment_id, order_id_at_deletion, deleted_at, deletion_context)` и запись копируется туда до `DELETE FROM orders_v2`. Просто принять потерю tombstone при CASCADE — недопустимо.

**Resurrect-guard в webhook-ах:**
- перед `INSERT ... ON CONFLICT` по `(provider, provider_payment_id)` — проверять, что найденная строка не `is_deleted=true`;
- если deleted — писать в `provider_events` событие `webhook_resurrect_blocked` и возвращать 200 без изменений;
- этот guard добавляется в `bepaid-webhook`, `stripe-webhook`, `rr-webhook`, `payment-reconcile-*`, `bepaid-sync-*` отдельными edge-коммитами.

**Переход `useDealsBulkDelete` на `admin-order-delete`** — обязательный шаг Phase E. Клиентский helper удаляется/тонкий wrapper вызывает edge. Два конкурирующих пути не оставляем.

---

### Phase F — Filters/Badges/Stats/CSV (frontend, только чтение)

- `PaymentsFilters.tsx`: 4 значения провайдера (`bepaid`, `stripe`, `rr`, `bank`) + Auto/Manual (`origin`) фильтр. Пятого пункта нет.
- бейдж провайдера — 4 варианта; бейдж происхождения — `Авто | Вручную | Корректировка`.
- Stats RPC / CSV / list-view — все запросы получают `is_deleted=false`.
- `is_deleted=true` в основном списке не виден. Отдельный toggle «показать удалённые» — вынесен в V2 backlog.

---

### Phase G — `CreatePaymentDialog` + `DeletePaymentDialog` (frontend UI)

Glass style, соответствует существующему `/admin/payments`.

`CreatePaymentDialog` — 5 блоков A–E:
A. Provider (4 варианта) + Source kind (Auto/Manual).
B. Amount / currency / status / paid_at / provider_payment_id (обязателен для Auto).
C. Привязка: order (search), contact (search) — опционально.
D. Grant access чекбокс — активен только с order и status=succeeded.
E. Idempotency key (авто-генерация UUID + видимое поле для ручной подмены при воспроизведении).

`DeletePaymentDialog`:
- показывает provider / сумму / дату / контакт / компанию / сделку / продукт;
- радио:
  - «Удалить только этот платёж» (`payment_only`);
  - «Удалить сделку и все связанные с ней платежи» (`payment_and_order`) — **точная формулировка обязательна, короткое «Удалить платёж и сделку» не использовать**;
- если у сделки несколько платежей — под радио разворачивается список платежей со суммами и общей суммой, требуется отдельный чекбокс «Я подтверждаю удаление N платежей на сумму X»;
- optional `revoke_access` (для `payment_only` — только если у пользователя нет других живых деалов/подписок);
- обязательное поле `deleted_reason`;
- запрет на редактирование auto-платежа как manual (только удаление).

---

### Phase H — Runtime fixtures (staging smoke, до prod)

Sequence (все — с логированием):

1. Manual bepaid / stripe / rr / bank — по одной записи, каждая с уникальным `idempotency_key`.
2. Bank без сделки + bank со сделкой (grant_access on/off).
3. Частичная оплата → recalc → полная оплата → recalc → доступ.
4. Standalone delete (`payment_only`) с revoke.
5. Delete + order (`payment_and_order`) — проверить tombstone, order_id=NULL до DELETE, resurrect-guard срабатывает при повторном webhook.
6. Idempotency: повтор `admin-payment-create` с тем же ключом → 200 same id.
7. Webhook tombstone: bepaid re-send на deleted платёж → `webhook_resurrect_blocked`.
8. Recurring/subscription: живые subscriptions_v2 не ломаются при удалении одиночного платежа.

---

### Phase I — RR test cleanup

Выполняется только после Phase H PASS. Использует общий механизм V2:
- `admin-payment-delete` (`payment_only`) для RR test-платежей;
- либо `admin-order-delete` (`payment_and_order`) для тестовых RR-сделок целиком;
- отдельного legacy-пути для RR test-cleanup не создаётся.

Только после Phase I PASS: RR battle go-live разблокируется отдельным решением.

---

### Контрольные точки и порядок коммитов

```
A1  provider backfill dry-run report (docs only)
A2  ..._payments_provider_backfill.sql (data migration via insert-tool, per D12)
A3  ..._payments_provider_enforce_check.sql (только после A2 PASS)
B1  reader/writer inventory doc
B2  ..._payments_v2_soft_delete.sql
C1  writers list doc
C2  ..._recalc_order_totals.sql + get_order_expected_paid update
C3  writers migration (по одному edge за коммит)
D   admin-payment-create
E1  admin-payment-delete
E2  admin-order-delete + resurrect-guard в webhooks
E3  useDealsBulkDelete → admin-order-delete
F   filters/badges/stats/CSV
G1  CreatePaymentDialog
G2  DeletePaymentDialog
H   runtime fixtures
I   RR test cleanup
```

Ни одна фаза не начинается, пока предыдущая не PASS. Один большой коммит, объединяющий provider migration + order delete + UI, запрещён.

---

### Definition of Done (V2)

- `payments_v2.provider ∈ {bepaid, stripe, rr, bank}` — CHECK enforced;
- ни одной строки `admin` / `admin_test` в prod;
- `is_deleted=true` невидим в UI/stats/CSV/deal sheet;
- ни один webhook/reconciler не может воскресить soft-deleted строку;
- `useDealsBulkDelete` больше не удаляет платежи и заказы напрямую;
- `recalc_order_totals` — единственный писатель `orders_v2` платёжных полей на новых путях;
- RR test cleanup выполнен новым каноническим механизмом;
- все Phase H fixtures PASS в staging.

---

### Статус

```
PATCH-PAYMENTS-MANAGEMENT-V2:
  DIAGNOSE: ACCEPTED
  D12: RESOLVED
  PLAN SECTION: SUBMITTED (append-only)
  PLAN REVIEW: PENDING
  CODE CHANGES: BLOCKED

PATCH-PAYMENTS-PROVIDER-BACKFILL-V1:
  SCOPE: INSIDE V2 (Phase A)
  DRY-RUN: PENDING PLAN REVIEW
```

Следующий шаг — ревью PLAN. При approve — стартует Phase A1 (dry-run отчёт, без изменений в БД).

## PATCH-PAYMENTS-MANAGEMENT-V2 — PLAN CORRECTIONS (accepted)

Приняты правки к PLAN от 12.07.2026. Ниже — append-only список изменений
контракта, которые заменяют соответствующие пункты ранее записанного PLAN.
При любом расхождении с более ранними разделами приоритет — за этими
правками.

### C1. Legacy классификация без ложных зачислений в bank

```
admin_from_payment  → bepaid, ТОЛЬКО при доказанной исходной оплате
                     (safe_backfill без коллизий)
admin_grant         → non-financial legacy artifact  → payments_legacy_archive
admin_test          → test fixture / non-financial   → payments_legacy_archive
                     + удаление тест-заказов через V2 mechanism (Phase I)
admin_deal_only     → индивидуальная проверка         → архив либо merge вручную
```

Перевод admin_grant → bank ЗАПРЕЩЁН: банковский платёж означает реальное
поступление денег на банковский счёт, административная выдача доступа без
оплаты банковским платежом не является.

### C2. `payments_legacy_archive` (add-only)

Schema (создаётся в Phase B2):

```
id                 uuid PK
source_payment_id  uuid NOT NULL   -- исходный payments_v2.id
original_row       jsonb NOT NULL  -- полная копия строки
provider           text
origin             text
order_id           uuid
profile_id         uuid
amount             numeric
currency           text
meta               jsonb
reason             text NOT NULL   -- 'admin_grant' | 'admin_test' | 'admin_from_payment_duplicate' | 'admin_from_payment_conflict' | 'admin_deal_only'
row_checksum       text NOT NULL   -- md5(original_row::text)
archived_at        timestamptz NOT NULL DEFAULT now()
archived_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL
```

Удаление legacy-строки из `payments_v2` допустимо ТОЛЬКО после доказательства
`archive_count = source_count` и совпадения checksum для каждой строки.

### C3. Исправленный порядок фаз

```
A1  read-only provider dry-run
B1  reader/writer inventory
B2  soft-delete + legacy archive schema
A2  guarded backfill/archive execute
A3  verify provider counts/collisions
A4  provider CHECK (bepaid, stripe, rr, bank)

C1  фиксация точных writer-ов orders_v2 (paid_amount/status)
C2  recalc_order_totals()
C3  миграция критичных writer-ов

D1  admin-payment-create manual-only
D2  active-manual → provider-confirmed merge contract

E1  admin-payment-delete preview/execute
E2  exact access-revoke lineage
E3  admin-order-delete preview/execute
E4  bulk delete
E5  resurrect guards
E6  useDealsBulkDelete → thin edge wrapper

F   readers / filters / stats / CSV
G1  glass CreatePaymentDialog
G2  glass DeletePaymentDialog
H   runtime fixtures
I   RR test cleanup
```

CHECK на 4 провайдера добавляется ТОЛЬКО после Phase A3.

### C4. Dry-run admin_from_payment — обязательные классы

Для каждой строки:

```
source payment ID найден
existing payments_v2 с таким bepaid ID
order match
amount match
currency match
profile match
```

Категории:

```
safe_backfill
duplicate_of_existing_payment
conflicting_payment
missing_source
ambiguous_source
```

При `duplicate_of_existing_payment` / `conflicting_payment` legacy-строка НЕ
превращается в bepaid и НЕ увеличивает выручку — она уходит в
`payments_legacy_archive`.

### C5. Никаких новых `docs/audits/*.md` для V2

Все Diagnose/Dry-run/Reader-Writer/Execute-разделы пишутся append-only в
`.lovable/plan.md`. Для 327 legacy-строк в файл идут только:
агрегаты, SQL-критерии, counts, checksum, список ambiguous/conflicting IDs,
примеры по каждой категории.

### C6. Backfill — не автоматически повторяемая data migration

`_..._payments_provider_backfill.sql` не должен повторно классифицировать
production-данные в другом окружении. Execute — guarded, идемпотентный,
транзакционный, привязан к A1-результату, с проверкой expected count/checksum
и rollback при любом несовпадении. Schema-migration содержит только: archive
table, soft-delete columns, CHECK после завершения backfill.

### C7. `admin-payment-create` — только ручная запись

Убрать `source_kind: auto | manual` и Auto/Manual выбор в UI.
`admin-payment-create` всегда создаёт:

```
origin = 'manual_admin'
meta.manual_entry = true
```

Автоматические записи создаются только webhook/API/file_import/reconciliation.

Payload:

```ts
{
  provider: 'bepaid' | 'stripe' | 'rr' | 'bank';
  amount: number;
  currency: string;
  status: AllowedPaymentStatus;
  paid_at: string;

  order_id?: string;
  profile_id?: string;
  company_id?: string;

  provider_payment_id?: string;
  idempotency_key: string;   // генерируется UI, не редактируется

  grant_access?: boolean;

  provider_details: BepaidDetails | StripeDetails | RrDetails | BankDetails;
}
```

`meta_extra?: jsonb` из frontend НЕ принимается. Сервер собирает `meta`
только из валидированных типизированных полей.

Типизированные details:

```
bePaid : provider_payment_id, tracking, reference, commission
Stripe : payment_intent_id, charge_id, commission
RR     : rr_order_id, rr_mode_at_entry (сервер),
         not_provider_confirmed=true
Банк   : bank_name, payment_order_number, bank_reference, payer_name,
         payer_unp, payment_purpose, invoice_number,
         recipient_account, commission
```

### C8. Idempotency key скрыт от оператора

Генерируется UI автоматически, хранится во внутреннем state, повторно
используется при retry, не отображается в форме, не редактируется. Показ —
только в технических деталях результата для диагностики.

### C9. Manual → webhook merge contract

Активная ручная строка с реальным `provider_payment_id` (`is_deleted=false`,
`meta.not_provider_confirmed=true`) при получении настоящего webhook:

```
- webhook НЕ создаёт дубль
- webhook находит существующую строку по (provider, provider_payment_id)
- подтверждает provider data
- сохраняет origin='manual_admin'
- пишет meta.provider_confirmed_at, provider_confirmed_by='webhook'
- пишет provider_events
- НЕ увеличивает сумму сделки повторно
```

Удалённая строка (`is_deleted=true`) — webhook блокируется как
`webhook_resurrect_blocked` и пишет в provider_events без ресурректа.

### C10. `payment_only` реально отвязывает связи

```
1. сохранить (old_order_id, old_profile_id, old_company_id) в deletion_context
2. is_deleted = true
3. order_id = NULL
4. profile_id = NULL
5. отвязать прямую company-связь, если есть
6. recalc_order_totals(old_order_id)
```

Пересчёт делать ПОСЛЕ обнуления, используя `old_order_id` из deletion_context.

### C11. installment_payments не блокирует удаление

Штатное удаление НЕ должно быть навсегда заблокировано installment-связью.
В Phase B выбирается один безопасный вариант:

```
installment_payments.payment_id = NULL
      | installment payment relation soft-delete / archive
      | tombstone-link
```

Dry-run показывает последствия, execute применяет выбранный механизм. HTTP 409
для installment-связи заменяется на явное действие по одному из вариантов.

### C12. `revoke_access` только по точной связи

`send-access-revoked-notification` НЕ является revoke-функцией. Точный
server-side путь фиксируется в Phase E2:

```
payment_id → entitlement_source → entitlement / access_grant_ledger
                                → telegram_access / subscription lineage
```

Правило:

```
revoke_access разрешён ТОЛЬКО если payment_id → entitlement_source точный
```

Иначе:

```
revoke_access_available = false
reason = 'ambiguous_access_lineage'
```

Отзыв доступа целиком по факту «нет других живых сделок» — запрещён.

### C13. Preview / execute для admin-payment-delete и admin-order-delete

Обе функции принимают:

```
action = 'preview' | 'execute'
```

Preview возвращает:

```
payment (или order),
old order/profile/company,
other payments of the order,
installment_payments links,
statement_lines links,
access lineage,
subscriptions,
что будет отвязано,
что будет удалено,
blocked / warnings,
preview_token (hash от графа связей + updated_at всех участников)
```

Execute требует preview_token и повторно валидирует updated_at
payment/order/access-source-ids. При расхождении — HTTP 409
`preview_stale`, оператор перезапрашивает preview.

### C14. `admin-payment-bulk-delete` (Phase E4)

```
mode = 'payment_only'   // по умолчанию
revoke_access = false   // по умолчанию
```

Результат построчно: `deleted | already_deleted | blocked | failed`.
UI: чекбоксы → «Удалить выбранные» → общий dry-run → подтверждение → execute.
`payment_and_order` в bulk-режиме V2 запрещён либо требует отдельного
подтверждения по каждой сделке.

### C15. Company + полный банковский блок в UI

`CreatePaymentDialog` содержит:

```
- контакт
- компания
- сделка
- автозаполнение контакта/компании из сделки
- standalone bank payment (без сделки)
```

Банковская секция:

```
bank_name (свободный ввод / combobox)
payment_date
payer_name
payer_unp
payment_purpose
payment_order_number
bank_reference
invoice_number
recipient_account
commission
comment
```

`provider` для банковской записи всегда `bank`.

### C16. SQL-security

Для `recalc_order_totals` и admin RPC:

```
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid) FROM anon;
```

RBAC — внутри функции (server-side) или вызов только из защищённой
edge-функции с service-role. `deleted_by uuid REFERENCES auth.users(id) ON
DELETE SET NULL`.

### C17. Индекс `is_deleted`

Не создавать `ix (is_deleted) WHERE is_deleted=false` автоматически. Сначала
Phase F/H: реальные запросы + EXPLAIN. При необходимости — расширить
существующие составные индексы `payments_v2`(provider, created_at/paid_at,
status, order_id) добавлением `is_deleted` как условия или колонки.

---

## PATCH-PAYMENTS-MANAGEMENT-V2 — PHASE A1 DRY RUN (read-only)

Дата: 2026-07-12. SQL выполнялся только на чтение, изменений в БД нет.
Метод: см. запросы ниже. Все counts перепроверяемы.

### A1.1 Категоризация 327 legacy-строк

Критерий: `provider IN ('admin','admin_test')` в `payments_v2`.

```sql
CASE
  WHEN provider='admin_test' THEN 'admin_test'
  WHEN provider='admin' AND meta->>'source'='admin_grant'        THEN 'admin_grant'
  WHEN provider='admin' AND meta->>'source'='admin_from_payment' THEN 'admin_from_payment'
  WHEN provider='admin' AND meta->>'source'='admin_deal_only'    THEN 'admin_deal_only'
END
```

Результаты:

```
admin_from_payment  117   sum=24518.00 BYN   with_qpid=117   with_order=106
admin_grant         201   sum=0.00     BYN   with_granted_by=201  with_order=189
admin_deal_only       1   sum=0.00     BYN   with_order=1
admin_test            8   sum=1340.00  BYN   with_order=7 (все ORD-TEST-*)
────────────────────────────────────
TOTAL               327
```

Ответ на вопрос №3 (admin_grant): подтверждено. Все 201 строки имеют
`amount=0`, `meta.granted_by IS NOT NULL`, provider_payment_id отсутствует —
денежных поступлений нет. Все 201 идут в `payments_legacy_archive`
(`reason='admin_grant'`), НЕ переводятся в `bank`.

### A1.2 admin_from_payment — коллизии с существующими bePaid

Метод: для каждой строки берём `meta.queue_payment_id → payment_reconcile_queue.id`,
сравниваем `bepaid_uid` с существующими `payments_v2.provider_payment_id`
при `provider='bepaid'`.

```
Всего                                   117
missing_source (нет строки в очереди)     9
safe_backfill (bepaid UID свободен)       5
duplicate_full_match (order+amount совп.) 26
duplicate_legacy_null_order (legacy без order) 10
duplicate_conflicting_order (legacy.order ≠ existing) 67
────────────────────────────────────
duplicate_of_existing_payment (совокупно) 103
conflicting_payment (подкласс duplicate)   67
```

Ответ на вопрос №1: 5 из 117 admin_from_payment можно безопасно бэкфилить
как bepaid без дублей. Ответ на вопрос №2: 103 из 117 уже имеют настоящий
bePaid-платёж в системе (из них 67 — с расхождением по order_id).

Действия:
```
safe_backfill (5)  → UPDATE provider='bepaid', provider_payment_id=<bepaid_uid>,
                     meta.legacy_provider='admin', meta.legacy_source='admin_from_payment',
                     ЗАПРЕТ на увеличение выручки (order уже paid),
                     recalc через C2 после Phase B/C.
duplicates (103)   → payments_legacy_archive, reason='admin_from_payment_duplicate'
                     (26 full_match + 10 null_order + 67 conflicting_order).
                     Для 67 conflicting_order — reason='admin_from_payment_conflict',
                     сверху ручное подтверждение в A1-review.
missing_source (9) → индивидуальный review в Phase A1 review,
                     по умолчанию → archive reason='admin_from_payment_missing_source'.
```

Полные списки IDs — ниже в A1.5.

### A1.3 admin_test — 8 строк

Ответ на вопрос №4:

```
1 orphan (order_id=NULL, ORD-TEST-* удалён)                  — pure fixture
7 связаны с ORD-TEST-* заказами (status=paid)                — все fixture
    из них 5 имеют access_grant_ledger записи (нужен V2 revoke в Phase I)
все 8 имеют meta.test_payment=true, meta.test_payment_by
```

Реальных production-заказов среди них нет. Все 8 → архив
(`reason='admin_test'`) + удаление привязанных ORD-TEST-* заказов через
canonical V2 mechanism (Phase I после Phase E).

### A1.4 admin_deal_only — 1 строка

`id=59fb8249-94f0-4f66-b23c-a7fcb9472505`, amount=0 BYN,
`meta.source='admin_deal_only'`, `granted_by=f1a79dd0-...`,
`order_id=df97b9ad-...`. Индивидуальный review в A1-review: скорее всего
архив (`reason='admin_deal_only'`) без денежного эффекта.

### A1.5 Полные списки IDs

`safe_backfill` (5):
```
9b412ac6-690c-430b-8ce8-71afa057ac78
ce8eedad-eb2e-46f2-a424-3e22f117bd99
ca7cde79-9b1d-4d54-8942-64b24139014c
496ed05b-9918-4142-9d38-9778ede52153
9e158f4b-af9b-4699-823c-61ebc8f2e361
```

`missing_source` (9):
```
144441b1-107d-4013-b077-88a1661905bb
948f33b1-a6ef-4d08-8c92-fd685f876794
66657c81-aefb-4c13-b856-efff8c17fc30
4afe1a0c-7fd6-4643-9152-d1d6d60258c7
07f997a5-0b82-4f56-a0b7-b7c8796ee51b
f60ed2f0-277c-4f28-ae26-b7f05c2c05a7
4e349305-b73d-4b92-a3ed-9628e34e8420
86546dfe-b036-40de-a97b-c4a21a7dfabc
e3412120-7843-4ce9-9033-5052bc26759a
```

`duplicate_legacy_null_order` (10):
```
748686b3-48b8-44e6-b1ca-e721c7797a34
3e656276-541f-461f-ae55-e818cbdabee9
95c7ca95-42ec-4d5e-8569-f177728276a4
bc4a12cd-b983-4761-adcd-34c590eb02d3
b921d5e0-f527-43f2-af7b-71796a239455
ce737f06-7bc9-4a29-8c19-0c109a979069
9909e5cb-b1aa-4c6d-9bb1-08a8b220bf7f
1cc9c88c-70e9-4481-9cb3-ee3de1b24b5c
1435dd26-0df4-4145-bf4a-f01fb2f44f80
7aadddc4-b2af-477a-ba2b-5b6fccb7e98b
```

`duplicate_full_match` (26): архивируются без ручного review.
```
eda63b40-b5ab-4a44-860c-218af7ac927a  0bde9709-9a89-4629-b364-a3b8758fcd18
6d6a1568-30e8-4aad-8513-e263af3216b8  3d8aecbd-4491-41ab-8116-7020e099b60e
20c22102-23e8-4ac5-8c7e-37ef57ed2102  6bd8c9bc-d219-47db-b982-0d07c75d8ee7
2cfe171a-ccf5-46e5-82a8-c6f4180efab2  5444b49f-11e5-4a2c-a09d-ef373a1661e8
cd60358c-7efb-4b71-b62f-1e4692e36f26  58305ecb-3180-4e90-af73-85164e98b74b
9f32cba5-9769-4719-96a8-d9cb608e3096  00956264-cafc-4522-a7a8-2f9feb551aae
ae7767ce-fd18-4219-bbf3-2e64e0fc9b38  2ea9172f-d88a-4150-a2ea-8d119818f8e3
3ddbc394-f69e-447e-b084-89991852a7a0  ddefcdc9-3711-4998-a726-4ab1f8899983
d9491361-20b2-4af3-8059-0e38e45458d6  114e9b93-bb19-4a3e-984e-02f5ea37c3e7
af065c3e-18a8-4152-a91f-7af3290c13f1  9862aae2-dd85-4e2a-8ecb-d9ff8e192f44
d1575dfa-6a05-42c4-937a-8fca8da28725  e254b80d-38c5-4b75-9a22-5b5c709994b3
8bf8cb4b-71bf-4bfb-bb0e-bc94c9daff49  2e4e465b-deba-4744-8426-7fa7a0ab642e
953cedd1-4132-4cda-8b97-644dac628268  461bbd97-fc56-4aba-be40-f4838c3d6e13
```

`duplicate_conflicting_order` (67): требуют ручного подтверждения (legacy.order_id
не совпадает с order_id уже существующего bepaid-платежа с тем же bepaid_uid).
Полный список сохранён в результатах запроса A1.2 (см. классификацию выше);
IDs выведены в дампе dry-run и доступны для точечного review.

```
564b7392-0a64-4fa9-8b34-42bfd8aa7eb7  897ea700-44ff-4f93-bd7d-2d20ec8d6ae5
4a073c49-8412-41a7-9ed1-1453a62d9fca  9692a501-78b8-42fa-93d9-d508361fb3d3
1711a2dd-bd50-4889-baf4-5b4a13c1bb97  123b56e9-2544-4d5f-ab1b-c26886dbda11
5cf9e21c-86f5-4d96-ae6b-4b9154e2eb90  18e93d7a-3d3f-4e73-a34d-8f3c627d1716
2eca335a-7bf9-4359-9854-7cb6561ea47c  7e953bc7-f619-420c-91b5-9908a8b7578f
43282ffb-4e48-4621-9dc4-9ef27589cca6  8cbc5122-fd6a-44d7-9cde-d1cad95c8c75
4f2cb48f-7f3f-455e-b2c1-7f7d5d47e356  b5c3cb43-1d57-4594-b378-65f9536a3090
a127ace1-3c97-474b-beea-f93dc654eec6  a386f607-4da8-4df4-94af-a2c095150b20
3fd5c095-9a44-4dda-9880-1358c53be7e6  9d262108-73b0-4a3c-b7ec-5693b0e412b5
71361253-c457-46b5-be95-e9d66a8494a0  b074afef-2649-48ce-9c3d-f028932c3f8c
06d7e36a-58fa-4a0c-820a-5041f9e42d7c  d313bcb9-02cf-470a-9db5-06cb6c5d5a59
c0f28878-24c8-4af8-979c-077a7fdceb5c  9318eb82-efea-4ba1-a979-5fe8b7e3ba59
e452e784-65dc-48c4-9456-da0bc15032a5  1922bc40-5b86-4dbd-a0aa-a660d67889b8
e7e8aad4-c59c-4d66-8882-052f7545a885  76f05a4f-eedc-4d61-bfe7-3e035d2b5ce1
5ded2798-9b61-4aa9-bd5a-592ed2c1438e  578f7efa-3fed-4540-895c-c70086262efc
2e8ee000-ed66-4be4-9ae2-60364976be88  ad0cf694-b3fc-4ef7-97e5-9604235dfa4d
941c52bc-9fee-4171-96a7-6cc6d59a75df  bc2c6bb3-26e4-4058-b44d-138bcd5c420f
08acc0cb-c1f5-4b0c-838b-76d0125546e7  94fda5b8-1a65-4fd5-a3fe-ff2413054aa7
1e2abdb7-50b3-4b80-8b00-1a7a32a7dc85  dcd47045-7963-4556-ae57-e2d0b0c2476e
412fd764-e227-4410-b218-70c630b82b78  3ab53ea9-dc11-4658-a356-a3673ad1df3c
dc144342-6461-4999-bdd7-17c2a5ccb592  7fd564d1-a1d8-4658-a025-b5318e6354f8
e7a320bc-ce96-4b70-ba57-158ae7c06cd7  ae5ac541-1d39-4302-9844-522e92b64748
72b673a9-df4c-4de1-8044-a012e75e5f10  d9238ee3-9909-4fd8-88a2-9df8dc6a83dd
b5e9f845-c71e-404e-81a1-4dbd294e1106  644f27e5-fcfb-4ef7-b8b5-687b6b9f6156
f68582b0-516d-42e8-9045-b89f8d96f367  e93ff9fe-97f4-4a27-8770-d55fef78e5da
73b8f176-015c-45e3-aba0-b62354b3fa19  12ff2996-8496-473e-8fe6-d6ccfb2a0efb
ec774ffb-a257-47b5-95c2-1e4ee4bb719a  24791a62-b57f-4222-a498-d2321017e139
023c6051-eb1e-4b5a-a55d-1ef519ca7a1c  bc89dcc9-cc4b-4adf-99df-d72cc05e5b97
740bcafa-104d-47cf-9bd9-06e419087f05  6491944f-bd9e-4764-9709-a54df2ad6ad9
25c216dd-53ae-4ada-9466-1910d3e06999  d5c21bb7-af98-453e-a332-59d80d60d1aa
33bdeca9-4e3e-4840-b27e-e69746c25916  b0b8758a-d1b6-412f-b823-45de1b3bb83c
6005ece7-badf-44be-bea0-a08594d69e16  d37310a4-1a9b-42c3-83fc-9de2d2fb6acc
80cfe2bf-9b61-46f1-903f-1874b1903f41  676a15fb-baf8-4b49-bf14-3155b5894671
e301fabb-7aff-416a-b339-518205861114
```

`admin_test` (8), `admin_deal_only` (1), `admin_grant` (201) — списки не
инлайнятся (агрегаты в A1.1 достаточны, критерий SQL воспроизводим).

### A1.6 SQL-критерии

```sql
-- admin_from_payment классификация
WITH src AS (
  SELECT p.id, p.order_id, p.amount, p.currency, p.meta->>'queue_payment_id' AS qpid
  FROM payments_v2 p
  WHERE p.provider='admin' AND p.meta->>'source'='admin_from_payment'
), q AS (
  SELECT s.*, prq.bepaid_uid AS q_ppid, prq.matched_order_id AS q_order
  FROM src s LEFT JOIN payment_reconcile_queue prq ON prq.id::text = s.qpid
), m AS (
  SELECT q.*,
    (SELECT count(*) FROM payments_v2 p2
      WHERE p2.provider='bepaid' AND p2.provider_payment_id = q.q_ppid) AS ex_cnt,
    (SELECT p2.order_id FROM payments_v2 p2
      WHERE p2.provider='bepaid' AND p2.provider_payment_id = q.q_ppid LIMIT 1) AS ex_order
  FROM q
)
SELECT
  CASE
    WHEN q_ppid IS NULL                             THEN 'missing_source'
    WHEN ex_cnt=0                                   THEN 'safe_backfill'
    WHEN ex_cnt=1 AND order_id = ex_order           THEN 'duplicate_full_match'
    WHEN ex_cnt=1 AND order_id IS NULL              THEN 'duplicate_legacy_null_order'
    WHEN ex_cnt=1 AND order_id IS DISTINCT FROM ex_order THEN 'duplicate_conflicting_order'
  END AS classification,
  count(*)
FROM m GROUP BY 1;
```

### A1.7 Ответы на 4 обязательных вопроса

```
Q1 safe merge admin_from_payment → bepaid без дублей : 5
Q2 admin_from_payment в конфликте с существующим bepaid : 103
      full_match:               26  → archive
      legacy_null_order:        10  → archive
      conflicting_order:        67  → archive с флагом conflict, ручное review
Q3 admin_grant подтверждено не денежные                 : 201 (sum=0.00)
Q4 admin_test — production связей нет                   : 0
      все 8 — fixtures (ORD-TEST-*, meta.test_payment=true)
```

### A1.8 Решение по A1

```
PATCH-PAYMENTS-MANAGEMENT-V2 — PHASE A1:
  DRY-RUN COMPLETED
  NO DB CHANGES
  REVIEW OF 67 conflicting_order + 9 missing_source + 1 admin_deal_only: REQUIRED
  PHASE A2 / B2 / EXECUTE: BLOCKED UNTIL A1 REVIEW APPROVED
  ALL CODE CHANGES: BLOCKED
```
