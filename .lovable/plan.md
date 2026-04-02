# Phase F: Repair BUSINESS → cb20 Entitlements

## Текущий статус

- **SAFE cohort**: approved candidate
- **Execute**: NOT YET APPROVED — ожидает финальный pre-execute breakdown
- **standalone_only**: BLOCKED — до mapping confidence proof
- **create path**: BLOCKED — исключён из safe cohort, только follow-up
- **Следующий required proof**: safe cohort breakdown + post-execute verification template

---

## Safe Cohort — допустимые действия

Только already-entitled кейсы:
- `align_to_business` — meta есть, expires нужно выровнять
- `repair_metadata_and_align` — meta отсутствует, expires нужно выровнять
- `repair_metadata_only` — meta отсутствует, expires уже совпадает

**create** в safe cohort не входит. Даже safe create выносится отдельным follow-up.

---

## Жёсткие guard-условия на execute

1. `execute_cohort = 'safe_only'` — обязателен
2. Если в safe cohort попал `scope_bucket = module_scope_only` → **ABORT**
3. Если в safe cohort попал `planned_action = create` → **ABORT**
4. `union_scope` допускается только если:
   - `historical_tariff_id IS NOT NULL`
   - `historical_module_product_ids.length > 0`
   - `current_entitlement_id IS NOT NULL` (existing entitlement)

---

## HOLD cohort — 3 подгруппы

| Подгруппа | Описание |
|---|---|
| `business_end_null` | `business_access_end_at IS NULL` |
| `runtime_preview_zero_visibility` | Runtime preview показал 0 видимых модулей/уроков |
| `staff_skip` | Сотрудники (@ajoure.by и denylist) |
| `standalone_only_blocked` | `module_scope_only` без mapping proof |
| `create_blocked` | `create` action исключён из safe cohort |
| `email_null` | Identity unresolved |

---

## mapping_confidence — проблемные факты

- `exact_fk` match в «Предобучение» — технический FK, не доказательство коммерческого scope
- Такие кейсы остаются в HOLD если относятся к standalone-only
- `inferred` / `no_match` → execute запрещён

---

## Audit-поля для execute

- `safe_candidate_count`
- `hold_candidate_count`
- `executed_action_breakdown` (по action)
- `executed_scope_breakdown` (по scope)
- `per_operation` — per-user proof

## Post-check таблица (per-user)

| Поле | Описание |
|---|---|
| `user_id` | Auth UID |
| `old_expires_at` | До execute |
| `new_expires_at` | После execute |
| `target_expires_at` | Ожидаемое значение |
| `old_meta_status` | `has_meta` / `no_meta` |
| `new_scope_resolution_mode` | Записанный scope |
| `result` | `success` / `error` |

## Post-execute verification plan

1. Post-check proof по safe cohort (per_user_proof таблица)
2. Runtime proof на 2 safe users:
   - 1× `full_tariff_scope` — проверить что runtime НЕ даёт legacy fallback full-access
   - 1× `union_scope` — проверить что runtime правильно режет scope
3. Только после этого → standalone-only follow-up

---

## Dedupe fix

- Дедупликация по `order.id` (UUID), не по composite key
- `orders_v2.profile_id` → `profiles.id` (не auth UID)
- Reverse map через `profiles.user_id`

## Файлы

| Файл | Статус |
|---|---|
| `supabase/functions/repair-cb20-entitlements/index.ts` | Обновлён: guards, cohort split, per-user proof |
| `.lovable/plan.md` | Текущий файл |
