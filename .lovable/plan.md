да, согласен, с учетом правок:

&nbsp;

1. Исправь блокировку по порядку фаз.  
Сейчас у тебя снова есть логическая петля:  
Execute (Phase F) запрещён до Phase D + G proof.  
Это неверно, потому что PHASE G — это уже post-execute proof.  
Нужно так:  

  - Execute PHASE F запрещён до: PHASE A proof approved + PHASE D deployed + PHASE E deployed + PHASE F dry-run approved
  - PHASE G = post-execute runtime/UI proof
2. &nbsp;
3. PHASE C пометь как non-blocking follow-up, а не как часть критического пути до batch repair.  
Для текущего BUSINESS → cb20 блокера сначала важны:  

  - PHASE A
  - PHASE D
  - PHASE E
  - PHASE F
  - PHASE G  
  А multi-product binding UI можно выполнять после этого, если discovery не покажет, что без него repair невозможен.
4. &nbsp;
5. В PHASE D уточни safe default для legacy entitlements без meta.  
Нельзя формулировать это как общий safe default = no_scope для всех entitlements без meta.  
Нужно явно разделить:  

  - bonus entitlement без historical/tariff context → safe default = no_scope
  - прямой cb20 purchase с валидным order/subscription/tariff context → scope восстанавливается из этого контекста, а не падает в no_scope
6. &nbsp;
7. В PHASE E закрепи, что repair existing entitlements идёт по двум осям одновременно:  

  - срок: expires_at ↔ business_effective_end_at
  - meta: historical_purchase_type, scope_resolution_mode, business_subscription_id, historical_tariff_id, historical_module_product_ids
8.   
Отдельно допиши правило:  

  - entitlement без обязательной meta не может идти в noop, даже если срок случайно совпадает
9. &nbsp;
10. В PHASE F dry-run должен показывать не только totals по action buckets и scope buckets, а матрицу пересечений:  

  - строки: create / align_to_business / repair_metadata_only / repair_metadata_and_align / noop / manual_review
  - колонки: full_tariff_scope / module_scope_only / union_scope / no_scope / manual_review
11. &nbsp;
12. В PHASE F добавь обязательный post-check блок после execute:  

  - business_users_total
  - cb20_bonus_entitlements_total
  - normalized_meta_total
  - expires_mismatch_remaining
  - manual_review_remaining
  - standalone_only_with_module_scope_only
  - standalone_only_with_full_scope
13.   
Последний показатель должен быть 0.
14. В PHASE G пропиши три обязательных конечных состояния UI/runtime:  

  - no_access
  - has_access_but_zero_visible_lessons
  - has_access_and_visible_lessons
15.   
Root не должен маскировать no_access под «0 уроков».
16. В PHASE I зафиксируй жёстко:  

  - для cb20 product-linked path module_access исключается из baseAccess
  - допустим только как fallback для модулей без product_id
  - текущий OR-path нельзя оставлять без явного приоритета
17. &nbsp;
18. В PHASE J уточни, что документация обновляется не только “после каждой фазы” в общем виде, а минимум в трёх контрольных точках:  

  - после PHASE A — полный discovery snapshot
  - после PHASE F execute — batch repair proof snapshot
  - после PHASE G — runtime/UI proof snapshot
19. &nbsp;
20. В DoD добавь ещё 4 жёстких критерия:

&nbsp;

&nbsp;

&nbsp;

- standalone_only -> full access = 0 кейсов
- cb20 bonus entitlement without scope_resolution_mode = 0
- cb20 bonus entitlement without business_subscription_id = 0
- module_access больше не влияет на cb20 product-linked runtime path, кроме явно документированного fallback для модулей без product_id

&nbsp;

&nbsp;

&nbsp;

11. В конце плана добавь отдельный блок Go/No-Go для execute Phase F:

&nbsp;

&nbsp;

&nbsp;

