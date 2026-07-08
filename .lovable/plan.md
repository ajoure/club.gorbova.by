## да, согласен, с учетом правок:

1. Этот патч принимается только как **доработка существующей реализации**, а не как новая параллельная механика.  
Нужно явно сохранить принцип:
  - один `autoweb_config` как SoT,
  - один существующий блок настроек replay/viewer controls,
  - один runtime-path применения этих настроек.
2. В `AutowebModeEditor.tsx` нужно не просто убрать гейт `userMode !== "one_time"`, а **проверить все 4 режима**:
  - `one_time`
  - `scheduled`
  - `just_in_time`
  - `on_demand`
  Для всех них блоки:
  - Replay
  - Управление плеером для зрителя
  должны:
  - отображаться,
  - сохраняться,
  - повторно открываться в edit-mode без потери значений.
3. В `AdminLiveEvents.tsx` селектор `source_live_event_id` должен быть:
  - видим только для `event_type='autowebinar'`,
  - обязательным только для сценария исторической ленты,
  - не ломать сохранение legacy-автовебинаров, где source еще не задан.
  То есть нужен мягкий режим:
  - для новых автовебов — blocker на publish/save, если продуктом это признано обязательным;
  - для старых — warning/empty-state, но без регрессии редактирования.
4. Runtime нужно исправить именно на уровне **применения существующего конфига**, а не через вечный hard-lock.  
Обязательно:
  - если `allow_seek=true`, нельзя оставлять overlay, который все равно блокирует перемотку;
  - если `allow_pause=true`, нельзя глобально гасить controls/hotkeys так, чтобы пауза фактически не работала;
  - если `allow_speed_control=true`, настройка скорости должна быть реально доступна.
  Иначе получится фальшивый UI, где админ что-то включает, а runtime это игнорирует.
5. По `source_started_at` принять именно этот порядок:
  - `live_started_at`
  - `room_opened_at`
  - `starts_at`
  И приложить proof SQL/response, что `autoweb-room-state` реально возвращает уже вычисленное значение, а не старый `starts_at`.
6. Для merge истории и live-сообщений обязательно зафиксировать, что:
  - новые сообщения текущих зрителей **не пишутся** в source-event,
  - история source-event остается read-only,
  - unified feed в UI показывает обе группы нативно,
  - staff-индикатор источника виден только staff и не виден обычному зрителю.
7. В следующем отчете нужен отдельный блок **Regression check**, где явно подтверждено:
  - scheduled-режим не сломан,
  - existing replay settings не потеряны,
  - сохранение/повторное открытие карточки не сбрасывает viewer controls,
  - обычный live-stream runtime не затронут.
8. Без следующих артефактов статус не выше partial:
  - UI proof по 4 режимам,
  - runtime proof по `allow_seek/allow_pause/allow_speed_control/resume`,
  - SQL proof по `source_live_event_id` и новым комментариям,
  - proof, что настройка из admin реально меняет поведение runtime.
9. Ничего не добавлять сверх этого scope:
  - без новых таблиц,
  - без новых jsonb-полей,
  - без второй конфигурации плеера,
  - без ручного SQL как обязательного шага пользователя.
  - &nbsp;
  - Отчёт-дополнение: почему текущая правка не принята + что доделываем

**Статус:** partial. Runtime/DB часть есть, но пользователь в админке ничего не видит и вынужден делать ручной SQL. Задача не закрыта.

### Что не так сейчас (по факту кода)

1. `**AutowebModeEditor.tsx` (строки 490 и 564): блоки «Replay» и «Управление плеером для зрителя» отрисовываются только при `userMode !== "one_time"`.** Для разового показа тех же настроек нет — они существуют, но скрыты. Это и есть источник жалобы.
2. **Нет UI-селектора `source_live_event_id`.** Поле в БД добавлено миграцией, но в `AdminLiveEvents.tsx` форма его не редактирует — единственный способ привязки это ручной `UPDATE`.
3. `**AutowebRoomRuntime.tsx` жёстко зашивает запреты в query-params Kinescope-iframe** (`controls=false&hotkeys=false&subtitles=false&pip=false`) и overlay-guard, **игнорируя `viewer_controls` из `autoweb_config`.** То есть если админ включит «Пауза» или «Перемотка» — в рантайме это ни на что не повлияет: параллельная «крепость» перекрывает конфиг.
4. `**source_started_at**` в `autoweb-room-state` берётся от `starts_at` исходного эфира, а не от фактического `live_started_at` (fallback `room_opened_at` → `starts_at`). Это ломает выравнивание истории по таймлайну.
5. **Merge истории и новых сообщений** в `LiveEventComments`/`LiveEventQuestions` — простая сортировка по `created_at`; визуально это не выглядит как единая лента.

### Что делаем (без новой параллельной механики)

#### A. Admin UI — переиспользовать существующие блоки

`**src/components/admin/live/AutowebModeEditor.tsx**`

