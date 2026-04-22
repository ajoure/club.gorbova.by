да, согласен, с учетом правок:

1. **M2 scope уточнить явно:** unified entry tracking распространяется только на режимы, где есть “присутствие в комнате”: room_open_waiting и live. Для ended/replay/recorded_webinar presence в live_active_sessions не открывать, иначе Participants и analytics загрязнятся просмотрами записи.
2. **Для menu/direct distinction добавить источник входа:** soft-join должен принимать entry_path/entry_source (menu / direct / token). Если источник не передан из UI, писать direct по умолчанию. Иначе в M3 вы не сможете честно разделить вход “из меню” и “по прямой ссылке”.
3. **В M2 зафиксировать правило одной открытой viewing-session:** одновременно может существовать только **одна открытая** live_view_sessions на (user_id, live_event_id). Повторная вкладка не создаёт новую открытую сессию, а только обновляет текущую. Новая строка создаётся только после закрытия предыдущей сессии.
4. **В M2 добавить DoD на выход из списка участников:** пользователь должен исчезать из Participants не только по explicit leave, но и по inactivity timeout в пределах SLA, например ≤ 3 минут после последнего heartbeat.
5. **В M3 retention считать только если есть базовая длительность эфира:** если нет started_at/ended_at или эфир ещё не начат, avg_retention_pct и exit_distribution должны возвращать NULL / not_available, а не псевдозначение.
6. **Для M3 зафиксировать server-only write path:** live_view_sessions и live_session_events заполняются только сервером/edge/cron, UI туда не пишет напрямую. Это нужно явно прописать в архитектурном принципе и stop-guards.
7. **Добавить уникальность/идемпотентность для истории:** кроме индексов, нужен явный guard, чтобы repeated heartbeat не плодил join-events и не создавал вторую открытую историю. То есть:
  - join — только при создании новой open-session;
  - heartbeat — throttled;
  - leave/timeout/event_ended — только если left_at IS NULL.
8. **Для M3 concurrency/timeline зафиксировать источник истины:** max_concurrent и timeline считаются из live_session_events, а не из снимков live_active_sessions. Это стоит прописать прямо в разделе метрик.
9. **UI analytics уточнить:** вкладка “Аналитика” в admin должна быть **read-only**, отдельно от runtime Participants. В отчёте потом обязательно развести:
  - runtime Participants = кто сейчас в комнате;
  - analytics = история и метрики по факту присутствия.
10. **M1 safety fallback добавить в план:** если после compact waiting-state + hidden description + flex-1 sidebar composer всё ещё не попадает на первый экран на 375×812, допускается mobile-only дополнительное ужатие waiting-card ещё на один шаг. Иначе можно застрять между “почти влезает” и фактическим DoD.
11. **Verify для M2/M3 дополнить двумя обязательными кейсами:**

- direct /live/:slug с доступом + menu-вход дают одинаковый результат в Participants и в истории, но с разным entry_path;
- event ended закрывает все open-session массово и не оставляет хвостов left_at IS NULL.

12. **T1 regression** оставить отдельной строкой в финальном отчёте:

- T1 checked / no code changes required.

Если хочешь, я соберу это сразу в финальный готовый блок плана для вставки в Lovable без пояснений.

&nbsp;

# План: M1 — mobile composer / M2 — unified entry tracking / M3 — live analytics

## M1 — Mobile composer на первом экране + compact waiting-state

### Цель

На mobile (≤768px) при waiting-state композер чата виден без скролла на первом экране.

### Изменения

1. `**src/components/live/RoomWaitingState.tsx**`: добавить `compact?: boolean`. При `compact` убрать `aspect-video`, заменить на `min-h-[140px] py-5`, текст в одну строку, бейдж даты ниже.
2. `**src/pages/LiveEvent.tsx**` (mobile-only):
  - description в header → `hidden md:block`.
  - sidebar `<Card>` (стр. ~673): mobile-ветку с `h-[70dvh]` заменить на `min-h-[60dvh] flex-1 min-h-0`.
  - `<RoomWaitingState compact={isMobile} ... />`.
3. Desktop layout не трогаем. Composer уже `sticky bottom-0` в `LiveEventComments` — без изменений.

### DoD

- 375×812 waiting-state: header + compact-card + reactions bar + tabs + composer на первом экране без скролла.
- Фокус в composer: composer прижат над клавиатурой, video-карточка частично видна сверху.
- Скроллится только messages area.
- Desktop ≥1024px без визуальных регрессий.

---

## M2 — Unified entry tracking (единый учет всех путей входа)

### Цель

**Единый entry-tracking для всех путей входа в эфир.** Любой путь попадания в комнату при наличии доступа → ровно одна актуальная запись в `live_active_sessions`. Пользователь появляется в Participants независимо от того, как зашёл.

### Контракт (unify)