- YES только если:  

  - join-path доказан
  - historical classification завершена
  - Variant B зафиксирован как целевая логика
  - runtime safe default исправлен
  - alignment logic deployed
  - dry-run matrix approved
- &nbsp;
- иначе только discovery/manual_review, без массовой выдачи

&nbsp;

&nbsp;

&nbsp;

12. Не убирай из плана, а явно сохрани как незакрытые хвосты до proof:

&nbsp;

&nbsp;

&nbsp;

- duration_days=NULL legacy risk
- self-rules impact
- module_list_mapped -> training subtree confidence
- actor/system proof по batch
- runtime proof по 4 user classes

&nbsp;

&nbsp;

После этих правок план можно считать финальным для [lovable.dev](http://lovable.dev).

&nbsp;

&nbsp;

# План: CONSOLIDATED PATCH — cb20 / BUSINESS / runtime / lesson count / multi-product training bindings / rule conflicts

## Корневой статус системы (Discovery)

### Что уже работает

- Write-side: `grant-access-for-order` пишет enriched meta (scope_resolution_mode, historical_*, business_subscription_id)
- Read-side: `useTrainingContentRules.ts` генерирует synthetic rules из entitlement.meta
- Sidebar/modules: product-linked модули используют entitlement-only path (module_access исключён)
- Recursive lesson count реализован в `useTrainingModules.tsx`
- SoT для срока: `MAX(access_end_at)` из `active + past_due`

### Что НЕ работает / не закрыто

1. **Привязка тренингов**: `training_modules.product_id` = single FK → один модуль = один продукт. Нет many-to-many. UI предлагает только "перепривязать" (MOVE), а не "добавить второй продукт".
2. **Conflict detection**: Простое группирование по `target_type:target_ref` — любые 2+ правила на одну цель = "конфликт". Не различает валидную множественность от реального конфликта.
3. **Self-rules**: 3 правила где `product_id == target_ref` (продукт выдаёт доступ сам себе, duration_days=NULL). Дублируют базовую выдачу entitlement.
4. **Batch repair**: Existing cb20 entitlements не нормализованы по meta и сроку.
5. **Runtime proof**: Нет end-to-end proof по 4 user classes.
6. **КРИТИЧЕСКИЙ БАГ**: Legacy entitlements без meta → synthetic rule НЕ генерируется → `resolveTrainingContentFilter` возвращает null → **full access по умолчанию**. Bonus entitlement cb20 без tariff context получает полный доступ.

### Архитектурное решение по привязке тренингов

**Новая bridge-таблица НЕ нужна.** Обоснование:

- DB уже поддерживает many-to-one (нет UNIQUE на `training_modules.product_id`)
- `access_rules` с `grant_target_type = 'training_content'` уже служит мостом между продуктом и тренингом
- Для cb20: child modules принадлежат root product, standalone module products — коммерческие маркеры в orders_v2
- Новая таблица создаёт risk дублирования SoT

**Решение**: `training_modules.product_id` = primary owner. Доступ от других продуктов через `access_rules`. UI рефакторинг для поддержки этого паттерна.

---

## Фазы исполнения

### PHASE A — Discovery proof-пакет (read-only SQL)

Собрать и показать:

1. Join-path proof: `subscriptions_v2.user_id → profiles.id → orders_v2.profile_id`
2. Historical purchase validity matrix по cb20
3. Target products reality check — 9 target products из rule 1b497fba
4. Training binding model reality check
5. Rule conflict matrix с classification
6. Legacy read-path matrix
7. Self-rules impact analysis (1ba0aac9, daa796bf, e151c8da)
8. Business effective end source of truth proof

### PHASE B — Conflict detection refactor

**Файл**: `src/components/admin/product/ProductAccessRulesTab.tsx` (строки 372-382)

Заменить простое группирование на классификацию:

- `valid_parallel_rule` — разные tariff_id (нормально)
- `duplicate_rule` — одинаковый product + tariff + target + scope
- `ambiguous_overlap` — неоднозначный приоритет
- `shadowed_rule` — правило которое никогда не выиграет

UI: warning только для duplicate/ambiguous. Info badge для valid parallel.

### PHASE C — Multi-product training binding UI

**Файлы**: `ProductLinkedTrainingsBlock.tsx`, `useProductTrainings.ts`

1. В bind dialog для тренингов привязанных к другому продукту: добавить опцию "Использовать через правило доступа" (создаёт access_rule вместо rebind)
2. Usage info: какие продукты используют этот training (через product_id + access_rules)
3. Impact preview перед действием

### PHASE D — Runtime resolver: критический фикс

**Файл**: `src/hooks/useTrainingContentRules.ts`

**Баг**: legacy entitlements без meta → нет synthetic rule → full access по умолчанию.

**Фикс**: в `resolveBonusScopeRules` обработать entitlements БЕЗ `scope_resolution_mode`:

- Если entitlement для product-linked training, и нет matching DB rule, и нет meta → вернуть safe default `no_scope` вместо null

### PHASE E — Duration/meta alignment

**Файл**: `grant-access-for-order/index.ts`

Уже реализовано для create. Расширить на repair existing entitlements:

- Если entitlement без обязательной meta → repair_metadata_only
- Если expires_at не совпадает с business_effective_end_at → repair_metadata_and_align

### PHASE F — Batch repair

6 action buckets: create, align_to_business, repair_metadata_only, repair_metadata_and_align, noop, manual_review

5 scope buckets: full_tariff_scope, module_scope_only, union_scope, no_scope, manual_review

Dry-run → approve → execute. STOP-guards: staff skip, mapping confidence < high → manual_review.

### PHASE G — "0 уроков" proof

Proof по 4 user classes: что в БД → scope_resolution_mode → effective scope → visible modules → lesson count → UI result.

### PHASE H — Self-rules audit

3 self-rules дублируют базовую выдачу entitlement (grant-access-for-order строки 226-280). Impact analysis → decision: deactivate или keep с документированным обоснованием.

### PHASE I — Legacy module_access final decision

Зафиксировать: module_access = fallback ТОЛЬКО для модулей без product_id. Для cb20 path полностью исключён.

### PHASE J — Документация после каждой фазы

Машинно-проверяемые таблицы: historical matrix, target products, scope matrix, module mapping, conflict matrix, legacy audit.

---

## Порядок исполнения

```text
1. PHASE A — Discovery proof (read-only)
2. PHASE D — Runtime resolver critical fix (блокер для всего остального)
3. PHASE B — Conflict detection refactor
4. PHASE C — Multi-product training binding UI
5. PHASE E — Duration/meta alignment
6. PHASE F — Batch repair (dry-run → execute)
7. PHASE G — "0 уроков" proof
8. PHASE H — Self-rules audit
9. PHASE I — Legacy path decision
10. PHASE J — Documentation
```

Execute (Phase F) запрещён до Phase D + G proof.

## Файлы для изменения


| Файл                                                           | Фаза | Изменение                                        |
| -------------------------------------------------------------- | ---- | ------------------------------------------------ |
| `src/components/admin/product/ProductAccessRulesTab.tsx`       | B    | Conflict classification                          |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | C    | "Использовать через правило" для bound trainings |
| `src/hooks/useProductTrainings.ts`                             | C    | Usage info query                                 |
| `src/hooks/useTrainingContentRules.ts`                         | D    | Safe default для legacy entitlements без meta    |
| `supabase/functions/grant-access-for-order/index.ts`           | E    | Repair mode                                      |


## DoD (24 пункта)

1-18 из исходного задания + 6 дополнительных:
19. Канонический join-path доказан
20. Existing entitlements нормализованы по meta
21. Legacy entitlements без meta → safe default no_scope
22. Self-rules impact analysis проведён
23. Conflict detection различает valid parallel от реального конфликта
24. Multi-product binding через access_rules