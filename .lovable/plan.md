
# План: Recovery + Autoweb server-gates hotfix

Задача выполняется двумя строго изолированными шагами. Multitask отключён: только автокомната и recovery одной удалённой миграции. Никаких DB migrations, UI, счётов, CRM, платежей.

## Discovery (факты, а не отчёты)

- Commit `f73f6190f` — merge (parents `8765c9d6a` + `8553bca40`), сообщение «Исправил resolve-sessions gate».
- В его первом родителе `f73f6190f^1` = `8765c9d6a` файл `supabase/migrations/20260720080000_crm_companies_phase5b_links.sql` присутствует (blob `83ee0a20…`, 345 строк). В `HEAD` его нет.
- Второй файл миграции `..._extend_company_search_date_filters.sql` тоже был удалён этим merge, но вне scope — задача №1 требует восстановить ровно один явно названный файл.
- Diff `f73f6190f` по `autoweb-resolve-sessions/index.ts` подтверждает шесть заявленных дефектов (probe ошибки в `result.error` + `try/catch` вокруг non-throwing вызова; статусы `ended`/`replay`; порядок гейтов).
- `autoweb-create-personal-session` уже блокирует `launches_end_at` (для НОВЫХ сессий) — корректно.
- `autoweb-room-state` не смотрит на `launches_end_at` и `replay_enabled` — активные/replay-контексты не ломаются.
- `live-resolve` НЕ имеет gate `replay_disabled` — сейчас пустит зрителя в комнату с завершённым событием и выключенным replay.
- `live-events-list` фильтрует `platform_status==='ended' && !replay_enabled`, но не учитывает `status='ended'` и не даёт admin bypass.
- `live-token-validate` направляет в `/live/:slug`; финальная защита должна быть в `live-resolve`.
- Клиентский `useAutowebSessionResolver` типизирует ответ `status: 'ok'|'not_found'|'unpublished'|'unsupported_event_type'|'error'`. `status:'replay'` из f73 не входит в контракт и ломает UI.
- Registry `supabase/functions.registry.txt` содержит все затронутые функции. Deploy идёт через Lovable Cloud (GitHub workflow — no-op stub).

## Коммит A — Git integrity recovery (только 1 файл)

- Восстановить `supabase/migrations/20260720080000_crm_companies_phase5b_links.sql` byte-for-byte из `f73f6190f^1` через `git show`.
- Не запускать миграцию. Не изменять другие CRM/company файлы. Отдельная миграция `..._extend_company_search_date_filters.sql` — не восстанавливается (вне scope задачи).

Файлы:
```text
+ supabase/migrations/20260720080000_crm_companies_phase5b_links.sql   (recovered)
```

## Коммит B — Autoweb server-gates hotfix

Каноны (invariants соблюдены):
- `live_events.autoweb_mode` — единственный SoT режима. `recorded_webinar` = legacy контейнер только для `one_time`.
- Время плеера — SoT (не трогаем `autoweb-room-state`).
- Add-only контракты: НЕ вводить новые обязательные поля в `AutowebResolveResponse`.

### B.1 `supabase/functions/autoweb-resolve-sessions/index.ts`

1. Terminal probe (`.select('platform_status,status,replay_enabled').maybeSingle()`) — fail-closed:
   - Оба возможных провала (`ev2Err` не null, либо `ev2 == null`) → `console.error`, `status: 'error'`, HTTP 500. Никакого silent continue как `isTerminal=false`.
   - Сохранить существующий `try/catch` только на непредвиденные исключения runtime и внутри catch тоже возвращать 500.
2. Terminal + `replay_enabled=false` → HTTP 410, `status: 'replay_disabled'` (переименовано с `'ended'`; `reason: 'replay_disabled'`, `replay_enabled: false`). Согласованно между resolve/list/live-resolve.
3. Terminal + `replay_enabled=true` → сохранить существующий контракт: НЕ возвращать `status: 'replay'`. Вместо этого — прокинуть в ту же mode-ветку (one_time/scheduled/JIT/on_demand) с add-only полем `replay_available: true` в top-level и `launches_end_at_bypassed: true`. Селектор продолжит работать без изменений.
4. `launches_end_at` gate применяется ТОЛЬКО к не-терминальным событиям, ТОЛЬКО для новых входов, `note: 'active_sessions_unaffected'` уже возвращён.

