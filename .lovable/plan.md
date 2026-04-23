# да, согласен, с учетом правок:

1. **P1 нужно ужесточить по root cause.** Сейчас формулировка “цепочка данных не сломана” преждевременна. В плане обязателен raw-proof:
  &nbsp;
  &nbsp;
  - `live_events.metadata.room_settings.prestart` после Save;
  - raw payload `live-resolve`;
  - snapshot `roomSettings` в `LiveEvent.tsx`;
  - указание, какой именно guard ломает показ: `enabled`, `scheduled_at`, `state`, `isWaiting`, либо приоритет веток.  
  До этого нельзя фиксировать, что server-side не виноват.
2. **В P1 не ослабляй условие слишком широко без доказательства.** Формула  
`|| (state === "room_open_waiting" && !isReplay)`  
может показать pre-start уже после прошедшего времени просто потому, что комната открыта. Это допустимо только если явно подтверждено бизнес-правилом: “cover-only screen разрешён после scheduled_at, пока не live”. Добавь это как отдельное решение, а не смешивай с обычным countdown-сценарием.
3. **P1 нужно разделить на два режима явно:**
  - `countdown mode`: `enabled=true` + `scheduled_at > now`;
  - `cover-only mode`: `enabled=true` + есть cover/title/music, но countdown недоступен или выключен.  
  И `RoomPreStartScreen` должен рендерить их по-разному. Иначе снова получится “ничего не показывается”, если дата в прошлом.
4. **В P1 добавь check на timezone/парсинг даты.** Нужен proof, что `scheduled_at` приходит в ожидаемом формате и сравнение `new Date(...).getTime()` не ломается на timezone mismatch. Это одна из самых частых причин “до старта не показывается”.
5. **P1 proof нужен 4-кейсный, а не 3-кейсный:**
  - future date + pre-start on + countdown on;
  - future date + pre-start on + countdown off;
  - past date + pre-start on;
  - pre-start off.  
  Только так будет видно, что runtime-логика действительно починена.
6. **P2: flex-wrap норм, но зафиксируй DoD по высоте.** Если вкладки переходят в 2 строки, нужно проверить:
  - активная вкладка не ломает layout модалки;
  - второй ряд не наезжает на контент;
  - нет горизонтального скролла ни у `ScrollArea`, ни у `TabsList`, ни у внешнего контейнера;
  - индикатор скролла исчезает полностью, а не просто прячется визуально.
7. **P2: callout для нового эфира недостаточен сам по себе.** Добавь:
  - после первого Save модалка не просто остаётся открытой, а пользователь явно видит вкладку “Заставка и комната” без прокрутки;
  - можно добавить мягкую подсветку/автофокус на неё после сохранения. Это лучше, чем только текстовая подсказка.
8. **P2: thumbnail в списке эфиров — хороший пункт, но зафиксируй fallback.**
  - если `cover_url` пустой/битый, показывать стабильную заглушку;
  - не растягивать строку списка;
  - не ломать сортировку/клик по строке.
9. **P3 сейчас слишком расплывчатый.** Нужен не “убрать хвосты”, а конкретно:
  - какой файл отвечает за белый хвост;
  - какой файл отвечает за нижние скругления панели;
  - какой именно padding/margin/gap будет изменён;
  - где именно переключается режим keyboard open / closed.  
  Иначе Lovable снова сделает косметику без устранения источника.
10. **P3 нужно проверять отдельно в двух состояниях mobile layout:**

&nbsp;

- initial high-state;
- collapsed-state.  
Это уже был источник предыдущих багов, поэтому добавь это в DoD явно.

11. **P4: diagnose сейчас слишком слабый.** Добавь обязательную проверку:

- live-state с реальным source;
- state без source / OBS off;
- tap по video area;
- tap по зоне overlay reactions;
- tap по правому нижнему углу, где обычно fullscreen/controls.  
И отдельно зафиксируй, что placeholder-state не обязан открывать controls.

12. **В P4 не ограничивайся overlay.** Добавь в diagnose:

