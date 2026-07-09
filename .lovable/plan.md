# да, согласен, с учетом правок:

1. В Фазе A.verify добавь отдельный обязательный сценарий **one_time + уже прошедший scheduled_at**:
  - первый вход после времени старта;
  - auto-create personal session;
  - self-heal;
  - отсутствие duplicate-start и duplicate-scenario-start.
2. В Фазе A.verify зафиксируй отдельный proof для **multi-tab одного и того же пользователя** и **двух разных пользователей**:
  - один пользователь, две вкладки;
  - два пользователя, две независимые session;
  - heartbeat не должен смешивать эти кейсы.
3. В SQL/event proof Фазы A отдельно приложи:
  &nbsp;
  &nbsp;
  - `live_event_sessions.status / started_at / ended_at / viewer_user_id / mode`;
  - lifecycle поля/метки room/event/scenario;
  - heartbeat timestamp sequence;
  - audit events в хронологическом порядке.  
  Без этого accepted не ставить.
4. В Фазе B добавь отдельный gate:
  - **scenario не стартует** до первого подтвержденного playback event;
  - **scenario не уходит вперед по wall-clock**, если player time недоступен и autoplay заблокирован.
5. В Фазе B viewer_controls проверь не только матрицей true/false, но и **повторным входом в ту же session**:
  - `resume_from_last_position=true`;
  - `resume_from_last_position=false`;
  - `allow_rewatch_before_end=false/true`.
6. В Фазе C для history/live merge добавь отдельный proof:
  - новые комментарии текущих зрителей пишутся только в `autoweb live_event_id`;
  - `source_live_event_id` остается read-only;
  - в source-event после теста нет новых записей от текущего просмотра.  
  Это нужно подтвердить SQL до/после, не только UI.
7. В Фазе C viewer counters зафиксируй как инвариант:
  - simulated count влияет только на отображение;
  - не влияет на access;
  - не влияет на chat;
  - не влияет на moderation;
  - не создает rows в sessions/participants.  
  Это нужно вынести в отдельный proof-блок.
8. В Фазе D для `launches_end_at` добавь 3 отдельных сценария:
  - до дедлайна — новый запуск создается;
  - после дедлайна — новый запуск не создается;
  - уже начатая session после дедлайна продолжает работать штатно.
9. В Фазе D для replay toggle зафиксируй обязательную проверку **во всех точках gate одновременно**:
  - список эфиров;
  - `/live/:slug`;
  - invite/direct link;
  - server resolve.  
  Если хотя бы одна точка открыта — фаза не accepted.
10. В Фазе D для test mode добавь жесткий инвариант:

&nbsp;

- никаких production audit/lifecycle/session side effects;
- все тестовые действия либо отдельным флагом, либо отдельным контуром state, но без влияния на боевой эфир.

11. В Фазе E добавь обязательный regression-check по уже сделанным вещам:

- `source_live_event_id`;
- one_time auto-session;
- селектор source live_stream в админке;
- viewer_controls в one_time;
- existing history/live foundation.  
Это не потерять.

12. В общий rule приемки добавь:

- без **UI proof + runtime proof + SQL/event proof** одновременно статус только `partial`;
- переход к следующей фазе запрещен.

После этих правок план можно считать финальным и идти в Фазу A.verify.

&nbsp;

План: закрытие спринта Автовебинар по фазам

Работа идёт строго по фазам. Каждая фаза принимается отдельным proof-пакетом. Следующая фаза не стартует, пока предыдущая не accepted.

---

## Фаза A.verify — приёмка уже реализованной Фазы A

**Цель:** доказать, что `autoweb-session-heartbeat` + auto-open/auto-start работают корректно, и присвоить Фазе A статус accepted.

### Diagnose

- Прочитать текущий код: `useAutowebHeartbeat`, `autoweb-session-heartbeat/index.ts`, `AutowebRoomRuntime`, точки записи `auto_room_opened_at` / `auto_playback_started_at` / lifecycle transitions.
- Проверить, что нет второго heartbeat-пути, дублирующего сигнал.
- Проверить guard: `scenario_started` пишется только после подтверждённого `player_state='playing'`.

### Execute

- Код не менять. Только точечные фикс-патчи, если proof найдёт дефект (double-start, гонка multi-tab, отсутствие self-heal после refresh).

### Verify (proof-пакет)

Для каждого из 4 режимов (`one_time`, `scheduled`, `just_in_time`, `on_demand`):

- UI proof: auto-open комнаты, auto-start после подтверждённого playback, refresh без дублей, multi-tab без дублей.
- Runtime proof: self-heal после повторного входа, нет double-start, нет double-scenario-start.
- SQL/event proof: срезы по `live_event_sessions`, lifecycle transitions, heartbeat timestamps, audit trail.

### DoD

- Фаза A получает статус **accepted**.
- Собран proof-пакет (UI + runtime + SQL).
- Без accepted Фаза B не начинается.

### STOP-guards

