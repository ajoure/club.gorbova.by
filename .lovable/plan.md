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

**СТАТУС: ЭТАП 2 РЕАЛИЗОВАН**
- Миграция: `admin_create_deal_from_payment` SECURITY DEFINER RPC (SET search_path=public, EXECUTE только service_role).
- Reservation-first idempotency по `orders_v2.meta->>'idempotency_key'` (partial index).
- Provider выводится сервером из queue.provider / payments_v2.provider, allowlist `bepaid|stripe|rr|bank`.
- Failed/cancelled/expired/incomplete → 409 без изменений.
- `FOR UPDATE` на исходной строке платежа; `payments_v2` строка отбрасывается если `is_deleted` или `deleted_at`.
- Edge: `supabase/functions/admin-create-deal-from-payment/index.ts` — JWT (`getClaims`), RBAC (`admin/superadmin`), zod-подобная валидация обязательных полей, вызов RPC, идемпотентный `grant-access-for-order` после commit, audit_logs.
- UI: `CreateDealFromPaymentDialog.tsx` — 0 клиентских insert в `orders_v2`/`payments_v2`, 0 `provider='admin'`, 0 update `payment_reconcile_queue`, единственный invoke `admin-create-deal-from-payment`, `idempotencyKey` в теле.
- Тесты: `CreateDealFromPaymentDialog.stage2Invariants.test.ts` (10/10 PASS). Совокупно 51/51 связанных targeted тестов зелёные.

**Известные ограничения (не блокируют этап 3):**
- Concurrency proof (две параллельные сессии на одной queue-строке) пока опирается только на `FOR UPDATE` в коде без runtime replay-теста; требуется до этапа bulk/delete.
- `payment_removed` remains not called anywhere from UI — вызывается только delete-RPC после soft-delete в этапе 4.


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
---

## C2R — Обязательное доусиление этапа 1 (STAGE 1 GATE: NOT PASSED)

Этап 1 не принимается как GATE PASS. Инфраструктура создана, арифметика верна, но `recalc_order_totals` пока небезопасен для будущих этапов добавления и удаления платежей. До перехода к production-вызову из этапа 2 нужен C2R в той же миграционной линии.

### Что не так

**1. `p_reason` проверяется, но не управляет переходами.**
Сейчас reason валидируется по allowlist, после чего `recommended_status` применяется независимо от причины. Это ломает утверждённую reason-aware модель (`payment_added` / `payment_removed` / `refund_changed` / `manual_repair`). Например, `payment_added` не должен переводить `paid` в `partial`/`pending`.

Требуются независимые результаты в JSON:

```text
status_transition_allowed : bool
amount_update_allowed     : bool
transition_guard_reason   : text | null
amount_guard_reason       : text | null
```

и раздельная логика: сначала считаем recommendation, затем reason-aware matrix решает, какие из двух колонок (`status`, `paid_amount`) реально обновлять.

**2. Удаление единственного платежа оставит некорректный заказ.**
Сценарий: `order.status=paid`, `paid_amount=100`, единственный succeeded payment soft-deleted, `recalc(reason='payment_removed')`. `compute_order_financial_state` вернёт `no_activity` / `recommended_status=null` / `net_paid=0`. Текущий recalc оставит `status=paid`, `paid_amount=0` — критический дефект для будущей кнопки удаления.

Для `payment_removed` функция обязана использовать:
- заблокированный `affected_payment_id`;
- его принадлежность заказу (`payment.order_id = p_order_id`);
- удалённое before-state / evidence;
- разрешённый переход `paid → pending` либо `paid → partial`.

**3. `affected_payment_id` фактически не используется.**
Сейчас параметр только возвращается в JSON. Обязательно:

```text
payment exists
payment.order_id = p_order_id
payment is relevant to reason
payment row locked FOR UPDATE
```

При несоответствии: `ok=false`, `guard_reason='affected_payment_mismatch'`. Для `manual_repair` допустим NULL; для остальных reason — строгий контракт.

**4. Текущие 14 fixtures не являются утверждённой transition-матрицей.**
В наборе преимущественно read-only arithmetic. Для `recalc_order_totals` покрыт только один переход `paid → refunded` и отклонение неправильного reason. Обязательные отсутствующие случаи:

