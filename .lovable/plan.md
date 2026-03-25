# да, согласен, с учетом правок:

&nbsp;

1. **Bug 1 фикс правильный**
  &nbsp;
  - scenario_type действительно не подходит для определения balance_analysis.
  - Для fallback title нужно опираться не на тип (file_analysis), а на:
    &nbsp;
    - launcher_title_snapshot,
    - prompt_title_snapshot,
    - либо отдельный prompt_id, если он уже есть в metadata.
    &nbsp;
  - Самый практичный Phase 1 вариант:
    &nbsp;
    - сначала launcher_title_snapshot,
    - затем prompt_title_snapshot,
    - если в них есть “баланс” → Анализ баланса,
    - иначе Анализ документа.
    &nbsp;
  &nbsp;
2. **Bug 2 фикс обязателен**
  &nbsp;
  - Да, сейчас это типичная race condition:
    &nbsp;
    - setActiveScenarioContext(...)
    - потом мгновенный return activeScenarioContext
    &nbsp;
  - Правильно изменить контракт:
    &nbsp;
    - loadConversation() должен возвращать свежий scenarioContext,
    - resumeConversation() должен возвращать именно его, а не читать state.
    &nbsp;
  &nbsp;
3. **Нужен новый контракт возврата**
  &nbsp;
  - Лучше не просто { loaded: boolean, scenarioContext },
  - а что-то вроде:
    &nbsp;
    - messages
    - conversationId
    - scenarioContext
    - loaded
    &nbsp;
  - Но если хотите минимальный фикс, достаточно:
    &nbsp;
    - { loaded: boolean; scenarioContext: ScenarioContext | null }.
    &nbsp;
  &nbsp;
4. **Bug 3: различие onOpen и onResume как UX-уровень — допустимо**
  &nbsp;
  - Если на первом этапе оба открывают одну и ту же сессию, это нормально.
  - Главное различие можно оставить таким:
    &nbsp;
    - Открыть → просто загрузить историю;
    - Продолжить анализ → загрузить историю и зафиксировать её как текущую/рабочую в localStorage.
    &nbsp;
  - Это уже реальное поведенческое отличие.
  &nbsp;
5. **Нужно явно зафиксировать это различие в коде и DoD**
  &nbsp;
  - loadConversation() — без записи в localStorage
  - resumeConversation() — с записью в localStorage
  - Тогда логика будет прозрачной и проверяемой.
  &nbsp;
6. **Для fallback title лучше не завязываться только на одно поле**
  &nbsp;
  - Рекомендую такой порядок:
    &nbsp;
    1. launcher_title_snapshot
    2. prompt_title_snapshot
    3. fallback по known scenario
    4. Анализ документа
    &nbsp;
  - Это устойчивее для старых записей и неполной metadata.
  &nbsp;
7. **Нужен proof по Bug 2**
  &nbsp;
  - После фикса resumeConversation должен возвращать актуальный context без null/stale.
  - Это обязательно проверить на реальной сессии анализа.
  &nbsp;
8. **Нужен proof по Bug 3**
  &nbsp;
  - Проверить:
    &nbsp;
    - Открыть не меняет last-opened session в localStorage;
    - Продолжить анализ меняет;
    - обе операции используют тот же conversation_id.
    &nbsp;
  &nbsp;
9. **После этих фиксов история/resume будет логически завершенной**
  &nbsp;
  - Это хорошие точечные правки.
  - Они не ломают текущий P2, а именно доводят его до рабочего состояния.
  &nbsp;

&nbsp;

&nbsp;

Fixes: fallback title, resumeConversation race, onOpen/onResume UX

## Three bugs to fix

### 1. Fallback title uses wrong field for "Анализ баланса" check

**File**: `src/hooks/useAnalysisHistory.ts` (line 86)

**Problem**: `entry.scenarioType` holds `metadata.scenario_type` which is a type like `file_analysis`, not a prompt code like `balance_analysis`. The condition `scenarioType === "balance_analysis"` never matches.

**Fix**: Check `launcher_title_snapshot` for keywords or store `prompt_id` from metadata. Since metadata already contains `prompt_id`, store it alongside `scenarioType`. Use it for the fallback:

- If `launcher_title_snapshot` contains "баланс" (case-insensitive) OR prompt metadata indicates balance → "Анализ баланса"
- Otherwise → "Анализ документа"

Alternatively, also extract `metadata.prompt_title_snapshot` which may contain the prompt code/title. The cleanest approach: store the prompt_id from assistant metadata, and if the `launcher_title_snapshot` is missing, check if prompt_title contains "баланс".

### 2. `resumeConversation` returns stale `activeScenarioContext`

**File**: `src/hooks/useAiChat.ts` (lines 127-137)

**Problem**: `resumeConversation` calls `loadConversation` which calls `setActiveScenarioContext(...)` — a React setState. Then immediately returns `activeScenarioContext` which still holds the **previous** value (setState is async). The caller in AI.tsx gets stale/null context.

**Fix**: Have `loadConversation` extract and return the scenario context directly (not just via setState). Then `resumeConversation` returns this fresh value instead of reading state.

```text
loadConversation(convId) → returns { loaded: boolean, scenarioContext: ScenarioContext | null }
resumeConversation(convId) → uses returned context, also sets state, returns fresh context
```

### 3. `onOpen` vs `onResume` have no UX difference

**File**: `src/pages/AI.tsx` (lines 480-495)

**Problem**: Both load the conversation and switch to chat tab. No behavioral difference.

**Fix**: Keep both loading the same `conversation_id`, but after `onOpen` the chat input could be in a "viewing history" state (optional — for Phase 1, both can remain functionally identical since the user can always type). The real difference is that `onResume` saves to localStorage (already does via `resumeConversation`), while `onOpen` does not persist as "last opened". This is already the case — `loadConversation` doesn't write to localStorage, `resumeConversation` does. Document this as the intentional distinction.

---

## Files to change


| File                              | Change                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useAnalysisHistory.ts` | Fix fallback title: check `launcher_title_snapshot` content instead of `scenarioType === "balance_analysis"`                                                                                            |
| `src/hooks/useAiChat.ts`          | Fix `loadConversation` to return extracted context; fix `resumeConversation` to use returned value instead of stale state                                                                               |
| `src/pages/AI.tsx`                | Minor: `onOpen` uses `loadConversation` (no localStorage persist), `onResume` uses `resumeConversation` (persists + returns fresh context) — already correct, just ensure ctx is used from return value |
