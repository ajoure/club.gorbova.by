# Да, согласен, с учетом правок:

&nbsp;

1. В **PATCH 1** добавь ещё один обязательный подпункт: проверить не только root-level lessons, но и полный цикл
  UI state → derived checked state → payload → saved rule → reopen modal.
  Нужно доказать, что после сохранения и повторного открытия правила:
  &nbsp;
  - Выбрать всё отображается корректно;
  - Весь тренинг отображается корректно;
  - частичный выбор не теряется;
  - нет скрытого рассинхрона между tc_allowed_module_ids, tc_allowed_lesson_ids и тем, что реально подсвечено в TreePicker.
  &nbsp;
2. В **PATCH 1** для TrainingContentTreePicker.tsx добавь ещё один guard:
  если выбран full-access режим, TreePicker не должен сохранять старый partial state скрыто и потом внезапно восстанавливать его без явного правила.
  Нужно выбрать и зафиксировать одно поведение:
  &nbsp;
  - либо при переходе в full partial-state очищается намеренно;
  - либо partial-state сохраняется и восстанавливается при возврате в partial.
    Но поведение должно быть явным, единым и доказанным. Сейчас это тоже часть бага.
  &nbsp;
3. Для **PATCH 1 DoD** добавь 2 дополнительных критерия:
  &nbsp;
  - после создания правила и повторного открытия формы состояние selection совпадает с реально сохранённым payload;
  - root-level lessons больше не выпадают из bulk-операций.
  &nbsp;
4. По **PATCH 2** статус сейчас формулируй жёстко:
  связка **Business → cb20** ещё **не закрыта**.
  Закрыто только:
  &nbsp;
  - архитектурная подготовка;
  - dry-run;
  - safe cohort split;
  - edge function guards.
    Не закрыто:
  - safe execute;
  - post-check proof;
  - runtime/UI proof;
  - standalone-only follow-up.
  &nbsp;
5. Перед **PATCH 2 execute** потребуй отдельный копируемый proof-блок safe cohort, без воды:
  &nbsp;
  - user_id
  - email
  - current_entitlement_id
  - planned_action
  - scope_bucket
  - old_expires_at
  - target_expires_at
    Это нужно до execute, чтобы потом можно было сверить per-user proof 1:1.
  &nbsp;
6. В **PATCH 2** явно зафиксируй:
  safe execute включает **только already-entitled** кейсы из safe cohort:
  &nbsp;
  - align_to_business
  - repair_metadata_and_align
  - repair_metadata_only
    create не включать вообще.
    Даже если где-то create выглядит безопасным — вынести в отдельный follow-up.
  &nbsp;
7. В **PATCH 2 post-check** добавь ещё один обязательный пункт:
  &nbsp;
  - для каждого пользователя из executed cohort meta.scope_resolution_mode после execute должен совпадать с dry-run scope_bucket 1:1.
    Не только суммарный scope_mode_invalid = 0, но и per-user сверка.
  &nbsp;
8. В **PATCH 3 runtime proof** добавь проверку именно того, что тебя волнует по бизнес-логике:
  &nbsp;
  - покупка/наличие Business не просто создала или обновила entitlement;
  - она реально дала корректный доступ к “Ценный бухгалтер”;
  - доступ ограничен так, как должен;
  - нет silent full-access fallback;
  - UI тренинга не показывает ложную пустоту и не показывает лишний контент.
  &nbsp;
9. Для **PATCH 3** по каждому из 2 пользователей proof должен быть в формате:
  &nbsp;
  - subscription Business;
  - entitlement до;
  - entitlement после;
  - resolved scope;
  - visible modules;
  - lesson count;
  - UI screenshot / proof-факт.
    Без этого этап нельзя считать закрытым.
  &nbsp;
10. Standalone-only зафиксируй отдельным блоком как **НЕ входит в текущий этап**:

&nbsp;

&nbsp;

&nbsp;

