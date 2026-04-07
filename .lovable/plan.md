## да, согласен, с учетом правок:

&nbsp;

1. Не требовать в FINAL-2, чтобы по всем 3 кейсам на **1-м вызове** обязательно что-то создавалось. Эти order уже использовались в предыдущем runtime-proof, поэтому сейчас главный критерий — **2-й вызов ничего не меняет**. Для уже “затроганных” кейсов достаточно доказать:
  &nbsp;
  - текущее состояние до вызова,
  - состояние после 1-го вызова,
  - состояние после 2-го вызова,
  - после 1-го и 2-го вызова нет повторного продления / дублирования / новых side effects.
  &nbsp;
2. В idempotency guard проверку делать не только по meta.extended_by_orders, но и по связке:
  &nbsp;
  - entitlement.order_id = currentOrderId
  - subscription.order_id = currentOrderId
  - subscription.meta.extended_by_orders contains currentOrderId
  - при наличии bonus grants — не создавать их повторно, если текущий orderId уже был обработан
    То есть фикс должен закрывать **всю цепочку**, а не только продление subscription.
  &nbsp;
3. Для subscription-based кейсов в DoD явно добавить:
  &nbsp;
  - access_end_at после 2-го вызова = **строго** равно значению после 1-го вызова;
  - количество active subscriptions по user+product не увеличивается;
  - количество entitlements по order_id не увеличивается;
  - bonus entitlements не дублируются.
  &nbsp;
4. В runtime_proof_results.csv добавить отдельное поле:
  &nbsp;
  - second_call_side_effects = none|subscription_extended|entitlement_duplicated|bonus_duplicated|other
    Чтобы в финале не было расплывчатого “PASS”, а был явный технический verdict.
  &nbsp;
5. В runtime_proof_sql_snapshots.csv добавить отдельные строки по:
  &nbsp;
  - active_subscriptions_user_product
  - active_entitlements_user_product
  - entitlements_by_order_id
  - bonus_entitlements_by_order_id
    Это нужно, чтобы idempotency была доказана числами, а не только общим count.
  &nbsp;
6. Статус Edge root-fix (active paths) менять на ✅ закрыт только если:
  &nbsp;
  - кейс 85a99b74 больше не продлевает подписку;
  - все 3 кейса дают second_call_side_effects = none;
  - grep-proof остаётся зелёным.
  &nbsp;
7. Финальный отчёт не раздувать. После выполнения дать только:
  &nbsp;
  - что исправлено в guard,
  - результат 3 runtime cases,
  - закрыт ли Edge root-fix (active paths),
  - одна строка: **«Патч закрыт. Массовый backfill и legacy discovery не входили в данный патч.»**
  &nbsp;
8. Никаких новых discovery и новых тестовых order не добавлять. Закрыть на текущих 3 кейсах и завершить патч.

&nbsp;

&nbsp;

План: FINAL-1 + FINAL-2 — фикс идемпотентности grant-access-for-order и повторный runtime-proof

---

### Диагноз бага

**Корень проблемы** найден в `supabase/functions/grant-access-for-order/index.ts`, строки 154-208.

Идемпотентность guard проверяет условие:

```
entitlementMatchesProduct && subscriptionMatchesProduct
```

Где `subscriptionMatchesProduct` ищет подписку по `.eq("order_id", orderId)`. Но в ветке **extend** (строки 465-572), когда уже существует активная подписка для user+product, функция **обновляет** эту подписку (меняет `access_end_at`), но **не записывает** текущий `orderId` в поле `order_id` подписки — он остаётся от оригинального заказа. `orderId` попадает только в `meta.extended_by_orders[]`.

Результат: на 2-м вызове guard ищет подписку по `order_id = currentOrderId` → не находит (подписка хранит старый `order_id`) → guard не срабатывает → подписка продлевается повторно.

Подтверждение по данным:

- Order `85a99b74` → entitlement `934499af` (order_id=85a99b74 ✓)
- Подписка `acfec84e` создана 2026-02-27 с order_id=85a99b74 (status=expired)
- Подписка `7c2ee454` создана 2026-04-07 с order_id=85a99b74, extended_by=["85a99b74"] — это результат 2-го вызова, который продлил подписку вместо skip

---

### EXECUTE FINAL-1: фикс идемпотентности

**Файл:** `supabase/functions/grant-access-for-order/index.ts`

