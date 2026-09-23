# План: PR #526 «Публичные tracking-ссылки рассылок»

Exact SHA: `78226257345889351ffe8deea0fc0d3075c5ae30`. Режим текущего ответа — PLAN-ONLY, ничего не выполнено.

## Подтверждённые read-only факты

1. **SHA.** Локальный HEAD уже равен `78226257345889351ffe8deea0fc0d3075c5ae30` («Fix public broadcast tracking links (#526)»), рабочее дерево чистое. Exact sync подтверждён, mismatch нет.
2. **Дельта PR #526 — ровно 7 файлов, 105 вставок / 5 удалений:**
   - `src/App.tsx` — lazy-импорт и публичный route `/broadcast-track/c/:token`;
   - `src/pages/BroadcastTrackingPage.tsx` (новый) — резолвит токен запросом `…/broadcast-track/c/<token>?format=json`, проверяет через `isForbiddenRedirectUrl`, затем `location.replace`; при ошибке — нейтральный текст «Ссылка недоступна» на том же домене;
   - `src/lib/broadcastAnalytics.test.ts` — +8 строк;
   - `supabase/functions/_shared/broadcastAnalytics.ts` — новая `publicTrackingBaseUrl()` (env `PUBLIC_APP_HOST`, запрет `*.supabase.co` и `lovable.app/dev`, fallback `https://gorbova.by`); email-ссылки, Telegram-текст и Telegram-кнопки теперь используют её. Пиксель открытия остаётся на functions-домене;
   - `supabase/functions/broadcast-track/index.ts` — CORS + `OPTIONS`, ветка `?format=json` c `no-store` и `nosniff`; без параметра сохраняется прежний 302 (обратная совместимость старых ссылок);
   - `bank-statement-analyzer/index.ts` и `act-reconciliation-analyzer/index.ts` — по одной строке: отсутствие `Authorization` → 401 до проверки конфигурации; далее `auth.getUser` и product access_rules без изменений.
3. **Миграций и изменений данных нет.** Последняя миграция в репозитории — уже применённая `20260923112039`; PR #526 не содержит SQL и не трогает access_rules/section_access.
4. **Deploy.** Обязательны `broadcast-track`, `bank-statement-analyzer`, `act-reconciliation-analyzer`. **Важное уточнение:** изменённый shared `broadcastAnalytics.ts` входит в бандлы `email-mass-broadcast` и `telegram-mass-broadcast` — без их redeploy новые рассылки продолжат подставлять functions-домен, то есть цель 1 не будет достигнута. Предлагаю добавить эти две функции в список deploy (итого 5) либо явно подтвердить отказ.
5. **Секреты.** `PUBLIC_APP_HOST` в списке секретов проекта отсутствует (значения не выводились). Это не блокер: обе реализации детерминированно падают на `https://gorbova.by`. Задавать секрет не требуется.
6. **Тесты.** `src/lib/broadcastAnalytics.test.ts` — 6/6 PASS локально на этом SHA.

## Execute-план

1. Sync exact SHA `78226257…`, `git status` чистый; стоп при mismatch.
2. Verify delta: `git show --stat` = ровно 7 файлов выше; ни одной миграции.
3. Build/tests: vitest по затронутым тестам + `deno check` для трёх функций.
4. Pre-read-back (read-only, без PII): counts `access_rules`=164, `section_access`=75, active section `ai_act_reconciliation`=1, prompt `act_reconciliation`=1; фиксируем как baseline.
5. Deploy ровно: `broadcast-track`, `bank-statement-analyzer`, `act-reconciliation-analyzer` (+ по вашему решению `email-mass-broadcast`, `telegram-mass-broadcast`).
6. Runtime smoke без пользователей и клиентских данных:
   - `POST bank-statement-analyzer` и `act-reconciliation-analyzer` без `Authorization` → ожидается HTTP 401 «Необходима авторизация» (не 503);
   - `OPTIONS broadcast-track` → 200 с CORS;
   - `GET /broadcast-track/c/<невалидный-uuid>?format=json` → контролируемый не-2xx без утечек;
   - публичный SPA `https://gorbova.by/broadcast-track/c/00000000-0000-0000-0000-000000000000` → страница остаётся на gorbova.by, показывает «Ссылка недоступна», без редиректа на *.supabase.co.
   - Реальные рассылки не отправляются, токены реальных клиентов не резолвятся.
7. Post-read-back: те же counts без изменений; никаких новых orders/payments/subscriptions/broadcast rows.
8. Publish frontend с этого SHA, затем production-проверки desktop и mobile: загрузка `/`, вход в `/ai` остаётся deny-by-default для неавторизованного, и страница `/broadcast-track/c/<невалидный>` корректна в обоих viewport со скриншотами без токенов/PII.

## Стоп-условия

SHA mismatch, дельта отличная от 7 файлов, появление миграции, неожиданный rowcount, 503 вместо 401 на unauthenticated AI endpoint, любой новый critical finding. Ранее известные 13 RLS findings — pre-existing и вне scope; они блокируют кнопку Publish и потребуют отдельного решения.
