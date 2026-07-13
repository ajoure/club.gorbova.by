## да, согласен, с учетом правок:

План утверждается как **единый непрерывный спринт**. После прохождения технического gate каждого этапа исполнитель сразу переходит к следующему, без новых согласований и боковых патчей.

## 1. C2: RPC должен возвращать результат, а не `void`

```text
compute_order_financial_state(...) → jsonb
recalc_order_totals(...)           → jsonb

```

`recalc_order_totals` должен возвращать:

```text
before_status
after_status
before_paid_amount
after_paid_amount
status_changed
amount_changed
guard_reason
affected_payment_id

```

Причины использовать только из ранее утверждённого контракта:

```text
payment_added
payment_removed
refund_changed
manual_repair

```

Не вводить `payment_deleted`.

Обязательно:

- `orders_v2 FOR UPDATE`;
- релевантные payment rows блокируются в той же транзакции;
- per-parent refund model;
- не использовать `GREATEST()` для объединения двух refund-источников;
- `partial` и `partial_refund` не смешивать;
- unrelated historical conflict → no-op;
- никакого глобального trigger и массового пересчёта legacy.

Vitest недостаточно. Нужны одновременно:

```text
14 SQL VALUES/CTE fixtures → 14 PASS / 0 FAIL
targeted integration tests → PASS

```

---

## 2. Этап 2 должен быть атомарным SQL RPC

Edge function не может гарантировать атомарность цепочки из нескольких PostgREST-запросов.

Правильная архитектура:

```text
admin-create-deal-from-payment edge
→ JWT + RBAC + validation
→ один internal SECURITY DEFINER RPC
→ вся транзакция внутри PostgreSQL

```

RPC выполняет:

```text
lock queue row FOR UPDATE
→ проверить существующий linked payment
→ reservation-first idempotency
→ создать order
→ создать/link canonical payment
→ recalc
→ commit

```

Не использовать только advisory lock. Основной lock — `FOR UPDATE`.

Idempotency — ранее утверждённая отдельная таблица:

```text
idempotency_key PK
queue_row_id UNIQUE
request_hash
state
order_id
created_by
created_at
completed_at

```

Provider для queue-flow **не приходит от клиента**. Он определяется сервером из заблокированной queue row и проверяется по allowlist.

Optional grant выполняется **после успешного commit**, отдельным идемпотентным вызовом. Ошибка grant не должна откатывать созданные order/payment.

---

## 3. Admin-аутентификация

Не использовать внутри service-role RPC:

```sql
has_role(auth.uid(), 'admin')

```

При service-role вызове `auth.uid()` не является надёжным actor.

Edge должен:

1. проверить пользовательский JWT;
2. получить реальный `actor_user_id`;
3. проверить:

```text
has_admin_section_access(actor_user_id, 'payments', 'manage')

```

4. передать `p_actor_id` во внутренний RPC;
5. RPC недоступен напрямую `anon` и `authenticated`.

SQL security:

```text
SECURITY DEFINER
SET search_path = public, pg_temp
REVOKE ALL FROM PUBLIC, anon, authenticated
GRANT EXECUTE TO service_role

```

---

## 4. Ручное создание: обязательная idempotency

В `ManualPaymentDialog` нужен скрытый client-generated:

```text
idempotency_key

```

Backend сохраняет reservation + `request_hash`. Повторное нажатие не создаёт второй payment.

Для ручной записи:

```text
provider = bepaid | stripe | rr | bank
origin   = manual_admin

```

Manual bePaid/Stripe/RR payment:

- не создаёт фиктивный webhook;
- не создаёт provider health event;
- не выдаёт себя за автоматически подтверждённую запись провайдера;
- provider-specific данные хранятся в типизированном `meta.manual_details`.

Standalone payment без order никогда не вызывает grant.

Для связанного order grant возможен только как отдельный post-commit шаг после C2 и при явном `grant_access=true`.

---

## 5. Удаление: preview и execute должны быть раздельными режимами одной транзакционной модели

Нужен server-side preview:

```text
operation_id
version
checksum
expires_at
locked graph summary
before/after calculation
access revoke candidate

```

Execute принимает этот token и внутри одной транзакции:

- повторно блокирует payment/order;
- пересчитывает checksum;
- fail-closed при изменении graph;
- выполняет soft-delete;
- вызывает `recalc_order_totals(..., 'payment_removed', ...)`;
- пишет audit.

Разрешены только варианты:

```text
payment_only
order_with_all_linked_payments

```

