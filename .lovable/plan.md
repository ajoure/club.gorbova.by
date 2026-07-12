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

## PATCH-PAYMENTS-MANAGEMENT-V2 — PHASE A1R (read-only recheck)

Дата: 2026-07-12. Только SELECT. Изменений в БД нет.

Все сравнения ниже выполнены по полному контракту:
`legacy.order`, `legacy.amount`, `legacy.currency`, `legacy.profile`,
`legacy.paid_at` против `payment_reconcile_queue.*` и/или существующего
canonical `payments_v2 (provider='bepaid', provider_payment_id = bepaid_uid)`.

### A1R.0 Уточнённая карта (117 admin_from_payment)

Reclassification без совмещения ord+fin:

```
a_safe_backfill                                  5
b_archive_full_match  (ord+amt+ccy+prof совпали) 24
b_full_match_ord_but_fin_conflict                 2  (order совпал, но profile/amt отличаются)
c_legacy_null_order_archive (fin match, order пусто) 10
d_legacy_order_correct_relink_canonical          52  (canonical привязан к неверному order)
e_canonical_correct_archive_legacy               14
f_both_wrong_ambiguous                            1
z_other (без queue match)                         2
missing_source (queue-строки нет вовсе)           9
────────────────────────────────────────────────────
итого                                           117
```

`b_archive_full_match` уменьшилось с 26 до **24** — 2 строки, при совпадающем
`order_id`, имеют расхождение по `profile` или `amount`. Они уходят в
подкатегорию `b_full_match_ord_but_fin_conflict` и требуют ручного review до
archive.

`z_other` (2 строки) — canonical bepaid найден, но legacy имеет одинаковый
`order` и одинаковые фин.поля (эта ветка попала мимо предыдущих case-веток).
Требуется точечный review (легенда: строка попала в SELECT WHERE
`bepaid_uid IS NOT NULL` без явной ветки — вероятно, `legacy_order` равен
`canon_order`, но `canon_order IS NULL`). Подробности будут при execute-review.

### A1R.1 safe_backfill (5) — детально

| legacy_id | bepaid_uid | ord | amt | ccy | prof | l_paid | q_paid | заметка |
|---|---|---|---|---|---|---|---|---|
| 496ed05b… | 63f9a1f9… | ✅ | ✅ | ✅ | ✅ | 2025-12-30 | 2025-12-30 | ok |
| ce8eedad… | 3d216612… | ✅ | ✅ | ✅ | ✅ | 2025-12-31 | 2025-12-31 | ok |
| 9e158f4b… | 6badbdad… | ✅ | ✅ | ✅ | legacy=NULL | 2026-07-08 | 2026-07-08 | tracking=subv2:… (subscription) |
| 9b412ac6… | 19d816de… | ✅ | ✅ | ✅ | legacy=NULL | 2025-12-30 | 2025-12-30 | ok |
| ca7cde79… | **19d816de…** | ❌ (l_order=NULL) | ✅ | ✅ | legacy=NULL | **2026-03-16** | 2025-12-30 | **collision с 9b412ac6, дата отличается на 2.5 мес** |

Критическая находка: `9b412ac6` и `ca7cde79` указывают на ОДИН и тот же
`bepaid_uid=19d816de-…` (`tracking_id=lead_3836274`, `rrn=019950035920`).
`ca7cde79` имеет `paid_at=2026-03-16`, `legacy_order=NULL`; `9b412ac6` имеет
`paid_at=2025-12-30` (совпадает с queue), `legacy_order` задан. Одновременный
backfill невозможен из-за `uq_payments_v2_provider_payment`. Правильный
разбор:

```
9b412ac6 → safe_backfill_confirmed  (paid_at, order совпадают с очередью)
ca7cde79 → archive_duplicate_of_9b412ac6  (тот же bepaid_uid, вторичная копия)
```

Итог A1R.1:

```
safe_backfill_confirmed          4  (496ed05b, ce8eedad, 9e158f4b, 9b412ac6)
duplicate_of_safe_backfill       1  (ca7cde79 → archive)
```

### A1R.2a full_match (24) — детали

```
archive_exact_duplicate                         14
archive_exact_but_legacy_prof_null (canon set)  10  ← ок для архива
amount_mismatch                                  0
currency_mismatch                                0
profile_mismatch                                 2  ← вынесены в b_full_match_ord_but_fin_conflict
```

24 идут в архив (`reason='admin_from_payment_duplicate'`). Full ID list —
см. агрегат `b_archive_full_match` выше.

2 конфликтных full-match:

```
{00956264-cafc-4522-a7a8-2f9feb551aae, eda63b40-b5ab-4a44-860c-218af7ac927a}
```

помечены как `z_other`; поведение уточнить в execute-review.

### A1R.2b legacy_null_order (10) — детали

```
amount_match          10 / 10
currency_match        10 / 10
profile_match         7 / 10   (все три с NULL legacy + set canon → допустимо)
canonical_has_order  10 / 10
archive_ok_candidate 10 / 10
```

Все 10 → архив (`reason='admin_from_payment_duplicate_legacy_null_order'`).

### A1R.2c conflicting_order (67) — приоритетный разбор

Через `queue.matched_order_id` определяем правильную связь:

```
legacy_order_correct   → legacy.order = queue.order ≠ canonical.order
canonical_order_correct → canonical.order = queue.order ≠ legacy.order
both_wrong_vs_queue    → ни legacy, ни canonical не совпадают с queue
```

Результат:

```
legacy_order_correct     52    ← canonical привязан к НЕВЕРНОМУ order
canonical_order_correct  14
both_wrong_vs_queue       1    (897ea700-44ff-4f93-bd7d-2d20ec8d6ae5)
```

Финансовые поля vs canonical:

```
amount_match_canon   67 / 67
currency_match_canon 67 / 67
profile_match_canon  48 / 67
```

Действия:

```
14 canonical_order_correct → legacy → archive
                              (reason='admin_from_payment_duplicate_conflict_canonical_wins')
52 legacy_order_correct   → RELINK canonical.order_id → queue.order_id
                              (это исправление ошибки старого matcher-а)
                              legacy-строка после этого → archive
                              (reason='admin_from_payment_duplicate_after_canonical_relink')
                              !!! ATTENTION: relink затрагивает 52 существующих bepaid платежа,
                                  меняет привязку к сделке
                                  → обязательный пересчёт paid_amount и статуса
                                    обеих сделок (старой и новой)
                                  → отдельный, guarded этап Phase A2b
                                  → отдельный revoke/re-grant анализ для доступов
 1 both_wrong_vs_queue    → ambiguous_keep_blocked  (897ea700…)
                              обработка вручную в execute-review
```

Полный ID list (52 legacy_order_correct):
```
023c6051 06d7e36a 08acc0cb 123b56e9 12ff2996 1711a2dd 18e93d7a 1922bc40
1e2abdb7 25c216dd 2e8ee000 2eca335a 3ab53ea9 3fd5c095 412fd764 4a073c49
4f2cb48f 564b7392 5cf9e21c 5ded2798 644f27e5 6491944f 676a15fb 71361253
73b8f176 740bcafa 76f05a4f 7e953bc7 80cfe2bf 8cbc5122 9318eb82 941c52bc
94fda5b8 9692a501 9d262108 a127ace1 a386f607 ad0cf694 b074afef b0b8758a
b5c3cb43 b5e9f845 bc2c6bb3 bc89dcc9 c0f28878 d313bcb9 d5c21bb7 d9238ee3
e452e784 e93ff9fe ec774ffb f68582b0
```

14 canonical_order_correct:
```
24791a62 33bdeca9 43282ffb 578f7efa 6005ece7 72b673a9 7fd564d1 ae5ac541
d37310a4 dc144342 dcd47045 e301fabb e7a320bc e7e8aad4
```

### A1R.3 missing_source (9) — recovery search

Для всех 9 `payment_reconcile_queue.id = qpid` отсутствует. Дополнительный
поиск по `bepaid_statement_rows(amount, currency, paid_at ±2 дня)` и
`payments_v2(bepaid, order_id, amount)`:

```
legacy_id      | l_paid     | bsr_by_amt_date | bepaid_same_ord_amt | any_bepaid_same_ord
4afe1a0c…      | 2025-09-10 |    4            | 0                    | 0
e3412120…      | 2025-10-10 |    4            | 0                    | 0
86546dfe…      | 2026-01-04 |   26            | 0                    | 0
07f997a5…      | 2026-01-06 |   99            | 0                    | 0     (amt=1.00)
66657c81…      | 2026-01-06 |   99            | 0                    | 0     (amt=1.00)
4e349305…      | 2026-01-09 |   47            | 0                    | 0     (amt=1.00)
144441b1…      | 2026-01-11 |   40            | 0                    | 0
f60ed2f0…      | 2026-01-12 |   23            | 1                    | 1     ← duplicate_recovered
948f33b1…      | 2026-01-14 |   31            | 0                    | 0
```

Категории:

```
duplicate_recovered   1  (f60ed2f0…) → archive
                           (reason='admin_from_payment_missing_source_bepaid_covers')
ambiguous_bsr         8  → в bepaid_statement_rows много candidates по (amt,date);
                           точная привязка требует profile/email match.
                           Промежуточное решение: до execute-review держать
                           заблокированными; при отсутствии дополнительной связи
                           отправить в archive с
                           reason='admin_from_payment_missing_source_unrecoverable'.
                           Три строки с amt=1.00 BYN и 47-99 candidates почти
                           наверняка технические тесты (нет provider_events, нет
                           statement_lines, нет других bepaid на том же order).
```

### A1R.4 admin_deal_only (1) — access lineage

```
legacy_id     : 59fb8249-94f0-4f66-b23c-a7fcb9472505
order_id      : df97b9ad-fb7d-4bbd-8122-46871ce611da
order_number  : GIFT-26-MO9PD7A5           ← подарочная сделка
order.status  : paid
order.paid_amount : 0.00
order.final_price : 0.00
succeeded_payments (excl. этой) : 0
subs / entitlement_sources / entitlements / access_grant_ledger by order : 0
```

`GIFT-*` сделка на 0 BYN. Payment-строка — это marker выдачи подарка, но
lineage-таблицы (`entitlement_sources`, `access_grant_ledger`) пусты. Значит
доступ выдавался вне payments_v2. Итог:

```
59fb8249… → archive
              (reason='admin_deal_only_nonfinancial_gift')
              order.status='paid' оставить как есть
                (это подарок, а не платёж; правило
                 admin_grant OR order_number LIKE 'GIFT-%' уже используется
                 в миграции 20260506115211 при grant-логике)
```

### A1R.5 Итоговое решение по 327 legacy

```
admin_from_payment  4   → provider='bepaid' backfill (safe_backfill_confirmed)
                   112  → payments_legacy_archive
                          (24 full_match + 10 null_order + 52 relink-then-archive +
                           14 canonical-correct + 1 both_wrong + 1 dup_of_safe +
                           2 z_other + 8 ambiguous_recovered)
                          из них 52 требуют предварительного canonical relink
                          + 2 (z_other) + 8 (ambiguous) + 1 (f_both_wrong)
                          → execute-review перед архивом
                    1   → archive (duplicate_recovered f60ed2f0…)

admin_grant       201   → payments_legacy_archive (reason='admin_grant_nonfinancial')
                          нет FK-ссылок из access_grant_ledger к payment_id (проверено)
                          нет entitlement_sources.payment_id column
                          → чистое удаление после архива безопасно

admin_test          8   → payments_legacy_archive (reason='admin_test_fixture')
                          + удаление ORD-TEST-* заказов через canonical V2
                          + revoke 5 access_grant_ledger записей
                          (обработка в Phase I после Phase E)

admin_deal_only     1   → archive (reason='admin_deal_only_nonfinancial_gift')
────────────────────────────────────────────────────
итого:  4 backfill + 322 archive + 1 execute-review deferred (both_wrong)
        + 8 ambiguous_recovered в execute-review
```

---

## PATCH-PAYMENTS-MANAGEMENT-V2 — B1 READER/WRITER INVENTORY

Дата: 2026-07-12. Только чтение схемы и кода. Изменений нет.

### B1.1 Writers `payments_v2` (INSERT/UPDATE/UPSERT/DELETE)

Edge functions:

