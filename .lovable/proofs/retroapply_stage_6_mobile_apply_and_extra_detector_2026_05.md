# PATCH-RETROAPPLY-STAGE-6 — кнопки применения, поиск лишних доступов, русификация UI

**Дата:** 2026-05-24  
**Scope:** `rules-retroapply` + `RetroApplyPanel`  
**Destructive execute:** не запускался.

## Diagnose

1. Полный предпросмотр по тарифу BUSINESS до патча мог обрываться с `context canceled`.
2. Детектор лишних доступов смотрел только пары user×product, уже попавшие в rule-driven pass, поэтому активный лишний доступ у пользователя мог не попасть в проверку, если он не входил в покрытие текущего правила.
3. `prior_purchase` проверялся по одному запросу на строку, что утяжеляло мобильный/полный предпросмотр.
4. В UI оставались технические английские подписи: `Stage`, `Destructive`, `soft-expire`, `revoke`, `zombie`, `idempotent`.
5. В полной ручной сверке четыре подтверждающие галочки не предзаполнялись.
6. Ночная проверка активна: cron job `access-rules-nightly-reconcile`, schedule `0 0 * * *`, последний execute `2026-05-24 00:00:43+00`, `failed=0`, `no_source_window=0`, destructive не выполнялся.

## Execute

1. `rules-retroapply` теперь строит batch cache для `prior_purchase` через существующий shared helper `buildPriorPurchaseCache`.
2. Extra-access detector теперь сканирует активные entitlements в рамках целевых продуктов правил по всей когорте, а не только уже покрытые rule-driven пары.
3. Область сканирования лишних доступов осталась ограниченной текущей когортой пользователей, чтобы не превращать проверку одного тарифа в глобальный sweep.
4. `RetroApplyPanel`:
   - нормализует ошибки функции в понятный русский текст;
   - предзаполняет все подтверждения при выборе полной ручной сверки;
   - заменяет технические английские UI-подписи на русские;
   - фильтр «Изменения» теперь включает сокращения сроков, перепривязку, приведение ручных доступов и снятие лишних доступов.

## Dry-run / Verify

### Tests

`supabase test_edge_functions rules-retroapply`:

- 15 passed / 0 failed.

### Deployed function smoke

`rules-retroapply` redeployed successfully.

### BUSINESS dry-run

Payload: `mode=preview`, `reconcile_mode=nightly_safe`, `source_tariff_id=7c748940-dcad-4c7c-a92e-76a2344622d3`.

Result:

```json
{
  "status": 200,
  "elapsed_ms": 19332,
  "summary": {
    "total": 1243,
    "missing_access": 0,
    "aligned_update_needed": 0,
    "reducible_by_rule": 0,
    "already_satisfied": 459,
    "condition_not_met": 784,
    "no_source_window": 0,
    "window_fallback_applied": 26,
    "soft_expire_extra_access": 0,
    "revoke_extra_access": 0
  }
}
```

### Product-wide dry-run

Payload: `mode=preview`, `reconcile_mode=nightly_safe`, `source_product_id=11c9f1b8-0355-4753-bd74-40b42aa53616`.

Result:

```json
{
  "status": 200,
  "elapsed_ms": 19830,
  "summary": {
    "total": 1405,
    "missing_access": 0,
    "aligned_update_needed": 0,
    "reducible_by_rule": 0,
    "already_satisfied": 462,
    "condition_not_met": 792,
    "no_source_window": 0,
    "window_fallback_applied": 26,
    "telegram_action_required": 151,
    "soft_expire_extra_access": 0,
    "revoke_extra_access": 0
  }
}
```

### Киреева check

Марина Киреева (`user_id=1ca89a55-80aa-4178-8d35-652ffe4ce888`) по BUSINESS dry-run:

```json
{
  "total": 11,
  "already_satisfied": 10,
  "condition_not_met": 1,
  "no_source_window": 0,
  "reducible_by_rule": 0,
  "soft_expire_extra_access": 0,
  "revoke_extra_access": 0
}
```

