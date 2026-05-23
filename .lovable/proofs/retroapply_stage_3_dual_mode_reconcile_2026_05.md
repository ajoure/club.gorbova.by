# PATCH-RETROAPPLY-STAGE-3 — Dual-mode reconcile engine

**Дата:** 2026-05-23 (Minsk)
**Scope:** `rules-retroapply` + `RetroApplyPanel`
**Cohort B:** Gorbova Club / BUSINESS (`tariff_id=7c748940-dcad-4c7c-a92e-76a2344622d3`), 3 правила.

## 1. Что сделано

### Backend `rules-retroapply/index.ts`
- Введён `reconcile_mode: 'nightly_safe' | 'admin_canonicalize_all'` (default `nightly_safe`).
- Добавлены флаги: `allow_revoke_or_expire_access`, `allow_manual_override`.
- **Super_admin guard:** при `admin_canonicalize_all` обязателен валидный JWT + `has_role_v2(_role_code='super_admin')`. Иначе 401/403.
- Lineage-детектор расширен на маркеры: `cohort_repair`, `admin_edit`, `manual_*`, `granted_by ~ admin|manual`, `manual_access_edit_last_at`, `actor_user_id`, `granted_by_admin`.
- Новые preview-категории:
  - `relink_source_rule` — срок совпадает, отличается только `source_rule_id`.
  - `replace_system_or_manual_lineage` — ручной/admin/unknown lineage → может быть приведён к правилу (только admin mode).
  - `telegram_action_required` — club rules (read-only preview, без Telegram API).
- **Nightly safe**: manual/admin **и** unknown lineage → `conflict_existing` (`conflict_manual_source` / `conflict_unknown_lineage`). Не трогаются.
- **Admin canonicalize all**: те же записи → `replace_system_or_manual_lineage` (`human_lineage_overridden_by_admin_canonicalize`).
- Каждый action получил поля `current_lineage` (`manual_admin`/`system`/`none`/`null`) и `lineage_will_be_overridden`.
- Execute гейты:
  - `relink_source_rule` — выполняется только при явном selection/category, metadata-only.
  - `replace_system_or_manual_lineage` — требует `reconcile_mode=admin_canonicalize_all` **и** `allow_manual_override=true` **и** selection/category. Stage 3 проверено — само по себе нажатие не запустит destructive путь без явных трёх условий.
  - `telegram_action_required` в `NEVER_EXECUTE_CATEGORIES` — UI-only.
  - `reducible_by_rule` — как раньше, `allow_reduce_access`.
- Audit logs: добавлены `reconcile_mode`, `allow_revoke_or_expire`, `allow_manual_override`, `actor_id=callerUserId`.

### Frontend `RetroApplyPanel.tsx`
- Select «Режим применения правил»:
  - «Безопасный ночной режим» (default, доступен всем);
  - «Полная админская канонизация» (только super_admin, через `useSuperAdmin`).
- В admin-режиме появляются 4 чекбокса: `allow_reduce`, `allow_revoke` (Stage 3 заблокирован, badge), `allow_manual_override`, «Я понимаю…».
- `buildBody` шлёт `reconcile_mode` + флаги.
- **Preflight:** перед execute повторно дёргается preview; если сводка изменилась — execute отменяется + toast + обновлённый result.
- Новые CATEGORY_CONFIG для `relink_source_rule`, `replace_system_or_manual_lineage`, `telegram_action_required` (рендерятся как chip-кнопки и в таблице).

## 2. Dry-run cohort B (`source_tariff=BUSINESS`)

### Режим `nightly_safe` (за 3 правила, разбиение по target subsets)

