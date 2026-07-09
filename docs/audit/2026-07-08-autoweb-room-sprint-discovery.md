# Discovery — Автовебинарная комната (Фаза 0)

Дата: 2026-07-08. Read-only аудит перед реализацией спринта (docs/audit/… по плану `.lovable/plan.md`).

> **Gate:** без утверждения этого отчёта переход к Фазе A запрещён.
> Все выводы получены read-only обзором репозитория; изменений кода/БД не вносилось.

---

## 1. Runtime start / lifecycle автовебинаров

**Что есть:**
- `live-event-lifecycle` (277 строк) — единая edge-функция управления lifecycle
  `live_events`: пишет `room_opened_at`, `live_started_at`, `webinar_completed_at`,
  `room_state`, `platform_status` (см. `supabase/functions/live-event-lifecycle/index.ts:217, 227, 242`).
- `autoweb-create-personal-session` — создание personal-session (JIT/on_demand/one_time),
  для one_time `startsAt = event.scheduled_at` (`index.ts:100-102`). Есть dedup.
- `autoweb-generate-occurrences` — cron-подобная генерация scheduled-сессий по RRULE
  (`autoweb_config.schedule.rrules`).
- `autoweb-room-state` — **pure read-only** resolver, ZERO writes. Считает фазу
  из `starts_at + duration_seconds` (`autoweb-room-state/index.ts:69-104`).

**Gaps:**
- Нет **self-heal** авто-старта эфира в runtime для автовебинара:
  `live_started_at` пишется только через `live-event-lifecycle` (staff action),
  а `autoweb-room-state` фазу считает чисто по clock — реального события "видео стартовало"
  нет как факта в БД.
- Нет guard'а против двойного запуска сценария (сценарий пока не имеет runtime,
  только read через `get_live_event_scenario`).
- Нет фиксации фактического playback-start (см. §4).

**Reuse-plan для Фазы A:**
- Расширить `autoweb-room-state` (или добавить `autoweb-room-heartbeat`) с idempotent
  "auto-open room" / "auto-start webinar" транзакцией на service-role, вызываемой из
  клиента при phase→live. Ключи идемпотентности: `session.id` + фазовые метки.
- Cron-worker (существующая инфраструктура cron/`autoweb-generate-occurrences`) —
  ускоритель, не SoT.

---

## 2. Edge-контур autoweb-*

| Функция | Роль | LOC | Пишет в БД? |
|---|---|---|---|
| `autoweb-room-state` | phase compute + viewer_controls | 213 | нет |
| `autoweb-create-personal-session` | dedup + insert session | 216 | да (INSERT session) |
| `autoweb-resolve-sessions` | list scheduled/JIT/on_demand | 168 | нет |
| `autoweb-generate-occurrences` | RRULE → session rows | 264 | да (bulk INSERT) |

Контракт зафиксирован в `supabase/functions/_shared/autoweb-types.ts` и зеркалится
клиентом через `src/types/autoweb.ts`.

**Gap:** нет функции для фиксации playback-событий (video_started, video_ended,
autoplay_blocked) и для auto-transition в `webinar_completed_at`.

---

## 3. Kinescope integration

**Что есть (`AutowebRoomRuntime.tsx:58-181`):**
- Iframe-плеер с параметрами: `autoplay=1`, `hotkeys/controls/speed/settings` — по
  `viewer_controls`; `subtitles/captions/pip=false`.
- Overlay-guard'ы на нижние 72px (timeline) и центр (pause) при `allow_seek=false`
  / `allow_pause=false`.
- `postMessage` listener читает `currentTime` (`AutowebRoomRuntime.tsx:100-121`).
- **Fallback** — монотонный интервал 1s от `startSeconds` (`AutowebRoomRuntime.tsx:123-137`).

**Gaps:**
- `@kinescope/react-kinescope-player` SDK **не подключён**; работаем только через iframe.
  Для точного late-join и захвата `play/pause/seek` событий нужен SDK
  (см. backlog `.lovable/backlog/autoweb-source-selector-and-nested-history-tabs.md` §4-5).