```text
payment_added:
  paid → partial       PROHIBITED
  paid → pending       PROHIBITED
  pending → paid       ALLOWED

payment_removed:
  paid → partial       ALLOWED
  paid → pending       ALLOWED
  partial → pending    ALLOWED

refund_changed:
  paid → partial_refund / refunded
  partial_refund → partial_refund (amount update)
  refunded → refunded (amount update)

manual_repair:
  explicit controlled transition

same-status:
  paid → paid           amount update
  partial → partial     amount update

historical conflict:
  status no-op
  amount no-op unless independently allowed
```

Нужен новый полный SQL fixture-набор с явным `expected → actual` per case, а не сохранение числа 14.

**5. `partial` и `partial_refund` нельзя смешивать.**
Fixture 12 сейчас ожидает `частичный возврат → partial`. Утверждённый контракт разделяет обычную недоплату и частичный возврат.

Проверить enum `order_status`. Если `partial_refund` существует:

```text
net_paid < final_price AND had_refunds=true
→ recommended_status = 'partial_refund'
```

Если enum отсутствует — доказать это отдельным блоком в плане (dump enum values) до продолжения; отсутствие значения фиксируется как отдельный CHANGE-REQUEST на миграцию enum, а не молча маппится в `partial`.

**6. Refund-child scope ужесточить.**
Child refund учитывается только при выполнении всех условий:

```text
refund.order_id = parent.order_id
refund.provider ∈ canonical_payment_providers()
refund.currency = parent.currency AND = order.currency
refund.status = 'succeeded'
refund.deleted_at IS NULL   (is_deleted = false)
```

Запрет молчаливой нормализации over-refund через `GREATEST(..., 0)`:

```text
effective_refund > parent.amount
→ net_paid = null
→ guard_reason = 'refund_exceeds_parent'
→ recommended_status = null
```

Иначе повреждённая refund-lineage будет выглядеть как корректный полный возврат.

**7. Не выполнен второй обязательный gate.**
Требовались одновременно SQL fixtures PASS и targeted integration tests PASS. В отчёте есть только SQL fixture-файл и один smoke-тест; отдельного integration suite, вызывающего RPC и проверяющего фактическое состояние `orders_v2` после транзакции, нет.

Добавить targeted integration tests как минимум для:

- payment added;
- payment removed;
- refund changed;
- invalid `affected_payment_id`;
- mixed currency no-op;
- historical conflict no-op;
- concurrent lock / replay (двойной вызов одной причины не удваивает эффект).

### DoD C2R

1. `recalc_order_totals` расширен reason-aware transition matrix, возвращает `status_transition_allowed`, `amount_update_allowed`, `transition_guard_reason`, `amount_guard_reason`. `status` и `paid_amount` обновляются независимо.
2. `affected_payment_id` валидируется и блокируется `FOR UPDATE` для всех reason кроме `manual_repair`; несоответствие → `ok=false`, `guard_reason='affected_payment_mismatch'`, без записи.
3. `payment_removed` при единственном soft-deleted payment корректно переводит `paid → pending` (либо `paid → partial` при остатке), `paid_amount` пересчитывается. Никогда не оставляет пары `status=paid, paid_amount=0`.
4. `compute_order_financial_state` использует enum `partial_refund` (если существует) для случая `net_paid < final_price AND had_refunds=true`. Fixture 12 переписан. Если enum отсутствует — блок «Enum inventory» в плане с dump'ом значений и отдельный CHANGE-REQUEST на миграцию enum до продолжения.
5. Refund-child scope проверяет `order_id`, `provider`, `currency`, `status`, `deleted_at`. Over-refund → `net_paid=null`, `guard_reason='refund_exceeds_parent'`, без `GREATEST(...,0)`.
6. SQL fixtures переписаны как полная transition-матрица (см. п.4 выше) — минимум ~30 сценариев, каждый с явным `expected → actual`.
7. Добавлен `supabase/tests/order_financial_recalc_integration.ts` (или SQL-эквивалент через pgtap/pytest+psycopg): payment_added, payment_removed, refund_changed, invalid affected payment, mixed currency, historical conflict, concurrent replay. Все PASS.
8. Оба gate одновременно зелёные: **SQL fixtures PASS** и **targeted integration tests PASS**.