| Путь входа                                       | Endpoint                              | Результат                                                    |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| `/live-access/:token` (persona)                  | `live-token-validate` (без изменений) | INSERT/UPSERT в `live_active_sessions`, выдача `session_key` |
| `/live/:slug` direct (admin/staff/owner)         | `live-session-heartbeat` soft-join    | UPSERT в `live_active_sessions`, выдача `session_key`        |
| Из меню/списка эфиров (по доступу через продукт) | `live-session-heartbeat` soft-join    | UPSERT в `live_active_sessions`, выдача `session_key`        |


Оба пути сходятся в **одной SoT** — `live_active_sessions`. Уникальность по `(user_id, live_event_id) WHERE revoked_at IS NULL` — дубликаты невозможны.

### Изменения

1. `**supabase/functions/live-session-heartbeat/index.ts**` — добавить ветку soft-join:
  - Payload расширить: `live_event_id?: string` (опционально, рядом с `session_key`).
  - Если есть `session_key` и сессия найдена → текущая логика (UPDATE `last_seen_at`).
  - Если `session_key` пустой ИЛИ сессия не найдена, но передан `live_event_id`:
    - Серверная проверка `user_has_live_event_access(user.id, live_event_id)`. Если `false` → `403 access_denied`.
    - Сгенерировать `session_key = crypto.randomUUID()`, `expires_at = now() + 12h`.
    - INSERT ON CONFLICT `(user_id, live_event_id) WHERE revoked_at IS NULL` DO UPDATE SET `last_seen_at = now()`, RETURNING `session_key`.
    - Вернуть `{ status: 'ok', session_key }`.
2. `**src/pages/LiveEvent.tsx**` — в `startHeartbeat`:
  - Если `sessionKey` отсутствует и есть `eventId` и состояние ∈ {`live`, `room_open_waiting`} → первый ping вызывается с `{ live_event_id: eventId }` (без `session_key`).
  - Полученный `session_key` сохранить в `sessionStorage[live_session_${slug}]`.
  - Дальнейшие ping-и идут как сейчас.
  - Если `session_key` уже валиден — soft-join не вызывается.
3. `**live-token-validate**` — без изменений (уже корректно пишет в SoT).
4. **БД** — миграций нет. Уникальный индекс `idx_live_active_sessions_user_event` уже обеспечивает идемпотентность.

### DoD M2

- Пользователь с доступом заходит из **меню эфиров** → в течение ≤25s появляется в Participants.
- Пользователь по **token-link** → появляется в Participants (как сейчас).
- Пользователь **direct /live/:slug** с доступом → появляется в Participants.
- **Вторая вкладка** тем же user_id → запись одна (UNIQUE constraint).
- **Доступа нет** → soft-join возвращает 403, в `live_active_sessions` ничего не появляется.
- Список Participants отражает всех присутствующих, **независимо от пути входа**.

---

## M3 — Live event analytics (history / retention / concurrency)

### Цель

Считать **постфактум-аналитику** эфира по всем, кто реально присутствовал, независимо от пути входа. Источник — отдельная add-only история, **не** `live_active_sessions`.

### Архитектурный принцип

- `live_active_sessions` = **только runtime online** (текущее присутствие).
- `live_view_sessions` = **add-only история** просмотров (каждое посещение — строка с `joined_at` / `left_at` / `duration_sec`).
- `live_session_events` = **add-only лог событий** (`join`, `heartbeat`, `leave`, `timeout`, `event_ended`) для timeline/concurrency.

Без отдельной истории retention/exit points/avg watch time посчитать честно нельзя.

### Миграция (add-only)

```sql
-- История просмотров (1 строка на одно посещение)
CREATE TABLE public.live_view_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES live_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  entry_path text NOT NULL CHECK (entry_path IN ('token','direct','menu','unknown')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  duration_sec integer,
  close_reason text CHECK (close_reason IN ('explicit_leave','inactivity_timeout','event_ended','page_unload','revoked', NULL)),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lvs_event_user ON live_view_sessions(live_event_id, user_id);
CREATE INDEX idx_lvs_event_joined ON live_view_sessions(live_event_id, joined_at);
CREATE INDEX idx_lvs_open ON live_view_sessions(live_event_id) WHERE left_at IS NULL;

-- Лог событий (для timeline/concurrency)
CREATE TABLE public.live_session_events (
  id bigserial PRIMARY KEY,
  view_session_id uuid NOT NULL REFERENCES live_view_sessions(id) ON DELETE CASCADE,
  live_event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('join','heartbeat','leave','timeout','event_ended')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lse_event_time ON live_session_events(live_event_id, occurred_at);

-- RLS: read для staff/owner эфира, write только service role.
```

### Точки фиксации событий


