# да, согласен, с учетом правок:

&nbsp;

1. **Убрать английское слово legacy из UI полностью**
  Во всех местах заменить на русский понятный термин:
  &nbsp;
  - legacy → старый контур
  - legacy module_access: N записей → старые настройки доступа: N записей
  - любые badge/label/tooltips только на русском языке.
    Это относится и к ProductAccessInfoBlock, и к ProductLinkedTrainingsBlock, и к карточкам/диалогам.
  &nbsp;
2. **Исправить непонятный 0 уроков в списке тренингов продукта**
  Сейчас по скрину это выглядит как сломанная или пустая статистика.
  Нужно:
  &nbsp;
  - либо показывать реальное количество уроков внутри root-тренинга/контейнера;
  - либо, если счётчик сейчас не умеет корректно считаться для контейнеров, временно не показывать его вообще;
  - запрещено оставлять массовые ложные 0 уроков, если уроки фактически существуют.
    Добавить отдельный PATCH на корректный подсчёт:
  - для root-тренинга считать все дочерние модули и все уроки внутри них;
  - для leaf-модуля считать только его уроки;
  - для пустого тренинга показывать нет уроков только если это подтверждено фактически.
  &nbsp;
3. **Добавить PATCH: редактирование правил из блока тренинга должно быть доступно**
  По сути сейчас readonly-блок есть, но перейти к реальной настройке неудобно/нельзя.
  Нужно добавить в ProductAccessInfoBlock явные действия:
  &nbsp;
  - Открыть продукт
  - Открыть вкладку "Доступы"
  - если для этого тренинга уже есть training_content rule — Редактировать правило
  - если правила нет — Создать правило для этого тренинга
    То есть это должен быть не просто информационный блок, а рабочая точка перехода к настройке.
  &nbsp;
4. **Расширить ProductAccessInfoBlock не просто summary, а actionable summary**
  Сейчас недостаточно показать count. Нужно для конкретного модуля/тренинга показывать:
  &nbsp;
  - есть ли правило именно для этого target_ref;
  - режим: полный доступ / частичный доступ;
  - scope: весь продукт / тариф: {название};
  - статус: активно / неактивно;
  - кнопка перехода к редактированию правила.
    Если правил несколько, показывать список правил по этому тренингу, а не общий count по продукту.
  &nbsp;
5. **Исправить UI списка “Тренинги этого продукта”**
  По скрину там сейчас неочевидно:
  &nbsp;
  - почему часть строк с badge, часть без;
  - что означает старый контур;
  - почему у root одна логика, у children другая.
    Нужно сделать единый русский и понятный формат:
  - TRN-xxxxx
  - активен / неактивен
  - N уроков только если count корректен
  - badge старый контур только если модуль реально ещё не переведён
  - badge через продукт / через старые настройки — если нужно явно показать источник доступа
  &nbsp;
6. **Уточнить в плане: скрин 3 — это не “нормально”, а переходное состояние, которое нужно сделать понятным**
  Да, legacy selector для модуля без product_id допустим временно, но UI должен это честно объяснять:
  &nbsp;
  - почему здесь старый режим;
  - почему в другом модуле новый режим;
  - что нужно сделать, чтобы перевести модуль в новый режим.
    Добавить поясняющий блок:
    Этот тренинг ещё не привязан к продукту. Пока используются старые настройки доступа.
  &nbsp;
7. **Баг 1 и 2 в useTrainingModules.tsx — оставить, но дополнить proof**
  Нужно не просто исправить скрытие пустых root и пересчёт counts, но и доказать на UI:
  &nbsp;
  - partial rule скрывает пустые root;
  - счётчики root меняются после фильтрации;
  - после исправления не остаётся ложных 0 уроков у непустых тренингов.
  &nbsp;
8. **Баг 3 в useSidebarModules.ts — оставить, но дополнить проверкой навигации**
  Нужно доказать, что после фикса:
  &nbsp;
  - root без видимых children исчезает из sidebar;
  - root с хотя бы одним доступным child остаётся;
  - admin bypass не ломается.
  &nbsp;
9. **Добавить отдельный PATCH на русификацию всего контура training/product access**
  Не точечно, а системно проверить:
  &nbsp;
  - блоки в тренингах;
  - блоки в продуктах;
  - badges в списках;
  - тултипы и helper-тексты;
  - диагностику.
    Требование: ни одного английского слова в пользовательском UI.
  &nbsp;
10. **В DoD добавить явные пользовательские критерии по твоим скринам**

&nbsp;

&nbsp;

&nbsp;

- в продукте список тренингов показывает понятные русские статусы;
- ложных 0 уроков нет;
- readonly-блок не тупиковый, из него можно перейти к настройке;
- для product-linked тренинга видно, какое именно правило действует;
- для legacy-тренинга видно, почему он legacy и что с ним делать.

&nbsp;

&nbsp;

&nbsp;

11. **Не считать PATCH закрытым без proof на этих 3 вопросах**

&nbsp;

&nbsp;

&nbsp;

- русификация legacy закрыта;
- счётчики уроков показываются корректно;
- из тренинга реально можно попасть в настройку правил, а не только “идите в продукты”.

&nbsp;

&nbsp;

&nbsp;

12. **Скрин из продукта добавить в acceptance criteria**
  На скрине Тренинги этого продукта именно этот экран должен стать понятным и рабочим:

&nbsp;

&nbsp;

&nbsp;

- русские статусы;
- корректные счётчики;
- понятный источник доступа;
- возможность открыть/редактировать настройки для конкретного тренинга.

&nbsp;

