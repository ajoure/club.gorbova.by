# да, согласен, с учетом правок:

&nbsp;

1. В corrected summary обязательно явно раздели две независимые группы:
  &nbsp;
  - **subscription-based gap** = 156 missing matching entitlements для active subscriptions
  - **order-based gap** = 193 по ЦБ 2.0
    Чтобы в следующих шагах не смешивались подписочные и курсовые кейсы в одну цифру 349 без контекста.
  &nbsp;
2. В блоке про unique constraints допиши практическое правило execute:
  &nbsp;
  - основной ON CONFLICT = (user_id, product_code)
  - product_id и order_id заполнять обязательно
  - перед execute отдельным dry-run проверить, нет ли кейсов, где один и тот же user_id + product_code уже связан с другим product_id или другим order_id.
  &nbsp;
3. По **ЦБ 2 ступень** отдельно зафиксируй anomaly:
  &nbsp;
  - active subscriptions идут по product_code = prd_0d01a2fdc477
  - лишние active entitlements без subscription идут по cb_2_step
    Это нужно вынести в root cause как отдельную проблему **product_code drift / legacy code mismatch**, а не просто в общую таблицу рассинхрона.
  &nbsp;
4. В Additional table B добавь колонку:
  &nbsp;
  - mismatch_type
    со значениями вроде:
  - entitlement_without_subscription
  - legacy_product_code_mismatch
  - manual_or_unknown_entitlement
    Это пригодится для следующего cleanup-патча.
  &nbsp;
5. Для **Gorbova Club** в corrected plan зафиксируй:
  &nbsp;
  - 7 = реальный execute-candidate gap
  - 3 active entitlements без active subscription не трогаем в v23.1.9B
    То есть явно показать, что обратный рассинхрон не входит в execute scope.
  &nbsp;
6. В Additional table C не утверждай заранее UPDATE = 0 как окончательный факт.
  Лучше формулировка:
  &nbsp;
  - expected_insert_or_update_preview
    Пока не показан pre-execute preview по конкретным ключам user_id + product_code, безопаснее считать это предварительной оценкой, а не финальным guarantee.
  &nbsp;
7. Добавь ещё один обязательный pre-execute deliverable:
  &nbsp;
  - **conflict_preview_on_unique_keys**
    со столбцами:
  - user_id
  - product_code
  - existing_entitlement_id
  - existing_status
  - existing_expires_at
  - planned_action (insert / update / skip)
    Без этой таблицы v23.1.9B лучше не запускать.
  &nbsp;
8. В corrected wording про 156 из 403 добавь, что это считается на уровне:
  &nbsp;
  - **matching by same user_id + product_code**
    чтобы не возвращаться потом к вопросу “по какому ключу считали gap”.
  &nbsp;
9. В итоговом corrected summary лучше уже сейчас переписать headline так:
  &nbsp;
  - не “все creation paths сломаны”,
  - а:
    **“creation paths системно не покрывают все случаи matching entitlements; текущий confirmed gap = 156 active subscription pairs + 193 order-based CB20 cases.”**
    Это точнее и не конфликтует с тем, что 247 matching entitlements всё же существуют.
  &nbsp;
10. После этих правок можно переходить к короткому финальному pre-execute check, а не сразу к full execute.
  Следующий шаг логичнее оформить как:

&nbsp;

&nbsp;

&nbsp;

- **v23.1.9A.1-final — execute preview / unique-key conflict preview**
  и только потом утверждать v23.1.9B.

&nbsp;

&nbsp;

В остальном корректировка сильная: главное исправление — цифра **156 вместо ложных 403** — критично и сделано правильно.

&nbsp;

План: PATCH v23.1.9A — Исправления перед approve v23.1.9B

## Статус: 4 обязательных правки + 3 дополнительных таблицы

---

## Правка 1: Исправить формулировку "0 из 403 active subs"

### Проблема

В текущем plan.md написано: "Все 403 активных подписки в системе не имеют entitlements" и "0 из 403 active subs имеют entitlements". **Это фактически неверно.**

### Фактические данные (подтверждены запросом)

Из 403 active subscription records (user x product пар):

- **247** (61%) ИМЕЮТ matching active entitlement (same user_id + same product_code)
- **156** (39%) НЕ ИМЕЮТ matching active entitlement

### Правильная формулировка

> "156 из 403 активных подписок (user x product пар) не имеют matching active entitlement по тому же user_id + product_code. 247 подписок уже корректно покрыты entitlements."

