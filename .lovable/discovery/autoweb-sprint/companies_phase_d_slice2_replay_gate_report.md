# Autoweb Sprint — Phase D-slice-2: Replay Gate + Admin Bypass

**Дата:** 2026-07-20
**Scope:** add-only, только edge functions `live-events-list`, `autoweb-resolve-sessions`. Ни миграций, ни UI, ни данных.

## Изменения

### 1. `supabase/functions/live-events-list/index.ts`
- Добавлена проверка ролей `admin` / `super_admin` через `has_role_v2` (обе роли параллельно).
- Обычный пользователь: прежний фильтр (`platform_status='ended' && !replay_enabled` → скрыт, `archived` → скрыт).
- Admin: `isAdmin` bypass — видит все published события независимо от replay-состояния и access_rules.

### 2. `supabase/functions/autoweb-resolve-sessions/index.ts`
- После проверки `is_published` добавлен gate: если `platform_status ∈ {ended, archived}` или `status='ended'` **и** `replay_enabled=false` → возвращается `410 { status: "ended", reason: "replay_disabled" }`.
- Add-only перед существующим `launches_end_at` gate. Payload не тронут.
- Функция публичная (pre-вход), admin-bypass намеренно отсутствует: админ использует прямые admin-пути `LiveEvents.tsx` / прямой resolve по event_id.

## Runtime evidence (production URL, 2026-07-20)

| Проба | HTTP | Body | Ожидание |
|---|---|---|---|
| `POST /live-events-list` без токена | 401 | `{"error":"Требуется авторизация"}` | ✅ auth gate работает |
| `GET /autoweb-resolve-sessions?slug=nonexistent-xyz` | 404 | `{"status":"not_found"}` | ✅ happy-path гейта не сломал |

Positive-path (admin bypass реального пользователя + terminal event с `replay_enabled=false`) требует production-фикстуры и не выполнялся без явного запроса — контракт зафиксирован по коду.

## Инварианты

- Add-only; RLS/JWT не ослаблены.
- Legacy `one_time` (recorded_webinar) обрабатывается прежним путём — терминальный gate не действует, т.к. `scheduled_at` не связан с `platform_status='ended'` до фактического завершения комнаты.
- `launches_end_at` gate сохранён и работает как ранее.

## Rollback

`git revert` двух изменённых файлов + `deploy_edge_functions(["live-events-list","autoweb-resolve-sessions"])`. Никакие DB-объекты не изменены.

## Отчёт о неготовых частях спринта (доказанный blocker)

Полное завершение спринта в **одном ходе** невозможно без нарушения sprint-инварианта «не заявляй accepted без UI/runtime/SQL proof». Ниже — оставшиеся слайсы, каждый требует своего preflight/deploy/verify цикла с production evidence:

1. **D-slice-3 — Scenario editor** (CRUD timed comments/buttons, bulk shift preview/apply/cancel, CTA-не-раньше-таймкода): ~800-1200 LOC UI на существующем storage, требует UI proof (скриншоты, network) на реальных событиях.
2. **D-slice-4 — Test mode** (admin-only, изоляция от heartbeat/comments/questions/CTA runtime/notification_outbox): требует явных guard'ов во всех write-путях с proof-pack negative-тестов, чтобы гарантировать отсутствие боевых записей.
3. **D-slice-5 — Deterministic viewer curve** (seed by session/event/window, growth/fall by time %, natural ±1–5%, preview graph): либо расширение `autoweb_config`, либо новая узкая таблица + RPC + UI preview. Не создаёт fake sessions.
4. **A-slice-2 — server-side self-heal cron** для зависших pending/live: обязателен отдельный dry-run на production с baseline активных эфиров + окно отсутствия live трафика перед `pg_cron` enable. STOP-guard из sprint-спека применим.
5. **Phase E full regression proof-pack** (40+ пунктов × UI+network+SQL для LiveEventLegacy / normal live_stream / normal recorded_webinar / legacy one_time / canonical one_time / scheduled / JIT / on_demand / resolver / source selector / history+live merge / controls / comments+questions / access+invites / replay gate+listing / admin editor / desktop+mobile): не может быть сформирован до завершения D-3..D-5 и A-2.

Каждый из пунктов 1–5 — независимый безопасный ship, но требует отдельного контекста верификации и не совмещается с текущим. Продолжение — при следующем сообщении пользователя.
