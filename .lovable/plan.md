## да, согласен, с учетом правок:

&nbsp;

1. **RetroApply не привязывать к BUSINESS вообще.**
  Это должен быть **универсальный механизм retroapply правил доступа** для любых продуктов, тарифов и правил, а не отдельная функция под BUSINESS cohort.
2. **Переименовать PATCH-D** из BUSINESS retroapply в что-то вроде:
  **RULES-RETROAPPLY ENGINE** / **RetroApply existing access rules to historical purchases**.
  Смысл: после изменения access_rules администратор может вручную применить новые правила к уже существующей исторической базе.
3. **Source of truth только общий:**
  &nbsp;
  - access_rules
  - orders_v2
  - subscriptions_v2
  - entitlements
  - products_v2
    Без хардкода BUSINESS, club, конкретных product_id или tariff_id в логике движка.
  &nbsp;
4. **Точка запуска должна быть из админки как ручное действие.**
  Не автоматом при каждом изменении правила, а через явный запуск:
  &nbsp;
  - preview
  - dry-run
  - execute
    То есть админ сначала видит, кого затронет новое правило, и только потом применяет.
  &nbsp;
5. **RetroApply должен работать для любых сценариев:**
  &nbsp;
  - добавили новый продукт в уже существующее правило
  - поменяли target у правила
  - включили rule, которое раньше было выключено
  - изменили duration_days
  - переключили на align_with_source
  - добавили новое правило для старого тарифа/старого продукта
  - изменили eligibility conditions (prior_purchase, per_product и т.д.)
  &nbsp;
6. **Логика retroapply должна быть rule-centric, а не tariff-centric.**
  На входе не “когорта BUSINESS”, а:
  &nbsp;
  - rule_id
  - режим запуска (preview / execute)
  - scope запуска: одна rule или набор rules
    Дальше движок сам определяет, какие пользователи подпадают под rule по текущим данным.
  &nbsp;
7. **Нужен режим запуска не только по одному rule, но и по набору изменённых rules.**
  Например:
  &nbsp;
  - retroapply одной конкретной rule
  - retroapply всех rules, изменённых после определённой даты
  - retroapply всех active rules для конкретного source product/tariff
  &nbsp;
8. **Нужна отдельная сущность/кнопка в админке уровня “Применить правила к историческим данным”.**
  Не “выдать BUSINESS cohort”, а универсальный UI:
  &nbsp;
  - выбрать rule
  - посмотреть preview affected users
  - увидеть conflicts/skips
  - нажать execute
  &nbsp;
9. **RetroApply не должен безусловно перезаписывать существующие доступы.**
  Должны быть отдельные категории:
  &nbsp;
  - missing_access — можно создать
  - aligned_update_needed — можно обновить срок
  - conflict_existing_access — только в отчёт
  - already_satisfied — skip
  - condition_not_met — skip
  &nbsp;
10. **Нужен общий механизм expiry resolution для всех rules:**
  &nbsp;
  - duration_days IS NULL → срок определяется source window по правилу
  - duration_days IS NOT NULL → срок считается по rule
  - если source window отсутствует, retroapply не должен придумывать срок сам, а должен класть кейс в conflicts/review
  &nbsp;
11. **Нужно явно разделить 2 режима retroapply:**
  &nbsp;
  - **grant missing access**
  - **recalculate existing access**
    Потому что иногда нужно только довыдать новые продукты, а иногда — ещё и пересчитать срок уже существующих доступов после изменения правила.
  &nbsp;
12. **Добавить stop-guard:**
  если rule change может затронуть много пользователей, execute запрещён без preview summary:
  &nbsp;
  - сколько create
  - сколько update
  - сколько skip
  - сколько conflict
  &nbsp;
13. **Артефакты PATCH-D переписать как универсальные:**
  &nbsp;
  - rules_retroapply_preview.csv
  - rules_retroapply_after.csv
  - rules_retroapply_duplicates_check.csv
  - rules_retroapply_conflicts.csv
  &nbsp;
14. **Правило эксплуатации для админа переписать так:**
  &nbsp;
  - изменение rule в админке **не обязано автоматически** переработать всю историческую базу
  - для уже существующих исторических покупок нужен **отдельный ручной RetroApply**
  - для новых оплат после изменения rules всё должно работать автоматически через обычный fulfillment flow
  &nbsp;