- Нет захвата **фактического** playback-start (нужен для autoplay-fallback CTA).
- Нет `autoplay_blocked` события (§4).

**Reuse-plan (Фаза B):**
- Оставить iframe как base, добавить lightweight SDK-обёртку опционально
  для событий play/pause/timeupdate.
- Экспортировать `onPlaybackStart` наверх, чтобы сценарий/фаза `live`
  ждали фактического старта, а не wall-clock.

---

## 4. Scenario runtime + timed comments/CTA

**Что есть:**
- RPC `get_live_event_scenario` (используется в `LiveEventScenario.tsx:44`) —
  read-only список ивентов.
- Таблица `live_event_timeline_events` (10 полей).
- `AutowebTimelineOverlay.tsx` — placeholder-слой, real-render **не реализован**.
- `LiveEventScenario` рендерит список без синхронизации с playback time.

**Gaps (главные):**
- **Нет** timed-runtime: comments/CTA не всплывают "в момент таймкода".
- Нет единого SoT playback time (клиент считает свой `playbackSeconds`,
  но никто из scenario-компонентов его не потребляет).
- Кнопки CTA (`live_event_product_cta_bindings`, `live_event_cta_runtime_events`)
  живут по другой lifecycle-модели.

**Reuse-plan (Фаза B/C):**
- Прокинуть `playbackSeconds` из `AutowebRoomRuntime` → в scenario/CTA
  через новый общий hook `useTimedScenarioReplay(sourceEventId, playbackSeconds)`.
- Source-of-content: `source_live_event_id` (без клонирования — жёсткий инвариант).

---

## 5. Viewer counters

**Что есть:**
- `RoomParticipantsList.tsx` использует `useRoomParticipants(liveEventId)` →
  RPC `get_room_participants` (server-side privacy filter).
- `live_active_sessions` (12 полей) — реальные активные сессии.
- Настройка `room_settings.participants.visible_for_students` уже существует.

**Gaps:**
- Нет разделения **реальных** и **отображаемых** зрителей для autoweb.
- Нет simulated-viewers presentation-слоя (§9 плана заказчика).
- Нет фильтрации admin/moderator/test-mode из реальной метрики для staff.

**Reuse-plan (Фаза C):**
- Detach отображаемой цифры от реальной. Simulated — deterministic по
  `session_id + wall_time_bucket` (без fake sessions).
- Настройки в `autoweb_config.viewer_display.{ enabled, target_count, curve }`.

---

## 6. Replay access logic

**Точки, где сейчас проверяется доступ к записи:**
1. Пользовательский список эфиров (`live-events-list`).
2. Роут `/live/:slug` → `live-resolve` (588 LOC, самый объёмный gate).
3. Invite/direct links (`live_access_links`, `live_access_proofs`, `live-token-validate`).
4. `autoweb-room-state` — не проверяет replay-access как отдельный флаг, а считает
   `replay_ends_at`.

**Gap:**
- Тумблер "Разрешить доступ к записи после завершения" на серверном gate
  прослеживается частично; нужно явно проверить в `live-resolve` и `live-events-list`,
  что он полностью закрывает точки 1-3 при выключении.

**Reuse-plan (Фаза D):**
- Отдельный regression-check под §16 плана — не создавать новых gate'ов,
  дополнить существующие.

---

## 7. Chat / Questions merge

**Что есть:**
- `LiveEventComments` и `LiveEventQuestions` принимают:
  - `historySourceEventId`, `historySourceStartedAt` — исторический fetch
  - `currentPlaybackSeconds` — cutoff по таймкоду
  - `autowebSessionId` — куда писать live-сообщения
  - `staffSourceIndicator` — маркер для staff
- Merge history+live уже реализован (backlog §3 подтверждает наличие prop
  `staffSourceIndicator`, но без визуального badge).

**Gaps:**
- Нет **изоляции чата** (§11 плана) — обычный зритель видит live-сообщения других.
- Historical stream не уважает изоляцию.
- Answered-state для исторических вопросов открыт (backlog §6).