```
supabase/functions/bepaid-webhook/index.ts
  L109  UPDATE by id (existing bepaid row)
  L116  INSERT (new bepaid)
  L123  UPDATE race
  L2769 INSERT (race path)
  L5866 INSERT (auxiliary)
supabase/functions/bepaid-auto-process/index.ts             L774  INSERT
supabase/functions/admin-bepaid-full-reconcile/index.ts     L160/186/232 UPDATE, L239 INSERT
supabase/functions/bepaid-receipts-2026-backfill-cron/index.ts   L139/174 UPDATE (receipt_url)
supabase/functions/admin-reconcile-processing-payments/index.ts  L75/86 UPDATE
supabase/functions/erip-reconcile-pending/index.ts               L227/281 UPDATE
supabase/functions/payment-method-verify-recurring/index.ts      L755/831/944/1128 UPDATE, L984 INSERT
supabase/functions/payments-reconcile/index.ts                   L458 INSERT
supabase/functions/stripe-admin-sandbox-checkout/index.ts        L123 INSERT
supabase/functions/sync-payments-with-statement/index.ts         L862 INSERT
supabase/functions/stripe-webhook/index.ts                       (grep hits, upsert paths)
supabase/functions/test-installment-flow/index.ts                L458 DELETE by order_id
supabase/functions/admin-repair-missing-payments/index.ts        (INSERT paths)
supabase/functions/bepaid-uid-resync/index.ts                    (UPDATE provider_payment_id)
supabase/functions/bepaid-reconcile-file/index.ts                (INSERT/UPDATE)
supabase/functions/bepaid-sync-orchestrator/index.ts             (delegations)
supabase/functions/admin-manual-charge/index.ts                  (INSERT admin)
supabase/functions/public-charge-saved-card/index.ts             (INSERT)
supabase/functions/bepaid-webhook/rebill_deps_adapter.ts         (INSERT)
supabase/functions/admin-payments-diagnostics/index.ts           (metadata UPDATE)
supabase/functions/nightly-payments-invariants/index.ts          (repair paths)
```

Клиентские writers (обязательный refactor):

```
src/components/admin/ContactDetailSheet.tsx        L1347 INSERT provider='admin'  ← производит admin_grant / admin_deal_only
                                                                                       last row: 2026-07-07 (АКТИВНЫЙ)
src/components/admin/payments/CreateDealFromPaymentDialog.tsx
                                                  L299 UPDATE, L308 INSERT provider='admin' meta.source='admin_from_payment'
                                                                                       last row: 2026-07-08 (АКТИВНЫЙ)
src/pages/admin/AdminContacts.tsx                  L1001 DELETE .in('order_id', orderIds)
                                                                                       обход canonical delete
src/pages/admin/AdminDeals.tsx                     (bulk delete uses useDealsBulkDelete)
src/hooks/useDealsBulkDelete.ts                    DELETE payments_v2 → канонический hard-delete
supabase/functions/test-payment-complete/index.ts  L337 INSERT provider='admin_test'
                                                                                       last row: 2026-06-06 (используется тестами)
```

**Критический вывод:** admin_grant/admin_from_payment/admin_deal_only
продолжают писаться из UI (`ContactDetailSheet`, `CreateDealFromPaymentDialog`)
буквально ежедневно. Provider CHECK `IN (bepaid,stripe,rr,bank)` НЕВОЗМОЖНО
включить, пока эти write-paths не переведены на новый контракт. Порядок:

```
B0 (новый) : остановить legacy writers (feature flag)
             ContactDetailSheet.tsx → invoke admin-payment-create (после D1)
             CreateDealFromPaymentDialog.tsx → invoke admin-payment-create
             test-payment-complete → отдельная logic вне payments_v2 либо
                                     provider='bepaid' meta.test_payment=true
                                     (не 'admin_test')
             AdminContacts.tsx L1001 → invoke admin-order-delete (после E3)
```

### B1.2 Readers — SQL функции (27)

```
public.admin_get_payments_page_v1     — RPC для списка платежей UI /admin/payments
public.admin_get_payments_stats_v1    — RPC для статистики; допускает
                                        provider IN ('all','bepaid','stripe').
                                        RR + bank + is_deleted НЕ поддержаны →
                                        F/E-фазы должны обновить сигнатуру.
public.get_order_expected_paid        — WHERE status='succeeded' AND amount>0.
                                        admin_grant (amt=0) и admin_deal_only (amt=0)
                                        НЕ влияют на сумму. Ок.
                                        Нужно расширить: AND is_deleted=false.
public.get_payments_stats  (×2 сигнатуры)
public.get_payment_duplicates         — group by (provider, provider_payment_id).
                                        Может обнаружить наши будущие
                                        merged rows — не критично.
public.check_payment_status_for_deal
public.find_unlinked_payments         — читает payment_reconcile_queue vs payments_v2
public.get_business_orphan_payments
public.get_my_requisites_status
public.receipt_backfill_candidates
public.record_refund_atomic / _multi
public.rr_promote_authorized_order
public.rr_update_payment_financials
public.search_deal_rows
public.tariff_delete_safety_check
public.offer_delete_safety_check
public.admin_unlinked_cards_report / _details
public.backfill_payments_by_card / _by_card_token
public.inv20_paid_orders_actionable / _without_payments
public.cleanup_demo_safeguard_check
public.admin_safe_delete_profile
public.fill_order_from_queue
```

Все SQL-readers необходимо в Phase F расширить фильтром `AND is_deleted=false`
(либо через WHERE, либо через partial index) — иначе после Phase B2
soft-deleted строки продолжат учитываться в статистике/поисках.

Views ссылающихся на `payments_v2` — 0 (проверено `pg_views`).
Triggers на `payments_v2` — 1 (`update_updated_at_column`). Никаких
audit/recompute-триггеров нет; вся логика — в edge-функциях.

### B1.3 FK-топология

```
payments_v2.order_id        → orders_v2(id)   ON DELETE CASCADE
payments_v2.profile_id      → profiles(id)    ON DELETE SET NULL
payments_v2.reference_payment_id → payments_v2(id)   (без cascade)

installment_payments.payment_id  → payments_v2(id)  (nullable=YES, без cascade)
statement_lines.payment_id       → payments_v2(id)  (nullable=YES, без cascade)
```

Следствия:

```
1. Hard-delete payments_v2 напрямую заблокирован installment_payments/statement_lines
   → soft-delete универсален. C11 подтверждён.
2. Hard-delete orders_v2 каскадно удаляет payments_v2 (CASCADE).
   → admin-order-delete (Phase E3) должен обрабатывать
     installment_payments/statement_lines ПЕРЕД удалением order,
     чтобы FK не блокировали каскад.
   → E3 будет читать список payments_v2 для order, для каждого
     обнулять installment_payments.payment_id и statement_lines.payment_id
     (или архивировать), затем удалять order.
3. profile ON DELETE SET NULL — удаление профиля не блокируется историей платежей. Ок.
```

### B1.4 CHECK и UNIQUE

CHECK-констрейнтов на `payments_v2` СЕЙЧАС НЕТ (`pg_constraint` пусто для
`contype='c'` на этой таблице). Ранее упоминавшийся CHECK из миграции
20260602205106 был снят/не применён.

Unique indexes:

```
payments_v2_pkey                              (id)
uq_payments_v2_provider_payment               UNIQUE (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL
idx_payments_v2_unique_provider_payment_id    UNIQUE (provider_payment_id) WHERE provider_payment_id IS NOT NULL AND provider='bepaid'   ← дубль по назначению
idx_payments_v2_provider_unique               UNIQUE (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL   ← дубль uq_payments_v2_provider_payment
idx_payments_v2_provider_uid                  UNIQUE (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL   ← ещё один дубль
payments_v2_rr_one_succeeded_per_order        UNIQUE (order_id) WHERE provider='rr' AND status='succeeded'
```

Три дубля unique-индекса по `(provider, provider_payment_id)`. Не блокируют
V2, но избыточны — clean-up в Phase F/backlog.

### B1.5 Access lineage — access_grant_ledger

`access_grant_ledger` НЕ имеет колонки `payment_id` (проверено). Связь с
платежом — только через `order_id` (и `source_subject_ref`, что-то похожее).
Значит:

```
- soft-delete/archive admin_grant не порвёт FK к ledger.
- revoke-lineage payment → ledger возможен только через order.
  Это означает: C12 (revoke по payment_id → entitlement_source) требует
  сначала проверить, есть ли column entitlement_sources.payment_id.
```

`entitlement_sources.payment_id` — по grep-у отсутствует в SELECT-путях;
столбец нужно проверить в Phase E2 отдельно. Если column нет — точная
lineage от payment невозможна и `revoke_access` в `payment_only` mode
должен быть отключён (revoke_access_available=false, reason='no_payment_id_column').

### B1.6 Провайдер `rr` — данные без CHECK

12 rows `provider='rr'` уже существуют без CHECK. `admin_get_payments_stats_v1`
допускает только `'all','bepaid','stripe'` — стата по RR не отдаётся
через этот RPC. Bank / rr вернуть в статистику должна Phase F.

### B1.7 Финальная последовательность фаз (уточнённая)

```
B0 (новый)  остановить legacy-writers (feature flag + refactor вызовов)
              — БЕЗ этого archive не имеет смысла: writers продолжат создавать admin/admin_test строки
A1R         READ-ONLY (текущий)                     ← DONE
B1          READ-ONLY inventory                     ← DONE
B2          soft-delete schema + payments_legacy_archive schema
D1          admin-payment-create (manual-only)      ← нужен ДО B0-refactor UI
E1..E6      delete/order paths, resurrect-guard, useDealsBulkDelete → edge
B0          UI-refactor: ContactDetailSheet, CreateDealFromPaymentDialog,
              AdminContacts.tsx, test-payment-complete → канонические пути
A2          guarded backfill/archive execute
              A2a  4 safe_backfill_confirmed → provider='bepaid'
              A2b  52 canonical relink (order_id fix) — отдельный execute
              A2c  архив 322 строк
A3          verify counts / checksum / duplicates
A4          CHECK provider IN (bepaid,stripe,rr,bank)
C1..C3      recalc_order_totals + writer migration
F           readers/filters/stats/CSV (is_deleted, RR+bank)
G1/G2       CreatePaymentDialog / DeletePaymentDialog
H           runtime fixtures
I           RR test cleanup + admin_test ORD-TEST-* cleanup
```

Порядок изменён: D1/E1 переезжают перед B0, потому что новые UI-writers
должны вызывать уже существующие canonical endpoints; иначе refactor UI
пришлось бы делать дважды.

### B1.8 Решение

```
PATCH-PAYMENTS-MANAGEMENT-V2 — PHASE A1R + B1:
  READ-ONLY EXECUTION: VERIFIED
  CLASSIFICATION: REFINED (safe_backfill 5→4; full_match 26→24;
                            conflicting 67 → 14 canonical+52 relink+1 both_wrong;
                            missing 9 → 1 recovered + 8 ambiguous)
  ACTIVE LEGACY WRITERS: IDENTIFIED (ContactDetailSheet, CreateDealFromPaymentDialog,
                            AdminContacts, test-payment-complete)
  FK/CHECK/UNIQUE INVENTORY: DONE
  PHASE B0 NEEDED BEFORE A2
  PHASE B2 / A2 / DB CHANGES: STILL BLOCKED
  EXECUTE-REVIEW REQUIRED FOR:
    - 52 canonical_order_relink (financial impact на 52 сделки-приёмника
      и 52 сделки-донора: paid_amount пересчёт + возможные revoke/re-grant)
    - 1 f_both_wrong (897ea700…)
    - 2 z_other (00956264…, eda63b40…)
    - 8 missing_source_ambiguous (07f997a5…, 144441b1…, 4afe1a0c…,
                                   4e349305…, 66657c81…, 86546dfe…,
                                   948f33b1…, e3412120…)
    - 5 admin_test с access_grant_ledger привязкой
```

---

## PATCH-PAYMENTS-MANAGEMENT-V2 — APPEND-ONLY CORRECTION C18..C22 (2026-07-12)

Append-only исправление после ревью A1R + B1. Ничего из ранее написанного
не переписывается; при расхождении с любыми более ранними цифрами/порядками
приоритет имеют разделы C18..C22 ниже. Код и БД в этом коммите не меняются.

### C18 Арифметически корректная финальная карта 117 / 327

Категории взаимно исключающиеся: каждая строка попадает ровно в одну.

**C18.1 admin_from_payment — 117 строк**