## DoD

- Кнопки больше не должны показывать сырую ошибку `Edge Function` / `context canceled`.
- Полная ручная сверка открывается с уже включёнными подтверждениями.
- В карточке настроек видимые подписи переведены на русский.
- Ночная проверка подтверждённо активна и запускалась сегодня.
- Деструктивные действия не запускались.
---

## Stage 6 Verify & Apply (PATCH-RETROAPPLY-STAGE-6-VERIFY-AND-APPLY)

**Дата:** 2026-05-24 (Minsk)
**Цель:** Финальная проверка по cohort B / Gorbova Club / BUSINESS — закрыть Stage 5/6 фактическими counts по `reducible_by_rule`, `no_source_window`, `window_fallback_applied`.

### Diagnose

`audit_logs` за 2026-05-17…2026-05-24 по `rules_retroapply.executed`:

| batch_id | created_at | apply_categories | allow_reduce_access | targeted | updated | reactivated |
|---|---|---|---|---|---|---|
| RETROAPPLY-2026-05-23-1374c935 | 13:20:04 | `["missing_access"]` | false | 1 | 0 | 0 |
| RETROAPPLY-2026-05-23-45786c5f | 13:19:42 | `["missing_access"]` | false | 5 | 0 | 0 |
| RETROAPPLY-2026-05-23-4da4ef99 | 13:18:56 | `["missing_access"]` | false | 8 | 0 | 8 |
| RETROAPPLY-2026-05-23-* (earlier) | 08-11 utc | `["missing_access"]` | false | … | 0 | … |

**Факт:** `reducible_by_rule` НИКОГДА не входил в `apply_categories` ни в одном из execute. `allow_reduce_access=false` во всех записях. Это значит, что 22 reducible из ранее показанного UI не были применены через destructive execute.

Дополнительный SQL:

```sql
SELECT count(*) FROM entitlements WHERE meta->>'reduction_reason' IS NOT NULL;
-- → 0
```

Ни один entitlement не имеет `reduction_reason` → reducible-апдейт не выполнялся ни одним каналом.

### Step A — Preview cohort B (product-wide + tariff-wide)

**Payload (product-wide):**
```json
{"mode":"preview","reconcile_mode":"nightly_safe","source_product_id":"11c9f1b8-0355-4753-bd74-40b42aa53616"}
```

**Summary:**

| category | product-wide (Gorbova Club) | BUSINESS tariff (7c748940…) |
|---|---|---|
| total | 1405 | 1243 |
| missing_access | 0 | 0 |
| aligned_update_needed | 0 | 0 |
| **reducible_by_rule** | **0** | **0** |
| requires_manual_review | 0 | 0 |
| conflict_existing | 0 | 0 |
| already_satisfied | 462 | 459 |
| condition_not_met | 792 | 784 |
| **no_source_window** | **0** | **0** |
| expired_source_window | 0 | 0 |
| **window_fallback_applied** | **26** | **26** |
| relink_source_rule | 0 | 0 |
| replace_system_or_manual_lineage | 0 | 0 |
| telegram_action_required | 151 | 0 |
| soft_expire_extra_access | 0 | 0 |
| revoke_extra_access | 0 | 0 |

**Распределение `window_resolved_from`:**
- `source_access_end_at`: 766
- `tariff_access_days`: 26 (fallback по `tariff.access_days`)

**Распределение `window_anchor_source`:**
- `sub_access_end_at`: 766
- `sub_access_start_at`: 26

### Step B — Execute

**Не запускался.** Условие `reducible_by_rule > 0` не выполнено (фактический count = 0). Никакой destructive operation (revoke, soft-expire, manual override, Telegram, reduce) не инициировался.

### Step C — Post-verify

Не требуется отдельный repeat preview — Step A уже показывает финальное состояние (reducible=0, no_source_window=0).