15. **В финальном DoD PATCH-D зафиксировать универсальность:**
  &nbsp;
  - работает не только для BUSINESS
  - работает для любого source product / source tariff / source rule
  - не содержит хардкодов под конкретный клуб или конкретный тариф
  &nbsp;

&nbsp;

&nbsp;

Итоговая формулировка для плана должна быть такой:

**RetroApply — это универсальный ручной механизм применения новых или изменённых access_rules к историческим данным по всем продуктам и тарифам, а не специальная логика только для BUSINESS.**

&nbsp;

План: 4 патча — cb20 repair, Деньги BY closure, LibraryModule access filter, BUSINESS retroapply

---

### PATCH-A: CB20 expiry alignment

**Статус:** ОТКРЫТ — 3 DRIFT-кейса не исправлены

**Текущее состояние (свежий proof):**


| email                                             | cb20_expires     | business_end     | drift |
| ------------------------------------------------- | ---------------- | ---------------- | ----- |
| [ossiptschik@mail.ru](mailto:ossiptschik@mail.ru) | 2026-04-08 12:00 | 2026-05-07 20:59 | −29д  |
| [meryloiko@gmail.com](mailto:meryloiko@gmail.com) | 2026-04-08 12:00 | 2026-05-07 20:59 | −29д  |
| [teterya@tut.by](mailto:teterya@tut.by)           | 2026-04-08 12:00 | 2026-05-07 20:59 | −29д  |


**Действие:**

1. UPDATE 3 записей entitlements: `expires_at = MAX(access_end_at)` по active/past_due BUSINESS subscription пользователя
2. INSERT audit_log с action `entitlement.repaired` и snapshot до/после
3. Каноническая формула: `MAX(access_end_at) WHERE status IN ('active','past_due') AND tariff.code = 'business'`

**DoD:**

- cb20 active entitlements с BUSINESS: ~90
- aligned: ~90
- drift: 0
- у всех repaired записей есть audit_log с `source_rule_id`, `business_subscription_id`

**Артефакт:** `cb20_expiry_alignment_after.csv`

---

### PATCH-B: Деньги BY retro-backfill

**Статус:** ЗАКРЫТ ✅

Proof подтвержден:

- 122 active entitlements, 0 дублей, 0 missing, 0 misaligned expires_at
- Все записи имеют `source_rule_id: 6ba9727e`, `batch_id`, `business_subscription_id`

**Обязательная постпроверка (DoD дополнение):**

- retro cohort fixed ✅
- new order auto-grant verified — нужен proof на 1 свежем BUSINESS order после создания правила `6ba9727e`, что entitlement создается автоматически через `grant-access-for-order` без batch backfill

**Архитектурная фиксация:**

- Правило `6ba9727e` безусловное (`conditions.rule_purpose = bonus`, нет `condition_type`)
- Новые BUSINESS orders получают «Деньги BY» автоматически через `grant-access-for-order` → `product_access` rules engine
- Backfill был нужен ТОЛЬКО для когорты, подписавшейся ДО создания правила (retro-apply gap)

---

### PATCH-C: LibraryModule child access filtering

**Статус:** В РАБОТЕ

**Проблема:** access leak — строки 88-93 `LibraryModule.tsx` загружают дочерние модули напрямую из `training_modules` без фильтрации через `has_access` из `allModules` (useTrainingModules).

**Fix в `src/pages/LibraryModule.tsx`:**

1. После получения `children` из supabase, отфильтровать через `allModules`:

```typescript
const accessibleChildren = (children || []).filter(child => {
  const moduleInfo = allModules.find(m => m.id === child.id);
  return moduleInfo?.has_access !== false;
});
```

2. Вернуть `accessibleChildren` вместо `children`
3. Счётчик уроков в header считать только по `accessibleChildren`
4. Если после фильтрации `accessibleChildren` пусто — показывать empty state

**DoD:**

- пользователь видит только accessibleChildren
- счётчик уроков считается только по accessibleChildren
- если после фильтрации children пусто — показывается empty state
- direct lessons сценарий (модули с собственными уроками) не ломается

**Артефакт:** `library_root_children_access_proof.csv` — поля: `root_module_id, child_module_id, child_slug, has_access, lesson_count, visible_in_ui_after_fix`

---

### PATCH-D: BUSINESS retroapply for newly added rules (НОВЫЙ)

**Суть:** Когда в админке к BUSINESS-тарифу добавляют новый продукт через `access_rules`, правило срабатывает только для НОВЫХ оплат/продлений через `grant-access-for-order`. Текущая активная когорта BUSINESS (122 подписчика) НЕ получает новый продукт автоматически.

