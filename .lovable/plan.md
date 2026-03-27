# да, согласен, с учетом правок:

&nbsp;

1. В PATCH C и PATCH D уточни переменные в idempotency lookup. Сейчас:  

  - WHERE (profile_id = X OR user_id = X)  
  Нужно явно писать:
  - для matched_full: profile_id = <profile_id> OR user_id = <user_id>
  - для profile_only: profile_id = <profile_id> OR user_id = <profile_id>  
  Иначе X двусмысленен.
2. &nbsp;
3. Для Group B добавь в subscriptions_v2 привязку к order_id, если такое поле есть в схеме.  
Это важно для трассировки:  

  - existing order → использовать existing order_id
  - new order → писать new order_id в subscription  
  Иначе коммерческая и access-цепочка будут связаны только косвенно.
4. &nbsp;
5. В rollback для “лишней сделки” лучше не писать общий WHERE meta->>'batch_id' = X без id/profile_id, чтобы случайно не отменить все batch rows.  
Формулировка должна быть точечной:  

  - по id
  - или по profile_id + batch_id
  - только для ошибочно созданной записи.
6. &nbsp;
7. В PATCH E для Group B добавь отдельную проверку, что 7 existing orders не были изменены лишний раз, а 2 new orders созданы ровно по одному.

&nbsp;

&nbsp;

В остальном план уже можно принимать:

&nbsp;

- module_access чинится отдельно,
- cohort фиксируются до execute,
- Group B идет через orders_v2 + subscriptions_v2,
- Group A только через subscriptions_v2,
- overlap вычитается до запуска Group A,
- rollback и cross-proof описаны корректно.

&nbsp;

&nbsp;

План: Финальная каноническая версия (v6) — массовая выдача доступов

Все 5 правок интегрированы. Ниже — полный план.

---

## §1. Канонические сущности (из БД)

### Group A — модуль в составе ЦБ 2.0


| Поле        | Значение                                            |
| ----------- | --------------------------------------------------- |
| module_id   | `881d514f-3894-4467-8d8c-53bcc2966ac2`              |
| module_slug | `cb-podohodnyj-nalog-ip`                            |
| product_id  | `ea98d043-e852-443f-8807-6e77de6a5e1f` (PRD-000017) |
| tariff_id   | `5d6b73f3-d443-43d7-967e-3d9a0eae85a6` (T-000012)   |


### Group B — отдельный платный продукт


| Поле        | Значение                                            |
| ----------- | --------------------------------------------------- |
| module_id   | `40927147-918b-4597-bb9e-6a41c2b16c94`              |
| module_slug | `podohodnyj-nalog-ip`                               |
| product_id  | `de36a695-6b66-4547-bdb8-e64aa85eeabc` (PRD-000020) |
| tariff_id   | `0fb3db55-b6ba-44bf-8a0b-37bb040ab01a` (T-000010)   |


### module_access — ДО / ПОСЛЕ PATCH A

**ДО:** cb-podohodnyj-nalog-ip → T-000010 (ОШИБКА), podohodnyj-nalog-ip → T-000010 (OK)

**ПОСЛЕ:** cb-podohodnyj-nalog-ip → T-000012, podohodnyj-nalog-ip → T-000010

---

## §2. Каноническая модель доступа

```text
module_access(module_id → tariff_id) → subscriptions_v2(profile_id, tariff_id, status IN ('active','trial')) → has_access
```

Entitlements не участвуют. Параллельных access-path нет.

---

## §3. Сделка = orders_v2 (бизнес-решение этого PATCH)

Единственная коммерческая таблица. Enum `order_status`: `{draft, pending, paid, partial, failed, refunded, canceled, needs_mapping}`.

**Dedupe rule:** любая existing запись по `profile_id + product_id` (любой status) = не создавать дубль.

**Rollback:** `UPDATE orders_v2 SET status = 'canceled'` — подтверждено, `canceled` входит в enum `order_status`.

---

