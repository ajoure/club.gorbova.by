# План: закрытая live-комната (PR #381) — read-only discovery и порядок execute

## 1. SHA репозитория и статус сборки

- Lovable-репозиторий видит ровно `a436ccefbc8eef03b2eb09fef13b4a38f1f2409e`
  (`Merge pull request #381 from ajoure/codex/block-closed-live-room`,
  2026-08-28 16:35 +0200). Рабочее дерево чистое, незакоммиченных правок нет.
- Состав PR (коммит `60e7f9b8e`, 5 файлов): `supabase/functions/_shared/live-room-gate.ts` (новый),
  `live-resolve/index.ts`, `live-session-heartbeat/index.ts`, `src/pages/LiveEvent.tsx`,
  `src/lib/liveClosedRoomGate.test.ts`. Миграций, RLS и изменений данных в PR нет.
- Причина «Build unsuccessful / Preview is out of date»: фронтовая сборка сама по себе проходит
  (`vite build` — успешно, ошибок нет). Проблема в шаге проверки типов: единственная ошибка —
  `supabase/functions/ai-generate-corporate-package/helpers.ts:79 — TS2550 replaceAll ... target lib`.
  Файл относится к Deno-функции и попадает в общий typecheck, хотя `tsconfig.app.json` включает только `src`.
  Ошибка досталась в наследство от коммита `50eebc664` и к PR #381 отношения не имеет.
  Ничего не исправлял. Возможные варианты фикса (на отдельную задачу, не сейчас):
  поднять `lib`/`target` до ES2021 для функций или заменить `replaceAll` на `split/join`.

## 2. Состояние целевого эфира (production, обезличено)

| поле | значение |
|---|---|
| id | `a340647f-15fd-4756-ac67-79025549fd0c` |
| slug | `cb-20-20-potok-konferentsiya-4` |
| event_type | `live_stream` |
| room_state | `closed` |
| platform_status | `draft` |
| status | `draft` |
| is_published | `true` |
| scheduled_at | 2026-08-29 07:00:00+00 |
| event_timezone | `Europe/Minsk` |
| replay_enabled | `false` |

Дополнительно (для проверки эффекта фикса): по этому эфиру сейчас существует
**1 активная сессия** в `live_active_sessions` (`revoked_at is null`, `expires_at > now()`) —
подтверждение исходного инцидента.

## 3. Production-очередь live_stream

- `room_state IN ('opened','live')`: **count = 1**
  - id `3f91de6a-3d78-4796-a995-f73afdb4256d`, slug `testiruem-kartinku-do-veba`,
    status `scheduled`, platform_status `scheduled`, room_state `opened`,
    room_opened_at 2026-04-23, live_started_at пуст.
- не-terminal `room_state='closed'` и `platform_status='live'`: **count = 0**.

> **STOP-условие сработало формально.** По правилу из запроса любой `opened/live` эфир
> блокирует deploy/Publish. Фактически это старый тестовый эфир, открытый ещё 23.04.2026
> и ни разу не переведённый в `live`; реального идущего эфира в очереди нет.
> Решение — за пользователем: либо явное подтверждение, что это не боевой эфир и можно
> продолжать, либо закрытие/завершение этой комнаты отдельной задачей до execute.

## 4. Что реально нужно задеплоить

Изменения затрагивают только две Edge Functions плюс общий модуль, который они импортируют:

- `live-resolve` — при `isClosedLiveRoom(event)` возвращает `status: 'room_closed'`
  и только безопасные поля (title, description, scheduled_at, event_type, event_timezone,
  platform_status, room_state, room_phase); без `event_id`, `resolved_source`, provider URL.
  Гейт применяется в том числе к админам (превью закрытой комнаты не создаёт сессию).
- `live-session-heartbeat` — в soft-join ветке до создания/возобновления сессии читает
  `live_events` и при закрытой комнате возвращает `403 room_closed`, не трогая `live_active_sessions`.
- `supabase/functions/_shared/live-room-gate.ts` — общий гейт, «fail closed»: неизвестный/пустой
  `room_state` у не-terminal `live_stream` трактуется как closed; terminal-события (ended/archived) не задеваются.

Миграций, изменений RLS, GRANT'ов, cron и данных **не требуется**. Клиентская часть
(`LiveEvent.tsx`) едет обычным Publish фронтенда.

## 5. План execute (после снятия STOP)

1. Повторно сверить SHA репозитория = `a436ccef…`, дерево чистое, новых коммитов нет.
2. Deploy ровно двух функций одним шагом: `live-resolve`, `live-session-heartbeat`
   (порядок: сначала `live-session-heartbeat` — сервер перестаёт создавать сессии,
   затем `live-resolve` — перестаёт отдавать комнату).
3. Read-back деплоя: обе функции в статусе успешного деплоя, без ошибок в логах за окно деплоя.
4. Безопасные негативные проверки (без PII, без реальных пользователей):
   - `OPTIONS` на обе функции → CORS 200/204;
   - `POST` с невалидным JWT → 401, тело без внутренних деталей.
5. Проверка закрытого slug `cb-20-20-potok-konferentsiya-4` под тестовой сессией с доступом:
   - `live-resolve` → `status=room_closed`, в ответе **нет** `event_id`, `resolved_source`,
     kinescope/provider URL, токенов;
   - `live-session-heartbeat` soft-join по этому эфиру → `403 room_closed`;
   - SQL read-back: количество строк `live_active_sessions` по этому эфиру **не выросло**.
6. Baseline-регресс на открытой комнате: один эфир с `room_state='opened'` продолжает
   резолвиться `status=ok` / `room_phase=waiting` (проверка, что гейт не пережат).
7. Publish exact SHA `a436ccefbc8eef03b2eb09fef13b4a38f1f2409e` — только после всех PASS
   и после устранения причины «Build unsuccessful».
8. Визуальная проверка опубликованного URL по прямой ссылке на закрытый эфир:
   скриншот desktop и скриншот mobile 390x844 — виден экран «Запланирован», плеер/чат отсутствуют,
   в консоли нет запросов heartbeat.

## 6. Stop-guards (остановка без execute/Publish)

- SHA в Lovable ≠ `a436ccefbc8eef03b2eb09fef13b4a38f1f2409e`;
- сборка не проходит (сейчас именно это состояние — TS2550 в `helpers.ts`);
- любой реально идущий `opened/live` эфир в очереди;
- новый critical security finding в scope;
- неожиданный diff, коммит или миграция в изменяемом периметре;
- ошибка деплоя любой из двух функций, ошибка read-back или ненулевой прирост активных сессий на закрытом эфире.
