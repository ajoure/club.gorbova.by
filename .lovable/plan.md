# да, согласен, с учетом правок:

&nbsp;

1. В план нужно явно добавить **корень бага tree picker**: проблема не только в рекурсивной логике, а в том, что сейчас используются **два раздельных колбэка** (onChangeModules и onChangeLessons), которые вызывают два setForm подряд с одним и тем же stale snapshot формы. Из-за этого второй вызов затирает результат первого. Исправление делать через **единый атомарный API**:
  &nbsp;
  - onChange(moduleIds, lessonIds)
  - в ProductAccessRulesTab только setForm(prev => ({ ...prev, tc_allowed_module_ids, tc_allowed_lesson_ids }))
  &nbsp;
2. В DoD по tree picker нужно добавить отдельные пункты:
  &nbsp;
  - клик по модулю выбирает **всю ветку**: сам модуль, все дочерние модули и все уроки в поддереве;
  - снятие модуля снимает **всю ветку**;
  - ручной выбор всех уроков внутри модуля переводит модуль в checked;
  - Весь тренинг, Выбрать всё, Снять всё меняют state реально, а не только UI.
  &nbsp;
3. Блок с **0 уроков** нужно исправлять не “в целом”, а в конкретном месте:
  &nbsp;
  - в ProductLinkedTrainingsBlock для children в matrix/list view заменить использование прямого child.lesson_count на **единый helper** подсчёта по дереву (countTreeLessons(child) или вынесенный shared helper);
  - если корректный count недоступен, count **не показывать**, а не выводить ложный 0.
  &nbsp;
4. В план добавить явную проверку, что **оба экрана используют одинаковую формулу lesson counts**:
  &nbsp;
  - “Тренинги этого продукта”
  - “Привязать тренинг”
    Иначе после hotfix один экран будет исправлен, а второй останется с ложными нулями.
  &nbsp;
5. По BindTrainingDialog добавить, что нужно убрать не только disabled-тупик, но и сделать **три явных action-state** на одной карточке:
  &nbsp;
  - Привязать
  - Перепривязать к этому продукту
  - Отвязать
    без скрытых/неявных сценариев и без необходимости сначала закрывать один диалог и потом открывать другой вручную.
  &nbsp;
6. В части deep-link/navigation добавить guard:
  &nbsp;
  - страница продукта должна понимать tab=access_rules;
  - для create/edit rule нельзя терять location.state.accessRulesAction при первом рендере/переключении таба;
  - после открытия create/edit нужного сценария state должен быть **одноразово** consumed, чтобы диалог не открывался повторно при refresh/повторном рендере.
  &nbsp;