## §4. Typo-коррекция (разовое правило)

`LANA0407@tut.b` → `lana0407@tut.by` — подтверждено independent paid order. НЕ общее правило.

---

## PATCH A — Исправление module_access

Idempotent SQL: guard INSERT cb → T-000012 (если не существует), DELETE cb → T-000010 (по module_id + wrong tariff_id).

Verify: каждый модуль имеет ровно одну правильную связку. Не трогает: subscriptions_v2, orders_v2, entitlements, profiles.

---

## PATCH B — Dry Run / Cohort Split

Только чтение. Генерирует артефакты в `/mnt/documents/`:

- `group_b_emails.txt`, `group_a_excluded.txt`, `group_a_final_execute_list.txt`, `dry_run_report.txt`

**Subscription idempotency lookup (правило для обеих групп):**

- Основной: `profile_id = X AND tariff_id = Y`
- Дополнительно: `OR user_id = X AND tariff_id = Y` (для ghost-grant где user_id = profile_id)
- Latest row: `ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 1`

**Group B breakdown:** total / matched_full / profile_only / not_found / existing_order / order_to_create / existing_subscription / to_grant

**Group A breakdown (после вычитания):** original / excluded / final / matched_full / profile_only / not_found / existing_subscription / to_grant / mini_pilot_needed

---

## PATCH C — Сделки + доступы Group B

**batch_id_b:** UUID. **target_end_b** и **executed_at_b** вычисляются один раз.

### Execute flow (для каждого email):

```text
Step 1: LOOKUP → profile_id + user_id

Step 2: SUBSCRIPTION CHECK (idempotency)
  → SELECT FROM subscriptions_v2
    WHERE (profile_id = X OR user_id = X) AND tariff_id = T-000010
    ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 1

  → active, access_end_at >= target_end_b → SKIP
  → active, access_end_at < target_end_b → EXTEND
  → inactive/expired/canceled → REACTIVATE latest row
  → нет записей → GRANT (proceed to Step 3-4)

Step 3: DEAL CHECK / CREATE (только если GRANT)
  → SELECT FROM orders_v2 WHERE profile_id = X AND product_id = 'de36a695-...'
  → Если есть (любой status) → skip, deal_action = 'exists'
  → Если нет → INSERT orders_v2:
    order_number, user_id, profile_id, product_id='de36a695-...', 
    tariff_id='0fb3db55-...', base_price=350, final_price=350,
    currency=BYN, status=paid, paid_amount=350, is_trial=false,
    deal_date=executed_at_b, origin=admin_manual,
    meta={batch_id, group=B, origin=admin_bulk_grant, 
          reason=separate_product_paid, product_id, tariff_id,
          executed_at, price=350, source_email}
  → INSERT failed → ABORT email, log, continue

Step 4: SUBSCRIPTION CREATE
  → INSERT subscriptions_v2 (tariff T-000010, product PRD-000020,
    user_id, profile_id, status=active, access_start_at=executed_at_b,
    access_end_at=target_end_b, auto_renew=false, is_trial=false,
    billing_type=manual, meta с batch_id_b, group=B, row_action, 
    deal_action, tariff_id, product_id, target_end, executed_at)
  → Failed AND new deal created → DELETE new order, log: deal_rolled_back
  → OK → subscription_action = 'granted'

Step 5: AUDIT (row-level + batch-level)
```

### profile_only правило:

- user_id = profile_id, profile_id = profile_id
- meta.is_ghost_grant = true, meta.pending_user_claim = true

### Batch summary (в audit + отчёт):

granted / extended / reactivated / skipped / failed / deal_created / deal_exists

Не трогает: subscriptions_v2 с T-000012, module_access, entitlements.

---

## PATCH D — Доступы Group A

**Предусловие:** читает утверждённый артефакт `group_a_final_execute_list.txt` (не пересчитывает cohort).

**batch_id_a:** UUID, отдельный. **target_end_a** и **executed_at_a** вычисляются один раз.

