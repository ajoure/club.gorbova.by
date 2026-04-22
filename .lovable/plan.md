# Да, согласен, с учетом правок:

### **1. По UX лучшее решение**

Для mobile лучше **не переворачивать чат снизу вверх**.  
Оптимальнее:

- оставить порядок сообщений стандартным: **старые сверху, новые снизу**;
- **зафиксировать верхнюю зону**: header + compact video/waiting + reactions + tabs;
- **скроллить только список сообщений**;
- composer оставить **fixed снизу viewport**;
- при открытии вкладки чата делать **auto-scroll к последнему сообщению**;
- если пользователь ушёл вверх по истории и пришли новые сообщения — показывать pill **«Новые сообщения» / «К последним»**, без автопрыжка.

Это лучше, чем реверс списка, потому что:

- не ломает привычную механику чата;
- не усложняет reply/unread/new-message logic;
- desktop и mobile остаются одинаковыми по смыслу;
- меньше риск регрессий.

---

## **Добавление в план — M1.1 mobile chat viewport**

### **M1.1 — mobile-only изоляция скролла чата**

**Цель:** на mobile при чтении чата video-shell, reactions bar и tabs не двигаются; скроллится только список сообщений; composer всегда виден снизу. Desktop без изменений.

### **Изменения**

1. `src/pages/LiveEvent.tsx` (mobile-only ветка `isMobile`):
  - корневой layout: `h-[100dvh] flex flex-col overflow-hidden`;
  - верхняя зона (`header + compact waiting/video + reactions + tabs`) — `flex-shrink-0`;
  - sidebar/chat container — `flex-1 min-h-0 flex flex-col overflow-hidden`;
  - tabs content — `flex-1 min-h-0 flex flex-col`;
  - video-shell и tabs остаются на месте, не участвуют в scroll сообщений.
2. `src/components/live/LiveEventComments.tsx`:
  - `.room-messages-scroll` сделать единственной scroll-area: `flex-1 min-h-0 overflow-y-auto`;
  - при mount вкладки Chat → auto-scroll к последнему сообщению;
  - при новых сообщениях:
    - если пользователь уже у нижнего края (within ~80px) → мягко скроллить вниз;
    - если пользователь ушёл вверх → **не** прыгать, а показать pill `↓ Новые сообщения`;
  - клик по pill → scroll to bottom + hide pill.
3. `src/components/live/LiveEventQuestions.tsx`:
  - та же логика layout: `flex-1 min-h-0` для scroll-area;
  - composer остаётся fixed/sticky как уже реализовано;
  - без реверса списка.
4. `src/components/live/liveRoomTheme.css`:
  - оставить текущую механику fixed composer;
  - убедиться, что `room-messages-scroll` имеет корректный bottom padding под composer;
  - без desktop-изменений.

---

## **Уточнение к DoD для M1.1**

- на mobile video-shell **не двигается** при scroll чата;
- tabs / reactions / header не прыгают;
- composer всегда pinned снизу;
- скролл работает **только** внутри `.room-messages-scroll`;
- при открытии Chat пользователь попадает к последним сообщениям;
- новые сообщения не дёргают экран, если пользователь читает историю — вместо этого появляется pill `Новые сообщения`;
- порядок сообщений остаётся обычным: старые сверху, новые снизу;
- desktop ≥1024px без изменений.

---

## **Что поменять в текущем плане**

### **Этап 1 — Closing M1/M2 + добор M1.1**

В секцию **M1.1 — Mobile-only изоляция скролла чата** добавить:

- **не использовать reverse/chat-from-bottom layout**;
- **верхнюю часть комнаты зафиксировать**, а не делать scroll всей страницы;
- **последние сообщения показывать через auto-scroll-to-bottom**, а не через инверсию списка;
- добавить pill `Новые сообщения` для случая, когда пользователь ушёл вверх по истории.

### **В DoD M1.1 заменить/уточнить:**

вместо идеи “сделать сообщения снизу вверх” зафиксировать:

- **обычная хронология**;
- **локальный scroll списка**;
- **auto-scroll only when already near bottom**;
- **new messages pill when user scrolled away**.

---

## **Короткий блок для вставки в Lovable**