- HOLD;
- execute запрещён;
- нужен отдельный mapping proof;
- нужен отдельный follow-up patch.
  Это должно быть написано явно, чтобы потом никто не сказал, что “почти уже закрыли всё”.

&nbsp;

&nbsp;

&nbsp;

11. После PATCH 1 и PATCH 2 обнови документацию так, чтобы там было видно:

&nbsp;

&nbsp;

&nbsp;

- какой именно UI-баг по TreePicker исправлен;
- что вошло в safe execute;
- что сознательно исключено;
- что остаётся follow-up;
- что общий этап по Business → cb20 закрыт только частично до runtime proof.

&nbsp;

&nbsp;

&nbsp;

12. Итоговый DoD текущего этапа считай выполненным только если одновременно:

&nbsp;

&nbsp;

&nbsp;

- чекбоксы TreePicker исправлены и доказаны после reopen формы;
- safe execute реально выполнен;
- per-user post-check сходится 1:1 с dry-run;
- runtime/UI proof по 2 safe users собран;
- standalone-only явно оставлены в HOLD и не смешаны с текущим execute.

&nbsp;

&nbsp;

План: PATCH 1 (чекбоксы TreePicker) + PATCH 2 (safe execute) + PATCH 3 (runtime proof)

## Текущий статус

- Связка Business → cb20 подготовлена архитектурно
- Dry-run выполнен, safe cohort выделен
- Финально задача **не закрыта** до safe execute + runtime proof
- Standalone-only остаются в HOLD, в текущий execute не входят

---

## PATCH 1 — Фикс чекбоксов в TrainingContentTreePicker

### Discovery (корневая причина)

State flow модалки training_content rule:


| Элемент                        | Хранение                                      | Проблема |
| ------------------------------ | --------------------------------------------- | -------- |
| `access_mode`                  | `form.tc_access_mode` в ProductAccessRulesTab | ОК       |
| selected modules               | `form.tc_allowed_module_ids`                  | ОК       |
| selected lessons               | `form.tc_allowed_lesson_ids`                  | ОК       |
| «Выбрать всё»                  | `onChange([...allModuleIds], [])`             | **БАГ**  |
| «Весь тренинг» (root checkbox) | `handleSelectAll` → то же самое               | **БАГ**  |
| «Снять всё»                    | `onChange([], [])`                            | ОК       |


**Корневая причина:** `collectAllModuleIds(tree)` собирает только дочерние модули, **исключая корень**. Поэтому:

1. **«Выбрать всё»** вызывает `onChange([...allModuleIds], [])` — уроки, находящиеся непосредственно на корневом уровне (`tree.lessons`), никогда не попадают в выбор, т.к. `isLessonChecked(lessonId, tree.id)` проверяет `modSet.has(tree.id)` → `false`.
2. `**rootState**` (строки 110-116) проверяет только `allModuleIds.every(id => modSet.has(id))`, но не учитывает root-level lessons. Если есть невыбранные root-lessons, rootState всё равно показывает "checked".
3. Payload при сохранении (строки 574-584) корректно берёт `form.tc_allowed_module_ids` и `form.tc_allowed_lesson_ids`, но если UI не добавил root-level lessons в state — payload тоже их не содержит.

### Файл: `src/components/admin/product/TrainingContentTreePicker.tsx`

**Фикс 1: `handleSelectAll` (строка 120-126)**

При выборе всего — также включить root-level lessons:

```typescript
const handleSelectAll = () => {
  if (rootState === "checked") {
    onChange([], []);
  } else {
    // Select all modules + root-level lessons (not covered by any module)
    onChange([...allModuleIds], [...tree.lessons.map(l => l.id)]);
  }
};
```

**Фикс 2: кнопка «Выбрать всё» (строка 259)**

Аналогично: `onClick={() => onChange([...allModuleIds], [...tree.lessons.map(l => l.id)])}`.

**Фикс 3: `rootState` (строки 110-116)**

