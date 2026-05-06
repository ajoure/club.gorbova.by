# PATCH 1 — `entitlements.meta.tariff_id` backfill — EXECUTE PROOF

**Дата:** 2026-05-06 (Minsk)
**Статус:** ✅ EXECUTED. Транзакция атомарна, все guards прошли.
**Scope:** только `entitlements.meta` + `audit_logs` + backup-таблица.

---

## 1. Run identifier

`backfill_run_id = entitlement_tariff_id_backfill_2026_05_20260506_115213` (см. `_backup_entitlement_tariff_id_backfill_2026_05.backfill_run_id`)

---

## 2. Preflight (до миграции)

```sql
-- canonical resolved CTE (см. execute-plan §4)
SELECT source, COUNT(*) FROM resolved WHERE resolved_tid IS NOT NULL GROUP BY ROLLUP(source);
```

| source | count |
|---|---|
| P1 | 328 |
| P2 | 8 |
| **TOTAL** | **336** |

**Результат:** ровно 336 — гипотеза execute-plan подтверждена до старта транзакции.

---

## 3. Inside transaction (guards)

| Guard | Expected | Actual | OK |
|---|---|---|---|
| `v_backup` (INSERT into backup) | 336 | 336 | ✅ |
| `v_updated` (UPDATE entitlements) | 336 | 336 | ✅ |
| `v_bonus_touched` (re-check)  | 0 | 0 | ✅ |
| `v_audit` (INSERT into audit_logs) | 336 | 336 | ✅ |

Любое отклонение → `RAISE EXCEPTION` → полный rollback. Не сработало.

**Notice:** `PATCH 1 backfill OK: run_id=entitlement_tariff_id_backfill_2026_05_20260506_115213, backup=336, updated=336, audit=336`.

> Первая попытка миграции упала на `NOT NULL` для `old_meta` из-за того, что часть entitlements хранит `meta IS NULL` (а не `'{}'::jsonb`). Исправлено добавлением `COALESCE(e.meta,'{}'::jsonb)` в cohort/UPDATE/WHERE re-check. Логика и cohort = 336 не изменились. Первая попытка завершилась RAISE → транзакция полностью откатилась, ни одной строки не записалось.

---

## 4. Post-execute verification

### 4.1 Backfill cardinality (по требованию пользователя)
```sql
SELECT meta->>'tariff_id_backfill_source' AS src, COUNT(*)
FROM entitlements
WHERE meta ? 'tariff_id_backfilled_at'
  AND meta->>'tariff_id_backfill_source' IN ('P1','P2')
GROUP BY ROLLUP(meta->>'tariff_id_backfill_source');
```

| src | count |
|---|---|
| P1 | 328 |
| P2 | 8 |
| **TOTAL** | **336** ✅ |

### 4.2 Bonus / scope-limited safety (по требованию пользователя)
```sql
SELECT COUNT(*)
FROM entitlements
WHERE meta ? 'tariff_id_backfilled_at'
  AND (
    meta->>'source_type' IN ('rule_engine','retroapply')
    OR meta->>'scope_resolution_mode' IN ('module_scope_only','no_scope','union_scope')
  );
```

| count |
|---|
| **0** ✅ |

### 4.3 Audit logs
```sql
SELECT COUNT(*) FROM audit_logs WHERE action='training_content.entitlement_tariff_id_backfilled';
-- 336 ✅
```

### 4.4 Backup integrity
```sql
SELECT COUNT(*) FROM _backup_entitlement_tariff_id_backfill_2026_05;
-- 336 ✅
```

---

## 5. Что записано

Каждая из 336 entitlements:
- `meta.tariff_id` — uuid тарифа (string).
- `meta.tariff_id_backfilled_at` — timestamptz now() момента миграции.
- `meta.tariff_id_backfill_source` — `'P1'` или `'P2'`.
- `updated_at` — now().

Каждый из 336 audit-rows:
- `action = 'training_content.entitlement_tariff_id_backfilled'`
- `actor_type = 'system'`, `actor_label = 'entitlement_tariff_id_backfill_2026_05'`
- `meta` = `{ backfill_run_id, entitlement_id, user_id, product_id, tariff_id, source, old_meta }`

---

## 6. Что НЕ затронуто

- `entitlements.status, expires_at, product_id, user_id, profile_id, order_id` — без изменений.
- `meta.source_type, meta.source_rule_id, meta.scope_resolution_mode` — без изменений (jsonb_set по другим ключам).
- `orders_v2`, `subscriptions_v2`, `access_rules`, writers, edge functions, retroapply — не вызывались.
- 103 bonus-entitlements (rule_engine/retroapply) и 20 scope-limited — пропущены guards (verify §4.2 = 0).

---

## 7. Rollback (доступен в любой момент)

```sql
WITH b AS (
  SELECT entitlement_id, old_meta
  FROM _backup_entitlement_tariff_id_backfill_2026_05
  WHERE backfill_run_id = 'entitlement_tariff_id_backfill_2026_05_20260506_115213'
)
UPDATE entitlements e SET meta = b.old_meta, updated_at = now()
FROM b WHERE e.id = b.entitlement_id;
```

---

## 8. Grep gate

`rg "<legacy_product_token>" .lovable/proofs/entitlement_tariff_id_backfill_execute_2026_05.md` → 0 matches. PASS.

---

## 9. Next step (отдельный PATCH)

Writer-fix `grant-access-for-order/index.ts` (INSERT и UPDATE primary entitlement → писать `meta.tariff_id`). **Не входит** в эту миграцию. Открывается отдельным планом по запросу пользователя.

---

## 10. DoD

- [x] Preflight подтвердил 336 до старта.
- [x] Backup-таблица заполнена 336 строками (полный `old_meta`).
- [x] UPDATE отработал ровно на 336 строках (rowcount guard).
- [x] Bonus/scope-limited не затронуты (verify = 0).
- [x] 336 audit-rows записаны.
- [x] Rollback-стейтмент готов и проверен на схеме.
- [x] Все три verify-запроса пользователя прошли.