```text
Дополнение к M1.1 (mobile chat viewport):

Не переворачивать порядок сообщений снизу вверх.
Оставить стандартную хронологию:
- старые сообщения сверху
- новые снизу

Проблему mobile UX решить через layout:
1. video-shell / waiting-state / reactions bar / tabs закрепить сверху;
2. composer оставить fixed снизу viewport;
3. скроллить только messages list (`.room-messages-scroll`);
4. при входе во вкладку Chat делать auto-scroll к последнему сообщению;
5. если пользователь ушёл вверх по истории и приходят новые сообщения — не дёргать список, а показывать pill `↓ Новые сообщения` / `К последним`;
6. клик по pill → scroll to bottom + hide.

Почему так:
- видео не уезжает при чтении чата;
- composer всегда доступен;
- UX остаётся стандартным;
- reply/unread/new-message logic не ломается;
- desktop не меняется.

DoD:
- на mobile video-shell не двигается при scroll чата;
- composer pinned снизу;
- tabs/header/reactions не прыгают;
- scroll только внутри списка сообщений;
- Chat открывается на последних сообщениях;
- при scroll вверх новые сообщения показывают pill, без автопрыжка;
- desktop без изменений.

План: Closing M1/M2 + M1.1 mobile chat viewport + M3 analytics + follow-ups
```

## Этап 1 — Closing M1/M2 (live-proof + добор M1.1)

### M1.1 — Mobile-only изоляция скролла чата

**Цель:** на mobile при чтении чата video-shell, reactions bar и tabs не двигаются; скроллится только список сообщений; composer всегда виден снизу. Desktop без изменений.

**Решение по UX:** порядок сообщений НЕ переворачиваем (старые сверху, новые снизу). Проблему решаем layout-механикой, а не реверсом списка.

#### Изменения

1. `**src/pages/LiveEvent.tsx**` — mobile layout (`isMobile === true`):
  - Корневой `<div>`: `h-[100dvh] flex flex-col overflow-hidden` (вместо `min-h-screen`).
  - Header: `flex-shrink-0`, description уже скрыт (M1).
  - Колонка плеера (video + reactions bar): `flex-shrink-0` (фиксированная высота под compact-карточку, не растёт).
  - Sidebar `<Card>`: `flex-1 min-h-0 flex flex-col overflow-hidden` (без `min-h-[60dvh]` на mobile — оставить только desktop-ветке).
  - Внутри Card: TabsList `flex-shrink-0` sticky top-0; TabsContent `flex-1 min-h-0 flex flex-col`.
2. `**src/components/live/LiveEventComments.tsx**` и `**LiveEventQuestions.tsx**`:
  - Контейнер сообщений `room-messages-scroll` уже `overflow-y-auto` — добавить `flex-1 min-h-0` для корректного flex-сжатия внутри Card.
  - Composer уже `.room-composer` (fixed bottom mobile / sticky desktop) — без изменений.
  - **Auto-scroll-to-bottom**: при первом mount + при поступлении новых сообщений, **если** пользователь уже находится у нижнего края (within ~80px). Если нет — НЕ дёргать список.
  - **«Новые сообщения» pill**: when пользователь ушёл вверх и пришло новое сообщение → показать кнопку поверх списка (absolute bottom-20 right-4): «↓ Новые сообщения». Клик → scroll to bottom + скрыть pill. Скрывать также при ручном scroll-to-bottom.
3. `**src/components/live/liveRoomTheme.css**`:
  - Убедиться, что `.room-messages-scroll` имеет `padding-bottom` под fixed composer (уже сделано через `--room-composer-h`).
  - Никаких изменений desktop-веток.

#### DoD M1.1

- 375×812 mobile: video-shell не двигается при scroll чата.
- composer всегда виден снизу (fixed).
- tabs / header / reactions bar не прыгают.
- Скролл работает только внутри `.room-messages-scroll`.
- При входе во вкладку Chat — auto-scroll к последнему сообщению.
- При scroll вверх + входящие новые → показывается pill «Новые сообщения», без принудительного прыжка.
- Desktop ≥1024px: визуально и функционально без изменений.
- Порядок сообщений: старые сверху, новые снизу (не реверс).

### M1 + M2 live-proof package

После доработки M1.1:

1. **M1/M1.1 live-proof:**
  - Screenshot 375×812 idle (waiting-state): видны header / compact card / reactions / tabs / composer.
  - Screenshot 375×812 focused composer: composer над клавиатурой, video-shell сверху не двигается.
  - Screenshot 375×812 scroll state: длинный список сообщений, composer pinned.
  - DOM proof: `.room-composer` имеет `position: fixed` на mobile; `.room-messages-scroll` — единственный `overflow-y-auto` ancestor.
