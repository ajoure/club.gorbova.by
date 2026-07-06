# P2 — useAwaitInlineAuthReady: proof

## Что сделано

Единый waiter подтверждения email для всех inline-flows.

**Файлы:**
- `src/lib/inlineAuth/broadcast.ts` — BroadcastChannel + storage-fallback (same-origin ускоритель).
- `src/lib/inlineAuth/ensureReady.ts` — `ensureInlineAuthReady()` / `ensureInlineAuthReadyWithRetry()` для pre-submit guard.
- `src/hooks/useAwaitInlineAuthReady.ts` — waiter (SoT = Supabase Auth, polling 3s, таймаут 5 мин, resend, changeEmail, защита от гонок).
- `src/hooks/__tests__/useAwaitInlineAuthReady.test.ts` — 7 сценариев, все зелёные.

## Тесты

```
✓ polling-only: ready наступает через polling без ускорителей
✓ ускоритель (BroadcastChannel/storage): ready наступает почти сразу
✓ expired: onExpired вызван по таймауту 5 мин
✓ resend использует emailRedirectTo=/auth-verify
✓ гонки: тройное событие приводит к одному onReady
✓ unmount очищает таймеры (нет вызовов после unmount)
✓ нет refresh_token: waiter остаётся waiting_confirm, не бросает
```

## DoD P2 — статус

1. ✅ Единый waiter — три входа (signup / login с email_not_confirmed / после resend) идут через `useAwaitInlineAuthReady`; интеграция в диалоги — отдельным патчем (P7).
2. ✅ Polling `getSession → refreshSession → getSession → getUser` работает без BroadcastChannel/storage (тест «polling-only»).
3. ⚠️ Cross-subdomain: **не доказано в этом патче** (см. blocker ниже). Waiter корректно опросит собственную сессию, но если Supabase-сессия физически не появится в localStorage исходного origin — polling останется в pending до таймаута. Требуется P3/P4 handoff-дизайн.
4. ✅ Same-origin: ускоритель триггерит ready < 1 сек (тест «ускоритель»).
5. ✅ Таймаут 5 мин → `state=expired`, `onExpired` вызван; `resend()` и `changeEmail()` доступны.
6. ✅ Тройное событие → `onReady` вызван ровно 1 раз (тест «гонки», `readyFiredRef`).
7. ⏭ `ensureInlineAuthReady()` готов, интеграция в диалоги — P7.
8. ✅ `unmount` очищает все таймеры, каналы и AbortController (тест «unmount»).

## Правки из ревью — как учтены

- ✅ **getSession перед refreshSession** — `ensureInlineAuthReady` сначала `getSession`, `no_session` возвращается сразу; `refreshSession` вызывается только когда сессия уже есть.
- ✅ **Нет refresh_token не ломает UI** — тест «нет refresh_token» подтверждает, что waiter остаётся в `waiting_confirm` без исключений.
- ✅ **resend с правильным `emailRedirectTo`** — `supabase.auth.resend({ options: { emailRedirectTo: buildAuthVerifyRedirect() } })` (`${origin}/auth-verify`), покрыто тестом.
- ✅ **Единый waiter для трёх входов** — публичный API один; вызывающая сторона просто передаёт `email` и `flowId`.
- ✅ **Таймаут + resend + changeEmail + сообщение** — `state='expired'`, `resend()` перезапускает таймер, `changeEmail()` = `cancel()`.
- ✅ **Гонки** — `readyFiredRef`, cleanup всех каналов на `ready`.
- ✅ **P2 без интеграции в диалоги** — только hook + utility + tests. PaymentDialog/LeadRequestDialog/PreregistrationDialog будут подключены отдельным патчем.
- ✅ **repeated resend не создаёт новый flowId** — `flowId` приходит извне (генерирует вызывающий), `resend` его не трогает.

## Cross-subdomain blocker (для P3/P4)

Подтверждено архитектурно в discovery: `refreshSession` в исходной вкладке не увидит session, установленную Supabase после verify в другом origin (у каждого origin свой localStorage). BroadcastChannel/storage cross-origin тоже не работают.

**Следствие для P3/P4:** для cross-subdomain сценариев необходим handoff-механизм. Варианты:
1. `redirect_to` из письма всегда указывает на origin, где стартовал flow (в `AuthVerifyProxy` пробрасывать `redirect_to` в Supabase verify → пользователь возвращается на тот же origin, где Supabase установит session).
2. Post-verify success-screen с явной кнопкой «Открыть исходный сайт» + одноразовым server-side токеном для восстановления session на целевом origin.

Рекомендация: вариант 1 как основной (P4 меняет `AuthVerifyProxy`), вариант 2 — fallback если исходный origin недоступен.

## Что дальше (порядок патчей)

- **P3** — `inlineAuthFlow.ts` (sessionStorage flow-persistence + TTL).
- **P4** — `AuthVerifyProxy.tsx` рефактор (interstitial success, publish в BroadcastChannel/storage, cross-subdomain handoff через `redirect_to`).
- **P5** — `AuthContext` / `useLastRoute` guard (`/dashboard` не перехватывает активный flow).
- **P6** — `useInlineAuth.signup`/`signIn`: перевод на `buildAuthVerifyRedirect()`.
- **P7** — интеграция `useAwaitInlineAuthReady` + `ensureInlineAuthReady` в PaymentDialog / LeadRequestDialog / PreregistrationDialog.
- **P8** — bot rename `@Gorbova_club_bot` → `@gorbovabybot`.