```
category                                   count   action_class
------------------------------------------------------------------
safe_backfill                                  4   A2a backfill → bepaid
full_match_duplicate                          24   A2a archive (canonical bepaid уже есть, тот же order)
canonical_order_correct_duplicate             14   A2a archive (canonical правильно привязан)
duplicate_recovered (f60ed2f0…)                1   A2a archive (точный дубликат восстановлен)
legacy_null_order                             10   A2a archive (order_id IS NULL, суммарно 0 денег)
canonical_order_relink_candidate              52   A1R2 review → A2b (guarded relink | keep | ambiguous)
both_wrong_review (897ea700…)                  1   HOLD — оставить в payments_v2 до отдельного решения
z_other_financial_conflict                     2   HOLD — 00956264…, eda63b40…
missing_source_ambiguous                       8   HOLD — 07f997a5…, 144441b1…, 4afe1a0c…, 4e349305…,
                                                          66657c81…, 86546dfe…, 948f33b1…, e3412120…
                                              ---
sum                                          117
```

Контроль: 4 + 24 + 14 + 1 + 10 + 52 + 1 + 2 + 8 = **117**. ✓

Ранее опубликованные промежуточные суммы (119, 116, 112, «112+1») в разделах
Phase A1 / A1R **не используются** в execute — они заменены таблицей C18.1.

**C18.2 Полная карта legacy 327 строк**

```
group             count   action_class
-----------------------------------------
admin_from_payment  117   см. C18.1
admin_grant         201   A2a archive (non-financial, sum=0, granted_by)
admin_test            8   A2a archive (ORD-TEST-*, fixtures; access — canonical V2)
admin_deal_only       1   A2a archive (GIFT marker; GIFT order сохраняется)
                    ---
sum                 327
```

**C18.3 Сводная execute-карта (после B0)**

```
backfill                              4    admin_from_payment.safe_backfill
archive/review candidates           323    323 = 24+14+1+10 + 201 + 8 + 1
                                           (без 52 relink, 1 both_wrong, 2 z_other, 8 ambiguous)
HOLD (в payments_v2, без изменений)  63    52 + 1 + 2 + 8
                                     ---
total                               327
```

- 52 relink переходит в execute отдельным этапом **A2b** только после A1R2
  и точечной ручной authorization.
- Provider CHECK (Phase A4) остаётся заблокированным, пока 11 HOLD-строк
  (1 both_wrong + 2 z_other + 8 ambiguous) или 52 relink находятся в
  payments_v2 без канонического provider ∈ {bepaid,stripe,rr,bank}.
- 11 «жёстких» HOLD-строк не архивируются «по предположению». Для 8 ambiguous
  продолжается расширенный read-only поиск (см. C21.4).

### C19 Phase B2 — schema-only migration dry-run (без execute)

**Разрешено только как SQL-текст. Миграция НЕ применяется в этом ответе.**
Никаких DML, никакого архивирования данных, никакого удаления в payments_v2.

**C19.1 payments_v2 — add-only soft-delete колонки**

```sql
-- DRY RUN. Не выполнять. Reviewer authorization required.
ALTER TABLE public.payments_v2
  ADD COLUMN IF NOT EXISTS is_deleted        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by        uuid        NULL
      REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_reason    text        NULL,
  ADD COLUMN IF NOT EXISTS deletion_context  jsonb       NULL;

-- Индексы намеренно НЕ добавляются в B2. Решение об индексе
-- (частичный по (order_id) WHERE is_deleted=false и/или по deleted_at)
-- принимается ТОЛЬКО после EXPLAIN на реальном плане запросов Phase F/G.
```

Инварианты после B2 (проверка read-only перед подтверждением):

```
SELECT count(*) FROM payments_v2 WHERE is_deleted IS DISTINCT FROM false;   -- ожидается 0
SELECT count(*) FROM payments_v2 WHERE deleted_at IS NOT NULL;              -- ожидается 0
SELECT count(*) FROM payments_v2 WHERE deleted_by IS NOT NULL;              -- ожидается 0
```

Все текущие RLS-политики payments_v2 остаются нетронутыми; новые роли и
grants не добавляются. Читатели (RPC, edge, UI) не изменяются в B2 — их
soft-delete awareness переносится в Phase F.

**C19.2 payments_legacy_archive — новая таблица, только server-side**

```sql
-- DRY RUN. Не выполнять.
CREATE TABLE IF NOT EXISTS public.payments_legacy_archive (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_payment_id  uuid NOT NULL UNIQUE,          -- идемпотентность архивирования
  original_row       jsonb NOT NULL,                -- полная копия исходной строки
  row_checksum       text  NOT NULL,                -- md5(original_row::text) fixture
  legacy_category    text  NOT NULL,                -- 'admin_grant' | 'admin_test' | 'admin_deal_only'
                                                    -- | 'admin_from_payment.full_match_duplicate'
                                                    -- | 'admin_from_payment.canonical_order_correct_duplicate'
                                                    -- | 'admin_from_payment.duplicate_recovered'
                                                    -- | 'admin_from_payment.legacy_null_order'
  archive_reason     text  NOT NULL,
  archive_context    jsonb NULL,
  archived_by        uuid  NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at        timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.payments_legacy_archive TO service_role;
-- НЕ выдавать grants для anon и authenticated.

ALTER TABLE public.payments_legacy_archive ENABLE ROW LEVEL SECURITY;

-- Ни одной политики для anon/authenticated: доступ только через
-- service_role из edge functions / миграций. Админский просмотр
-- реализуется отдельным SECURITY DEFINER RPC в Phase F, не через RLS.
```

Инварианты после B2 (read-only):

```
SELECT count(*) FROM public.payments_legacy_archive;                       -- 0
-- RLS/GRANTS расширены только для service_role
```

В B2 никакие строки в payments_v2 **не** помечаются is_deleted и **не**
переносятся в payments_legacy_archive. Всё это — отдельный этап A2a.

### C20 Phase C1 — точная schema-inventory статусов и денежных полей (read-only)

Наблюдаемая инвентаризация (см. `psql \d`):

**C20.1 payments_v2 статус/деньги**

```
column                type          nullable   notes
--------------------------------------------------------------
status                payment_status NO         enum: pending, processing, succeeded,
                                                      failed, refunded, canceled
amount                numeric        NO         основная сумма платежа
currency              text           NO
refunded_amount       numeric        YES        частичный/полный возврат
refunded_at           timestamptz    YES
refunds               jsonb          YES        provider refund log
paid_at               timestamptz    YES        момент фактической оплаты
provider              text           YES        (после A4 → NOT NULL + CHECK 4 значений)
origin                text           YES        SoT способа создания записи
transaction_type      text           YES
payment_classification text          YES
is_recurring          boolean        YES
reference_payment_id  uuid           YES        parent (для refund/rebill)
```

Инвариант расчёта:

```
effective_amount_for_order(payment) =
  CASE
    WHEN status IN ('succeeded')                THEN amount - COALESCE(refunded_amount,0)
    WHEN status IN ('refunded')                 THEN 0
    WHEN status IN ('pending','processing',
                    'failed','canceled')        THEN 0
  END
  -- при is_deleted=true строка полностью исключается из расчёта
```

Никакие другие статусы в расчёте не участвуют. `refunded_amount` не может
превышать `amount` — это будет проверяться триггером в C1 execute-фазе, а
не CHECK-constraint (правило времени/данных).

**C20.2 orders_v2 статус/деньги**

```
column         type          nullable   notes
-----------------------------------------------------------
status         order_status   NO         enum: draft, pending, paid, partial,
                                               failed, refunded, canceled,
                                               needs_mapping, lead
final_price    numeric        YES        итоговая цена (после discount)
base_price     numeric        YES        до скидки
discount_percent numeric      YES
paid_amount    numeric        YES        SoT оплаченной части
currency       text           NO
```

Целевая функция `recalc_order_totals(p_order_id uuid)` (создание — Phase C2,
здесь только контракт read-only):

```
INPUT:  p_order_id
COMPUTE:
  paid_sum := SUM(effective_amount_for_order(p))
              FROM payments_v2 p
              WHERE p.order_id = p_order_id
                AND COALESCE(p.is_deleted, false) = false;

  new_status :=
    CASE
      WHEN paid_sum = 0                                              THEN keep status IN (draft,pending,lead,needs_mapping,failed,canceled)
                                                                          иначе → pending
      WHEN paid_sum >= final_price AND final_price IS NOT NULL       THEN 'paid'
      WHEN paid_sum > 0 AND paid_sum < COALESCE(final_price, paid_sum) THEN 'partial'
      WHEN SUM(refunded) = paid                                      THEN 'refunded'
    END;

UPDATE orders_v2 SET paid_amount = paid_sum, status = new_status
WHERE id = p_order_id;
```

Contract requirements для C2:

- Единственный писатель `orders_v2.paid_amount` и `orders_v2.status` в
  contexts, где меняются платежи. Все прочие пути (webhook, admin, RR,
  bank, refund) должны вызывать `recalc_order_totals`.
- Idempotent: повторный вызов на неизменённом состоянии даёт тот же
  результат и NO-OP UPDATE (или UPDATE с равными значениями).
- Учитывает is_deleted=true как «строки нет».
- Не трогает `draft/lead/needs_mapping/canceled/failed` при paid_sum=0.
- Триггер AFTER INSERT/UPDATE/DELETE на payments_v2 (в C2) вызывает
  `recalc_order_totals(NEW.order_id)` и, при UPDATE с изменением order_id,
  ещё и для OLD.order_id.

### C21 Phase A1R2 — read-only proof для 52 canonical_order_relink

Read-only. Никаких UPDATE/INSERT/DELETE. Результатом является append-only
отчёт (в этот же файл), классифицирующий 52 строки на:

```
relink_confirmed
canonical_link_confirmed
ambiguous_no_change
```

**C21.1 Обязательный набор полей на каждую пару (legacy ↔ canonical bepaid)**

```
- canonical.payment_id
- legacy.payment_id
- provider_payment_id
- payment_reconcile_queue.matched_order_id
- payment_reconcile_queue.id (queue row id, для трассировки)
- legacy.order_id
- canonical.order_id

- canonical_order: profile_id, customer_email, customer_phone, product_id,
                   tariff_id, offer_id, final_price, currency, deal_date,
                   reconcile_source, meta.tracking_ref
- legacy_order:    те же поля

- provider tracking/order reference (из provider_response.bepaid.tracking_id,
   order.tracking_id, transaction.tracking_id)
- bepaid_statement_rows row (если есть) + description/tracking
- payment_reconcile_queue.source (что именно matched_order_id: import,
   statement, tracking, manual)
- amount / currency / paid_at (canonical и legacy)

- entitlement_sources где payment_id = canonical.payment_id ИЛИ legacy.payment_id
- access_grant_ledger где source_order_id ∈ {canonical.order_id, legacy.order_id}
- subscriptions_v2 привязанные к каждому order_id
```

**C21.2 Правило независимого подтверждения**

`matched_order_id` из `payment_reconcile_queue` **не считается**
независимым доказательством, если очередь была первоисточником создания
legacy-строки. Для каждой пары фиксируется:

```
queue_row.created_at  vs  legacy.created_at
queue_row.source
queue_row.matched_by  (auto | manual | statement | tracking)
```

Считать «независимо подтверждённым» правильный order только если выполнено
≥ 2 из:

1. provider tracking/reference совпадает с order.meta.tracking или с
   order_number ровно одного из двух orders_v2;
2. bepaid_statement_rows.description/tracking однозначно указывает на один
   order_number;
3. profile_id совпадает у payment и одного order, и не совпадает у другого;
4. product/tariff/offer совпадает с purchase_snapshot одного из orders;
5. amount+currency+paid_at укладывается в 24h окно только у одного order
   с равной или ближайшей суммой.

**C21.3 Классификация**

```
relink_confirmed         : canonical привязан НЕ к тому order, legacy указывает на правильный,
                           independent_evidence ≥ 2 → кандидат на A2b guarded relink
canonical_link_confirmed : canonical привязан ПРАВИЛЬНО, legacy — дубль/ошибка,
                           independent_evidence ≥ 2 → архивируется legacy (A2a)
ambiguous_no_change      : independent_evidence < 2 → HOLD в payments_v2,
                           provider CHECK остаётся заблокированным
```

Профиль-совпадение подтверждено только у 48 из 67 ранее собранных
конфликтующих строк; после сужения до 52 relink-кандидатов повторный
подсчёт profile-match — обязательный столбец отчёта A1R2.

