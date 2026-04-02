# План: PATCH G → H → I → J → E → B — нормализация + repair + proof

## Главная цель спринта

1. Historical standalone deals корректно разделены
2. Цены child deals корректны (per-module, sum = parent)
3. Parent/child визуальные дубли устранены
4. Названия модулей единообразны на всех экранах
5. Standalone entitlements repaired по доказуемо корректным кейсам
6. Срок доступа и фактическая видимость контента подтверждены proof-таблицами

**PATCH G/H/I/J — поддерживающие нормализационные шаги.**
**Основная тема спринта неизменна:** корректная цепочка продукт → тариф → тренинг → сделка → доступ → срок.

## Статусы патчей

| Patch | Статус |
|---|---|
| PATCH F | ⏳ verify after I (system-wide UI proof needed) |
| PATCH C | ✅ done / verify only |
| PATCH D | ⏳ proof base ready |
| PATCH G | G1 ✅ children_created (22/22), G2 ✅ price_normalized, G3 ⏳ parent_ui_clean (badges deployed), G4 ⏳ parents_finalized |
| PATCH H | ✅ H1 data-fix done (22 children), H2 code-fix done (edge function) |
| PATCH I | ✅ UI badges deployed (ContactDetailSheet, AdminDeals, DealDetailSheet) |
| PATCH J | ✅ audit CSV generated — all 7 parents: child_prices_ok, titles_ok, needs_ui_badge |
| PATCH E | ⏳ dry-run next |
| PATCH B | ⏳ final browser proof |

## Готовность edge functions

- `split-multi-module-orders` — FIXED: per-module pricing with deterministic remainder
- `repair-cb20-entitlements` — FIXED: `training_content` → `training_lessons`, `status` → `is_active`

**Правило:** edge functions считаются готовыми только после preflight-check. При отклонениях допускаются точечные правки.

## PATCH G sub-statuses

- G1 ✅ children_created — 7 parent → 22 child orders, batch_id: SPLIT-2026-04-02T200720
- G2 ✅ price_normalized — batch_id: PRICE-FIX-2026-04-02, sum_match = true на всех 7
- G3 ⏳ parent_ui_clean — UI badges deployed, needs browser proof
- G4 ⏳ parents_finalized — BLOCKED until all post-checks + repair confirmed

**До G4 split считается незавершённым.**

## PATCH H результаты

### H1 data-fix ✅

| Parent | parent_final | modules | child_prices | sum_match |
|---|---|---|---|---|
| GC-3813592 | 19204.08 | 2 | 9602.04, 9602.04 | ✅ |
| GC-3814251 | 28823.23 | 3 | 9607.74, 9607.74, 9607.75 | ✅ |
| GC-3818307 | 1100.00 | 2 | 550.00, 550.00 | ✅ |
| GC-3831920 | 250.00 | 3 | 83.33, 83.33, 83.34 | ✅ |
| (3 zero-price parents) | 0 | 3/4/5 | all 0.00 | ✅ trivial |

### H2 code-fix ✅
Edge function `split-multi-module-orders/index.ts` обновлена:
- Цена считается как `parent_price / module_count` с remainder на последнем child
- В meta добавлены: `split_parent_final_price`, `split_parent_module_count`, `split_price_strategy`, `split_price_batch_id`
- В purchase_snapshot: `normalized_unit_price`, `parent_total_price`, `parent_module_count`

### Add-only правило
- Не создавать новые products/tariffs/training_modules
- Не удалять child orders
- Parent не переводить в canceled до полного proof-пакета
- Все изменения parent/child обратимо диагностируемы через meta

## PATCH I результаты

UI-компоненты обновлены для корректного отображения split orders:
- **ContactDetailSheet** — split parent: opacity-50 + бейдж "📦 Разделена на модули"; split child: бейдж "📄 Модуль (split)"; + display_purchase_name fallback
- **AdminDeals** — аналогичные бейджи для split parent/child
- **DealDetailSheet** — бейдж + ссылка на parent order number + child count

## PATCH J audit результаты

| profile_email | parent_order | children | parent_status | child_prices_ok | titles_ok | needs_cleanup |
|---|---|---|---|---|---|---|
| a.bruylo@ajoure.by | GC-3830657 | 5 | paid | trivial_zero | OK | needs_ui_badge |
| irinkazar@inbox.ru | GC-1767629483208 | 3 | paid | trivial_zero | OK | needs_ui_badge |
| irkaguzarevich@mail.ru | GC-3818501 | 4 | paid | trivial_zero | OK | needs_ui_badge |
| katerina5515530@gmail.com | GC-3831920 | 3 | paid | OK | OK | needs_ui_badge |
| lori-30@tut.by | GC-3813592 | 2 | paid | OK | OK | needs_ui_badge |
| overchenko.lina@mail.ru | GC-3818307 | 2 | paid | OK | OK | needs_ui_badge |
| princessa_elena1@mail.ru | GC-3814251 | 3 | paid | OK | OK | needs_ui_badge |

