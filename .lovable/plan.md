

# План: Ретроактивное применение правила product_access

## Диагноз (верифицировано по БД)

**Правило:** `1b497fba` — `product_access`, `prior_purchase`, `per_product`, привязано к тарифу BUSINESS (`7c748940`), продукт Клуб (`11c9f1b8`).

**Целевые продукты:** 9 штук (массив `target_product_ids` = `required_product_ids`):
- `7101ed3c` — Ценный бухгалтер 2.0
- `d7effaf4`, `9187db54`, `99f1f156`, `064dd768`, `abee24cd`, `f833c846`, `ea98d043`, `64d9f812` — ещё 8 продуктов

**Клиент** `1b68252b` / profile `77326882`:
- Заказ `ddfaeb9c` — **paid**, product=Клуб (`11c9f1b8`), tariff=BUSINESS (`7c748940`). Подтверждён как канонический.
- Paid orders по целевым продуктам: **1 из 9** — только ЦБ 2.0 (`7101ed3c`), заказ от 2026-03-28.
- Текущий entitlement на ЦБ 2.0: **уже активен** до 2026-12-23 (order `76167d70`).
- Ledger записей для этого профиля: **0** (правило никогда не обрабатывалось).

**Итого:** Из 9 целевых продуктов клиент покупал 1. По остальным 8 — нет paid orders → `skipped_by_condition`.

---

## Вариант A: Точечное исправление для клиента

### DRY RUN — ожидаемый результат

| Целевой продукт | prior_purchase? | Текущий entitlement | Ожидаемый результат ledger |
|---|---|---|---|
| ЦБ 2.0 (`7101ed3c`) | Да | Активен до 2026-12-23 | `granted` или `extended` (syncEntitlement: GREATEST — expires_at не уменьшится) |
| 8 остальных | Нет paid orders | — | `skipped_by_condition` × 8 |

**Уточнение:** Если syncEntitlement вычислит новый expires_at ≤ текущего (2026-12-23), entitlement не изменится. Ledger зафиксирует факт обработки. Это корректный результат.

### EXECUTE
Вызов EF `grant-access-for-order` с `orderId = 'ddfaeb9c-0cdb-4c1b-b6ed-6963911aa3a9'`.

### VERIFY
1. Ledger: 9 записей — 1 granted/extended + 8 skipped_by_condition
2. Entitlement ЦБ 2.0: expires_at ≥ 2026-12-23 (без уменьшения), без дублей
3. Audit log зафиксирован

### DoD
- Правило product_access ретроактивно обработано для заказа ddfaeb9c
- Ledger зафиксировал результат для всех 9 целевых продуктов
- Entitlement приведён в корректное состояние без дублей
- Нет побочных эффектов на другие entitlements клиента

---

## Вариант B: Системное решение (batch) — следующий шаг

**Scope:** Только активные подписки с tariff_id, для которого существуют активные правила product_access с prior_purchase.

- Новая admin EF `retroactive-apply-product-access-rules`
- Для каждой подписки находит последний paid order → вызывает существующую `grant-access-for-order` (reuse, не cross-domain)
- Идемпотентность: syncEntitlement + ledger dedup исключают дубли при повторных запусках
- Dry-run по умолчанию, limit, admin auth
- Audit: batch_id + affected/skipped count в audit_logs

---

## Вариант C: Авто-триггер при создании правила — отдельная задача

Event-driven механизм (не UI-логика):
- INSERT в access_rules → domain event `access_rule_created`
- Backend-обработчик запускает batch из Варианта B
- UI только создаёт правило

---

## Порядок

1. **Сейчас:** Вариант A — починить клиента
2. **Далее:** Вариант B — batch EF
3. **Потом:** Вариант C — event-driven

## Затрагиваемые файлы

| Вариант | Изменения |
|---|---|
| A | 0 изменений кода — вызов существующей EF |
| B | Новая EF `retroactive-apply-product-access-rules` |
| C | DB trigger + event handler |

