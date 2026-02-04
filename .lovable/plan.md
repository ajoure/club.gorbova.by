
# План: Добавить выбор модуля-папки для уроков в Мастере добавления контента

## Выявленная проблема

Сейчас при выборе типа "Урок" в wizard:
1. Создаётся автоматический `is_container=true` модуль для standalone-уроков
2. Уроки попадают в "общую папку" раздела
3. **Проблема**: Нельзя выбрать существующий модуль (например, "Бухгалтерия как бизнес") для размещения урока внутри него

**Желаемое поведение**:
- При выборе "Урок" → показать промежуточный шаг "Выберите папку"
- Опции: "Отдельный урок" (как сейчас, в контейнере) ИЛИ выбрать один из существующих модулей

---

## Решение: Новый шаг "Выбор модуля" в lesson flow

### PATCH-1: Новый компонент `ModuleSelector.tsx`

**Файл**: `src/components/admin/trainings/ModuleSelector.tsx`

Компонент для выбора целевого модуля:

```typescript
interface ModuleSelectorProps {
  sectionKey: string;  // Текущий выбранный раздел меню
  selectedModuleId: string | null;  // null = "standalone" (контейнер)
  onSelect: (moduleId: string | null) => void;
}
```

Отображает:
1. Опция "Отдельный урок" (иконка Video, описание "Урок будет отображаться напрямую в разделе") — это `moduleId = null`
2. Список существующих модулей в этом `menu_section_key` (где `is_container = false`)
3. Кнопка "Создать новый модуль..." — открывает quick-create модуля

UI:
```text
┌─────────────────────────────────────────────────────────────┐
│ Выберите, где разместить урок                              │
├─────────────────────────────────────────────────────────────┤
│ ○ Отдельный урок                                           │
│   Урок будет отображаться напрямую в разделе               │
├─────────────────────────────────────────────────────────────┤
│ ● Бухгалтерия как бизнес                                   │
│   Урок будет частью модуля                                 │
├─────────────────────────────────────────────────────────────┤
│ [+ Создать новый модуль...]                                │
└─────────────────────────────────────────────────────────────┘
```

---

### PATCH-2: Обновить `WizardData` и шаги в `ContentCreationWizard.tsx`

1. Добавить поле в `WizardData`:
```typescript
interface WizardData {
  // ... существующие поля
  targetModuleId: string | null;  // null = standalone (контейнер), UUID = существующий модуль
}
```

2. Обновить `LESSON_STEPS`:
```typescript
// Было: Раздел → Тип → Доступ → Урок → Готово (5 шагов)
// Станет: Раздел → Тип → Модуль → Доступ → Урок → Готово (6 шагов)
const LESSON_STEPS = [
  { label: "Раздел", shortLabel: "1" },
  { label: "Тип", shortLabel: "2" },
  { label: "Модуль", shortLabel: "3" },    // НОВЫЙ ШАГ
  { label: "Доступ", shortLabel: "4" },
  { label: "Урок", shortLabel: "5" },
  { label: "Готово", shortLabel: "✓" },
];
```

3. Обновить `renderStepContent()`:
```typescript
// Step 2: Module selection (NEW for lesson flow)
if (isLessonFlow && step === 2) {
  return (
    <ModuleSelector
      sectionKey={wizardData.menuSectionKey}
      selectedModuleId={wizardData.targetModuleId}
      onSelect={(id) => setWizardData(prev => ({ ...prev, targetModuleId: id }))}
    />
  );
}

// Остальные шаги сдвигаются на +1
```

4. Обновить валидацию `canProceed`:
```typescript
case 2: return true;  // Module selection is optional (null = standalone)
case 3: return true;  // Access is optional
case 4: // Lesson data
  if (isKbFlow) {
    return wizardData.kbLesson.episode_number > 0;
  }
  return !!wizardData.lesson.title && !!wizardData.lesson.slug;
```

5. Обновить `handleCreateStandaloneLessonWithAccess`:
```typescript
// Если выбран существующий модуль — использовать его
// Если null — создать/использовать контейнер как сейчас
const containerId = wizardData.targetModuleId 
  ? wizardData.targetModuleId 
  : await getOrCreateContainerModule(wizardData.menuSectionKey);
```

---

### PATCH-3: Создать inline Quick-Create модуля

В `ModuleSelector.tsx` добавить возможность быстро создать модуль:

1. Нажатие "Создать новый модуль..." открывает inline-форму
2. Минимальные поля: Название, Slug (авто)
3. После создания — сразу выбирается новый модуль

```typescript
const handleQuickCreateModule = async () => {
  // Создать модуль с минимальными данными
  const slug = await ensureUniqueSlug(generateSlug(quickModuleTitle));
  const { data, error } = await supabase
    .from("training_modules")
    .insert({
      title: quickModuleTitle,
      slug,
      menu_section_key: sectionKey,
      is_container: false,
      is_active: true,
    })
    .select("id")
    .single();
  
  if (!error && data) {
    onSelect(data.id);
    setQuickModuleTitle("");
    setShowQuickCreate(false);
  }
};
```

---

## Изменения шагов (Lesson Flow)

| Шаг | Было | Станет |
|-----|------|--------|
| 0 | Раздел меню | Раздел меню |
| 1 | Тип | Тип |
| 2 | Доступ | **Модуль (НОВЫЙ)** |
| 3 | Урок | Доступ |
| 4 | Готово | Урок |
| 5 | — | Готово |

---

## Файлы к созданию/изменению

| Файл | Действие |
|------|----------|
| `src/components/admin/trainings/ModuleSelector.tsx` | **Создать** |
| `src/components/admin/trainings/ContentCreationWizard.tsx` | Добавить шаг и логику |

---

## Дополнительно: Кнопка "Добавить урок" в AdminTrainingLessons

На странице `/admin/training-modules/:moduleId/lessons` уже есть кнопка "Добавить урок" которая открывает простой диалог создания урока. Можно **опционально** добавить кнопку "Мастер" которая откроет wizard с предустановленным `targetModuleId`.

---

## DoD (Definition of Done)

| # | Проверка | Ожидание |
|---|----------|----------|
| 1 | Открыть wizard → Урок | После шага "Тип" появляется шаг "Модуль" |
| 2 | Выбрать существующий модуль | Урок создаётся в этом модуле |
| 3 | Выбрать "Отдельный урок" | Урок создаётся в контейнере (как раньше) |
| 4 | Нажать "Создать новый модуль" | Модуль создаётся, урок добавляется в него |
| 5 | После создания → `/admin/training-modules/:id/lessons` | Урок виден в списке уроков модуля |

---

## Безопасность и ограничения

- Никаких изменений RLS/RBAC
- Add-only подход: новый компонент + минимальные изменения в wizard
- Существующий функционал KB-разделов не затрагивается
- Все тексты на русском языке
- Фильтрация модулей: только `is_container = false` (реальные модули, не контейнеры)
