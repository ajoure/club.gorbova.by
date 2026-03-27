# да, согласен, с учетом правок:

&nbsp;

1. templates/executors не оставлять “как есть” без явной проверки визуального совпадения с новым inset-стилем остальных sub-tab. Если после патча они начинают выглядеть как другой уровень вложенности, это считается регрессией. В DoD нужно прямо проверить визуальную согласованность всех sub-tab-контейнеров между собой.
2. Для analysis-history отдельно проверить, что inset-обёртка не ломает высоту списка, внутренний scroll и действия loadConversation / resumeConversation. Это не такой рискованный блок, как chat, но там тоже есть интерактивный сценарий.
3. Для entities/persons после добавления inset-обёртки проверить, что не появилось двойного внешнего padding вокруг таблицы/списка и что sheet/drawer actions по-прежнему визуально читаются внутри новой зоны.
4. В шаге 1 зафиксируй fallback точнее: если shadow-inner + ring шумит, убрать именно ring, а не пересобирать active-state заново. Патч должен оставаться минимальным.
5. В DoD добавь отдельный пункт: переключение между всеми sub-tabs внутри каждой секции (ai, documents, requisites) не вызывает скачка вертикальных отступов и “пересборки” страницы по высоте сильнее, чем было до патча.
6. Добавь STOP-guard: если для templates/executors или analysis-history inset-обёртка создаёт визуальный конфликт с уже существующими внутренними контейнерами, не форсить унификацию в этом же патче, а оставить эти под-вкладки без новой внешней inset-рамки и вынести в следующий visual-fix PATCH.

&nbsp;

&nbsp;

План: Визуальная «вдавленность» на всех уровнях вкладок — AiPageContent.tsx

## Scope

Только `src/components/ai-chat/AiPageContent.tsx`. Два шага внутри одного патча.

## Шаг 1: Активный стиль главных табов

**Строка 515-519** — `sectionTabClass`: заменить активный стиль.

Текущий: `bg-background text-foreground shadow-sm`

Новый: `bg-background text-foreground shadow-inner ring-1 ring-inset ring-border/15`

Мягкий inset без перегруженности — один `ring` с низкой opacity (`/15`), без двойных эффектов. Если при runtime ring + shadow-inner окажется шумным, убрать ring и оставить только `shadow-inner`.

## Шаг 2: Inset-контейнер для безопасных sub-tabs

Обернуть контент **generate, history, entities, persons** в inset-контейнер:

```tsx
<div className="mx-1 px-3 py-2 rounded-xl bg-muted/20 border border-border/10 shadow-inner flex-1 min-h-0 overflow-auto">
  ...
</div>
```

Конкретно:

- **generate** (строка 821): обернуть `<AiDocumentsGenerateView />` 
- **history** (строка 822): обернуть `<AiDocumentsHistoryView />`
- **entities** (строки 839-865): обернуть весь блок
- **persons** (строки 868-892): обернуть весь блок

**templates/executors** (строки 823-836): уже имеют inset-обёртку — оставить как есть. Не снимать локальную обёртку, чтобы не рисковать spacing/отступами таблиц.

**chat** (строки 590+): **НЕ трогать**. STOP-guard: у chat своя scroll-area, drag-drop overlay, input-footer и sticky/height-логика. Подключать inset для chat только после отдельной runtime-проверки.

**tutorials, prompts, analysis-history**: тоже обернуть в inset-контейнер аналогично generate/history.

## Что НЕ делаем

- Не трогаем chat
- Не снимаем локальные обёртки templates/executors
- Не создаём двойных shadow-inner
- Не меняем другие файлы

## DoD

1. Активный главный таб визуально «вдавлен» мягко, в том же стиле что sub-tabs
2. Все sub-tab контенты кроме chat обёрнуты в inset-зону
3. Нет двойных inset-рамок (shadow-inner внутри shadow-inner)
4. Chat сохранил корректную высоту, scroll, input composer и drag-drop
5. Templates/executors не ухудшили spacing после патча
6. Визуальная иерархия улучшена, но не стала тяжелее/шумнее
7. Нет регрессий на desktop 1189px