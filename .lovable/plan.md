## План: ACCESS-RULES-SOT-UNIFICATION — удаление всех альтернативных путей выдачи доступа

**Финальная цель спринта:**
«После спринта в системе существует только один путь принятия решений по доступам: access_rules → access-resolver → executor. Все остальные пути удалены или отключены.»

---

### Главное правило спринта (SoT)

**Единственный источник истины по выдаче доступов и видимости контента — правила на странице продукта (`access_rules`) + ID-связи (`product_id`, `tariff_id`, `offer_id`, `order_id`, `training_module_id`).**

Запрещено:
- hardcode по `product_code`, `slug`, `name`, `description`
- отдельные скрытые правила в edge functions
- repair-функции со своей бизнес-логикой
- любые fallback-ветки, которых нет в правилах продукта
- легализация active access словами "историческая покупка", "legacy", "когда-то покупал"
- решения по `product_code` в write-side для grant/update/upsert (кроме записи в snapshot/meta для чтения человеком)

Все runtime-решения — только по ID. Текст допустим только для отображения в UI.

### Default-deny для cb20

- У всех active доступ к cb20 считается **запрещённым по умолчанию**
- Доступ может появиться **только если это прямо следует из действующего access_rule**
- legacy/import/export/getcourse/history сами по себе **никогда** не являются основанием для active access

---

### Обнаруженные параллельные decision paths (для удаления)

| # | Файл | Строки | Что делает | Почему запрещено |
|---|-------|--------|------------|-----------------|
| 1 | `grant-access-for-order/index.ts` | L867-878 | legacy fallback к `product_club_mappings` | решение не из access_rules |
| 2 | `grant-access-for-order/index.ts` | L1138 | lookup secondary entitlement по `product_code` | решение по коду, не по ID |
| 3 | `grant-access-for-order/index.ts` | L1072-1106 | inline scope_resolution_mode determination | собственная бизнес-логика вне resolver |
| 4 | `_shared/entitlement-sync.ts` | L18-33 | hardcoded FALLBACK sets | решение по коду, не из БД |
| 5 | `_shared/entitlement-sync.ts` | L62-66 | fallback к hardcoded sets | обход DB lookup |
| 6 | `repair-cb20-entitlements/index.ts` | вся функция | собственная bucket/action модель | параллельная бизнес-логика |
| 7 | `useTrainingContentRules.ts` | L233-388 | synthetic rules из `entitlement.meta` | допустимы только как детерминированная проекция канонического grant result |

---

### Блок 0: ACCESS-RULES-SOT GAP AUDIT (read-only)

Полная матрица всех мест, где доступ выдаётся / определяется не из `access_rules`.

**Артефакт:** `runtime_access_paths_matrix.csv`
Колонки: `component`, `file`, `lines`, `layer`, `current_decision_source`, `uses_access_rules`, `uses_product_id`, `uses_name_or_code`, `verdict`, `must_be_removed`

**DoD:** список всех decision paths с вердиктом: keep / remove / redirect_to_resolver.

---

### Блок 1: CB20 — принудительная нормализация относительно правил продукта

Цель: **все текущие active cb20 должны быть пересобраны относительно правил продукта; всё, что не объясняется правилом, считается invalid и идёт в repair-list на выключение/исправление.**

Для каждого active cb20 entitlement:
- какое именно `access_rule_id` разрешает этот доступ
- через какой order/subscription/tariff это правило сработало
- если правило не найдено — доступ ошибочный → repair-list

**Артефакты:**
- `cb20_business_rule_audit.csv` — все active cb20, для каждого: `access_rule_id` или `NO_RULE_FOUND`
- `cb20_invalid_active_access.csv` — полный repair-list (все, кого нельзя объяснить правилом)
- `cb20_business_crosscheck_matrix.csv` — cross-check всех related users

**DoD:** нет ни одного active cb20, который нельзя объяснить действующим правилом продукта.

---

### Блок 1.1: DEFAULT CLOSED FOR CB20

Отдельный обязательный proof:
- без срабатывания правила продукта active cb20 нет ни у кого
- historical/import/export/getcourse legacy access не считается валидным основанием сам по себе
- дата экспорта/импорта не порождает current active access
- любые старые "размазанные" сроки доступа из legacy пересчитаны или выключены, если не подтверждаются правилами продукта

---

### Блок 2: MODULE ACCESS VISIBILITY CHAIN (14/14)