2. **M2 live-proof (4 сценария + edge cases):**
  - **Token-link** `/live-access/:token` → `live_active_sessions` row exists (SQL count = 1 для user/event).
  - **Direct `/live/:slug**` (admin/staff/owner) → row создана через soft-join, `session_key` сохранён в `sessionStorage`.
  - **Из меню эфиров** (entry_path передаётся) → row создана, `entry_path='menu'` (поддержка добавится в M3 — см. ниже).
  - **Вторая вкладка** того же user → SQL `count(*) = 1` (UNIQUE constraint).
  - **Без доступа** → soft-join возвращает `403 access_denied`, `live_active_sessions` пустой.
  - **Participants tab**: один и тот же admin виден независимо от пути входа.
  - Network proof: capture `live-session-heartbeat` request/response для каждого сценария.

**Files to edit (Этап 1):** `src/pages/LiveEvent.tsx`, `src/components/live/LiveEventComments.tsx`, `src/components/live/LiveEventQuestions.tsx`, `src/components/live/liveRoomTheme.css`.

---

## Этап 2 — M3 Analytics (после закрытия Этапа 1)

### Архитектура (как утверждено ранее)

- `live_active_sessions` = только runtime online.
- `live_view_sessions` = add-only история посещений (server-only write).
- `live_session_events` = add-only лог (`join`/`heartbeat`/`leave`/`timeout`/`event_ended`).

### Миграция (add-only)

```sql
CREATE TABLE public.live_view_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_event_id uuid NOT NULL REFERENCES live_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  entry_path text NOT NULL DEFAULT 'direct'
    CHECK (entry_path IN ('token','direct','menu','unknown')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  duration_sec integer,
  close_reason text CHECK (close_reason IN
    ('explicit_leave','inactivity_timeout','event_ended','page_unload','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_lvs_open_per_user_event
  ON live_view_sessions(user_id, live_event_id) WHERE left_at IS NULL;
CREATE INDEX idx_lvs_event_joined ON live_view_sessions(live_event_id, joined_at);

CREATE TABLE public.live_session_events (
  id bigserial PRIMARY KEY,
  view_session_id uuid NOT NULL REFERENCES live_view_sessions(id) ON DELETE CASCADE,
  live_event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN
    ('join','heartbeat','leave','timeout','event_ended')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lse_event_time ON live_session_events(live_event_id, occurred_at);

-- RLS: read для staff/owner эфира, write только service_role.
```

Триггер закрытия при `live_events.status → 'ended'`: массовый UPDATE открытых rows + INSERT events.

### Edge functions

1. `**live-session-heartbeat**` (расширить):
  - Soft-join: при создании новой `live_active_sessions` row → INSERT в `live_view_sessions` (через UNIQUE-guard `WHERE left_at IS NULL`) + INSERT event=`join`. Принимать `entry_path` (`token`/`direct`/`menu`).
  - Heartbeat-mode: UPDATE `last_seen_at` в обеих таблицах. INSERT event=`heartbeat` throttle 60s (проверять `MAX(occurred_at)` по open session).
  - Idempotency: `join` event — только при инсёрте новой open-row.
2. `**live-session-leave**` (новая, `verify_jwt = false`, валидация JWT в коде):
  - POST `{ session_key }`. UPDATE open `live_view_sessions`: `left_at=now`, `duration_sec`, `close_reason='page_unload'`. INSERT event=`leave` (только если `left_at IS NULL` до update).
  - Вызов через `navigator.sendBeacon` на `pagehide` / `beforeunload`.
3. `**live-sessions-sweeper**` (новая, cron pg_cron каждые 2 мин):
  - Закрывает open-rows с `last_seen_at < now() - interval '3 min'`: `left_at = last_seen_at`, `close_reason='inactivity_timeout'`. INSERT events=`timeout`.
4. `**live-token-validate**` (расширить):
  - При создании `live_active_sessions` row → также INSERT в `live_view_sessions` с `entry_path='token'`.

### Client

1. `**src/pages/LiveEvent.tsx**`:
  - При soft-join передавать `entry_path` (определяется по navigation source: если referrer = `/menu/live` → `'menu'`, иначе `'direct'`).
  - На `useEffect` cleanup + `pagehide` listener → `navigator.sendBeacon('/functions/v1/live-session-leave', { session_key })`.

