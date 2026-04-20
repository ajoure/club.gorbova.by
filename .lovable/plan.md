## да, согласен, с учетом правок:

1. Не ограничивайся только `platform_status` и `metadata.provider.current.stream_status`. В discovery и proof обязательно отдельно фиксируй **оба слоя источника**:
  - `kinescope_live_event_id` / live-source branch;
  - `kinescope_video_id` / replay-source branch.
  Нужно доказать, какой именно branch выбирается в момент blank screen и почему. Иначе можно «починить» кнопку, но не источник live-видео.
2. В `live-resolve` не делай упрощённое правило только по `stream_status ∈ {on_air, live, active}`. Добавь правку:
  - если live-source существует и `platform_status = live`, приоритет live должен быть выше replay даже если `kinescope_video_id` уже заполнен;
  - если live-source существует, но provider status не успел обновиться, нельзя падать в blank — нужен controlled transitional state.
  То есть нужен не просто priority, а **явный anti-blank branch** между scheduled и replay.
3. В `LiveEvent.tsx` polling сделай ограниченным и доказуемым:
  - polling только для состояний `scheduled`, `live_pending`, `live`;
  - после `replay_available`, `ended_no_replay`, `source_unavailable` polling останавливается;
  - cleanup таймера и realtime subscriptions обязателен с proof, что дубликатов нет.
  Это важно, чтобы не создать новый баг с навигацией и повторными mount.
4. По навигации добавь отдельный диагностический блок:
  - проверить, не остаётся ли page в состоянии `loading/live-transition` после unmount;
  - проверить cleanup `heartbeat`, realtime channel, player instance, pending fetch/abort controller;
  - если есть `navigate(-1)` / browser back issue, зафиксировать, это из-за history stack или из-за неочищенного state.
  Иначе баг «не выходит назад» останется недолокализованным.
5. По `AdminLiveEvents.tsx` добавь важную правку:
  - обновлять нужно **не только список** и **не только форму**, но и все derived UI-blocks карточки: source debug, action buttons, badges, OBS/source section.
  - если есть локальный `events` массив + локальный `formData`, нужен единый post-action refresh path для обоих источников.
  Здесь цель не просто сменить текст кнопки, а убрать весь рассинхрон карточка ↔ список ↔ source block.
6. В runtime proof раздели автономную проверку на 2 части:
  - **без OBS**: проверить синхронизацию кнопки, refetch, back navigation, branch selection, controlled states;
  - **с OBS**: проверить реальное live-video и audio-loop.
  Это нужно явно прописать, чтобы подрядчик максимально закрыл всё сам до участия Сергея.
7. В разделе “Что останется только Сергею” уточни:
  - от Сергея нужен только реальный запуск OBS + короткое подтверждение по audio-loop;
  - всё остальное — discovery, код-фикс, SQL proof, edge-log proof, UI proof, проверка кнопок и навигации — исполнитель делает сам.
8. В финальном отчёте добавь обязательный блок:
  - **что исправлено автономно и подтверждено без OBS**;
  - **что подтверждено только после live-прогона с OBS**;
  - **что осталось blocked**, если live-video всё ещё не воспроизвёлся.
  И финальный verdict давать только в формате: `fixed / partially fixed / blocked`, отдельно по каждому из трёх багов, а не одним общим словом.
9. &nbsp;
10. Контекст

Три блокирующих бага в live-флоу:

1. **Blank screen** на `/live/:slug` во время реального live (Kinescope транслирует — наша комната пустая).
2. **Сломанная навигация** после захода в комнату (back/forward требуют hard reload).
3. **Рассинхрон кнопки** «Запустить эфир» в карточке vs список vs комната.

Правило исполнения: add-only, surgical, без затрагивания access-core / notifications / replay flow / recorded_webinar.

## Discovery (что я уже понял из кода и runtime)

Основные подозрения по архитектуре:

- `live-resolve` edge function = SoT для source branch (`scheduled`/`live`/`replay`/`source_unavailable`).
- `LiveEvent.tsx` (страница комнаты) выбирает branch и монтирует `LiveKinescopePlayer`.
- `AdminLiveEvents.tsx` — карточка с lifecycle actions; есть локальная `formData`, которая после `enable_live_event` не перечитывается.
- В `live_events` есть пара полей `kinescope_live_event_id` (стрим) и `kinescope_video_id` (запись/replay) — потенциальная коллизия приоритетов.
- Console уже показывает `Function components cannot be given refs` в `AdminLiveEvents` Dialog — отдельный варнинг, в патч-скоуп не лезу.

