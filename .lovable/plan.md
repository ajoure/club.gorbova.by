## Что известно

- Эфир `klub-itogi-mesyatsa-0726` в БД: опубликован, `room_state=opened`, `platform_status=scheduled`, `event_type=live_stream`, `scheduled_at=2026-07-03 11:00 UTC` (14:00 Минск), `kinescope_live_event_id` есть, `play_link=https://kinescope.io/0cBDVFJW2jqCt6A3orEfmC`.
- В Telegram участники и админ пишут «просто грузит страничка», «картинка и чат не открываются». Проблема **у всех**, включая админа, с мобильных Telegram-браузеров iOS.
- Публичная HTML-обёртка (`/live/...`) отдаётся 200 OK, значит SPA грузится, но остаётся в `state === "loading"` (бесконечный `<Loader2 />`).
- `live-resolve` без токена корректно отвечает `401 { status: "auth_required" }`. С токеном — не проверено (нужен реальный аккаунт участника).
- Session-injection в песочнице недоступен (`AUTH_STATUS=signed_out`), поэтому воспроизвести под реальным пользователем можно только через логин по email/паролю или через Playwright с сессией.

## Гипотезы, которые проверю в такой очерёдности

1. **live-resolve падает под авторизованным пользователем** (например, ошибка в `resolveEffectiveProductAccess`, в проверке `is_user_removed_from_room`, во вьюхе `live_event_active_participants_v` или в чтении `event.metadata`). Симптом ровно тот, что описан: `resolve()` кидает исключение → `setState("error")` только если ещё нет `dataRef.current`, но у нас cold-start → всё же должен показать «error». Однако если `fetch` **виснет** (нет ответа), спиннер бесконечный. Проверю edge-логи `live-resolve` за окно жалоб, ищу таймауты/exceptions.
2. **Regression в `LiveEvent.tsx`**: недавние правки могли зависеть от поля, которого нет в payload (например, room_settings/room_theme), из-за чего рендер валится в suspense/ошибку до `setState`. Проверю через Playwright: захвачу `console` и `pageerror` под залогиненным пользователем.
3. **AuthContext на мобильном iOS Telegram in-app browser не выдаёт сессию** (`hasAccessToken=false` навсегда → `useEffect` вообще не запускает `resolve`, страница остаётся в `state=loading`). В консоли уже видно `Safety timeout — forcing loading=false`. Если это так — виноват `session persistence` в WebView (например, отсутствие storage/cookies) либо гварды в `main.tsx`. Проверю `useAuthSession`/`AuthContext` и iOS-специфичные ветки.
4. **Проблема провайдера видео**: `platform_status=scheduled` (ещё не `live`), `room_state=opened` → фронт должен рендерить `room_open_waiting` (картинку ожидания + чат). Если ветка `room_open_waiting` рендерится, но что-то в дочерних компонентах (`RoomWaitingState`, `LiveEventComments`, `RoomParticipantsList`, `LiveRoomReactionsBar`) кидает и попадает в глобальный ErrorBoundary, который сам показывает спиннер — тоже даёт «бесконечно грузит». Проверю.

## Порядок работы

1. **Edge-логи live-resolve за окно 09:00–12:30 UTC 2026-07-03**: посмотреть ошибки/5xx/таймауты; сравнить с успешными вызовами.
2. **Прямой probe live-resolve с валидным JWT участника**: получить (через `supabase.auth.signInWithPassword` в edge-контексте или через админ-инжект) отклик на `?slug=klub-itogi-mesyatsa-0726`; убедиться, что `status=ok` и `room_phase=waiting`.
3. **Playwright под тестовым аккаунтом** (эмуляция iPhone/Telegram UA): открыть `/live/klub-itogi-mesyatsa-0726`, залогиниться реальным email/паролем (нужно от тебя), собрать console + network + pageerror, сделать скриншоты «до» и «после 15 сек».
4. **Прочитать ветку `room_open_waiting`** и её дочерние компоненты, найти любые обращения к полям, которых может не быть (`data.room_settings.*`, `data.presenter_user_id`), и обернуть в защитные проверки.
5. По результату — точечная правка: либо в `live-resolve` (если бросает), либо в `LiveEvent.tsx`/`RoomWaitingState`/чат (если крашится дочерний компонент), либо в `AuthContext`/persistence (если сессия не восстанавливается в WebView).
6. **Verify**: после правки — повтор Playwright-прогона; глазами открыть на iPhone через Telegram; убедиться, что видно «картинку и чат» до старта эфира и live-плеер после старта.

## Что нужно от тебя, чтобы починить сегодня

Дай, пожалуйста, **email/пароль тестового участника** (обычного пользователя с доступом к эфиру, не админа) — тогда я воспроизведу проблему один-в-один и починю без гаданий. Без реальной сессии я могу только чинить «по вероятной причине», что для прод-эфира рискованно.

Пока жду данные — параллельно прочту edge-логи `live-resolve` и код `room_open_waiting`-ветки и найду очевидные регрессии.