### Метрики — RPC `get_live_event_analytics(_event_id uuid)`

Возвращает:

- `online_now` — count `live_active_sessions` (revoked_at IS NULL, last_seen_at > now-2min).
- `unique_viewers` — count distinct `user_id` from `live_view_sessions`.
- `max_concurrent` — оконно по `live_session_events` (running sum: +1 на join, −1 на leave/timeout/event_ended), возвращает MAX. Источник истины — events, не snapshots.
- `total_watch_sec`, `avg_watch_sec` — sum/avg `duration_sec` (только closed sessions).
- `avg_retention_pct` — `avg_watch_sec / event_duration_sec`. **NULL** если `live_started_at` или `webinar_completed_at` отсутствуют.
- `exit_distribution` — гистограмма `(left_at − live_started_at) / event_duration` по 10%-бакетам. **NULL** если duration недоступен.
- `concurrency_timeline` — массив `{ts, concurrent}`.

### UI — admin analytics tab

**Где:** `src/pages/admin/LiveEventDetail.tsx` (или эквивалент) → новая вкладка **«Аналитика»** (read-only, отдельно от Participants).

**Блоки:**

- Live-блок: `online_now`, `unique_viewers (today)`.
- Итог эфира (после end): `max_concurrent`, `unique_viewers`, `total_watch_sec`, `avg_watch_sec`, `avg_retention_pct` (либо «—» если NULL).
- Графики: concurrency timeline (recharts LineChart), exit distribution (BarChart).
- Если `live_started_at IS NULL` → показать «Аналитика будет доступна после старта эфира».

### Stop-guards M3

- НЕ смешивать runtime Participants и историческую аналитику в одну таблицу.
- НЕ считать retention из `live_active_sessions`.
- `live_view_sessions` / `live_session_events` пишутся **только** server-side (edge / cron / trigger). UI пишет напрямую — запрещено.
- НЕ ломать token-flow.
- НЕ менять access logic (только entry tracking после успешной access-проверки).

### DoD M3

- Один user joined+left → `duration_sec` корректен, события `join`+`leave` записаны.
- Двое одновременно → `max_concurrent ≥ 2`.
- Один вышел раньше → exit point в `live_session_events`.
- Token и menu/direct входы → одинаково в `live_view_sessions`, разный `entry_path`.
- Повторная вкладка тем же user → одна open-row (UNIQUE), `unique_viewers` не растёт.
- Закрытие вкладки без leave → sweeper закрывает в ≤3 мин с `close_reason='inactivity_timeout'`.
- Event ended → массово закрывает open-rows, нет хвостов `left_at IS NULL`.
- Если эфир не стартовал → `avg_retention_pct = NULL`, `exit_distribution = NULL` (не псевдозначения).

**Files to add/edit (Этап 2):**

- Migration: `live_view_sessions`, `live_session_events`, RLS, trigger on `live_events.status`, RPC `get_live_event_analytics`, pg_cron job.
- Edge: `live-session-leave/index.ts` (new), `live-sessions-sweeper/index.ts` (new), `live-session-heartbeat/index.ts` (extend), `live-token-validate/index.ts` (extend).
- Client: `src/pages/LiveEvent.tsx` (entry_path + sendBeacon).
- Admin UI: новая вкладка «Аналитика» в карточке эфира + компонент с recharts.

---

## Этап 3 — Follow-ups (отдельным PATCH после Этапа 2)

Не смешивать с M1/M2/M3. Делать только после закрытия Этапа 2.

1. **Reactions overlay fade-out live proof**: before/after screenshots серии реакций, DOM-proof `.reaction-float` lifecycle (0 → ≥1 → 0).
2. **Player stability live proof**: mount-counter в video-shell (временный `useRef` counter в console), доказать отсутствие remount при tabs/reactions/chat updates.
3. **Non-staff Participants live proof**: войти под обычным user → виден в Participants без staff fields (real_name_for_staff = null).
4. **Финальный room proof-pack**: сводная таблица «runtime vs analytics», разведение что показывает где.

---

## Финальная структура отчёта

После каждого этапа отдельный отчёт со структурой:

1. Что сделано.
2. Файлы изменены.
3. Diff-summary.
4. Live proof (screenshots/DOM/network).
5. Code/SQL proof.
6. Что вынесено в follow-up.
7. T1 regression: `T1 checked / no code changes required`.