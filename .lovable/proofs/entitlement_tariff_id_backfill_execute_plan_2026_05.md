# PATCH 1 — `entitlements.meta.tariff_id` backfill — EXECUTE PLAN (с guards)

**Дата:** 2026-05-06 (Minsk)
**Статус:** ПОДГОТОВЛЕН. UPDATE НЕ ЗАПУЩЕН. Ожидает финального approve миграции.
**Scope:** только `entitlements.meta` + `audit_logs` + backup-таблица. Никаких касаний writers / orders / subscriptions / access_rules / grant / revoke / retroapply / rule_engine.

---

## 1. Изменение когорты после новых guards

В исходном dry-run `safe_to_fix = 422` считался **без source guard**. После добавления требуемых пользователем guards когорта пересчитана детерминированным CTE:

| Bucket | Было (dry-run) | Стало (с guards) | Δ |
|---|---|---|---|
| `safe_pre_guards` (P1+P2) | 422 | **442** | +20 (уточнение P1 hits) |
| `safe_but_bonus_source` (rule_engine/retroapply) | — | **103** | вычитается |
| `safe_but_scope_limited` (пересечение со scope) | — | **20** | вычитается |
| **`final_safe_after_guards`** | **422** | **336** | **−86** |
| `manual_review_p1_multi` | 20 | 20 | 0 |
| `none` (no source) | 195 | 195 | 0 |
| `cohort_total` | 657 | 657 | 0 |

**Итого к UPDATE: ровно 336 строк** (P1: 328, P2: 8).

> Цифра 422 из dry-run отчёта **отвергнута**. Канон — **336**, потому что 103 bonus-источника (rule_engine/retroapply) и 20 scope-ограниченных строк не имеют права получать `tariff_id`, даже если orders_v2 даёт чистый match. Это явное ужесточение по требованию пользователя.

---

## 2. Guards (жёсткий список)

### 2.1 Conflict guard
- В `safe_to_fix` попадает строка только если у пары `(user_id, product_id)` ровно **один** уникальный `tariff_id` в выбранном источнике.
- Если P1 даёт `array_length>1` → строка → `manual_review_p1_multi`, не апдейтится.
- Если P1 пуст и P2 даёт `array_length>1` → → `manual_review_p2_multi`, не апдейтится.
- Если P1 и P2 одновременно дают разные tariff_id → P1 wins (но в текущей когорте таких пересечений нет, P2 берётся только при пустом P1).

### 2.2 Scope guard
Жёсткий cut-off в WHERE миграции:
```sql
AND COALESCE(meta->>'scope_resolution_mode','') NOT IN ('module_scope_only','no_scope','union_scope')
```

### 2.3 Source guard
Жёсткий cut-off в WHERE миграции:
```sql
AND COALESCE(meta->>'source_type','') NOT IN ('rule_engine','retroapply')
```
Никаких исключений. Bonus-entitlements `tariff_id` не получают никогда — у них SOT в access_rules, а не в orders_v2.

### 2.4 Rowcount guard
Внутри одной транзакции:
```sql
GET DIAGNOSTICS v_updated = ROW_COUNT;
IF v_updated <> 336 THEN
  RAISE EXCEPTION 'Rowcount mismatch: expected 336, got %', v_updated;
END IF;
```
RAISE → транзакция откатывается полностью. Допуск 0.

### 2.5 Audit guard
После UPDATE:
```sql
SELECT COUNT(*) INTO v_audit FROM audit_logs WHERE meta->>'backfill_run_id' = v_run_id;
IF v_audit <> v_updated THEN
  RAISE EXCEPTION 'Audit count mismatch: updated=%, audit=%', v_updated, v_audit;
END IF;
```

### 2.6 Backup guard
До UPDATE:
```sql
INSERT INTO _backup_entitlement_tariff_id_backfill_2026_05 (...)
SELECT ... FROM <safe_to_fix CTE>;
SELECT COUNT(*) INTO v_backup FROM _backup_entitlement_tariff_id_backfill_2026_05 WHERE backfill_run_id = v_run_id;
IF v_backup <> 336 THEN RAISE EXCEPTION 'Backup count mismatch'; END IF;
```

---

## 3. Backup table schema

