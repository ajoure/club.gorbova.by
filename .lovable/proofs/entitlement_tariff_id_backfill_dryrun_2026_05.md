# PATCH 1 — `entitlements.meta.tariff_id` backfill — DRY-RUN

**Дата:** 2026-05-06 (Minsk)
**Scope:** только `entitlements.meta` + `audit_logs`. Никаких касаний writers / orders / subscriptions / access_rules / grant / revoke / retroapply / rule_engine.
**Этап:** read-only классификация. UPDATE НЕ выполняется.

## 1. Cohort

Active entitlements с `product_id IS NOT NULL` и `meta->>'tariff_id' IS NULL`:

| Метрика | Значение |
|---|---|
| **Total cohort** | **657** |
| `scope_resolution_mode = full_tariff_scope` | 121 |
| `scope_resolution_mode = module_scope_only` | 73 |
| `scope_resolution_mode = no_scope` | 64 |
| `scope_resolution_mode = union_scope` | 6 |
| `scope_resolution_mode = NULL` | 393 |
| `meta.source_type = rule_engine` | 76 |
| `meta.source_type = retroapply` | 154 |

## 2. Source priority chain

- **P1:** `orders_v2 WHERE user_id=? AND product_id=? AND (status='paid' OR meta->>'source'='admin_grant' OR order_number LIKE 'GIFT-%') AND tariff_id IS NOT NULL` → `array_agg DISTINCT tariff_id`. Один уникальный → P1 hit.
- **P2:** `subscriptions_v2 WHERE user_id=? AND product_id=? AND status IN ('active','trial','canceled','past_due') AND tariff_id IS NOT NULL`. Один уникальный → P2 hit.
- **P3 / P4:** не используются на этом проходе (resolver lineage, access_rules) — сознательно отложены, чтобы не вводить шум.

## 3. Buckets

| Bucket | Count | Описание |
|---|---|---|
| `safe_to_fix_p1` | **414** | Один доказуемый `tariff_id` из orders_v2, scope_mode ∈ {full_tariff_scope, NULL}. |
| `safe_to_fix_p2` | **8** | P1 пусто, ровно один `tariff_id` из subscriptions_v2, scope_mode ∈ {full_tariff_scope, NULL}. |
| `manual_review_p1_multi` | 20 | Несколько разных `tariff_id` в orders_v2 для одной пары `(user_id, product_id)`. |
| `manual_review_p2_multi` | 0 | — |
| `skip_scope_limited` | **143** | `scope_resolution_mode IN ('module_scope_only','no_scope','union_scope')` — backfill может изменить поведение P4.5/scope-логики. |
| `skip_no_tariff_source` | **72** | Нет ни в orders_v2, ни в subscriptions_v2. |
| **Итого** | **657** | = cohort. |

**`safe_to_fix` total = 422** (P1: 414 + P2: 8).

## 4. Stop-guards для `safe_to_fix`

- ровно один `entitlement_id` (PK).
- ровно один уникальный `tariff_id` из выбранного источника (array_length=1).
- если P1 даёт 1 — берём P1, P2 не используется (no conflict surface).
- если P1 пуст и P2 даёт 1 — берём P2.
- `scope_resolution_mode NOT IN ('module_scope_only','no_scope','union_scope')` (жёсткий cut-off, перепроверяется в SQL execute).
- При любом конфликте между источниками строка автоматически попадает в `manual_review_*` и не апдейтится.

## 5. Что НЕ меняется

- `status`
- `expires_at`
- `scope_resolution_mode`
- `product_id`, `user_id`, `profile_id`, `order_id`
- `meta.source_type`, `meta.source_rule_id`, любые иные поля meta кроме новых `tariff_id`, `tariff_id_backfilled_at`, `tariff_id_backfill_source`.

## 6. Что меняется (на этапе execute, который ещё не запущен)

- `meta = jsonb_set(jsonb_set(jsonb_set(meta, '{tariff_id}', to_jsonb(<uuid>)), '{tariff_id_backfilled_at}', to_jsonb(now())), '{tariff_id_backfill_source}', to_jsonb('P1'|'P2'))`
- `audit_logs` insert per row:
  - `action='training_content.entitlement_tariff_id_backfilled'`
  - `actor_type='system'`
  - `actor_label='entitlement_tariff_id_backfill_2026_05'`
  - `meta = { entitlement_id, user_id, product_id, tariff_id, source }`

## 7. Распределение `safe_to_fix` по продуктам (top-10)

(Преобладают курсы с одним каноническим тарифом, что соответствует ожидаемой природе bucket'а: один `(user_id, product_id)` → один тариф в orders_v2.)

| product_id | safe_to_fix count |
|---|---|
| `73c29914-...` | ~120 |
| `4fc18564-...` | ~80 |
| `87a8870f-...` | ~50 |
| `7101ed3c-...` | ~30 |
| `85046734-...` | ~25 |
| `11c9f1b8-...` | ~15 |
| `de36a695-...` | ~10 |
| прочее | остаток |

(Полный mapping `entitlement_id → tariff_id → source` будет извлечён повторно тем же CTE в момент execute, чтобы избежать stale-snapshot.)

## 8. Manual review (20 строк)

Все 20 — `manual_review_p1_multi`. У `(user_id, product_id)` найдено **несколько разных `tariff_id`** в orders_v2 (вероятно: тариф был сменён, повторная покупка иного тарифа, либо данные дрейф). Эти строки **НЕ автозаполняются**, ждут ручного решения.

## 9. Skip-rationale

- **`skip_scope_limited` (143):** `module_scope_only` / `no_scope` / `union_scope` могут менять смысл доступа при появлении `tariff_id` (P4.5 fallback и scope-резолвер ведут себя иначе). Эти entitlements чинятся отдельной задачей с явной сценарной верификацией каждой пары.
- **`skip_no_tariff_source` (72):** нет orders_v2 paid/admin_grant и нет subscriptions_v2 с `tariff_id`. Это, вероятно, bonus-entitlements (`source_type ∈ {rule_engine,retroapply}`) или legacy data, у которых `tariff_id` отсутствует **архитектурно**. Backfill через P3 (access_rules) и P4 (audit lineage) — отдельный план.

## 10. DoD текущего шага

- [x] Cohort посчитан.
- [x] Source priority зафиксирована.
- [x] Buckets сформированы и пересчитаны.
- [x] `safe_to_fix` total = 422 — детерминирован, воспроизводим тем же CTE.
- [x] `manual_review` и `skip_*` явно перечислены.
- [x] **НИ ОДНОГО UPDATE.**

## 11. Grep gate

```
LEGACY_PRODUCT_TOKENS='<legacy_slug_lower>|<legacy_slug_upper>'
rg -n "$LEGACY_PRODUCT_TOKENS" \
  .lovable/proofs/entitlement_tariff_id_backfill_dryrun_2026_05.md \
  .lovable/proofs/gift_admin_grant_entitlement_diagnostic_2026_05.md
```
→ exit 1, no matches. PASS.

## 12. Что дальше

Dry-run завершён. Ожидаю явный approve запуска **Шага 2 (execute, только safe_to_fix=422)**:

1. Backup `meta` всех 422 entitlements в `.lovable/proofs/entitlement_tariff_id_backfill_backup_2026_05.json`.
2. UPDATE через миграцию (`supabase--migration`), детерминированный CTE = тот же, что в Шаге 1.
3. Audit row на каждую обновлённую строку.
4. Verify proof: counts до/после, sample 5 user'ов через resolver, manual_review/skip — без изменений.
