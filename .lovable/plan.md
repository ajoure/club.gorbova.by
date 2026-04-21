

# План: PATCH KINESCOPE-TOKEN — восстановление API-токена Kinescope для lifecycle-вызовов

## 1. Diagnose (зафиксировано)

`audit_logs` для эфира `ee1ec5ca-2ecf-417e-9f0c-83201abcb4a5` (Тест 21.04.26):
- `complete_webinar` 16:16:54Z → `room_state=completed` ✅
- `provider.attempted=true`, `provider.ok=false`, `provider.error="400 {\"success\":false,\"error\":\"API токен не найден\"}"` ❌
- Та же ошибка на `start_live` 06:29:06Z.

Вывод: **lifecycle работает**, падает только провайдерский вызов в `kinescope-api`. На UI это даёт warning toast — пользователь воспринимает его как «ошибку завершения», хотя room_state переключился штатно.

`root_cause = kinescope_api_token_missing_or_invalid` (не lifecycle).

## 2. Бизнес-правило

Завершение вебинара типа `live_stream` обязано:
1. Перевести `room_state` в `completed` (выполняется).
2. Дернуть Kinescope `complete_live_event`, чтобы провайдер закрыл стрим (НЕ выполняется).

Без шага 2 у Kinescope стрим может остаться открытым → проблемы с записью/replay.

## 3. Изменения

### A. Проверить и восстановить секрет `KINESCOPE_API_TOKEN`
- Прочитать через `secrets--fetch_secrets`, какой именно секрет ожидает `kinescope-api/index.ts`.
- Если секрет отсутствует / пустой / устарел — запросить у пользователя через `add_secret`.
- Не подставлять заглушки.

### B. `supabase/functions/kinescope-api/index.ts`
- Прочитать текущую обработку отсутствия токена.
- Убедиться, что функция возвращает структурированный ответ (не голый 400 с русским текстом), чтобы в audit_logs писалось пригодное для диагностики поле, а в UI выводилось понятное сообщение.

### C. `supabase/functions/live-event-lifecycle/index.ts`
- Improvement (small): при `provider.error` содержащем `"API токен не найден"` маркировать `provider.reason='provider_token_missing'`, чтобы admin UI показывал понятный текст «Не настроен токен Kinescope — обратитесь к админу», а не raw JSON.

### D. UI — `src/components/live/RoomLifecycleActions.tsx`
- В warning toast подменять `provider.error` на пользовательскую формулировку, если `provider.reason='provider_token_missing'`.
- Не показывать сырой JSON английским/русским смешанным текстом.

## 4. Файлы

| Файл | Изменение |
|---|---|
| секрет `KINESCOPE_API_TOKEN` | восстановить через add_secret (если отсутствует/невалиден) |
| `supabase/functions/kinescope-api/index.ts` | проверить обработку отсутствия токена, структурированный ответ |
| `supabase/functions/live-event-lifecycle/index.ts` | mapping `provider.reason='provider_token_missing'` |
| `src/components/live/RoomLifecycleActions.tsx` | человеческий текст warning toast |

## 5. Не трогаем

- схему `live_events`, `audit_logs`;
- room lifecycle state machine (она работает);
- replay flow, kinescope-webhook;
- общую логику provider degraded-mode.

## 6. Verify

1. Реальный вызов `kinescope-api` с действующим токеном — `200 OK`.
2. Завершение тестового live_stream-эфира → `audit_logs.meta.provider.ok=true`, без `provider_call_failed`.
3. UI больше не показывает warning toast; только success toast «Завершить вебинар — выполнено».
4. Проверка идемпотентности: повторный complete на уже completed → `skipped: true`.

## 7. STOP-guards

- Если пользователь не может предоставить валидный Kinescope токен — НЕ деплоить C/D, оставить только улучшение текста ошибки, чтобы пользователь не воспринимал degraded-mode как фатальную ошибку.
- Не трогать саму lifecycle-функцию в части перехода состояний.

## 8. DoD

1. `KINESCOPE_API_TOKEN` валиден и читается функцией `kinescope-api`.
2. Тестовое завершение live_stream-эфира проходит с `provider.ok=true`.
3. Сырой JSON провайдера больше не показывается пользователю.
4. Lifecycle-state-machine не изменена.

