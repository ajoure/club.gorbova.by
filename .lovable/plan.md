
# Отчёт о выполнении: Динамические таблицы прогресса + обратная связь по урокам

## Статус: Код завершён ✅

---

## 1. Что изменено

| Файл | Что изменено |
|---|---|
| `src/lib/blockProgressResolver.ts` | **НОВЫЙ** — shared resolver для маппинга ответов по block_type. Единый реестр `resolveProgressValue()`, `getInteractiveBlocks()`, `getBlockLabel()`. Используется и в таблице, и в модалке. |
| `src/pages/admin/AdminLessonProgress.tsx` | Динамические колонки из `lesson_blocks` (по sort_order). Sticky first column + horizontal scroll. Колонка «💬 Связь» с unread/timestamp. Саммари: интерактивные блоки + среднее ответов. |
| `src/components/admin/trainings/StudentProgressModal.tsx` | Универсальный рендерер ответов по block_type: quiz, checklist, rating, file_upload, sequential_form, diagnostic_table (V1+V2), input_short, role_description. Fallback для unknown типов. |
| `src/hooks/useTrainingFeedback.ts` | **Добавлен** `useUnreadFeedbackByLesson()` — batch-запрос unread feedback per lesson_id, realtime invalidation, staleTime=15s, anti-spam (без toast на load/refetch). |
| `src/pages/BusinessTrainingContent.tsx` | Бейдж 💬 у каждого урока с непрочитанным фидбэком. |
| `src/pages/LibraryModule.tsx` | Бейдж 💬 у каждого урока с непрочитанным фидбэком. |

---

## 2. Архитектурные решения

- **ID-driven**: все связи по block_id/lesson_id (UUID), заголовок — только display label
- **Shared resolver**: один `blockProgressResolver.ts` для таблицы и модалки, дублирование запрещено
- **No N+1**: lesson_blocks, user_lesson_progress, feedback tickets — batch-запросы
- **Fallback**: неподдержанный block_type → «✓ есть ответ» / «Нет ответа», таблица не ломается
- **Anti-spam**: toast не показывается на initial load / reconnect / background refetch
- **Per-lesson isolation**: unread badge считается строго по lesson_id

## 3. Интерактивные типы блоков (из кода)

```
input_short, file_upload, quiz_single, quiz_survey, sequential_form,
diagnostic_table, checklist, rating, table_input, quiz_multiple,
quiz_true_false, role_description
```

## 4. Что НЕ делаем

- Не создаём новых таблиц / edge functions
- Не дублируем block-type mapping в UI
- Не связываем сущности по title/text
- Не создаём второй SoT для feedback поверх support_tickets

## 5. Follow-up (не блокирует)

- Browser/runtime proof по realtime
- UX polish для mobile
- Расширение summary для сложных block types
- Унификация с support center counters
