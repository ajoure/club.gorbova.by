# да, согласен, с учетом правок:

&nbsp;

1. **remark-gfm — обязательный фикс**
  &nbsp;
  - Это действительно нужно, иначе markdown-таблицы останутся pipe-текстом.
  - После подключения проверить именно на реальном ответе с таблицей.
  &nbsp;
2. **Кнопку “Копировать” делать только для assistant-сообщений**
  &nbsp;
  - Это правильно.
  - Для user-сообщений не нужна.
  &nbsp;
3. **Кнопку “Копировать” лучше ставить под bubble, но внутри assistant-блока**
  &nbsp;
  - Чтобы она визуально относилась к ответу.
  - И не ломала выравнивание user/assistant сообщений.
  &nbsp;
4. **Для таблиц нужен overflow-safe контейнер**
  &nbsp;
  - Это уже учтено, оставить обязательно.
  - Широкие таблицы должны скроллиться внутри bubble, а не ломать layout чата.
  &nbsp;
5. **Добавить tr в markdown components — правильно**
  &nbsp;
  - Для zebra-style строк это нужно.
  - Хорошо, что это включено в план.
  &nbsp;
6. **Отдельный useEffect([activeSubTab]) для возврата на “Чат” — правильный путь**
  &nbsp;
  - Это чинит конкретный баг с тем, что messages.length не меняется и старый effect не срабатывает.
  - Оставить именно отдельным эффектом.
  &nbsp;
7. **Новый чат должен сбрасывать не только UI, но и scroll refs**
  &nbsp;
  - Это уже указано:
    &nbsp;
    - prevMessageCountRef.current = 0
    - isInitialLoadRef.current = true
    &nbsp;
  - Это важно, чтобы новая сессия открывалась корректно.
  &nbsp;
8. **Новый чат должен очищать и file-related state**
  &nbsp;
  - Тоже уже учтено:
    &nbsp;
    - setChatFiles([])
    - setShowUploader(false)
    &nbsp;
  - Это обязательный reset.
  &nbsp;
9. **После Новый чат не должно быть автоподнятия старой сессии**
  &nbsp;
  - Это критичный DoD.
  - Раз clearChat уже чистит localStorage, этого достаточно, но proof обязателен.
  &nbsp;
10. **DoD стоит дополнить одним proof-пунктом**

&nbsp;

&nbsp;

&nbsp;

- После возврата с вкладки “История анализа” на “Чат” действительно виден низ переписки, а не середина/верх.

&nbsp;

&nbsp;

План выглядит правильным.

&nbsp;

План: remark-gfm, кнопка «Копировать», скролл при возврате, кнопка «Новый чат»

## Файлы для изменения

### 1. `src/components/ai-chat/ChatMessage.tsx`

**remark-gfm:**

- Добавить `import remarkGfm from "remark-gfm"`
- Передать `remarkPlugins={[remarkGfm]}` в `<ReactMarkdown>`

**Кнопка «Копировать» (только для assistant):**

- Добавить `useState` для `copied`, иконки `Copy`/`Check`
- Под bubble ассистента — кнопка `variant="ghost"` `size="sm"` с `navigator.clipboard.writeText(message.content)`
- После копирования иконка `Check` на 2 секунды, затем обратно `Copy`

**Улучшение стилей таблиц:**

- Обёртка таблицы: `rounded-lg overflow-hidden`
- Чередование строк: `even:bg-muted/30` на `tr`
- Добавить `tr` в components для чередования

### 2. `package.json`

- Добавить зависимость `remark-gfm`

### 3. `src/pages/AI.tsx`

**Скролл при возврате на вкладку «Чат»:**

- Новый `useEffect` с зависимостью `[activeSubTab]`:

```tsx
useEffect(() => {
  if (activeSubTab !== "chat") return;
  const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (!viewport) return;
  requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
}, [activeSubTab]);
```

**Кнопка «Новый чат»:**

- Добавить в верхнюю часть GlassCard чата (между началом карточки и ScrollArea) — тонкий header:

```tsx
<div className="flex items-center justify-between px-4 py-2 border-b border-border/30">
  <span className="text-xs text-muted-foreground">Чат</span>
  <Button variant="ghost" size="sm" onClick={handleNewChat}>
    <Plus className="h-3.5 w-3.5 mr-1" /> Новый чат
  </Button>
</div>
```

- `handleNewChat`: вызывает `aiChat.clearChat()`, сбрасывает `prevMessageCountRef.current = 0`, `isInitialLoadRef.current = true`, `setActiveScenario(null)`, `setChatFiles([])`, `setShowUploader(false)`

### 4. `src/hooks/useAiChat.ts`

- `clearChat` уже сбрасывает messages, conversationId, activeScenarioContext и localStorage — этого достаточно. Изменений не нужно.

## Что не затрагивается

Edge function, FileDropZone, fileExtractor, база данных.

## DoD

1. GFM-таблицы (`| ... |`) рендерятся как HTML-таблицы с заголовками и границами
2. Кнопка «Копировать» под ответами ассистента работает, иконка меняется на Check на 2 сек
3. При возврате на вкладку «Чат» скролл всегда внизу
4. Кнопка «Новый чат» очищает историю, сбрасывает session state
5. После «Новый чат» + reload — старая сессия не восстанавливается
6. Широкие таблицы скроллятся горизонтально внутри bubble