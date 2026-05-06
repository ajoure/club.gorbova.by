## да, согласен, с учетом правок:

1. В шаге 1 исправить термин:
  - не `grant_target_type='training_module'`;
  - правильно проверять `access_rules.grant_target_type='training_content'`.
2. В proof обязательно разделить **3 разных уровня видимости**:
  - `entitlement exists` — доступ как право;
  - `training_content resolver visible` — продукт/модуль должен появиться в библиотеке;
  - `UI filter visible` — реально отображается при текущем фильтре «Незавершённые».
3. По ПВТ и Строительству отдельно проверить не только `access_rules`, но и наличие `training_modules`:
  - есть ли root/module `training_modules.product_id = product_id`;
  - есть ли уроки/visible lessons;
  - не скрывает ли карточку `computeVisibleRecursiveLessonCount = 0`.
4. Для каждого продукта добавить итоговую классификацию:
  - `VISIBLE_BY_ACCESS`;
  - `HIDDEN_BY_RESOLVER`;
  - `HIDDEN_BY_NO_LESSONS`;
  - `HIDDEN_BY_UI_FILTER`;
  - `NOT_TRAINING_PRODUCT`.
5. Для Gorbova Club и ZG явно указать:
  - это training-продукт или нет;
  - должен ли он вообще появляться в «Моя библиотека»;
  - если нет — не считать это багом access-resolver.
6. По `historical_module_product_ids=[]` не делать вывод заранее, что именно это ломает ПВТ/Строительство. В proof сначала доказать:
  - есть ли DB-rule;
  - какой rule_source выбирает resolver;
  - есть ли visible lessons;
  - только после этого фиксировать root cause.
7. В audit_logs искать не только по `entity_id`, но и по meta:

```sql
meta->>'order_id'
meta->>'entitlement_id'
meta->>'product_id'
meta->>'tariff_id'
target_user_id
```

8. В proof добавить отдельный блок **«не выполнялось»**:
  - no UPDATE / INSERT / DELETE;
  - no grant/revoke/replay;
  - no resolver/writer/UI changes;
  - no entitlement repair.
9. В рекомендации следующей задачи не предлагать сразу data-fix. Сначала разделить:
  - если проблема writer — отдельный patch `grant-access-for-order admin_grant meta.tariff_id`;
  - если проблема resolver — отдельный patch `training_content resolver product/module visibility`;
  - если проблема UI-фильтра — отдельный patch по фильтрам библиотеки;
  - если проблема отсутствия уроков — content/data task, не access task.
10. Названия разделов и артефактов оставить без внутренних product code/slug. Только:

- `product_id`;
- `product_name`;
- `tariff_id`;
- `entitlement_id`;
- `training_module_id`.

Итоговый approve: можно выполнять **read-only диагностику** и создать `.lovable/proofs/finassist_access_resolver_diagnostic_2026_05.md`.

&nbsp;

Диагностика: [finassist.by@gmail.com](mailto:finassist.by@gmail.com) — orders ≠ access ≠ training

**Скоуп:** только proof-диагностика. Никаких write. Если нужны исправления — отдельная задача с approve.

**Цель:** объяснить, почему не все купленные продукты появляются в «Моя библиотека», и где именно ломается цепочка `orders_v2 → grant-access-for-order → entitlements → training-content-resolver → UI`.

---

### Что уже известно (из БД, без правок)

`user_id = a832c11e-1715-4646-bfcb-859fff931a0e`

**orders_v2 (paid, релевантные):**


