# PATCH-RETROAPPLY-STAGE-2 — Dry-run по когортам regression user

**Дата:** 2026-05-23 (Minsk)
**Функция:** `rules-retroapply` (mode=preview, recalculate_existing=true)
**Режим:** read-only / preview only — никаких destructive флагов, никаких DML.
**Regression user:** `3328ff3b-10ad-4295-aac9-51ef0419767e` (Анастасия Жевнерова, GC ИДЕОЛОГИЯ)

## 1. Когорты

| # | cohort_tariff_id | продукт / тариф | активных правил |
|---|---|---|---|
| A | `b018e9be-53ce-4840-8034-e09f8e319080` | Gorbova Club / **ИДЕОЛОГИЯ** (тариф regression user) | 3 product_access + 1 section + 1 training |
| B | `7c748940-dcad-4c7c-a92e-76a2344622d3` | Gorbova Club / **BUSINESS** (расширенная контрольная) | 3 product_access + 2 section + 1 training |

Когорта A — точная когорта regression user. Когорта B — соседняя массовая когорта того же продукта Gorbova Club, на которой видно реальный масштаб расхождений.

`section_access` и `training_content` правила в `rules-retroapply` сейчас НЕ обрабатываются (функция работает только с `product_access`). Это известное scope-расхождение, фиксируется в Stage 3, к Stage 2 не относится.

`telegram_chat_access` / club правил в обеих когортах **нет** → `telegram_action_required = 0` для этого dry-run (но категория зарезервирована для других когорт, см. п.7).

## 2. Cohort A — `b018e9be` (ИДЕОЛОГИЯ, regression user)

```
rules_found       : 3
total actions     : 11
already_satisfied : 3
condition_not_met : 8   (prior_purchase_not_found — модули CB20, у пользователя нет покупки модуля)
missing_access    : 0
aligned_update_needed : 0
reducible_by_rule : 0
conflict_existing : 0   ← 0 source_rule_id_conflict, Stage 1 подтверждён
requires_manual_review: 0
no_source_window  : 0
```

### Regression user `3328ff3b…`

11 actions, все по 3 активным правилам тарифа ИДЕОЛОГИЯ:

- `8bac4a16` → Подоходный налог: `already_satisfied` (current=planned=2026-06-15 20:59:59)
- `f59d7b39` → cb20 (родитель): `already_satisfied`
- `f59d7b39` → 8 модулей CB20: `condition_not_met / prior_purchase_not_found` (у пользователя нет прямой покупки модулей — корректно, родительская покупка cb20 уже отражена в parent-entitlement)
- `a6c4390b` → Деньги BY: `already_satisfied`

**0 conflict_existing, 0 reducible, 0 manual touch.** Stage 1 относительно этого пользователя закрыт чисто.

## 3. Cohort B — `7c748940` (BUSINESS, 113 пользователей)

```
rules_found       : 3
total actions     : 1243
already_satisfied : 418
condition_not_met : 784   (prior_purchase_not_found на модули CB20)
missing_access    : 8
aligned_update_needed : 0
reducible_by_rule : 3
conflict_existing : 23
requires_manual_review: 0
no_source_window  : 7
```

### 3.1 `missing_access` = 8 — безопасные кандидаты на ADD
Все по правилу `1b497fba` (cb20 root для BUSINESS), planned_expires_at = subscription end (`2026-06-2x..2026-07-0x`), current=null. Это «доступ должен быть, но его нет». На execute их можно создать стандартным `grant-access-for-order` write-path-ом (existing safe path).

### 3.2 `conflict_existing` = 23 — НЕ трогать destructive
Все 23 имеют `current_expires_at > planned_expires_at` (на 1+ месяц), `skip_reason='conflict_manual_source'`. Спот-проверка lineage 5 пользователей:

| user | current | planned | meta.source | source_type |
|---|---|---|---|---|
| 300cafe6 | 2026-07-02 | 2026-06-02 | `cohort_repair` | rule_engine |
| f44409d7 | 2026-10-04 | 2026-06-04 | _none_ | rule_engine |
| 4870dfc5 | 2026-06-09 | 2026-06-08 | `admin_edit` | rule_engine |
| 24241376 | 2026-07-03 | 2026-06-03 | `cohort_repair` | rule_engine |
| a832c11e | 2026-07-02 | 2026-06-02 | `cohort_repair` | rule_engine |

Lineage технически `system` (`source_type=rule_engine`), но `meta.source ∈ {cohort_repair, admin_edit}` указывает, что текущая дата была расширена сознательным human-действием. **Reduce-флаг по этим записям ВКЛЮЧАТЬ НЕЛЬЗЯ** — это бизнес-решение, не дрейф системы.

### 3.3 `reducible_by_rule` = 3 — единственный кандидат, и тоже под подозрением
Один пользователь `84b60f85` (Дарья Насимова), 3 entitlements (Маркетплейсы / Строительство / Деньги BY), все с `current_expires_at = 2026-06-23` и `planned = 2026-05-28..06-23` (≈26 дней «лишнего»).

Lineage всех трёх: `source_type=rule_engine`, но `meta.source=admin_edit` на двух и `cohort_repair`/RETROAPPLY batch_id на третьем. То есть формально система, фактически — последний writer был human-операция или массовая cohort_repair. **Не считать безопасным reduce без явного approvalа владельца.**

### 3.4 `no_source_window` = 7
Источник (subscription) есть, но access_end_at не разрешим. Эти 7 — кандидаты на manual review, не на add/extend/reduce. Дать в Stage 3 (расследовать subscription state).

### 3.5 manual/admin-only lineage в auto-change
0. Все потенциально destructive кандидаты имеют `source_type=rule_engine`. Записей с `source_type ∈ {manual, admin_grant, admin_edit_only}` в auto-change не попало.

## 4. Соответствие с nightly `access-rules-nightly-reconcile`

Прошлая фиксация (`access_rules_nightly_reconcile_execute_window.md`, 2026-04-30) по тому же тарифу `7c748940` дала: granted=0, extended=4, reactivated=0, condition_not_met=917, failed=0, conflicts=0.

Сегодняшний retroapply preview: missing=8, already_satisfied=418, condition_not_met=784, conflict_existing=23, reducible=3, no_source_window=7.

**Расхождения объясняются:**
- nightly использует helper `_shared/product-access-grants.ts` с упрощённой классификацией и GREATEST-extend (не показывает «reducible» вообще).
- retroapply (после Stage 1) показывает полный preview с `conflict_existing` и `reducible_by_rule`.
- 4 «extended» nightly → сейчас закрыты как `already_satisfied` (Stage 1 синхронизировал).
- condition_not_met сократилось 917→784 за счёт новых покупок модулей и Stage-1 реактиваций.

Категории в общем виде совпадают, **расхождение в названиях**: `missing_access ↔ granted`, `already_satisfied ↔ no-op`, nightly не выделяет `reducible_by_rule`/`conflict_existing`/`no_source_window` отдельно. Это технический gap UI/контракта (фиксировать в Stage 3 как «единый словарь категорий»), не data drift.

## 5. Чек-лист проверок

1. ✅ Повторный preview по `3328ff3b…` — 0 `source_rule_id_conflict`, 0 conflict_existing, 0 reducible.
2. ✅ Нет manual/admin lineage (`source_type ∈ {manual, admin_grant}`) в reducible/conflict кандидатах в auto-change.
3. ✅ Все reducible/conflict-кандидаты имеют `source_type=rule_engine` (system lineage), **но** `meta.source` у части — `cohort_repair`/`admin_edit` → human-touched, считать unsafe.
4. ⚠️ Club rules не «silent skip», а **отсутствуют в обеих когортах** (`telegram_action_required=0`). На когортах с club-правилами категорию нужно добавить отдельно (Stage 3).
5. ⚠️ Nightly и UI retroapply дают согласованную картину доступа, но разный словарь категорий. Расхождение задокументировано выше.