### B.2 `supabase/functions/live-resolve/index.ts`

- Добавить server-side gate ПОСЛЕ проверок auth + access + admin bypass:
  - Если `platform_status ∈ {ended, archived}` ИЛИ `event.status === 'ended'`, и `!replay_enabled`, и пользователь НЕ admin/super_admin → `status: 'replay_disabled'`, HTTP 410, audit `live_access_replay_disabled`.
  - Admin/super_admin получает bypass (visibility).
- Порядок: existing invite → access → admin bypass → NEW replay_disabled gate → moderation → resolve source. Add-only.

### B.3 `supabase/functions/live-events-list/index.ts`

- Расширить фильтр: скрывать когда `(platform_status ∈ {ended, archived} || status==='ended') && !replay_enabled`.
- Добавить admin bypass (через `has_role_v2` для `admin`/`super_admin`) — admins видят все accessible события.

### B.4 `supabase/functions/live-token-validate/index.ts`

- В `handleValidate` после `access_valid` — добавить консистентный gate `replay_disabled` на активацию/re-entry: если target-event уже terminal и `!replay_enabled` → `status: 'replay_disabled'`, HTTP 410, audit `live_link_replay_disabled`. Admin bypass не требуется (админ не проходит через invite-flow).

### B.5 Клиент (только типы, без UI)

- `src/hooks/useAutowebSessionResolver.ts`: расширить union `status` типом `'replay_disabled'` и опциональные поля `replay_available?: boolean`, `launches_end_at_bypassed?: boolean`. Никакой UI-логики не меняем (это отдельная фаза).
- `src/pages/LiveAccessEntry.tsx`: добавить case `replay_disabled` в маппинг статусов (сообщение «Запись эфира недоступна»). Минимальная точка входа token-flow.

### B.6 Что НЕ трогаем

- `autoweb-room-state` (плеер = SoT).
- `autoweb-create-personal-session` (launches_end_at уже правильный).
- `live-events-list` payload за пределами фильтрации.
- Прочие autoweb/CRM/company/UI/DB (миграции, RLS, RPC, seeds).
- Событие `testveba` в проде — только read-only verify в отчёте; никаких UPDATE.

### B.7 Proof-pack (минимальный, без прод-мутаций)

- `bun run typecheck` (репозиторный TS) + `deno check` для четырёх edge функций.
- Server unit-tests (deno test) в `supabase/functions/autoweb-resolve-sessions/index.test.ts` (новый): fail-closed на probe error, terminal+replay_disabled → 410 `'replay_disabled'`, terminal+replay_enabled → 200 с существующим mode-контрактом и `replay_available:true`, non-terminal+past-deadline → 410 `launches_closed`, non-terminal+no-deadline → 200 обычный ответ, admin bypass в live-resolve (mock role RPC).
- Read-only SQL verify текущих значений `testveba` (`platform_status`, `status`, `replay_enabled`, `launches_end_at`) в отчёте.
- Deploy: только 4 функции `autoweb-resolve-sessions`, `live-resolve`, `live-events-list`, `live-token-validate`.

### Файлы коммита B

```text
M supabase/functions/autoweb-resolve-sessions/index.ts
A supabase/functions/autoweb-resolve-sessions/index.test.ts
M supabase/functions/live-resolve/index.ts
M supabase/functions/live-events-list/index.ts
M supabase/functions/live-token-validate/index.ts
M src/hooks/useAutowebSessionResolver.ts
M src/pages/LiveAccessEntry.tsx
A .lovable/discovery/autoweb-sprint/autoweb_server_gates_hotfix_report.md
```

## Stop-guards

- После этих двух коммитов и деплоя 4 функций — STOP. Фазой D и sprint accepted не называю.
- Rollback: `git revert` коммита B откатывает только серверные гейты; recovery-коммит A остаётся (он лишь восстанавливает уже существовавший артефакт и не запускает SQL).
- Ждём независимую проверку пользователем.