- Убрать гейт `userMode !== "one_time"` с блоков **Replay** и **Viewer controls** (строки 490, 564). Оба блока становятся общими для всех 4 режимов: `one_time`, `scheduled`, `just_in_time`, `on_demand`.
- Сохранение остаётся в тот же `autoweb_config` — никаких новых полей, никакого дубля.

`**src/pages/admin/AdminLiveEvents.tsx**` — форма редактирования эфира, `event_type='autowebinar'`:

- Добавить `Select` «Исходный live_stream» → `source_live_event_id`.
- Опции: `live_events` того же тенанта с `event_type in ('live_stream','recorded_webinar')`, отсортировано по `starts_at desc`, показывать `title + дата`.
- Валидация: обязательное поле для autowebinar. Без него — блокировать сохранение с сообщением «Без исходного эфира история чата/вопросов/сценария не будет подтянута».
- Save = обычный `UPDATE live_events SET source_live_event_id=$1`.

#### B. Runtime wiring — читать конфиг, а не игнорировать его

`**src/components/live/AutowebRoomRuntime.tsx**`

- Удалить безусловные `controls=false&hotkeys=false&subtitles=false&pip=false` и заменить на выражения из `state.viewer_controls`:
  - `allow_pause=false` → `controls=false` + overlay-guard на play/pause,
  - `allow_seek=false` → `hotkeys=false` + overlay-guard на timeline (иначе `hotkeys=true`),
  - `allow_speed_control=false` → в SDK-параметрах скрыть выбор скорости,
  - `resume_from_last_position=true` → `startTime = resume.last_video_position_seconds` (уже есть),
  - `allow_rewatch_before_end=false` → блок повторного просмотра до `phase='replay'`.
- `subtitles`/`captions` держим выключенными по умолчанию (это отдельное требование «эффект live»), но если позже добавят флаг — тоже из конфига.
- Overlay-guard остаётся только там, где соответствующий `allow_*=false`.

#### C. Источник времени истории

`**supabase/functions/autoweb-room-state/index.ts**`

- `source_started_at = source.live_started_at ?? source.room_opened_at ?? source.starts_at`. Сейчас берётся только `starts_at`.
- Тип в `_shared/autoweb-types.ts` и `src/types/autoweb.ts` не меняется (поле уже есть).

#### D. Нативный merge истории и live

`**src/components/live/LiveEventComments.tsx`, `LiveEventQuestions.tsx**`

- Пересобрать `useMemo` merge:
  - исторические с полем `__source='history'`, live с `__source='live'`,
  - историческую отфильтровать по `currentPlaybackSeconds` (уже есть),
  - в UI staff — маленький значок «архив» на исторических (prop `staffSourceIndicator` уже прокинут),
  - обычному зрителю — без визуального различия, но сортировать по `effective_ts` (для history = `source_started_at + offset_seconds`, для live = `created_at`), чтобы новые всплывали в конце ленты естественно.

### Технические детали (для инженера)

- **Никаких новых таблиц/колонок.** Всё работает через существующий `autoweb_config` (jsonb на `live_events`) и `source_live_event_id`.
- **Никаких новых миграций** кроме уже применённой `20260708131820_...` (добавление `source_live_event_id`).
- Edge function `autoweb-room-state` уже возвращает `viewer_controls` — на клиенте она была, но не использовалась. Нужно только подключить.
- Тестовые сценарии в самой правке не меняются — только валидация формы `AdminLiveEvents` в разделе `event_type='autowebinar'`.

### DoD (что кладём в следующий отчёт)

**UI proof (скриншоты через preview + Playwright, авторизация как developer, пароль из user-memory):**

1. Автовеб в режиме «Разовый показ» — виден блок Replay и блок Viewer controls (те же, что раньше были только у scheduled).
2. Автовеб в режиме «По расписанию» — блоки на месте, ничего не сломано.
3. Карточка автовебинара с выпадающим списком «Исходный live_stream», значение сохранено.
4. Комната автовебинара: в чате видны и исторические сообщения (по времени эфира), и новые от текущих зрителей.

**Runtime proof (короткие Playwright-сессии со скринами):**

- `allow_seek=false` → клик по timeline не двигает позицию (проверить `currentTime` после клика).
- `allow_pause=false` → пробел/клик по видео не ставит на паузу.
- `allow_speed_control=false` → нет опции скорости в UI плеера.
- `resume_from_last_position=true` → повторный вход открывает видео с ранее записанной позиции.
- Историческое сообщение отрисовано, новое сообщение отправлено и появилось в ленте.

**SQL proof (через `supabase--read_query`):**

- `SELECT source_live_event_id FROM live_events WHERE id=<autoweb>` — заполнено, значение выставлено через UI (лог формы, timestamp свежий).
- Новый `live_event_comments.live_event_id` = id автовебинара (не source).
- Историческая выборка идёт с `live_event_id = source_live_event_id`.

### Что НЕ делаем в этом патче (отложено в backlog)

- Sync таймингов чата с точной секундой видео через Kinescope SDK-poll (сейчас — postMessage + fallback-таймер, оставляем).
- Backfill старых автовебинаров.
- Политика answered-state для исторических вопросов — оставляем текущее поведение read-only.