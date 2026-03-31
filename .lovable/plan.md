# да, согласен, с учетом правок:

&nbsp;

1. Уточни, что **SQL всё равно нужен** не для grant_target_type, а для **DB-guard’ов PATCH B**:
  &nbsp;
  - partial unique indexes для training_content:
    &nbsp;
    - (product_id, grant_target_type, target_ref) where tariff_id is null
    - (product_id, tariff_id, grant_target_type, target_ref) where tariff_id is not null
    &nbsp;
  - при необходимости индекс по target_ref, grant_target_type, is_active для runtime/selectors.
    Без этого uniqueness останется только на UI.
  &nbsp;
2. Зафиксируй, что training_content rule создаётся **только для root-модуля** и только если:
  &nbsp;
  - training_modules.parent_module_id is null
  - training_modules.product_id = rule.product_id
  - если rule создаётся на уровне tariff_id, то product берётся через тариф и тоже должен совпасть.
    Это нужно прописать как **backend validation**, не только фронт.
  &nbsp;
3. Добавь точную схему conditions:
  &nbsp;
  - access_mode: 'full' | 'partial'
  - allowed_module_ids: string[]
  - allowed_lesson_ids: string[]
  - при full оба массива пустые
  - при partial пустые оба массива запрещены.
    Иначе будет двусмысленность между “нет ограничений” и “ничего не разрешено”.
  &nbsp;
4. Исправь правило:
  &nbsp;
  - не “пустой allowlist = полный доступ” глобально,
  - а **access_mode='full' = полный доступ**,
  - **access_mode='partial' с пустым allowlist = invalid config / save reject**.
    Это безопаснее и не создаст тихих ошибок.
  &nbsp;
5. В runtime явно опиши, что training_content фильтрация применяется **только после того, как уже подтвержден доступ к продукту** через entitlement/subscription.
  То есть rule не открывает тренинг сам по себе и не заменяет entitlement.
6. Добавь в PATCH B третий runtime-хук: **useSidebarModules**.
  Иначе меню/сайдбар может показывать модули, которые внутри страницы уже скрыты.
7. Для useTrainingModules и useContainerLessons зафиксируй:
  &nbsp;
  - после фильтрации скрываются пустые child-модули,
  - скрываются пустые root-контейнеры,
  - lesson_count и derived counts пересчитываются **после** allowlist.
    Это нужно отдельно как DoD и proof.
  &nbsp;
8. В ProductAccessRulesTab уточни UI-guard:
  &nbsp;
  - selector показывает **только root-тренинги текущего продукта**,
  - active выше inactive,
  - inactive доступны для настройки, но помечены бейджем,
  - child-модули не могут быть target_ref, только элементы allowlist.
  &nbsp;
9. Добавь отдельный readonly-блок в карточке продукта:
  &nbsp;
  - список training_content rules по тренингу,
  - scope rule: product-wide / конкретный тариф,
  - режим full/partial,
  - count разрешённых модулей/уроков.
    Сейчас в плане это есть смыслом, но не как явный deliverable PATCH B.
  &nbsp;
10. Зафиксируй, что grant-access-for-order **не меняется**, и это не просто “не трогаем”, а архитектурное правило:
  &nbsp;
  - entitlement создаётся только на продукт,
  - training_content rules читаются только в runtime,
  - никаких записей в entitlements/module_access при создании такого rule.
  &nbsp;
11. Добавь proof-регрессию для трёх сценариев:
  &nbsp;
  - продукт без training_content rule → полный доступ как раньше,
  - product_access для клуба → работает как раньше,
  - partial rule по тарифу → ограничение реально применилось.
    Это должно быть отдельным обязательным proof-пакетом.
  &nbsp;
12. В DoD добавь DB-proof:
  &nbsp;
  - duplicate save одного и того же training_content rule на том же scope падает по unique index,
  - rule для чужого тренинга падает,
  - rule на child-module падает,
  - lesson/module вне дерева target training падают.
  &nbsp;

&nbsp;

&nbsp;

После этих правок план уже можно брать в работу.

&nbsp;

План: PATCH B — training_content, partial access, allowlist, runtime-фильтрация

## 1. SQL миграция: partial unique indexes + runtime index

`grant_target_type` — TEXT, новый тип `training_content` не требует ALTER TYPE.