**Reuse-plan (Фаза C):**
- Добавить `autoweb_config.chat_isolation.enabled` (не новый механизм — флаг).
- Server-side фильтр: `visible_to_user_id = auth.uid()` в RPC ленты чата
  при активной изоляции.

---

## 8. Test/admin-only pathways

**Что есть:**
- `role === "admin" | "superadmin" | "employee"` детектится в `AutowebRoomRuntime.tsx:226`.
- Staff видит tab "Модерация" и `staffSourceIndicator`.

**Gaps:**
- Нет **test-mode** (§14 плана): нет отдельного query-параметра / кнопки
  "запустить тестовый прогон", нет изоляции от реальных counters/comments.

**Reuse-plan (Фаза D):**
- Query-param `?test=1` при staff-роли → runtime использует overrides
  `viewer_controls`, не пишет в live_event_comments/_questions/_participants
  реального эфира, не увеличивает `live_active_sessions`.

---

## 9. Audit hooks

**Что есть:**
- Таблица `audit_logs` (10 полей, 3 policies).
- Прямых client-insert в audit_logs из client-кода не обнаружено (быстрый rg —
  все инсерты за service-role edge functions).

**Reuse-plan (сквозной аудит):**
- Все новые audit-события пишутся через существующие edge-функции
  (`live-event-lifecycle` расширить типами `auto_room_opened`,
  `auto_webinar_started`, `video_started`, `autoplay_blocked`, `scenario_started`,
  `scenario_completed`, `webinar_ended`, `source_unavailable`, `replay_toggled`).
- Клиентский insert в audit_logs остаётся запрещённым.

---

## Итоговая карта SoT (для Фазы A/B)

| Контур | Поле/источник | Куда пишет | Кто читает |
|---|---|---|---|
| **room** | `live_events.room_state, room_opened_at, webinar_completed_at` | `live-event-lifecycle` | `live-resolve`, `autoweb-room-state` (частично) |
| **event** | `live_events.live_started_at, platform_status` | `live-event-lifecycle` | все read-paths |
| **player** | client-state `playbackSeconds` + `postMessage` | client-only (сейчас) | `AutowebRoomRuntime` |
| **scenario** | `live_event_timeline_events` (source_live_event_id) | staff editor | `LiveEventScenario` (пока read-only, без runtime) |

**Проблема:** player-state пока чисто client-only и не персистится; для late-join
и resume нужен `live_event_sessions.metadata.last_position` (уже читается
`autoweb-room-state:175`, но никто не пишет).

---

## Список конкретных точек изменения (proposal для Фаз A-D)

### Фаза A
- `supabase/functions/autoweb-room-state/index.ts` — добавить idempotent
  self-heal: при phase→live обновить `live_events.live_started_at` через
  service-role, если пусто (guard: только для `event_type='autowebinar'`).
- `live-event-lifecycle` — принять новые типы событий (video_started,
  autoplay_blocked, scenario_started/completed, webinar_ended, replay_toggled)
  с audit-записью.

### Фаза B
- `AutowebRoomRuntime.tsx` — экспорт `onPlaybackStart` наверх, gating сценария
  на реальный playback-start.
- Новый hook `useAutoplayFallback` — детект autoplay-block, render CTA.
- Persist `last_position` через новую edge `autoweb-session-heartbeat`
  (либо reuse `live-session-heartbeat` с расширением).

### Фаза C
- Новый hook `useTimedScenarioReplay(sourceEventId, playbackSeconds)`.
- `autoweb_config.chat_isolation` + server-side RPC-filter в чате.
- `autoweb_config.viewer_display` + deterministic simulated-count функция
  (pure compute, без записей).

### Фаза D
- `live_events.launches_end_at` — nullable timestamp, gate в
  `autoweb-create-personal-session`.
- Regression по replay-toggle в `live-resolve` и `live-events-list`.
- Editor-CRUD для timeline_events через существующий admin UI
  (`AdminLiveEvents.tsx` + новые sub-компоненты).
- Test-mode query-param + guards.

---

## Reuse vs new — доказательства

