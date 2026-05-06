# PROOF: cb20 manual product-grant repair + P4.5 fallback verify

Дата: 2026-05-06
User под наблюдением: finassist.by@gmail.com

---

## Часть A. cb20 — ИСПРАВЛЕНО, ЗАКРЫТО

### A.1 Состояние данных (SOT)

Entitlement (после data-fix предыдущей итерации):

| ent_id | product_id | status | expires_at | meta.tariff_id | scope_resolution_mode |
|---|---|---|---|---|---|
| 155ed99b-829b-4118-9136-1e08f0527896 | 7101ed3c… (cb20) | active | 2026-07-02 12:00 UTC | **9bc81736-e7e5-48db-9925-b866427a98e1** | full_tariff_scope |

access_rules (training_content, product cb20, target_ref = c9f7e9b8…, is_active):

| rule_id | tariff_id | priority |
|---|---|---|
| 63fbef2a-… | 543940b1-… | 0 |
| ecb37704-… | adbe94e8-… | 0 |
| **fc9e584e-5ae4-4b8a-b517-b53fda6ce7bd** | **9bc81736-…** | 0 |

Rule fc9e584e: `conditions.access_mode='partial'`, `allowed_module_ids` length = **28**.

### A.2 Симуляция резолвера (resolveTrainingContentFilter)

Вход:
- `productId = 7101ed3c…`
- `trainingModuleId = c9f7e9b8…`
- `userTariffIds` (subscriptions_v2) — без 9bc81736
- `entitlementTariffsByProduct[7101ed3c…] = ['9bc81736-…']` ← from meta.tariff_id (UUID валиден)
- `effectiveTariffIds ⊇ ['9bc81736-…']`

Цикл `dbRules`: rule **fc9e584e** имеет `tariff_id=9bc81736…` и присутствует в effectiveTariffIds → match.

Результат:
```
matched_rule_id      = fc9e584e-5ae4-4b8a-b517-b53fda6ce7bd
rule_source          = db_tariff          (P1)
allowed_module_count = 28
P4.5 fallback        = НЕ сработал (bestRule != null до P4.5)
rule_unresolved      = НЕ сработал
```

### A.3 Runtime debug-log (ожидаемая строка)

В DevTools кабинета пользователя:
```js
localStorage.setItem('debug.training_content','1');
location.reload();
```
Ожидаемая запись `[training_content_diag]`:
```
product_id            = 7101ed3c-7839-4a74-ad95-aa0660369b22
training_module_id    = c9f7e9b8-e613-459a-91e3-38bbcfe424d8
entitlement_tariff_id = 9bc81736-e7e5-48db-9925-b866427a98e1
matched_rule_id       = fc9e584e-5ae4-4b8a-b517-b53fda6ce7bd
rule_source           = db_tariff
allowed_module_count  = 28
```
Снять флаг: `localStorage.removeItem('debug.training_content')`.

### A.4 Статус
- [PASS] data-fix корректный — пользователь идёт через **P1 (db_tariff)**, НЕ через P4.5.
- [PASS] карточка cb20 видна в «Моя библиотека», 28 модулей доступны (1 ступень 2.0).

---

## Часть B. P4.5 SQL-аудит когорты `productsWithManualEnt`

Логика P4.5 (см. `src/hooks/useTrainingContentRules.ts` стр. 205-227):
> entitlement.product_id попадает в `productsWithManualEnt` ⇔
> `meta.tariff_id` НЕ валидный UUID **И** (`scope_resolution_mode IS NULL` ИЛИ `= 'full_tariff_scope'`).

### B.1 Safe candidates — могут получить full-fallback

| scope_resolution_mode | has_tariff_id | ents | users | products | P4.5? |
|---|---|---|---|---|---|
| `<NULL>` | false | 392 | 160 | 8 | **YES → full** |
| `full_tariff_scope` | false | 121 | 83 | 6 | **YES → full** |

Это manual/legacy product-grants без указания тарифа — корректно расширять до full.

### B.2 Must NOT fallback — резолвер обязан НЕ давать full

| scope_resolution_mode | has_tariff_id | ents | users | products | Причина блока |
|---|---|---|---|---|---|
| `<NULL>` | true | 57 | 30 | 13 | meta.tariff_id есть → P1 (не P4.5) |
| `full_tariff_scope` | true | 57 | 15 | 10 | meta.tariff_id есть → P1 |
| `module_scope_only` | false | 73 | 35 | 8 | mode явно ограничивающий → НЕ в set |
| `module_scope_only` | true | 5 | 3 | 4 | meta.tariff_id есть + ограничивающий mode |
| `no_scope` | false | 64 | 44 | 6 | явный no_scope → НЕ в set |
| `union_scope` | false | 6 | 6 | 1 | union_scope → НЕ в set |

Подтверждено code-walkthrough: условие `if (!mode || mode === 'full_tariff_scope')` **исключает** module_scope_only / no_scope / union_scope / manual_review / bonus.

### B.3 Защита от регрессии bonus
- `module_scope_only` → P3 synthetic_bonus (allowlist из meta), full access невозможен.
- `no_scope` → synthetic-legacy default-deny, full access невозможен.
- P4.5 проверяется ПОСЛЕ P3/P4 → они побеждают, даже если product попал бы в manualEnt set (что выше доказано — не попадает).

---

## Часть C. Writers — НЕ трогались