Нужны 3 индекса:

```sql
-- Uniqueness: один training_content rule на scope product-wide
CREATE UNIQUE INDEX idx_access_rules_tc_product_unique
ON access_rules (product_id, grant_target_type, target_ref)
WHERE tariff_id IS NULL AND grant_target_type = 'training_content';

-- Uniqueness: один training_content rule на scope tariff
CREATE UNIQUE INDEX idx_access_rules_tc_tariff_unique
ON access_rules (product_id, tariff_id, grant_target_type, target_ref)
WHERE tariff_id IS NOT NULL AND grant_target_type = 'training_content';

-- Runtime lookup
CREATE INDEX idx_access_rules_tc_runtime
ON access_rules (target_ref, grant_target_type, is_active)
WHERE grant_target_type = 'training_content' AND is_active = true;
```

Плюс DB-функция для backend validation:

```sql
CREATE OR REPLACE FUNCTION validate_training_content_rule()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.grant_target_type = 'training_content' THEN
    -- Must be root module (parent_module_id IS NULL)
    IF NOT EXISTS (
      SELECT 1 FROM training_modules
      WHERE id = NEW.target_ref
        AND parent_module_id IS NULL
    ) THEN
      RAISE EXCEPTION 'training_content rule target must be a root training module';
    END IF;

    -- product_id must match training's product_id
    IF NOT EXISTS (
      SELECT 1 FROM training_modules
      WHERE id = NEW.target_ref
        AND product_id = COALESCE(
          NEW.product_id,
          (SELECT product_id FROM tariffs WHERE id = NEW.tariff_id)
        )
    ) THEN
      RAISE EXCEPTION 'training_content rule product must match training product';
    END IF;

    -- Validate conditions schema
    IF NEW.conditions IS NOT NULL THEN
      -- access_mode must be present
      IF NEW.conditions->>'access_mode' IS NULL THEN
        RAISE EXCEPTION 'training_content rule must have access_mode in conditions';
      END IF;
      -- partial requires non-empty allowlists
      IF NEW.conditions->>'access_mode' = 'partial' THEN
        IF (
          COALESCE(jsonb_array_length(NEW.conditions->'allowed_module_ids'), 0) = 0
          AND COALESCE(jsonb_array_length(NEW.conditions->'allowed_lesson_ids'), 0) = 0
        ) THEN
          RAISE EXCEPTION 'partial access_mode requires non-empty allowed_module_ids or allowed_lesson_ids';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_training_content
BEFORE INSERT OR UPDATE ON access_rules
FOR EACH ROW
EXECUTE FUNCTION validate_training_content_rule();
```

---

## 2. Conditions schema (зафиксировано)

```typescript
interface TrainingContentConditions {
  access_mode: 'full' | 'partial';
  allowed_module_ids: string[];   // при full — []
  allowed_lesson_ids: string[];   // при full — []
  rule_purpose?: RulePurpose;
}
```

- `access_mode = 'full'` → оба массива пустые, полный доступ
- `access_mode = 'partial'` + пустые оба массива → save reject (DB trigger + UI validation)

---

## 3. `src/hooks/useAccessRules.ts`

- Добавить `"training_content"` в `GrantTargetType`
- В `getRuntimeSupport`: `training_content → "full"`

---

## 4. `src/components/admin/product/ProductAccessRulesTab.tsx`

### Labels/Icons

```typescript
TARGET_TYPE_LABELS.training_content = "Доступ к контенту тренинга";
TARGET_TYPE_ICONS.training_content = BookOpen; // или GraduationCap
```

### Wizard (Section 3 — «Куда выдаём»)

Когда `grant_target_type = "training_content"`:

1. **Selector root-тренинга** — загрузить тренинги продукта через `useProductTrainings`, показать только root (parent_module_id = null), active сверху, inactive с бейджем, child-модули не доступны для выбора
2. **Access mode** — toggle `full` / `partial`
3. **Tree picker** (при partial) — дерево модулей и уроков выбранного тренинга с чекбоксами, partial state для родителей
4. **Save validation** — partial + пустой allowlist = toast.error + block

### Список правил

Для `training_content` rules показывать:

- Название root-тренинга
- Бейдж `full` / `partial`
- Count модулей/уроков в allowlist (при partial)

---

## 5. Новый хук `src/hooks/useTrainingContentRules.ts`