Полная цепочка: `order → product_id → entitlement → access_rule_id → training_rule_id → target_root_module_id → allowed_module_ids → visibility`

**Артефакт:** `module_access_visibility_chain_14_14.csv`

---

### Блок 3: CLEANUP TAIL AUDIT

**Артефакт:** `grant_access_tail_cleanup_audit.csv`

---

### Блок 4: GLOBAL INTEGRITY AUDIT

**Артефакт:** `order_based_only_global_integrity_audit.csv`

---

### Блок 5: cee45419 FINAL PROOF

**Артефакт:** `grant_access_primary_entitlement_proof_cee45419.csv`

---

### EXECUTE 1: Единый access resolver

**Новый файл:** `supabase/functions/_shared/access-resolver.ts`

Единый resolver, который по `{ order_id, product_id, tariff_id, user_id }` возвращает:
- какие `access_rules` применимы
- primary grant (exact product_id)
- secondary grants (club, product_access, training_content — все из resolver output, с `access_rule_id`)
- training_content filters
- blocked_reasons

Все lookups по ID. Никаких решений по code/name/slug.

---

### EXECUTE 2: grant-access-for-order — executor, не decision-maker

Функция не должна решать "что выдать". Она должна:
1. Загрузить сущности по ID
2. Вызвать resolver
3. Исполнить результат (primary + все secondary из resolver output)
4. Записать proof, какое именно `access_rule_id` сработало
5. Hard fail, если primary grant не создан

Функция **не должна сама вычислять secondary grants** (club, product_access, training_content). Все приходят из resolver.

Запрет: функция не должна решать "что выдать" на основании кода продукта, исторической покупки, клуба, текста описания и т.п.

Конкретные удаления:
- **L867-878**: убрать legacy fallback к `product_club_mappings`
- **L1138**: заменить `product_code` lookup на `product_id`
- **L1072-1106**: перенести scope_resolution_mode в resolver
- Все secondary grants — только из resolver output

---

### EXECUTE 3: repair-cb20-entitlements — mechanical executor или отключение

**В этом спринте функция должна быть переведена в mechanical executor repair-list или отключена из runtime.**

Нельзя оставлять в подвешенном состоянии как ещё один параллельный мозг. Собственной логики buckets/action у неё остаться не должно.

---

### EXECUTE 4: Удалить hardcoded fallback sets

**Файл:** `supabase/functions/_shared/entitlement-sync.ts`

Удалить `FALLBACK_SUBSCRIPTION_BASED_CODES`, `FALLBACK_ORDER_BASED_ONLY_CODES`, `FALLBACK_LEGACY_SKIP_CODES`.
Удалить fallback к этим sets.
Оставить ТОЛЬКО DB lookup через `products_v2.entitlement_mode`.

**После удаления fallback-set'ов должен быть hard fail, если `products_v2.entitlement_mode` не заполнен.** Нельзя оставлять мягкое поведение, где система снова начнёт догадываться.

---

### EXECUTE 5: Удалить все оставшиеся запрещённые пути

- убрать runtime fallback к `product_club_mappings`
- убрать hardcoded code sets
- убрать text matching по description/title
- убрать secondary/grant lookup по `product_code` где решение должно идти по `product_id`
- убрать любые hidden branches, которых нет в правилах продукта

---

### EXECUTE 6: Запретить решения по product_code в write-side

Запретить любые решения по `product_code` в write-side для grant/update/upsert, кроме случаев, где это чисто технический дублирующий атрибут уже найденного по `product_id` продукта:
- поиск/lookup/upsert/decision — только по `product_id`
- `product_code` можно только записывать в snapshot/meta для чтения человеком

---

### EXECUTE 7: Runtime visibility = канонические access_rules

Runtime должен исполнять только канонические access_rules, а UI страницы "Доступы" является редактором этих правил и proof-представлением, но не отдельным вторым источником логики.

После спринта недопустимо:
- в UI правило выключено, а runtime всё равно выдаёт доступ
- в UI правила нет, а runtime показывает контент
- в UI одно, а repair/grant делают другое

Synthetic rules в `useTrainingContentRules.ts` допустимы только если они являются **детерминированной проекцией канонического grant result**, записанного resolver'ом. Если там есть хоть одно самостоятельное решение о доступе — это запрещённый path и должен быть удалён.

---

### EXECUTE 8: Repair active cb20 по итогам dry-run