### Исправлённая таблица по продуктам


| Продукт                | active_subs | subs С entitlement | subs БЕЗ entitlement | gap % |
| ---------------------- | ----------- | ------------------ | -------------------- | ----- |
| Gorbova Club           | 149         | **142**            | **7**                | 5%    |
| ЦБ 2 ступень           | 89          | **63**             | **26**               | 29%   |
| ЗАКРОЙ ГОД             | 63          | **9**              | **54**               | 86%   |
| ЦБ 2.0: Учет у ИП      | 59          | **0**              | **59**               | 100%  |
| Бухгалтерия как бизнес | 32          | **30**             | **2**                | 6%    |
| Подоходный налог ИП    | 9           | **1**              | **8**                | 89%   |
| **Итого**              | **401**     | **245**            | **156**              | 39%   |


**Gorbova Club**: НЕ полная рассинхронизация. 142 подписчика уже имеют active entitlement. Gap — только 7 пользователей.

### Пересчёт READY_FOR_BACKFILL

Это кардинально меняет expected counts:


| Продукт              | Было в плане | Реально gap (sub-based) | Order-based gap                       |
| -------------------- | ------------ | ----------------------- | ------------------------------------- |
| Gorbova Club         | 148          | **7**                   | —                                     |
| ЦБ 2 ступень         | 89           | **26**                  | —                                     |
| ЗАКРОЙ ГОД           | 64           | **54**                  | —                                     |
| ЦБ 2.0: Учет у ИП    | 59           | **59**                  | —                                     |
| Бухгалтерия          | 33           | **2**                   | —                                     |
| Подоходный налог ИП  | 9            | **8**                   | —                                     |
| Ценный бухгалтер 2.0 | 193          | —                       | **193** (0 entitlements, order-based) |
| **Итого sub-based**  | &nbsp;       | **156**                 | &nbsp;                                |
| **Итого с ЦБ 2.0**   | &nbsp;       | &nbsp;                  | **349**                               |


---

## Правка 2: Исправить ключ upsert

### Проблема

В STOP-guards написано: "upsert по user_id + product_id". Но реальный unique constraint другой.

### Фактические данные (подтверждены запросом)

Таблица `entitlements` имеет **3 unique constraint**:


| Constraint                                           | Тип                           |
| ---------------------------------------------------- | ----------------------------- |
| `(user_id, product_code)`                            | **Основной**, всегда enforced |
| `(user_id, product_id) WHERE product_id IS NOT NULL` | Partial unique                |
| `(order_id) WHERE order_id IS NOT NULL`              | Partial unique                |


### Правильная формулировка

> Upsert ДОЛЖЕН идти по `ON CONFLICT (user_id, product_code)` — это единственный полный unique constraint. При этом `product_id` тоже должен заполняться (partial unique защитит от ошибок). `order_id` для backfill-записей заполняется canonical_order_id (partial unique на order_id не позволит привязать несколько entitlements к одному order).

---

## Правка 3: Разделить source_snapshot_type и import_source

### Проблема

В CANONICAL_ORDER_CANDIDATES колонка `source_snapshot_type = "patch4_import"` смешивает тип покупки и источник импорта.

### Правильное разделение


| Поле                   | Значение                                                                       | Смысл                                                       |
| ---------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `source_snapshot_type` | `base_tariff_purchase` / `module_child_purchase` / `module_only_standalone`    | Тип покупки из `purchase_snapshot.historical_purchase_type` |
| `import_source`        | `patch4_import` / `getcourse_historical` / `admin_from_payment` / `bulk_grant` | Откуда пришёл заказ (reconcile_source / batch_id)           |


Для ЦБ 2.0 canonical candidates: `source_snapshot_type = "base_tariff_purchase"`, `import_source = "patch4_import"`.

---

## Правка 4: Сузить DUPLICATE_CLEANUP_REVIEW

### Проблема

Сейчас в DUPLICATE_CLEANUP_REVIEW включены и блокирующие, и уже классифицированные неблокирующие кейсы (91 user из ЦБ 2.0 с canonical уже выбранным).

### Правильное разделение

#### Блокирующие (мешают execute)


| Продукт               | Users  | problem_type            | blocked_backfill_reason   |
| --------------------- | ------ | ----------------------- | ------------------------- |
| ЗАКРОЙ ГОД            | 20     | multi_different_periods | ambiguous_canonical_order |
| ЦБ 2.0                | 3      | missing_tariff          | missing_tariff            |
| **Итого блокирующих** | **23** | &nbsp;                  | &nbsp;                    |


