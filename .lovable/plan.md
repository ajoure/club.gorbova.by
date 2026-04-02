# да, согласен, с учетом правок:

&nbsp;

1. **В fix lookup добавить приоритет и дедуп явно.**
  При объединении результатов:
  &nbsp;
  - сначала entitlement, найденный по product_id = CB20_PRODUCT_ID;
  - если его нет — fallback по product_code = 'cb20' AND product_id IS NULL;
  - если найдено больше одного active entitlement на пользователя, не выбирать молча первый, а помечать кейс как manual_review_duplicate_active.
  &nbsp;
2. **Anti-duplicate guard делать не только перед CREATE, но и перед UPDATE legacy-case.**
  Перед update Рыштаковой проверить:
  &nbsp;
  - сколько active cb20 entitlements уже есть по (user_id, product_id = CB20_PRODUCT_ID OR product_code = 'cb20');
  - если больше 1 — не выполнять update автоматически, а уводить в manual_review_duplicate_active.
  &nbsp;
3. **В UPDATE path legacy entitlement дозаполнять не только product_id, но и унифицировать ключевые поля.**
  Для existing legacy entitlement при update:
  &nbsp;
  - product_id = CB20_PRODUCT_ID
  - product_code = 'cb20'
  - expires_at = business_access_end_at
  - meta.scope_resolution_mode = 'module_scope_only'
  - updated_at обязательно
    Это должно быть явно в DoD.
  &nbsp;
4. **Runtime preview расширять только для module_scope_only кейсов repair/update.**
  Не открывать его для всех repair-path подряд.
  Условие: scope_bucket === 'module_scope_only' и action в update/repair cohort.
5. **В post-check после execute искать entitlement тем же unified lookup, что и в основном dry-run.**
  Не дублировать отдельно похожую логику.
  Лучше вынести один helper/resolver:
  &nbsp;
  - findExistingCb20Entitlement(user_id)
    и использовать его в:
  - initial lookup
  - anti-duplicate guard
  - post-check
  &nbsp;
6. **В dry-run output добавить еще один флаг:**
  &nbsp;
  - legacy_null_product_id = true/false
    чтобы сразу было видно, почему кейс пошел по fallback.
  &nbsp;
7. **Для Рыштаковой expected result сформулировать жестко:**
  &nbsp;
  - planned_action = update, не create;
  - current_entitlement_match_by = product_code;
  - после execute product_id уже не NULL;
  - active cb20 entitlement count = 1.
  &nbsp;
8. **Для Царёвой outcome отдельно закрепить в плане как non-regression.**
  После фикса lookup её кейс не должен случайно перейти в create, если по runtime она все еще zero_visibility.
  То есть lookup-fix не должен менять business-decision для blocked cases.
9. **Перед execute добавить отдельный proof-блок по Рыштаковой:**
  &nbsp;
  - existing entitlement id
  - existing product_id
  - existing product_code
  - match_by
  - target expires_at
  - target mapped_training_module_ids
    Это нужно сохранить как pre-execute snapshot.
  &nbsp;
10. **После execute добавить post-execute proof-таблицу:**
  &nbsp;
  - email
  - entitlement_id
  - product_id
  - product_code
  - scope_resolution_mode
  - mapped_training_module_ids
  - expires_at
  - active_cb20_entitlement_count
    Без этой таблицы PATCH E не считать закрытым.
  &nbsp;
11. **STOP-guard уточнить.**
  Execute запрещен, если выполняется хотя бы одно:
  &nbsp;
  - planned_action = create для пользователя, у которого есть active entitlement по product_code='cb20';
  - найдено >1 active cb20 entitlement;
  - post-fix dry-run не показывает match_by = product_id|product_code для approved candidate.
  &nbsp;
12. **Scope boundary дополнить.**
  В этом шаге:
  &nbsp;
  - не трогаем parent/root visual cleanup;
  - не трогаем активацию уроков у Царёвой;
  - не трогаем полную reconciliation сделок;
  - делаем только safe fix entitlement resolver + execute approved update-case.
  &nbsp;
13. **Итоговый expected outcome обновить так:**
  &nbsp;
  - Рыштакова — UPDATE existing legacy entitlement, не новый insert;
  - Царёва — blocked/manual_review без изменений;
  - duplicate active cb20 entitlements после execute = 0 новых, count для Рыштаковой = 1.
  &nbsp;

&nbsp;

&nbsp;

