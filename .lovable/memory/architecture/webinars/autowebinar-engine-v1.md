---
name: autowebinar-engine-v1
description: Архитектура движка автовебинаров (4 режима + Sprint B room runtime + session_id contract + scripted isolation guards)
type: feature
---

# Autowebinar Engine v1 (Sprint A + B)

## Режимы (4)
- `one_time` → сохраняется как `event_type='recorded_webinar'` (legacy, без дублей).
- `scheduled` / `just_in_time` / `on_demand` → `event_type='autowebinar'` + `autoweb_mode`.

## Sprint A (зафиксировано)
- Edge: `autoweb-resolve-sessions` (public selector), `autoweb-create-personal-session` (JIT 5-min bucket / on_demand active reuse), `autoweb-generate-occurrences` (dry_run|execute).
- RRULE: массив `schedule.rrules: string[]` (по одному на time-slot, нет декартова).
- Blackout: timezone-aware через `Intl.DateTimeFormat('en-CA', {timeZone})`.
- Partial unique index `live_event_sessions_personal_uq` защищает от race.

## Sprint B — Room Runtime

### Контракт `autoweb-room-state` (PURE COMPUTE, ZERO writes)
Single source of truth: `supabase/functions/_shared/autoweb-types.ts` (re-export в `src/types/autoweb.ts`).
Поля: `phase` (pre_show|live|replay|ended), `session_id`, `live_event_id`, `starts_at`, `ends_at`, `replay_opens_at`, `replay_ends_at`, `viewer_controls`, `timeline_enabled`, `chat_enabled`, `questions_enabled`, `resume {enabled, last_video_position_seconds}`, `viewer_timezone`, `event_timezone`, `kinescope_video_id`.
Phase computation — UTC math, TZ только для UI-лейблов.

### session_id metadata invariant
- Client: для autowebinar comment/question submit без `metadata.session_id` → reject.
- Server: triggers `enforce_autoweb_session_id_on_comment/question` BEFORE INSERT — для `event_type='autowebinar'` обязателен `metadata.session_id` + проверка принадлежности сессии тому же live_event. Legacy event_types не трогаются.

### Scripted isolation guards
- `AutowebTimelineOverlay.tsx` НИКОГДА не импортирует submit-мутаторы для `live_event_comments`/`live_event_questions` (verify by grep).
- DB-инвариант: `SELECT count(*) FROM live_event_comments|questions WHERE metadata->>'kind' IN ('scripted_chat','scripted_question','host_message','system_message')` = 0.

### Resume contract (рабочий с Sprint B)
- Resolver всегда возвращает `resume.{enabled, last_video_position_seconds}`.
- Player монтируется с `?t=<seconds>` если `resume.enabled=true`.

### Decomposition (add-only)
- `useAutowebSessionResolver`, `useAutowebRoomState`, `AutowebRoomRuntime`, `AutowebSessionSelector`, `AutowebTimelineOverlay`.
- `LiveEvent.tsx` тронут минимально: одна early-return ветка + вынос legacy в `LiveEventLegacy()`.

### Tests
8 unit-тестов чистой логики `computeRoomState` в `supabase/functions/autoweb-room-state/index.test.ts` (все проходят).
