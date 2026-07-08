# да, согласен, с учетом правок:

1. В Фазе 0 добавь отдельный подпункт: зафиксировать точные SoT-поля и переходы для `room`, `event`, `player`, `scenario` с mapping `поле БД/edge → UI-status`. Иначе дальше легко смешать статусы и снова получить ложный `В эфире`.
2. В Фазе A зафиксируй жёсткое правило:
  - сценарий не имеет права стартовать раньше фактического старта видео;
  - `room_open` и `video_playing` — не одно и то же;
  - `live` для зрителя показывается только после подтверждённого playback start либо после явного fallback-CTA.
3. В Фазе B добавь в DoD обязательную проверку по всем 4 режимам:
  - `one_time`
  - `scheduled`
  - `just_in_time`
  - `on_demand`
  Не только один сценарий. Иначе снова можно починить только часть режимов.
4. В Фазе C по simulated viewers допиши:
  - цифра должна быть детерминированной в рамках одной session/window, чтобы при refresh не прыгать хаотично;
  - simulated count — только presentation layer, без записей в sessions/messages/questions/audit как реальные зрители.
5. По изоляции чата допиши отдельно:
  - исторические сообщения source-event тоже должны уважать режим изоляции для обычного зрителя;
  - staff продолжает видеть полный merged feed.
6. В Фазе D по `launches_end_at` допиши:
  - блокируются только новые старты и новые personal sessions;
  - уже активная сессия, начавшаяся до дедлайна, доигрывает до конца без принудительного обрыва.
7. По replay access toggle добавь явную проверку всех точек:
  - пользовательский список эфиров;
  - `/live/:slug`;
  - direct/invite links;
  - server resolve/gate;
  - autoweb runtime после завершения.
  Не только UI-скрытие.
8. По test mode добавь жёсткий guard:
  - не писать production comments/questions/participants;
  - не менять реальные lifecycle-поля;
  - не влиять на real viewer counters;
  - любые тестовые следы либо не писать вообще, либо писать только в уже существующий безопасный test-only контур, если он реально есть.
9. В общий DoD добавь backward compatibility:
  - существующие уже созданные автовебинары без новых настроек не должны ломаться;
  - `LiveEventLegacy` и live-stream сценарии — обязательный regression proof.
10. В конце плана добавь правило сдачи по фазам:

- каждая фаза закрывается только при наличии одновременно UI proof + runtime proof + SQL/event proof;
- без этого статус фазы только `partial`.

