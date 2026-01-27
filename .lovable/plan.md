

# План: Интерактивный мастер добавления контента

## Обзор существующей системы

На основе анализа кодовой базы выявлено:

### Уже реализовано (переиспользуем)
- **Хуки**: `useTrainingModules` (createModule, updateModule), `useTrainingLessons` (createLesson), `useLessonBlocks` (addBlock)
- **Формы**: `ModuleFormContent` (поля модуля), `LessonFormContent` (поля урока)
- **Селекторы**: `ContentSectionSelector` (выбор раздела меню), `CompactAccessSelector` (настройка доступа по тарифам), `DisplayLayoutSelector` (стиль отображения)
- **Редактор**: `LessonBlockEditor` — полноценный редактор блоков с drag-n-drop
- **Storage**: bucket `training-assets` для обложек и изображений

### Паттерны wizard в проекте
- `SmartImportWizard`: 5 шагов с прогрессом, состояние `step`, визуализация
- `GetCourseContentImportDialog`: пошаговый импорт тренингов

---

## Архитектура мастера добавления контента

### Структура шагов
```text
Шаг 1: Выбор раздела → Шаг 2: Создание модуля → Шаг 3: Добавление урока → Шаг 4: Настройка доступа → Готово
  ○────────○────────────────○─────────────────────○────────────────────────○
```

### Шаг 1: Выбор раздела
- Переиспользуем `ContentSectionSelector`
- Показываем иерархию: Раздел → Вкладка
- Можно создать новую вкладку прямо из мастера

### Шаг 2: Создание модуля (папки)
- Переиспользуем `ModuleFormContent` с адаптацией
- Поля: Название, Описание, Обложка (upload/AI), Цвет градиента
- Slug генерируется автоматически
- Переиспользуем `DisplayLayoutSelector` для стиля

### Шаг 3: Добавление первого урока
- Переиспользуем `LessonFormContent`
- Поля: Название, Тип контента, URL видео (если видео)
- Опционально: пропустить и добавить уроки позже

### Шаг 4: Настройка доступа
- Переиспользуем `CompactAccessSelector`
- Визуальное объяснение: "Кто увидит контент"
- Если ничего не выбрано → доступ для всех

### Шаг 5: Готово
- Сводка созданного контента
- Кнопки: "Редактировать урок" → `/admin/training-lessons/{moduleId}/edit/{lessonId}`
- Кнопки: "Добавить ещё урок", "Открыть модуль в каталоге"

---

## Компоненты для создания

### 1. ContentCreationWizard (новый компонент)
**Путь**: `src/components/admin/trainings/ContentCreationWizard.tsx`

```tsx
interface ContentCreationWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (result: { moduleId: string; lessonId?: string }) => void;
  initialSection?: string; // Предзаполнить раздел
}

// Состояние
const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
const [wizardData, setWizardData] = useState<WizardData>({
  menuSectionKey: null,
  module: { title: "", slug: "", ... },
  lesson: { title: "", content_type: "video", ... },
  tariffIds: [],
});
```

### 2. WizardStepIndicator (новый UI-компонент)
**Путь**: `src/components/admin/trainings/WizardStepIndicator.tsx`

Визуальный индикатор прогресса:
```tsx
<div className="flex items-center gap-2 mb-6">
  {steps.map((s, i) => (
    <div className={cn(
      "flex items-center gap-1.5",
      i < currentStep ? "text-primary" : "text-muted-foreground"
    )}>
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center",
        i < currentStep ? "bg-primary text-white" : 
        i === currentStep ? "bg-primary/20 text-primary" : "bg-muted"
      )}>
        {i < currentStep ? <Check className="h-4 w-4" /> : i + 1}
      </div>
      <span className="text-sm font-medium hidden md:block">{s.label}</span>
      {i < steps.length - 1 && <ChevronRight className="h-4 w-4" />}
    </div>
  ))}
</div>
```

### 3. Интеграция в AdminTrainingModules
Добавить кнопку "Мастер добавления контента" рядом с "+ Создать модуль"

---

## Переиспользование существующих компонентов

### ContentSectionSelector
- Используем как есть в Шаге 1
- Передаём `value` и `onChange` из wizardData

### ModuleFormContent
- Выносим в отдельный файл `src/components/admin/trainings/ModuleFormFields.tsx`
- Импортируем в wizard и в AdminTrainingModules (без дублирования)

