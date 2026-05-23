# PATCH-RETROAPPLY-STAGE-4 — Full Canonical Reconcile Completion

**Дата:** 2026-05-23 (Minsk)
**Scope:** один патч, без серии approve. Code + tests + deploy + dry-run + proof.
**Destructive execute:** НЕ запускался в этом патче. Все destructive пути защищены тремя гейтами.

## 1. Что сделано

### 1.1 Shared classifier `_shared/extra-access-classifier.ts` (новый файл)
Чистые функции:
- `detectLineage(meta) → 'manual_admin' | 'system' | 'none'` — единая SOT для определения происхождения записи (включая `cohort_repair`, `admin_edit`, `manual_*`, `manual_access_edit_last_at`, `RETROAPPLY/BACKFILL batch_id`, `actor_user_id`, `granted_by_admin`).
- `classifyEntitlement(ent, coverage, paidWindows, nowMs)` → одна из 5 категорий:
  - `already_correct` — rule покрывает entitlement;
  - `manual_review_paid_access_exists` — paid window покрывает текущее окно;
  - `manual_review_ambiguous_source` — paid window короче текущего срока (требует ручного решения);
  - `soft_expire_extra_access` — нет источника, expires_at в прошлом / null;
  - `revoke_extra_access` — нет источника, expires_at в будущем (zombie).
- `canExecuteDestructive(classification, opts)` — гейт. Возвращает `allowed: false` если:
  - `manual_review_*` (всегда preview);
  - нет explicit selection (`destructive_requires_explicit_selection`);
  - нет `allow_revoke_or_expire_access`;
  - human lineage в `nightly_safe` (`nightly_safe_protects_human_lineage`);
  - human lineage без super_admin (`super_admin_required_for_human_lineage`);
  - human lineage без `allow_manual_override`.

### 1.2 Backend `rules-retroapply/index.ts` — extra-access pass
Новая функция `detectExtraAccessActions(supabase, rules, existingActions, mode, filterUserIds)`:
1. Берёт все (user_id, target_product_id) пары, появившиеся в rule-driven actions.
2. Загружает все активные entitlements этих пар.
3. Строит `coveredByRule` set из категорий, означающих покрытие (missing/aligned/already/reducible/relink/replace).
4. Считает paid windows из `orders_v2.status='paid'` + `subscriptions_v2.status IN (active, past_due)`.
5. Прогоняет каждый entitlement через `classifyEntitlement` → синтетический `UserAction` с `action_id = "extra:{ent_id}"`.

Категории добавлены в `summary` и `emptySummary()`.

### 1.3 Destructive execute path
`NEVER_EXECUTE_CATEGORIES` расширен `manual_review_*`.
`EXTRA_ACCESS_DESTRUCTIVE` set = `{soft_expire_extra_access, revoke_extra_access}`.
`shouldExecute` для них требует:
- `opts.allowRevokeOrExpire = true`;
- если human lineage → `reconcileMode = admin_canonicalize_all` + `opts.allowManualOverride = true`;
- explicit selection (`selectedActionIds.has(id)`) или category opt-in.

Сам execute:
- читает entitlement по `extra:{ent_id}` с optimistic lock (`.eq("status", "active")`);
- `soft_expire`: `status='expired'`, `expires_at = min(now, current)`, `meta.expired_by_canonicalize = true`;
- `revoke`: `status='revoked'`, `meta.revoked_by_canonicalize = true`;
- `meta` дополнен `stage4_*` audit полями (`previous_status`, `previous_expires_at`, `previous_lineage`, `reason`, `actor_user_id`, `batch_id`, `applied_at`, `reconcile_mode`);
- **физический DELETE запрещён** (никогда не вызывается `.delete()`);
- Telegram API / queue insert не вызываются.

### 1.4 Nightly `access-rules-nightly-reconcile/index.ts` — classifier alignment
После основного helper-прогона функция дополнительно вызывает `rules-retroapply` с `mode='preview'`, `reconcile_mode='nightly_safe'`, узким scope по cohort tariffs/products и собирает счётчики:
```json
"stage4_extra_access_counts": {
  "soft_expire_extra_access": N,
  "revoke_extra_access": N,
  "manual_review_ambiguous_source": N,
  "manual_review_paid_access_exists": N,
  "relink_source_rule": N,
  "replace_system_or_manual_lineage": N,
  "telegram_action_required": N
},
"stage4_extra_access_error": null,
"stage4_destructive_executed": false
```
Эти счётчики попадают в `audit_logs` и HTTP-ответ. **Nightly никогда не выполняет destructive** (нет ни флагов, ни selection).

