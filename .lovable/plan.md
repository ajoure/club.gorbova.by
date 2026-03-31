# да, согласен, с учетом правок:

&nbsp;

1. В этот PATCH B обязательно включить **оба направления**: не только создание нового training_content rule, но и **полноценное редактирование существующего** rule из списка правил. Это уже было зафиксировано ранее и не должно потеряться:
  &nbsp;
  - open existing rule in edit mode;
  - восстановление target_ref, access_mode, allowed_module_ids, allowed_lesson_ids;
  - сохранение без потери scope (product_id / tariff_id);
  - delete / deactivate через штатный список правил.
  &nbsp;
2. В BindTrainingDialog из скриншота довести UI до читаемого состояния как отдельный обязательный deliverable:
  &nbsp;
  - фиксированная высота списка;
  - внутренний scroll только у списка;
  - sticky search + sticky filter tabs;
  - длинные названия line-clamp-2, не ломают бейджи справа;
  - правая колонка (TRN-..., inactive, “Другой продукт → перепривязать”) выровнена и не прыгает;
  - на маленькой высоте окна footer/dialog actions остаются доступными.
  &nbsp;
3. Для entitlement selector fix в useAccessRuleSelectors.ts зафиксировать точный приоритет label resolution:
  &nbsp;
  - products_[v2.name](http://v2.name) по entitlements.product_id;
  - fallback: getProductName(product_code);
  - fallback 2: raw product_code.
    И в UI:
  - primary = human-readable name;
  - secondary = technical code мелким текстом;
  - raw code никогда не должен быть primary label, если найдено имя.
  &nbsp;
4. В wizard для training_content rule жёстко сохранить guard’ы не только на фронте, но и на backend/DB:
  &nbsp;
  - target только root module;
  - target training должен принадлежать текущему продукту;
  - partial + пустой allowlist = reject;
  - lesson/module ids только из дерева выбранного root training;
  - один rule на (scope + target_ref) без merge-магии.
  &nbsp;
5. В tree-picker добавить UX, который уже просили и который сейчас отсутствует в плане:
  &nbsp;
  - root checkbox “Весь тренинг”;
  - bulk actions “выбрать всё / снять всё”;
  - indeterminate state;
  - если модуль выбран целиком, не заставлять выбирать все его уроки вручную;
  - перед save делать нормализацию payload без дублей и без “лишних” lesson ids внутри полностью выбранного module.
  &nbsp;
6. В runtime-хуках (useTrainingModules.tsx, useContainerLessons.ts, useSidebarModules.ts) зафиксировать единое правило:
  &nbsp;
  - training_content filter применяется **только после** подтверждённого entitlement/subscription access;
  - precedence: tariff_id rule > product_id rule;
  - если rule нет, доступ остаётся полным;
  - пустые модули/контейнеры/секции скрываются;
  - lesson_count, completed_count, progress пересчитываются только по видимому контенту;
  - admin bypass полностью игнорирует training_content filtering.
  &nbsp;
7. ProductLinkedTrainingsBlock.tsx нужно довести до живого readonly-слоя по правилам, а не просто списка:
  &nbsp;
  - тренинг;
  - scope: весь продукт / конкретный тариф;
  - режим full / partial;
  - count разрешённых модулей / уроков;
  - active / inactive;
  - клик “редактировать” должен открывать wizard на этом rule.
  &nbsp;
8. В план явно вернуть сохранённые ранее требования по proof:
  &nbsp;
  - DB-proof: duplicate scope rule, child-target, foreign-training, empty partial allowlist;
  - UI-proof: bind dialog scroll/readability/search/rebind;
  - edit-proof: создать partial rule → открыть на редактирование → изменить allowlist → сохранить → повторно открыть и доказать восстановление состояния;
  - runtime-proof: один тариф видит часть уроков, другой — все, и это подтверждено в 3 хуках.
  &nbsp;
9. grant-access-for-order, entitlement/backfill/renewal paths и product_access rules для клуба не трогать. Это нужно явно повторить в stop-guards для подрядчика, чтобы PATCH B не разросся в новый контур доступа.
10. После PATCH B сразу следующим обязательным патчем оставить PATCH C на сворачивание legacy module_access. Не backlog “когда-нибудь”, а immediate follow-up после стабилизации PATCH B.

&nbsp;

&nbsp;

План: PATCH B — полный scope с UI-polish и runtime

## Диагностика текущего состояния

### Что реально в коде (проверено)

- `GrantTargetType` = `"entitlement" | "club" | "email" | "product_access"` — **training_content НЕ добавлен**
- `useTrainingContentRules.ts` — **не существует**
- SQL миграция с indexes/trigger — **не существует** (ни одного .sql файла с `training_content`)
- `ProductAccessRulesTab.tsx` — wizard на 5 шагов, entitlement selector показывает raw коды
- `ProductLinkedTrainingsBlock.tsx` — placeholder «PATCH B» на строке 626-638, BindTrainingDialog работает базово
- `useTrainingModules.tsx`, `useContainerLessons.ts`, `useSidebarModules.ts` — **без runtime фильтрации**

### Проблема из скриншота

Entitlement selector (шаг 3 wizard) показывает raw `product_code` как primary label (`1769009596189-398a`, `cb_2_step`). Маппинг `getProductName()` в `product-names.ts` покрывает не все коды. Нужно: для кодов с product_id в `entitlements` → резолвить через `products_v2.name`, для остальных → `getProductName()` fallback.

---

## Scope PATCH B (полный)

### Блок 1: SQL миграция

- 3 partial unique indexes для training_content rules
- Validation trigger: root-only, product match, conditions schema
- Без изменения grant_target_type (уже TEXT)

### Блок 2: Entitlement selector fix (из скриншота)

- `useAvailableEntitlements()` в `useAccessRuleSelectors.ts`: join `entitlements` → `products_v2` через `product_id`, для получения human-readable name
- Приоритет: `products_v2.name` → `getProductName(code)` → raw code
- Primary label = name, secondary = код (мелким шрифтом)

### Блок 3: `useAccessRules.ts`

- Добавить `"training_content"` в `GrantTargetType`
- `getRuntimeSupport()` → `"full"` для training_content

### Блок 4: Новый хук `useTrainingContentRules.ts`

- `useTrainingContentTree(trainingId)` — дерево модулей + уроков для tree-picker
- `useActiveTrainingContentRules()` — runtime: active rules по product_ids пользователя
- `resolveTrainingContentFilter(rules, productId, userTariffIds)` — pure function: tariff > product, возвращает `{ mode, allowedModuleIds, allowedLessonIds } | null`

### Блок 5: Wizard training_content в `ProductAccessRulesTab.tsx`

- Labels/icons для training_content
- Step 3 «Куда выдаём»: selector root-тренингов текущего продукта (title primary, TRN-xxx secondary, inactive с бейджем, child-модули не показывать)
- Access mode toggle: full / partial
- Tree-picker при partial: чекбокс root «Весь тренинг», indeterminate state, массовые действия, нормализация payload
- Save validation: partial + пустой allowlist = reject
- **Edit mode**: загрузка access_mode, target_ref, allowed_module_ids, allowed_lesson_ids из conditions; сохранение с сохранением scope

### Блок 6: BindTrainingDialog UI polish в `ProductLinkedTrainingsBlock.tsx`

- Фиксированная высота списка (`max-h-[400px]` с `overflow-y-auto`)
- Sticky search + sticky фильтры сверху
- Title: max 2 строки, затем ellipsis (`line-clamp-2`)
- public_id, статус, бейдж «Другой продукт» — выровнены по колонкам (flex с shrink-0)
- hover/selected state без конфликта с badge
- На маленькой высоте — список и кнопки остаются доступными

### Блок 7: Readonly блок training_content rules

- Заменить placeholder (строки 626-638) на живой блок
- Список rules из access_rules where grant_target_type = 'training_content' AND target_ref IN (linked training ids)
- Scope: product-wide / тариф
- Режим: full / partial
- Count модулей / уроков
- active / inactive

### Блок 8: Runtime фильтрация

**Архитектурное правило**: фильтрация ТОЛЬКО ПОСЛЕ подтверждённого entitlement/subscription. Rule не открывает доступ.

#### `useTrainingModules.tsx`

- После has_access=true: загрузить training_content rules, найти most specific (tariff > product)
- Если partial → фильтр по allowedModuleIds / allowedLessonIds
- Пересчёт lesson_count, completed_count
- Скрытие пустых child/root модулей
- Admin bypass

#### `useContainerLessons.ts`

- Аналогичная логика после access check
- Скрытие пустых sections

#### `useSidebarModules.ts`

- Фильтрация модулей без видимого контента
- Скрытие пустых секций из modulesBySection

---

## Файлы


| Файл                                                           | Действие                                     |
| -------------------------------------------------------------- | -------------------------------------------- |
| SQL миграция                                                   | **Создать**: indexes + trigger               |
| `src/hooks/useAccessRuleSelectors.ts`                          | Fix entitlement selector: join products_v2   |
| `src/hooks/useAccessRules.ts`                                  | Добавить training_content                    |
| `src/hooks/useTrainingContentRules.ts`                         | **Создать**: tree + runtime + resolver       |
| `src/components/admin/product/ProductAccessRulesTab.tsx`       | Wizard step для training_content + edit mode |
| `src/components/admin/product/ProductLinkedTrainingsBlock.tsx` | BindDialog UI polish + readonly rules блок   |
| `src/hooks/useTrainingModules.tsx`                             | Runtime allowlist                            |
| `src/hooks/useContainerLessons.ts`                             | Runtime allowlist                            |
| `src/hooks/useSidebarModules.ts`                               | Runtime allowlist                            |


## Что НЕ меняется

- `grant-access-for-order` — архитектурное правило: training_content = фильтр, не грант
- `useProductTrainings.ts` — readonly diagnostics работает
- `ProductAccessInfoBlock.tsx` — без изменений
- Entitlement-модель, club rules — без изменений

## Порядок выполнения

1. SQL миграция (DB guards)
2. `useAccessRuleSelectors.ts` (entitlement selector fix)
3. `useAccessRules.ts` (type)
4. `useTrainingContentRules.ts` (новый)
5. `ProductAccessRulesTab.tsx` (wizard + edit)
6. `ProductLinkedTrainingsBlock.tsx` (bind dialog + readonly rules)
7. `useTrainingModules.tsx` (runtime)
8. `useContainerLessons.ts` (runtime)
9. `useSidebarModules.ts` (runtime)

## STOP-guards

- Если grant_target_type окажется postgres ENUM → нужна ALTER TYPE миграция
- partial + пустой allowlist → DB trigger reject + UI reject
- rule для child-module → DB trigger reject
- Если entitlements.product_id не заполнен массово → fallback на getProductName

## DoD

1. Entitlement selector показывает человеческие названия продуктов
2. training_content rule создаётся / редактируется через wizard
3. Tree-picker с indeterminate state и массовыми действиями
4. BindTrainingDialog: scroll, sticky search, line-clamp, aligned badges
5. Readonly блок rules в карточке продукта
6. Runtime фильтрация в 3 хуках
7. Пересчёт counts после allowlist
8. Скрытие пустых модулей/контейнеров/sidebar-секций
9. Admin bypass
10. grant-access-for-order не затронут

## DB-proof

- duplicate rule → unique index violation
- rule для чужого тренинга → trigger reject
- rule на child-module → trigger reject
- partial + пустой allowlist → trigger reject

## Regression proof

1. Продукт без training_content rule → полный доступ
2. product_access для клуба → работает
3. partial rule по тарифу → ограничение применилось в 3 хуках