По итогам Блока 1 (cb20 audit):
1. Построить repair-list из всех invalid active cb20
2. Dry-run: показать, что именно будет выключено/укорочено/пересоздано
3. Execute только по этому repair-list
4. Proof after: подтвердить, что все invalid cb20 исправлены

**Артефакт:** `cb20_repair_execute_plan.csv`
Колонки: `user_id`, `entitlement_id`, `current_state`, `violated_rule`, `planned_action`, `expected_final_state`

---

### Обязательные итоговые артефакты

1. `runtime_access_paths_matrix.csv`
2. `cb20_business_rule_audit.csv`
3. `cb20_invalid_active_access.csv`
4. `cb20_business_crosscheck_matrix.csv`
5. `module_access_visibility_chain_14_14.csv`
6. `grant_access_tail_cleanup_audit.csv`
7. `order_based_only_global_integrity_audit.csv`
8. `grant_access_primary_entitlement_proof_cee45419.csv`
9. `access_decision_paths_removed.csv` — колонки: `old_path`, `file`, `why_forbidden`, `removed_or_redirected_to`, `final_resolver_path`
10. `access_rules_sot_mapping.csv` — колонки: `access_rule_id`, `product_id`, `tariff_id`, `grant_target_type`, `used_by_resolver`, `used_by_runtime_visibility`, `used_by_grant_executor`, `orphan_rule`, `notes`
11. `cb20_repair_execute_plan.csv` — колонки: `user_id`, `entitlement_id`, `current_state`, `violated_rule`, `planned_action`, `expected_final_state`

---

### Обязательный финальный proof

5-10 контрольных кейсов от начала до конца:

| product rule in UI | exact IDs | order/subscription | entitlement created | visibility result | proof: решение из правила продукта |

---

### Файлы для изменения

1. `supabase/functions/_shared/access-resolver.ts` — НОВЫЙ
2. `supabase/functions/grant-access-for-order/index.ts` — рефакторинг на resolver
3. `supabase/functions/repair-cb20-entitlements/index.ts` — mechanical executor или отключение
4. `supabase/functions/_shared/entitlement-sync.ts` — убрать hardcoded sets, hard fail без entitlement_mode

### Что НЕ изменяется

- `cb_module_ip` не трогать
- revoke не делать без отдельного repair-list
- training tree структуру не менять
- bepaid-webhook напрямую не принимает бизнес-решения по доступу; если для полного удаления параллельных path потребуется минимальная правка его вызова/контракта с resolver, это допустимо

---

### STOP-guards

1. Если после спринта остаётся хоть один decision path, который выдаёт доступ не из `access_rules` — спринт не выполнен, даже если отдельные баги исправлены
2. Немедленный STOP если найден active access, который нельзя объяснить через `access_rules`
3. Немедленный STOP если grant path принимает решение не по ID и не по rule resolver
4. Нельзя выпускать execute, если после него остаётся параллельный decision path
5. **Если хоть одна legacy функция остаётся способной записать entitlement/subscription/access без ссылки на `access_rule_id` или resolver result, спринт не выполнен**

---

### DoD

1. Единый `access-resolver.ts` существует и используется всеми grant/repair paths
2. `grant-access-for-order` не решает сам — только исполняет resolver
3. `repair-cb20-entitlements` не содержит собственной бизнес-модели (mechanical executor или отключена)
4. 0 hardcoded code sets в runtime
5. 0 legacy fallback к `product_club_mappings`
6. Secondary grants lookup по `product_id`, не `product_code`
7. Hard fail в entitlement-sync если `entitlement_mode` не заполнен
8. **Нет ни одного active cb20, который нельзя объяснить действующим правилом продукта**
9. **Нет ни одного active cb20, возникшего только из legacy/import/export/history**
10. **После execute нет ни одного active cb20 вне правил продукта**
11. **После execute нет ни одной функции, которая может выдать доступ, не вызвав resolver**
12. **Нет ни одного runtime access path вне access_rules**
13. **Все решения по доступам принимаются только по ID и правилам продукта**
14. 14/14 visibility chain подтверждена через правила продукта
15. Tail cleanup: 0 мусора или repair-list
16. **Подрядчик показывает список всех удалённых параллельных правил** (`access_decision_paths_removed.csv`)
17. **Подрядчик показывает 5-10 контрольных кейсов product→rule→grant→visibility**
18. 11 артефактов в `/mnt/documents/`

---

**Финальная цель спринта:**
«После спринта в системе существует только один путь принятия решений по доступам: access_rules → access-resolver → executor. Все остальные пути удалены или отключены.»
