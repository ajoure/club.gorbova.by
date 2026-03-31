# да, согласен, с учетом правок:

&nbsp;

1. В canonical_order_candidates добавь ещё поле source_snapshot_type, чтобы было видно, из какого типа исторической покупки выбран canonical order:
  &nbsp;
  - base_tariff_purchase
  - module_child_purchase
  - module_only_standalone
  - и т.д.
  &nbsp;
2. Для **ЦБ 2.0** в READY_FOR_BACKFILL прямо зафиксируй, что туда могут попадать только пары, где canonical order выбран из base_tariff_purchase.
  module_child_purchase и module_only_standalone в основной backfill по cb20 не включать.
3. Для **ЗАКРОЙ ГОД** в dry-run отчёте по grouping key добавь отдельное поле same_batch_same_tariff_same_amount, чтобы сразу было видно, какие batch-группы выглядят как чистые технические дубли.
4. В DUPLICATE_CLEANUP_REVIEW добавь поле blocked_backfill_reason, чтобы для каждого кандидата было понятно, что именно мешает execute:
  &nbsp;
  - missing_tariff
  - ambiguous_canonical_order
  - mixed_purchase_types
  - batch_duplicates_not_resolved
  - и т.д.
  &nbsp;
5. В E2E pipeline proof отдельно покажи, какие creation paths сейчас продолжают создавать gap:
  &nbsp;
  - admin_from_payment
  - batch imports
  - и есть ли ещё другие живые пути помимо этих двух.
  &nbsp;
6. В финальном deliverable добавь короткий сводный вывод по каждому продукту в формате:
  &nbsp;
  - ready now
  - ready partially
  - blocked
    чтобы следующий проход сразу был про approve/execute, без повторной аналитики.
  &nbsp;

&nbsp;

&nbsp;

В остальном план правильный: сначала canonical/de-dup discovery, потом только v23.1.9B execute.

&nbsp;

План: PATCH v23.1.9A (финальная версия) — Gap discovery + Canonical order selection + Pipeline verification

## Статус: план на утверждение

## Цель

Полная discovery-фаза перед historical entitlement backfill: gap analysis, duplicate/installment classification, canonical order selection, root cause, policy matrix. **Без execute.**

---

## Структура


| Блок           | Содержание                                                       |
| -------------- | ---------------------------------------------------------------- |
| **v23.1.9A.1** | Entitlement gap discovery (без изменений от предыдущего плана)   |
| **v23.1.9A.2** | Duplicate/installment deal discovery + canonical order selection |
| **v23.1.9A.3** | Root cause + policy matrix                                       |
| **v23.1.9A.4** | 5 итоговых списков                                               |


---

## v23.1.9A.2 — Duplicate/installment deal discovery (обновлённый)

### ЦБ 2.0: правила канонической покупки

**Каноническая покупка для основного entitlement** определяется **только среди `base_tariff_purchase**`. Типы `module_child_purchase` и `module_only_standalone` **не участвуют** в расчёте основного entitlement.

#### Upgrade policy (ЦБ 2.0)

- Несколько `base_tariff_purchase` с **разными** тарифами у одного пользователя — **не дубль по умолчанию**, а вероятный апгрейд.
- Каноническая покупка = `base_tariff_purchase` с **максимальным `access_days**` (Бизнес-леди 270 > Главный бухгалтер 180 > Бухгалтер 90). При равном `access_days` — самая поздняя по `created_at`.
- Более ранние `base_tariff_purchase` помечаются как `leave_as_is` или `exclude_from_backfill`, но **не как дубли** без явного доказательства идентичности (тариф + дата + сумма + batch).

#### Мини-итог по ЦБ 2.0 (обязательный deliverable)

- Можно ли уже делать backfill: да/нет
- Что именно блокирует (если нет)
- Сколько пользователей реально ready после очистки дублей
- Сколько остаются в `DUPLICATE_CLEANUP_REVIEW`

### ЗАКРОЙ ГОД: grouping key + dry-run

**Grouping key для одной логической покупки:**

- Если batch есть: `profile_id + product_id + batch_id`
- Если batch нет: `profile_id + product_id` + эвристика по периоду/выпуску (разнос дат > 60 дней = отдельная покупка)

**Dry-run обязан показать для каждой группы** (а не просто «первая сделка по created_at»):

- earliest order (id, created_at, amount, tariff)
- latest order (id, created_at, amount, tariff)
- число дублей в batch
- совпадают ли tariff / amount / metadata между сделками в группе

Каноническая сделка утверждается **только после** этого dry-run, а не заранее.

#### Мини-итог по ЗАКРОЙ ГОД (обязательный deliverable)

- Можно ли уже делать backfill: да/нет
- Что именно блокирует
- Сколько пользователей реально ready после очистки дублей

### Подоходный налог ИП

**Явный вывод:**

- Duplicate discovery completed: no duplicate pattern found (0 пользователей с 2+ сделками)
- Продукт не блокирует backfill по причине дублей
- Остаётся в общем policy matrix (policy по expires_at решается отдельно)

---

## Duplicate cleanup policy matrix (обновлённый)