### LessonFormContent  
- Аналогично выносим в `src/components/admin/trainings/LessonFormFields.tsx`
- Переиспользуем в wizard и AdminTrainingLessons

### CompactAccessSelector
- Используем как есть в Шаге 4

---

## Логика сохранения

### При переходе с Шага 2 на Шаг 3
```tsx
const handleModuleNext = async () => {
  const result = await createModule({
    ...wizardData.module,
    menu_section_key: wizardData.menuSectionKey,
    tariff_ids: [], // Настроим позже
  });
  if (result) {
    setCreatedModuleId(result.id);
    setStep(3);
  }
};
```

### При переходе с Шага 3 на Шаг 4
```tsx
const handleLessonNext = async () => {
  if (wizardData.lesson.title) {
    const result = await createLesson({
      ...wizardData.lesson,
      module_id: createdModuleId,
    });
    if (result) {
      setCreatedLessonId(result.id);
    }
  }
  setStep(4);
};
```

### При завершении (Шаг 4 → 5)
```tsx
const handleAccessSave = async () => {
  await updateModule(createdModuleId, {
    tariff_ids: wizardData.tariffIds,
  });
  setStep(5);
};
```

---

## UI/UX улучшения

### Подсказки на каждом шаге
- Шаг 1: "Выберите, где будет отображаться ваш контент в меню пользователя"
- Шаг 2: "Создайте папку для группировки уроков"
- Шаг 3: "Добавьте первый урок (можно пропустить)"
- Шаг 4: "Настройте, кто увидит контент"

### Валидация
- Шаг 1: Раздел должен быть выбран
- Шаг 2: Название модуля обязательно
- Шаг 3: Опционально (кнопка "Пропустить")
- Шаг 4: Без валидации (пустой = для всех)

### Кнопки навигации
```tsx
<DialogFooter className="flex justify-between">
  {step > 1 && (
    <Button variant="outline" onClick={() => setStep(s => s - 1)}>
      ← Назад
    </Button>
  )}
  <div className="flex-1" />
  {step < 4 ? (
    <Button onClick={handleNext} disabled={!canProceed}>
      Далее →
    </Button>
  ) : (
    <Button onClick={handleComplete}>
      Завершить ✓
    </Button>
  )}
</DialogFooter>
```

---

## Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `src/components/admin/trainings/ContentCreationWizard.tsx` | Создать — основной компонент мастера |
| `src/components/admin/trainings/WizardStepIndicator.tsx` | Создать — индикатор прогресса |
| `src/components/admin/trainings/ModuleFormFields.tsx` | Создать — вынести форму модуля из AdminTrainingModules |
| `src/components/admin/trainings/LessonFormFields.tsx` | Создать — вынести форму урока из AdminTrainingLessons |
| `src/pages/admin/AdminTrainingModules.tsx` | Изменить — добавить кнопку мастера, импортировать ModuleFormFields |
| `src/pages/admin/AdminTrainingLessons.tsx` | Изменить — импортировать LessonFormFields |

---

## Дополнительные улучшения

### AI-генерация обложки (опционально, следующий спринт)
- Кнопка "Сгенерировать обложку" в Шаге 2
- Вызов Lovable AI для создания минималистичного изображения
- Fallback: градиент с названием модуля

### Быстрые пресеты
- "Вебинар": тип = video, layout = list
- "Курс": тип = mixed, layout = grid
- "Документы": тип = document, layout = compact

---

## Технические детали

### Изоляция от существующего кода
- Wizard не изменяет логику существующих страниц
- Все создания идут через существующие хуки (createModule, createLesson)
- Формы выносятся в отдельные файлы для переиспользования

### Совместимость с мобильными устройствами
- Шаги отображаются компактно (номера вместо текста)
- Диалог занимает весь экран на мобильном
- Touch-friendly кнопки (min 44px)

---

## Проверка готовности (DoD)

- [ ] Wizard открывается из AdminTrainingModules
- [ ] Шаг 1: выбор раздела работает
- [ ] Шаг 2: модуль создаётся в базе
- [ ] Шаг 3: урок создаётся (или пропускается)
- [ ] Шаг 4: доступ сохраняется
- [ ] Шаг 5: показывается сводка с ссылками
- [ ] Формы модуля/урока переиспользуются без дублирования
- [ ] Прогресс-бар отображает текущий шаг
- [ ] Весь UI на русском языке

