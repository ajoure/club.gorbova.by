
# CONSOLIDATED PATCH — cb20 / BUSINESS / runtime / lesson count / multi-product training bindings / rule conflicts

## Корневой статус системы (Discovery)

### Что уже работает
- Write-side: `grant-access-for-order` пишет enriched meta (scope_resolution_mode, historical_*, business_subscription_id)
- Read-side: `useTrainingContentRules.ts` генерирует synthetic rules из entitlement.meta
- Sidebar/modules: product-linked модули используют entitlement-only path (module_access исключён)
- Recursive lesson count реализован в `useTrainingModules.tsx`
- SoT для срока: `MAX(access_end_at)` из `active + past_due`

### Что НЕ работает / не закрыто
1. **Привязка тренингов**: `training_modules.product_id` = single FK → один модуль = один продукт. Нет many-to-many. UI предлагает только "перепривязать" (MOVE), а не "добавить второй продукт".
2. **Conflict detection**: Простое группирование по `target_type:target_ref` — любые 2+ правила на одну цель = "конфликт". Не различает валидную множественность (разные тарифы) от реального конфликта.
3. **Self-rules**: 3 правила где `product_id == target_ref` (продукт выдаёт доступ сам себе). Потенциально создают бессрочные entitlements (duration_days=NULL).
4. **Batch repair**: Existing cb20 entitlements не нормализованы по meta и сроку.
5. **Runtime proof**: Нет end-to-end proof по 4 user classes.
6. **cb20 child modules**: Все 36 children имеют product_id = cb20 root product. Standalone module products НЕ привязаны к training_modules (они существуют только как коммерческие маркеры в orders_v2.purchase_snapshot).

### Архитектурное решение по привязке тренингов

**Ключевой вопрос**: нужна ли новая bridge-таблица `product_training_bindings`?

**Ответ: НЕТ**, можно решить через `access_rules` + UI-рефакторинг:

- `training_modules.product_id` остаётся как primary label/owner (для cascading, lesson count, sidebar)
- Доступ от **других** продуктов к тому же дереву определяется через `access_rules` с `grant_target_type = 'training_content'`
- В текущей модели cb20 это уже работает: child modules все принадлежат cb20 product, а standalone module products — это коммерческие product_ids из orders_v2, которые маппятся через `historical_module_product_ids → training_modules WHERE product_id IN (...)`
- Новая таблица создаёт risk дублирования SoT и усложняет cascading

**Что нужно сделать**: не менять DB-схему, а исправить UI и conflict detection.

---

## Фазы исполнения

### PHASE A — Discovery proof-пакет (read-only SQL)

1. **Join-path proof**: `subscriptions_v2.user_id → profiles.id → orders_v2.profile_id` vs `orders_v2.user_id`
2. **Historical purchase validity matrix** по всем historical типам для cb20
3. **Target products reality check** — 9 target products из rule 1b497fba
4. **Training binding model reality check** — где в коде зашит 1:1 constraint
5. **Rule conflict matrix** — все training_content rules с classification
6. **Legacy read-path matrix** — все места чтения module_access
7. **Self-rules impact analysis** (1ba0aac9, daa796bf, e151c8da)

### PHASE B — Conflict detection refactor

**Файл**: `src/components/admin/product/ProductAccessRulesTab.tsx` (строки 372-382)

Текущая логика:
```
// Groups by grant_target_type:target_ref → any 2+ = "conflict"
```

Заменить на классификацию:
- `valid_parallel_rule` — разные tariff_id на один target (нормально, приоритет по priority)
- `duplicate_rule` — одинаковый product + tariff + target + scope
- `ambiguous_overlap` — разный scope без детерминированного приоритета
- `shadowed_rule` — правило которое никогда не выиграет по приоритету

UI: показывать warning только для `duplicate_rule` и `ambiguous_overlap`. Для `valid_parallel_rule` показывать info badge "N правил для разных тарифов".

### PHASE C — Multi-product training binding UI

**Файлы**: 
- `src/components/admin/product/ProductLinkedTrainingsBlock.tsx`
- `src/hooks/useProductTrainings.ts`

Текущее ограничение — не на уровне DB (нет UNIQUE), а на уровне UI/логики:
- `bindTraining` → UPDATE SET product_id = pid (перезаписывает)
- Bind dialog: если тренинг привязан к другому продукту → предлагает "перепривязать" (MOVE)

Что сделать:
1. В bind dialog добавить опцию **"Использовать через правило доступа"** для тренингов уже привязанных к другому продукту (вместо rebind)
2. Это создаст `access_rule` с `grant_target_type = 'training_content'` и `target_ref = training_id`
3. Показать usage info: какие продукты уже используют этот training (через product_id + access_rules)
4. Показать impact preview перед действием

### PHASE D — BUSINESS cb20 runtime resolver completion

**Файл**: `src/hooks/useTrainingContentRules.ts`

