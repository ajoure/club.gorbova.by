да, согласен, с учетом правок:

1. **Не дублировать one_time в БД как второй смысл рядом с recorded_webinar.**  
В UI можно оставить 4 карточки выбора, но в модели данных сделать так:  

  - Разовый показ → сохраняется как текущий recorded_webinar;
  - По расписанию / Через N минут / Сразу → event_type='autowebinar' + autoweb_mode.  
  Иначе получится двойная логика одного и того же режима.
2. **Сессии делать с жёсткой защитой от дублей.**  
Для live_event_sessions не один общий unique, а два:
  - public scheduled: unique (live_event_id, starts_at) where viewer_user_id is null;
  - personal JIT/on_demand: unique (live_event_id, starts_at, viewer_user_id) where viewer_user_id is not null.
3. **Статус сессии не делать главным источником истины.**  
status в live_event_sessions оставить как кэш/диагностику, а реальное состояние комнаты считать от:
  - starts_at
  - duration_seconds
  - [replay.open](http://replay.open)_strategy
  - replay.delay_minutes
  - replay.window_hours  
  Иначе будут desync-эффекты, как уже было в live lifecycle.
4. **Добавить обязательную политику viewer controls для автовеба.**  
В autoweb_config нужен блок:
  - allow_pause
  - allow_seek
  - allow_speed_control
  - resume_from_last_position
  - allow_rewatch_before_end  
  Это важная часть UX для evergreen-вебинаров.
5. **Session selector нужен не только для scheduled/JIT, но и как единая входная точка режима.**  
Даже если режим on_demand, вход лучше вести через единый selector/resolver слой, чтобы не плодить разный room-flow.
6. **JIT и on-demand защитить от раздувания количества персональных сессий.**  
Сразу добавить:
  - dedupe по viewer_user_id + live_event_id + time bucket;
  - TTL/cleanup expired sessions;
  - guard от повторного создания 10 одинаковых сессий подряд.
7. **live_event_session_progress расширить сразу.**  
Нужны поля:
  - first_joined_at
  - last_seen_at
  - completed_at
  - max_watched_seconds
  - watch_percent
  - last_video_position_seconds  
  И ключ (session_id, viewer_user_id) либо (session_id, viewer_proof_id).
8. **Timeline MVP правильный, но host_message и system_message лучше сразу рендерить через единый runtime-слой событий.**  
Не разносить логику по нескольким независимым рендерам.  
Иначе потом scripted_chat в Sprint E будет тяжело встраивать.
9. **В админке нужен dry-run preview generated sessions до сохранения.**  
Для scheduled админ должен видеть:
  - ближайшие 5–10 сессий;
  - TZ;
  - blackout exclusions;
  - итог после сохранения.  
  Не просто “RRULE сгенерирован”, а человекочитаемое превью.
10. **Reminder-матрицу привязать к session-level, а не только к event-level.**  
Напоминания должны отправляться по конкретному session_id, иначе для scheduled/JIT будут ошибки с неправильным временем.
11. **В аналитике разделить 3 уровня.**

&nbsp;

- event-level
- session-level
- viewer-level  
Иначе потом нельзя будет нормально понять:
- какой слот конвертит;
- какие CTA сработали;
- кто смотрел live-slot, а кто replay.

12. **Для Анкеты -> Вебинары зафиксировать отдельный инвариант в DoD.**  
Там должны попадать:

- только реальные live_event_comments
- только реальные live_event_questions
- только реальные viewer/session связи  
Ни timeline_events, ни simulated_messages, ни host_message туда никогда не попадают.

13. **Добавить Phase 0 перед Sprint A — discovery/integration audit.**  
До миграций отдельно проверить:

- как сейчас выбирается duration_seconds;
- как встроены CTA и moderation;
- какие текущие TG/email reminders уже есть;
- где лучше хранить viewer timezone;
- нет ли конфликтов с текущим recorded_webinar.  
Это должен быть короткий read-only этап, чтобы потом не переделывать БД.

14. **В DoD добавить обратную совместимость явно.**  
Нужно прямо написать:

- текущие live_stream не ломаются;
- текущие recorded_webinar не ломаются;
- существующие room/comments/questions/contacts/webinars карточки продолжают работать без миграции данных.

В остальном план сильный и уже выглядит как нормальная архитектура продукта, а не просто “ещё один тип эфира”.

&nbsp;

&nbsp;

# План: Модуль «Автовебинары» (Evergreen Webinars) v2

## Контекст и принципы

Расширяем `live_events` четвёртым каноническим типом — `autowebinar` — с движком, сравнимым с EverWebinar / eWebinar / Demio / WebinarKit. Текущий `recorded_webinar` остаётся как «разовый показ» (один из 4 user-modes). Архитектурные правки против v1 плана:

- **4 режима показа** вместо 3 (добавлен «разовый показ» в одном UI с остальными).
- **Симулированный контент изолирован** от реальных SoT-таблиц (`live_event_comments` / `live_event_questions` не загрязняются).
- **MVP без fake viewer count и без simulated_question/chat** — это advanced (Sprint E).
- **Timeline MVP**: CTA, poll, resource_link, host_message, system_message, end_screen.
- **Реальный чат/Q&A** работает поверх автоматической сессии (eWebinar-style live moderation).
- **Session selector** для зрителя — обязательный экран.
- **Полная analytics-матрица** (registration → attendance → retention → CTA).

## Модель: 4 режима показа


| Mode           | UI label      | Поведение                                                                                                |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `one_time`     | Разовый показ | Эквивалент текущего `recorded_webinar`: одна дата `scheduled_at`                                         |
| `scheduled`    | По расписанию | RRULE внутри, визуальный редактор снаружи (дни недели + времена). Материализация в `live_event_sessions` |
| `just_in_time` | Через N минут | На лендинге зритель выбирает старт через 5/10/15/30 мин; персональная сессия                             |
| `on_demand`    | Сразу         | Стартует мгновенно при заходе                                                                            |


Все 4 — общий тип `event_type = 'autowebinar'`, отличаются `autoweb_mode`. `recorded_webinar` остаётся для legacy-совместимости (миграция не нужна, можно перевести вручную).

## БД-изменения

### `live_events` (новые колонки)

- `autoweb_mode` text NULL — `one_time | scheduled | just_in_time | on_demand`
- `autoweb_config` jsonb DEFAULT `'{}'` — единый контейнер настроек:

```json
{
  "schedule": {
    "rrule": "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=19;BYMINUTE=0",
    "timezone": "Europe/Minsk",
    "occurrences_window_days": 14,
    "blackout_dates": ["2026-05-09"]
  },
  "just_in_time": {
    "offsets_minutes": [5, 10, 15, 30],
    "show_countdown": true
  },
  "on_demand": { "min_delay_seconds": 0 },
  "replay": {
    "enabled": true,
    "open_strategy": "immediate",
    "delay_minutes": 0,
    "window_hours": 48,
    "show_chat_history": false,
    "cta_strategy": "same_as_live"
  },
  "video": { "kinescope_video_id": "...", "duration_seconds": 3600 }
}
```

### `live_event_sessions` (новая)

Каждый сеанс показа: `id`, `live_event_id`, `mode`, `starts_at`, `ends_at`, `viewer_user_id` NULL (для JIT/on_demand), `status` (`pending | live | replay | ended | expired`), уникальный индекс `(live_event_id, starts_at, viewer_user_id)`.

### `live_event_timeline_events` (новая)

Сценарные события: `id`, `live_event_id`, `offset_seconds`, `kind` (`cta_show | cta_hide | poll | resource_link | host_message | system_message | end_screen`), `payload` jsonb, `is_active`. Индекс `(live_event_id, offset_seconds)`.

### `live_event_simulated_messages` (новая, изолированная SoT)

Sprint E. **Не смешивается** с `live_event_comments`. Колонки: `id`, `session_id`, `timeline_event_id`, `display_at`, `author_name`, `author_avatar_url`, `text`, `kind` (`scripted_chat | scripted_question`).

### `live_event_session_progress` (новая)

Метрики просмотра по сессии: `session_id`, `viewer_user_id`, `joined_at`, `left_at`, `max_watched_seconds`, `cta_clicks` jsonb, `poll_answers` jsonb.

### RLS

По образцу `live_event_questions`: admin RW, authenticated SELECT по своим сессиям.

## Backend (edge functions)

1. `**autoweb-generate-occurrences**` — cron (1/час), материализует `live_event_sessions` по RRULE на `occurrences_window_days` вперёд, исключая `blackout_dates`. Идемпотентно.
2. `**autoweb-resolve-sessions**` — для лендинга/session-selector: возвращает 3–5 ближайших публичных сессий (scheduled), варианты JIT-офсетов или мгновенную сессию (on_demand) в timezone зрителя.
3. `**autoweb-create-personal-session**` — создаёт персональную сессию для JIT/on_demand при выборе зрителя.
4. `**autoweb-room-state**` — вычисляет `pre_show | live | replay | ended` по `now() vs session.starts_at + duration + replay.delay + replay.window`.
5. `**autoweb-timeline-tick**` — отдаёт клиенту scripted-события для текущего `currentVideoTime` (CTA/poll/host_message). Идемпотентно по `(session_id, timeline_event_id)`.
6. `**autoweb-import-chat**` — Sprint E. Конвертирует реальный live-чат в `live_event_simulated_messages`.

## UI: админ — конструктор режима

В диалоге `AdminLiveEvents.tsx` при `event_type = autowebinar` — 4 карточки выбора режима (Разовый / По расписанию / Через N минут / Сразу). Под каждой раскрывается контекстная секция:

- **Разовый**: один date-time picker (как сейчас).
- **По расписанию**: визуальный редактор (чекбоксы дней недели + временные слоты + TZ + окно генерации 7/14/30/90 + blackout-даты). Превью «Ближайшие 5 запусков». RRULE генерируется автоматически и хранится скрыто.
- **Через N минут**: чекбоксы офсетов (5/10/15/30/60), тоггл «Показывать обратный отсчёт».
- **Сразу**: только тоггл «Минимальная задержка перед стартом».

Отдельные секции (общие для всех режимов кроме `one_time`):

- **Источник видео**: Kinescope picker + автодетект `duration_seconds`.
- **Replay**: тоггл, `open_strategy` (immediately / after delay), `delay_minutes`, `window_hours`, `cta_strategy` (same as live / replay-only CTAs), `show_chat_history`.

## UI: Timeline Editor (новая вкладка карточки эфира)

Компонент `AutowebTimelineEditor.tsx` — видео-плеер Kinescope + дорожка с маркерами + список событий (sortable по offset). Канонический набор MVP (Sprint C):


| kind                    | UI                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `cta_show` / `cta_hide` | выбор существующего sales block                                                        |
| `poll`                  | вопрос + варианты ответа                                                               |
| `resource_link`         | заголовок + URL                                                                        |
| `host_message`          | автор + аватар + текст (видно как «системное сообщение от ведущего» отдельным styling) |
| `system_message`        | технический баннер                                                                     |
| `end_screen`            | финальный экран с кнопками                                                             |


Превью-режим: запустить плеер, видеть всплывающие события. Bulk import из CSV. Импорт чата из прошлого live и `scripted_chat/scripted_question` — Sprint E.

## UI: страница зрителя

### Session Selector (новый экран, обязательный)

Перед регистрацией:

- Для `scheduled`: список 3–5 ближайших стартов в TZ зрителя + смена слота.
- Для `just_in_time`: 4 кнопки «Начать через 5/10/15/30 мин».
- Для `on_demand`: одна кнопка «Начать сейчас».
- Для `one_time`: фиксированная дата + countdown.

### Комната

- `pre_show`: countdown + описание.
- `live`: Kinescope-плеер + чат + Q&A. Чат показывает **только реальные сообщения** (из `live_event_comments`). Scripted host_message рендерится **отдельным визуальным слоем** (слева, с pin-стилем «от ведущего»), не в чат-feed. Sprint E добавит scripted_chat в feed с пометкой `metadata.kind = 'scripted'`.
- Реальные вопросы зрителя → `live_event_questions` как сейчас. Модератор может отвечать вживую (eWebinar-style) или позже (slow-response fallback — Sprint E).
- CTA/poll/resource_link всплывают по timeline-tick.
- `replay`: те же CTA (или replay-CTA по `cta_strategy`); чат-история скрыта по умолчанию.
- `ended`: end_screen.

## Изоляция симулированного контента (архитектурный инвариант)


| Источник                          | Таблица                         | Видимость                                                                         |
| --------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| Реальные комментарии зрителей     | `live_event_comments`           | Чат-feed, карточка контакта, аналитика, Анкеты → Вебинары                         |
| Реальные вопросы зрителей         | `live_event_questions`          | Q&A panel, Анкеты → Вебинары, moderation                                          |
| Scripted host_message             | `live_event_timeline_events`    | Отдельный визуальный слой в комнате; **не в карточке контакта**, **не в Анкеты**  |
| Scripted chat/question (Sprint E) | `live_event_simulated_messages` | Мерж в чат-feed на чтении с явной меткой; **не в SoT-аналитике**, **не в Анкеты** |


Анкеты → Вебинары и карточка контакта читают **только** `live_event_comments` / `live_event_questions` — гарантия чистоты.

## Аналитика (расширенная матрица)

Метрики на уровне эфира и сессии:

- registration → attendance (показатели регистрации vs прихода)
- attendance → stayed 25 / 50 / 75 / 100% (retention curve)
- clicks by timeline event (per CTA / poll / link)
- questions asked (количество, среднее на зрителя)
- moderator response time (от вопроса до первого ответа)
- replay watchers vs live-slot watchers (cohort split)
- per-session funnel (для scheduled — какой слот конвертит лучше)

Источники: `live_event_session_progress` + существующие `live_event_questions`/`comments`.

## Этапы (новая разбивка под безопасный MVP)

1. **Sprint A — Ядро.** Миграции (`autoweb_mode`, `autoweb_config`, `live_event_sessions`), 4 режима в admin-UI (включая `one_time`), session resolver, RRULE-движок внутри.
2. **Sprint B — Room runtime.** `autoweb-room-state`, countdown / pre-show / live / replay экраны, реальный чат и Q&A, базовый session picker.
3. **Sprint C — Timeline MVP.** Editor + 7 канонических event kinds (CTA, poll, link, host_message, system_message, end_screen), preview simulator, runtime-tick.
4. **Sprint D — Replay + reminders + analytics.** Полная replay-модель (open_strategy, cta_strategy), reminder-матрица (email/TG за 24ч/1ч/при старте), core analytics dashboard.
5. **Sprint E — Advanced.** `live_event_simulated_messages`, scripted_chat / scripted_question, import chat from live, fake viewer count (feature flag), slow-response moderator automation.

## DoD

- 4 режима (one_time / scheduled / just_in_time / on_demand) работают end-to-end через визуальный конструктор без показа RRULE.
- Session selector показывает ближайшие старты в TZ зрителя; JIT-офсеты выбираются.
- Timeline Editor поддерживает 7 MVP-типов; preview работает.
- Реальный чат и Q&A зрителя работают поверх автоматической сессии; модератор отвечает вживую.
- Replay открывается по `open_strategy` и закрывается по `window_hours`; CTA-стратегия применяется.
- Аналитика показывает registration → attendance → retention 25/50/75/100% + CTA clicks + Q&A метрики.
- **Реальные комментарии/вопросы не смешиваются с simulated feed** (DB-инвариант: разные таблицы; UI-инвариант: scripted host_message — отдельный слой).
- **Анкеты → Вебинары и карточка контакта** показывают только реальную активность зрителя (запрос только к `live_event_comments` / `live_event_questions`, без timeline-источников).
- Текущие `live_stream` и `recorded_webinar` не сломаны (regression-pass).
- Memory: `mem://architecture/webinars/autowebinar-engine-v1` + `mem://architecture/webinars/simulated-content-isolation`.