**Архитектурная норма (зафиксировать как правило системы):**

- Добавили rule ДО новых оплат → новые пользователи получат автоматически через `grant-access-for-order`
- Добавили rule ПОСЛЕ того, как когорта уже активна → нужен retroapply для текущих active BUSINESS подписчиков

**Реализация — edge function `business-retroapply-rules`:**

1. **Preview (read-only):** Для каждого active BUSINESS rule типа `product_access`: найти пользователей с active/past_due BUSINESS subscription БЕЗ entitlement на `target_ref`/`target_product_ids`. Вернуть preview CSV.
2. **Dry-run:** Для каждого пользователя из preview: вычислить `expires_at` по каноническому SoT (`MAX(access_end_at) WHERE status IN ('active','past_due')`), если `duration_days = NULL` (align_with_source). Показать таблицу: `user_id, email, rule_id, target_product_id, expires_at`.
3. **Execute:** Batch INSERT entitlements только для отсутствующих. Meta: `source_rule_id`, `source_window_rule: align_with_source`, `batch_id: RETROAPPLY-{rule_id}-{date}`, `business_subscription_id`.
4. **Idempotent:** Если у пользователя уже есть active entitlement на target product — SKIP, не update.

**Source of truth:** только `access_rules` + active BUSINESS `subscriptions_v2`, без хардкода продуктов.

**Канонический expiry:**

- `duration_days IS NOT NULL` → `expires_at = NOW() + duration_days`
- `duration_days IS NULL` (align_with_source) → `expires_at = MAX(access_end_at)` по active/past_due BUSINESS subscription

**STOP-guards:**

- Если rule безусловное и затрагивает >200 пользователей — только preview, execute после ручного подтверждения
- Если у пользователя уже есть active entitlement — skip
- Повторный запуск не создаёт дублей (idempotent by user_id + product_id unique check)

**DoD:**

- preview показывает точное количество пользователей без entitlement
- execute создаёт entitlements только для missing
- повторный run: 0 новых записей
- все записи имеют `source_rule_id`, `business_subscription_id`, `batch_id`
- `expires_at` = BUSINESS `access_end_at` для align_with_source rules

**Артефакты:**

- `business_rule_retroapply_preview.csv`
- `business_rule_retroapply_after.csv`
- `business_rule_retroapply_duplicates_check.csv`

---

### Файлы для изменения


| Файл                                                    | Изменение                                           | PATCH |
| ------------------------------------------------------- | --------------------------------------------------- | ----- |
| `src/pages/LibraryModule.tsx`                           | Фильтрация childModules через allModules.has_access | C     |
| `supabase/functions/business-retroapply-rules/index.ts` | Новая edge function для retroapply                  | D     |
| Data UPDATE (insert tool)                               | 3 cb20 entitlements expires_at                      | A     |


---

### Статусный блок


| PATCH | Описание                                  | Статус                                     |
| ----- | ----------------------------------------- | ------------------------------------------ |
| A     | cb20 expiry alignment                     | ОТКРЫТ — 3 DRIFT, ждёт repair              |
| B     | Деньги BY retro-backfill                  | ЗАКРЫТ ✅ (ждёт new-order auto-grant proof) |
| C     | LibraryModule child access filtering      | В РАБОТЕ — access leak, ждёт fix + proof   |
| D     | BUSINESS retroapply for newly added rules | НОВЫЙ — проектирование                     |


Legacy/backfill unrelated paths — вне этого спринта.

---

### Финальный DoD плана

1. cb20 DRIFT = 0, все aligned, audit_log записан
2. Деньги BY: retro cohort fixed + new order auto-grant verified
3. LibraryModule: пользователь не видит child modules без доступа; счётчик только по accessible; empty state при 0 accessible
4. Новый продукт, добавленный к BUSINESS rule, может быть выдан всей текущей active cohort через retroapply-run
5. Повторный retroapply-run не создаёт дублей
6. Все таблицы и сущности: `products_v2`, `subscriptions_v2`, `entitlements.meta`, `access_rules`

---

### Правило эксплуатации для админа

- **Добавили rule до новых оплат** → новые пользователи получат автоматически через `grant-access-for-order`
- **Добавили rule после того, как когорта уже активна** → нужно запускать retroapply для текущих active BUSINESS подписчиков