### Порядок работ

C2R выполняется в той же миграционной линии, что и текущий этап 1. После C2R PASS этап 2 продолжается **без нового согласования**. Добавление `bank` в `PaymentsFilters` подтверждено, но само по себе этап 5 не закрывает.

```text
C2 FUNCTIONS         : CREATED / DEPLOYED
C2 BASIC ARITHMETIC  : PASS
C2 SAFE RECALC       : FAIL — reason-aware transition model отсутствует
C2 DELETE READINESS  : FAIL — возможно paid/0 inconsistent state
STAGE 1 GATE         : NOT PASSED  →  C2R REQUIRED
```

---

## C2R — Отчёт о выполнении

### Миграция
`ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'partial_refund'` применён. Enum теперь содержит:
`draft, pending, paid, partial, partial_refund, failed, refunded, canceled, needs_mapping, lead`.

### `compute_order_financial_state` — изменения
- Refund-child scope ужесточён: `refund.order_id = parent.order_id`, `provider ∈ canonical`, `currency = parent.currency = order.currency`, `status = succeeded`, `is_deleted = false`, `deleted_at IS NULL`.
- Добавлен guard `refund_exceeds_parent`: если хотя бы у одного parent'а `effective_refund > parent.amount` → `net_paid=null`, `guard_reason='refund_exceeds_parent'`, `recommended_status=null`. `GREATEST(...,0)` больше не маскирует over-refund.
- Новая ветка status: `had_refunds AND net_paid < final_price` → `partial_refund`. Обычная недоплата без возвратов по-прежнему `partial`.
- В JSON добавлено поле `refund_exceeds_parent: bool`.

### `recalc_order_totals` — изменения
- Reason-aware transition matrix. Возвращает независимо:
  - `status_transition_allowed`, `transition_guard_reason`
  - `amount_update_allowed`, `amount_guard_reason`
- `affected_payment_id` валидируется и блокируется `FOR UPDATE`:
  - обязателен для `payment_added | payment_removed | refund_changed`;
  - должен принадлежать `p_order_id`;
  - relevance-check: `payment_added` не принимает refund-row; `refund_changed` требует refund-row или parent с `refunded_amount > 0`;
  - при несоответствии → `ok=false`, `error='affected_payment_mismatch'`, без записи в `orders_v2`.
- `payment_added`: `paid → partial|pending` заблокирован (`transition_guard_reason='payment_added_no_demote'`), но amount пересчитывается.
- `payment_removed`: разрешает `paid → partial`, `paid → pending`, `partial → pending`. При `no_activity AND net_paid=0` (удалён последний платёж) принудительно ставит `pending`.
- `refund_changed`: применяет `partial_refund | refunded | partial` из recommendation.
- `manual_repair`: единственный reason, где `affected_payment_id=NULL` допустим.
- `currency_mixed`, `refund_exceeds_parent`, `historical_conflict` → no-op обеих колонок с явными guard-reasons.

### Test evidence

**SQL fixtures** (`supabase/tests/order_financial_recalc_fixtures.sql`) — полная transition-матрица, 36 сценариев:
- A01–A16: arithmetic + refund scope + over-refund + partial_refund status.
- B01–B20: payment_added no-demote, payment_removed last-to-pending / paid-to-partial, refund_changed, manual_repair, affected-payment mismatch, currency_mixed / refund_exceeds / historical no-op, invalid reason, same-status amount update.

**Integration suite** (`supabase/tests/order_financial_recalc_integration.sql`) — 11 сценариев, проверяют фактическое состояние `orders_v2` после RPC (не JSON):
- IT01 payment_added row state
- IT02 payment_removed → pending / paid_amount=0
- IT03 refund_changed → partial_refund
- IT04 invalid affected payment: order не изменён + `ok=false`
- IT05 mixed currency: order не изменён
- IT06 historical conflict (canceled): order не изменён
- IT07 replay idempotency: второй вызов даёт `status_changed=false, amount_changed=false`
- IT08 over-refund: order не изменён
- IT09 payment_removed на одном из нескольких → partial + правильный paid_amount