Запрещён вариант «удалить order, но сохранить/отвязать другие платежи».

Bulk delete использует тот же preview/execute engine одной батч-транзакцией, а не цикл отдельных запросов.

---

## 6. Revoke доступа не строить на eligibility-shadow helper

Shadow helper не является доказательством происхождения доступа.

Revoke разрешён только при точной lineage:

```text
payment → order → access ledger / entitlement attribution

```

При отсутствии однозначной связи:

```text
access revoke = false
manual_review_required = true

```

Нельзя отзывать доступ только потому, что после удаления заказ стал `pending`.

---

## 7. Webhook recreation guard

Не переписывать историю `provider_events` значением `superseded_by_admin_delete` как единственный механизм.

Использовать существующий immutable archive/tombstone:

```text
provider
provider_payment_id / external_id
original_payment_id
deleted_at
checksum

```

Все webhook/reconcile writers обязаны перед insert/upsert проверять tombstone. Удалённый payment не должен воскресать.

Исторический provider event сохраняется. Допускается новая audit/event-запись об административном удалении.

---

## 8. Статистика UI

Не переделывать верхние карточки в «4 колонки провайдеров».

Текущие карточки остаются показателями:

```text
успешные
возвраты
отмены
ошибки
комиссия
чистая выручка

```

Но их RPC должен поддерживать фильтр:

```text
all | bepaid | stripe | rr | bank

```

Таблица, counts, суммы, фильтры и CSV используют одинаковый active-payment scope:

```text
deleted_at IS NULL
provider IN ('bepaid','stripe','rr','bank')

```

---

## 9. Legacy cleanup нельзя выполнять одним непрозрачным job

Сохранить проверяемую последовательность:

```text
baseline + checksum
→ safe backfill
→ deterministic relink
→ archive
→ HOLD resolution/archive
→ validation
→ provider CHECK

```

Ожидаемые количества использовать как precondition:

```text
113 review/collision
260 archive
52 relink review
11 HOLD

```

При несовпадении количества или checksum — остановка, не автоматическое продолжение.

`HOLD` нельзя «угадывать». Только доказанный relink либо archive.

`test-payment-complete` и `admin-link-payment-to-order` удаляются только после:

- миграции всех callers;
- repository-wide inventory;
- active references = 0.

Тестовые платежи после миграции используют канонический provider плюс:

```text
meta.env = test

```

а не `admin_test`.

---

## 10. CHECK только на `payments_v2`

Не добавлять в этом спринте аналогичный CHECK на `orders_v2.provider`.

В `orders_v2` сейчас иная историческая семантика provider, включая legacy/import значения. Ограничение там потребует отдельной миграции и может сломать старые сделки.

Финальный constraint:

```sql
ALTER TABLE public.payments_v2
ADD CONSTRAINT payments_v2_provider_allowlist
CHECK (provider IN ('bepaid','stripe','rr','bank'));

```

Сначала доказать:

```text
active invalid providers = 0
all active writers compliant = true

```

---

## 11. RR cleanup

Зафиксировать exact IDs двенадцати строк до preview.

После soft-delete корректные проверки:

```text
RR test target set                     = 12
active RR test payments after cleanup  = 0
soft-deleted RR target payments        = 12
broken order references                = 0
incorrect access revokes               = 0
broken subscription references         = 0
broken provider-event references       = 0

```

Исторические provider events не требуется удалять.

---

## 12. E2E

Использовать изолированный технический контакт/компанию/orders, не реальные клиентские данные.

E2E должен проверить не только UI, но и DB persistence:

```text
origin='manual_admin'
provider exact
idempotency replay creates 0 duplicates
refresh retains state
deleted payment hidden from readers
webhook/reconcile cannot recreate tombstoned payment
CSV contains correct provider/bank fields
stats equal SQL baseline
cleanup leaves 0 active fixtures

```

Полный suite:

```text
targeted tests PASS
build PASS
Playwright PASS
full Vitest PASS

```

Три ранее наблюдавшихся unrelated failure нельзя назвать общим `PASS`. Их нужно либо исправить в рамках финальной стабилизации, либо представить воспроизводимый before/after baseline; полное закрытие требует зелёного suite.

---

# Авторизация