```sql
CREATE TABLE IF NOT EXISTS _backup_entitlement_tariff_id_backfill_2026_05 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backfill_run_id text NOT NULL,
  entitlement_id  uuid NOT NULL,
  user_id         uuid NOT NULL,
  product_id      uuid NOT NULL,
  old_meta        jsonb NOT NULL,
  resolved_tariff_id uuid NOT NULL,
  resolution_source text NOT NULL CHECK (resolution_source IN ('P1','P2')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON _backup_entitlement_tariff_id_backfill_2026_05 (backfill_run_id);
CREATE UNIQUE INDEX ON _backup_entitlement_tariff_id_backfill_2026_05 (backfill_run_id, entitlement_id);
```

---

## 4. Канонический CTE (используется и для backup, и для UPDATE — один и тот же снимок)

```sql
WITH cohort AS (
  SELECT e.id AS entitlement_id, e.user_id, e.product_id, e.meta,
         e.meta->>'scope_resolution_mode' AS scope_mode,
         e.meta->>'source_type'           AS source_type
  FROM entitlements e
  WHERE e.status='active'
    AND e.product_id IS NOT NULL
    AND (e.meta->>'tariff_id') IS NULL
    AND COALESCE(e.meta->>'source_type','')           NOT IN ('rule_engine','retroapply')
    AND COALESCE(e.meta->>'scope_resolution_mode','') NOT IN ('module_scope_only','no_scope','union_scope')
),
p1 AS (
  SELECT c.entitlement_id, array_agg(DISTINCT o.tariff_id) AS tids
  FROM cohort c
  JOIN orders_v2 o
    ON o.user_id=c.user_id AND o.product_id=c.product_id AND o.tariff_id IS NOT NULL
   AND (o.status='paid' OR o.meta->>'source'='admin_grant' OR o.order_number LIKE 'GIFT-%')
  GROUP BY c.entitlement_id
),
p2 AS (
  SELECT c.entitlement_id, array_agg(DISTINCT s.tariff_id) AS tids
  FROM cohort c
  JOIN subscriptions_v2 s
    ON s.user_id=c.user_id AND s.product_id=c.product_id AND s.tariff_id IS NOT NULL
   AND s.status IN ('active','trial','canceled','past_due')
  GROUP BY c.entitlement_id
),
resolved AS (
  SELECT c.entitlement_id, c.user_id, c.product_id, c.meta AS old_meta,
    CASE
      WHEN p1.tids IS NOT NULL AND array_length(p1.tids,1)=1 THEN p1.tids[1]
      WHEN p1.tids IS NULL AND p2.tids IS NOT NULL AND array_length(p2.tids,1)=1 THEN p2.tids[1]
    END AS resolved_tid,
    CASE
      WHEN p1.tids IS NOT NULL AND array_length(p1.tids,1)=1 THEN 'P1'
      WHEN p1.tids IS NULL AND p2.tids IS NOT NULL AND array_length(p2.tids,1)=1 THEN 'P2'
    END AS source
  FROM cohort c LEFT JOIN p1 USING(entitlement_id) LEFT JOIN p2 USING(entitlement_id)
)
SELECT entitlement_id, user_id, product_id, old_meta, resolved_tid, source
FROM resolved
WHERE resolved_tid IS NOT NULL;
-- ожидаемо: 336 строк (P1: 328, P2: 8)
```

---

## 5. UPDATE-стейтмент (внутри транзакции миграции, один проход)

```sql
WITH src AS ( <тот же CTE выше> )
UPDATE entitlements e
SET meta = jsonb_set(
             jsonb_set(
               jsonb_set(e.meta, '{tariff_id}', to_jsonb(src.resolved_tid::text)),
               '{tariff_id_backfilled_at}', to_jsonb(now())
             ),
             '{tariff_id_backfill_source}', to_jsonb(src.source)
           ),
    updated_at = now()
FROM src
WHERE e.id = src.entitlement_id
  AND (e.meta->>'tariff_id') IS NULL                                    -- re-check
  AND COALESCE(e.meta->>'source_type','')           NOT IN ('rule_engine','retroapply')      -- re-check
  AND COALESCE(e.meta->>'scope_resolution_mode','') NOT IN ('module_scope_only','no_scope','union_scope'); -- re-check
```
Re-check в WHERE гарантирует, что параллельная запись (если случится) не приведёт к перезаписи bonus-строки.

---

## 6. Audit insert (внутри той же транзакции)

