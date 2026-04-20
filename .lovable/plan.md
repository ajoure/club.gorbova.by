# да, согласен, с учетом правок:

1. **Participant count v1**  
Источник считать не по `last_seen_at > now() - interval '2 minutes'` как основному критерию, а по **неистекшей сессии**: `expires_at > now()` и `revoked_at IS NULL`.  
`last_seen_at` можно оставить только как диагностический/secondary signal. Иначе будет риск расхождения с уже существующей heartbeat-моделью.
2. **PATCH 2.2 / lifecycle handler**  
В контракте явно зафиксировать, что:
  &nbsp;
  &nbsp;
  - для `event_type != live_stream` provider-call **не делается**, меняется только room lifecycle;
  - для `live_stream` provider-call делается только если есть валидный `kinescope_live_event_id`;
  - если provider-call упал, не допускается частичный переход room-state без явно описанной стратегии. Нужен один из двух режимов:
    &nbsp;
    - либо fail whole action;
    - либо explicit degraded-mode с отдельным audit/log reason.  
    Это надо определить заранее, чтобы не было полупереходов.
3. **PATCH 2.1 / backfill**  
В миграции добавить явный mapping-комментарий и safe-guard:
  - `draft/scheduled -> closed`
  - `live -> live`
  - `ended/replay_available -> completed`
  - все прочие/unknown значения -> `closed` **с отдельной диагностикой количества строк**.  
  Нельзя оставлять “молчаливый” fallback без числа затронутых записей.
4. **PATCH 2.5 / waiting-state**  
В `live-resolve` зафиксировать, что для `room_state='opened'` возвращается отдельный признак waiting-state, а не только общий `status:'ok'`.  
Нужен явный флаг уровня payload, например `room_phase: 'waiting' | 'live' | 'completed'`, чтобы UI не вычислял это косвенно.
5. **PATCH 2.7 / единый SoT UI**  
В shared-helper добавить не только `getNextAction`, `canTransition`, `roomStateLabels`, но и **единый badge/view-model mapper** для:
  - label,
  - tone/color,
  - visibility of actions,
  - terminal-state flag.  
  Чтобы список / карточка / room-header не начали расходиться по мелочам.
6. **PATCH 2.8 / DB trigger**  
В триггере явно разрешить:
  - unchanged update (`OLD.room_state = NEW.room_state`);
  - migration/backfill режим;
  - service-role/edge-function controlled transition по допустимой матрице.  
  Иначе можно случайно заблокировать легитимные UPDATE, где room-state не меняется, но меняются другие поля.
7. **PATCH 2.3 / admin actions**  
Старые `enable_live_event/complete_live_event/sync_live_event` нельзя просто “оставить как provider-уровень” без UI-ограничения.  
Нужно явно:
  - либо спрятать их из основного UX под secondary/dev/provider-tools блок;
  - либо визуально развести как service/provider actions, не рядом с основным lifecycle.  
  Иначе будет два конкурирующих контура управления.
8. **PATCH 2.4 / кнопка в комнате**  
Кнопку в комнате лучше делать не только для `room_state === 'live'`, но и через общий helper/permission gate из PATCH 2.7, чтобы не было второй отдельной логики доступности.
9. **PATCH 2.6 / participant count UI**  
В тексте/tooltip явно писать не “участники онлайн”, а **«активные участники»**.  
Это важно, чтобы не обещать realtime presence точнее, чем реально есть.
10. **DoD**  
Добавить отдельный пункт в DoD:
  - `opened`-room не ломает heartbeat/session tracking;
  - при waiting-state participant count продолжает считаться;
  - переход `opened -> live` не сбрасывает чат/вопросы/active session.

&nbsp;

&nbsp;

План: Sprint 2 — lifecycle комнаты и вебинара

## Discovery (что есть сейчас)

**Существующие источники в `live_events`:**

- `status` (text, default `draft`) — legacy lifecycle
- `platform_status` (text, default `draft`) — текущий de-facto SoT, значения: `draft | scheduled | live | ended | replay_available`
- `is_published` (bool) — publish flag
- `metadata.provider_source_status` — состояние Kinescope-источника
- `kinescope_*` поля — provider-state видео

**Существующие lifecycle-actions:** `handleLifecycleAction(enable_live_event | complete_live_event | sync_live_event)` в `AdminLiveEvents.tsx` — один путь, работает только для live_stream c `kinescope_live_event_id`, дергает Kinescope и потом пишет `platform_status` напрямую.

**Save формы:** уже захардённый guard — `platform_status` не пишется на UPDATE (строки 622–651 `AdminLiveEvents.tsx`).