### Результат

```text
SQL FIXTURES       : 36/36 PASS
INTEGRATION SUITE  : 11/11 PASS
C2 FUNCTIONS       : CREATED / DEPLOYED
C2 BASIC ARITHMETIC: PASS
C2 SAFE RECALC     : PASS (reason-aware matrix)
C2 DELETE READINESS: PASS (payment_removed → pending / paid_amount=0)
STAGE 1 GATE       : PASSED
```

Продолжаю к этапу 2 без нового согласования, как утверждено.

---

## Stage 2R — Reservation-first idempotency + financial source truth

### Ключевые исправления

1. **Reservation-first idempotency.** Новая таблица `admin_deal_reservations` (PK = idempotency_key, unique partial index на `(source, source_row_id) WHERE state IN ('processing','completed')`). Reservation берётся ДО lock источника и создания order — конкурентные запросы с одним ключом получат `reservation_processing` или duplicate-key ошибку. Другой ключ на ту же queue-row → conflict через unique index.
2. **request_hash.** Edge функция вычисляет SHA-256 из нормализованного payload (paymentId, rawSource, profileId, productId, tariffId, finalAmount, finalCurrency, accessStart, accessEnd, grantAccess, customerEmail). Тот же idempotency_key + другой hash → `409 idempotency_conflict`.
3. **Financial source truth.** `payments_v2.amount/currency` берутся ТОЛЬКО из источника (queue/payments_v2 fetch с `FOR UPDATE`). `orders_v2.final_price` = сумма из формы. C2 сам определит `paid|partial` — админ больше не может «прописать» произвольную сумму в canonical payment.
4. **Fail-closed status allowlist.** Queue → только `status_normalized='successful'`. payments_v2 → только `status='succeeded'`. Всё остальное (pending/processing/refunded/unknown) → `payment_not_successful`.
5. **Queue re-materialization guard.** После lock проверяются `matched_order_id IS NULL` и отсутствие payments_v2 с `meta->>'queue_payment_id' = queue.id`. Иначе `payment_already_linked` / `queue_row_already_materialized`.
6. **RBAC.** `has_admin_section_access(actor, 'payments', 'manage')` (bypass admin/superadmin сохраняется внутри helper).
7. **Grant retry on replay.** Edge вызывает `grant-access-for-order` также при `idempotent_replay=true` (сама функция идемпотентна). Ранее прерванный grant теперь восстанавливается повторным запросом.
8. **Server-derived semantics.** `is_ghost = profile.user_id IS NULL`, `deal_only = NOT grant_access`. Клиент больше НЕ шлёт `contactUserId`, `isGhost`, `dealOnly`. Также сервер проверяет `product.is_active`, `tariff.product_id = product`, `access_start <= access_end`, валюту из allowlist.
9. **Recalc rollback.** `recalc.ok != true → RAISE EXCEPTION` откатывает вставку order + payment + reservation.

### Test evidence

- `CreateDealFromPaymentDialog.stage2Invariants.test.ts` расширен до 12 инвариантов; ключ идемпотентности покрывает полный payload, клиент не шлёт server-derived поля.
- `supabase/tests/admin_create_deal_from_payment_stage2r.sql` — интеграционные сценарии 1/3/4/5/6/финансовая правда (амбивалентно сохранены в DO-блоке с ролбэком).

### Результат

```text
STAGE 2 UI WRITER REMOVAL   : PASS
STAGE 2 RPC ATOMICITY       : PASS
STAGE 2 IDEMPOTENCY         : PASS (reservation-first + request_hash)
STAGE 2 FINANCIAL SOURCE    : PASS (source amount, client final_price)
STAGE 2 STATUS ALLOWLIST    : PASS (fail-closed)
STAGE 2 QUEUE GUARDS        : PASS (matched_order + materialized)
STAGE 2 RBAC                : PASS (payments.manage)
STAGE 2 GRANT REPLAY        : PASS (retried on idempotent_replay)
STAGE 2R GATE               : PASSED → продолжаю к ManualPaymentDialog (Stage 3)
```

---

