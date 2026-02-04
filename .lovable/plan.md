
# План исправления: Потеря данных в пройденных блоках kvest-режима

## Диагноз

**Корневая причина:** В `KvestLessonView.tsx` (строки 259-265) завершённые блоки рендерятся через `<LessonBlockRenderer {...commonProps} />` **БЕЗ `kvestProps`**.

```typescript
// Проблемный код (строки 259-266):
if (isCompleted && !isCurrent) {
  return (
    <div className="opacity-80 pointer-events-none">
      <LessonBlockRenderer {...commonProps} />  // ← kvestProps отсутствует!
    </div>
  );
}
```

### Что происходит:

1. Пользователь проходит тест → `role: executor` сохраняется в БД ✅
2. Блок `quiz_survey` помечается как `isCompleted: true`
3. Пользователь переходит на следующий шаг → блоки ДО текущего рендерятся в read-only режиме
4. **БАГ:** Read-only рендер НЕ передаёт `kvestProps` → компоненты не получают:
   - `quiz_survey`: `savedAnswer` (ответы) → показывает пустой тест
   - `role_description`: `userRole` → показывает "Сначала пройдите тест"
   - `diagnostic_table`: `rows` → пустая таблица
   - `sequential_form`: `answers` → пустая форма

### Данные в БД (подтверждено):
```json
{
  "role": "executor",
  "completedSteps": ["90daa613...", "ee5f06cb..."],
  "currentStepIndex": 2
}
```
Данные сохраняются корректно, проблема только в отображении!

---

## Решение

### PATCH: KvestLessonView — передавать kvestProps для завершённых блоков

**Файл:** `src/components/lesson/KvestLessonView.tsx`

**Изменение:** Вместо отдельной ветки для `isCompleted && !isCurrent`, добавить `kvestProps` с `isReadOnly: true` в основной switch. Или: передавать соответствующие props даже в read-only режиме.

### Вариант A: Минимальный — добавить kvestProps в read-only ветку

```typescript
// БЫЛО:
if (isCompleted && !isCurrent) {
  return (
    <div className="opacity-80 pointer-events-none">
      <LessonBlockRenderer {...commonProps} />
    </div>
  );
}

// СТАНЕТ:
// Убрать эту ветку и добавить isReadOnly=true в switch-case
```

### Вариант B: Конкретные props для каждого типа блока

```typescript
// Render block with kvest-specific props
const renderBlockWithProps = useCallback((block: LessonBlock, isCompleted: boolean, isCurrent: boolean) => {
  const blockType = block.block_type;
  const blockId = block.id;
  const isReadOnly = isCompleted && !isCurrent; // Новый флаг
  
  const commonProps = {
    blocks: [block],
    lessonId: lesson.id,
  };

  // Убираем раннее условие с пустым LessonBlockRenderer!
  // Каждый блок должен получать свои props независимо от состояния

  switch (blockType) {
    case 'quiz_survey':
      return (
        <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
          <LessonBlockRenderer 
            {...commonProps}
            kvestProps={{
              onRoleSelected: handleRoleSelected,
              isCompleted: isCompleted,
              // savedAnswer хранится в user_lesson_progress, не в kvestProps!
            }}
          />
        </div>
      );
    
    case 'role_description':
      return (
        <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
          <LessonBlockRenderer 
            {...commonProps}
            kvestProps={{
              role: userRole,   // ← КРИТИЧЕСКИ ВАЖНО для read-only режима
              onComplete: isReadOnly ? undefined : () => handleRoleDescriptionComplete(blockId),
              isCompleted: isCompleted,
            }}
          />
        </div>
      );
    
    // ... аналогично для других типов
  }
}, [/* deps */]);
```

---

## Детальные изменения

### 1. Удалить раннее условие (строки 259-266)

Убрать блок:
```typescript
if (isCompleted && !isCurrent) {
  return (
    <div className="opacity-80 pointer-events-none">
      <LessonBlockRenderer {...commonProps} />
    </div>
  );
}
```

### 2. Добавить isReadOnly в каждый case

Вместо отдельной ветки, каждый case применяет стили `opacity-80 pointer-events-none` условно:

```typescript
const isReadOnly = isCompleted && !isCurrent;

case 'quiz_survey':
  return (
    <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
      <LessonBlockRenderer 
        {...commonProps}
        kvestProps={{
          onRoleSelected: isReadOnly ? undefined : handleRoleSelected,
          isCompleted: isCompleted,
        }}
      />
    </div>
  );

case 'role_description':
  return (
    <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
      <LessonBlockRenderer 
        {...commonProps}
        kvestProps={{
          role: userRole,  // ← ВСЕГДА передаём роль!
          onComplete: isReadOnly ? undefined : () => handleRoleDescriptionComplete(blockId),
          isCompleted: isCompleted,
        }}
      />
    </div>
  );

case 'diagnostic_table':
  return (
    <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
      <LessonBlockRenderer 
        {...commonProps}
        kvestProps={{
          rows: pointARows,  // ← ВСЕГДА передаём данные!
          onRowsChange: isReadOnly ? undefined : handleDiagnosticTableUpdate,
          onComplete: isReadOnly ? undefined : () => handleDiagnosticTableComplete(blockId),
          isCompleted: state?.pointA_completed || false,
        }}
      />
    </div>
  );

case 'sequential_form':
  return (
    <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
      <LessonBlockRenderer 
        {...commonProps}
        kvestProps={{
          answers: pointBAnswers,  // ← ВСЕГДА передаём данные!
          onAnswersChange: isReadOnly ? undefined : handleSequentialFormUpdate,
          onComplete: isReadOnly ? undefined : () => handleSequentialFormComplete(blockId),
          isCompleted: state?.pointB_completed || false,
        }}
      />
    </div>
  );
```

### 3. Default case — fallback для неизвестных типов

```typescript
default:
  return (
    <div className={isReadOnly ? "opacity-80 pointer-events-none" : ""}>
      <LessonBlockRenderer {...commonProps} />
    </div>
  );
```

---

## Файлы для изменения

| Файл | Что изменить |
|------|--------------|
| `src/components/lesson/KvestLessonView.tsx` | Удалить строки 259-266, добавить isReadOnly в каждый case |

---

## DoD (Definition of Done)

| Проверка | Ожидаемый результат |
|----------|---------------------|
| Пройти тест → перейти к следующему шагу | Тест показывает выбранные ответы |
| Блок "Описание роли" на шаге 3+ | Показывает текст для роли, а не заглушку |
| Диагностика точки А (read-only) | Показывает заполненные строки |
| Формула точки Б (read-only) | Показывает введённые ответы |
| Текущий активный блок | Интерактивный, можно изменять |

---

## Технические заметки

- `quiz_survey` получает `savedAnswer` из `user_lesson_progress` через `LessonBlockRenderer.handleQuizSubmit()` — это работает отдельно от `kvestProps`
- `role_description` требует `userRole` из `kvestProps.role` — это сломано в read-only
- `diagnostic_table` и `sequential_form` требуют данные из `kvestProps.rows` / `kvestProps.answers` — это сломано в read-only
