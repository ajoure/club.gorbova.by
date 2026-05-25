да, согласен, с учетом правок:

1. Не дублировать access-конфиг между backend и frontend “синхронными TS-копиями”. Это снова создаст второй SoT. В этом PATCH источник истины должен остаться один:
  &nbsp;
  &nbsp;
  - `_shared/ai-access.ts` на backend;
  - UI получает уже **готовый вычисленный результат** через `ai-access-status`.  
  Frontend не должен сам решать, какой продукт что открывает.
2. `ai-access-status` должен возвращать не только `access`, но и сразу:
  - `tier/access_tier`,
  - `allowed_modes`,
  - `allowed_scenarios`,
  - `cta_target`,
  - `quota_by_mode` / `remaining_today` / `remaining_month`,
  - понятные `denial_reasons`.  
  Иначе UI снова начнёт домысливать бизнес-логику у себя.
3. В плане явно зафиксировать, что `ai-access-status` — **read-only edge projection** поверх backend resolver, без собственной бизнес-логики, без прямых “если product_id = …” внутри самого endpoint.
4. Удаление `get_ai_access()` делать только если подтверждено, что:
  - нигде больше не осталось вызовов RPC;
  - нет зависимостей в UI/SQL/других edge functions;
  - есть явный cleanup-пруф.  
  Иначе сначала перевести UI на `ai-access-status`, потом удалить RPC отдельным шагом в этом же PATCH.
5. В frontend gating на `/ai` не ограничиваться только disabled-state. Нужен явный guard и для initial state:
  - если `chat` запрещён, `/ai` не должен открываться в chat по умолчанию;
  - для `Закрой год` default entrypoint должен быть `balance_analysis`;
  - если активная вкладка/сценарий недоступны, UI должен автоматически переключаться на доступный fallback, а не показывать сломанный экран.
6. Для `ChatScenarioLauncher` не просто скрывать карточки. Разделить сценарии на:
  - активные,
  - недоступные, но видимые с CTA,
  - полностью скрытые.  
  И зафиксировать, какой вариант нужен именно для `107NK` и прочих prompt-сценариев у пользователя `Закрой год`. По твоему описанию сейчас нужен именно **visible disabled + CTA**, а не hide.
7. Бейдж лимита в UI должен быть привязан к **текущему выбранному режиму**, но:
  - для пользователя без chat-доступа не показывать misleading “остаток чата”;
  - для `Закрой год` при активном `balance_analysis` показывать остаток именно по этому сценарию;
  - если AI полностью недоступен, лимит не показывать вообще.
8. В observability не считать `estimated tokens`, если фактически метрика сейчас строится по `charCount × rate`. Назвать это честно:
  - `estimated cost`,
  - `context_chars`,
  - `messages`.  
  Не подменять оценку токенов приблизительной арифметикой без явного указания, что это estimate.
9. Источник для counters в admin нужно зафиксировать точнее:
  - `off_topic_blocked` — из `ai_chat_messages.metadata.routing_reason` или отдельного metadata-флага;
  - `access_denied_for_mode` и `quota_denied` — из `audit_logs`.  
  Не оставлять это расплывчатым, иначе метрики будут собраны из разных критериев.
10. Legacy-safe правило нужно усилить:
  - старые строки без `metadata.ai_mode` и `model_used` не только показывать как `legacy_unknown`, но и **не включать в breakdown-проценты**, если это искажает текущую статистику;
  - отдельно показать их count как `legacy`.  
  Иначе новые графики будут шумными.
11. В verify-кейсах для сценариев с `200/402` нужно явно разделить:
  - `200` — полноценный успешный ответ;
  - `402` — дошли до gateway, но упёрлись в биллинг/лимит провайдера.  
  Для proof маршрутизации `model_used` достаточно `metadata`/edge log даже при `402`, но это надо так и записать в плане, чтобы потом не было спора, что именно считается acceptable proof.
12. Для кейса off-topic добавить обязательный proof, что:
  - не было вызова **основной** модели маршрута;
  - classifier fallback-open не сломал запрос при ошибке классификатора.  
  Нужен хотя бы один негативный и один fallback-safe сценарий.
13. В “Что НЕ меняется” добавить:
  - существующий формат истории чата и UI rendering сообщений;
  - chat scenarios catalog / launcher structure не пересобираются, меняется только gating.
14. В порядке выполнения добавить явный шаг перед Execute:
  - `grep`/code search по `get_ai_access`;
  - перевод всех вызовов на `ai-access-status`;
  - только потом DROP FUNCTION.  
  Это обязательный STOP-guard.
15. DoD дополнить:
  - `/ai` не открывается в недоступный режим по умолчанию;
  - прямой переход/restore state в недоступный режим корректно сбрасывается на разрешённый fallback;
  - после удаления RPC в проекте не осталось runtime-обращений к `get_ai_access()`.

&nbsp;

В остальном направление правильное: вынести UI на `ai-access-status`, не плодить тарифную подсистему, завершить gating и доказать всё через финальный verify.

&nbsp;

План: PATCH v2.1 — frontend access UI, admin observability и финальный verify с доказательствами

## Scope

Закрываем хвосты PATCH v2: frontend для /ai (gating по продуктам), admin-observability, и финальный verify с пруфами по 6 пунктам ревью. Дополнительно — архитектурное решение по `get_ai_access()`.

## 0. Архитектурное решение по `get_ai_access()` RPC

Зафиксировать: RPC — это **тонкая read-only projection** поверх единственного backend SOT (`_shared/ai-access.ts`).