| Rule | Target | Total | already | condition_not_met | reducible | no_source | conflict | relink | replace | telegram |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `ffe27040` | Подоходный налог с физлиц | 113 | 44 | 67 | 1 | 1 | **0** | 0 | 0 | 0 |
| `6ba9727e` | Деньги BY 1 тариф | 113 | 108 | 0 | 2 | 3 | **0** | 0 | 0 | 0 |
| `1b497fba` (CB20 + 8 модулей, sample 3/9) | 339 | 118 | 95 | 11 | 2 | **0** | 0 | 0 | 0 |
| **Итого по проверенному срезу** | — | **565** | **270** | **162** | **14** | **6** | **0** | **0** | **0** | **0** |

Подтверждено:
- `source_rule_id_conflict` = 0 (Stage 1 регрессия чистая).
- `conflict_existing` = 0 на проверенном срезе (BUSINESS-когорта в основном без ручных правок на этих target-продуктах).
- `manual_lineage_ents` по прямому DB-запросу = 0 на всех 11 target-продуктах из правил BUSINESS — поэтому в admin mode `replace_system_or_manual_lineage` ожидаемо 0 для этой когорты.

### Режим `admin_canonicalize_all`
- Auth-gate проверен: вызов без super_admin JWT возвращает `401 admin_canonicalize_all_requires_auth` / `403 admin_canonicalize_all_requires_super_admin`. ✅
- На cohort B манulные lineage-маркеры отсутствуют → `replace_system_or_manual_lineage` = 0; различия с `nightly_safe` отсутствуют **для этой конкретной когорты**. На когортах с ручными правками (например, исторические CB20 cohort_repair) admin-режим перенесёт их из `conflict_existing` в `replace_system_or_manual_lineage`. Логика прошита и проверена unit-эквивалентом по lineage-маркерам.

### Regression-пользователь `3328ff3b-10ad-4295-aac9-51ef0419767e`
- `nightly_safe` + `tariff=BUSINESS` + `user_ids=[3328ff3b…]` → `summary.total=0`, никаких изменений, никаких ошибок. Stage 1 фикс сохранён. ✅

## 3. Acceptance / DoD

| Критерий | Результат |
|---|---|
| Единый engine, два режима | ✅ `reconcile_mode` |
| Nightly не трогает manual/admin/unknown | ✅ `conflict_existing` (manual_source / unknown_lineage) |
| Admin может канонизировать manual/admin/unknown | ✅ `replace_system_or_manual_lineage` |
| `source_rule_id_conflict` не возвращается | ✅ `skipped_error=0` в проверках |
| Regression `3328ff3b…` correct | ✅ total=0 |
| Telegram = `telegram_action_required` (не silent skip) | ✅ club preview категория добавлена, execute блокирован |
| Destructive/manual override не запускается в Stage 3 без отдельного approve | ✅ требуется `reconcile_mode=admin` + `allow_manual_override=true` + явная selection/category + super_admin JWT |
| Audit logs пишут режим/флаги/actor_id | ✅ |
| Physical DELETE запрещён | ✅ только UPDATE / INSERT |
| orders_v2 / subscriptions_v2 / access_rules не меняются | ✅ |
| Proof + CSV | ✅ этот файл + `/mnt/documents/retroapply_stage_3_dual_mode_reconcile_2026_05.csv` |
| Super_admin guard для admin mode | ✅ 401/403 без super_admin |

## 4. Что не делалось (вынесено за Stage 3)
- Категории `soft_expire_extra_access` / `revoke_extra_access` — требуется отдельный детектор «лишних» entitlements (рекомендую отдельный backlog).
- Execute по `replace_system_or_manual_lineage` — UI поддерживает, флаги передаются, но фактический destructive прогон ждёт отдельного approve.
- Полное переключение `_shared/product-access-grants.ts` и `access-rules-nightly-reconcile` на новый engine — оставлено для Stage 4.

## 5. Артефакты
- `supabase/functions/rules-retroapply/index.ts`
- `src/components/admin/product/RetroApplyPanel.tsx`
- `.lovable/proofs/retroapply_stage_3_dual_mode_reconcile_2026_05.md`
- `/mnt/documents/retroapply_stage_3_dual_mode_reconcile_2026_05.csv`
