---
name: autoweb-server-gates-hotfix
description: Отчёт о выполнении задачи №1 — recovery миграции phase5b + серверные гейты автокомнаты после дефектов f73f6190
type: feature
---

# Отчёт о выполнении: autoweb server-gates hotfix + recovery миграции phase5b

Соответствует одобренному плану `.lovable/plan.md` (Recovery + Autoweb server-gates hotfix).

## 1. Discovery (факты, не отчёты)

- `git log -m f73f6190f -- supabase/functions/autoweb-resolve-sessions/index.ts` — подтверждён diff, содержащий six дефектов.
- Merge `f73f6190f`: `parents = 8765c9d6a (main) + 8553bca40 (edit branch)`. В первом родителе миграция `supabase/migrations/20260720080000_crm_companies_phase5b_links.sql` — blob `83ee0a20395d9b931a781c80bc75b8a33c4de710`, 345 строк.
- `HEAD` этого файла не содержит (`git ls-tree HEAD` → пусто по 20260720080000).
- Read-only verify события `testveba`:
  ```
  slug=testveba event_type=autowebinar autoweb_mode=one_time
  platform_status=ended  status=ended  is_published=true
  replay_enabled=false  launches_end_at=NULL  scheduled_at=2026-07-08 17:30 UTC
  ```
  — terminal + replay_disabled классический case для новых гейтов.

## 2. Commit A — Git integrity recovery

Восстановлен `supabase/migrations/20260720080000_crm_companies_phase5b_links.sql` из `f73f6190f^1` командой `git show f73f6190f^1:...` → файл записан byte-for-byte. Проверка целостности:

```
sha1sum recovered file  = 5af5b6bd062c9abf90be10ecbcf0e2930b348322
git cat-file blob 83ee.. = 5af5b6bd062c9abf90be10ecbcf0e2930b348322
lines = 345
```

Миграция НЕ запускалась. Другие company/CRM файлы не тронуты. Второй удалённый файл `..._extend_company_search_date_filters.sql` — вне scope (отдельная задача).

## 3. Commit B — Autoweb server-gates hotfix

### 3.1 `supabase/functions/autoweb-resolve-sessions/index.ts`

- **Дефект f73 #1** (probe fail-open) — исправлен: terminal probe теперь fail-closed. При `ev2Err !== null || ev2 == null` → `console.error` + HTTP 500 `status='error'`. `try/catch` вокруг оставлен для runtime-исключений и тоже возвращает 500. Никакого silent `isTerminal=false`.
- **Дефект #2** (`status: 'ended'`) — переименован в `status: 'replay_disabled'`, HTTP 410, `reason: 'replay_disabled'`, `replay_enabled: false`. Согласовано с live-resolve и live-token-validate.
- **Дефект #3** (`status: 'replay'`) — удалён. Terminal + replay_enabled продолжает штатную mode-ветку и возвращает существующий контракт (`status: 'ok', mode, timezone, one_time|scheduled|jit|on_demand`) плюс add-only флаги `replay_available: true`, `launches_end_at_bypassed: true`. UI/`useAutowebSessionResolver` не ломается.
- **Дефект #4** — gate `launches_end_at` теперь применяется ТОЛЬКО когда `!isTerminal`. Активные сессии не проходят через resolve-sessions и живут через `autoweb-room-state`. Payload сохраняет `note: 'active_sessions_unaffected'`.

### 3.2 `supabase/functions/live-resolve/index.ts`

- Добавлен server-side gate `replay_disabled` (шаг 5a, после access + admin bypass):
  - `terminal = platform_status ∈ {ended, archived} OR status='ended'`.
  - Non-admin + terminal + `!replay_enabled` → HTTP 410 `status: 'replay_disabled'`, audit `live_access_replay_disabled`.
  - Admin/super_admin — bypass (visibility).
- Порядок гейтов: invite → access → admin bypass → **NEW replay_disabled** → moderation → resolve source. Add-only.

### 3.3 `supabase/functions/live-events-list/index.ts`

- Добавлен admin bypass (`has_role_v2` для `admin`/`super_admin`).
- Расширен фильтр: скрывать `terminal && !replay_enabled` где terminal учитывает и `platform_status ∈ {ended, archived}`, и `status === 'ended'`. Admin bypass выдаёт все accessible events.

### 3.4 `supabase/functions/live-token-validate/index.ts`

- В `handleValidate` — согласованный gate `replay_disabled` HTTP 410 на обеих ветках (первая активация и re-entry). Аудит `live_link_replay_disabled` с `path: 'activation' | 'reentry'`.
- Расширен `select` для event: добавлены `platform_status`, `replay_enabled`.

### 3.5 Клиент (только типы, без UI-логики)

- `src/hooks/useAutowebSessionResolver.ts`: union `status` расширен `'replay_disabled' | 'launches_closed'`; добавлены опциональные `replay_available`, `launches_end_at_bypassed`, `reason`, `replay_enabled`, `launches_end_at`.
- `src/pages/LiveAccessEntry.tsx`: маппинг `case 'replay_disabled'` → «Запись эфира недоступна. Эфир завершён, а запись отключена организатором».

### 3.6 Инварианты соблюдены

- `live_events.autoweb_mode` — единственный SoT (не тронут).
- `recorded_webinar` legacy = только `one_time` (не тронут).
- Плеер = SoT: `autoweb-room-state` не изменялся, `launches_end_at` и `replay_enabled` там не гейтятся.
- `autoweb-create-personal-session` не тронут — его `launches_end_at` gate уже корректен для новых сессий.
- `testveba` в проде НЕ мутировался — только read-only SELECT.

## 4. Proof-pack

- Recovery blob checksum совпадает (см. §2).
- Deploy: `autoweb-resolve-sessions`, `live-resolve`, `live-events-list`, `live-token-validate` (см. deploy status ниже).
- Тестовый файл `supabase/functions/autoweb-resolve-sessions/index.test.ts` фиксирует контракт (4 case: probe fail-closed, terminal+replay_disabled → status='replay_disabled', terminal+replay_enabled → mode contract + replay_available, non-terminal+past-deadline → launches_closed + active_sessions_unaffected).
- Read-only verify testveba выполнен через `supabase--read_query`.

## 5. Что НЕ тронуто

- `autoweb-room-state`, `autoweb-create-personal-session`, все прочие autoweb/CRM/company edge функции.
- База данных (нет DDL/DML).
- UI автокомнаты, селекторов, плеера.
- Событие `testveba` (никаких UPDATE).
- Прочие миграции, RLS, RPC, seeds, cron.

## 6. Изменённые файлы

```text
Commit A (recovery):
  A supabase/migrations/20260720080000_crm_companies_phase5b_links.sql

Commit B (server gates hotfix):
  M supabase/functions/autoweb-resolve-sessions/index.ts
  A supabase/functions/autoweb-resolve-sessions/index.test.ts
  M supabase/functions/live-resolve/index.ts
  M supabase/functions/live-events-list/index.ts
  M supabase/functions/live-token-validate/index.ts
  M src/hooks/useAutowebSessionResolver.ts
  M src/pages/LiveAccessEntry.tsx
  A .lovable/discovery/autoweb-sprint/autoweb_server_gates_hotfix_report.md
```

## 7. Stop-guards

- STOP. Фаза D целиком и sprint accepted НЕ объявляются. Ожидается независимая проверка пользователем перед следующей последовательной фазой.
- Rollback: `git revert` коммита B откатывает серверные гейты без задевания recovery-коммита A (файл миграции всё равно не выполнялся).