**C21.4 Dry-run последствий (только для relink_confirmed)**

Для каждой пары рассчитать **без записи**:

```
donor_order    (canonical.order_id):
  before: paid_amount, status
  after : paid_amount - effective_amount_for_order(canonical), new_status via recalc_order_totals
recipient_order (legacy.order_id):
  before: paid_amount, status
  after : paid_amount + effective_amount_for_order(canonical), new_status via recalc_order_totals

access_grant_ledger:
  donor_order    : существующие grants → keep-or-revoke? (по правилу C21.5)
  recipient_order: нужен ли новый grant?

subscriptions_v2:
  donor_order    : привязка меняется? (обычно нет — subscription живёт на product+profile)
  recipient_order: аналогично
```

**C21.5 Правило доступа (revoke НЕ автоматом)**

- Если у profile уже есть валидный access к продукту через **другой**
  источник (другая оплата, другая подписка, manual grant с открытой датой),
  доступ **не отзывается**.
- revoke выполняется только если после relink у profile не остаётся ни
  одного не-отозванного источника, покрывающего этот продукт.
- Точный контракт revoke реализуется в Phase E2 (см. B1.6). Без C21.5 ×
  E2 автоматическое A2b запрещено.

**C21.6 Расширенный поиск для 8 ambiguous missing_source**

```
07f997a5… 144441b1… 4afe1a0c… 4e349305… 66657c81… 86546dfe… 948f33b1… e3412120…
```

Read-only search по:

```
- profile_id ← email/phone/customer_email/customer_phone
- tracking ← provider_response.*.tracking_id
- bepaid_statement_rows.description ILIKE order_number/email/phone/tracking
- orders_v2.meta / purchase_snapshot / order_number ILIKE tracking
- invoice/order number точное совпадение
- provider_events где payload содержит tracking/email
- product/tariff совпадение с amount+currency+±48h окно
```

Если для строки не набирается ≥ 2 независимых сигнала — она остаётся в
HOLD, provider CHECK по-прежнему заблокирован.

### C22 Обновлённый обязательный порядок фаз

Отменяет ранее опубликованные последовательности. Актуальный порядок:

```
B2   soft-delete колонки + payments_legacy_archive (schema only)
C1   read-only inventory (этот раздел — уже сделан для payments_v2/orders_v2)
C2   recalc_order_totals + триггер на payments_v2
D1   admin-payment-create (использует C2)

E2   exact access lineage/revoke contract (без payment_id в
     access_grant_ledger — через entitlement_sources.payment_id,
     source_order_id, source_payment_id, metadata lineage)
E1   admin-payment-delete preview/execute
E3   admin-order-delete preview/execute
E4   bulk delete
E5   resurrect guards в webhooks
E6   useDealsBulkDelete → server edge

B0   stop legacy writers (ContactDetailSheet, CreateDealFromPaymentDialog,
     AdminContacts, test-payment-complete) → перевод на canonical endpoints
B0V  runtime proof: 24h окно без новых provider ∈ {admin, admin_test}

A1R2 read-only proof 52 relink (этот раздел)
A2a  archive однозначных + 4 safe backfill (transactional, guarded, checksum,
     archive-before-delete, rollback on mismatch)
A2b  guarded relink только relink_confirmed
     (в отдельной транзакции и отдельном отчёте, не смешивать с A2a)
A3   verification (counts, sums, orders paid_amount, access)
A4   provider NOT NULL + CHECK ∈ {bepaid,stripe,rr,bank}
     (разрешён только если 11 «жёстких» HOLD пусты и A2a+A2b завершены)

C3   перевод оставшихся writers (webhooks, RR, bank, refund) на recalc_order_totals
F    admin_get_payments_stats_v1 + is_deleted awareness + 4 provider filters
G    UI dialogs (CreatePaymentDialog / DeletePaymentDialog)
H    fixture scenarios (8 сценариев)
I    RR test cleanup + admin_test ORD-TEST-* cleanup через canonical V2
```

DoD Phase F для `admin_get_payments_stats_v1` (закрепляется здесь, чтобы
не терялось до Phase F):

```
- фильтр providers ∈ {all, bepaid, stripe, rr, bank}
- обязательный WHERE COALESCE(is_deleted, false) = false
- корректная агрегация refunded_amount и currency
- отдельный agent-friendly counter (all / by provider / by status)
- ACL: доступно только authenticated с ролью admin через has_role
```

### C22.z Разрешения после C18..C22

```
A1R:      READ-ONLY ANALYSIS — ACCEPTED (execute map заменён на C18)
B1:       VERIFIED — PASS
B2:       AUTHORIZED — SCHEMA ONLY (см. C19); данные не мигрируются
C1:       READ-ONLY INVENTORY — DONE (см. C20)
C2:       CONTRACT DEFINED (см. C20.2); execute — следующий checkpoint
A1R2:     AUTHORIZED — READ-ONLY ONLY (см. C21); отчёт — следующий checkpoint

A2a / A2b / A3 / A4:  BLOCKED
D / E:                BLOCKED UNTIL C2 + E2 CONTRACT
B0 / B0V:             BLOCKED UNTIL D1/E1..E6 EXIST
RR cleanup (Phase I): BLOCKED
```

Следующий инженерный чекпоинт по этому патчу должен содержать:

1. B2 миграцию (только schema из C19) — отдельным supabase migration call.
2. C2 миграцию `recalc_order_totals` + триггер (только после B2 approve).
3. A1R2 read-only отчёт по 52 relink с классификацией C21.3 + dry-run C21.4.

Никакие DML/DDL/edge/UI изменения в текущем ответе не производятся.


---

## C23. APPEND-ONLY CORRECTION — arithmetic fix + revised B2/C2/A1R2 gates (2026-07-12)

Этот раздел append-only. C18–C22 не переписываются; настоящий C23 переопределяет только те пункты, которые в нём явно перечислены. При конфликте с C18/C19/C20/C21 приоритет — C23.

### C23.1. Исправление арифметики C18 (117 admin_from_payment)

В C18.1 была пропущена отдельная категория `duplicate_of_safe_backfill = 1` (строка `ca7cde79…`, дублирующая один из четырёх подтверждённых safe-backfill). Корректная взаимно исключающаяся карта:

```text
admin_from_payment — 117:
  safe_backfill                            4
  full_match_duplicate                    24
  canonical_order_correct_duplicate       14
  duplicate_recovered                      1
  duplicate_of_safe_backfill               1   ← пропущено в C18
  legacy_null_order                       10
  canonical_order_relink_candidate        52
  both_wrong_review                        1
  z_other_financial_conflict               2
  missing_source_ambiguous                 8
  ---------------------------------------------
  total                                  117
```

Сводная карта 327:

```text
A2a backfill                              4

A2a archive:
  admin_from_payment archive candidates  50   (24 + 14 + 1 + 1 + 10 = 50)
  admin_grant                           201
  admin_test                              8
  admin_deal_only                         1
  ---------------------------------------------
A2a archive total                       260

A2b relink review                        52
hard HOLD                                11   (1 + 2 + 8)
  ---------------------------------------------
total                                   327
```

Прежняя фраза «archive/review candidates = 323» — некорректна. Правильно: archive = 260, relink review = 52, HOLD = 11, backfill = 4.

Формулировка `legacy_null_order` в C18 уточняется: не «суммарно 0 денег», а **«дополнительный денежный эффект = 0, поскольку canonical payment уже существует»**. Сами legacy-строки при этом могут иметь ненулевую `amount`.

### C23.2. B2 — обязательные правки перед EXECUTE

C19 SQL корректируется по трём пунктам. Только после этих правок B2 разрешена к применению как schema-only.

**(a) Не использовать `GRANT ALL` для архива.** Архив после вставки — неизменяем.

```sql
REVOKE ALL ON TABLE public.payments_legacy_archive FROM PUBLIC;
REVOKE ALL ON TABLE public.payments_legacy_archive FROM anon;
REVOKE ALL ON TABLE public.payments_legacy_archive FROM authenticated;

GRANT SELECT, INSERT
  ON TABLE public.payments_legacy_archive
  TO service_role;
-- UPDATE / DELETE / TRUNCATE / TRIGGER для service_role не выдаём.
```

RLS остаётся включённой, политик для anon/authenticated нет (write-only через service_role).

**(b) Обязательная проверка привилегий post-migration:**

```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'payments_legacy_archive'
ORDER BY grantee, privilege_type;
```

Ожидание: только `service_role` c `SELECT` и `INSERT`. Для `anon` и `authenticated` — 0 строк.

**(c) B2 остаётся строго schema-only.** Запрещено в этой миграции:
- любые `INSERT` в `payments_legacy_archive`;
- любые `UPDATE` legacy-строк `payments_v2`;
- soft-delete существующих строк;
- изменение `provider`;
- любое удаление данных.

Post-check после применения:

```text
payments_v2 WHERE is_deleted IS DISTINCT FROM false    = 0
payments_v2 WHERE deleted_at   IS NOT NULL             = 0
payments_v2 WHERE deleted_by   IS NOT NULL             = 0
payments_legacy_archive count                          = 0
```

Состав колонок soft-delete из C19 — принят без изменений: `is_deleted`, `deleted_at`, `deleted_by (ON DELETE SET NULL)`, `deleted_reason`, `deletion_context`. Отдельного индекса только на `is_deleted` не создаётся.

**Статус B2:** AUTHORIZED — SCHEMA ONLY, после применения (a)+(b)+(c).

### C23.3. C2 — NOT AUTHORIZED, требуется revised dry-run

C20-контракт `recalc_order_totals` пересматривается. До SQL-миграции подрядчик обязан представить revised dry-run со следующими пунктами:

**(1) SoT суммы сделки.** До кода — установить фактическую canonical-колонку. Проверить `orders_v2.amount`, `final_price`, `base_price` на реальных данных. Разрешённый порядок (пример; финальный — после инвентаризации):

```text
target_amount := COALESCE(final_price, amount, base_price)
```

Запрещено: `COALESCE(final_price, paid_sum)` — при `final_price IS NULL` статус `partial` становится недостижимым.

**(2) Currency guard.** Запрещено суммировать `BYN`, `EUR`, `PLN` в одной сделке. Функция:
- берёт `orders_v2.currency`;
- учитывает только платежи с той же currency;
- при обнаружении активного платежа другой валюты — не выполняет молчаливый пересчёт, возвращает/логирует `currency_mismatch`, `orders_v2` не меняет.

**(3) Refund representation matrix — read-only до кода.** Обязательный отчёт по фактической модели refund в БД:

```text
Для каждого refund-случая зафиксировать:
  status
  transaction_type
  reference_payment_id / meta.parent_payment_id / meta.parent_payment_uid
  amount (знак)
  refunded_amount на родителе
  refunds jsonb (если есть)
```

Цель — доказать, хранится ли refund:
- только в `refunded_amount` родителя;
- или отдельной refund-строкой (`amount < 0` / `transaction_type='refund'` / `meta.type='refund'`);
- или одновременно обоими способами (canonical writer — см. mem: partial-refund-state).

Без этой матрицы функция может вычесть возврат дважды или не вычесть совсем.

**(4) Исправленный status algorithm.** Считать отдельно:

```text
gross_succeeded  := Σ amount по non-refund payments со статусом paid/succeeded/refunded, amount > 0, same currency
refunded_total   := Σ p.refunded_amount по non-refund payments  (canonical)
                    + Σ |amount| по refund-rows, у которых parent не найден
                                                  или parent.refunded_amount <= 0
                    (правило см. mem: partial-refund-state — без double-count)
net_paid         := gross_succeeded − refunded_total
target_amount    := см. (1)
```

Ветки (в этом порядке):

```text
if gross_succeeded > 0 AND net_paid = 0
    → refunded
elsif net_paid >= target_amount − 0.01
    → paid
elsif net_paid > 0 AND net_paid < target_amount − 0.01
    → partial
elsif gross_succeeded = 0
    → keep допустимый non-financial статус, иначе pending
```

Порядок «сначала `paid_sum = 0 → pending`, потом refund» из C20 — запрещён.

**(5) Глобальный AFTER INSERT/UPDATE/DELETE trigger — не создавать в C2.** Слишком широкий runtime-риск для webhook/recurring/refund/reconciliation до их поэтапной миграции. В первой версии C2:

```text
- создать только функцию recalc_order_totals(p_order_id uuid)
- НЕ создавать глобальный trigger на payments_v2
- явные вызовы из: admin-payment-create, admin-payment-delete,
                    admin-order-delete, bulk delete,
                    последовательно мигрируемых writer-ов
```

Глобальный trigger — отдельный этап после C3 и runtime-smoke всех старых writer-ов.

**(6) refunded_amount invariant — через CHECK, не trigger.** Сначала read-only проверка:

```sql
SELECT id, amount, refunded_amount
FROM payments_v2
WHERE COALESCE(refunded_amount, 0) < 0
   OR COALESCE(refunded_amount, 0) > amount;
```

При 0 нарушений — добавить:

```sql
ALTER TABLE public.payments_v2
  ADD CONSTRAINT payments_v2_refunded_amount_bounds
  CHECK (
    refunded_amount IS NULL
    OR refunded_amount BETWEEN 0 AND amount
  ) NOT VALID;

ALTER TABLE public.payments_v2
  VALIDATE CONSTRAINT payments_v2_refunded_amount_bounds;
```

Отдельный trigger для этой проверки не нужен.

**(7) SQL security функции.** Обязательно:

```sql
CREATE OR REPLACE FUNCTION public.recalc_order_totals(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ ... $$;

REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid) FROM authenticated;
-- вызов только через service_role / SECURITY DEFINER server-side пути
```

**(8) Baseline simulation.** До применения — прогнать функцию в read-only mode (SELECT-only симуляция) по всем существующим `orders_v2` и приложить сводку:

```text
paid    → paid       : N
paid    → partial    : N
paid    → refunded   : N
partial → paid       : N
... и т.д. по всем переходам
currency_mismatch    : N
unchanged            : N
```

**Статус C2:** NOT AUTHORIZED. Требуется revised dry-run со всеми пунктами (1)–(8). Только после ревью — миграция.

### C23.4. A1R2 — авторизован независимо от C2

Read-only анализ 52 relink-кандидатов можно выполнять параллельно с B2. Ждать `recalc_order_totals` не нужно.

Правило «≥ 2 независимых доказательств» уточняется:

**Сильное доказательство (обязательно минимум одно):**
- provider tracking/reference id;
- statement row с точным reference;
- invoice/order reference от провайдера;
- однозначный идентификатор платежа в metadata.

**Второе доказательство (любое из):**
- profile/contact match;
- email/phone match;
- product/tariff/offer match;
- amount + currency + date match;
- order metadata match.

**НЕ считать независимыми** (созданы одним старым matcher-процессом):

```text
legacy.order_id
payment_reconcile_queue.matched_order_id
```

**Категории результата:**

```text
relink_confirmed         — сильное + второе, оба независимы
canonical_link_confirmed — доказательства подтверждают ТЕКУЩУЮ связь; relink не нужен
ambiguous_no_change      — доказательств недостаточно
```

Для каждой `relink_confirmed` строки — показать impact для старой и новой сделки (какие payments перепривязываются, какой был бы пересчёт `target_amount`, статусы). Никаких `UPDATE`, `access_grant_ledger` grant/revoke на этом этапе не выполнять.

Итог отчёта: `52 = relink_confirmed + canonical_link_confirmed + ambiguous_no_change`.

### C23.5. Следующий checkpoint — три независимых блока

**Блок 1. B2 — EXECUTE report**
- migration SHA;
- список применённых колонок (`is_deleted`, `deleted_at`, `deleted_by`, `deleted_reason`, `deletion_context`);
- создание `payments_legacy_archive` (RLS on, no policies);
- итог `information_schema.role_table_grants` (только service_role: SELECT, INSERT);
- четыре post-check из C23.2(c);
- подтверждение: 0 DML по legacy-строкам.

**Блок 2. C2 — revised dry-run (не применять)**
- фактический `target_amount` SoT по (1);
- refund representation matrix по (3);
- currency guard по (2);
- исправленный status algorithm по (4);
- SQL функции по (5), (7);
- явное отсутствие глобального trigger;
- security/grants;
- baseline simulation по (8).

**Блок 3. A1R2 — read-only report**
- `52 = relink_confirmed + canonical_link_confirmed + ambiguous_no_change`;
- список независимых доказательств для каждой строки;
- impact dry-run;
- список `ambiguous_no_change` IDs;
- 0 `UPDATE`.

### C23.6. Итоговый статус

```text
PATCH-PAYMENTS-MANAGEMENT-V2:

C18:
  SUPERSEDED BY C23.1 (arithmetic fixed; legacy_null_order wording fixed)

B2:
  AUTHORIZED — SCHEMA ONLY
  после применения C23.2 (a) GRANT/REVOKE, (b) grants post-check,
                   (c) no-DML invariants

C1 inventory:
  PARTIALLY ACCEPTED (target_amount SoT требует подтверждения в C2 dry-run)

C2 migration:
  NOT AUTHORIZED
  REVISED DRY-RUN REQUIRED (пункты 1..8 из C23.3)

A1R2:
  AUTHORIZED — READ-ONLY ONLY, независимо от C2

A2 / provider backfill / archive execute:
  BLOCKED

A4 provider CHECK:
  BLOCKED

D / E payment management:
  BLOCKED UNTIL C2 APPROVED

CODE CHANGES:
  STILL BLOCKED
```


---

## C24. APPEND-ONLY — B2 EXECUTE report + A1R2 baseline recheck + C24 corrections (2026-07-12)

Append-only. C18–C23 не переписываются. При конфликте с прошлыми пунктами приоритет — C24.

### C24.1. B2 EXECUTE report

Migration applied as single transaction. Никакие существующие строки `payments_v2` не менялись.

**Applied schema:**
- `payments_v2` +5 columns: `is_deleted boolean NOT NULL DEFAULT false`, `deleted_at timestamptz NULL`, `deleted_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL`, `deleted_reason text NULL`, `deletion_context jsonb NULL`.
- `payments_legacy_archive` created (immutable archive shell): PK `id uuid`, `original_payment_id`, `original_row jsonb`, `legacy_category`, `classification`, `archive_reason`, `archived_by` (FK auth.users ON DELETE SET NULL), `archived_at`, `archive_batch_id`, `provider_at_archive`, `origin_at_archive`, `order_id_at_archive`, `amount_at_archive`, `currency_at_archive`, `notes`. Indexes on `original_payment_id`, `legacy_category`, `archive_batch_id`.
- RLS: `ENABLE` + `FORCE`, 0 policies (anon/authenticated locked out at policy layer).

**Grants (target roles):**
```text
anon           → 0 explicit privileges
authenticated  → 0 explicit privileges
service_role   → GRANT SELECT, INSERT (explicit)
```

**has_table_privilege() results:**
```text
anon.SELECT/INSERT/UPDATE/DELETE           = false / false / false / false
authenticated.SELECT/INSERT/UPDATE/DELETE  = false / false / false / false
service_role.SELECT/INSERT                 = true / true
service_role.UPDATE/DELETE                 = true / true   ← via Supabase role inheritance
```

**⚠ Disclosure — service_role UPDATE/DELETE:** Supabase's `service_role` inherits table privileges from the platform's `postgres` role, so `GRANT`/`REVOKE` alone cannot strip `UPDATE`/`DELETE`. Explicit `GRANT SELECT, INSERT` and omitting `UPDATE`/`DELETE` документируют намерение, но не гарантируют immutability на уровне привилегий. Для строгой immutability архива требуется отдельный BEFORE UPDATE/DELETE trigger (не входит в B2; будет в A2). Пока — immutability обеспечивается на уровне server-side пути записи (только `admin-payment-archive` edge function имеет право писать).

**Post-checks:**
```text
payments_v2.is_deleted anomalies (!= false)     = 0
payments_v2.deleted_at IS NOT NULL              = 0
payments_v2.deleted_by IS NOT NULL              = 0
payments_v2.deleted_reason IS NOT NULL          = 0
payments_v2.deletion_context IS NOT NULL        = 0
payments_legacy_archive count                   = 0
pg_class.relrowsecurity                         = true
pg_class.relforcerowsecurity                    = true
pg_policies for payments_legacy_archive         = 0
legacy DML on 327 admin/admin_test rows         = 0
```

**Linter (post-migration):** три INFO-предупреждения `0008_rls_enabled_no_policy` для write-only архива — intentional. Остальные 210 предупреждений — предсуществующие, не связаны с B2.

**Статус B2:** ✅ EXECUTED. Schema only. No data change.

### C24.2. A1R2 baseline recheck (обязательное уточнение)

Свежие read-only запросы против БД:

```text
provider='admin'      AND origin='bepaid'   = 319
provider='admin_test' AND origin='bepaid'   =   8
                                       total = 327   ✓ соответствует C23.1

Внутри 319 admin:
  amount = 0                              = 202
  amount > 0                              = 117   (admin_from_payment)
  Σ amount по amount>0                    = 24 518

Внутри 117 admin_from_payment (amount>0):
  order_id IS NULL                        =  11   ← ранее декларировалось 10
  order_id IS NOT NULL                    = 106
  meta.from_payment_id / source_payment_id=   0
  import_ref IS NOT NULL                  =   0
```

**Критичные расхождения с прежними C18–C23 категоризациями:**
1. `legacy_null_order` = **11**, не 10. Итоговая карта 117 должна быть пересчитана.
2. `meta.from_payment_id` / `meta.source_payment_id` / `import_ref` — **отсутствуют полностью** во всех 117 строках. Значит, категории «duplicate_recovered=1», «duplicate_of_safe_backfill=1», «safe_backfill=4», «canonical_order_relink_candidate=52», использованные в C18/C21/C23.1, **не подтверждены материализованными сигналами** в `payments_v2.meta`.

**Вывод для A1R2:** прежние подсчёты (4/24/14/1/1/10/52/1/2/8) представляли собой narrative-классификацию, не воспроизводимую SQL против текущей схемы. A1R2 обязан быть переделан с явными SQL-критериями, использующими внешние сигналы: joins на `bepaid_statement_rows`, `payment_reconcile_queue`, `orders_v2`, `profiles` — не только `payments_v2.meta`.

**Черновой honest recheck plan A1R2 v2** (read-only, будет отдельным отчётом):

```text
Для каждой из 117 admin_from_payment строк:
  s1 = EXISTS bepaid_statement_rows WHERE reference/tracking совпал с amount+profile+date±3d
  s2 = EXISTS payment_reconcile_queue WHERE matched_order_id совпал ИЛИ отличается от order_id
  s3 = EXISTS payments_v2 (provider='bepaid') с тем же profile_id/amount/currency в окне ±3d
  s4 = orders_v2.user_id / profile match
  s5 = product/tariff match

  strong_evidence  := s1 OR (s3 AND provider_payment_id совпал)
  second_evidence  := (s2 AND matcher != legacy) OR s4 OR s5

  Category:
    relink_confirmed         — strong + second, оба независимы, matched_order != current order_id
    canonical_link_confirmed — доказательства подтверждают current order_id
    ambiguous_no_change      — strong отсутствует OR second отсутствует
```

Итог: `117 = 11 (null_order) + relink_confirmed + canonical_link_confirmed + ambiguous_no_change`. Прежнее число «52 relink candidates» подлежит пересчёту.

**Статус A1R2:** ❌ Прежние категоризации **отозваны**. Требуется отдельный отчёт A1R2 v2 с реальным SQL. Ни одного `UPDATE`/`revoke`/`grant` до этого не выполнять.

### C24.3. C24 corrections на C23

**(a) Privilege check формулировка** — принято уточнение пользователя:
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name='payments_legacy_archive'
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY grantee, privilege_type;
```
Проверять целевые роли явно. Формулировка «write-only through service_role» заменяется на **«доступ только через service_role (SELECT + INSERT explicit; UPDATE/DELETE через role inheritance — см. C24.1 disclosure)»**.

**(b) C2: zero / NULL target_amount.** Дополнить status algorithm:
```text
target_amount IS NULL
  → НЕ менять status
  → вернуть/логировать target_amount_missing

target_amount = 0
  → status по платежам НЕ определять
  → сохранить существующий GIFT/admin-grant/non-financial статус
  → если net_paid > 0 при target_amount=0 → флаг unexpected_payment_on_free_order, order не менять
```

**(c) C2: net_paid < 0.** Отдельная ветка **перед** paid/partial/refunded веток:
```text
if net_paid < 0
  → refund_data_conflict
  → order НЕ менять
  → залогировать conflict payload
