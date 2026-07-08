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

## Готовность к Фазе A

- Существующая архитектура покрывает 80% требований плана без новых сущностей.
- Основной инженерный челлендж — переход player-state из client-only в общий SoT
  и добавление self-heal идемпотентно.
- Backward compatibility: `LiveEventLegacy` и live-stream — не трогать, только
  regression-smoke на приёмке каждой фазы.

**Gate-статус:** discovery завершён, готов к утверждению перехода на Фазу A.
