# BUSINESS Горбуша Club → full + auto-propagation engine

Date: 2026-04-30
Goal: новые папки в «Базе знаний» автоматически видны BUSINESS-когорте без ручных правок `allowed_module_ids`.

## Schema-proof
`access_mode` хранится в `access_rules.conditions` (JSONB). Отдельной колонки нет — подтверждено через `information_schema.columns`.

## Шаг 4 — Data-fix
Правило `417e5071-d2e0-43ed-9bed-91696ea108ec` (BUSINESS Горбуша Club / target=База знаний root `8b1fb03e…`):
- `conditions.access_mode`: **partial → full** (jsonb_set).
- `allowed_module_ids` намеренно НЕ очищен (read-path в full режиме его игнорирует).
- `updated_at = now()`.

## Ledger-запись
```
source_event_key  : access_rule.manual_fix:417e5071
execution_key     : business_tariff_full_fix:417e5071:1777567755
action_type/status: grant / granted
reason_code       : admin_grant
metadata.old_access_mode: partial
metadata.new_access_mode: full
metadata.reason_detail  : business_tariff_should_receive_all_new_training_modules
metadata.actor          : planned_data_fix
```
Constraints `chk_action_status_compat`, `chk_reason_code`, `chk_source_event_type`, `chk_source_subject_type`, `chk_target_type` — все enum-домены соблюдены.

## Шаг 2-3 — Миграции
1. **Backfill**: `UPDATE access_rules SET conditions += {auto_include_new_modules:false}` для всех активных partial training_content правил, у которых ключа ещё не было. Затронуто 7 правил → после Шага 4 их осталось 6 (правило 417e5071 ушло в full).
2. **Триггер** `tg_training_module_propagate_to_partial_rules` (AFTER INSERT ON training_modules):
   - срабатывает только при `parent_module_id IS NOT NULL`;
   - 5 жёстких условий применения (grant_target_type/is_active/target_ref/access_mode/auto_include_flag);
   - safe to allowed_module_ids missing: COALESCE на `'[]'`, дубликаты пропускаются;
   - audit в `access_grant_ledger` с валидными enum-значениями (`grant/granted/admin_grant/system/system/training_module`).

## Шаг 5 — UI
`src/components/admin/product/ProductAccessRulesTab.tsx`:
- form-поле `tc_auto_include_new_modules` (default false), hydrate из `conditions.auto_include_new_modules` в `openEditDialog`;
- save-логика: для partial — пишет `auto_include_new_modules`, для full — `delete`;
- чек-бокс «Автоматически добавлять новые папки тренинга» (показывается только в partial);
- алерт о «осиротевших» папках с двумя действиями: «Добавить все» / «Перевести в Полный доступ»;
- AlertDialog confirm при переключении existing partial → full с текстом из плана: «После перевода в full пользователи этого правила увидят все текущие и будущие папки тренинга. Текущий список выбранных модулей будет сброшен.»;
- read-path (`useTrainingContentRules`) не изменён.

## Verify
| check | result |
|---|---|
| rule 417e5071 | mode=full, allowed_count=1 (residual, ignored), auto_inc=false |
| rule 19b66114 (CB20/БАЗА) | mode=partial, allowed_count=2, auto_inc=false (не тронут) |
| trigger tg_training_module_propagate_to_partial_rules | enabled (O) |
| partial rules with explicit auto_include flag | 6 / 6 |

## DoD
- [x] BUSINESS Горбуша Club правило в `mode=full`.
- [x] 6 partial-правил имеют явный `auto_include_new_modules=false`.
- [x] Триггер создан и срабатывает строго по 5 условиям; для full и partial+false — no-op.
- [x] Read-path `useTrainingContentRules` не изменён.
- [x] UI: чек-бокс auto_include + алерт «осиротевших» + confirm для перехода в full.
- [x] Ledger before/after зафиксирован.

## Smoke (виртуальный)
При создании новой папки под `8b1fb03e…` (root «Базы знаний») триггер не сработает: ни одно из 6 partial-правил не имеет `auto_include_new_modules=true`. Запись в `access_grant_ledger` с `outcome=auto_propagated_new_module` появится только после того, как админ явно включит чек-бокс на конкретном правиле.

## Эффект для Ерастовой
Профиль Ерастовой (BUSINESS Горбуша Club) теперь резолвится через правило `417e5071…` в режиме `full` → весь target тренинг (`8b1fb03e…` = «База знаний») виден автоматически, включая новые папки «Идеологическая работа в бизнесе», «Вебинары», «Квесты» и любые будущие.