| Нужно | Reuse (существует) | New (только если reuse невозможен) |
|---|---|---|
| lifecycle state | `live_events.room_state/*_at`, `live-event-lifecycle` | — |
| viewer_controls | `autoweb_config.viewer_controls` | — |
| history chat | `historySourceEventId`, `currentPlaybackSeconds` | — |
| chat isolation | `autoweb_config.chat_isolation` (флаг) | server-side filter в существующей RPC ленты |
| simulated viewers | — | pure compute (без таблицы), только presentation |
| launches_end_at | — | новая колонка `live_events.launches_end_at` |
| test mode | staff role detect | query-param + client gate + server-side skip-writes |
| audit | `audit_logs` + existing edge-writers | новые enum-типы событий |

Новые сущности: **только** `launches_end_at` (одна колонка) и enum audit-типы.
Ни новых таблиц сценариев/viewers/lifecycle/viewer_controls, ни параллельного runtime.

---

## 10. State → SoT → Trigger → UI label (4 контура)

Явный mapping backend field / edge response / runtime signal → UI-состояние.
Смешивание `room_open`, `video_playing`, `live` — запрещено.

### 10.1 Room (комната)

| State | SoT (поле/источник) | Trigger (что меняет) | UI label |
|---|---|---|---|
| `closed` | `live_events.room_state IS NULL` OR `'closed'` | `live-event-lifecycle` action `close_room` | «Комната закрыта» |
| `opening` | edge in-flight (transient, не в БД) | client вызвал self-heal open, ответа ещё нет | «Открываем комнату…» |
| `open` | `live_events.room_state='open'` + `room_opened_at IS NOT NULL` | `live-event-lifecycle` action `open_room` (или autoweb self-heal при phase→pre_show/live) | «Комната открыта» |
| `ended` | `live_events.webinar_completed_at IS NOT NULL` | `live-event-lifecycle` action `end_webinar` (или autoweb self-heal при phase→ended) | «Эфир завершён» |

**Инвариант:** `room=open` НЕ означает `event=live`.

### 10.2 Event (эфир)

| State | SoT | Trigger | UI label |
|---|---|---|---|
| `scheduled` | `live_events.platform_status='scheduled'` AND `live_started_at IS NULL` | initial | «Запланирован на …» |
| `pre_show` | `autoweb-room-state.phase='pre_show'` (compute из `starts_at`) | clock | «Скоро начнём» |
| `starting` | phase=live AND `live_started_at IS NULL` AND нет подтверждённого playback | autoweb-room-state → self-heal in-flight | «Подключаемся к трансляции…» |
| `live` | `live_events.live_started_at IS NOT NULL` AND (`player.playback_started=true` OR `event.fallback_state='autoplay_blocked'`) | self-heal edge writes `live_started_at` **только** после player confirm / autoplay_blocked | «В эфире» |
| `replay` | `autoweb-room-state.phase='replay'` AND `replay_ends_at > now()` AND `replay_access_enabled=true` | clock + `autoweb_config.replay.enabled` | «Запись доступна» |
| `ended` | `webinar_completed_at IS NOT NULL` OR phase='ended' | self-heal / lifecycle | «Завершён» |

**Guard (hard):** `event.state='live'` **запрещён** без одного из:
- `player.playback_started=true` (пришёл `video_started` из player),
- `player.fallback_state='autoplay_blocked'` (явный fallback после N сек ожидания).

### 10.3 Player (плеер)

| State | SoT | Trigger | UI label |
|---|---|---|---|
| `idle` | client-state, до mount iframe | initial | «—» |
| `loading` | iframe mounted, no `postMessage` yet | postMessage listener attached | «Загрузка видео…» |
| `ready` | получен первый `postMessage` без `currentTime>0` | Kinescope SDK/postMessage | «Готов к воспроизведению» |
| `playing` | `currentTime` растёт монотонно (>2 tick) OR `postMessage:play` | player event | «Идёт трансляция» |
| `paused` | `postMessage:pause` (только если `allow_pause=true`) | player event | «Пауза» |
| `autoplay_blocked` | нет `currentTime>0` в течение 3s после mount + browser policy | timeout detector | «Нажмите, чтобы начать» |
| `ended` | `postMessage:ended` OR `currentTime >= duration - 1` | player event | «Видео завершено» |