Что нужно прочитать/проверить (Discovery шаг патча):

- `src/pages/LiveEvent.tsx` — branch selection, mount/unmount, cleanup useEffect.
- `supabase/functions/live-resolve/index.ts` — приоритет live > replay > scheduled, как реагирует на одновременное наличие `kinescope_live_event_id` + `kinescope_video_id`.
- `src/pages/admin/AdminLiveEvents.tsx` — invalidate queries после lifecycle action, источник `platform_status` для текста кнопки.
- `src/components/live/LiveKinescopePlayer.tsx` (или аналог) — guard на пустой src.
- Любые `subscribe()` / `setInterval` / `useHeartbeat` в `LiveEvent.tsx` без cleanup.

## План правок (5 точечных, add-only)

### 1. Resolver priority (live-resolve edge)

Зафиксировать приоритет: `live` (есть `kinescope_live_event_id` + `stream_status` ∈ {`on_air`,`live`,`active`}) → `replay` (`platform_status='replay_available'` + `kinescope_video_id`) → `scheduled` → `source_unavailable`. Никогда не возвращать blank, если есть хоть какой-то источник.

### 2. Live-room rendering (`src/pages/LiveEvent.tsx`)

- Явный switch по `resolved_source.kind` без implicit fallthrough.
- Если `kind==='live'` и есть `play_link`/`live_id` → монтируем live-player.
- Если `kind==='live'` но source пустой → показываем controlled state «Эфир запускается, подождите…» вместо blank.
- Поллинг `live-resolve` каждые 10–15 сек пока `platform_status='scheduled'|'live'`, чтобы автоматически переключиться на live без ручного reload.

### 3. Cleanup и навигация

В `LiveEvent.tsx`:

- В `useEffect` все `setInterval`, supabase realtime channels, player refs обязательно очищаются в return.
- Убрать любые `await` внутри `onAuthStateChange` (известная race-condition).
- Player `unmount` перед navigate, без блокирующих promise.

### 4. SoT синхронизация кнопки `Запустить эфир` (`src/pages/admin/AdminLiveEvents.tsx`)

- После `enable_live_event` / `complete_live_event` → `queryClient.invalidateQueries(['admin-live-events'])` + повторный fetch конкретного эфира + `setFormData` из свежего ответа.
- Текст кнопки рассчитывать **только** из `formData.platform_status` после refetch, не из локального `isStarted` флага.
- Realtime subscription на `live_events` UPDATE для текущего id — если статус меняется снаружи, форма сама обновится.

### 5. Диагностика proof

Добавить `console.debug('[live-resolve]', { kind, platform_status, has_live_id, has_video_id, source_url })` в `LiveEvent.tsx` — для runtime proof в консоли preview, без UI-шума.

## Что НЕ трогаю

- `live_event_access_rules`, `user_has_live_event_access`, `notifications`, `kill-switch`, `proof_mode`, recorded_webinar flow, comments/questions/moderation, product CTA, theme.
- `src/integrations/supabase/{client,types}.ts`, `supabase/config.toml` (project-level).

## Файлы под правку (предварительно)

- `supabase/functions/live-resolve/index.ts` — priority + null-safety.
- `src/pages/LiveEvent.tsx` — branch switch, polling, cleanup, debug-log.
- `src/pages/admin/AdminLiveEvents.tsx` — refetch после lifecycle, кнопка из свежего status, realtime subscription.
- (опц.) `src/components/live/LiveKinescopePlayer.tsx` — guard на пустой src.

## Runtime proof (что сделаю сам без Сергея)

- Открою список → карточку → нажму «Запустить эфир» (если безопасно для теста) → проверю обновление кнопки и списка → открою `/live/testovyy-sergey` → проверю branch в console.debug → нажму «Завершить эфир» → проверю replay-state.
- SQL: `live_events` до/после каждого action, `platform_status` + `metadata.provider.current.stream_status`.
- Edge logs: `live-resolve` payload (kind, source).

## Что останется только Сергею

- Реальный OBS-стрим на RTMP Kinescope (только так можно проверить, что live-player реально воспроизводит видео и аудио).
- Audio-loop test в момент реального live.

## Финальный отчёт (структура)

1. Root cause blank screen.
2. Root cause рассинхрона кнопки.
3. Root cause навигации (или подтверждение, что это тот же state-management баг).
4. Список изменённых файлов.
5. Что проверено автономно (UI / SQL / edge-logs proof).
6. Остаток для Сергея (OBS live).
7. Verdict: fixed / partially fixed / blocked.