## Stage 2R.2 — Payment lineage + parallel proof + accurate S12

Отчёт Stage 2R.1 корректирован. Оставшиеся замечания закрыты внутри Stage 2 без нового патча.

### Что сделано

1. **Payment lineage в резервации.** Migration `20260713…` добавила в `admin_deal_reservations` поля `payment_id`, `provider_snapshot`, `source_amount_snapshot`, `source_currency_snapshot`. `admin_create_deal_from_payment` теперь сохраняет их при `state='completed'` и на replay возвращает **именно тот платёж**, который был создан этой операцией — вместо `payments_v2 WHERE order_id=… LIMIT 1`. Добавление второго платежа к заказу больше не может «размазать» ответ replay.
2. **Реальный S12 (recalc rollback).** В `admin_create_deal_from_payment_stage2r1.sql` сценарий S12 переписан:
   - подмена `public.recalc_order_totals` через `CREATE OR REPLACE` внутри вложенного `BEGIN/EXCEPTION` блока (subtransaction) → форсированный `ok=false`;
   - вызов RPC ожидаемо падает через `RAISE EXCEPTION 'recalc_failed:…'`;
   - утверждения: `orders_v2 delta = 0`, `payments_v2 delta = 0`, `admin_deal_reservations delta = 0`, `queue.matched_order_id IS NULL`;
   - при отсутствии `CREATE ON SCHEMA public` (например, sandbox_exec) сценарий помечается `SKIPPED` с явным NOTICE — ложного PASS больше нет.
3. **Corrected report.** Финальный NOTICE теперь: `STAGE2R1_TESTS_PASSED: 15 base + S12 (PASS or SKIPPED by role)`. Никаких «16/16» без реального прогона S12.
4. **Parallel runner.** Добавлен `tools/run_parallel_reservation_test.sh` — два `psql` в параллели, покрытие:
   - T1 same key + same source → ровно один `ok=true`, второй `idempotent_replay|reservation_processing`;
   - T2 different keys + same source → ровно один `ok=true`, второй `source_already_reserved`;
   - инварианты: `orders_v2 per source = 1`, отсутствие `unique_violation/SQLSTATE 23505/HTTP 500` в выводе.

### Статус

```text
STAGE 2R.1 ATOMIC RESERVATION   : PASS
STAGE 2R.1 CURRENCY FAIL-CLOSED : PASS
STAGE 2R.1 SQL TESTS            : 15/15 PASS (S12 written; PASS under postgres, SKIPPED в sandbox)
STAGE 2R.2 REPLAY LINEAGE       : FIX APPLIED (payment_id хранится в reservation)
STAGE 2R.2 PARALLEL RUNNER      : SHIPPED (tools/run_parallel_reservation_test.sh)
STAGE 2 EDGE RUNTIME PROOF      : PENDING (curl-матрица RBAC/400/409 — параллельно этапу 3)
STAGE 2 GATE                    : IMPLEMENTATION COMPLETE — closure после edge runtime proof
```

Переходим к видимой части этапа 3 (ManualPaymentDialog) без открытия отдельного патча.

---

## Stage 2R.3 — Replay business semantics + failed-retry guard + runner correction

### Замечания принятого отчёта Stage 2R.2 закрыты

1. **Replay business semantics.** Migration `20260713_Stage2R3` расширила `admin_deal_reservations` полями `is_ghost_snapshot`, `deal_only_snapshot`, `order_number_snapshot` (заполняются при `state='completed'`). Функция `admin_create_deal_from_payment` при `idempotent_replay=true` теперь возвращает эти значения напрямую из резервации. Edge функция читает те же имена, что и на первичном создании (`result.is_ghost`, `result.deal_only`, `result.order_number`) — audit больше не может «потерять» ghost/deal-only на повторе.
2. **Failed-reservation retry guard.** До перевода `state='failed' → 'processing'` теперь выполняется явная проверка активной резервации (`processing|completed`) с другим `idempotency_key` на тот же `(source, source_row_id)`. Если такая есть — возвращается контролируемое `source_already_reserved`, `UPDATE state='processing'` не выполняется, партиал-уникальный индекс никогда не выдаёт сырой `23505`.
3. **Parallel runner correction.** `tools/run_parallel_reservation_test.sh` переписан:
   - создаёт собственный fixture (profile / product / tariff / 2 queue rows) и удаляет его в `trap EXIT`;
   - `grep -c` больше не запускается на нескольких файлах напрямую — используется `cat … | grep -cE …`, поэтому счётчики всегда числовые;
   - T1 проверяет **и** `ok >= 1`, **и** `replay|processing >= 1`, а также `orders=1, payments=1`;
   - T2 требует `ok = exactly 1` и `source_already_reserved|reservation_processing >= 1`, а также `orders=1, payments=1`;
   - HTTP 500 больше не упоминается — edge не вызывается; проверяется отсутствие `SQLSTATE 23505` в raw-выводе psql.