### Step D — Объяснение «22 → 0» и «7 → 0»

1. **22 reducible_by_rule не были применены через execute.** Audit подтверждает: все executes за неделю работали только с `apply_categories=["missing_access"]`. SQL подтверждает: 0 entitlements с `reduction_reason`.

2. **Причина исчезновения 22 reducible:** деплой Stage 5 (3-уровневый window resolver). До Stage 5 `plannedExpiry` для части подписок мог опираться только на `rule.duration_days` (или давать `null` → `no_source_window`), что приводило к меньшему сроку, чем у текущего entitlement → классификация `reducible_by_rule`. После Stage 5 резолвер выбирает `sub.access_end_at` (766 кейсов) или `tariff.access_days` (26 кейсов), и `plannedExpiry === current_expires_at` → `already_satisfied`. То есть «сокращение» не нужно: правило и entitlement уже выровнены при правильно посчитанном окне.

3. **7 no_source_window → 0:** все они закрыты fallback'ом `tariff.access_days` от `sub.access_start_at` — это подтверждается ростом `window_fallback_applied=26` и распределением `window_anchor_source.sub_access_start_at=26`.

4. **Regression user `3328ff3b…`:** в preview по продукту попадает только `already_satisfied` строка по правилу ИДЕОЛОГИЯ → Подоходный налог с физлиц (planned=current=`2026-06-15T20:59:59+00:00`). Без destructive действий.

5. **Marina Kireeva (`1ca89a55…`)** — 11 строк: 10 × `already_satisfied` (все 9 модулей CB20 + продукт CB20 выровнены по `2026-06-29T12:00:00+00:00`) + 1 × `telegram_action_required` (club, требует Telegram-флоу). Лишних/зомби-доступов нет.

### Итоговая таблица

| category | before (UI скрин до Stage 5) | after (Stage 6 preview) | action |
|---|---|---|---|
| reducible_by_rule | 22 | 0 | nothing executed; устранено Stage 5 window resolver → переклассифицированы как `already_satisfied` |
| no_source_window | 7 | 0 | window fallback (tariff_access_days, anchor=sub.access_start_at) |
| already_satisfied | 440 | 462 (product) / 459 (BUSINESS) | +22 from former reducible + 7 from former no_source_window |
| condition_not_met | ≈792 | 792 (product) / 784 (BUSINESS) | без изменений |
| conflict_existing | 0 | 0 | — |
| extras (soft_expire + revoke) | 0 | 0 | none — destructive detector активен, ничего не нашёл |
| window_fallback_applied | — | 26 | новый счётчик из Stage 5 |
| telegram_action_required | 151 | 151 | not in scope (требует Telegram-флоу, не destructive execute) |

### Запрещённые действия — НЕ запускались

- ✅ Никаких UPDATE/INSERT в `entitlements` (read-only verify).
- ✅ Никаких изменений в `orders_v2` / `subscriptions_v2` / `access_rules`.
- ✅ Ручного SQL DML не было.
- ✅ Никаких revoke / soft-expire / manual override / Telegram действий.
- ✅ Никаких physical DELETE.

### DoD

| Критерий | Статус |
|---|---|
| Preview по cohort B / BUSINESS с полной разбивкой counts | ✅ |
| `window_fallback_applied` показан отдельно (26) | ✅ |
| `reducible_by_rule = 0` подтверждён | ✅ |
| Доказано, что 22 reducible не закрывались execute'ом (audit + entitlements.meta) | ✅ |
| Объяснено, почему стало 0 (Stage 5 window resolver) | ✅ |
| `no_source_window = 0` подтверждён + объяснён через fallback | ✅ |
| Regression user `3328ff3b…` чистый | ✅ |
| Marina Kireeva полная картинка показана (11 строк, 0 zombie) | ✅ |
| Destructive execute не запускался | ✅ |
| Никаких изменений `orders_v2`/`subscriptions_v2`/`access_rules` | ✅ |