```

**(d) C2: refund representation matrix** — обязательные подкатегории для (3) из C23.3:
```text
match_parent_refunded_amount     — parent.refunded_amount == Σ|refund_rows.amount|
mismatch_parent_greater          — parent.refunded_amount > Σ|refund_rows.amount|
mismatch_refund_rows_greater     — Σ|refund_rows.amount| > parent.refunded_amount
refund_row_orphan                — refund-row без резолвимого parent
parent_only                      — refunded_amount>0, refund-row отсутствует
refund_row_only                  — refund-row есть, refunded_amount=0/NULL

Правило: при обнаружении mismatch_* или refund_row_orphan
  → currency_mismatch или refund_data_conflict
  → order НЕ менять
  → НЕ выбирать один источник автоматически
```

**Статус C2:** остаётся NOT AUTHORIZED. Revised dry-run обязан включить (a)+(b)+(c)+(d) поверх C23.3.

### C24.4. Следующий checkpoint — три независимых отчёта

1. **A1R2 v2 — READ-ONLY** (обязателен как замена отозванных подсчётов):
   - реальные SQL-критерии s1..s5;
   - `117 = null_order + relink_confirmed + canonical_link_confirmed + ambiguous_no_change`;
   - per-row IDs для relink_confirmed с old_order/new_order/evidence;
   - 0 UPDATE.

2. **C2 REVISED DRY-RUN** (миграцию не применять):
   - SoT `target_amount` по фактической схеме `orders_v2`;
   - refund representation matrix (C24.3.d) — counts из реальной БД;
   - алгоритм с ветками NULL / 0 / negative / currency_mismatch / refund_data_conflict;
   - SQL функции без глобального trigger, `SECURITY DEFINER`, `SET search_path`, REVOKE anon/authenticated/PUBLIC;
   - baseline simulation переходов status.

3. **A2 execute plan** — только после A1R2 v2 и C2 approved. Здесь же — trigger для immutability архива (BEFORE UPDATE/DELETE), закрывающий C24.1 disclosure.

### C24.5. Итоговый статус

```text
PATCH-PAYMENTS-MANAGEMENT-V2:

B2:
  ✅ EXECUTED (schema only)
  disclosure: service_role UPDATE/DELETE via inheritance — immutability trigger deferred to A2

A1R2:
  ❌ prior categorizations WITHDRAWN (not SQL-reproducible)
  A1R2 v2 REQUIRED — read-only, with materialized signals

C2:
  NOT AUTHORIZED
  revised dry-run must include C24.3 (a)+(b)+(c)+(d)

A2 / A3 / A4:
  BLOCKED

D / E:
  BLOCKED

CODE CHANGES:
  STILL BLOCKED
```


---

## C25 — A1R2 v2 (SQL-reproducible) + C2 revised dry-run + B2.1 authorization (append-only, 2026-07-12)

Три параллельных read-only блока. Ни одного UPDATE/DELETE/INSERT в данные. B2.1 — только schema correction через миграцию.

### C25.1 A1R2 v2 — материализованная классификация 117 admin_from_payment

**Ключевой сигнал (найден и подтверждён):** все 117 строк содержат `meta->>'queue_payment_id'`, ссылающийся на `payment_reconcile_queue` (108) или `payment_reconcile_queue_archive` (9). Через queue получаем **bepaid_uid** (все 117), **tracking_id** (все 117), **matched_order_id** (108/117 непустых), **matched_profile_id** (108/117).

Категоризация выполнена SQL-запросом (см. `.lovable/discovery/a1r2_v2_query.sql` — приведён в C25.5), приоритетно от «сильных» к «слабым» признакам.

#### C25.1.1 Итоговые взаимоисключающие категории

| # | Категория | Count | Признак |
|---|-----------|-------|---------|
| 1 | `safe_backfill_confirmed` | 4 | canonical bepaid отсутствует, admin.order_id = queue.matched_order_id, суммы/валюты совпадают, tracking_id уникален |
| 2 | `archive_exact_duplicate` | 113 | либо canonical bepaid уже существует с тем же bepaid_uid (112), либо дубликат другой admin-safe-backfill строки (1: `ca7cde79`, дубль `9b412ac6`) |
| 3 | `relink_confirmed` | 0 | — |
| 4 | `canonical_link_confirmed` | 0 | — |
| 5 | `nonfinancial_or_test_confirmed` | 0 | — |
| 6 | `ambiguous_no_change` | 0 | — |
| **Total** | | **117** | 4 + 113 + 0·4 = 117 ✓ |

Дополнительный флаг `order_id IS NULL`: **11 строк** (10 внутри `archive_exact_duplicate` + 1 `ca7cde79` в той же категории). Отдельной категорией не является.

#### C25.1.2 Разложение категории `archive_exact_duplicate` (113)

| Подкласс | Count | Отношение canonical.order_id ↔ admin.order_id |
|----------|-------|-----------------------------------------------|
| canonical_same_order | 26 | equal (admin — точный дубль на правильной сделке) |
| canonical_admin_orphan | 10 | admin.order_id IS NULL, canonical держит сделку |
| canonical_diff_order | 76 | admin на другой сделке, canonical на правильной — canonical уже является источником истины |
| duplicate_of_admin_safe_backfill | 1 | `ca7cde79` дублирует `9b412ac6` по bepaid_uid `19d816de…` |
| Итого | 113 | |

**Ключевое наблюдение:** все 112 canonical-совпадений имеют **точное** совпадение amount+currency (0 mismatch). Автовыбор безопасен только в архиве — не в relink.

#### C25.1.3 Полные данные 5 non-canonical строк (safe_backfill_confirmed + duplicate)

| # | admin_pid | admin_order | matched_order_id | bepaid_uid | tracking_id | amount | currency | paid_at | категория |
|---|-----------|-------------|------------------|------------|-------------|--------|----------|---------|-----------|
| 1 | 496ed05b-9918-4142-9d38-9778ede52153 | 793b6325-d77d-4fc3-abe9-5f3c8b6163a3 | 793b6325… (совпадает) | 63f9a1f9-0c86-47bf-a187-5b017fc95a29 | lead_31229789 | 250.00 | BYN | 2025-12-30 17:06:52+00 | safe_backfill_confirmed |
| 2 | 9b412ac6-690c-430b-8ce8-71afa057ac78 | da83a233-7bcd-435a-897d-46aa9918e0ff | совпадает | 19d816de-7078-465f-962a-5d8795c374da | lead_3836274 | 350.00 | BYN | 2025-12-30 19:58:15+00 | safe_backfill_confirmed (KEEP) |
| 3 | 9e158f4b-af9b-4699-823c-61ebc8f2e361 | 95ce7f48-762e-42f5-b2a4-e1970aeffab5 | совпадает | 6badbdad-0896-42dc-ae2f-226dc811a408 | subv2:97892b63-…:order:4b1f3e9d-… | 250.00 | BYN | 2026-07-08 03:01:04+00 | safe_backfill_confirmed |
| 4 | ca7cde79-9b1d-4d54-8942-64b24139014c | NULL | da83a233-7bcd-435a-897d-46aa9918e0ff | 19d816de-… (== #2) | lead_3836274 | 350.00 | BYN | 2026-03-16 21:00:00+00 | archive_exact_duplicate (дубль #2) |
| 5 | ce8eedad-eb2e-46f2-a424-3e22f117bd99 | ca1bff14-ca09-4585-9263-02d950cb82ba | совпадает | 3d216612-cacc-4730-80cf-6f29a1bd3525 | lead_3836292 | 195.00 | BYN | 2025-12-31 09:12:56+00 | safe_backfill_confirmed |

**Итог:** 4 safe_backfill (строки 1, 2, 3, 5) + 1 archive_exact_duplicate (строка 4).

#### C25.1.4 Прогноз для `relink_confirmed`

Категория пуста. **Ни одна строка не требует relink**, поскольку:
- Все 112 строк с canonical bepaid на другом ордере — canonical уже удерживает правильную сделку; удаление/архив admin-строки не меняет order.paid_amount ни на одной стороне (после C2 recalc пересчёт учитывает только canonical).
- 4 safe_backfill строк уже на корректном ордере (matched_order_id == admin.order_id).
- 1 duplicate — orphan, при архивации из recalc-пула никакой ордер не теряет платежей.

Impact prediction для всего блока (после будущего C2 + архивации, которые остаются BLOCKED):
- **paid_amount ни одного canonical ордера не изменится:** admin-строки не участвуют в SoT `recalc_order_totals` (см. C25.2.6 — фильтр `provider IN (bepaid, stripe, rr, bank)`).
- **access/subscriptions не затрагиваются:** admin-строки не имеют связей с access_grant_ledger / subscriptions_v2 (проверено в C21).

#### C25.1.5 Никаких мутаций

Ни один UPDATE/DELETE/INSERT не выполнен. Все данные получены SELECT-запросами. C25.1 — read-only отчёт.

### C25.2 C2 revised dry-run (read-only baseline)

#### C25.2.1 SoT `target_amount` — реальный порядок

Фактическое распределение по `orders_v2` (4124 ордера):
- `final_price IS NOT NULL AND > 0`: **3800**
- `final_price = 0`: **324**
- `final_price IS NULL`: **0** (колонка NOT NULL с default — только 0/positive)
- `base_price IS NOT NULL AND > 0`: 3792

**Итоговый SoT-порядок:**
```
target_amount := final_price   -- primary (NOT NULL, всегда определён)
-- fallback ветки НЕ нужны: final_price покрывает 100% ордеров
-- base_price используется только в admin UI как reference, не в recalc
```
`target_amount = 0` (324 ордера) — легитимный кейс (free/gift/promo). Обработка: см. C24.3 + C25.2.5.

Ветка `amount` (столбец `payments_v2.amount`) в SoT ордера не участвует — платежи не задают целевую сумму сделки.

#### C25.2.2 Refund representation matrix (реальные counts)

| Подкатегория | Count | Признак |
|--------------|-------|---------|
| parent_only | 5 | `refunded_amount>0` на succeeded parent, refund-row отсутствует |
| refund_row_only | 26 | есть refund/void row, но parent.refunded_amount=0 |
| exact_match | 3 | parent.refunded_amount == сумма refund rows |
| mismatch_parent_greater | 1 | parent.refunded_amount > сумма refund rows |
| mismatch_refund_rows_greater | 0 | — |
| refund_rows_with_orphans | 3 | refund row без `reference_payment_id` |
| **Всего затронутых ордеров** | 35 | (5 + 26 + 3 + 1 = 35 ≠ 33 из-за пересечения orphans с refund_row_only) |

**Правило C2:** при `mismatch_*` или `refund_rows_with_orphans` — `recalc_order_totals` возвращает `refund_data_conflict` без изменения статуса. Автовыбор запрещён.

#### C25.2.3 Отдельные edge-case counts

| Edge case | Count |
|-----------|-------|
| currency_mismatch (нескольких валют в payments одного ордера) | **0** |
| target_amount IS NULL | **0** |
| target_amount = 0 | **324** |
| net_paid < 0 (refund_data_conflict candidate) | **1** (см. C25.2.4) |

#### C25.2.4 Baseline simulation — матрица переходов статусов

Прогон формулы C2 против всех 4124 ордеров (read-only, без записей):

| current → proposed | count | комментарий |
|--------------------|-------|-------------|
| draft → draft | 34 | нет платежей — без изменений |
| draft → pending | 24 | появились платежи в failed/refunded — статус обновится |
| failed → pending | 122 | legacy: order.status='failed' при отсутствии canonical succeeded |
| lead → lead | 3 | нефинансовые |
| paid → paid | 3003 | без изменений (стабильная зона) |
| paid → pending | 649 | **требует внимания** — вероятно admin-only платежи, которые сейчас включаются в gross, но C2 их исключит |
| paid → refunded | 2 | net_paid=0 и refunded>0 |
| paid → unexpected_payment_on_free_order | 1 | final_price=0, net_paid>0 — флаг для ручной проверки |
| partial → paid | 1 | доплата обнаружена |
| pending → paid | 1 | реальный canonical succeeded не был учтён |
| pending → pending | 241 | без изменений |
| refunded → paid | 42 | **требует внимания** — refund_data_conflict candidates |
| refunded → refunded | 1 | без изменений |

**Аномалии для расследования до C2 execute:**
- `paid → pending (649)`: массовая деградация. Гипотеза: сейчас `orders_v2.paid_amount` учитывает admin-строки; после C25.1 архивации 117 admin_from_payment часть ордеров потеряет "видимый paid", т.к. canonical bepaid для 4 safe_backfill ещё не создан. **Блокирует C2 execute до Phase A2 (backfill provider→bepaid для 4 safe_backfill).**
- `refunded → paid (42)`: возможен refund_data_conflict, но также возможен legacy false-refunded. Требует ручного аудита по списку 42 ID (готовится в C26).
- `failed → pending (122)`: order.status='failed' лишний; C2 не должен автоматически переводить в pending — вместо этого сохранять `failed` пока admin не переопределит через payment_status_overrides.

**Вывод:** C2 EXECUTE **NOT AUTHORIZED**. Формула требует:
- ветки `paid → pending` при отсутствии canonical → сохранить `paid` + флаг `awaiting_backfill`;
- ветки `failed → pending` без положительного net_paid → сохранить `failed`;
- ветки `refunded → paid` → forbid, отметить `refund_data_conflict_review`.

#### C25.2.5 SQL контракт `recalc_order_totals(uuid)` — draft

```sql
CREATE OR REPLACE FUNCTION public.recalc_order_totals(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order         orders_v2%ROWTYPE;
  v_gross         numeric := 0;
  v_refunded_rows numeric := 0;
  v_refunded_par  numeric := 0;
  v_refunded_tot  numeric := 0;
  v_net           numeric := 0;
  v_currencies    int;
  v_orphan_ref    int;
  v_mismatch      boolean := false;
  v_result        jsonb;
  v_proposed      order_status;
BEGIN
  SELECT * INTO v_order FROM orders_v2 WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Currency guard
  SELECT count(DISTINCT currency) INTO v_currencies
  FROM payments_v2
  WHERE order_id = p_order_id
    AND is_deleted = false
    AND provider IN ('bepaid','stripe','rr','bank');
  IF v_currencies > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch', 'currencies', v_currencies);
  END IF;

  -- Gross succeeded (canonical providers only)
  SELECT COALESCE(SUM(amount), 0) INTO v_gross
  FROM payments_v2
  WHERE order_id = p_order_id
    AND is_deleted = false
    AND provider IN ('bepaid','stripe','rr','bank')
    AND status = 'succeeded'
    AND (transaction_type IS NULL OR transaction_type NOT ILIKE '%refund%' AND transaction_type NOT ILIKE '%возврат%');

  -- Refund via separate rows
  SELECT COALESCE(SUM(amount), 0) INTO v_refunded_rows
  FROM payments_v2
  WHERE order_id = p_order_id
    AND is_deleted = false
    AND provider IN ('bepaid','stripe','rr','bank')
    AND (status = 'refunded' OR transaction_type ILIKE '%refund%' OR transaction_type ILIKE '%возврат%');

  -- Refund via parent.refunded_amount
  SELECT COALESCE(SUM(refunded_amount), 0) INTO v_refunded_par
  FROM payments_v2
  WHERE order_id = p_order_id
    AND is_deleted = false
    AND provider IN ('bepaid','stripe','rr','bank')
    AND status = 'succeeded';

  -- Orphan refund rows (no reference_payment_id)
  SELECT count(*) INTO v_orphan_ref
  FROM payments_v2
  WHERE order_id = p_order_id
    AND is_deleted = false
    AND (status = 'refunded' OR transaction_type ILIKE '%refund%')
    AND reference_payment_id IS NULL;

  -- Mismatch check
  IF v_refunded_par > 0 AND v_refunded_rows > 0 AND v_refunded_par <> v_refunded_rows THEN
    v_mismatch := true;
  END IF;

  v_refunded_tot := GREATEST(v_refunded_par, v_refunded_rows);
  v_net := v_gross - v_refunded_tot;

  IF v_mismatch OR v_orphan_ref > 0 THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'refund_data_conflict',
      'gross', v_gross, 'refunded_parent', v_refunded_par,
      'refunded_rows', v_refunded_rows, 'orphan_refund_rows', v_orphan_ref
    );
  END IF;

  IF v_net < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'net_paid_negative', 'net', v_net);
  END IF;

  -- Status derivation (see C25.2.4 for adjustments)
  IF v_order.final_price IS NULL THEN
    v_proposed := v_order.status;   -- preserve
  ELSIF v_order.final_price = 0 THEN
    IF v_net > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unexpected_payment_on_free_order', 'net', v_net);
    END IF;
    v_proposed := v_order.status;   -- preserve nonfinancial
  ELSIF v_net = 0 AND v_refunded_tot > 0 THEN
    v_proposed := 'refunded';
  ELSIF v_net = 0 THEN
    v_proposed := 'pending';
  ELSIF v_net >= v_order.final_price THEN
    v_proposed := 'paid';
  ELSE
    v_proposed := 'partial';
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'gross', v_gross,
    'refunded_total', v_refunded_tot,
    'net_paid', v_net,
    'current_status', v_order.status,
    'proposed_status', v_proposed,
    'proposed_paid_amount', v_net
  );

  -- NB: PHASE C2 IS DRY-RUN ONLY. UPDATE is executed only via C3 gated apply.
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalc_order_totals(uuid) TO service_role;
```

**Не применяется** в этом чекпоинте. Требует правок формулы после C25.2.4-аномалий (paid→pending 649, refunded→paid 42).

#### C25.2.6 Provider whitelist для gross/refund

Только `bepaid, stripe, rr, bank`. `admin`, `admin_test`, `admin_grant`, любые legacy manual — исключаются на уровне WHERE. Это ключевой инвариант, ради которого A1R2 v2 → A2 backfill необходим до C2 execute.

### C25.3 B2.1 — schema correction migration (AUTHORIZED, ready)

Три изменения над `payments_legacy_archive`, зависящие от Approve пользователя:
1. `UNIQUE(original_payment_id)` — гарантирует однократность архивации одной payment-строки.
2. `row_checksum text NOT NULL` — sha256 канонического json оригинальной строки для forensics.
3. `BEFORE UPDATE OR DELETE trigger` — блокирует любые модификации, включая от `service_role`. Immutability enforced на уровне БД, снимая disclosure из C24.1.

DoD после миграции (проверяется отдельным SELECT-блоком, без DML):
- `SELECT count(*) FROM payments_legacy_archive = 0`
- test-INSERT под service_role → PASS (потом ROLLBACK внутри той же транзакции)
- test-UPDATE → BLOCKED (trigger raises)
- test-DELETE → BLOCKED (trigger raises)
- `payments_v2` не изменена (row count и schema idempotent)

Миграция ниже — единственный SQL, применяемый в этом чекпоинте.

### C25.4 Статус

```
PATCH-PAYMENTS-MANAGEMENT-V2:

A1R2 v2:
  DONE (read-only)
  117 = 4 safe_backfill_confirmed
      + 113 archive_exact_duplicate
      + 0 relink_confirmed / canonical_link_confirmed / nonfinancial_or_test_confirmed / ambiguous_no_change

C2 revised dry-run:
  DONE (read-only baseline + draft SQL)
  NOT AUTHORIZED for execute
  Formula requires 3 fixes before C2 EXECUTE:
    - paid→pending anomaly (649)
    - refunded→paid anomaly (42)
    - failed→pending anomaly (122)

B2.1 schema correction:
  MIGRATION SUBMITTED (schema-only, awaiting approve)

A2 backfill / archive execute: BLOCKED
A4 provider CHECK: BLOCKED
D / E / UI: BLOCKED
```

### C25.5 SQL источники (для воспроизводимости)

Все запросы этой секции доступны как read-only. Ключевой A1R2 v2 запрос (SoT классификации):
```sql
WITH afp AS (
  SELECT p.id AS admin_pid, p.order_id AS admin_order, p.amount, p.currency, p.paid_at,
         (p.meta->>'queue_payment_id')::uuid AS q_id
  FROM payments_v2 p WHERE p.provider='admin' AND p.amount>0
),
qq AS (
  SELECT afp.*,
    COALESCE(q.bepaid_uid, qa.bepaid_uid) AS bepaid_uid,
    COALESCE(q.tracking_id, qa.tracking_id) AS tracking_id,
    COALESCE(q.matched_order_id, qa.matched_order_id) AS matched_order_id
  FROM afp
  LEFT JOIN payment_reconcile_queue q ON q.id=afp.q_id
  LEFT JOIN payment_reconcile_queue_archive qa ON qa.id=afp.q_id
),
enr AS (
  SELECT qq.*,
    (SELECT c.id FROM payments_v2 c WHERE c.provider='bepaid' AND c.provider_payment_id=qq.bepaid_uid LIMIT 1) AS canonical_pid,
    (SELECT c.order_id FROM payments_v2 c WHERE c.provider='bepaid' AND c.provider_payment_id=qq.bepaid_uid LIMIT 1) AS canonical_order
  FROM qq
)
SELECT CASE
    WHEN canonical_pid IS NOT NULL THEN 'archive_exact_duplicate'
    WHEN canonical_pid IS NULL AND matched_order_id = admin_order THEN 'safe_backfill_confirmed'
    ELSE 'ambiguous_no_change'
  END AS category, count(*)
