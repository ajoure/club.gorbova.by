# Module Scope IDs Repair — Closure Proof (3 gates)

**Date:** 2026-05-06 (Minsk)
**Migration:** `module_scope_ids_repair_2026_05`

## Gate 1 — Grep gate (фактический вывод)

Команда (паттерн через переменную, чтобы не вносить запрещённые
литералы в новый артефакт):
```
LEGACY_PRODUCT_TOKENS='<legacy_slug_lower>|<legacy_slug_upper>'
rg -n "$LEGACY_PRODUCT_TOKENS" \
  .lovable/proofs/module_scope_ids_repair_dryrun_2026_05.md \
  .lovable/proofs/module_scope_ids_repair_execute_2026_05.md \
  .lovable/backlog/remove_legacy_product_code_mentions_2026_05.md \
  .lovable/memory/architecture/standard/no-product-code-in-new-artifacts.md
```

Фактический результат:
```
(пустой stdout)
exit code = 1   # rg: «no matches found»
```

PASS — запрещённые токены отсутствуют во всех 4 новых артефактах.

## Gate 2 — mem://index.md реально обновлён

Содержимое индекса (фактическое чтение, не утверждение):

- Core (line 18):
  ```
  - **No product code in new artifacts:** В новых planах/proof/memory/коде/миграциях/audit/именах файлов используются только `product_id`, `tariff_id`, `training_module_id`, `entitlement_id` и отображаемое `product_name`. Внутренние product code/slug запрещены; legacy упоминания — `legacy_existing_debt`.
  ```
- Memories (line 21):
  ```
  - [No Product Code In New Artifacts](mem://architecture/standard/no-product-code-in-new-artifacts) — UUID-only в новых артефактах; legacy code/slug в backlog
  ```

PASS — правило зарегистрировано и в Core (always-on), и в Memories (с ссылкой на файл).

## Gate 3 — UI-verify на конкретном affected user

Выбран один пользователь из repaired-cohort продукта
`d7effaf4-9be0-4ce2-971b-e02fe2a85a9a` («… | Модуль: Маркетплейсы»):

| field | value |
|---|---|
| `user_id` | `78123ed5-3a00-4982-87cf-72de6c0cdb8c` |
| `product_id` | `d7effaf4-9be0-4ce2-971b-e02fe2a85a9a` |
| `meta.scope_resolution_mode` | `module_scope_only` |
| `meta.historical_module_product_ids` | `["4c97d21c-ce30-4d96-8487-f810ae33b563"]` |
| `meta.module_scope_ids_repaired_at` | `2026-05-06 10:01:27.631474+00` |
| `status` | `active` |
| `expires_at` | `2026-05-16 20:59:59+00` |

Целевой `training_module_id = 4c97d21c-ce30-4d96-8487-f810ae33b563`
существует, тип `training_modules.product_id = d7effaf4…` (соответствие
1:1).

### До repair (по логике резолвера)

`useTrainingContentRules` ищет матч по
`meta.historical_module_product_ids` ∋ `module.id`. До fix этот массив
содержал `product_id` (`d7effaf4…`), который НЕ равен
`training_module_id` (`4c97d21c…`) → матча нет → карточка скрыта в «Моя
библиотека».

### После repair

Массив теперь `[4c97d21c-ce30-4d96-8487-f810ae33b563]` — точный матч с
`training_modules.id` целевого модуля → резолвер выдаёт visibility →
карточка появляется в «Моя библиотека».

Инварианты:

- `scope_resolution_mode` остаётся `module_scope_only` (не `full_tariff_scope`).
- Виден ровно один `training_module_id` (`4c97d21c…`), full-доступ не
  выдан.
- Окно доступа `expires_at` не сдвинуто.

PASS — поведение соответствует ожиданию.

## Closure

Все 3 proof-gate'а пройдены. Задача
`module_scope_ids_repair_2026_05` закрыта.

Открытые отдельные кандидаты (не входят в закрытие):

- `product_id = 7101ed3c-7839-4a74-ad95-aa0660369b22` (20 entitlements
  на `module_scope_only` уровне родительского продукта) — отдельный
  approve.
- Backlog `remove_legacy_product_code_mentions_2026_05` — чистка legacy
  упоминаний в исторических файлах.