Учитывать root-level lessons:

```typescript
const rootState = useMemo(() => {
  const hasModules = allModuleIds.length > 0;
  const hasRootLessons = tree.lessons.length > 0;
  if (!hasModules && !hasRootLessons) return "unchecked" as const;

  const allModsSelected = !hasModules || allModuleIds.every(id => modSet.has(id));
  const allRootLessonsSelected = !hasRootLessons || tree.lessons.every(l => lesSet.has(l.id));

  if (allModsSelected && allRootLessonsSelected && (hasModules || hasRootLessons)) return "checked" as const;
  if (modSet.size > 0 || lesSet.size > 0) return "indeterminate" as const;
  return "unchecked" as const;
}, [allModuleIds, tree.lessons, modSet, lesSet]);
```

### DoD PATCH 1

1. «Выбрать всё» реально выбирает все модули + root-level lessons
2. «Снять всё» очищает выбор (уже работает)
3. «Весь тренинг» (root checkbox) корректно переключает полное выделение
4. При возврате в «Частичный доступ» state сбрасывается (уже работает — строка 1270 очищает при переключении в full)
5. rootState корректно отражает фактическое состояние выбора
6. Payload при сохранении содержит ровно то, что выбрано в UI

---

## PATCH 2 — SAFE EXECUTE ONLY для repair-cb20-entitlements

### Перед execute — таблица safe cohort breakdown

Вызвать dry-run, вывести:

- align_to_business: N
- repair_metadata_and_align: N
- repair_metadata_only: N
- full_tariff_scope: N
- union_scope: N
- total: N
- Полный список user_id + entitlement_id

### Execute

Вызвать функцию с `dry_run: false, execute_cohort: 'safe_only'`.

Функция уже содержит все необходимые guard-ы:

- `create` → abort
- `module_scope_only` → abort
- `standalone_only` → blocked
- `staff` → excluded
- `hold/manual_review` → excluded

### Post-check proof (обязательный)

После execute проверить из response `post_check`:

- `expires_mismatch_remaining = 0` для executed cohort
- `scope_mode_invalid = 0`
- `no_meta_remaining = 0` для executed cohort
- `executed_standalone_only_with_no_match = 0`
- `executed_users_with_null_business_end = 0`
- `executed_users_with_email_unresolved = 0`
- `audit_logs` содержит запись с `actor_label = 'batch_business_cb20_repair_v1'`
- `per_user_proof` таблица: user_id, old/new expires_at, target, scope_mode, result

---

## PATCH 3 — Runtime/UI proof после safe execute

### Выбрать 2 пользователя

1. Один из `full_tariff_scope`
2. Один из `union_scope`

### Для каждого показать

- До execute: entitlement state в БД (expires_at, meta)
- После execute: entitlement state в БД
- `scope_resolution_mode`
- `expires_at` = `business_access_end_at`
- Runtime resolver: какие training modules видны
- Lesson count
- Подтверждение: нет full-access fallback по legacy/meta-hole

---

## Standalone-only — явный статус

- **Остаются в HOLD**
- В текущий execute **не входят**
- Mapping confidence: 2/5 exact_fk (один — «Предобучение», не коммерческий), 3/5 no_match
- Отдельный patch после дополнительного mapping proof

---

## Файлы для изменения


| Файл                                                         | Изменение                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `src/components/admin/product/TrainingContentTreePicker.tsx` | Фикс handleSelectAll, rootState, кнопки «Выбрать всё» — учёт root-level lessons |
| `.lovable/plan.md`                                           | Обновить статус: PATCH 1-3, standalone HOLD                                     |


PATCH 2 и PATCH 3 — через вызовы edge function + DB queries, без изменения кода (функция уже готова).

## Порядок выполнения

1. PATCH 1 → код TreePicker
2. PATCH 2 → dry-run breakdown → execute → post-check
3. PATCH 3 → runtime proof по 2 users
4. Обновить документацию