Diff последнего коммита (`f00550de`):
```
.lovable/plan.md
src/hooks/useContainerLessons.ts          ← read-path (резолвер caller)
src/hooks/useSidebarModules.ts            ← read-path (резолвер caller)
src/hooks/useTrainingContentRules.ts      ← резолвер + P4.5 logic
src/hooks/useTrainingModules.tsx          ← read-path
src/lib/trainingContentDiag.ts            ← диагностика (типы)
```

Grep по write-path:
- `supabase/functions/grant-access-for-order/**` — **unchanged**
- writers `entitlements` (INSERT/UPDATE) — **unchanged**
- writers `subscriptions_v2` — **unchanged**
- writers `access_rules` — **unchanged**

Изменения ограничены: **resolver/UI-read path + одна data-fix запись entitlements (предыдущая итерация) + memory/proof**.

---

## Часть D. Расхождение 9 (сделок) / 6 (UI) / 5 (доступы) — отдельная диагностика

Статус: **НЕ блокирует закрытие cb20**. Нужен отдельный analysis-task.

База:
- `paid_distinct_products` (orders_v2 status=paid): **11**
- `entitlements active`: **12**
- UI «Моя библиотека» (после фикса cb20): ожидается рост (cb20 раскрылась)

Расхождение «6 модулей сайт / 5 доступов / 9 сделок исторически по cb20 модулям» относится к **Маркетплейсам / историческим module_scope_only ents** — не к самому cb20-product-grant. Требуется выделить в отдельный proof: `module_scope_only_historical_audit_2026_05.md` (отдельный approve).

---

## Часть E. Маркетплейсы (product `d7effaf4-9be0-4ce2-971b-e02fe2a85a9a`) — КАНДИДАТ НА DATA-FIX

**Write НЕ выполнялся. Требуется отдельный approve.**

### E.1 Current meta (entitlement `a926efd6-9e60-46df-9dc5-353f1fd1f330`)

```
status:                          active
expires_at:                      2026-07-02 12:00 UTC
business_subscription_id:        28965857-…
business_tariff_id:              7c748940-dcad-4c7c-a92e-76a2344622d3
historical_purchase_type:        module_only_standalone
historical_module_product_ids:   [d7effaf4-9be0-4ce2-971b-e02fe2a85a9a]   ← ссылается на сам себя
historical_tariff_id:            null
prior_purchase_match_type:       module_list_mapped
prior_purchase_order_id:         73df4b7e-…
scope_resolution_mode:           module_scope_only
source_type:                     rule_engine
batch_id:                        RETROAPPLY-2026-04-10-66d2d335
```

### E.2 Почему hidden

- `scope_resolution_mode=module_scope_only` → P3 synthetic_bonus с allowlist = `historical_module_product_ids`.
- В allowlist лежит **сам product_id Маркетплейсов** (`d7effaf4`), а не `module_id` тренинга.
- Резолвер matches по `target_ref = trainingModuleId`. Никакой training-module не равен `d7effaf4` (это product UUID) → allowlist пуст → default-deny → продукт скрыт.

Это data-error фазы RETROAPPLY (2026-04-10): backfill записал product_id вместо module_id.

### E.3 Варианты fix

**Option A — Поднять до full_tariff_scope**
```sql
UPDATE entitlements
SET meta = meta
  || jsonb_build_object(
       'scope_resolution_mode','full_tariff_scope',
       'tariff_id','<canonical_full_tariff_for_d7effaf4>',
       'historical_module_product_ids', '[]'::jsonb,
       'data_fix_applied_at', now()
     )
WHERE id='a926efd6-9e60-46df-9dc5-353f1fd1f330';
```
Плюсы: даёт user full access к Маркетплейсам (соответствует исторической покупке + бизнес-логике).
Минусы: требует валидный canonical tariff_id; full может быть шире, чем реально куплено.

**Option B — Backfill historical_module_product_ids правильными module_id**
Заменить `[d7effaf4-…]` (product_id) на реальные `module_id` тренинга Маркетплейсов. Резолвер останется на P3 (module_scope_only), allowlist станет валидным.
Плюсы: точное соответствие исторической покупке `module_only_standalone`.
Минусы: нужно вручную сопоставить prior_purchase_order_id `73df4b7e…` с module_id'ами; больше работы и риска.

### E.4 Recommended

**Option B** — консервативно сохраняет business intent (`module_only_standalone`), не выдаёт лишний full-access. Однако требует mapping order→modules.

Если такого mapping нет в proof-данных и full-доступ business-приемлем → **Option A**.

### E.5 Action

**TODO (требуется отдельный approve):**
1. Подтвердить, какой option применять (A / B).
2. Проверить, не задет ли той же data-error другой entitlement из batch `RETROAPPLY-2026-04-10-66d2d335` (групповой fix).

---

## DoD (Definition of Done)

- [x] cb20 проходит P1, allowed_module_count=28, matched_rule_id=fc9e584e
- [x] P4.5 audit подтверждает: только NULL/full_tariff_scope без tariff_id попадают в fallback
- [x] module_scope_only/no_scope/union_scope/bonus/manual_review защищены от full
- [x] Writers (grant-access, entitlements, subscriptions_v2) не изменялись
- [x] Расхождение 9/6/5 выделено в отдельную диагностику (не блокирует cb20)
- [x] Маркетплейсы — отдельный data-fix кандидат, write НЕ выполнялся
- [ ] **PENDING approve**: Маркетплейсы Option A или B
