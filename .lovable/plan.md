# План: PATCH G → E → B — нормализация + repair + proof

## Главная цель спринта

1. Нормализовать 7 multi-module historical orders (PATCH G)
2. Выдать/восстановить корректные standalone entitlements (PATCH E)
3. Доказать срок доступа и runtime visibility на reference-cases

## Статусы патчей

| Patch | Статус |
|---|---|
| PATCH F | ✅ done / verify only |
| PATCH C | ✅ done / verify only |
| PATCH D | ⏳ proof base ready |
| PATCH G | ➡️ next execute (dry_run: 7 parent → 22 child) |
| PATCH E | ⏳ queued after G children |
| PATCH B | ⏳ final browser proof |

## Готовность edge functions

PATCH G и PATCH E считаются готовыми к запуску **только после preflight-check**.
Если preflight/dry-run покажет отклонения, допускаются точечные правки в:
- `supabase/functions/split-multi-module-orders/index.ts`
- `supabase/functions/repair-cb20-entitlements/index.ts`

## Файлы для изменения

- План: `.lovable/plan.md`
- При отклонениях preflight/dry-run: точечные правки в edge functions PATCH G и PATCH E

---

## Шаг 1. PATCH G preflight + execute_children_only

### Preflight (обязательный)

Execute разрешён **только если** dry-run повторно подтверждает:
- `parent_count = 7`
- `total_children_planned = 22`
- у всех rows `existing_child_conflict = false`
- все parent имеют `status = paid`
- все parent имеют `reconcile_source = getcourse_historical`

### Execute

Вызвать edge function `split-multi-module-orders` с `mode: "execute_children_only"`.

---

## Шаг 2. PATCH G post-check (обязательный DoD-блок)

После execute_children_only проверить **каждый** parent/child:

- [ ] по каждому parent: `actual_children = expected_children`
- [ ] у каждого child: `product_id = module_product_id` (не root CB20)
- [ ] у каждого child: `purchase_snapshot.module_list_mapped` содержит ровно 1 элемент
- [ ] у каждого child: заполнен `purchase_snapshot.display_purchase_name`
- [ ] у каждого parent: `meta.split_status = 'children_created'`
- [ ] ни один parent ещё не canceled

### STOP-guard

Если хотя бы по одному parent post-check не проходит:
- ❌ finalize_parents запрещён
- ❌ PATCH E execute запрещён
- → сначала фикс данных/children, потом повторный post-check

---

## Шаг 3. PATCH E dry-run

Вызвать `repair-cb20-entitlements` с `dry_run: true`.

Dry-run обязан показать **два раздельных блока**:
1. **post_split_candidates** — кого реально чинит split
2. **still_blocked** — кто остаётся в HOLD

Dry-run обязан показать результат для **обоих режимов**:
- `strict_hold` — все blocked
- `partial_safe` — частичный execute

После этого выбрать режим. Для reference-case Царёвой базовый приоритет — `partial_safe`.

### Царёва — pre/post mapping proof (обязательный)

| Поле | Значение |
|---|---|
| module_product_id | ? |
| module_product_name | ? |
| matched_training_module_id | ? |
| matched_training_module_title | ? |
| mapping_confidence | ? |
| allowed_in_execute | ? |

---

## Шаг 4. PATCH E execute standalone_safe

Execute идёт **только по approved cohort из dry-run**, не по всем standalone автоматически.

### Standalone users (repair focus)

- `irinkazar@inbox.ru` (Царёва) — non-staff, reference-case
- `katerina5515530@gmail.com` — non-staff
- `a.bruylo@ajoure.by` — staff / manual skip

Реальный non-staff repair = Царёва + katerina5515530.

### katerina5515530 — финальный статус (один из трёх)

- ✅ repair executed
- ❌ blocked with exact reason
- ⚠️ manual review

### Царёва — что доказать после execute

- child orders созданы корректно (PATCH G)
- entitlement: `scope_resolution_mode = module_scope_only`
- `expires_at = 2026-04-18` (= business_access_end_at)
- `mapped_training_module_ids` содержит только её модули
- runtime visibility ограничена этими модулями

---

## Шаг 5. PATCH G finalize_parents

Разрешён **только после**:
1. post-check успешен (все parents/children OK)
2. repair cohort подтверждён (PATCH E execute done)
3. UI/display proof: хотя бы 1–2 child orders после split отображаются в UI как отдельные модульные сделки

Вызвать edge function с `mode: "finalize_parents"`.

---

## Шаг 6. PATCH B browser proof

- admin lesson edit/save
- superadmin lesson edit/save
- browser/runtime proof видимости тренинга после repair на reference-case
- Если проблема не воспроизводится — закрыть proof'ом

---

## DoD спринта

- [ ] 7 parent → 22 child orders, `product_id = module_product_id`, deal_date сохранена
- [ ] child orders после split отображаются в UI как отдельные модульные сделки
- [ ] parent не финализируются до полного post-check
- [ ] standalone_safe dry-run и execute выполнены по approved cohort
- [ ] Царёва: entitlement с `module_scope_only`, `expires_at = 2026-04-18`
- [ ] katerina5515530: repair executed / blocked / manual review (один статус)
- [ ] `expires_at` строго равен `business_access_end_at` без отклонений
- [ ] у repaired user нет дублей активных cb20 entitlements
- [ ] active entitlement по cb20 — один канонический
- [ ] runtime visibility доказана SQL + UI/reference proof
- [ ] admin/superadmin lesson editing подтверждён browser proof

---

## Reference cases

| Email | Роль | Назначение |
|---|---|---|
| irinkazar@inbox.ru | non-staff | основной case: split + repair + runtime proof |
| katerina5515530@gmail.com | non-staff | второй case для repair |
| a.bruylo@ajoure.by | staff | manual skip / proof only |
