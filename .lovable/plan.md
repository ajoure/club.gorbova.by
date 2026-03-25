# да, согласен, с учетом правок:

&nbsp;

1. **PATCH C: восстанавливать последнюю открытую сессию только после успешной загрузки**
  &nbsp;
  - Если gorbova_ai_last_conversation_${[user.id](http://user.id)} найден, но loadConversation вернул пусто/ошибку, нужно:
    &nbsp;
    - очистить этот ключ;
    - показать welcome screen.
    &nbsp;
  - Иначе можно зациклиться на битой ссылке на сессию.
  &nbsp;
2. **PATCH C: resumeConversation должен возвращать восстановленный scenario context**
  &nbsp;
  - Не просто грузить сообщения, а явно возвращать:
    &nbsp;
    - prompt_id
    - scenario_type
    - launcher_title_snapshot
    &nbsp;
  - Это упростит корректное восстановление контекста в AI.tsx.
  &nbsp;
3. **PATCH D: в истории брать preview из последнего assistant-ответа**
  &nbsp;
  - Это правильнее, чем из первого.
  - Тогда карточка показывает актуальный итог анализа после догрузки документов.
  &nbsp;
4. **PATCH D: updated_at для карточки истории вычислять по последнему сообщению сессии**
  &nbsp;
  - Не только по assistant-сообщениям, а по последнему сообщению в сессии, если нужно показать факт продолжения анализа.
  - Но preview оставлять из последнего assistant-ответа.
  &nbsp;
5. **PATCH D/E: “Открыть” и “Продолжить анализ” должны использовать один и тот же conversation_id**
  &nbsp;
  - Разница только в UX:
    &nbsp;
    - Открыть — просто открыть историю;
    - Продолжить анализ — открыть чат, оставить поле ввода/дозагрузку доступными.
    &nbsp;
  - Новую сессию не создавать.
  &nbsp;
6. **PATCH B: markdown для assistant-сообщений нужно стилизовать так, чтобы таблицы не ломали bubble**
  &nbsp;
  - Для table предусмотреть horizontal overflow/scroll внутри сообщения.
  - Иначе большие табличные ответы будут ломать layout.
  &nbsp;
7. **PATCH A: в prompt явно закрепить раздел “как интерпретировано по нормам”**
  &nbsp;
  - Не просто как пожелание, а как обязательный отдельный блок ответа.
  - Это важно, чтобы бот не смешивал факты из файла и собственную трактовку.
  &nbsp;
8. **PATCH A: шаблон ключевых показателей сделать жестким**
  &nbsp;
  - Для каждого показателя обязательно:
    &nbsp;
    - Показатель
    - Норма
    - Факт
    - Статус
    - Краткий вывод
    &nbsp;
  &nbsp;
9. **Security/DoD**
  &nbsp;
  - Оставить как обязательный proof:
    &nbsp;
    - чужая сессия не открывается ни через history, ни через прямой conversation_id;
    - после reload восстанавливается именно последняя открытая сессия текущего пользователя;
    - после resume новое сообщение уходит в тот же conversation_id.
    &nbsp;
  &nbsp;
10. **Proof по prompt upgrade**

&nbsp;

&nbsp;

&nbsp;

- Для закрытия PATCH A нужен реальный пример ответа, где уже есть:
  &nbsp;
  - рейтинг,
  - краткий вывод для собственника,
  - блок “что извлечено”,
  - блок “что рассчитано AI”,
  - блок “как интерпретировано по нормам”,
  - формат “Норма / Факт / Статус”,
  - рекомендации по периодам.
  &nbsp;

&nbsp;

&nbsp;

P2 Patch: Markdown + Persistence + Analysis History + Prompt Upgrade

## PATCH A: Update `balance_analysis` prompt

**Tool**: DB insert tool (UPDATE `ai_user_prompts` WHERE `code = 'balance_analysis'`)

New `prompt_text` enforces strict structure:

1. **Итоговый рейтинг** — устойчиво / напряжённо / рискованно / критично (по правилам prompt)
2. **Краткий вывод для собственника** — 3-5 строк
3. **Что извлечено из документа** — только факты из файла
4. **Что рассчитано AI** — коэффициенты на основе данных
5. **Как интерпретировано по нормам** — методика и правила
6. **Чего не хватает**
7. **Ключевые показатели** — обязательный шаблон: Показатель / Норма / Факт / Статус (✅/⚠️/🔴) / Краткий вывод
8. **Основные риски**
9. **Рекомендации**: краткосрочно / среднесрочно / на следующий год
10. **Что улучшить в следующем году**
11. **Какие документы догрузить**

Цифры из файла, нормативы и интерпретация из prompt. Also update `title`, `description`, `input_hint`, `launcher_title`, `launcher_description`. Do NOT touch ordering/visibility fields.

## PATCH B: Markdown rendering

**Install**: `react-markdown`

**File: `src/components/ai-chat/ChatMessage.tsx**`

- For **assistant only**: replace plain text with `<ReactMarkdown>` with custom component overrides (h1-h3 sizes/weights/borders, ul/ol indentation, strong, p spacing, table borders/padding)
- User messages: keep `whitespace-pre-wrap`

## PATCH C: Chat persistence

**File: `src/hooks/useAiChat.ts**`

- Import `useAuth` from `@/contexts/AuthContext` inside the hook (no manual userId prop)
- `**loadConversation(conversationId)**` — query `ai_chat_messages` where `conversation_id = id AND user_id = user.id`, ordered by `created_at asc`, map to `ChatMessage[]`
- `**resumeConversation(conversationId)**` — loads messages, sets `conversationId`, extracts `prompt_id`, `scenario_type`, `launcher_title_snapshot` from last assistant metadata. Does NOT auto-open upload flow. Returns scenario context
- **On mount**: check `localStorage` for `gorbova_ai_last_conversation_${user.id}`. If found and loads successfully → restore. Otherwise → INITIAL_MESSAGE
- **After `sendMessage**` returns `conversation_id` → save to namespaced localStorage
- `**clearChat**` removes localStorage key
- Export: `conversationId`, `resumeConversation`, `activeScenarioContext`

RLS already enforces `user_id = auth.uid()` on `ai_chat_messages` — the client filter is a defense-in-depth guard.

## PATCH D: "История анализа" tab

**File: `src/pages/AI.tsx**`

- Add `"analysis-history"` to `SubTab` type (between chat and tutorials)
- Add to `AI_SUB_TABS` with `Clock` icon, label "История анализа"
- Render `<AnalysisHistoryView>` when active
- `onResume` → `aiChat.resumeConversation(id)` then set `activeSubTab = "chat"` atomically; also restore `activeScenario` from context

**New: `src/hooks/useAnalysisHistory.ts**`

- Uses `useAuth()` internally
- Query `ai_chat_messages` where `role = 'assistant'` AND `user_id = user.id` AND metadata->>scenario_type is not null
- Group by `conversation_id`
- Per session: `conversation_id`, `launcher_title_snapshot` (fallback: "Анализ баланса" if prompt matches balance_analysis, else "Анализ документа"), `file_names`, `created_at` (first), `updated_at` (last), preview (first 150 chars of last assistant)
- Sort by `updated_at` desc

**New: `src/components/ai-chat/AnalysisHistoryView.tsx**`

- Cards: title/fallback, file badges, created_at, updated_at (if differs from created_at), preview
- "Открыть" and "Продолжить анализ" buttons — both use same `conversation_id`, differ only in UX intent
- Empty/loading states

## PATCH E: Resume wiring (in C + D)

Resume continues same `conversation_id`. Restores scenario context. No new session. Switch to chat tab without intermediate blank.

---

## Security

- RLS on `ai_chat_messages`: `user_id = auth.uid()` (already exists)
- Client queries also filter `user_id` as defense-in-depth
- localStorage namespaced: `gorbova_ai_last_conversation_${userId}`
- No userId if not authenticated → no localStorage write

## Files


| File                                             | Change                                             |
| ------------------------------------------------ | -------------------------------------------------- |
| DB (insert tool)                                 | PATCH A: balance_analysis prompt                   |
| `package.json`                                   | PATCH B: react-markdown                            |
| `src/components/ai-chat/ChatMessage.tsx`         | PATCH B: Markdown rendering                        |
| `src/hooks/useAiChat.ts`                         | PATCH C+E: Persistence, resume, useAuth internally |
| `src/hooks/useAnalysisHistory.ts`                | PATCH D: New                                       |
| `src/components/ai-chat/AnalysisHistoryView.tsx` | PATCH D: New                                       |
| `src/pages/AI.tsx`                               | PATCH D: Tab + wiring                              |


## DoD

1. Reload → last opened session restores via namespaced localStorage key
2. Missing/invalid conversation → welcome screen
3. Markdown renders: headers, lists, bold, tables
4. "История анализа" cards: title/fallback, files, created_at, updated_at, preview
5. Resume → same `conversation_id`, scenario context restored
6. User cannot access another user's sessions (RLS + client filter)
7. `balance_analysis` output: rating, summary, extracted/calculated/interpreted blocks, Norm/Fact/Status table, recommendations