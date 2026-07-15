# Stage 6.F — Semantic Proof без DML (2026-07-15)

## Метод

Read-only агрегаты по `public.payments_v2` + аудит канонических финансовых функций
и UI-компонентов админ-фильтра. Никаких изменений в коде.

## 1. admin_grant не входит в финансовую выручку

**Канонический фильтр выручки:** `public.compute_order_financial_state` использует
`public.canonical_payment_providers() = ARRAY['bepaid','stripe','rr','bank']`
(см. `pg_proc`) и включает только строки с `provider = ANY(canonical)` в расчёт
`v_gross_paid` / `v_effective_refunds`. Строки с `provider='admin'` (в т.ч.
`meta.source='admin_grant'`) идут в счётчик `v_ignored_count`, не в выручку.

Данные подтверждают:

| bucket                    | rows | active | succeeded | sum_succeeded |
|---------------------------|------|--------|-----------|---------------|
| excluded:admin_grant      | 201  | 201    | 201       | **0.00**      |

Все 201 admin_grant записи имеют `amount=0` — это подтверждает семантику
«административная выдача доступа, не финансовая операция».

**PASS.**

## 2. Исторические admin_from_payment — DEFERRED

**Ожидание пользователя:** «исторические admin_from_payment продолжают
учитываться» в выручке.

**Фактическое состояние:** provider у них равен `'admin'`, а не canonical
(`bepaid|stripe|rr|bank`), поэтому `compute_order_financial_state` их **исключает**
из `v_gross_paid`.

| bucket                        | rows | active | succeeded | sum_succeeded |
|-------------------------------|------|--------|-----------|---------------|
| excluded:admin_from_payment   | 113  | 113    | 113       | **23 473.00** |

**Оценка риска.** У всех 113 строк есть `queue_payment_id`, ссылающийся на
`payment_reconcile_queue`, т.е. финансовый источник — обычный bepaid платёж,
который уже учтён в `canonical:bepaid` (sum 1 051 611.23). Включение
`admin_from_payment` в выручку без предварительного lineage-разбора создаст
**двойной учёт 23 473 руб**. Разбор lineage требует DML/reclassification, что
явно исключено из этого спринта.

**Решение:** статус **DEFERRED** — текущее поведение (исключение из выручки)
может быть безопасным в рамках дедупликации, но требует отдельного аудита
lineage. Занесено в backlog под п. «113 исторических admin_from_payment».

## 3. UI-фильтр провайдеров

Прямой grep по всем `<SelectItem value="...">` в `src/pages/admin/` и
`src/components/admin/`, `src/components/payment/`:

| файл                                                        | опции provider          |
|-------------------------------------------------------------|-------------------------|
| `src/components/admin/payments/links/LinksTabContent.tsx`   | `bepaid`, `stripe`      |
| `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx` | `bepaid`, `stripe` |
| `src/components/admin/payments/PaymentsFilters.tsx`         | фильтр по `source`/`origin`, не по provider (значения: webhook/api/file_import/processed и bepaid/statement_sync/other) |

Ни в одном селекте не встречаются `admin`, `admin_test`, `admin_grant`,
`admin_from_payment`, `bank_transfer`. Единственные ссылки на `provider='admin'`
и `provider='admin_test'` в `src/` — это audit-комментарии Stage 6.B в
`ContactDetailSheet.tsx` и `AdminOrdersV2.tsx`.

**PASS.**

## Дополнительная находка (preflight Stage 6.G)

Distinct providers в `payments_v2`:
`bepaid, admin, rr, admin_test, stripe, bank, bank_transfer`.

`bank_transfer` (2 строки от 2026-07-13, `origin='manual_admin'`, тот же
`order_id=ef4d828e-94b3-445b-98a1-c64079b046e2`, `amount=100.00 BYN`, `meta=NULL`,
`is_deleted=false`, `status ≠ succeeded`) — вне canonical whitelist. Активная
edge-функция `admin-create-manual-payment` и RPC `admin_create_manual_payment_v1`
жёстко ограничены `bepaid|stripe|rr|bank` и не могут это записать.

Эти записи не влияют на финансовую выручку (исключены canonical-фильтром), но
представляют «unknown writer» — проходит по Stage 6.G preflight ниже.

## Свод

| Инвариант                                         | Статус    |
|---------------------------------------------------|-----------|
| admin_grant не в выручке                          | PASS      |
| admin_from_payment учитывается в выручке          | DEFERRED  |
| admin/admin_test/admin_grant/admin_from_payment отсутствуют в UI-фильтрах | PASS |

**STAGE 6.F : PASS с DEFERRED по admin_from_payment**
(корректная семантика подтверждена, окончательная классификация lineage
отложена в backlog вместе с историческим DML)