**Mini-pilot:** только если PATCH B показал profile_only > 0.

### Execute flow (тот же детерминированный порядок):

```text
Step 1: LOOKUP → profile_id + user_id (из артефакта)

Step 2: SUBSCRIPTION CHECK (idempotency)
  → SELECT FROM subscriptions_v2
    WHERE (profile_id = X OR user_id = X) AND tariff_id = T-000012
    ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 1

  → active, access_end_at >= target_end_a → SKIP
  → active, access_end_at < target_end_a → EXTEND
  → inactive/expired/canceled → REACTIVATE latest row
  → нет записей → GRANT (INSERT)

Step 3: AUDIT
```

profile_only правило — то же. Сделки НЕ создаются.

Batch summary: granted / extended / reactivated / skipped / failed

Не трогает: subscriptions_v2 с T-000010, orders_v2, module_access, entitlements.

---

## PATCH E — Verify

### Group B:

1. COUNT subscriptions_v2 WHERE meta->>'batch_id' = batch_id_b
2. COUNT orders_v2 WHERE meta->>'batch_id' = batch_id_b → ожидаем 2
3. **Отдельная проверка двух созданных orders:**
  - `malina109@tut.by` — order 350 BYN создан, подписка T-000010 active
  - `rabchevskaya.buh@gmail.com` — order 350 BYN создан, подписка T-000010 active
4. Spot-check 3 email: подписка T-000010 active, доступ открывает `podohodnyj-nalog-ip` (НЕ `cb-podohodnyj-nalog-ip`)
5. Batch summary сходится с dry run

### Group A:

1. COUNT subscriptions_v2 WHERE meta->>'batch_id' = batch_id_a
2. Spot-check 3-5 email: подписка T-000012 active, доступ открывает `cb-podohodnyj-nalog-ip` (НЕ `podohodnyj-nalog-ip`)
3. Batch summary сходится

### Cross-proof:

1. Ни один Group B email не имеет подписки T-000012 от batch_id_a
2. Ни один Group A email не имеет подписки T-000010 от batch_id_b
3. 1 overlap email: только в Group B
4. module_access: cb → T-000012 only, podohodnyj → T-000010 only

---

## Rollback


| Ошибка                              | Откат                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| module_access не к тому тарифу      | DELETE по module_id + wrong_tariff_id, INSERT правильную                                                                                   |
| Лишняя сделка                       | `UPDATE orders_v2 SET status = 'canceled' WHERE meta->>'batch_id' = X` (подтверждено: `canceled` ∈ enum `order_status`)                    |
| Доступ не той группе                | `UPDATE subscriptions_v2 SET status = 'canceled', canceled_at = NOW(), cancel_reason = 'wrong_group_rollback' WHERE meta->>'batch_id' = X` |
| Частичный сбой (deal есть, sub нет) | DELETE new order по id                                                                                                                     |


---

## Архитектурный вывод

**Group B:** `PRD-000020 → T-000010 → module_access → podohodnyj-nalog-ip → subscriptions_v2 + orders_v2 (350 BYN)`

**Group A:** `PRD-000017 → T-000012 → module_access → cb-podohodnyj-nalog-ip → subscriptions_v2 (без orders)`

Этот PATCH — эталонный шаблон. Вся логика по UUID, никакого матчинга по ФИО/названию.

---

## DoD (ожидаемый результат после execute)

1. module_access исправлен: cb → T-000012, podohodnyj → T-000010
2. Артефакты cohort split сохранены до execute
3. Group B: подписки T-000010 выданы (9), orders созданы где нужно (2), не задублированы (7)
4. Group A: подписки T-000012 выданы финальному cohort из утверждённого артефакта
5. Batch summary записан для обеих групп отдельно
6. Cross-proof: группы не смешаны
7. Subscription idempotency: lookup по profile_id + tariff_id (primary), user_id + tariff_id (secondary)
8. PATCH D использует фиксированный входной артефакт, не пересчитывает cohort