| Момент                 | Триггер                                                                                   | Действие                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **join**               | первый успешный `live-session-heartbeat` (soft-join) или `live-token-validate`            | INSERT в `live_view_sessions` (`joined_at=now`), INSERT event=`join`                       |
| **heartbeat**          | каждый успешный ping (≤25s)                                                               | UPDATE `last_seen_at`, INSERT event=`heartbeat` (раз в 60s, throttle)                      |
| **leave (explicit)**   | `beforeunload` / `pagehide` → `navigator.sendBeacon('/live-session-leave')`               | UPDATE `left_at=now`, `duration_sec`, `close_reason='page_unload'`, INSERT event=`leave`   |
| **inactivity timeout** | cron `live-sessions-sweeper` каждые 2 мин: открытые сессии с `last_seen_at < now - 3 min` | UPDATE `left_at=last_seen_at`, `close_reason='inactivity_timeout'`, INSERT event=`timeout` |
| **event ended**        | при переходе `live_events.status → 'ended'` (триггер)                                     | массовый UPDATE открытых сессий: `left_at=now`, `close_reason='event_ended'`               |


**Закрытие сессии при «просто закрыл вкладку»**: основной механизм — sweeper по `last_seen_at`. `sendBeacon` — best-effort ускорение. Это даёт честную нижнюю границу `duration_sec`.

### Метрики (view + RPC)

`live_event_analytics_v` (вьюха) и `get_live_event_analytics(_event_id)` (RPC):

- `online_now` — count `live_active_sessions` (live).
- `unique_viewers` — count distinct `user_id` из `live_view_sessions`.
- `max_concurrent` — оконно по `live_session_events` (sum joins − sum leaves во времени).
- `total_watch_sec`, `avg_watch_sec` — sum/avg `duration_sec` (для закрытых сессий).
- `avg_retention_pct` — `avg_watch_sec / event_duration`.
- `exit_distribution` — гистограмма `left_at` относительно `event_started_at` (бакеты по 10%).
- `concurrency_timeline` — массив `{ts, concurrent}` для графика.

### Edge functions (новые)

1. `**live-session-leave**` — POST `{ session_key }`. Закрывает текущую открытую `live_view_sessions` (UPDATE `left_at`, `duration_sec`, `close_reason='page_unload'`). Вызывается через `navigator.sendBeacon`.
2. `**live-sessions-sweeper**` — cron (pg_cron каждые 2 мин). Закрывает «зависшие» сессии по `last_seen_at`.

### UI (admin)

**Где выводить**: вкладка «Аналитика» в карточке конкретного эфира `/admin/live-events/:id` (отдельная вкладка, **не** runtime room).

Блоки:

- **Текущие** (live): `online_now`, `unique_viewers (today)`.
- **Итог эфира** (после end): `max_concurrent`, `unique_viewers`, `total_watch_sec`, `avg_watch_sec`, `avg_retention_pct`.
- **Графики**: concurrency timeline (line chart по времени), exit distribution (bar chart по 10%-бакетам).
- **Список текущих участников в runtime-комнате** (Participants tab) — это **другое UI**, остаётся в `/live/:slug`.

### Stop-guards M3

- НЕ смешивать runtime Participants и историческую аналитику в одну таблицу.
- НЕ считать retention из одной `live_active_sessions`.
- НЕ менять access logic — только унифицировать entry tracking **после** успешной проверки доступа.
- НЕ ломать token-flow.
- НЕ трогать `LiveEventRoomBlocks.tsx`, reactions overlay, submit chat/questions, `live-resolve`.

### DoD M3

- Один пользователь зашёл и вышел → `duration_sec` посчитан корректно.
- Двое одновременно → `max_concurrent ≥ 2`.
- Один вышел раньше → retention/exit point зафиксирован в `live_session_events`.
- Token-вход и menu-вход одинаково попадают в `live_view_sessions` (с разным `entry_path`).
- Повторный вход того же пользователя в новой сессии (после закрытия предыдущей) → новая строка в `live_view_sessions`, `unique_viewers` не растёт.
- Параллельная вкладка → `live_view_sessions` идёт по той же `(user_id, live_event_id)` open-row (через `live_active_sessions` UNIQUE), без мусора.
- Принудительное закрытие вкладки → sweeper закрывает в течение ≤3 мин с `close_reason='inactivity_timeout'`.

---

## Финальная структура отчёта (после Execute)

1. **M1**: changed files, mobile-скрины (idle / focused / scroll), desktop без регрессий.
2. **M2**: changed files, contract diagram, по 3 сценария входа (token / direct / menu) → Participants.
3. **M3**: новые таблицы, edge functions, cron, UI-вкладка аналитики, ключевые метрики на тестовом эфире.
4. **Развести**: что показывает runtime Participants vs что сохраняется в аналитике; какие метрики online vs постфактум.
5. **T1 regression**: `T1 checked / no code changes required`.