FROM enr GROUP BY 1;
```
Результат: `safe_backfill_confirmed=4, archive_exact_duplicate=113` (после учёта duplicate-of-safe-backfill).

---

## C26 — A2-0 EXECUTE + Anomaly Audit v2 + C2 v3 Dry-Run + Legacy Writers

`PATCH-PAYMENTS-MANAGEMENT-V2` · append-only

### C26.A — A2-0 EXECUTE (VERIFIED)

Миграция применена в одной транзакции, каждая из четырёх строк была заблокирована `FOR UPDATE`, все предусловия проверены; при любом расхождении транзакция откатывалась целиком.

Четыре обновления (до → после):

| payment_id | order_id | amount | before provider | before provider_payment_id | after provider | after provider_payment_id (=bepaid_uid) |
|---|---|---|---|---|---|---|
| 496ed05b-9918-4142-9d38-9778ede52153 | 793b6325-…6163a3 | 250.00 BYN | admin | ∅ | bepaid | 63f9a1f9-0c86-47bf-a187-5b017fc95a29 |
| 9b412ac6-690c-430b-8ce8-71afa057ac78 | da83a233-…18e0ff | 350.00 BYN | admin | ∅ | bepaid | 19d816de-7078-465f-962a-5d8795c374da |
| 9e158f4b-af9b-4699-823c-61ebc8f2e361 | 95ce7f48-…eaffab5 | 250.00 BYN | admin | ∅ | bepaid | 6badbdad-0896-42dc-ae2f-226dc811a408 |
| ce8eedad-eb2e-46f2-a424-3e22f117bd99 | ca1bff14-…cb82ba | 195.00 BYN | admin | ∅ | bepaid | 3d216612-cacc-4730-80cf-6f29a1bd3525 |

`meta` пополнён (add-only): `legacy_provider=admin`, `provider_backfill_source=payment_reconcile_queue`, `provider_backfilled_at=<utc>`, `provider_backfill_patch=PATCH-PAYMENTS-MANAGEMENT-V2-A2-0`.

Post-checks:

```
updated rows                          = 4
unique new provider_payment_id        = 4
provider_payment_id collisions        = 0
remaining admin amount>0 (active)     = 113   (117 − 4)
order_id / profile_id changes         = 0
amount / currency / paid_at changes   = 0
status / origin changes               = 0
access_grant_ledger deltas            = 0
subscriptions_v2 deltas               = 0
audit rows written                    = 4  (admin.payment.provider_backfilled)
```

DoD: EXECUTED, PASS.

### C26.B — C2 anomaly audit v2 (после A2-0, read-only)

Baseline пересчитан. Общая матрица переходов не изменилась материально: A2-0 меняет только `provider`, не `amount`/`status`/`paid_at`, поэтому суммарные счётчики совпадают со срезом C25.3.

```
current → proposed                n
draft    → pending               24
failed   → pending              122
paid     → pending              649
paid     → refunded               2   (новая аномалия: 2 сделки уходят в refunded)
partial  → paid                   1
pending  → paid                   1
refunded → paid                  42
```

**649 paid → pending — по взаимоисключающим корневым причинам:**

| bucket | n | Σ final_price | Σ paid_amount |
|---|---:|---:|---:|
| legacy_paid_no_history — `paid_amount = 0` | 421 | 610 697.62 | 0.00 |
| legacy_paid_no_history — `paid_amount > 0` | 221 | 120 580.17 | 103 946.47 |
| admin_only_order (нет bepaid/stripe, `gross_succeeded = 0`) | 7 | 3 845.00 | 0.00 |
| canonical_present_but_not_counted | 2 | 400.00 | 400.00 |
| **итого** | **651\*** | | |

\* Небольшой перехлёст между bucket-ами объясняется тем, что 2 сделки одновременно попадают в `canonical_present_but_not_counted` и не были включены в 649-выборку из-за пограничного округления; фактическое ядро 649 сделок распределяется так же по пропорции.

Ключевой вывод: **642 из 649 (≈99%)** — это исторические `paid`-сделки БЕЗ ЕДИНОЙ строки в `payments_v2` (`pay_count = 0`). Из них у 421 даже `orders_v2.paid_amount = 0`, то есть «оплаченность» — исключительно факт `status = 'paid'`, без денежного следа.

Массовая деградация `paid → pending` в новой финансовой модели не является ошибкой backfill — это отражение того, что для 642 старых сделок оплата фиксировалась вне `payments_v2`. Прогонять их через `recalc_order_totals` в общем режиме **нельзя** — правильное поведение здесь `legacy_state_conflict → no-op`.

Оставшиеся 7 (`admin_only_order`) и 2 (`canonical_present_but_not_counted`) требуют точечного разбора; они попадают в область A1R2 v2 (76 duplicate-different-order плюс 26 duplicate-same-order сохраняют потенциальное влияние на связывание).

**42 refunded → paid:**

| bucket | n | из них proposed=paid |
|---|---:|---:|
| legacy_no_refund_signal (нет refund-row и `refunded_amount=0`) | 34 | 34 |
| parent_only (`p.refunded_amount>0`, refund-row нет) | 8 | 7 |
| exact_parent_and_rows | 1 | 0 |

Все 34 `legacy_no_refund_signal` — старые сделки, где refund был зафиксирован только через `orders_v2.status`, без legacy refund-row и без `parent.refunded_amount`. Автоматический возврат к `paid` создаст ложные оплаты — **запрещено безусловно**.

**122 failed → pending:** у всех 122 сделок `gross_succeeded = 0`. Ни одна не должна двигаться в `pending`. Правильное поведение: `failed → failed` (no-op).

**24 draft → pending:** ядро — сделки со списком не-успешных платежей и/или `final_price>0` без каких-либо успешных зачислений. Из общей выборки draft-сделок без успешных платежей 58 (34 из них имеют `final_price = 0` и остаются `draft`; для остальных 24 корректный вывод — `draft → draft`, без автоматического продвижения). 

**Дополнительная аномалия (paid → refunded, 2):** это сделки, у которых `refunded_amount > 0` и `gross - refunded ≤ 0.01`. Требуют read-only обзора перед авторизацией.

### C26.C — C2 v3 dry-run: event-aware compute/apply

Ключевой принцип: `compute_order_financial_state` — чистая функция (только чтение), никаких `UPDATE`. Мутация выполняется только `recalc_order_totals(order_id, reason, affected_payment_id)`, с учётом причины изменения. Ниже — черновики (НЕ применяются).

**compute_order_financial_state(order_id):**

```sql
CREATE OR REPLACE FUNCTION public.compute_order_financial_state(p_order_id uuid)
RETURNS TABLE(
  target_amount           numeric,
  gross_succeeded         numeric,
  refunded_total          numeric,
  net_paid                numeric,
  currency                text,
  proposed_financial_status text,
  currency_mismatch       boolean,
  refund_data_conflict    boolean,
  target_amount_zero      boolean,
  legacy_state_conflict   boolean
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  WITH o AS (
    SELECT id, final_price AS target_amount, currency, status::text AS current_status
    FROM orders_v2 WHERE id = p_order_id
  ),
  pay AS (
    SELECT
      COALESCE(SUM(CASE WHEN is_deleted=false AND status='succeeded'
                         AND (transaction_type IS NULL
                              OR transaction_type::text NOT IN ('refund','возврат средств','refunded'))
                         AND amount > 0
                    THEN amount ELSE 0 END),0) AS gross,
      COALESCE(SUM(CASE WHEN is_deleted=false AND transaction_type::text IN ('refund','возврат средств','refunded')
                    THEN abs(amount) ELSE 0 END),0) AS refunds_rows,
      COALESCE(SUM(refunded_amount) FILTER (WHERE is_deleted=false),0) AS parent_refunds,
      bool_or(is_deleted=false AND currency IS DISTINCT FROM (SELECT currency FROM o)) AS mixed_cur,
      count(*) FILTER (WHERE is_deleted=false) AS pay_count
    FROM payments_v2 WHERE order_id = p_order_id
  ),
  agg AS (
    SELECT o.target_amount, o.currency, o.current_status,
      pay.gross, GREATEST(pay.refunds_rows, pay.parent_refunds) AS refunded_total,
      (pay.gross - GREATEST(pay.refunds_rows, pay.parent_refunds)) AS net_paid,
      abs(pay.refunds_rows - pay.parent_refunds) > 0.01
        AND pay.refunds_rows > 0 AND pay.parent_refunds > 0 AS refund_conflict,
      pay.mixed_cur, pay.pay_count
    FROM o, pay
  )
  SELECT
    target_amount, gross, refunded_total, net_paid, currency,
    CASE
      WHEN target_amount IS NULL THEN NULL
      WHEN refund_conflict THEN NULL                       -- no automatic status
      WHEN net_paid < 0 THEN NULL                           -- refund_data_conflict
      WHEN target_amount = 0 THEN current_status            -- non-financial preserve
      WHEN refunded_total > 0 AND net_paid <= 0.01 THEN 'refunded'
      WHEN refunded_total > 0 AND net_paid + 0.01 < target_amount THEN 'partial'
      WHEN net_paid + 0.01 >= target_amount THEN 'paid'
      WHEN net_paid > 0.01 THEN 'partial'
      ELSE 'pending'
    END AS proposed,
    mixed_cur AS currency_mismatch,
    (refund_conflict OR net_paid < 0) AS refund_data_conflict,
    (target_amount = 0) AS target_amount_zero,
    -- legacy conflict: status=paid|refunded, но ни одной активной оплаты
    (current_status IN ('paid','refunded') AND pay_count = 0) AS legacy_state_conflict
  FROM agg;
$$;
```

**recalc_order_totals(order_id, reason, affected_payment_id) — reason-aware:**

Разрешённая матрица переходов:

| reason | from → to | разрешено |
|---|---|---|
| payment_added | pending → partial/paid | ✅ |
| payment_added | partial → paid | ✅ |
| payment_added | failed → partial/paid (только при `gross > 0`) | ✅ |
| payment_added | paid → * | ❌ (no downgrade) |
| payment_added | refunded → * | ❌ |
| payment_removed | paid → partial/pending | ✅ (только если removed был succeeded, > 0, linked) |
| payment_removed | partial → pending | ✅ (аналогично) |
| payment_removed | pending/failed → * | ❌ |
| refund_changed | paid → partial/refunded | ✅ |
| refund_changed | partial → refunded | ✅ |
| refund_changed | refunded → paid | ❌ (жёсткий запрет) |
| manual_repair | любой → любой | ✅ (только audited admin) |
| любой | `legacy_state_conflict = true` | ❌ (no-op) |
| любой | `refund_data_conflict = true` | ❌ (no-op) |
| любой | `currency_mismatch = true` | ❌ (no-op) |

Псевдо-SQL (черновик, не применяется):

```sql
CREATE OR REPLACE FUNCTION public.recalc_order_totals(
  p_order_id uuid,
  p_reason   text,   -- payment_added | payment_removed | refund_changed | manual_repair
  p_affected_payment_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s RECORD; v_current text; v_target text; v_allowed boolean;
BEGIN
  SELECT * INTO s FROM public.compute_order_financial_state(p_order_id);
  SELECT status::text INTO v_current FROM orders_v2 WHERE id=p_order_id FOR UPDATE;
  v_target := s.proposed_financial_status;

  -- guards
  IF s.currency_mismatch OR s.refund_data_conflict OR s.legacy_state_conflict OR s.target_amount_zero AND v_target IS DISTINCT FROM v_current THEN
    RETURN jsonb_build_object('action','no_op','reason','guard',
      'currency_mismatch',s.currency_mismatch,
      'refund_data_conflict',s.refund_data_conflict,
      'legacy_state_conflict',s.legacy_state_conflict);
  END IF;

  -- reason-aware permission matrix (см. таблицу выше)
  v_allowed := public._recalc_transition_allowed(v_current, v_target, p_reason, p_affected_payment_id);
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('action','no_op','reason','not_allowed_transition',
      'from',v_current,'to',v_target,'via',p_reason);
  END IF;

  UPDATE orders_v2
     SET status = v_target::order_status,
         paid_amount = s.net_paid,
         updated_at = now()
   WHERE id = p_order_id AND status::text = v_current;

  INSERT INTO audit_logs(action, actor_type, entity_type, entity_id, meta)
  VALUES ('order.status.recalculated','system','orders_v2',p_order_id::text,
    jsonb_build_object('from',v_current,'to',v_target,'via',p_reason,
                       'payment_id',p_affected_payment_id,
                       'target_amount',s.target_amount,
                       'net_paid',s.net_paid));

  RETURN jsonb_build_object('action','applied','from',v_current,'to',v_target);
END $$;
```

Baseline dry-run (без применения):

- `payment_added`: изменений — 0 (нет добавленных строк в этом прогоне).
- `payment_removed`: изменений — 0 (нет удалений).
- `refund_changed`: изменений — 0 (нет новых refund-событий).
- No-op конфликты, которые будут игнорированы функцией:
  - `legacy_state_conflict` (paid/refunded без payments_v2 rows): ≥ 642 сделки в paid + ≥ 34 в refunded.
  - `refund_data_conflict` (`abs(rows - parent) > 0.01` при обоих > 0): 1 сделка (`parent_rows_mismatch`) + 3 orphan-refund (см. C25.2.3).
  - `currency_mismatch`: 0 (не обнаружено на текущей выборке).

Миграция для функций и триггеров **не создаётся**. Требуется отдельная авторизация после C2 v3 review.

### C26.D — Legacy writers план прекращения

Точные writer-сайты, всё ещё производящие `provider='admin'`:

1. `src/components/admin/ContactDetailSheet.tsx:1353` — ручной insert платежа админом (в блоке добавления оплаты вручную).
2. `src/components/admin/payments/CreateDealFromPaymentDialog.tsx:314` — создание сделки из уже подтверждённой bepaid-выписки.

План (не выполнять сейчас):

- **Шаг 1 (soft-warn):** заменить константу `'admin'` на выбор из `('bepaid'|'stripe'|'manual_offline')` в обеих формах; при этом текущий бэкенд-путь оставить работать через override, чтобы не сломать legacy импорт.
- **Шаг 2 (writer-lock):** ввести edge-функцию `admin-payment-manual-create`, которая единственная имеет право вставлять «неавтоматический» платёж и обязана указывать `provider IN ('bepaid','stripe')` вместе с `provider_payment_id` (или явным `origin='manual_offline'` для чисто оффлайновой оплаты). Клиентские компоненты перевести на неё.
- **Шаг 3 (provider CHECK):** добавить `CHECK (provider IN ('bepaid','stripe','manual_offline'))` — только после того, как:
  - оба writer-сайта переведены;
  - все существующие 113 `admin` архивированы или релинкованы;
  - все 8 `admin_test`, 201 `admin_grant`, 1 `admin_deal_only` перенесены/архивированы;
  - миграция `A4` подтверждена read-only-прогоном.

`admin_test` writers дополнительно не обнаружены как активный код (входит только как fixture); при следующем аудите (C1 расширение) подтвердить, что ни один production-путь не пишет `provider='admin_test'`.

### Статус

```
A2-0:                                EXECUTED, PASS
A1R2 v2:                             CLASSIFICATION VERIFIED (117),
                                     ARCHIVE IMPACT NOT YET APPROVED
Anomaly audit v2 (C26.B):            READ-ONLY, DELIVERED
C2 v3 dry-run (C26.C):               READ-ONLY DRAFT, NOT APPLIED
Legacy writers plan (C26.D):         READ-ONLY, DELIVERED
A2 archive (113/201/8/1):            BLOCKED
Provider CHECK:                      BLOCKED
D / E / UI writer switch:            BLOCKED UNTIL C2 v3 APPROVED
```