&nbsp;

План: PATCH B.1 hotfix + PATCH B.2 единая сквозная настройка

## Диагностика по скринам

**Скрин 1-2**: product-linked модули — показывается `ProductAccessInfoBlock` (readonly). Корректно.
**Скрин 3**: модуль без `product_id` — показывается legacy `ProductTariffAccessSelector`. Это ожидаемое поведение для непривязанных модулей, но может быть неконсистентно если модуль должен быть привязан.
**Скрин 4**: wizard в продукте — training_content rule, selector тренингов. Работает.

## Подтверждённые баги (PATCH B.1)

### Баг 1: `useTrainingModules.tsx` строки 204-218

`finalModules.filter()` всегда возвращает `true`. Root-контейнеры без видимых children НЕ скрываются.

**Fix**: при `lesson_count === 0` и отсутствии видимых children → `return false`.

### Баг 2: `useTrainingModules.tsx`

`lesson_count` / `completed_count` root-модулей не пересчитываются по видимым children после partial-фильтра.

**Fix**: после фильтрации, пересчитать root counts как сумму видимых children.

### Баг 3: `useSidebarModules.ts` строка 178

Root-модули всегда `return true`, даже если все children отфильтрованы.

**Fix**: проверить наличие видимых children; если нет и root не в allowlist → скрыть.

## PATCH B.2: Единая сквозная настройка

### 1. Расширить `ProductAccessInfoBlock`

Сейчас показывает: продукт, ссылку, legacy count, rules count (как число).
**Добавить**: реальный summary training_content rules:

- «Полный доступ» / «Частичный: N модулей, M уроков»
- Scope: продукт / тариф (название тарифа)
- Active / inactive
Данные брать через `useTrainingContentRulesForProduct(productId)`, фильтр по `target_ref = moduleId`.

### 2. Убедиться что `ProductAccessInfoBlock` используется везде

Проверено: `ModuleAccessForm` (строка 347) и `ContentCreationWizard` (строки 948, 1054) уже проверяют `product_id` и показывают `ProductAccessInfoBlock`. Логика корректна — если `product_id` есть, legacy selector не рендерится.

Скрин 3 не является багом — это модуль без `product_id`, legacy selector ожидаем.

### 3. Readonly-блок в продукте уже живой

`ProductLinkedTrainingsBlock.tsx` строки 634-689: блок «Правила гранулярности доступа» уже показывает live rules из `useTrainingContentRulesForProduct`. Scope, режим, counts, active/inactive — всё отображается.

## Файлы и изменения


| Файл                                                        | Действие                                     |
| ----------------------------------------------------------- | -------------------------------------------- |
| `src/hooks/useTrainingModules.tsx`                          | Fix: скрытие пустых root + пересчёт counts   |
| `src/hooks/useSidebarModules.ts`                            | Fix: скрытие root без видимых children       |
| `src/components/admin/trainings/ProductAccessInfoBlock.tsx` | Добавить live summary training_content rules |


## Детали изменений

### `useTrainingModules.tsx` строки 204-219

Заменить noop-фильтр:

```typescript
const finalModules = normalizedModules.filter(m => {
  if (isAdminUser) return true;
  if (!m.has_access && m.parent_module_id !== null) return true;
  if (m.parent_module_id === null && m.has_access) {
    const ownLessons = m.lesson_count || 0;
    const hasVisibleChildren = normalizedModules.some(
      child => child.parent_module_id === m.id && child.has_access && (child.lesson_count || 0) > 0
    );
    if (ownLessons === 0 && !hasVisibleChildren) return false;
  }
  return true;
});

// Recalc root counts from visible children
finalModules.forEach(m => {
  if (isAdminUser || m.parent_module_id !== null || !m.has_access) return;
  const visibleChildren = finalModules.filter(
    c => c.parent_module_id === m.id && c.has_access
  );
  if (visibleChildren.length > 0) {
    m.lesson_count = visibleChildren.reduce((s, c) => s + (c.lesson_count || 0), 0);
    m.completed_count = visibleChildren.reduce((s, c) => s + (c.completed_count || 0), 0);
  }
});
```

### `useSidebarModules.ts` строка 178

Заменить `if (!m.parent_module_id) return true;` на:

```typescript
if (!m.parent_module_id) {
  const hasVisibleChildren = modules.some(
    child => child.parent_module_id === m.id && child.has_access && isModAllowed(filter, child.id)
  );
  return hasVisibleChildren || isModAllowed(filter, m.id);
}
```

### `ProductAccessInfoBlock.tsx`

Добавить `useTrainingContentRulesForProduct(productId)` и вместо простого `rulesCount` badge показать:

- Если нет rules: «Не настроено — полный доступ»
- Если есть rules, для каждого matching `target_ref === moduleId`:
  - `full` → «Полный доступ» (badge green)
  - `partial` → «Частичный: N мод. M ур.» (badge amber)
  - Scope: «Продукт» / «Тариф: {name}»
  - Active/inactive

## Порядок

1. Fix `useTrainingModules.tsx` (баг 1+2)
2. Fix `useSidebarModules.ts` (баг 3)
3. Расширить `ProductAccessInfoBlock` (live summary)

## DoD

- Пустые root скрываются при partial filter (non-admin)
- Root lesson_count/completed_count пересчитаны по видимым children
- Sidebar скрывает root без видимых children
- ProductAccessInfoBlock показывает реальные rules, а не просто count
- Admin bypass сохраняется
- Регрессия: без training_content rules всё работает как раньше
- Для product-linked модулей старый selector не появляется (уже работает)