**Инвариант:** `player.state='playing'` — **единственный** сигнал, разрешающий записать `live_started_at`. Wall-clock — fallback только для `scenario` при `autoplay_blocked`.

### 10.4 Scenario (сценарий)

| State | SoT | Trigger | UI label |
|---|---|---|---|
| `idle` | нет активного playback | initial | «—» |
| `armed` | `player.state='ready'` AND есть timeline_events для `source_live_event_id` | player ready | «Сценарий готов» |
| `running` | `player.state='playing'` AND `playbackSeconds` растёт | first playback tick после armed | «Сценарий идёт» |
| `paused` | `player.state='paused'` | player pause | «Сценарий на паузе» |
| `completed` | последний timeline event проигран OR `player.state='ended'` | last tick | «Сценарий завершён» |

**Guard (hard):** `scenario.state='running'` **запрещён** до подтверждённого `player.state='playing'` (не по wall-clock, не по `event.state`).

### 10.5 Сводные lifecycle-guards (закрепление)

1. `scenario_start` — запрещён до подтверждённого `player.state='playing'`.
2. `event.state='live'` — запрещён без `player.playback_started=true` ИЛИ явного `fallback_state='autoplay_blocked'`.
3. `room.state='open'` ≠ `event.state='live'` — независимые контуры, не путать в UI/telemetry.
4. Любая запись `live_started_at` из self-heal edge — только после one из guard-условий выше.

---

## 11. Proof-матрица для Фазы A (4 режима)

Фаза A **не принимается** по одному режиму — только все 4 зелёные.

| Режим | Сценарий | Ожидаемый lifecycle | Proof |
|---|---|---|---|
| **one_time** | 1 общий session, `starts_at=scheduled_at` | pre_show → live (self-heal на phase→live) → ended | SQL: `live_started_at` записан один раз; audit `auto_webinar_started` есть; повторный вход не создаёт дубль записи |
| **scheduled** | RRULE, viewer выбирает slot | pre_show → live (per-session) → ended → replay (если enabled) | SQL: каждая session независимо получает `live_started_at`; нет race между 2 sessions одного event |
| **just_in_time** | offset_minutes 5/10/15 | create_personal_session → pre_show → live | SQL: dedup работает (повторный клик тот же session_id); self-heal триггерится по своему `starts_at` |
| **on_demand** | «Начать сейчас» | create_personal_session → immediate pre_show (короткий) → live | SQL: `starts_at ~ now()+min_delay`; self-heal ждёт `min_delay_seconds`; нет double-start после refresh |

Каждый режим требует screencast + SQL snapshot + audit log slice.

---

## 12. Self-heal — контракт идемпотентности

**Идемпотентный ключ старта:** `(live_events.id, live_event_sessions.id, 'auto_webinar_started')`.

**Где хранится факт "auto-start уже выполнен":**
- `live_events.live_started_at IS NOT NULL` — глобальный факт для one_time.
- `live_event_sessions.metadata->>'auto_started_at' IS NOT NULL` — per-session факт для scheduled/JIT/on_demand.
- `audit_logs` с `(entity_id=session_id, action='auto_webinar_started')` — единственная запись при UNIQUE partial index.

**Исключение double-start:**
1. Self-heal edge выполняется в транзакции `SELECT … FOR UPDATE` на `live_event_sessions.id`.
2. Проверка `metadata->>'auto_started_at' IS NULL` внутри lock — если уже стоит, no-op + return existing.
3. Client: single-flight по `session_id` (React ref-lock на время in-flight запроса).
4. Multi-tab: BroadcastChannel `autoweb-self-heal:${sessionId}` — второй таб ждёт результат первого.
5. Service restart: транзакция атомарна; при падении между write и commit — retry увидит NULL и повторит корректно.

**Что запрещено:** писать `live_started_at` из client, писать без FOR UPDATE lock, писать без player.playback_started (кроме fallback path).

---

## 13. Viewer counters — separation contract

Три независимых счётчика, никакой interference.

