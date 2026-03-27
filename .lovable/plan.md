# да, согласен, с учетом правок:

&nbsp;

1. В патче 2 типизацию сделать строгой:
  const blockedByCode: Record<string, string> = { ... }
  const blockedByType: Record<string, string> = { ... }
2. В AiPageContent.tsx зафиксировать guard: promptId из activeScenarioContext подмешивается только в обычный chat-flow (handleSendMessage). В handleScenarioSubmit ничего не менять — там источник истины по-прежнему [activeScenario.id](http://activeScenario.id).
3. В DoD добавить proof не только по network body, но и по фактическому выбору режима:
  &nbsp;
  - со сценарием через скрепку уходит prompt_id и mode: "prompt";
  - без сценария prompt_id отсутствует и уходит mode: "chat".
  &nbsp;
4. В edge function сделать fallback безопасным к undefined:
  promptData?.code ? blockedByCode[promptData.code] : undefined
  promptData?.type ? blockedByType[promptData.type] : undefined
  чтобы не было неявной индексации по undefined.
5. В DoD добавить отдельный кейс:
  после resumeConversation + отправки файла через скрепку используется восстановленный prompt_id, а после Новый чат тот же файл уходит уже без prompt_id.
6. Для blocked message отдельно проверить сценарий с file_analysis, у которого code не balance_analysis: должно браться сообщение именно из blockedByType, а не бухгалтерский текст из blockedByCode.

&nbsp;

&nbsp;

План: Исправление бага — AI всегда использует промпт «баланс»

## Два файла, два патча

### Патч 1: `src/components/ai-chat/AiPageContent.tsx` (строка 372)

Передать `promptId` из `activeScenarioContext` в `sendMessage`:

```ts
// строка 372: было
await aiChat.sendMessage(text, fileOpts);

// станет
const promptId = aiChat.activeScenarioContext?.prompt_id;
await aiChat.sendMessage(text, { ...fileOpts, promptId });
```

- `activeScenarioContext` заполняется при выборе сценария и при `resumeConversation`, сбрасывается в `clearChat()` → после «Новый чат» `promptId` будет `undefined` → `mode: 'chat'`.
- `PromptRunFlow` не затрагивается: там свой `handleScenarioSubmit` с явным `promptId: activeScenario.id` — источник истины остаётся отдельный.

### Патч 2: `supabase/functions/gorbova-ai-chat/index.ts` (строка 221)

Заменить захардкоженный `blockedContent` на fallback-цепочку:

```ts
const blockedByCode: Record<string, string> = {
  balance_analysis: 'Файл не содержит распознаваемых данных для анализа. Проверьте, что файл заполнен и содержит бухгалтерские показатели, или загрузите файл в другом формате (Excel, PDF, фото).',
};

const blockedByType: Record<string, string> = {
  file_analysis: 'Файл не содержит распознаваемых данных для анализа. Проверьте, что файл заполнен, или загрузите файл в другом формате (Excel, PDF, фото).',
  document_review: 'Файл не содержит распознаваемого текста для анализа. Загрузите документ в формате PDF, Word или фото.',
};

const defaultBlockedMsg = 'Файл не содержит распознаваемых данных для анализа. Проверьте, что файл заполнен, или загрузите файл в другом формате.';

const blockedContent =
  blockedByCode[promptData?.code] ??
  blockedByType[promptData?.type] ??
  defaultBlockedMsg;
```

## Что НЕ меняем

- `useAiChat.ts`, `PromptRunFlow.tsx`, `ChatScenarioLauncher.tsx`
- БД, RLS, другие edge functions

## DoD

1. Скрепка + активный сценарий → в network body уходит `prompt_id`, edge function получает `mode: "prompt"`
2. Follow-up в сценарной сессии → тот же `prompt_id`
3. После `clearChat()` / «Новый чат» → `prompt_id` отсутствует, `mode: "chat"`
4. После `resumeConversation` → восстановленный `prompt_id` используется
5. `PromptRunFlow` не зависит от `activeScenarioContext`, источник истины — `activeScenario.id`
6. Blocked message fallback: `code` → `type` → default (три уровня)
7. `document_review` только в `blockedByType`, не в `blockedByCode`
8. Нет регрессий в существующем scenario flow