**Реальный источник activity:** `live_active_sessions` (поля `live_event_id`, `user_id`, `last_seen_at`, `expires_at`, `revoked_at`) + edge-функция `live-session-heartbeat` (45 сек). Это и есть честный источник для participant count v1 — никакой fake presence строить не надо.

**Room state до старта видео:** сейчас при `platform_status = scheduled` пользователь падает в `state = "scheduled"` и видит full-screen «Эфир ещё не начался» — без чата и вопросов. Это и есть проблема, которую закрывает PATCH 2.5.

**Mapping старого → нового lifecycle:**

- `draft` → `room_state = closed`
- `scheduled` → `room_state = closed`
- `live` → `room_state = live`
- `ended` / `replay_available` → `room_state = completed`

`platform_status` остаётся как есть — для provider/video/publish логики и replay. Не удаляем, не переопределяем.

---

## PATCH 2.1 — модель lifecycle (миграция, add-only)

Миграция добавляет в `live_events`:

- `room_state text NOT NULL DEFAULT 'closed'` с CHECK `IN ('closed','opened','live','completed')`
- `room_opened_at timestamptz NULL`
- `live_started_at timestamptz NULL`
- `webinar_completed_at timestamptz NULL`

Backfill из текущего `platform_status` по mapping выше (одноразовый UPDATE в той же миграции). Старые поля не трогаем.

---

## PATCH 2.2 — lifecycle handler (edge function)

Новая функция `supabase/functions/live-event-lifecycle/index.ts` с одним endpoint и параметром `action`:

- `open_room`: `closed → opened`, set `room_opened_at = now()`
- `start_live`: `opened → live`, set `live_started_at = now()`. Дополнительно — если у эфира `event_type = live_stream` и есть `kinescope_live_event_id`, вызывает существующий `kinescope-api enable_live_event` (re-use, без дубля логики); пишет `platform_status = 'live'` атомарно.
- `complete_webinar`: `live → completed`, set `webinar_completed_at = now()`. Аналогично, для live_stream — вызывает `complete_live_event` и пишет `platform_status = 'ended'`.

Контракт: проверка роли (`admin | superadmin | employee` через `has_role_v2`), JWT actor, audit в `audit_logs` (action + before/after state), идемпотентность (повторный вызов в целевом/последующем состоянии возвращает 200 `{ skipped: true }` без изменений). Guard на недопустимые переходы → 409.

Реюзаем существующие хелперы из `_shared/`. Никаких новых параллельных audit-механизмов.

---

## PATCH 2.3 — lifecycle-кнопки в `AdminLiveEvents.tsx`

В колонке actions таблицы и в карточке редактирования — три отдельные кнопки:

- `Открыть комнату` (enabled только при `room_state = closed`)
- `Начать вебинар` (enabled только при `room_state = opened`)
- `Завершить вебинар` (enabled только при `room_state = live`, AlertDialog confirm)

Каждая кнопка: один вызов `live-event-lifecycle`, блокировка на время запроса, после ответа — invalidate `["admin-live-events"]`. Показывать текущий `room_state` отдельным badge рядом со старым `platform_status`. Старые кнопки `enable_live_event/complete_live_event/sync_live_event` оставляем как provider-уровень (sync, ручная синхронизация Kinescope) — они не ломаются.

---

## PATCH 2.4 — кнопка «Завершить вебинар» в комнате

В `src/pages/LiveEvent.tsx`, в room-header: кнопка `Завершить вебинар` рендерится только если `isStaff && room_state === 'live'`. AlertDialog с явным предупреждением, disable-on-submit, после успеха — refetch resolve. Серверная проверка прав уже в edge function (PATCH 2.2) — фронт-скрытие только для UX.

`live-resolve` дополняем полем `room_state` в ответе (add-only, не ломаем существующих потребителей).

---

## PATCH 2.5 — controlled waiting-state (`opened` без `live`)

В `LiveEvent.tsx`:

- Новый `PageState = "room_open_waiting"`.
- Routing: если `json.room_state === 'opened'` (и не live) → `nextState = "room_open_waiting"`, **не блокируем resolve**, выдаём session_key как для live, чтобы heartbeat работал.
- UI рендер: full room layout (header, чат, вопросы, role-badges, theme, CTA блоки) — **то же дерево, что и для `live**`, но вместо плеера/embed — карточка-плейсхолдер «Комната открыта. Эфир скоро начнётся».
- При polling `resolve()` обнаруживается переход `opened → live` — UI автоматически переключается на player, без размонтирования чата (общий wrapper).

`live-resolve` для `room_state = 'opened'`: вместо ранней ветки `scheduled` отдаёт `status: 'ok'` + флаг waiting, доступ проверяется как для live (access rules / invite).

---

## PATCH 2.6 — participant count v1