- `useTrainingContentTree(trainingId)` — загружает полное дерево модулей + уроков для tree-picker
- `useActiveTrainingContentRules(productIds[])` — для runtime: загружает active training_content rules по продуктам пользователя

---

## 6. Runtime-фильтрация

**Архитектурное правило**: training_content фильтрация применяется ТОЛЬКО ПОСЛЕ подтверждения доступа к продукту (entitlement/subscription). Rule не открывает тренинг и не заменяет entitlement.

**Приоритет**: tariff-level rule > product-level rule. Если нет rule → полный доступ.

### `src/hooks/useTrainingModules.tsx`

После определения `has_access = true`:

1. Загрузить active training_content rules для user's product_ids + tariff_ids
2. Найти наиболее специфичное rule (tariff > product)
3. Если `access_mode = 'full'` или нет rule → без фильтрации
4. Если `access_mode = 'partial'` → фильтровать по `allowed_module_ids` / `allowed_lesson_ids`
5. После фильтрации: пересчитать `lesson_count`, скрыть пустые child-модули, скрыть пустые root-контейнеры

### `src/hooks/useContainerLessons.ts`

Аналогичная логика: фильтрация уроков по allowlist после access check.

### `src/hooks/useSidebarModules.ts`

Добавить training_content фильтрацию: загрузить rules, скрыть модули без видимого контента. Иначе сайдбар покажет модули, которые внутри страницы скрыты.

---

## 7. Readonly-блок training_content rules в карточке продукта

В `ProductLinkedTrainingsBlock.tsx` — заменить placeholder «PATCH B» на живой блок:

- Список training_content rules по каждому тренингу
- Scope: product-wide / конкретный тариф
- Режим: full / partial
- Count разрешённых модулей / уроков

---

## 8. grant-access-for-order — БЕЗ ИЗМЕНЕНИЙ

Архитектурное правило:

- entitlement создаётся только на продукт
- training_content rules читаются только в runtime
- никаких записей в entitlements/module_access при создании training_content rule

---

## Файлы


| Файл                                                           | Изменение                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| SQL миграция                                                   | Partial unique indexes, runtime index, validation trigger           |
| `src/hooks/useAccessRules.ts`                                  | `training_content` в type, getRuntimeSupport                        |
| `src/hooks/useTrainingContentRules.ts`                         | **Новый**: tree data + runtime rules loader                         |
| `src/components/admin/product/ProductAccessRulesTab.tsx`       | Labels, wizard step 3 для training_content, tree picker, validation |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | Readonly rules блок вместо placeholder                              |
| `src/hooks/useTrainingModules.tsx`                             | Runtime allowlist + пересчёт counts + скрытие пустых                |
| `src/hooks/useContainerLessons.ts`                             | Runtime allowlist + скрытие пустых                                  |
| `src/hooks/useSidebarModules.ts`                               | Runtime allowlist для sidebar consistency                           |


## Что НЕ меняется

- `grant-access-for-order` — без изменений (архитектурное правило)
- `useProductTrainings.ts` — readonly diagnostics уже работает
- `ProductAccessInfoBlock.tsx` — без изменений

---

## DoD

1. training_content rule создаётся/редактируется через wizard
2. Tree-picker для модулей/уроков с partial state
3. `access_mode: 'full'` = полный доступ, `'partial'` + пустой allowlist = reject
4. Runtime: фильтрация только после подтверждённого доступа к продукту
5. Tariff-level rule приоритетнее product-level
6. После фильтрации: пересчёт lesson_count, скрытие пустых модулей/контейнеров
7. Sidebar consistency с внутренними страницами
8. Admin bypass сохраняется
9. Readonly блок rules в карточке продукта
10. grant-access-for-order не затронут

## DB-proof (обязательный)

- duplicate save одного training_content rule на том же scope → unique index violation
- rule для чужого тренинга (product_id mismatch) → trigger reject
- rule на child-module → trigger reject
- partial + пустой allowlist → trigger reject
- lesson/module вне дерева target training → UI validation (фронт не покажет чужие)

## Regression proof (обязательный)

1. Продукт без training_content rule → полный доступ как раньше
2. product_access для клуба → работает как раньше
3. partial rule по тарифу → ограничение реально применилось в useTrainingModules, useContainerLessons, useSidebarModules