#### Неблокирующие (canonical определён, в discovery summary)


| Продукт               | Users | problem_type          | Статус                                    |
| --------------------- | ----- | --------------------- | ----------------------------------------- |
| ЦБ 2.0 (same_tariff)  | 19    | batch_duplicate       | canonical определён, не блокирует         |
| ЦБ 2.0 (diff_tariffs) | 5     | possible_upgrade      | canonical = max access_days, не блокирует |
| ЦБ 2.0 (mixed)        | 67    | mixed_base_and_module | canonical = best tariff, не блокирует     |


Неблокирующие выносятся из DUPLICATE_CLEANUP_REVIEW в отдельную секцию "Classified duplicates (resolved)".

---

## Дополнительная таблица A: matching_active_subscriptions_without_matching_entitlement


| Продукт                | product_code       | active_subs_without_ent | sample_user_ids     |
| ---------------------- | ------------------ | ----------------------- | ------------------- |
| ЦБ 2.0: Учет у ИП      | cb_module_ip       | 59                      | (первые 3 из query) |
| ЗАКРОЙ ГОД             | course_close_year  | 54                      | (первые 3 из query) |
| ЦБ 2 ступень           | prd_0d01a2fdc477   | 26                      | (первые 3 из query) |
| Подоходный налог ИП    | 1769009596189-398a | 8                       | (первые 3 из query) |
| Gorbova Club           | club               | 7                       | (первые 3 из query) |
| Бухгалтерия как бизнес | buh_business       | 2                       | (первые 3 из query) |
| **Итого**              | &nbsp;             | **156**                 | &nbsp;              |


## Дополнительная таблица B: existing_active_entitlements_without_matching_active_subscription

Фактические данные:


| product_code       | active_ents | ents_с_sub | ents_БЕЗ_sub |
| ------------------ | ----------- | ---------- | ------------ |
| club               | 145         | 142        | **3**        |
| prd_0d01a2fdc477   | 63          | 63         | 0            |
| buh_business       | 30          | 30         | 0            |
| course_close_year  | 11          | 9          | **2**        |
| cb_2_step          | 8           | 0          | **8**        |
| 1769009596189-398a | 1           | 1          | 0            |
| consultation       | 1           | 0          | **1**        |


Обратная рассинхронизация: **14 active entitlements** у пользователей без active subscription. Из них 8 по `cb_2_step` (другой product_code, чем `prd_0d01a2fdc477` у ЦБ 2 ступень — возможно legacy code).

## Дополнительная таблица C: READY_FOR_BACKFILL sample + expected counts


| Продукт                | expected_INSERT | expected_UPDATE | expected_SKIP | sample_user (access_end_at)    |
| ---------------------- | --------------- | --------------- | ------------- | ------------------------------ |
| ЦБ 2.0: Учет у ИП      | 59              | 0               | 0             | (из query)                     |
| ЗАКРОЙ ГОД             | 54              | 0               | 0             | 2026-03-31 – 2026-04-01        |
| ЦБ 2 ступень           | 26              | 0               | 0             | 2026-08-30                     |
| Подоходный налог ИП    | 8               | 0               | 0             | 2026-06-25                     |
| Gorbova Club           | 7               | 0               | 0             | 2026-04-03 – 2026-12-30        |
| Бухгалтерия как бизнес | 2               | 0               | 0             | 2026-03-31 – 2026-05-01        |
| Ценный бухгалтер 2.0   | 193             | 0               | 0             | order.created_at + access_days |
| **Итого**              | **349**         | **0**           | **0**         | &nbsp;                         |


---

## Изменяемые компоненты


| Компонент          | Изменение                 |
| ------------------ | ------------------------- |
| `.lovable/plan.md` | 4 правки + 3 доп. таблицы |


Код и данные НЕ меняются.

## DoD

1. Формулировка "0 из 403" исправлена на фактические 156 из 403
2. Upsert key зафиксирован как `(user_id, product_code)` с учётом всех 3 unique constraints
3. `source_snapshot_type` отделён от `import_source`
4. DUPLICATE_CLEANUP_REVIEW разделён на блокирующие (23) и неблокирующие (91, resolved)
5. 3 дополнительных таблицы добавлены
6. Expected counts пересчитаны: 349 INSERT вместо 595
7. Gorbova Club gap = 7 (не 148)