Источник — `live_active_sessions` (уже существует, реальный heartbeat).

- View `live_event_active_participants_v`: `SELECT live_event_id, COUNT(DISTINCT user_id) AS active_count FROM live_active_sessions WHERE revoked_at IS NULL AND last_seen_at > now() - interval '2 minutes' GROUP BY live_event_id`. Окно 2 мин = 2.5 heartbeat-цикла.
- Edge `live-resolve` добавляет в ответ `active_participants: number`.
- Хук `useActiveParticipants(eventId)` — polling раз в 20 сек (тот же интервал, что resolve).
- UI: badge `Users + N` в header комнаты, в admin-таблице (колонка), в карточке редактирования. Один источник — один selector.
- Текст в tooltip честный: «Активные участники за последние 2 минуты».

Никакого fake realtime presence, никаких WebSocket-presence channels.

---

## PATCH 2.7 — sync lifecycle между UI

- Единый shared-helper `src/lib/liveRoomLifecycle.ts`: типы `RoomState`, функции `getNextAction(state)`, `canTransition(from, to)`, `roomStateLabels`.
- Использовать в: списке `AdminLiveEvents`, форме редактирования, `LiveEvent.tsx` (room header), `pages/LiveEvents.tsx` (cabinet).
- Никаких локальных вычислений «жив ли эфир» по косвенным полям. После lifecycle-action — `invalidateQueries` всех затронутых ключей.

---

## PATCH 2.8 — разделение save и lifecycle

- Save формы (`saveMutation` в `AdminLiveEvents.tsx`) **не пишет** `room_state`, `room_opened_at`, `live_started_at`, `webinar_completed_at` — добавить в payload-whitelist гард, аналогично существующему для `platform_status` (строка 622–651).
- Lifecycle-actions **не пишут** ничего, кроме своих 4 полей + при необходимости `platform_status` для legacy-видимости.
- DB-триггер `trg_guard_room_state_transition` на UPDATE: блокирует переходы вне матрицы `closed→opened→live→completed` (raise exception). Дополнительная защита от прямой записи мимо handler.

---

## PATCH 2.9 — deferred list

В отчёте Sprint 2 явно вынести в раздел «Deferred → финальный regression после Sprint 3»:

1. Moderation runtime proof в 2 окнах (из Sprint 1).
2. Button sync во время live-save.
3. Back/forward navigation между room/list/edit.
4. Финальный regression: full E2E lifecycle закрытой комнаты от open до completed с пользователем в waiting-state.

Эти пункты не блокируют приёмку Sprint 2.

---

## State transition matrix

```text
closed   --open_room-->   opened
opened   --start_live-->  live
live     --complete-->    completed
completed (terminal, no transitions)

любой повторный вызов в целевом/последующем состоянии = idempotent skip
любой другой переход = 409 Conflict
```

---

## Изменяемые файлы

**Новые:**

- `supabase/migrations/<ts>_room_lifecycle.sql` (PATCH 2.1, 2.8 trigger)
- `supabase/functions/live-event-lifecycle/index.ts` (PATCH 2.2)
- `src/lib/liveRoomLifecycle.ts` (PATCH 2.7)
- `src/hooks/useActiveParticipants.ts` (PATCH 2.6)
- `src/components/live/RoomLifecycleActions.tsx` (PATCH 2.3, переиспользуется в admin)
- `src/components/live/RoomWaitingState.tsx` (PATCH 2.5)

**Изменяемые (add-only, без удаления веток):**

- `src/pages/admin/AdminLiveEvents.tsx` (PATCH 2.3, 2.8)
- `src/pages/LiveEvent.tsx` (PATCH 2.4, 2.5, 2.6)
- `src/pages/LiveEvents.tsx` (PATCH 2.7 — badge room_state)
- `supabase/functions/live-resolve/index.ts` (отдать `room_state`, `active_participants`, разрешить waiting-state)

---

## DoD Sprint 2

- Миграция применена, backfill корректный, старые поля живы.
- Edge `live-event-lifecycle` отвечает на 3 action, idempotent, role-guarded, audit пишется.
- В админке 3 кнопки enable/disable строго по матрице.
- В комнате есть «Завершить вебинар» только для staff.
- При `room_state = opened` пользователь заходит в комнату, видит чат/вопросы/CTA/тему, вместо плеера — waiting-state. После `start_live` UI переключается без перезагрузки чата.
- Participant count v1 виден в комнате/списке/карточке, источник один (`live_active_sessions` + view), окно 2 мин.
- Save формы не дёргает lifecycle, lifecycle не дёргает unrelated поля; DB-триггер блокирует невалидные переходы.
- Sprint 1 deferred + Sprint 2 deferred вынесены в финальный regression после Sprint 3.