План: Fix entitlement lookup bug + post-fix dry-run + execute

## Диагноз

Корневая причина бага: строка 131 edge function `repair-cb20-entitlements/index.ts`:

```
.eq('product_id', CB20_PRODUCT_ID)
```

У Рыштаковой existing entitlement (`5875992d`) имеет `product_code = 'cb20'`, но `product_id = NULL`. Lookup его не находит → dry-run ошибочно планирует `create` вместо `update`.

Тот же фильтр используется в post-check (строка 818) — аналогичная слепая зона.

## Что будет сделано

### 1. Fix lookup existing entitlements (строки 128-135)

Заменить один запрос на два последовательных:

```
// Primary: by product_id
const { data: entsByProductId } = await supabase
  .from('entitlements')
  .select(...)
  .eq('product_id', CB20_PRODUCT_ID)
  .in('user_id', businessUserIds);

// Fallback: by product_code for legacy records
const { data: entsByCode } = await supabase
  .from('entitlements')
  .select(...)
  .eq('product_code', 'cb20')
  .is('product_id', null)
  .in('user_id', businessUserIds);
```

Объединить в `entByUser` map с приоритетом product_id-match.

Добавить в output каждого plan:

- `current_entitlement_match_by`: `'product_id' | 'product_code' | 'none'`

### 2. Fix UPDATE path (строки 697-710)

При update legacy entitlement (product_id = NULL) — дозаполнить `product_id = CB20_PRODUCT_ID` в updateData.

### 3. Anti-duplicate guard перед CREATE (строки 723-755)

Перед insert добавить повторную проверку:

```
const { data: dupeCheck } = await supabase
  .from('entitlements')
  .select('id')
  .eq('user_id', plan.user_id)
  .or(`product_id.eq.${CB20_PRODUCT_ID},product_code.eq.cb20`)
  .eq('status', 'active')
  .limit(1);

if (dupeCheck?.length > 0) {
  // blocked — duplicate would be created
}
```

### 4. Runtime preview для repair/update cases (строки 416-418)

Расширить фильтр с `planned_action === 'create'` на включение `repair_metadata_and_align` / `repair_metadata_only` с `scope_bucket === 'module_scope_only'`. Это даст Рыштаковой runtime_preview (видимые модули/уроки).

### 5. Fix post-check (строки 815-819)

Аналогично lookup — добавить fallback по `product_code = 'cb20'`.

### 6. Standalone dry-run output enrichment (строки 612-637)

Добавить поля:

- `current_entitlement_id`
- `current_entitlement_match_by`
- `current_product_id`
- `current_product_code`

### 7. Deploy + post-fix dry-run

- Deploy edge function
- Вызвать с `dry_run: true, standalone_mode: "partial_safe", execute_cohort: "standalone_safe"`
- Проверить что Рыштакова → `planned_action = repair_metadata_and_align`, не `create`
- Проверить что Царёва → `blocked / manual_review`

### 8. Execute для approved cohort

После подтверждения dry-run результата — execute для Рыштаковой:

- update existing entitlement
- scope = module_scope_only
- mapped_training_module_ids = [Маркетплейсы]
- expires_at = business_access_end_at
- product_id дозаполнен

### 9. Post-execute proof

- active cb20 entitlement count для Рыштаковой = 1
- product_id заполнен
- scope корректен
- expires_at корректен

## Ожидаемый outcome

- Рыштакова: entitlement **updated**, доступ к Маркетплейсам, expires = 2026-04-18
- Царёва: **blocked/manual_review** (inactive content)
- Дубли entitlement не создаются
- Parent/root deal cleanup — не в scope текущего шага

## Файлы для изменения

- `supabase/functions/repair-cb20-entitlements/index.ts` — 5 точечных правок (lookup, update path, anti-dupe guard, runtime preview filter, post-check)
- `.lovable/plan.md` — обновление статусов

## Execution order

```text
1. Fix edge function (5 точечных правок)
2. Deploy
3. Post-fix dry-run (proof: Рыштакова = update)
4. Execute partial_safe для approved candidate
5. Post-execute proof
6. Update plan.md
```

## STOP-guard

Execute запрещён если post-fix dry-run для Рыштаковой показывает `planned_action = create`.

## Backlog (не в текущем шаге)

- Глубокая нормализация historical deal chain
- Parent/root visual cleanup
- Активация контента для Царёвой
- Полная reconciliation сделочной модели