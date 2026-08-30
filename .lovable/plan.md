# План: deploy PR #389 (единый контракт malformed JWT для live-функций)

Режим: PLAN-ONLY / READ-ONLY. Ничего не изменено, deploy и Publish не выполнялись.

## 1. Синхронизация дерева — PASS

- HEAD = `f14740a69575514857e493c240e2bd6622b16582` (merge PR #389), родители `a6ccf68f7` / `dc32cc8c1`.
- `git status --porcelain` пустой — WIP-коммитов и незакоммиченных изменений нет.
- `git diff --exit-code f14740a69 -- .` → PASS, tree `24d05d43a9e161da5d7183fb63e9ebac4e7737a4`.
- `src/integrations/supabase/types.ts` содержит `PostgrestVersion: "14.5"` — авто-регенерации types.ts в этот раз не произошло.

## 2. Сверка исходников — PASS

Состав коммита `a6ccf68f7` ровно 5 файлов, без миграций и без frontend-логики:

| файл | роль |
|---|---|
| `supabase/functions/_shared/live-auth-claims.ts` | новый helper `verifyLiveBearerClaims` |
| `supabase/functions/live-resolve/index.ts` | переход на helper |
| `supabase/functions/live-events-list/index.ts` | переход на helper |
| `supabase/functions/live-session-heartbeat/index.ts` | переход на helper |
| `src/test/liveResolveAuthContract.test.ts` | контрактный тест (только тест) |

Helper нормализует оба исхода Supabase Auth (возврат `error` и throw при парсинге повреждённого JWT) в `{ userId: null, error }`, поэтому вызывающая сторона отдаёт 401 вместо 500. В `live-resolve` проверка стоит в блоке «3. Auth check» после резолва события; правила доступа, invite-mode и room-gate не менялись.

## 3. Production queue — PASS

Единственная запись с `room_state='opened'` — `testiruem-kartinku-do-veba` (`status='scheduled'`). Второго opened/live эфира и реальных боевых эфиров нет.

## 4. Baseline текущих deployed-контрактов (безопасные пробы, без записи данных)

| функция | OPTIONS | без JWT | malformed JWT |
|---|---|---|---|
| `live-events-list` | 200 | 401 | 401 |
| `live-session-heartbeat` | 200 | 401 | 401 |
| `live-resolve` | 200 | 400 `slug is required` | 400 `slug is required` |

Важно: `live-resolve` читает `slug` из query-string, а аутентификация проверяется **после** резолва события и пишет audit-строку (`live_access_attempt`). Поэтому проба с реальным slug в read-only режиме намеренно не выполнялась — она создала бы запись в audit-логе. Контракт 401 для `live-resolve` фиксируется post-deploy (см. п.6), где одна audit-запись допустима и заранее объявлена.

## 5. План execute

1. Гейты перед действием: HEAD ровно `f14740a69`, дерево чистое, `tsgo --noEmit` PASS, `bun run build` PASS, `vitest run src/test/liveResolveAuthContract.test.ts` PASS, очередь без второго opened/live эфира.
2. Снять baseline-счётчики: `count(live_active_sessions)`, `count(live_event_replies)` (сейчас 1421 / 27), а также число audit-записей `live_access_attempt` за сутки.
3. Deploy ровно трёх функций: `live-resolve`, `live-events-list`, `live-session-heartbeat`. Shared-модуль `_shared/live-auth-claims.ts` уезжает вместе с каждой из них и отдельного деплоя не требует.
4. Никаких миграций, никаких изменений RLS/GRANT/данных, Publish фронтенда не выполняется (в PR нет изменений `src/` кроме теста).

## 6. Read-back после deploy (доказательство)

Для каждой из трёх функций:

- `OPTIONS` → 200 с CORS-заголовками.
- POST/GET без `Authorization` → 401 (`auth_required`).
- POST/GET с `Authorization: Bearer not.a.jwt` → **401**, не 500; для `live-resolve` проба идёт с `?slug=testiruem-kartinku-do-veba`.
- Логи функций не содержат неперехваченных исключений парсинга JWT.

Инвариантность данных:

- `count(live_active_sessions)` = 1421 (delta 0), `count(live_event_replies)` = 27 (delta 0).
- `live_events` для `testiruem-kartinku-do-veba` не меняет `room_state`, `status`, `room_opened_at`, `live_started_at`.
- Единственная допустимая новая запись — до двух audit-строк `live_access_attempt` с `reason='invalid_token'`/`no_auth_header` от контрактных проб.

## Stop conditions

- HEAD ≠ `f14740a69`, дерево грязное, платформа снова перегенерировала `types.ts`.
- Появление второго `opened`/`live` эфира или реального идущего эфира.
- Ошибка typecheck/build/теста или ошибка деплоя любой из трёх функций → откат к предыдущей версии.
- Любая из трёх функций после deploy отдаёт 500 на malformed JWT, либо ненулевой прирост `live_active_sessions` / `live_event_replies`.

## DoD

Три функции задеплоены с exact SHA `f14740a69`, у всех трёх OPTIONS=200 / no JWT=401 / malformed JWT=401, миграции и фронтенд не тронуты, счётчики сессий и ответов без изменений, lifecycle тестовой комнаты не изменён.
