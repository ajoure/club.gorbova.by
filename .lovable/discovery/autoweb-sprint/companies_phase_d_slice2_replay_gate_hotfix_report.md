# D-slice-2 HOTFIX — replay gate ordering (autoweb-resolve-sessions)

**Дата:** 2026-07-20
**Триггер:** независимая ревизия commit `86e5e337` — `autoweb-resolve-sessions` возвращал
`launches_closed` для терминального события даже при `replay_enabled=true`, блокируя
завершённую запись.

## Инвариант (после hotfix)

Порядок гейтов в `supabase/functions/autoweb-resolve-sessions/index.ts`:

1. Терминальное состояние (`platform_status IN ('ended','archived')` или `status='ended'`)
   **+** `replay_enabled=false` → `410 {"status":"ended","reason":"replay_disabled"}`.
2. Терминальное состояние **+** `replay_enabled=true` → `200 {"status":"replay","replay_enabled":true, ...}`
   **вне зависимости от `launches_end_at`**.
3. Не-терминальное состояние **+** `launches_end_at` в прошлом →
   `410 {"status":"launches_closed", "note":"active_sessions_unaffected"}`.
   Гейт закрывает только **новые входы**; активные personal-сессии не проходят через
   этот резолвер и продолжают жить через `autoweb-room-state` + heartbeat.
4. Иначе — обычная выдача слотов по `autoweb_mode`.

Симметрично: `autoweb-create-personal-session` уже содержит `launches_end_at` gate до
`INSERT` (строки 83–91) — блокирует создание новой сессии, не трогая существующие.
Активная сессия обслуживается `autoweb-room-state` / heartbeat, которые эту функцию
не вызывают.

## Runtime evidence (production endpoint)

Тестовый эфир: `slug=testveba`, `event_type=autowebinar`, `autoweb_mode=one_time`,
`platform_status=ended`. Каждый тест сопровождался явным SQL update и обратным откатом.

| # | Состояние | Ожидание | Фактически |
|---|-----------|----------|------------|
| A | terminal + `replay_enabled=false`, `launches_end_at=NULL` | `410 ended` | `HTTP 410 {"status":"ended","reason":"replay_disabled","replay_enabled":false}` ✅ |
| B | terminal + `replay_enabled=true`, `launches_end_at=NULL` | `200 replay` | `HTTP 200 {"status":"replay","replay_enabled":true,"launches_end_at":null}` ✅ |
| C | terminal + `replay_enabled=true`, `launches_end_at` в прошлом | `200 replay` (launches_end_at НЕ переопределяет replay) | `HTTP 200 {"status":"replay","replay_enabled":true,"launches_end_at":"...past..."}` ✅ (ключевое доказательство исправления бага) |
| D | post-revert: `replay_enabled=false`, `launches_end_at=NULL` | `410 ended` | `HTTP 410 {"status":"ended","reason":"replay_disabled",...}` ✅ (baseline восстановлен) |

### SQL before/after

```
-- baseline: replay_enabled=false, launches_end_at=NULL, platform_status=ended
-- (тест A выполнен)
UPDATE live_events SET replay_enabled=true       -- тест B
  WHERE id='d25f3ea5-...'; -- → 200 replay
UPDATE live_events SET launches_end_at=now()-'1h' -- тест C
  WHERE id='d25f3ea5-...'; -- → 200 replay (ключевой инвариант)
UPDATE live_events SET replay_enabled=false, launches_end_at=NULL -- revert
  WHERE id='d25f3ea5-...'; -- → 410 ended (baseline восстановлен)
```

## Инвариант "active personal session не ломается"

Резолвер `autoweb-resolve-sessions` **не** вызывается циклом жизни уже активной
personal session (`useAutowebRoomState` / `useAutowebHeartbeat` работают через
`autoweb-room-state` и `autoweb-session-heartbeat`). Следовательно ни один код-путь
активной сессии не проходит через `launches_closed` gate этого резолвера — активные
сессии продолжают работать штатно. Дополнительно `autoweb-create-personal-session`
блокирует только новые insert'ы (строки 83–91) и не мутирует существующие.

## Deploy

- Файл: `supabase/functions/autoweb-resolve-sessions/index.ts` (только пересмотр
  порядка гейтов; add-only комментарий к инварианту).
- `deploy_edge_functions(["autoweb-resolve-sessions"])` — success.
- Другие функции, миграции, cron, UI, секреты — не тронуты.

## Не тронуто / вне scope

- `autoweb-create-personal-session` — контракт launches_end_at gate уже корректен.
- `autoweb-room-state`, `autoweb-session-heartbeat` — активные сессии.
- Frontend UI, платежи, CRM, RLS, JWT/verify_jwt конфигурация.
- `platform_status`, `status`, `replay_enabled` тестового эфира — восстановлены в
  точное исходное состояние (verified в тесте D).

## Rollback

`git checkout HEAD^ -- supabase/functions/autoweb-resolve-sessions/index.ts && deploy`.
