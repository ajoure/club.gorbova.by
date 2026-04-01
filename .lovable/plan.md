
# План: Ретроактивное применение правила product_access

## Диагноз (верифицировано по БД)

**Правило:** `1b497fba` — `product_access`, `prior_purchase`, `per_product`, привязано к тарифу BUSINESS (`7c748940`), продукт Клуб (`11c9f1b8`).

**Целевые продукты:** 9 штук (массив `target_product_ids` = `required_product_ids`):
- `7101ed3c` — Ценный бухгалтер 2.0
- `d7effaf4`, `9187db54`, `99f1f156`, `064dd768`, `abee24cd`, `f833c846`, `ea98d043`, `64d9f812` — ещё 8 продуктов

**Клиент** `1b68252b` / profile `77326882`:
- Заказ `ddfaeb9c` — **paid**, product=Клуб (`11c9f1b8`), tariff=BUSINESS (`7c748940`). ✅ Подтверждён как канонический.
- Paid orders по целевым продуктам: **только 1** — ЦБ 2.0 (`7101ed3c`), заказ от 2026-03-28.
- Текущий entitlement на ЦБ 2.0: **уже активен** до 2026-12-23 (order `76167d70`).
- Ledger записей для этого профиля: **0** (правило никогда не обрабатывалось).

**Точная цифра:** Из 9 целевых продуктов клиент покупал **1** (ЦБ 2.0). По оставшимся **8** продуктам paid orders нет → статус `skipped_by_condition` (корректно по логике `per_product`).

---

## Вариант A: Точечное исправление для клиента

### DRY RUN — ожидаемый результат вызова `grant-access-for-order` для `ddfaeb9c`:

| Целевой продукт | prior_purchase? | Текущий entitlement | Ожидаемый результат ledger |
|---|---|---|---|
| ЦБ 2.0 (`7101ed3c`) | ✅ Да (order от 2026-03-28) | Активен до 2026-12-23 | `granted` или `extended` (зависит от логики syncEntitlement: expires_at = GREATEST(текущий, новый)) |
| 8 остальных | ❌ Нет paid orders | — | `skipped_by_condition` × 8 |

**Уточнение по entitlement ЦБ 2.0:** Если `syncEntitlement` вычислит новый `expires_at` ≤ текущего (2026-12-23), entitlement **не изменится** (GREATEST-логика). Ledger зафиксирует факт обработки правила. Это корректный результат — entitlement уже в правильном состоянии.

### EXECUTE
Вызвать EF `grant-access-for-order` с `orderId = 'ddfaeb9c-0cdb-4c1b-b6ed-6963911aa3a9'`.

### VERIFY
1. Ledger: 9 записей — 1 `granted`/`extended` + 8 `skipped_by_condition`
2. Entitlement ЦБ 2.0: `expires_at` ≥ 2026-12-23 (без уменьшения)
3. Нет дублей entitlement для ЦБ 2.0
4. Audit log зафиксирован

### DoD (Вариант A)
- Правило `product_access` ретроактивно обработано для заказа `ddfaeb9c`
- Ledger зафиксировал результат для всех 9 целевых продуктов (1 granted/extended + 8 skipped)
- Entitlement приведён в корректное состояние без дублей
- Нет побочных эффектов на другие entitlements клиента

---

## Вариант B: Системное решение (batch)

**Scope:** Только активные подписки с tariff_id, для которого существуют активные правила `product_access` с `condition_type = prior_purchase`.

### Архитектура
- Новая admin EF `retroactive-apply-product-access-rules`
- Принимает `rule_id` (опционально — для конкретного правила) или обрабатывает все активные правила
- Находит все активные подписки по `product_id + tariff_id` правила
- Для каждой подписки находит последний paid order
- Вызывает **существующую** `grant-access-for-order` (не cross-domain логика, а reuse каноническогоEF)
- Идемпотентность: повторный запуск не создаёт дублей — `syncEntitlement` и ledger dedup обеспечивают это

### Аудит
- `audit_logs`: batch-запись с `batch_id`, `affected_count`, `skipped_count`
- Каждый вызов `grant-access-for-order` самостоятельно пишет в ledger

### Безопасность
- Dry-run режим по умолчанию (`dry_run: true`)
- Limit на количество обрабатываемых подписок
- Только через admin auth

---

## Вариант C: Авто-триггер при создании правила

**Архитектура (event-driven, не UI):**
- При INSERT в `access_rules` с `grant_target_type = product_access` — database trigger или domain event
- Backend ставит задачу в очередь (напр. `domain_events` с `event_type = 'access_rule_created'`)
- Обработчик (EF или cron) подхватывает задачу и запускает batch-процесс из Варианта B
- UI только создаёт правило; вся бизнес-логика — на backend

**Это отдельная задача**, реализуется после Варианта B.

---

## Порядок реализации

1. **Сейчас:** Вариант A — починить конкретного клиента
2. **Следующий шаг:** Вариант B — batch EF для всех затронутых подписок
3. **Потом:** Вариант C — event-driven авто-применение

## Затрагиваемые файлы

| Компонент | Вариант A | Вариант B | Вариант C |
|---|---|---|---|
| Код | 0 изменений | Новая EF `retroactive-apply-product-access-rules` | DB trigger + event handler |
| Данные | Вызов существующей EF | — | — |
| Аудит | Через существующую EF | batch audit_log | — |