7. В ProductAccessInfoBlock добавить в план не просто “рабочие кнопки”, а **разведение сценариев**:
  &nbsp;
  - Открыть продукт → карточка продукта;
  - Вкладка «Доступы» → tab access_rules;
  - Создать правило → create-dialog training_content с предзаполненным target_ref = moduleId;
  - Редактировать правило → edit-dialog по [rule.id](http://rule.id);
  - если правил несколько, не открывать “первое попавшееся”, а либо открывать конкретное релевантное для moduleId, либо сначала показывать список.
  &nbsp;
8. В русификации добавить отдельный подпункт:
  &nbsp;
  - убрать из UI все надписи вида legacy, summary, binding_source, rules, diagnostics в пользовательском слое;
  - заменить бейдж legacy в списке тренингов продукта на понятный русский текст, например старый контур.
  &nbsp;
9. В план нужно добавить **proof по payload**:
  &nbsp;
  - после выбора ветки / всего тренинга / отдельных уроков проверить, что в access_rules.conditions сохраняются корректные allowed_module_ids и allowed_lesson_ids;
  - уроки, покрытые выбранным модулем, не дублируются в allowed_lesson_ids.
  &nbsp;
10. В финальный DoD добавить два обязательных пункта:

&nbsp;

&nbsp;

&nbsp;

- на скрине/в UI больше нет массовых ложных 0 уроков;
- partial-access tree picker полностью рабочий не только визуально, но и по фактически сохраненному payload в БД.

&nbsp;

&nbsp;

&nbsp;

11. Scope лучше сузить и явно разделить:

&nbsp;

&nbsp;

&nbsp;

- **B.1 hotfix**: tree picker + lesson counts + bind/rebind/unbind + русификация;
- **B.2 navigation/workflow**: deep-link, create/edit rule from product/training surfaces.
  Так будет проще проверять и не смешивать UI-fix с routing-state логикой в один нечитаемый proof.

&nbsp;

&nbsp;

&nbsp;

12. В STOP-guards добавить:

&nbsp;

&nbsp;

&nbsp;

- если для counts потребуется дублировать разную логику в нескольких местах, сначала вынести **один shared helper**, а не чинить вручную каждый экран отдельно;
- если create/edit rule из readonly-блока нельзя открыть без второго параллельного workflow, не плодить новый wizard, а расширить существующий ProductAccessRulesTab.

&nbsp;

&nbsp;

План: Hotfix для tree picker, lesson counts и консистентности

## 1. Корневая причина неработающего tree picker

**Подтверждённый баг**: в `ProductAccessRulesTab.tsx` (строки 1216-1217) два колбэка `onChangeModules` и `onChangeLessons` вызываются последовательно из одного `toggleModule` / `toggleLesson`, но каждый делает `setForm({ ...form, ... })` с одним и тем же снимком `form`. Второй вызов перезаписывает результат первого.

```text
toggleModule → onChangeModules(newMods)  → setForm({...form, tc_allowed_module_ids: newMods})
             → onChangeLessons(newLess)  → setForm({...form, tc_allowed_lesson_ids: newLess})
                                            ↑ form ещё старый, tc_allowed_module_ids откатился
```

**Решение**: изменить API `TrainingContentTreePicker` на единый колбэк `onChange(moduleIds, lessonIds)`, который вызывается один раз. В `ProductAccessRulesTab` обработчик будет `setForm(prev => ({ ...prev, tc_allowed_module_ids: mods, tc_allowed_lesson_ids: lessons }))`.

### Изменения

`**TrainingContentTreePicker.tsx**`:

- Заменить `onChangeModules` + `onChangeLessons` на единый `onChange: (moduleIds: string[], lessonIds: string[]) => void`
- Все внутренние операции (`toggleModule`, `toggleLesson`, `handleSelectAll`, `Выбрать всё`, `Снять всё`) вызывают `onChange(newMods, newLess)` атомарно

`**ProductAccessRulesTab.tsx**`:

- Заменить два колбэка на один:

```typescript
onChange={(mods, lessons) => setForm(prev => ({
  ...prev,
  tc_allowed_module_ids: mods,
  tc_allowed_lesson_ids: lessons,
}))}
```

## 2. Ложные «0 уроков»

**Причина**: `useProductTrainings` (строка 145) считает `lesson_count` только прямые уроки модуля (`lessonCounts[m.id] || 0`). Для child-модулей, у которых уроки во вложенных подмодулях, показывается 0.

**Решение**:

- В `TrainingTreeItem` (строка 37) уже используется `countTreeLessons(training)` для root — это сумма по всему поддереву. Для children тоже надо использовать `countTreeLessons` вместо `child.lesson_count`
- В `TrainingMatrixView` (строка 478) заменить `child.lesson_count` на `countTreeLessons(child)`
- Это единый helper, один источник подсчёта для обоих экранов

## 3. Файлы и изменения


| Файл                              | Изменение                                                                |
| --------------------------------- | ------------------------------------------------------------------------ |
| `TrainingContentTreePicker.tsx`   | Заменить dual-callback API на единый `onChange(mods, lessons)`           |
| `ProductAccessRulesTab.tsx`       | Адаптировать вызов TreePicker под новый API                              |
| `ProductLinkedTrainingsBlock.tsx` | В matrix view заменить `child.lesson_count` на `countTreeLessons(child)` |


## 4. Русификация (остатки)

В `ProductLinkedTrainingsBlock.tsx` проверить и заменить оставшиеся английские метки:

- строка 169: `"⚠ Да"` → `"⚠ Есть"`  (уже на русском, ок)
- строка 176: `"binding_source"` — внутренний тип, не отображается в UI
- Убедиться что в diagnostics-секции нет английских слов

## 5. Порядок выполнения

1. Переписать API TreePicker на единый `onChange`
2. Адаптировать ProductAccessRulesTab
3. Исправить lesson counts в matrix view
4. Проверить русификацию

## 6. DoD

- Весь тренинг / Выбрать всё / Снять всё реально меняют state
- Клик по модулю выбирает всю ветку
- Снятие модуля снимает всю ветку
- Partial = indeterminate
- В matrix view нет ложных массовых «0 уроков»
- Все пользовательские подписи на русском