```text
PATCH-PAYMENTS-MANAGEMENT-V2:

ЭТАПЫ 1–7:
  EXECUTE AUTHORIZED

ПЕРЕХОД МЕЖДУ ЭТАПАМИ:
  БЕЗ ДОПОЛНИТЕЛЬНОГО СОГЛАСОВАНИЯ
  ТОЛЬКО ПОСЛЕ PASS ПРЕДЫДУЩЕГО GATE

MIGRATIONS/DML:
  AUTHORIZED В РАМКАХ ЭТОГО ПЛАНА

LEGACY CLEANUP:
  AUTHORIZED С FAIL-CLOSED COUNT/CHECKSUM GUARDS

PROVIDER CHECK:
  AUTHORIZED ПОСЛЕ ACTIVE INVALID PROVIDERS = 0

RR TEST CLEANUP:
  AUTHORIZED ЧЕРЕЗ ОБЩИЙ DELETE ENGINE

НОВЫЕ БОКОВЫЕ PATCH:
  ЗАПРЕЩЕНЫ ДО ЗАКРЫТИЯ ПРЕСПРИНТА

```

Единственный финальный критерий остаётся прежним: все десять пользовательских операций должны реально работать на `/admin/payments` под живым администратором.

&nbsp;

План: PATCH-PAYMENTS-MANAGEMENT-V2 — финальное закрытие

Все отдельные security/eligibility-работы приостановлены. Observation по grant-access-for-order идёт пассивно и не блокирует эту работу. План выполняется непрерывно, без промежуточных согласований между этапами.

Точка входа UI: `src/pages/admin/AdminPayments.tsx` + `src/components/admin/payments/*`. Точка правки production writer'а: `src/components/admin/payments/CreateDealFromPaymentDialog.tsx:314` (`provider: "admin"` → удалить).

---

### Этап 1. Канонический финансовый расчёт (C2)

Серверные RPC (миграция):

```text
compute_order_financial_state(order_id uuid)  → jsonb
recalc_order_totals(order_id uuid, reason text, affected_payment_id uuid) → void
```

Обязательные инварианты:

- providers: только `bepaid | stripe | rr | bank`;
- агрегация нескольких платежей на заказ;
- refunds по `parent_payment_id`;
- игнорировать `deleted_at IS NOT NULL`;
- статусы: `partial | paid | refunded | pending`;
- валюта (мультивалютные заказы → `net_paid=null`, флаг);
- безопасный recalc после soft-delete платежа.

DoD: 14 fixtures в `src/test/orderFinancial.recalc.test.ts` → 14 PASS / 0 FAIL. Никаких новых диагностических ответвлений — сразу этап 2.

---

### Этап 2. Исправить CreateDealFromPaymentDialog

- Удалить `provider: "admin"` (строка 314) и весь клиентский insert.
- Реализовать edge function `admin-create-deal-from-payment` с атомарной цепочкой:
  ```text
  queue row → advisory lock →
  idempotency reservation (order_id+provider+external_id) →
  create/link orders_v2 →
  canonical payment insert (payments_v2) →
  recalc_order_totals() →
  optional grant access
  ```
- Provider принимается только из allowlist `bepaid | stripe | rr | bank`. Всё остальное → 400.
- Аудит: `audit_logs.action = 'admin_create_deal_from_payment'`.

---

### Этап 3. Ручное добавление платежа в UI

- На `/admin/payments` добавить заметную кнопку `+ Добавить платёж`.
- Диалог `ManualPaymentDialog` c табами провайдера: bePaid / Stripe / Ресурс Развития / Банк.
- Общие поля: сумма, валюта, дата, назначение, контакт, компания, сделка (опц.), комментарий.
- Поля банка: название банка, номер платёжного документа.
- Все ручные платежи: `origin='manual_admin'`, `provider ∈ allowlist`.
- Standalone-платёж без сделки: доступ НЕ выдаётся (edge function не вызывает grant-access).
- Backend: edge function `admin-create-manual-payment` c той же цепочкой, что в этапе 2, + zod-валидация.

---

### Этап 4. Удаление платежа

- В строке таблицы и в карточке платежа — действие `Удалить платёж`.
- Preview-диалог показывает: связанный заказ, суммы до/после recalc, изменение статуса заказа, наличие entitlement/subscription.
- Если платёж привязан к сделке — выбор:
  ```text
  1. Удалить только платёж
  2. Удалить сделку и все связанные платежи
  3. Отмена
  ```