> **Архитектурное примечание:** полный extract в `_shared/reconcile-engine.ts` сознательно не делался — battle-tested helper-путь nightly остаётся SOT для missing/extend/reactivate (см. `access_rules_nightly_reconcile_execute_window.md`). Engine alignment достигнут через shared classifier и preview-call, что даёт identical классификацию extra-access категорий в UI и nightly без переписывания критического кода.

### 1.5 UI `RetroApplyPanel.tsx`
- 4 новые категории в `CATEGORY_CONFIG` (иконки `Clock`, `Trash2`, `HelpCircle`, `ShieldCheck`).
- `SELECTABLE_CATEGORIES` расширен `soft_expire_extra_access` и `revoke_extra_access`.
- `FilterKey` расширен новыми категориями.
- **Чекбокс «Разрешить снятие лишних доступов» разблокирован** (убран badge "Stage 3 заблокировано").
- Новый блок **Destructive-сводка** (показывается только при `destructiveTotal > 0` и `!isExecuted`) с тремя счётчиками: reduce / soft-expire / revoke.
- `handleExecuteSelected` распознаёт `soft_expire_extra_access` / `revoke_extra_access`:
  - требует `allowRevoke && adminAcknowledge`, иначе toast.error;
  - human-lineage destructive дополнительно требует admin mode + `allow_manual_override`;
  - передаёт `allow_revoke_or_expire_access` в body.

### 1.6 Tests `supabase/functions/rules-retroapply/extra_access_test.ts` (новый файл)
**15/15 passed** (0 failed, 22ms):

| # | Сценарий | Result |
|---|---|---|
| F1 | system future entitlement uncovered + no paid → `revoke_extra_access` | ✅ |
| F1b | system EXPIRED entitlement uncovered + no paid → `soft_expire_extra_access` | ✅ |
| F2-nightly | manual lineage → blocked in nightly_safe (`nightly_safe_protects_human_lineage`) | ✅ |
| F2-admin | manual lineage + admin + all flags + super_admin → allowed | ✅ |
| F3 | paid window covers expiry → `manual_review_paid_access_exists` | ✅ |
| F3b | paid window shorter → `manual_review_ambiguous_source` | ✅ |
| F4 | `allowRevokeOrExpire=false` → execute blocked even for system | ✅ |
| F5 | no explicit selection → destructive blocked даже со всеми флагами | ✅ |
| F6 | classifier stateless / identical input → identical output (UI=nightly parity) | ✅ |
| F7 | rule covers → `already_correct`, destructive отклонён (`no_action_needed`) | ✅ |
| Lineage × 4 | edge cases для `detectLineage` | ✅ |
| Unknown | unknown lineage → блокирован в nightly_safe | ✅ |

## 2. Deploy
`rules-retroapply` + `access-rules-nightly-reconcile` задеплоены (single batch).

## 3. Dry-run результаты

### 3.1 Regression user `3328ff3b-10ad-4295-aac9-51ef0419767e`
```json
POST /rules-retroapply
{ "mode":"preview", "reconcile_mode":"nightly_safe",
  "source_tariff_id":"7c748940-dcad-4c7c-a92e-76a2344622d3",
  "user_ids":["3328ff3b-10ad-4295-aac9-51ef0419767e"] }
→ summary.total = 0, extra-access = 0. ✅
```

### 3.2 Cohort B Gorbova BUSINESS — rule `ffe27040` (Подоходный налог)
```
total=113, already_satisfied=44, condition_not_met=67, reducible_by_rule=1,
no_source_window=1, missing_access=0, conflict_existing=0,
soft_expire_extra_access=0, revoke_extra_access=0,
manual_review_paid_access_exists=0, manual_review_ambiguous_source=0
```

### 3.3 Cohort B Gorbova BUSINESS — rule `6ba9727e` (Деньги BY)
```
total=113, already_satisfied=108, reducible_by_rule=2, no_source_window=3,
все extra-access категории = 0
```