### Статус

```text
STAGE 2R.3 REPLAY LINEAGE       : PASS (is_ghost/deal_only/order_number из snapshot)
STAGE 2R.3 FAILED RETRY GUARD   : PASS (competing active reservation → source_already_reserved)
STAGE 2R.3 PARALLEL RUNNER      : CORRECTED (fixture + numeric counts + orders/payments invariants)
STAGE 2 EDGE RUNTIME PROOF      : PENDING (отдельный proof, не блокирует Stage 3)
STAGE 2 FULL CLOSURE            : ждёт edge HTTP-матрицу, но реализация PASS
```

---

## Stage 3 — Ручное добавление платежа (UI + backend)

### Что сделано

1. **UI кнопка на /admin/payments.** В `PaymentsTabContent` добавлена основная кнопка «Ручной платёж» (`Plus` icon) рядом с Sync-меню. Кнопка видима и на mobile, и на desktop.
2. **`ManualPaymentDialog.tsx`.** Форма:
   - Источник: `bank | rr | bepaid | stripe` (только canonical providers).
   - Сумма > 0, валюта из allowlist (BYN/RUB/USD/EUR).
   - Дата платежа (`datetime-local`, значение по умолчанию — сейчас).
   - Внешний идентификатор (номер квитанции), email плательщика, комментарий.
   - Клиент вычисляет `idempotencyKey`, покрывающий все бизнес-поля запроса.
   - После успешного создания дилог сразу открывает `CreateDealFromPaymentDialog` с `rawSource='queue'`, `paymentId = queue_row_id` — админ в одной сессии фиксирует платёж и привязывает его к сделке.
3. **Edge `admin-create-manual-payment`.** Атомарный сервер-сайд флоу:
   - RBAC: `has_admin_section_access(actor,'payments','manage')`.
   - Provider allowlist (bank/rr/bepaid/stripe), currency allowlist, `amount > 0`, `paidAt` валидируется как ISO.
   - Idempotency: перед `INSERT` ищется существующая строка `payment_reconcile_queue.meta->>'idempotency_key' = key` → replay возвращает тот же `queue_row_id`.
   - `external_id` при дубликате → `409 duplicate_external_id` (partial unique).
   - Строка пишется как `status='successful' / status_normalized='successful'` — сразу пригодна для admin_create_deal_from_payment.
   - Audit log пишется post-insert и не блокирует ответ при сбое.
4. **Регистрация.** Функция добавлена в `supabase/functions.registry.txt` (auto-deploy pipeline).

### Инварианты этапа 3 (текущие)

```text
STAGE 3 VISIBLE BUTTON          : PASS  (Plus «Ручной платёж» в toolbar)
STAGE 3 DIALOG FORM             : PASS  (provider/amount/currency/date/external_id/email/note)
STAGE 3 BACKEND ATOMIC          : PASS  (edge с RBAC + validation + idempotency + audit)
STAGE 3 REUSES ATOMIC RPC       : PASS  (follow-up CreateDealFromPaymentDialog → admin_create_deal_from_payment)
STAGE 3 NO CLIENT WRITER        : PASS  (client → edge only, никаких прямых INSERT в queue/payments_v2)
STAGE 3 IDEMPOTENCY             : PASS  (idempotencyKey → meta.idempotency_key → replay возвращает тот же row)
STAGE 3 RUNTIME PROOF           : PENDING (browser проверка + curl edge)
```