| Счётчик | Источник | Может писать? | Может читать? | Ограничения |
|---|---|---|---|---|
| **real viewers** | `live_active_sessions` WHERE `live_event_id=… AND last_seen_at > now()-90s` | write: только `live-session-heartbeat` (existing) | read: staff-only RPC + backend metrics | не показывается зрителю напрямую в autoweb-режиме |
| **displayed viewers** | pure compute: `max(real_viewers, simulated_target)` | нигде не пишется (compute-only) | read: `autoweb-room-state` response field `displayed_viewer_count` | UI-label «Смотрят сейчас: N» — единственная цифра для зрителя |
| **simulated viewers** | pure function `simulate(session_id, wall_time, curve)` из `autoweb_config.viewer_display` | **никогда не пишется в БД**, никаких fake sessions/participants | read: только через `displayed` compute | deterministic по seed, curve — из config |

**Жёсткий запрет:**
- Simulated НЕ вставляет строки в `live_active_sessions`, `live_event_participants`, `live_event_comments`.
- Real counter НЕ фильтрует staff/test-mode для внутренних метрик (staff-фильтр — только для UI zрителя).
- Displayed НЕ логируется как «real» ни в audit, ни в analytics.

---

## 14. Replay access — полный gate-check матрица

Точки проверки `replay_access_enabled` (тумблер `autoweb_config.replay.enabled` / `live_events.replay_access_enabled`):

| # | Точка | Файл/функция | Что делает при OFF |
|---|---|---|---|
| 1 | Список эфиров (user) | `live-events-list` edge | не отдаёт event в `replay` phase |
| 2 | Роут `/live/:slug` | `live-resolve` edge | 403 / redirect на «запись недоступна» |
| 3 | Token/invite path | `live-token-validate` + `live_access_links` | invalidate replay-token, 410 Gone |
| 4 | Edge resolve autoweb | `autoweb-resolve-sessions` | скрывает past sessions из scheduled/JIT lists |
| 5 | Autoweb late entry after end | `autoweb-room-state` | phase→`ended` вместо `replay`; viewer_controls=frozen |
| 6 | Direct session URL после end | `autoweb-room-state` (session_id path) | 403 в response, client показывает «Эфир завершён» |

**Приёмка Фазы D:** каждая из 6 точек должна быть проверена SQL + curl + UI screenshot. Частичное закрытие = red.

---

## 15. Audit events — конкретный список по фазам

Все события пишутся **только** через edge-functions с service-role. Client-insert запрещён (verified в §9).

### Фаза A

| Event type | Когда пишем | Чем пишем | Proof |
|---|---|---|---|
| `auto_room_opened` | self-heal открыл room | `autoweb-room-state` (self-heal branch) | audit row + `room_opened_at` set |
| `auto_webinar_started` | self-heal записал `live_started_at` | `autoweb-room-state` | audit row + `live_started_at` set + `metadata.auto_started_at` |
| `self_heal_noop` | self-heal вызван, но факт уже был | `autoweb-room-state` | audit row без изменения БД |

### Фаза B

| Event type | Когда | Чем | Proof |
|---|---|---|---|
| `video_started` | player выдал первый `currentTime>0` | новая edge `autoweb-session-heartbeat` (event=video_started) | audit + `metadata.playback_started_at` |
| `autoplay_blocked` | 3s timeout без playback | `autoweb-session-heartbeat` | audit + `metadata.fallback_state=autoplay_blocked` |
| `resume_from_position` | late-join восстановил `last_position` | `autoweb-session-heartbeat` | audit с `last_position` в payload |

### Фаза C

| Event type | Когда | Чем | Proof |
|---|---|---|---|
| `scenario_started` | first timeline event сработал | `live-event-lifecycle` (расширить) | audit + `metadata.scenario_started_at` |
| `scenario_completed` | последний timeline event | `live-event-lifecycle` | audit |
| `chat_isolation_activated` | конфиг изменён на enabled=true | admin editor edge | audit |

### Фаза D