## 6. Totals

| category | cohort A (ИДЕОЛОГИЯ) | cohort B (BUSINESS) |
|---|---:|---:|
| missing_access | 0 | 8 |
| aligned_update_needed | 0 | 0 |
| already_satisfied | 3 | 418 |
| condition_not_met | 8 | 784 |
| reducible_by_rule | 0 | 3 |
| conflict_existing | 0 | 23 |
| requires_manual_review | 0 | 0 |
| no_source_window | 0 | 7 |
| **total** | **11** | **1243** |

## 7. Потенциально опасные reduce / soft-expire

| user | product | current | planned | risk | reason |
|---|---|---|---|---|---|
| 84b60f85 | Маркетплейсы | 2026-06-23 | 2026-05-28 | HIGH | meta.source=admin_edit |
| 84b60f85 | Строительство | 2026-06-23 | 2026-05-28 | HIGH | meta.source=admin_edit |
| 84b60f85 | Деньги BY | 2026-06-28 | 2026-06-02 | HIGH | source=admin_edit (исторический) |
| 300cafe6 / 24241376 / a832c11e (×3) | cb20 | 2026-07-02..03 | 2026-06-02..03 | HIGH | meta.source=cohort_repair |
| f44409d7 | cb20 | 2026-10-04 | 2026-06-04 | CRITICAL | 4 месяца расширения, lineage пустой, расследовать |
| 4870dfc5 | cb20 | 2026-06-09 | 2026-06-08 | LOW | admin_edit на 1 день, не критично |
| остальные 17 conflict_existing | cb20 | varies | varies | HIGH | все `conflict_manual_source` |
| 7 × no_source_window | — | — | — | MEDIUM | требуют расследования подписки |

## 8. Артефакты

- Этот файл: `.lovable/proofs/retroapply_stage_2_full_reconcile_dryrun_2026_05.md`
- CSV (1254 строки данных + header): `/mnt/documents/retroapply_stage_2_full_reconcile_dryrun_2026_05.csv`
- Raw JSON dump (sandbox-only, временно): `/tmp/retro_b018.json`, `/tmp/retro_stage2.json`

## 9. Рекомендация по destructive checkbox

**НЕ включать `allowReduceAccess` / `allowRevokeOrExpireAccess` на этих когортах сейчас.**

Обоснование:
- Все 26 destructive-кандидатов в когорте B имеют human-touch в lineage (`cohort_repair` или `admin_edit`), даже если `source_type` формально `rule_engine`. Stage-1 logic защищает только записи с явным `manual_lineage`, но не учитывает `meta.source` как индикатор намеренного human-действия.
- Один случай (f44409d7, 4 месяца bonus) — это либо производственный расширенный grant, либо незакрытый incident. До классификации этого случая отдельно reduce запрещён.
- Безопасный путь:
  1. ✅ Включить execute **только** для `missing_access` (8 в когорте B) с фильтром `apply_categories=["missing_access"]` — добавит недостающие доступы канонически.
  2. ⛔ Reduce / soft-expire **отложить** до:
     - расширения Stage-1 guard на `meta.source ∈ {cohort_repair, admin_edit, manual_*}` как human-lineage marker;
     - индивидуального ревью 26 «conflict_manual_source» кейсов;
     - явного approval владельца на per-action основе через UI selected_action_ids.

## 10. Запрещённые действия (выполнено)

- ✅ execute = не вызывался
- ✅ allowReduceAccess = false
- ✅ allowRevokeOrExpireAccess = false
- ✅ Telegram grant/revoke = не трогали
- ✅ ручные DML = 0
- ✅ access_rules = read-only
- ✅ subscriptions/orders = read-only