**Итог:** все 7 parents — child_prices_ok, titles_ok. Все нуждаются в UI badge (deployed).

## Execution order (обновлённый)

```text
1. ✅ PATCH H1 — data-fix prices (done)
2. ✅ PATCH H2 — code-fix split function (done)
3. ✅ PATCH I — UI cleanup parent/child + badges (done)
4. ✅ PATCH J — audit/proof table (done)
5. ⏳ PATCH E — dry_run on normalized data
6. ⏳ PATCH E — execute approved cohort
7. ⏳ PATCH G4 — finalize_parents
8. ⏳ PATCH B — browser proof
```

## PATCH E — следующий шаг

### Царёва (irinkazar@inbox.ru) — proof-блок

| Поле | Значение |
|---|---|
| matched modules | 4/4 (Розница, Грузо, Производство, Строительство) |
| visible_module_count | 0 |
| visible_recursive_lesson_count | 0 |
| inactive_lessons_count | 12+ |
| **Статус** | **repair blocked by inactive content, not by mapping** |

### Катерина (katerina5515530@gmail.com) — pre-execute proof (обязательный)

До execute показать:
- module_product_ids из child orders
- matched_training_module_ids
- visible_module_count / visible_recursive_lesson_count
- target_expires_at
- child orders after split + corrected prices

Финальный статус: один из трёх — `repair executed` / `blocked with exact reason` / `manual review`

### Режим execute
- dry-run показывает оба варианта: `strict_hold` и `partial_safe`
- Выбор после просмотра результатов
- Execute идёт **только по approved cohort из dry-run**
- Базовый приоритет для reference-cases: `partial_safe`

## STOP-guard перед finalize_parents

Finalize запрещён если хотя бы одно:
- ❌ child price mismatch
- ❌ parent still visible as normal deal (без badge)
- ❌ titles mismatch across UI layers
- ❌ standalone repair cohort not reviewed
- ❌ reference proof for Царёва/Катерина not collected
- ❌ UI/display proof на 1-2 child orders не подтверждён

## PATCH F DoD (verify after PATCH I)

- [ ] Одинаковое отображение названия сделки снаружи и внутри карточки
- [ ] Корректное отображение split child deals
- [ ] Отсутствие root-name там, где должен быть модуль
- [ ] System-wide UI proof на всех экранах: AdminDeals, ContactDetailSheet, DealDetailSheet, ContactPaymentsTab

## PATCH B — browser proof (расширенный)

- [ ] admin lesson edit/save
- [ ] superadmin lesson edit/save
- [ ] Катерина: корректные child deals в списке и карточке контакта
- [ ] Царёва: корректные child deals + parent не мешает UI
- [ ] Корректное название сделки внутри и снаружи
- [ ] Runtime visibility тренинга после repair на reference-case

## Reference cases — before/after proof

Для Царёвой и Катерины 4-этапный proof:
1. До split (текущее состояние parent)
2. После children_created + price normalization
3. После UI cleanup (parent помечен badge)
4. После repair (entitlement created/blocked)

## DoD спринта

### Основная цепочка
- [x] Child deals имеют корректную модульную цену (sum children = parent)
- [ ] Parent multi-module deal не выглядит как обычная активная сделка
- [ ] Названия модулей совпадают на всех экранах
- [x] System-wide audit completed
- [ ] Duplicate visual rows eliminated (badge deployed, browser proof pending)

### Entitlements
- [ ] standalone_safe dry-run и execute по approved cohort
- [ ] Царёва: documented proof (blocked by inactive content)
- [ ] Катерина: pre-execute proof → execute/block/manual
- [ ] expires_at = business_access_end_at
- [ ] Нет дублей активных cb20 entitlements
- [ ] Runtime visibility доказана UI proof
- [ ] Active entitlement по cb20 один канонический

### Finalize
- [ ] PATCH G4 finalize_parents после полного post-check (DB + UI)
- [ ] Child orders отображаются в UI как отдельные модульные сделки
- [ ] Browser proof admin + superadmin

## Reference cases

| Email | Роль | Статус |
|---|---|---|
| irinkazar@inbox.ru | non-staff reference | blocked: 0 active lessons in all 4 modules |
| katerina5515530@gmail.com | non-staff | standalone_safe, ready for pre-execute proof |
| a.bruylo@ajoure.by | staff | manual skip |
