# PATCH-RETROAPPLY-STAGE-5 — Window fallback + execute UX

**Дата:** 2026-05-23 (Minsk)
**Scope:** `rules-retroapply` + `RetroApplyPanel`
**Cohort B:** Gorbova Club / BUSINESS (`tariff_id=7c748940-dcad-4c7c-a92e-76a2344622d3`).

## 1. Что сделано

### Backend `supabase/functions/rules-retroapply/index.ts`

1. **Расширен select подписок:** добавлены `access_start_at`, `created_at` (используются как anchor для fallback).
2. **`tariffAccessDaysMap`** — пакетная загрузка `tariffs.access_days` для всех `sub.tariff_id` в скоупе.
3. **Новый `resolveWindow(sub)`** — трёхуровневая цепочка:
   - `rule.duration_days` → `anchor = now()`, `window_resolved_from="rule_duration"`.
   - `sub.access_end_at` → `window_resolved_from="source_access_end_at"`, `anchor=sub_access_end_at`.
   - `tariff.access_days` от `anchor ∈ {sub.access_start_at, sub.created_at}` → `window_resolved_from="tariff_access_days"`.
   - Если всё пусто → `null` → категория `no_source_window`.
4. **`now()` НЕ используется как silent anchor** для tariff fallback — только для прямого `rule.duration_days`.
5. **Новая категория `expired_source_window`** — если `plannedExpiry < now()` (включая случай tariff fallback от старого anchor), запись не создаётся/не продлевается автоматически.
6. **`NEVER_EXECUTE_CATEGORIES`** дополнен `expired_source_window`.
7. **UserAction** получил поля `window_resolved_from` и `window_anchor_source`.
8. **Reducible update** — в `entitlements.meta` пишутся `previous_expires_at`, `reduction_reason="stage5_reducible_by_canonical_rule"`, `reduced_at`, `reduced_by_user_id`.
9. **INSERT при missing_access** — пишет `window_resolved_from` и `window_anchor_source` в meta.
10. **Audit `rules_retroapply.executed`** содержит `window_fallback_applied` и `expired_source_window_count`.

### Frontend `src/components/admin/product/RetroApplyPanel.tsx`

1. **`handleExecuteWithReductions`** — добавлен `preflightOk()` + автоматическое переключение `activeFilter="changed"` после execute.
2. **`runRetroApply` (execute branch)**:
   - `res.error` / `res.stop_reasons` → `toast.error` с переведённой причиной.
   - `created=0 && updated=0 && reactivated=0 && skipped_idempotent>0` → `toast.success("Все записи уже соответствуют правилам (N idempotent skip)")`.
   - `created=0 && updated=0 && reactivated=0 && skipped_idempotent=0` → `toast.warning("Изменений не выполнено. Проверьте предпросмотр и фильтры.")`.
   - Иначе — детальный успех с разбивкой created/updated/reactivated/errors.
3. **Новая категория `expired_source_window`** в `CATEGORY_CONFIG`, `FilterKey`, `REASON_LABELS`.
4. **`UserAction` interface** — добавлены `window_resolved_from`, `window_anchor_source` (для будущей UI-подсветки и диагностики).
5. **Summary** в `RetroApplyResult` дополнен `expired_source_window`, `window_fallback_applied`.

## 2. Dry-run на Cohort B (production)

### 2.1 Rule `ffe27040` (Подоходный налог с физлиц)

```json
{
  "missing_access": 1,
  "already_satisfied": 45,
  "condition_not_met": 67,
  "no_source_window": 0,           // было 1 — теперь 0
  "expired_source_window": 0,
  "window_fallback_applied": 3,    // 3 пользователя получили срок через tariff.access_days
  "reducible_by_rule": 0,
  "total": 113
}
```

### 2.2 Rule `6ba9727e` (Деньги BY 1 тариф)

```json
{
  "missing_access": 3,             // ранее эти 3 уходили в no_source_window
  "already_satisfied": 110,
  "no_source_window": 0,           // было 3 — теперь 0
  "expired_source_window": 0,
  "window_fallback_applied": 3,
  "reducible_by_rule": 0,
  "total": 113
}
```

### 2.3 Regression user `3328ff3b-10ad-4295-aac9-51ef0419767e` (вся когорта BUSINESS)

```json
{
  "total": 0,
  "no_source_window": 0,
  "expired_source_window": 0,
  "window_fallback_applied": 0,
  "reducible_by_rule": 0
}
```

Никаких ложных срабатываний для regression-пользователя.

### 2.4 Admin canonicalize (auth gate)

Без `Authorization: Bearer <super_admin>` бэкенд отдаёт `401 admin_canonicalize_all_requires_auth` / `403 admin_canonicalize_all_requires_super_admin`. Защита из Stage 3 сохранена.

## 3. Destructive execute

В этом патче destructive execute (reducible/soft-expire/revoke/manual-override) **не запускался**.

- Cohort B на per-rule превью не показывает `reducible_by_rule` (все записи `already_satisfied` или `missing_access`).
- В UI-скриншоте пользователя `reducible=22` собиралась из объединённого скоупа «продукт». Этот execute пользователь запустит сам после визуальной проверки.

UI-сторона полностью готова:
- preflight включён;
- toast сигнализирует «успех / idempotent / ошибка»;
- автоматический switch фильтра показывает реальное состояние после execute.

## 4. DoD

| Критерий | Результат |
|---|---|
| `no_source_window` падает до 0 на Cohort B | ✅ (1+3 → 0+0) |
| Fallback по `tariff.access_days` применяется | ✅ `window_fallback_applied=3+3` |
| Anchor только из `sub.access_start_at`/`sub.created_at` | ✅ |
| `now()` НЕ используется как fallback anchor | ✅ |
| `expired_source_window` появилась как отдельная категория | ✅ |
| `expired_source_window` в `NEVER_EXECUTE_CATEGORIES` | ✅ |
| `previous_expires_at` и `reduction_reason` для reducible | ✅ |
| `audit_logs.meta` содержит `window_fallback_applied` | ✅ |
| Regression user `3328ff3b…` чистый | ✅ total=0 |
| Super_admin guard для admin mode сохранён | ✅ 401/403 |
| `toast.error` при `error`/`stop_reasons` | ✅ |
| `toast.success`/`toast.warning` различает idempotent skip | ✅ |
| Auto-switch фильтра на `changed` после execute | ✅ |
| Никаких destructive UPDATE | ✅ (не запускался в Stage 5) |
| `orders_v2`/`subscriptions_v2`/`access_rules` без изменений | ✅ |

## 5. Артефакты

- `supabase/functions/rules-retroapply/index.ts`
- `src/components/admin/product/RetroApplyPanel.tsx`
- `.lovable/proofs/retroapply_stage_5_window_fallback_and_execute_ux_2026_05.md`
- `/mnt/documents/retroapply_stage_5_window_fallback_and_execute_ux_2026_05.csv`