| order_number     | product_id | product_name                | tariff_id  | source      |
| ---------------- | ---------- | --------------------------- | ---------- | ----------- |
| GIFT-26-MOSCKHKU | `ea98d043` | Учет у ИП                   | `5d6b73f3` | admin_grant |
| GIFT-26-MOSCJXYW | `f833c846` | Строительство               | `cbc9a3a2` | admin_grant |
| GIFT-26-MOSCJLRV | `abee24cd` | Розничная торговля          | `0f5183d8` | admin_grant |
| GIFT-26-MOSCJ3ZB | `064dd768` | Производство                | `c12acda3` | admin_grant |
| GIFT-26-MOSCIYVC | `99f1f156` | ПВТ                         | `7f69656c` | admin_grant |
| GIFT-26-MOSCIKFF | `9187db54` | Общепит                     | `c31bf65f` | admin_grant |
| GIFT-26-MOSCIB2B | `64d9f812` | Грузо/пасс. перевозки       | `2c84e74c` | admin_grant |
| GC-3811270       | `7101ed3c` | ЦБ | 1 ступень 2.0 (parent) | `9bc81736` | (legacy)    |
| SUB-* (×4)       | `11c9f1b8` | Gorbova Club                | `7c748940` | bepaid      |
| MIG-ZG-ROW-150   | `73c29914` | (ZG)                        | `56c35e86` | migration   |


**entitlements (12, все active):**


| product                  | mode              | tariff_id (в meta) | hist_ids       | repaired     |
| ------------------------ | ----------------- | ------------------ | -------------- | ------------ |
| `7101ed3c` ЦБ parent     | full              | `9bc81736`         | `[d7effaf4]` ⚠ | —            |
| `d7effaf4` Маркетплейсы  | module_scope_only | —                  | `[4c97d21c]`   | ✅ 2026-05-06 |
| `99f1f156` ПВТ           | full              | `7f69656c`         | `[]`           | —            |
| `f833c846` Строительство | full              | `cbc9a3a2`         | `[]`           | —            |
| `ea98d043` Учет у ИП     | full              | `5d6b73f3`         | —              | —            |
| `064dd768` Производство  | full              | **NULL** ⚠         | **NULL** ⚠     | —            |
| `64d9f812` Грузо         | full              | **NULL** ⚠         | **NULL** ⚠     | —            |
| `9187db54` Общепит       | full              | **NULL** ⚠         | **NULL** ⚠     | —            |
| `abee24cd` Розница       | full              | **NULL** ⚠         | **NULL** ⚠     | —            |
| `4fc18564` Подоходный    | full              | —                  | `[]`           | —            |
| `c153c811` Деньги BY     | (null mode)       | —                  | —              | —            |
| `11c9f1b8` Gorbova Club  | (null mode)       | —                  | —              | —            |


**На скриншоте «Моя библиотека» (9 видимых строк):** Деньги BY, Подоходный, ЦБ parent, Грузо, Маркетплейсы, Общепит, Производство, Розница, Учёт у ИП. **Нет:** ПВТ (`99f1f156`), Строительство (`f833c846`), Gorbova Club как карточки тренинга, ZG (`73c29914`).

---

### Сразу видимые аномалии (требуют доказательной верификации)

**A. 4 admin_grant entitlements потеряли `meta.tariff_id`.**
Производство / Грузо / Общепит / Розница — `mode=full_tariff_scope`, но `meta.tariff_id IS NULL`. По правилу `Training Content Resolver Rules` это попадает под P4.5 `admin_grant_full_fallback`. Они на скриншоте видны → P4.5 фактически срабатывает.

**B. ПВТ (`99f1f156`) и Строительство (`f833c846`) НЕ видны.**
У них `tariff_id` есть, но `historical_module_product_ids=[]` (пустой массив). Это, вероятно, ломает P1/P2 матч: резолвер ищет `tariff_id` в `access_rules`, а если правил нет — падает в `rule_unresolved` (default-deny). При этом 4 модуля без tariff_id проходят через P4.5 — поэтому они видны, а ПВТ/Строительство — нет.

**C. ЦБ parent `7101ed3c` имеет `historical_module_product_ids=[d7effaf4]`.**
Это кросс-ссылка с дочерним продуктом Маркетплейсы. Семантически странно (родитель ссылается на один из модулей). Не блокер, но требует комментария в proof.

