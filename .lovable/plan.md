## Проблема
На странице `/admin/training-modules/:moduleId/lessons` (например, «Вебинары» — дочерний модуль «База знаний») кнопка **«Назад»** (`AdminTrainingLessons.tsx:747`) и fallback-кнопка «Вернуться к списку» (`:718`) жёстко ведут на корень `/admin/training-modules`, теряя контекст родителя. Нужно возвращаться на один шаг — к родительскому модулю, если он есть.

## Что меняется

### `src/pages/admin/AdminTrainingLessons.tsx`

1. Добавить мемо `backHref`:
   ```ts
   const backHref = module?.parent_module_id
     ? `/admin/training-modules/${module.parent_module_id}/lessons`
     : "/admin/training-modules";
   ```
2. Заменить оба `navigate("/admin/training-modules")` на `navigate(backHref)` (строки 718 и 747).
3. Тултип/aria-label кнопки оставить «Назад» — текст не меняем.

### Что НЕ меняется
- Маршруты, breadcrumbs, остальная навигация.
- Поведение для модулей верхнего уровня (без `parent_module_id`) — как раньше уходит на корневой список.
- Никаких изменений БД, edge-функций, RLS.

## Поведение

```text
Вебинары (parent=База знаний) → «Назад» → /admin/training-modules/{Базы знаний}/lessons
База знаний (parent=null)     → «Назад» → /admin/training-modules
```

## DoD
- На скриншоте «Вебинары»: «Назад» ведёт на страницу модуля «База знаний» с её дочерними модулями и уроками.
- На корневом модуле без родителя: «Назад» по-прежнему ведёт в корень `/admin/training-modules`.
- Прямой заход по URL (когда `module` ещё грузится) не ломает кнопку — она временно ведёт в корень до загрузки `module`.