Текущий `resolveBonusScopeRules` работает корректно по коду, но нужен proof:
1. Убедиться что `module_scope_only` реально маппит historical_module_product_ids → training_module_ids
2. Убедиться что `no_scope` / `manual_review` реально блокирует доступ
3. Убедиться что entitlements БЕЗ meta (legacy) не получают full access по умолчанию

**Проблема**: legacy entitlements без meta → `scopedEnts` filter отсеивает их → НЕТ synthetic rule → `resolveTrainingContentFilter` возвращает null → **full access по умолчанию**. Это ОПАСНО.

**Фикс**: для product-linked entitlements БЕЗ scope_resolution_mode, если нет matching DB rule, вернуть `no_scope` (safe default) вместо null.

### PHASE E — Duration/meta normalization

**Файл**: `supabase/functions/grant-access-for-order/index.ts`

Уже реализовано: align_with_source, enriched meta. Нужно:
1. Расширить на repair existing entitlements (не только create)
2. Для existing entitlements без meta → repair_metadata_only bucket

### PHASE F — Batch repair dry-run + execute

Новый edge function или SQL script:

**Action buckets** (6):
- create, align_to_business, repair_metadata_only, repair_metadata_and_align, noop, manual_review

**Scope buckets** (5):
- full_tariff_scope, module_scope_only, union_scope, no_scope, manual_review

**STOP-guards**:
- staff @ajoure.by → skip
- mapping confidence < high → manual_review  
- standalone_only с неподтверждённым mapping → manual_review

### PHASE G — "0 уроков" proof + fix

Уже реализован recursive count. Нужен proof по 4 user classes:
- base_only → full_tariff_scope → все модули видны
- base+standalone → union_scope → все модули видны  
- standalone_only → module_scope_only → только купленные модули
- no_cb_purchase → no_scope → root скрыт

### PHASE H — Self-rules audit

3 self-rules (product grants itself):
- `1ba0aac9` (ЦБ 2 ступень) — product_id == target_ref, duration_days=NULL
- `daa796bf` (ЗАКРОЙ ГОД) — product_id == target_ref, duration_days=NULL
- `e151c8da` (ЦБ модуль Грузоперевозки) — product_id == target_ref, duration_days=NULL

**Анализ**: при покупке продукта grant-access-for-order УЖЕ создаёт entitlement в строках 226-280. Self-rule вызывается ПОВТОРНО в product_access секции (строки 715+) и создаёт ВТОРОЙ entitlement или обновляет существующий с `expires_at = align_with_source(NULL)`.

**Решение**: деактивировать self-rules (они дублируют базовую логику) ИЛИ оставить с пометкой, если есть кейсы где они нужны. Показать impact analysis.

### PHASE I — Legacy module_access final decision

Уже исправлено в `useSidebarModules.ts` и `useTrainingModules.tsx`. Нужно:
1. Финальный audit всех остальных read-paths
2. Зафиксировать решение: module_access = secondary fallback ТОЛЬКО для модулей без product_id
3. Для cb20 product-linked path module_access полностью исключён

### PHASE J — Документация

Обновлять после каждой фазы. Машинно-проверяемые таблицы:
1. Historical purchase validity matrix
2. Target products reality check  
3. BUSINESS → historical type → effective scope
4. Module product → training subtree mapping with confidence
5. Rule conflict classification matrix
6. Legacy read-path audit matrix

---

## Порядок исполнения

```text
1. PHASE A — Discovery (read-only, SQL proof)
2. PHASE B — Conflict detection refactor (UI only)
3. PHASE C — Multi-product training binding UI
4. PHASE D — Runtime resolver completion (critical fix for legacy entitlements without meta)
5. PHASE E — Duration/meta normalization
6. PHASE F — Batch repair (dry-run → approve → execute)
7. PHASE G — "0 уроков" proof
8. PHASE H — Self-rules audit
9. PHASE I — Legacy path final decision
10. PHASE J — Documentation
```

**STOP-guards**: Execute (Phase F) запрещён до полного proof read-side (Phase D) и runtime proof (Phase G).

---

## Файлы для изменения

| Файл | Фаза | Что меняется |
|---|---|---|
| `src/components/admin/product/ProductAccessRulesTab.tsx` | B | Conflict classification вместо простого группирования |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | C | Опция "использовать через правило" для already-bound trainings |
| `src/hooks/useProductTrainings.ts` | C | Usage info для тренингов (какие продукты ссылаются) |
| `src/hooks/useTrainingContentRules.ts` | D | Safe default для legacy entitlements без meta |
| `supabase/functions/grant-access-for-order/index.ts` | E | Repair mode для existing entitlements |

---

## DoD (18 пунктов из задания + 6 дополнительных)

1-18: Все пункты из исходного DoD сохраняются без изменений.

Дополнительные:
19. Канонический join-path доказан и не создаёт ложных совпадений
20. Existing cb20 entitlements нормализованы по meta-трассировке
21. Legacy entitlements без meta получают safe default (no_scope), а не full access
22. Self-rules объяснены и impact analysis проведён
23. Conflict detection различает valid_parallel_rule от реального конфликта
24. Multi-product binding через access_rules вместо перезаписи product_id
