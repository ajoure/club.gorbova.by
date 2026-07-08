# Backlog: Autowebinar — admin selector "Исходный live_stream" и вложенные вкладки истории

## Контекст

Сделано в основном патче (2026-07-08):
- Миграция `live_events.source_live_event_id` (nullable, FK на live_events).
- `autoweb-room-state` возвращает `source_live_event_id` + `source_started_at`.
- `AutowebRoomRuntime` показывает вкладки Чат / Вопросы / Участники / Сценарий / (Модерация staff)
  + `LiveEventRoomBlocks` под видео.
- `LiveEventComments` / `LiveEventQuestions` принимают props `historySourceEventId`,
  `historySourceStartedAt`, `currentPlaybackSeconds` — если заданы, подгружают ленту
  исходного эфира и показывают только те записи, чьё created_at ≤ playback cutoff.
- Kinescope iframe с `controls=false&hotkeys=false&subtitles=false&captions=false&pip=false`
  + прозрачный overlay-guard на нижние 72px (перехватывает клики по timeline).
- Бейдж «Запись» больше не показывается для phase=replay — вместо него «В эфире».
- Участники — только текущие в session (не смешиваются с историческими).

## Что осталось

### 1. Admin UI: селектор "Исходный live_stream" (обязателен для autowebinar)

**Файл:** `src/pages/admin/AdminLiveEvents.tsx` (форма редактирования эфира)

- В форму добавить Select для `source_live_event_id` при `event_type === 'autowebinar'`.
- Опции — активные live_events с `event_type in ('live_stream','recorded_webinar')` того же
  тенанта, отсортированные по `starts_at desc`.
- Валидация: при `event_type === 'autowebinar'` поле обязательно (`missing.push('исходный эфир')`).
- Save: `UPDATE live_events SET source_live_event_id = $1 WHERE id = $2` — обычный form save.

### 2. Admin edit dialog: подгружать вложенные вкладки (Комментарии/Вопросы/Модерация/Сценарий/Блоки)
   из `source_live_event_id`, а не из id автовеба

- Компоненты этих вкладок (используются в LiveEventLegacy и в админ-редакторе) сейчас принимают
  один `liveEventId`. Для autowebinar с заданным source нужно передавать в них `source_live_event_id`
  для чтения истории, оставляя запись под id самого autoweb (там, где запись вообще возможна из
  админ-диалога).

### 3. Staff source indicator в чате

- В `LiveEventComments` / `LiveEventQuestions` уже есть prop `staffSourceIndicator`.
- Отрисовать маленький значок/бейдж «history» на исторических элементах при
  `staffSourceIndicator && item.__source === 'history'`. Требует помечать элементы
  в useMemo merge-логике (сейчас метка не проставляется — оба потока имеют одинаковый shape).

### 4. Kinescope SDK через `@kinescope/react-kinescope-player`

- Iframe query-params — first line of defense. Для полной гарантии disable seek/subtitles
  надёжнее использовать SDK (`useKinescopePlayer` уже есть) с полным набором
  `playerParams: { showSubtitles: false, controls: false, ... }`.
- Overlay-guard оставить как «пояс+подтяжки».

### 5. Late-join accuracy

- Playback time сейчас оценивается двумя источниками: postMessage от Kinescope (если приходит)
  и fallback-таймер, стартующий с `startSeconds` при монтировании плеера.
- Для точного late-join нужно либо форсировать SDK + `getCurrentTime()` polling каждые 500ms,
  либо использовать HTML5 media events через Kinescope postMessage bridge (сверить актуальный
  контракт по developer docs Kinescope).

### 6. Answered-state исторических вопросов

- Сейчас исторические вопросы показываются read-only, но `LiveEventQuestions` рендерит для них
  кнопку mark-as-answered (staff). Если staff нажмёт — UPDATE пойдёт по id исторической записи
  и запишется в исходный эфир. Нужно решить: (a) блокировать mark-as-answered на исторических,
  либо (b) хранить answered-state overlay-таблицей в autoweb-контексте.
- До принятия решения — рекомендуется блокировать: в UI `LiveEventQuestions` при
  `historyEnabled && item.live_event_id === historySourceEventId` — скрывать кнопку.

## DoD для этого backlog-айтема

- Админ-редактор автовеба содержит обязательный селектор «Исходный live_stream».
- Вложенные вкладки (Комментарии/Вопросы/Модерация/Сценарий/Блоки) в админ-редакторе автовеба
  показывают данные исходного эфира.
- Staff видит визуальный маркер источника в ленте runtime.
- Answered-state для исторических вопросов зафиксирован политикой (block or overlay).
