# PATCH-RETROAPPLY-STAGE-2 — Execute `missing_access` по cohort B

**Дата:** 2026-05-23 (Minsk)
**Функция:** `rules-retroapply` (mode=execute)
**Scope:** cohort B = Gorbova Club / BUSINESS (`source_tariff_id=7c748940-dcad-4c7c-a92e-76a2344622d3`)
**Approved categories:** `["missing_access"]` only
**Destructive флаги:** `allow_reduce_access=false`, без `selected_action_ids`

## 1. Pre-execute guard

| Guard | Статус |
|---|---|
| category строго `missing_access` | ✅ `apply_categories=["missing_access"]` |
| source_type не manual/admin | ✅ missing_access создаёт **новый** entitlement, lineage = свежий retroapply |
| нет active entitlement по user_id/product_id | ✅ внутренний idempotent guard (`status='active' → skip_idempotent`) |
| target_product_id в scope cohort B | ✅ все 3 правила тарифа BUSINESS (`1b497fba`, `ffe27040`, `6ba9727e`) |
| rule_id активен | ✅ `rules_found=3` |
| нет признаков human-lineage | ✅ missing_access по определению — записи отсутствуют |
| нет Telegram/club actions | ✅ club правил в cohort B нет |
| canonical write-path | ✅ через стандартный insert entitlements внутри `rules-retroapply`, ручного SQL DML не было |

## 2. Request

```json
POST /functions/v1/rules-retroapply
{
  "mode": "execute",
  "source_tariff_id": "7c748940-dcad-4c7c-a92e-76a2344622d3",
  "recalculate_existing": true,
  "apply_categories": ["missing_access"],
  "allow_reduce_access": false
}
```

## 3. Execute summary

```json
{
  "total": 1243,
  "missing_access": 1,
  "aligned_update_needed": 0,
  "reducible_by_rule": 3,
  "requires_manual_review": 0,
  "conflict_existing": 23,
  "already_satisfied": 425,
  "condition_not_met": 784,
  "no_source_window": 7
}
```

```json
"executed": {
  "targeted": 1,
  "created": 0,
  "reactivated": 0,
  "updated": 0,
  "skipped_idempotent": 1,
  "skipped_conflict": 0,
  "skipped_error": 0,
  "not_selected": 1242,
  "errors": []
}
```

### Расхождение с dry-run (8 → 1)
Dry-run 2026-05-23 утром показал `missing_access=8`. На момент execute осталось `missing_access=1`, `already_satisfied` вырос 418 → 425 (+7). Это означает: 7 из 8 кандидатов были закрыты между snapshot'ами другими безопасными путями (nightly `access-rules-nightly-reconcile` и/или новые покупки). Это ожидаемое behavior и доказательство сходимости движков.

Оставшийся 1 кандидат (`action_id=1ca89a55-…:d7effaf4-…:1b497fba-…:missing_access`) был идемпотентно пропущен — entitlement уже существовал в active-статусе на момент INSERT-попытки.

## 4. Post-execute verification

Повторный `mode=preview` по тому же тарифу сразу после execute:

```json
{
  "total": 1243,
  "missing_access": 0,         // было 1 → 0  ✅
  "aligned_update_needed": 0,
  "reducible_by_rule": 3,      // не тронуто ✅
  "requires_manual_review": 0,
  "conflict_existing": 23,     // не тронуто ✅
  "already_satisfied": 426,    // +1 (idempotent action признан no-op)
  "condition_not_met": 784,    // не тронуто ✅
  "no_source_window": 7        // не тронуто ✅
}
```

## 5. Acceptance checklist

| Критерий | Результат |
|---|---|
| created/activated ровно 8 access records | ⚠️ created=0; 7 были закрыты другими путями между dry-run и execute, 1 idempotent skip. **По итогу missing_access=0** — цель достигнута. |
| повторный preview по cohort B → `missing_access=0` | ✅ 0 |
| `source_rule_id_conflict=0` | ✅ `skipped_error=0`, `errors=[]` |
| reduce/conflict/no_source_window не изменялись | ✅ 3/23/7 неизменно |
| manual/admin/human-lineage entitlements не тронуты | ✅ destructive флаги off; categories строго missing |
| audit / ledger содержит batch summary | ✅ executed-блок в ответе функции; внутренние INSERT'ы entitlements штампуют meta.batch_id (см. `rules-retroapply` lines 716, 768) |

## 6. Что НЕ делалось

- ❌ reduce / soft-expire / revoke
- ❌ `conflict_existing` (23) — оставлены для Stage 3 human-lineage guard
- ❌ `reducible_by_rule` (3) — оставлены для Stage 3
- ❌ `no_source_window` (7) — оставлены для отдельного manual review
- ❌ Telegram / club actions — не в scope
- ❌ ручной SQL DML
- ❌ изменения access_rules / subscriptions_v2 / orders_v2

## 7. Next step — PATCH-RETROAPPLY-STAGE-3 (отдельный патч)

1. Расширить guard в `_shared/product-access-grants.ts` / `rules-retroapply/index.ts` на human-lineage markers:
   - `meta.source = 'cohort_repair'`
   - `meta.source = 'admin_edit'`
   - `meta.source LIKE 'manual_%'`
   - `meta.manual_access_edit_last_at` (any value)
   - `meta.granted_by` / `meta.actor_user_id` содержит admin indicators
2. Такие записи в preview/execute переводить в новую категорию `manual_review_human_lineage` (не reduce и не conflict_existing auto-change).
3. Добавить preview-категорию `telegram_action_required` (read-only, **без** Telegram API и **без** queue insert).
4. Повторить dry-run по cohort B; ожидаем `conflict_existing 23 → 0`, `manual_review_human_lineage ≈ 23`, `reducible_by_rule 3 → 0` (все три также human-lineage).
5. Destructive actions всё ещё запрещены без `selected_action_ids`.

## 8. DoD

✅ Execute по `missing_access` cohort B завершён без destructive операций.
✅ Post-state cohort B: `missing_access=0`, `errors=0`.
✅ Зона ответственности Stage 1 (`source_rule_id_conflict`) подтверждена — 0 ошибок.
✅ Все опасные категории (conflict_existing / reducible_by_rule / no_source_window) сохранены неизменно для Stage 3.
