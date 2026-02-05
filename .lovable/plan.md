
# План: Исправление видимости запланированных уроков

## Проблема

В хуке `useTrainingLessons.tsx` (строка 129) уроки с `published_at > now` полностью **скрываются** от пользователей:

```typescript
.filter(lesson => isAdminUser || !lesson.published_at || new Date(lesson.published_at) <= now)
```

Но по бизнес-требованиям (memory: visibility-and-scheduling-policy) уроки с будущей датой должны **отображаться** со статусом "Скоро" (locked, с указанием даты/времени открытия).

## Решение

Убрать фильтрацию по `published_at` и оставить только флаг `isScheduled` для UI:

### Изменения в `src/hooks/useTrainingLessons.tsx`

**Было (строки 125-136):**
```typescript
const lessonsWithScheduleFlag = enrichedLessons
  .filter(lesson => isAdminUser || lesson.is_active)
  .filter(lesson => isAdminUser || !lesson.published_at || new Date(lesson.published_at) <= now)  // <-- ЭТО СКРЫВАЕТ
  .map(lesson => ({
    ...lesson,
    isScheduled: !isAdminUser && lesson.published_at 
      ? new Date(lesson.published_at) > now 
      : false,
  }));
```

**Станет:**
```typescript
const lessonsWithScheduleFlag = enrichedLessons
  // Filter: admin sees all, user sees only is_active=true
  .filter(lesson => isAdminUser || lesson.is_active)
  // НЕ фильтруем по published_at — урок показываем, но с флагом isScheduled
  .map(lesson => {
    const publishedAt = lesson.published_at ? new Date(lesson.published_at) : null;
    const isScheduled = publishedAt && publishedAt > now;
    return {
      ...lesson,
      // isScheduled = true для уроков с будущей датой (показываем "Скоро")
      isScheduled: Boolean(isScheduled),
    };
  });
```

## Результат

| До исправления | После исправления |
|----------------|-------------------|
| Урок с `published_at = 05.02.2026 19:00` не виден вообще до 19:00 | Урок виден с бейджем "Скоро: 5 фев в 19:00", заблокирован для просмотра |

## DoD

1. Урок "Тест: В какой роли вы находитесь" виден в списке уроков модуля
2. Отображается бейдж "Скоро: 5 фев в 19:00" (или текущая дата/время публикации)
3. При клике — не переходит (заблокирован) или показывает placeholder
4. После наступления времени публикации — урок открывается нормально