**Изменение:** расширить idempotency guard (строки 154-208), добавив дополнительную проверку: если подписка не найдена по `order_id`, проверить `meta->'extended_by_orders'` на содержание текущего `orderId`.

Новая логика guard:

```
1. existingEntByOrder = entitlement WHERE order_id=orderId AND user_id=userId
2. existingSubByOrder = subscription WHERE order_id=orderId AND user_id=userId
3. НОВОЕ: если existingSubByOrder = null, проверить:
   existingSubExtendedByOrder = subscription WHERE user_id=userId 
     AND product_id=productId 
     AND meta->'extended_by_orders' содержит orderId
4. Guard fires если entitlementMatchesProduct AND (subscriptionMatchesProduct OR subscriptionExtendedByOrder)
```

Это покрывает оба сценария:

- Подписка СОЗДАНА с этим order_id → найдена по п.2
- Подписка РАСШИРЕНА этим order_id → найдена по п.3

**Что НЕ меняется:**

- Весь остальной код функции
- Логика extend/create subscription
- Логика entitlement upsert
- Bonus grants, telegram, getcourse

---

### EXECUTE FINAL-2: повторный runtime-proof 3 кейсов

**STOP-guard перед тестом:** 

- Не брать order, если уже есть active entitlement на тот же product_id от другого источника
- Не брать order из legacy/manual path
- Не брать order участвующий в открытом расследовании

**3 кейса (без новых):**

1. `df29304d` — order-based content
2. `85a99b74` — subscription + bonus
3. `bbeb3ea6` — subscription pure

**Before/after пакет по каждому кейсу:**


| Метрика                  | before | after 1st call | after 2nd call          |
| ------------------------ | ------ | -------------- | ----------------------- |
| subscriptions count      | X      | X or X+1       | = after 1st             |
| entitlements count       | X      | X or X+1       | = after 1st             |
| access_end_at            | T      | T'             | = T' (без изменений)    |
| bonus entitlements count | X      | X or X+N       | = after 1st             |
| audit_logs count         | X      | X+N            | X+N+1 (только skip log) |


**DoD 2-го вызова:** 0 изменений по всем 5 метрикам (кроме +1 audit log с action `skip_already_fulfilled`).

**Артефакты для обновления:**

- `runtime_proof_results.csv` — колонки: order_id, product_id, product_code, user_id, path_under_test, before_entitlements_count, after_first_call_count, after_second_call_count, created_subscription_id, created_entitlement_id, audit_log_present, idempotency_verdict, final_verdict
- `runtime_proof_sql_snapshots.csv` — before/after SQL numbers по каждому кейсу
- `write_paths_root_fix_status.csv` — добавить поля: runtime_proof_completed, runtime_proof_cases_count, active_path_closed
- `.lovable/plan.md` — обновить статус Edge root-fix (active paths) на ✅

---

### Порядок исполнения

1. Патч idempotency guard в `grant-access-for-order/index.ts`
2. Deploy
3. Runtime-proof: 3 кейса × 2 вызова каждый, before/after SQL snapshots
4. Обновить артефакты и plan.md

### Финальные статусы после патча


| Этап                         | Статус                   |
| ---------------------------- | ------------------------ |
| UI root-fix                  | ✅ закрыт                 |
| Edge root-fix (active paths) | ✅ закрыт (после proof)   |
| Legacy reconcile path        | ⚠️ intentional exception |
| Backfill                     | ❌ не входит в этот патч  |


### Границы патча

- Этот патч допускает точечное создание entitlements как часть runtime-proof
- Это **не** backfill
- Массовый repair 230 harmful victims — только отдельным спринтом
- Никаких новых discovery, victim-count, legacy analysis

Финальная формулировка: «Патч закрыт. Массовый backfill и legacy discovery не входили в данный патч.»

### Файлы для изменения

- `supabase/functions/grant-access-for-order/index.ts` — расширить idempotency guard
- `.lovable/plan.md` — обновить статусы
- `/mnt/documents/runtime_proof_results.csv` — пересоздать
- `/mnt/documents/runtime_proof_sql_snapshots.csv` — пересоздать  
- `/mnt/documents/write_paths_root_fix_status.csv` — добавить runtime-proof поля

### Объём

Код: ~20 строк в одном файле. Документация + артефакты. Никаких изменений в других edge functions или UI.