| Event type | Когда | Чем | Proof |
|---|---|---|---|
| `webinar_ended` | auto-transition в ended | `autoweb-room-state` self-heal | audit + `webinar_completed_at` set |
| `replay_toggled` | admin переключил replay access | admin editor edge | audit с before/after |
| `launches_end_at_set` | admin закрыл дальнейшие старты | admin editor edge | audit |
| `source_unavailable` | source_live_event_id недоступен для autoweb | `autoweb-room-state` | audit + phase=ended graceful |
| `test_mode_session_started` | staff запустил `?test=1` | `autoweb-create-personal-session` (test branch) | audit + session помечена `metadata.test=true` |

---

## 16. Reuse confirmed / New entities proposed (по каждому элементу)

### Reuse confirmed (existing, no new entity)

| Элемент | Existing артефакт | Как используем |
|---|---|---|
| lifecycle transitions | `live-event-lifecycle` edge + `live_events.*_at` columns | расширяем action-types, не создаём новый lifecycle |
| viewer_controls | `autoweb_config.viewer_controls` JSONB | читаем как есть, добавляем только новые ключи (не таблицу) |
| session dedup | `autoweb-create-personal-session` + unique index | reuse, расширяем test-mode branch |
| chat history merge | `historySourceEventId` + `currentPlaybackSeconds` props | reuse, добавляем isolation-фильтр в существующую RPC |
| audit writes | `audit_logs` + edge-writer pattern | reuse таблицу, расширяем enum action-types |
| replay gate | `live-resolve`, `live-events-list`, `live-token-validate` | reuse, добавляем 3 недостающие проверки, не новую систему |
| room participants | `get_room_participants` RPC | reuse, добавляем staff-фильтр `exclude_test_mode` |
| RRULE occurrences | `autoweb-generate-occurrences` | reuse без изменений |

### New entities proposed (unavoidable — с обоснованием каждой)

| Новая сущность | Тип | Обоснование неизбежности |
|---|---|---|
| `live_events.launches_end_at` | column (timestamp nullable) | нет существующего поля для "закрыть новые старты, но сохранить replay"; `platform_status='ended'` слишком грубо (закрывает и replay); альтернатива — JSONB-флаг в autoweb_config, но нужен index-lookup из hot-path `autoweb-create-personal-session` |
| audit action enum: `auto_room_opened`, `auto_webinar_started`, `video_started`, `autoplay_blocked`, `scenario_started/completed`, `webinar_ended`, `replay_toggled`, `launches_end_at_set`, `source_unavailable`, `test_mode_session_started`, `resume_from_position`, `self_heal_noop`, `chat_isolation_activated` | enum values | audit_logs требует typed action; переиспользовать generic `updated` теряет observability и ломает поиск по audit |
| `autoweb-session-heartbeat` edge | function | нужна server-side точка для приёма playback-событий (video_started, autoplay_blocked, resume position); reuse `live-session-heartbeat` невозможен — он live-only, разные грант-модели и разные payload-контракты |
| `autoweb_config.chat_isolation` | JSONB sub-key | флаг, а не таблица; читается server-side RPC чата; альтернатив нет — нужен per-event toggle |
| `autoweb_config.viewer_display` | JSONB sub-key | конфиг для simulated curve; не создаём таблицу simulated_viewers (был бы дубль), pure compute |
| `live_event_sessions.metadata.auto_started_at` / `.playback_started_at` / `.fallback_state` / `.last_position` / `.test` | JSONB keys | reuse существующей `metadata` колонки; **не** новые колонки, но фиксируем как «новый контракт ключей» для полноты |

**Ничего лишнего:** ноль новых таблиц, одна колонка, одна edge, N enum значений, N JSONB ключей.

---

## Acceptance discovery

Discovery-отчёт считается **submitted**, но **не accepted**, пока не выполнены оба условия:

1. Утверждение пользователем содержимого §§1-16 явным ответом «discovery accepted».
2. Утверждение proof-матрицы Фазы A (§11) — все 4 режима подтверждены как обязательные для приёмки.

**Фаза A стартует только после обоих утверждений.**
До этого момента любой код-патч по Фазе A запрещён.

---

## Готовность к Фазе A