- Не переписывать lifecycle.
- Не создавать новый heartbeat/service/runtime path.
- Не расширять границы: без editor, без viewer counters, без chat isolation, без test mode, без replay-access patch.

---

## Фаза B — Плеер, таймкод, autoplay, viewer_controls

### Diagnose

- Текущий SoT времени: player currentTime vs wall-clock fallback; кто читает time для comments/buttons/scenario.
- Где именно ломается: autoplay, late join, resume, pause/seek/speed restrictions.

### Execute

- Единый SoT playback time: primary = player currentTime; fallback = session-relative clock только если player time недоступен.
- Autoplay fallback: `autoplay_blocked` → CTA «Нажмите, чтобы начать просмотр» → scenario стартует только после реального playback.
- Viewer controls строго из `autoweb_config.viewer_controls`: `allow_pause`, `allow_seek`, `allow_speed_control`, `resume_from_last_position`, `allow_rewatch_before_end`.
- Late join → актуальный таймкод.
- Source unavailable → no live, no scenario.

### Verify

- Матрица включений/выключений всех 5 viewer_controls.
- Autoplay blocked → CTA → manual start.
- Late join → сцена в правильной точке.
- Source unavailable → комната не считается live.

### DoD

- Runtime подчиняется `viewer_controls`.
- Late join и resume идут от фактического player time.
- Автовебинар не считается live, если видео реально не стартовало.

### STOP-guards

- Не вводить parallel viewer-control flags.
- Не делать отдельный runtime для autoplay fallback.

---

## Фаза C — Social layer: history/live merge, chat isolation, viewer counters

### Diagnose

- Что читается из `source_live_event_id`, что пишется в текущий `live_event_id`, как сортируется лента.
- Текущий контур viewer counters: real online, displayed, кто считается.

### Execute

- History/live merge: history = read-only from source, новые сообщения = только current autoweb event, merge по playback time.
- Нативная лента зрителю без визуального разделения; staff — optional indicator.
- Chat isolation: зритель видит свои + сценарные/system; staff видит всё.
- Viewer counters: real для staff; displayed для зрителя; simulated только presentation-layer, без fake sessions/participants.
- Настройки: показывать/не показывать онлайн, базовое число, точки роста/падения, preview-график.

### Verify

- История тянется из source, новые сообщения пишутся только в autoweb event.
- Chat isolation работает.
- Viewer sees displayed, admin sees real, simulated не создают sessions.

### DoD

- Историческая и живая лента выглядят нативно.
- Source-event не загрязняется.
- Real vs displayed разведены.

### STOP-guards

- Не клонировать comments/questions в autoweb event.
- Не создавать fake sessions ради viewer count.

---

## Фаза D — Editor / runtime finish

### Diagnose

- Существующий editor timed-comments/buttons/scenario.
- Replay gate на всех точках: список эфиров, `/live/:slug`, invite/token path, edge resolve.
- Где ломается end-of-webinar.

### Execute

- `launches_end_at`.
- Replay access toggle: отключение записи закрывает доступ сразу и везде.
- Editor: edit/reorder/retime existing scenario; CRUD timed-comments; CRUD timed-buttons.
- Bulk shift (comments / buttons / all) с preview перед apply.
- Test mode: seek/pause/jump/sync preview, без влияния на production lifecycle/sessions/integrations.
- End-of-webinar: stop video, stop scenario, hide scripted comments/buttons, показать «Вебинар завершён», no restart on reopen.

### Verify

- `launches_end_at` блокирует новые запуски.
- Replay disabled моментально закрывает доступ.
- Button появляется только в scheduled time.
- Bulk shift preview работает.
- Test mode изолирован.
- Ended webinar не рестартует.

### DoD

- Все пункты Execute реально работают в UI и в БД.

### STOP-guards

- Не вводить новый editor store/schema без доказанной необходимости.
- Не трогать LiveEventLegacy.

---

## Фаза E — Финальная регрессия

### Обязательный чек-лист

- LiveEventLegacy.
- Обычный `live_stream`.
- `one_time`, `scheduled`, `just_in_time`, `on_demand`.
- Access rules, invite links.
- Existing replay behavior.
- Existing admin editor paths.
- Existing comments/questions runtime.

### Финальный proof-пакет

UI proof + runtime proof + SQL/event proof + regression proof.

### Финальный статус

Спринт закрыт только если **все 5** приняты: A.verify, B, C, D, E.

---

## Зафиксировано как существующее (не дублировать)

`autoweb-session-heartbeat`, `autoweb-room-state`, `autoweb-create-personal-session`, `source_live_event_id`, `viewer_controls` в `autoweb_config`, `AutowebRoomRuntime`, existing audit path, existing history/live foundation.

## Текущее состояние

- Discovery accepted.
- Фаза A code applied, awaiting proof acceptance.
- Фазы B/C/D/E не начаты.

## Следующий шаг

После approve этого плана — сразу выполнить **Фазу A.verify** и вернуть proof-пакет. Только после accepted переходить к Фазе B.