- `pointer-events`;
- `z-index`;
- `overflow-hidden`;
- cross-origin iframe restrictions;
- provider config/fullscreen allow attributes.  
Иначе можно исправить overlay, а controls всё равно не заработают.

13. **Build-unblock обязателен отдельным пунктом.** Если `usePushNotifications.ts` всё ещё даёт build error, вынеси это в план как precondition:

- сначала зелёная сборка;
- потом runtime proof.  
Без этого proof-пакет бессмысленен.

14. **Stop-guard уточни.** Сейчас нельзя трогать “desktop layout вне вкладок”, но P2 как раз меняет layout модалки. Нужно написать точнее:

- desktop runtime room не трогать;
- desktop admin modal разрешено менять только в зоне tabs/header вкладок.

15. **Финальный отчёт потребуй в жёстком формате:**

- что исправлено кодом;
- root cause confirmed по P1;
- что подтверждено UI/скринами;
- что подтверждено только code/network/DOM;
- что осталось open.  
Без этого снова смешаются факты и предположения.

16. **Текущее состояние по приоритетам:**

- первым идёт P1 runtime pre-start;
- вторым P2 tabs/admin UX;
- третьим P3 mobile polish;
- четвёртым P4 video clickability;
- build-unblock — до всех proof.

Если хочешь, следующим сообщением я сожму это в короткий PATCH-лист для вставки в Lovable.

&nbsp;

План: pre-start runtime + UX вкладок + mobile chat polish + клик по видео

## P1. Runtime pre-start (главный баг)

### Diagnose (root cause)

Файл `src/pages/LiveEvent.tsx:686`, условие:

```ts
roomSettings.prestart.enabled
  && data?.scheduled_at
  && new Date(data.scheduled_at).getTime() > Date.now()
  && (state === "room_open_waiting" || isWaiting)
```

Сама цепочка данных **не сломана** (`metadata.room_settings.prestart` пишется корректно, `live-resolve` пробрасывает, `RoomPreStartScreen` маппит правильно). Реальные причины «не показывается»:

1. `**scheduled_at <= now()**` — типичный сценарий: эфир был запланирован на прошедшее время, админ открыл комнату вручную (`room_state='opened'`). Условие `> Date.now()` отрезает pre-start, побеждает `RoomWaitingState`.
2. `**state !== "room_open_waiting"**` — если комната открыта, но lifecycle ещё не успел перейти в `room_open_waiting` (или эфир уже `scheduled` без открытой комнаты), pre-start не показывается даже при будущем `scheduled_at`.
3. **Нет fallback для cover-only сценария** — пользователь может хотеть «просто красивую обложку» без таймера и без `scheduled_at`. Сейчас такое игнорируется.

### Fix — явный приоритет рендера

В `LiveEvent.tsx:686` заменить условие на двухуровневое:

```ts
const prestartReady = roomSettings.prestart.enabled
  && (roomSettings.prestart.cover_url || roomSettings.prestart.title || roomSettings.prestart.music_url);

const showPreStart = prestartReady && (
  // A) ожидание до старта (любой state, включая scheduled/room_open_waiting)
  (data?.scheduled_at && new Date(data.scheduled_at).getTime() > Date.now())
  // B) комната открыта вручную и ещё не live (cover-only allowed)
  || (state === "room_open_waiting" && !isReplay)
);
```

Приоритет рендера:

1. `showPreStart` → `RoomPreStartScreen`
2. `isWaiting` → `RoomWaitingState` (старый fallback, если pre-start выкл/не настроен)
3. `live`/replay → плеер
4. иначе → «источник недоступен»

`RoomPreStartScreen` уже корректно скрывает countdown/music при отсутствии данных (см. fallback-контракт в шапке файла) — менять его не нужно.

### DoD P1

- pre-start enabled + cover + future `scheduled_at` → видна обложка и countdown;
- pre-start enabled + cover + прошлый `scheduled_at` + room opened → видна обложка без countdown;
- pre-start disabled → старый `RoomWaitingState`;
- после старта (`state==='live'`) pre-start исчезает, появляется плеер.

