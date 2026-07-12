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