| Продукт             | Допустимы ли повторные | Определение «одной покупки»                | Лишний дубль                                                | Что нельзя удалять                           | Действие по дублям    | **canonical_order_selection_rule**                                           |
| ------------------- | ---------------------- | ------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| ЦБ 2.0              | Да (module/upgrade)    | `base_tariff_purchase` с max `access_days` | Несколько base с одинаковым тарифом + датой + batch         | module_child, module_only, единственный base | exclude_from_backfill | max(access_days) среди base_tariff_purchase, при равенстве — max(created_at) |
| ЗАКРОЙ ГОД          | Да (разные периоды)    | `profile_id + product_id + batch_id`       | Несколько paid orders из одного batch у одного пользователя | Первую сделку из группы, органические        | exclude_from_backfill | После dry-run: по совпадению tariff/amount/meta внутри группы                |
| Подоходный налог ИП | N/A (0 дублей)         | Единственный order                         | —                                                           | —                                            | leave_as_is           | Единственный paid order                                                      |


---

## v23.1.9A.3 — Root cause (дополненный)

К ранее зафиксированным причинам добавить:

> Исторические импорты смешали главные покупки, модульные покупки и batch-дубли в одном контуре orders_v2, поэтому backfill нельзя строить только от `count(paid orders)`. Каждый order должен быть классифицирован, и только каноническая сделка используется для расчёта `expires_at`.

**Policy matrix зависит от cleanup discovery**: сначала каноническая сделка → потом `expires_at` → потом backfill.

---

## v23.1.9A.4 — 5 итоговых списков


| #   | Список                         | Содержание                                                                                                                                         |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **READY_FOR_BACKFILL**         | Пары `user_id × product_id × canonical_order_id` (не продукт целиком). Внутри одного продукта часть пользователей может быть ready, а часть — нет. |
| 2   | **NEED_POLICY_DECISION**       | Продукт/пользователи, где не определена policy по expires_at (напр. ЦБ 2.0 без tariff_id)                                                          |
| 3   | **DO_NOT_BACKFILL**            | Бывшие подписчики, expired access, нет тренингов                                                                                                   |
| 4   | **DUPLICATE_CLEANUP_REVIEW**   | С указанием типа проблемы: `batch_duplicate`, `possible_upgrade`, `possible_installment`, `mixed_base_and_module_purchases`, `missing_tariff`      |
| 5   | **CANONICAL_ORDER_CANDIDATES** | user_id, product_id, canonical_order_id, canonical_reason, duplicate_count, cleanup_action                                                         |


---

## Deliverables v23.1.9A (полный список)

1. Entitlement gap discovery (продуктовый реестр + разбивка gap users по 5 категориям)
2. Duplicate deal discovery по ЦБ 2.0, ЗАКРОЙ ГОД, Подоходный налог ИП
3. Upgrade policy для ЦБ 2.0
4. Grouping key dry-run для ЗАКРОЙ ГОД
5. Duplicate cleanup policy matrix с `canonical_order_selection_rule`
6. Root cause analysis (дополненный)
7. Policy matrix по expires_at (с зависимостью от cleanup)
8. **canonical_order_candidates** (user_id, product_id, canonical_order_id, canonical_reason, duplicate_count, cleanup_action)
9. 5 итоговых списков
10. Мини-итоги по ЦБ 2.0 и ЗАКРОЙ ГОД (ready/blocked/count)
11. E2E pipeline proof (read-only)

---

## Что НЕ выполняется в v23.1.9A

- Архивирование
- Удаление
- Merge
- Rewrite orders/subscriptions
- Entitlement backfill
- Изменение кода
- Изменение access_rules, grant-access-for-order, training read/write path

**Только**: discovery, classification, canonical selection.

---

## STOP-guards для v23.1.9B


| Guard                                                                     | Правило                          |
| ------------------------------------------------------------------------- | -------------------------------- |
| Таблица `canonical_order_candidates` не утверждена → execute запрещён     | Обязательно                      |
| Список `DUPLICATE_CLEANUP_REVIEW` не утверждён → execute запрещён         | Обязательно                      |
| По продукту не завершена классификация дублей → backfill по нему запрещён | Особенно для ЦБ 2.0 и ЗАКРОЙ ГОД |
| ROW_COUNT per product ≠ expected → STOP                                   | Обязательно                      |


---

## Последовательность патчей


| Патч         | Scope                                                               |
| ------------ | ------------------------------------------------------------------- |
| **v23.1.9A** | Discovery + classification + canonical selection (этот патч)        |
| **v23.1.9B** | Execute backfill только по утверждённому canonical_order_candidates |
| **v23.1.10** | Fix root cause в creation paths (admin_from_payment, batch imports) |


---

## Изменяемые компоненты


| Компонент          | Изменение                |
| ------------------ | ------------------------ |
| `.lovable/plan.md` | Обновление статуса патча |


Код и данные **не меняются**.

## DoD

1. Entitlement gap discovery — полный продуктовый реестр
2. Duplicate deal discovery по 3 продуктам — завершён
3. Upgrade policy для ЦБ 2.0 — зафиксирована
4. Grouping key + dry-run для ЗАКРОЙ ГОД — выполнен
5. Подоходный налог ИП — duplicate discovery completed, no pattern found
6. Duplicate cleanup policy matrix с canonical_order_selection_rule — готова
7. canonical_order_candidates — собран
8. Root cause дополнен (batch import дубли + смешение типов покупок)
9. 5 итоговых списков — готовы
10. Мини-итоги по ЦБ 2.0 и ЗАКРОЙ ГОД — даны
11. E2E pipeline proof — собран
12. В v23.1.9A не выполнено ни одного write-действия