## P2. Админка: вкладки и видимость

### Fix

`src/pages/admin/AdminLiveEvents.tsx:2433–2460`:

- Переименовать `TabsTrigger value="room"`: иконка `ImageIcon`, лейбл **«Заставка и комната»**.
- Переставить вторым после `comments`.
- Убрать горизонтальный скролл: контейнер `<div className="overflow-x-auto -mx-1 px-1">` → `<div className="-mx-1 px-1">`, `TabsList className="w-max"` → `TabsList className="flex flex-wrap h-auto gap-1 w-full justify-start"`. Это даёт перенос вкладок в 2 строки на 1102px без скролла.
- При `!editingId` (режим создания) добавить inline-callout под формой:
  > «После сохранения откройте вкладку **«Заставка и комната»** — там настраивается обложка, музыка и обратный отсчёт до старта.»

### DoD P2

- На 1102px все 8 вкладок видны без горизонтального скролла (wrap в 2 ряда);
- «Заставка и комната» — вторая, с иконкой картинки;
- В новом эфире виден callout-подсказка.

## P3. Mobile/Safari/PWA chat polish

### Fix

- В `src/components/live/RoomChatPanel*` (определю точные файлы на execute) убрать паддинги-«хвосты» под composer'ом: использовать `pb-[env(safe-area-inset-bottom)]` только когда клавиатура закрыта; при открытой — `pb-0`.
- Для panel-карточки: `rounded-b-lg` оставить, но снизить высоту gap между последним сообщением и composer'ом до `gap-1`.
- На iOS использовать `100dvh`/`100svh` уже подключённый visualViewport-хук — проверить, что в PWA `display-mode: standalone` он не отключается.

### DoD P3

- Safari/PWA, открыта клавиатура: composer вплотную, нет белого хвоста;
- Закрытая клавиатура: панель завершённая, нижние скругления видны;
- Последнее сообщение всегда полностью читается.

## P4. Кликабельность видео

### Diagnose

В `LiveEvent.tsx:684–710` плеер уже обёрнут в `<div className="relative" style={{ pointerEvents: "auto" }}>`. Поверх — `LiveRoomReactionsOverlay`. Подозрение: overlay перехватывает tap.

### Fix

- В `LiveRoomReactionsOverlay`: корневой div обязан иметь `pointer-events: none`; интерактивные дочерние элементы (если есть кнопки) — `pointer-events: auto`. Проверить и зафиксировать.
- В `KinescopePlayerWrapper` / `LiveEmbedPlayer`: убедиться, что iframe не накрыт абсолютным элементом без `pointer-events:none`. Если есть «click-shield» для аналитики — убрать или сделать прозрачным к жестам.
- Для пустого источника (placeholder «Источник видео недоступен») — оставить как есть, это не плеер.

### DoD P4

- tap по видео в `state==='live'` открывает controls Kinescope;
- fullscreen и quality доступны;
- overlay реакций не блокирует жесты, реакции по-прежнему долетают через свою кнопку (вне видео-области).

## Порядок выполнения и Proof

1. **P1** → скрин админки (enabled+cover+timer) + скрин runtime до старта (cover+countdown) + скрин runtime с pre-start off (waiting).
2. **P2** → скрин формы редактирования на 1102px без горизонтального скролла, вкладка «Заставка и комната» вторая.
3. **P3** → Safari + PWA, скрины open/closed keyboard.
4. **P4** → видео tap → controls/fullscreen.

## Не трогаем

- Access logic, entry tracking, Wake Lock;
- DB schema (миграции не требуются);
- Edge functions (`live-resolve` уже отдаёт `room_settings` и `event_timezone` корректно);
- Десктопный layout вне правок вкладок.

## Финальный отчёт (структура)

- Изменённые файлы + diff-summary;
- Root cause P1 (явно: «условие `scheduled_at>now()` + жёсткий guard на state»);
- Proof по каждому из 4 блоков;
- Что не тронуто; что осталось open.