Если хочешь, я могу сразу превратить это в финальный текст для [lovable.dev](http://lovable.dev) без комментариев, в готовом виде для отправки.

&nbsp;

План: Доработка автовебинарной комнаты (runtime, плеер, сценарий, social-layer)

## Ключевые инварианты (STOP-guards)

- НЕ создавать: новые таблицы сценариев/viewers/lifecycle/viewer_controls; параллельный runtime; вторую механику запуска room/session/video/scenario; fake viewer sessions для simulated count.
- НЕ переписывать `LiveEventLegacy`.
- НЕ клонировать source comments/questions/buttons/scenario в autoweb-event.
- Reuse обязателен: `live_events`, `live_event_sessions`, `autoweb_config`, `viewer_controls`, `source_live_event_id`, `autoweb-room-state`, `autoweb-create-personal-session`, `AutowebRoomRuntime`, `LiveEventComments/Questions/Scenario/RoomBlocks`, `RoomParticipantsList`, существующий audit path.
- Новые сущности допускаются только с доказательством, что reuse невозможен (пишется в Discovery-отчёте фазы).

## Фаза 0 — Discovery (обязательно перед кодом)

Read-only аудит с письменным отчётом по каждому пункту (existing SoT / gaps / reuse plan):

1. Runtime start/lifecycle автовебинаров (self-heal, cron, race conditions).
2. `autoweb-room-state`, `autoweb-create-personal-session`, `autoweb-resolve-sessions`, `autoweb-generate-occurrences`.
3. Kinescope integration: доступный currentTime, postMessage bridge, SDK возможности.
4. Scenario runtime + timed comments/CTA (где источник времени, как считается).
5. Viewer counters (реальные vs отображаемые), где считаются, кто пишет.
6. Replay access logic: пользовательский список эфиров, `/live/:slug`, invite/direct links, серверный gate.
7. Chat/questions runtime + существующие merge history/live.
8. Test/admin-only pathways.
9. Существующие audit hooks.

**Gate:** без утверждённого discovery-отчёта следующие фазы не начинаются.

## State model и SoT времени (сквозной инвариант)

Четыре независимых контура: **room** (scheduled/room_open/waiting_for_video/live/ended/source_unavailable/test_mode), **event** (scheduled/live/ended/replay_available), **player** (idle/loading/playing/paused/autoplay_blocked/ended/error), **scenario** (idle/armed/running/paused/completed/blocked_by_video/test_mode).

**Канонический источник таймкода:** фактический `currentTime` плеера; fallback — session-relative wall clock только когда плеер не отдал время. Все timed-элементы (comments/buttons/scenario/late join/resume/end) читают ОДИН источник.

## Фаза A — Runtime lifecycle + автозапуск

Scope:

- Автооткрытие комнаты, авто-старт эфира/видео/сценария, авто-завершение.
- Self-heal в runtime (SoT): lazy-start догоняет lifecycle при входе после `scheduled_at`, работает после рестарта.
- Cron/worker — только ускоритель, не SoT.
- Guards: no double start, no double scenario boot, no duplicate room-open transition, повторный вход не рестартует эфир.

Приёмка фазы A: авто-старт без дублей + self-heal proof (SQL lifecycle transitions).

## Фаза B — Плеер, таймкод, late join, viewer_controls

Scope:

- Единый SoT playback time.
- Late join → фактический currentTime, показ только актуальных timed-элементов.
- Resume from last position по `viewer_controls.resume_from_last_position`.
- Autoplay fallback: если браузер блокирует — сценарий НЕ стартует по wall-clock, показывается CTA «Нажмите, чтобы начать просмотр», после ручного play — синхронизация по currentTime.
- Kinescope controls: reuse `autoweb_config.viewer_controls` (allow_pause/seek/speed_control, resume_from_last_position, allow_rewatch_before_end). Никаких новых флагов для тех же ограничений.
- Test mode для админа: seek/pause/speed разрешены, полностью изолирован от production.
- Source unavailable: понятная ошибка, сценарий/эфир не переводятся в live.

Приёмка фазы B: runtime proof по late-join, resume, autoplay-block, обёртка `viewer_controls`.

## Фаза C — Комната и social-layer

Scope:

- History/live merge: history по `source_live_event_id` (read-only), новые сообщения текущих зрителей — только в текущий `live_event_id`. В source ничего не пишется.
- Тайминг: исторические сообщения/вопросы всплывают только когда их время ≤ playback time.
- Staff-only source-indicator (history/live) — для зрителя лента нативная.
- Изоляция чата (`autoweb_config.chat_isolation` или существующий эквивалент): обычный зритель видит только свои + сценарные + системные; staff/модераторы видят всё.
- Viewer counts:
  - Реальные метрики для staff (без admin/moderator/test/технич.).
  - Отображаемая цифра: live-stream — реальные, autowebinar — simulated (presentation-only, БЕЗ fake sessions, БЕЗ влияния на access/chat/moderation/metrics).
  - Настройки: «Показывать зрителям количество онлайн», «Задать количество зрителей», точки роста/падения в %, preview-график.
- Sim viewers НЕ создают sessions.

Приёмка фазы C: изоляция + merge + separation viewer counters (SQL proof).

## Фаза D — Editor, сценарий, завершение, доступ к записи

Scope:

- Editor (доработка существующего): редактирование сценария/времени/порядка, CRUD timed-comments и timed-buttons, reorder.
- Кнопки/комментарии живут в source-event; autoweb только реплеит (без клонирования).
- Кнопка появляется ТОЛЬКО в момент по таймингу, не при открытии комнаты.
- Bulk shift (add-only): сдвиг comments/buttons/всех элементов с preview до применения.
- Автозавершение: стоп видео/сценария, скрыть scripted comments/CTA, сессия завершена, показать «Вебинар завершен». После завершения повторный вход не рестартует ничего.
- `launches_end_at` (новое поле): после наступления — новые personal sessions не создаются, входы в незапущенные — блок; уже начатые не убивать; корректный статус.
- Replay access toggle: серверный gate закрывает список эфиров, `/live/:slug`, invite/direct links; админ продолжает видеть. Проверка на всех точках, не только UI.
- Массовый сдвиг сценария — add-only относительно текущей модели.

Приёмка фазы D: editor CRUD + bulk shift preview + replay-gate proof (server-side).

## Аудит (сквозной)

Через существующий безопасный audit path (client insert запрещён):

- Runtime: room opened, webinar started, video started, autoplay blocked, scenario started/completed, webinar ended, source unavailable, replay toggled, viewer_controls violations.
- Editor: scenario/comment/button CRUD, bulk shift preview/apply, test mode start/stop, viewer display config, chat isolation, `launches_end_at` changed.

## Порядок реализации (нарушать нельзя)

1. lifecycle + auto-start + statuses (A)
2. video start + autoplay fallback + viewer_controls (B)
3. timed scenario runtime + late join + resume (B)
4. history/live merge + chat isolation (C)
5. viewer counts + simulated presentation (C)
6. launches_end_at (D)
7. replay access toggle (D)
8. editor improvements (D)
9. test mode (D)
10. audit hardening (сквозное)

## DoD и proof (3 группы, обязательны на каждой фазе)

**A. UI proof** — скрины/видео admin settings, runtime states, viewer controls, scenario editor, test mode, viewer count settings, chat isolation, replay toggle.

**B. Runtime proof** — auto-start, no double-start, autoplay fallback, late join, resume, seek/pause/speed по конфигу, timed comments/buttons, end-of-webinar, launches_end_at, replay disabled instantly.

**C. SQL/event proof** — session rows, lifecycle transitions, audit logs, отсутствие duplicate starts, отсутствие live writes в `source_live_event_id`, правильное закрытие replay, separation viewer counters, отсутствие fake sessions.

## Критерии приёмки спринта

Все 13 пунктов из §22 плана заказчика одновременно выполнены + все фазы приняты последовательно + Discovery-отчёты приложены + no regressions в `LiveEventLegacy` и live-stream сценариях.

## Технические заметки

- Формат сообщений: только «План:» / «Отчет о выполнении:» (docs/ENGINEERING_RULES.md).
- Порядок: Diagnose → Plan → Dry run → Execute → Verify на каждой фазе.
- Каждая фаза — отдельный патч с приёмкой; переход к следующей только после утверждения предыдущей.
- Перед созданием новых RPC/edge/table/enum/cron — проверка на существующее (дубли запрещены).

## Первый шаг после утверждения плана

Фаза 0 (Discovery) — read-only отчёт по 9 пунктам аудита с картой reuse/gaps и предложением конкретных точек изменения. Без правок кода.