- Backend edge function `admin-delete-payment`:
  - version/checksum guard,
  - soft-delete (`deleted_at`, `deleted_by`, `delete_reason`),
  - `recalc_order_totals(order_id, 'payment_deleted', payment_id)`,
  - точечный revoke доступа только при доказанной связи (canonical evidence из helper),
  - contacts/companies не трогать,
  - webhook idempotency: `provider_events` помечает связанный external_id как `superseded_by_admin_delete`, чтобы повторный webhook не воскресил запись.
- Bulk delete: чекбоксы в `PaymentsTable`, кнопка `Удалить выбранное`, тот же preview агрегированно, тот же edge function батчем.

---

### Этап 5. Полный UI четырёх провайдеров

`/admin/payments` должен работать целиком на allowlist:

- `PaymentsFilters.tsx:23-26` — добавить `<SelectItem value="bank">Банк</SelectItem>`;
- карточки статистики (revenue/count по провайдерам) — 4 колонки;
- таблица: provider badge с иконкой и цветом для 4 значений;
- поиск: по контакту, external_id, номеру банковского документа;
- экспорт CSV: все 4 провайдера, включая bank-специфичные поля;
- bulk actions bar над таблицей;
- в UI нигде не должно быть `admin | manual | other | admin_test` — только 4 канонических провайдера.

---

### Этап 6. Legacy cleanup

Одна миграция + один edge job:

- 113 review/collision → классификация, resolve или archive;
- 260 archive candidates → soft-archive флагом;
- 52 relink review → reconcile через canonical external_id;
- 11 HOLD → resolve по итогам этапа 1;
- удалить legacy код: `test-payment-complete`, `admin-link-payment-to-order`, любые пути записи `provider='admin'`/`admin_test`.

После полной очистки — миграция:

```sql
ALTER TABLE payments_v2
  ADD CONSTRAINT payments_v2_provider_allowlist
  CHECK (provider IN ('bepaid','stripe','rr','bank'));
```

Тот же CHECK на `orders_v2.provider` при наличии.

---

### Этап 7. RR cleanup и финальный E2E

- Удалить 12 test RR-платежей через общий механизм из этапа 4 (не отдельный скрипт), с audit trail.
- Верификация запросами:
  ```text
  deleted RR test payments        = 12
  orphan orders                    = 0
  orphan access                    = 0
  orphan subscriptions             = 0
  orphan provider events           = 0
  ```
- E2E-прогон Playwright (`e2e/admin-payments.spec.ts`):
  - авторизация admin,
  - `+ Добавить платёж` × 4 (по одному на провайдера),
  - одиночное удаление,
  - bulk delete,
  - удаление вместе со сделкой,
  - экспорт CSV,
  - фильтр по каждому из 4 провайдеров,
  - статистика соответствует данным,
  - reload → состояние сохранилось.
- `build PASS`, `bunx vitest run` PASS.

---

### Критерий готовности (единственный)

В UI `/admin/payments` под живым админом можно:

```text
+ добавить bePaid платёж
+ добавить Stripe платёж
+ добавить RR платёж
+ добавить банковский платёж
- удалить один платёж
- удалить несколько платежей
- удалить платёж вместе со сделкой
· отфильтровать четыре провайдера
· увидеть корректную статистику
· выгрузить CSV
```

Без выполнения всех 10 пунктов преспринт не закрывается. До достижения этого критерия никакие новые диагностические патчи не открываются.

---

### Технические детали (для инженера)

- Миграции: 1 на этап 1 (RPC + константы), 1 на этап 6 (CHECK + archive-флаги). GRANT'ы обязательны (`authenticated`, `service_role`).
- Новые edge functions: `admin-create-deal-from-payment`, `admin-create-manual-payment`, `admin-delete-payment`. Все с in-code JWT verify + `has_role(auth.uid(), 'admin')` gate, zod-валидацией, CORS. Аудит через `audit_logs` c `request_id = crypto.randomUUID()`.
- Soft-delete: реиспользовать существующие колонки `deleted_at/deleted_by` из инфраструктурного этапа; не вводить новых.
- UI-модули: `ManualPaymentDialog.tsx`, `DeletePaymentDialog.tsx`, `BulkActionsBar.tsx`, `BankPaymentFields.tsx`.
- Не переписывать `payment_reconcile_queue` и `orders_v2` схему — только чтение и точечные updates.
- Fixtures этапа 1 — самостоятельный test-suite, независимый от grant-access-for-order.

### Оценка сроков

- Рабочий пользовательский UI (этапы 1–5): 2–3 рабочих дня.
- Полное закрытие с legacy cleanup, CHECK и RR E2E (этапы 1–7): 4–6 рабочих дней.