- Перевести RPC в режим «только агрегирует данные», без правил. Все решения (mapping product→modes, лимиты, классификация) остаются только в `_shared/ai-access.ts`.
- RPC возвращает сырые факты для UI: набор активных entitlements (по product_id), счётчики использования за день/месяц по mode из `ai_chat_messages.metadata`.
- Маппинг product_id → разрешённые modes и числовые лимиты делает frontend через тот же shared конфиг (вынести в `src/lib/ai-access-config.ts`, импортируется как edge-функцией, так и UI через дублирующую TS-копию констант — единственный источник правок, оба файла синхронны).
- Альтернатива (выбираем эту): полностью убрать RPC `get_ai_access()`, заменить на тонкий read-only edge `ai-access-status` который зовёт shared `resolveAiAccess()` и возвращает JSON для UI. Это устраняет двойной контур.

**Решение:** удалить `get_ai_access()`, ввести edge `ai-access-status` (GET, JWT). UI зовёт его через `useAiAccess`.

## 1. Frontend: gating на /ai

Файлы: `src/hooks/useAiAccess.ts` (новый), `src/pages/AI.tsx`, `src/components/ai-chat/AiPageContent.tsx`, `src/components/ai-chat/ChatScenarioLauncher.tsx`, `src/components/ai-chat/ChatComposer.tsx` (или эквивалент).

Поведение по тирам:

- **Закрой год** (только `balance_analysis`):
  - Свободный чат — input disabled, плашка «Свободный чат недоступен на вашем тарифе» + CTA «Открыть Business / Club».
  - В лаунчере сценариев показывать только `balance_analysis` активным; `107NK` и прочие prompt-сценарии — disabled с тултипом и CTA.
- **Club / Business / AI-группа**: все режимы активны.
- В шапке/футере чата: бейдж «Осталось сегодня: X / Y» по текущему доступному режиму (chat если активен, иначе prompt).
- При 403 от edge — toast «Недоступно на вашем тарифе» + CTA.
- При 429 — toast «Лимит исчерпан, попробуйте завтра» + ссылка на тарифы.

## 2. Admin observability

Файлы: `src/pages/admin/AdminAI.tsx` (или соответствующий tab), новый компонент `AiUsageBreakdown.tsx`.

Метрики (за 7/30 дней, фильтр по mode):

- Top-20 users by messages + estimated tokens.
- Breakdown: `mode` × `model_used` (count, % truncated).
- Counters: `off_topic_blocked`, `access_denied_for_mode`, `quota_denied`, `rate_limited`.
- Источник: `ai_chat_messages.metadata` + `audit_logs` по action префиксу `ai_chat_*`.

## 3. Legacy-safe для старых строк

Все агрегаты используют `COALESCE(metadata->>'model_used', 'legacy_unknown')` и `COALESCE(metadata->>'ai_mode', 'legacy_unknown')`. Старые сообщения без metadata показываются как `legacy_unknown` и **не** учитываются в quota count (quota считается только по строкам со свежими метаданными от текущей версии edge).

## 4. Final verify с пруфами

Каждый сценарий = один edge-call + чтение `ai_chat_messages` / `audit_logs`. Все пруфы прикладываются в отчёте.


| #   | Сценарий                                | Proof                                                                           |
| --- | --------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Закрой год user → POST chat             | 403, `audit_logs.action=ai_chat_denied_access_for_mode`                         |
| 2   | Закрой год user → POST balance_analysis | 200/402, `metadata.model_used=google/gemini-2.5-pro`, `metadata.ai_mode=prompt` |
| 3   | Club user → POST chat                   | 200/402, `metadata.model_used=google/gemini-2.5-flash`, `metadata.ai_mode=chat` |
| 4   | Club user → POST prompt (107NK)         | 200/402, `metadata.model_used=google/gemini-2.5-pro`                            |
| 5   | Off-topic в chat                        | `metadata.off_topic_blocked=true`, нет вызова pro-модели                        |
| 6   | 51-е сообщение chat за сутки            | 429, `audit_logs.action=ai_chat_quota_denied`, quota не списана                 |
| 7   | Диалог >20 сообщений / >80k chars       | `metadata.truncated=true`, `dropped_messages_count>0`, system prompt сохранён   |
| 8   | User-message >50k chars                 | 400 с текстом «Сократите запрос», ничего не записано в `ai_chat_messages`       |
| 9   | UI Закрой год                           | Screenshot: chat disabled, balance_analysis активен, 107NK disabled             |
| 10  | UI Club                                 | Screenshot: всё активно, бейдж лимита виден                                     |


## 5. Order

Diagnose (подтвердить product_id для Закрой год / Club / Business в проде) → Dry-run (edge-curl по сценариям 1–8 на тестовых аккаунтах) → Execute (удалить RPC, добавить edge `ai-access-status`, frontend gating, admin breakdown) → Verify (10 сценариев с приложением пруфов).

## DoD

- RPC `get_ai_access()` удалён; единственный access SOT — `_shared/ai-access.ts`, UI читает через edge `ai-access-status`.
- /ai корректно gating'ует chat/balance_analysis/107NK по тирам с CTA.
- Admin показывает breakdown по mode/model_used + denied/truncated counters.
- Все 10 пруфов приложены в отчёте (логи edge / строки `ai_chat_messages.metadata` / скриншоты UI).
- Legacy-сообщения без metadata не ломают UI/quota/analytics.

## Подтверждаю, что не менялись

- `fields_registry`; `document_token_registry`; DOCX-шаблоны; RLS; RPC (кроме удаления `get_ai_access`); cron/jobs; `client.ts`; `types.ts`; схема БД (миграция — только DROP FUNCTION); канонические access_rules; products/entitlements/tariffs; `balance_analysis`/`107NK` системные промпты и модели; существующий `ai_rate_limits` для TG-бота; схема `ai_chat_messages`.