```sql
INSERT INTO audit_logs (action, actor_type, actor_label, meta)
SELECT
  'training_content.entitlement_tariff_id_backfilled',
  'system',
  'entitlement_tariff_id_backfill_2026_05',
  jsonb_build_object(
    'backfill_run_id', v_run_id,
    'entitlement_id', src.entitlement_id,
    'user_id',        src.user_id,
    'product_id',     src.product_id,
    'tariff_id',      src.resolved_tid,
    'source',         src.source,
    'old_meta',       src.old_meta
  )
FROM _backup_entitlement_tariff_id_backfill_2026_05 src
WHERE src.backfill_run_id = v_run_id;
```

---

## 7. Порядок выполнения внутри миграции (атомарно)

```text
BEGIN;
  v_run_id := 'entitlement_tariff_id_backfill_2026_05_' || to_char(now(),'YYYYMMDD_HH24MISS');

  -- 1. CREATE TABLE IF NOT EXISTS backup
  -- 2. INSERT INTO backup FROM <CTE>      → backup_count
  -- 3. ASSERT backup_count = 336          → иначе RAISE
  -- 4. UPDATE entitlements FROM <тот же CTE> → updated_count
  -- 5. ASSERT updated_count = 336         → иначе RAISE
  -- 6. INSERT INTO audit_logs FROM backup → audit_count
  -- 7. ASSERT audit_count = 336           → иначе RAISE
COMMIT;
```
Любой RAISE → полный откат: ни backup-строк, ни UPDATE, ни audit-строк не остаётся.

---

## 8. Что НЕ меняется

- `entitlements.status, expires_at, product_id, user_id, profile_id, order_id`.
- `meta.source_type`, `meta.source_rule_id`, `meta.scope_resolution_mode`, любые иные ключи.
- Никаких касаний `access_rules`, `orders_v2`, `subscriptions_v2`, writers, edge functions, retroapply.
- Bonus-entitlements (rule_engine/retroapply) — не трогаются вообще.

---

## 9. Что меняется

- `entitlements.meta.tariff_id` — uuid тарифа (string).
- `entitlements.meta.tariff_id_backfilled_at` — timestamptz now().
- `entitlements.meta.tariff_id_backfill_source` — `'P1'` или `'P2'`.
- `entitlements.updated_at` — now().
- `audit_logs` — 336 строк, action `training_content.entitlement_tariff_id_backfilled`, actor `system`.

---

## 10. Rollback

```sql
WITH b AS (
  SELECT entitlement_id, old_meta
  FROM _backup_entitlement_tariff_id_backfill_2026_05
  WHERE backfill_run_id = '<v_run_id>'
)
UPDATE entitlements e SET meta = b.old_meta, updated_at = now()
FROM b WHERE e.id = b.entitlement_id;
```
Backup-таблица сохраняет полный `old_meta` per row — побитовый откат гарантирован.

---

## 11. Writer-fix (отдельный PATCH, после execute этого backfill)

Не часть данной миграции. Отдельный план:

- `supabase/functions/grant-access-for-order/index.ts`:
  - INSERT-ветка primary entitlement: добавить `tariff_id: tariffId` в `meta` (jsonb).
  - UPDATE-ветка primary entitlement: merge старого meta + `tariff_id` (`jsonb_strip_nulls(old || new)` подход), без затирания.
  - Bonus / rule_engine writer (`telegram-grant-access` / `apply-bonus-rules`) — **не трогать**: для них отсутствие `tariff_id` каноническое поведение.
- Покрыть smoke-тестом: GIFT order → entitlement.meta.tariff_id присутствует.

---

## 12. Grep gate

Запрещённые legacy-токены продукта в документе отсутствуют (проверка ripgrep по `<legacy-product-code>` паттерну — 0 matches). В новых артефактах используются только UUID и `product_name`.

---

## 13. DoD execute-plan

- [x] Cohort пересчитана с новыми guards: 336 (P1: 328, P2: 8).
- [x] Conflict / Scope / Source / Rowcount / Audit / Backup guards описаны и встроены в SQL.
- [x] Backup-таблица: schema + поля по требованию (entitlement_id, user_id, product_id, old_meta, resolved_tariff_id, resolution_source) + run_id.
- [x] Один и тот же CTE для backup и UPDATE → исключён stale-snapshot.
- [x] Re-check в WHERE UPDATE → защита от race на bonus-строки.
- [x] Rollback-стейтмент готов.
- [x] Writer-fix вынесен отдельно (не смешивается с этой миграцией).
- [ ] Финальный approve миграции пользователем → запуск.