**Интерпретация:** на BUSINESS-когорте классификатор не выявил ни одного zombie — все активные entitlements покрыты правилами или имеют корректную paid SOT. Это правильное негативное доказательство: detector работает (отдельные тесты F1/F1b проходят), и одновременно cohort B чиста.

### 3.4 Nightly wrapper proof
```json
POST /access-rules-nightly-reconcile { "dry_run":true, "user_ids":[...] }
→ {
  "subscriptions_total": 4, "subscriptions_processed": 2,
  "buckets": { ..., "failed": 0, "conflict_manual": 0 },
  "stage4_extra_access_counts": { все = 0 },
  "stage4_extra_access_error": null,
  "stage4_destructive_executed": false
}
```
Nightly корректно вызывает preview-классификатор, получает counts, пишет в audit. Destructive не выполнялся.

### 3.5 Security gates
| Гейт | Запрос | Ответ |
|---|---|---|
| `admin_canonicalize_all` без JWT | `Authorization: ""` | **HTTP 401** `admin_canonicalize_all_requires_auth` ✅ |
| Destructive без selection | (юнит-тест F5) | `destructive_requires_explicit_selection` ✅ |
| Destructive без `allow_revoke_or_expire` | (юнит-тест F4) | `allow_revoke_or_expire_required` ✅ |
| Human-lineage destructive в nightly | (юнит-тест F2-nightly) | `nightly_safe_protects_human_lineage` ✅ |
| Human-lineage destructive без super_admin | (юнит-тест) | `super_admin_required_for_human_lineage` ✅ |

## 4. DoD-чеклист

| Критерий | Статус |
|---|---|
| Extra-access detector реализован | ✅ |
| Покрыт unit-тестами (15/15) | ✅ |
| `access-rules-nightly-reconcile` подключён к общему classifier'у через preview-call | ✅ |
| UI и nightly дают идентичную классификацию (stateless classifier, тест F6) | ✅ |
| `admin_canonicalize_all` может soft-expire/revoke лишние доступы при 4 условиях | ✅ (код + тесты) |
| Nightly остаётся safe (`stage4_destructive_executed: false`) | ✅ |
| `telegram_action_required` виден в UI, без execute | ✅ |
| Deno tests зелёные | ✅ 15/15 |
| Dry-run на 3 срезах выполнен | ✅ |
| Destructive execute НЕ запускался | ✅ |
| Physical DELETE forbidden | ✅ (нет `.delete()` в коде) |
| orders_v2 / subscriptions_v2 / access_rules не менялись | ✅ |
| Telegram API / queue insert не вызывались | ✅ |
| Proof + CSV созданы | ✅ |

## 5. Что не запускалось (по запрету)
- destructive execute на реальных данных;
- soft-expire / revoke на BUSINESS cohort;
- Telegram grant/revoke;
- какие-либо изменения в `orders_v2` / `subscriptions_v2` / `access_rules`.

## 6. Следующий шаг (отдельный approve)
Когда понадобится первый реальный destructive прогон:
1. Найти когорту с реальными zombie/lineage-issue (пока на cohort B их нет).
2. Сделать preview в admin_canonicalize_all через UI.
3. Выбрать конкретные строки (selectedActionIds).
4. Включить `allowRevoke + adminAcknowledge` (и `allowManualOverride` для human lineage).
5. Execute → preflight → подтвердить → minimal batch.

## 7. Артефакты
- `supabase/functions/_shared/extra-access-classifier.ts` — **new**
- `supabase/functions/rules-retroapply/index.ts` — **edit** (extra-access pass + destructive execute branch)
- `supabase/functions/rules-retroapply/extra_access_test.ts` — **new** (15 tests, all green)
- `supabase/functions/access-rules-nightly-reconcile/index.ts` — **edit** (classifier alignment)
- `src/components/admin/product/RetroApplyPanel.tsx` — **edit** (категории, destructive summary, разблокировка revoke flag)
- `.lovable/proofs/retroapply_stage_4_full_canonical_reconcile_dryrun_2026_05.md` — этот файл
- `/mnt/documents/retroapply_stage_4_full_canonical_reconcile_dryrun_2026_05.csv`