- Существующая архитектура покрывает 80% требований плана без новых сущностей.
- Основной инженерный челлендж — переход player-state из client-only в общий SoT
  и добавление self-heal идемпотентно с жёсткими guard'ами (§10.5, §12).
- Backward compatibility: `LiveEventLegacy` и live-stream — не трогать, только
  regression-smoke на приёмке каждой фазы.

**Gate-статус:** `submitted` (не `accepted`). Ждём явного утверждения discovery + proof-матрицы A.

---

## §17. Phase A — Implementation log

Реализовано (add-only, без миграций и новых таблиц):

**Edge function:** `supabase/functions/autoweb-session-heartbeat/index.ts` (~230 строк, `verify_jwt=true` в `supabase/config.toml`).
Единственная точка записи lifecycle-фактов autoweb-сессии. НЕ мержится с `live-session-heartbeat` / `live-event-lifecycle`.

**Add-only session metadata SoT** (никакие существующие ключи не удаляются):
- `auto_room_opened_at`, `auto_started_at`, `auto_ended_at`
- `autoplay_blocked_at`
- `last_heartbeat_at`, `last_player_state`, `last_current_time_seconds`, `last_noop_reason`

**Guard-контракт (жёсткий):**
- `status: pending → live` и `auto_started_at` — CAS `WHERE status='pending' AND metadata->>'auto_started_at' IS NULL`, ставится **только** при `player_state='playing' AND playback_started=true AND wall_clock>=starts_at`.
- `autoplay_blocked`: НЕ пишет `auto_started_at`, НЕ переводит status в live; фиксируется `autoplay_blocked_at` (CAS, один раз) + audit `autoplay_blocked`.
- `status: → ended` — CAS `WHERE status IN ('pending','live') AND metadata->>'auto_ended_at' IS NULL`, срабатывает при `player_state='ended' OR wall_clock>=ends_at`.
- `guard_scenario_needs_playback:<state>` — noop-причина для paused/idle/ready до старта.

**Anti-spam heartbeat (compare-and-set):**
- `last_player_state` — только при смене.
- `last_current_time_seconds` — только при |Δ|≥2s либо смене state.
- `last_heartbeat_at` — только при смене state либо каждые ≥60s.
- `last_noop_reason` — только при смене причины; audit `autoweb_self_heal_noop` — тоже только при смене.

**Admin/event visibility:** статус для админки — `live_event_sessions.status` (уже читается существующими admin-view'ами). Событие эфира не трогаем: session.status='live' достаточно (event-level status для autowebinar не является SoT факта запуска — авторан per-session). Refresh не нужен: heartbeat обновляет status атомарно при первом подтверждённом playback.

**Клиент:**
- `src/hooks/useAutowebHeartbeat.ts` — тонкий 10s poller, single-flight, ref-based state (interval не пересоздаётся).
- `src/components/live/AutowebRoomRuntime.tsx`:
  - Минимальный Kinescope postMessage-bridge: parse `play|pause|end|ready` → `AutowebPlayerState`.
  - `autoplay_blocked` детектор: 6s без `ready`/`playing` при phase∈{live,replay} и заданном video_id.
  - `useAutowebHeartbeat` подключён с `sessionId + playerState + currentTimeSeconds + playbackStarted`.

**Границы Фазы A (соблюдены):** нет editor, нет viewer count, нет chat isolation, нет test mode, нет replay-access patch, нет полного Kinescope SDK.

**Proof-матрица A — требуется прогон** (не выполнен агентом; должен быть выполнен вручную/QA до accept):
- 4 режима (one_time / scheduled / just_in_time / on_demand) × 3 артефакта (UI screencast + SQL snapshot `live_event_sessions.{status, metadata}` + `audit_logs` slice) + admin-status screenshot.
- Negative-cases: refresh страницы, multi-tab (одна сессия), restart runtime после auto_started_at, autoplay_blocked, source_unavailable, повторный heartbeat не создаёт дубль `auto_webinar_started` (CAS).

Gate: до подтверждения прогона proof-матрицы Фаза A — `submitted`, не `accepted`.