**D. Сделок 8 свежих (7 GIFT + ЦБ parent), entitlements для них существуют, но 4 — без `meta.tariff_id`.**
Гипотеза: `grant-access-for-order` для GIFT-orders писал entitlement, но не пробросил `tariff_id` в `meta` (или эти 4 entitlements созданы старым writer'ом до правки P4.5). Проверяется по `entitlements.created_at` vs `orders_v2.created_at`.

---

### Шаги диагностики (read-only)

1. **Сводка orders ↔ entitlements ↔ rules.**
  Для каждого продукта: order_id, order tariff_id, entitlement tariff_id, наличие `access_rules` для (product_id, tariff_id) с `grant_target_type='training_module'`.
2. **Поднять `useTrainingContentRules` / `access-resolver` (read code).**
  Зафиксировать, какой приоритет (P1..P4.5..P5) даёт visibility для каждого из 12 entitlements. Без правок.
3. **Runtime resolver-симуляция.**
  Для каждого entitlement запустить SQL-симуляцию резолвера (или edge call read-only) и записать `rule_source`, `matched_rule_id`, `allowed_module_count`. Сверить с UI-наблюдением «9 видимых».
4. **Свериться, что entitlements 4 модулей (064dd768/64d9f812/9187db54/abee24cd) реально пришли через `grant-access-for-order` от admin_grant orders.**
  Проверка `entitlements.created_at` ≈ `orders_v2.created_at` + аудит `audit_logs` (action='access_granted' или аналог) с order_id 7 GIFT-сделок.
5. **Аудит `audit_logs` за 2026-05-05 08:07–08:09** для этого user_id: какие writer-вызовы реально были, какие `meta` они писали, есть ли `skip_extend_tariff_mismatch`, `recurring_snapshot_fallback_used`, `admin_grant_full_fallback`.
6. **Тестовый кейс P4.5.**
  Подтвердить (без write), что для `entitlement` без `tariff_id` и без `historical_module_product_ids` resolver выдаёт full visibility у соответствующего тренинга. Если выдаёт — почему 4 видны, а ПВТ/Строительство (которые наоборот, имеют tariff_id) — нет.

---

### Артефакт

Один proof-файл:

`.lovable/proofs/finassist_access_resolver_diagnostic_2026_05.md`

Содержит:

1. Таблицу orders_v2 (полную, по uuid).
2. Таблицу entitlements (полную).
3. Mapping order ↔ entitlement (по product_id+tariff_id; пометка `MISSING tariff_id in entitlement`).
4. Для каждого entitlement — результат resolver-симуляции: `rule_source`, `matched_rule_id`, `allowed_module_count`, `expected_visible: yes/no`.
5. Таблицу «UI ожидает vs UI показывает» (по 9 видимым на скриншоте + что не показано).
6. Список конкретных гипотез root cause:
  - H1: `grant-access-for-order` теряет `meta.tariff_id` для admin_grant orders (для 4 модулей).
  - H2: P1/P2 в `useTrainingContentRules` падает в `rule_unresolved`, когда `historical_module_product_ids=[]` и нет `access_rules` под (product_id, tariff_id) → ПВТ/Строительство default-deny.
  - H3: Какая-то часть карточек скрыта frontend-фильтром «Незавершённые» (на скриншоте этот фильтр включён) — это **не** проблема access, а UI-фильтра. Проверить unfiltered.
7. **Ничего не предлагается фиксить в этом proof.** Только classification гипотез + рекомендация: какую из них чинить отдельной задачей и какой канонический writer/code path трогать.

---

### Технические детали

- Все запросы — `supabase--read_query` + `code--view` для resolver-кода.
- `audit_logs` смотрим по `entity_id IN (order_ids)` и по `actor_id = user_id`.
- Если потребуется resolver runtime — `supabase--curl_edge_functions` на read-only edge (если такой есть; иначе только SQL-симуляция).
- Используем только UUID + `product_name` (правило `no-product-code-in-new-artifacts`).

### DoD

- proof-файл создан, содержит 7 разделов выше.
- В proof нет запрещённых product code/slug (`rg` gate exit=1).
- Чёткий список из ≤3 ранжированных root-cause гипотез с указанием конкретных entitlement_id / order_id, на которые ссылаемся.
- Рекомендация по следующей задаче (какой fix, на какой write-path), но **без выполнения**.
- Никаких write в БД, никаких правок resolver/writers/UI в этой задаче.