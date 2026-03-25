# P2 Patch — ВЫПОЛНЕН

## Что сделано

### PATCH A: Обновление промпта balance_analysis
- Обновлён `prompt_text` с обязательной структурой из 11 разделов
- Три блока прозрачности: «Что извлечено», «Что рассчитано AI», «Как интерпретировано по нормам»
- Обязательный шаблон: Показатель / Норма / Факт / Статус / Краткий вывод
- Итоговый рейтинг: устойчиво / напряжённо / рискованно / критично
- Обновлены title, description, input_hint, launcher_title, launcher_description

### PATCH B: Markdown rendering
- Установлен `react-markdown`
- Assistant messages: ReactMarkdown с custom component overrides (h1-h3, ul/ol, table, strong, p, blockquote)
- User messages: остались plain text whitespace-pre-wrap
- Таблицы: overflow-x-auto для предотвращения разрыва bubble

### PATCH C+E: Persistence и Resume
- `useAiChat` использует `useAuth()` внутри — без ручного userId
- localStorage key: `gorbova_ai_last_conversation_${user.id}`
- `loadConversation(convId)` — запрос с фильтром `user_id = user.id`
- `resumeConversation(convId)` — загрузка + восстановление scenario context (prompt_id, scenario_type, launcher_title_snapshot)
- На mount: восстановление последней сессии, очистка при пустом результате
- `clearChat` удаляет localStorage key
- Scenario context НЕ открывает upload flow автоматически

### PATCH D: История анализа
- Новый `useAnalysisHistory` hook с `useAuth()` внутри
- Группировка assistant messages с scenario_type по conversation_id
- Fallback title: «Анализ баланса» для balance_analysis, иначе «Анализ документа»
- Preview из последнего assistant-ответа (150 символов)
- updated_at по последнему сообщению сессии
- Таб «История анализа» между «Чат» и «Туториалы»
- Карточки: title/fallback, file badges, created_at, updated_at, preview
- «Открыть» и «Продолжить анализ» — оба через тот же conversation_id

## Security
- RLS на `ai_chat_messages`: `user_id = auth.uid()` (уже существует)
- Все клиентские запросы фильтруют по `user_id` (defense-in-depth)
- localStorage namespaced по userId
- Без аутентификации — нет записи в localStorage

## DoD
1. ✅ Reload → последняя сессия восстанавливается через namespaced localStorage
2. ✅ Битая/пустая сессия → welcome screen
3. ✅ Markdown: заголовки, списки, bold, таблицы (с overflow)
4. ✅ Карточки истории: title/fallback, files, created_at, updated_at, preview
5. ✅ Resume → тот же conversation_id, scenario context восстановлен
6. ✅ Фильтр user_id + RLS → чужие сессии недоступны
7. ⏳ balance_analysis output: proof нужен на реальном файле
