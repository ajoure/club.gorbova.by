# да, согласен, с учетом правок:

1. **Разделение на 3 спринта — верно**, но в Спринте 1 нужно явно добавить, что это только **UI/UX + moderation hardening + theme propagation**, без изменения бизнес-модели эфира.  
Иначе подрядчик начнёт частично лезть в lifecycle уже в первом спринте.
2. **PATCH 1 по CTA нужно уточнить.**  
Сейчас для тестового эфира CTA не видно, потому что **нет данных**. Это нужно прямо зафиксировать в плане:
  &nbsp;
  &nbsp;
  - сначала доказать, что binding отсутствует;
  - потом сделать empty-state в админке;
  - потом для proof создать **один тестовый CTA-binding** на тестовом эфире и показать его в комнате;
  - только после этого считать patch закрытым.  
  Иначе будет “исправили visibility”, но в комнате так ничего и не покажут.
3. **Theme patch нужно сделать строго локальным для room UI.**  
Не допускать глобальных CSS-эффектов.  
Нужно прямо дописать:
  - тема применяется только внутри контейнера live-room;
  - никакие глобальные shadcn/tailwind токены по всему приложению не перезаписываются;
  - proof нужен на desktop и mobile.
4. **Роль “ведущий” не вводить как новую auth-role.**  
Это важно.  
В плане нужно уточнить:
  - `presenter` — не новая роль в системе прав;
  - это только **визуальный room-label**, вычисляемый через `live_events.metadata.presenter_user_id`;
  - права доступа и moderation не меняются от этого.  
  Иначе подрядчик может начать ломать RBAC.
5. **PATCH 4 нужно распространить и на комментарии, и на вопросы, но с разным UX.**  
Уточнить:
  - “Вопрос ведущему” — textarea с auto-grow обязательно;
  - обычный комментарий можно оставить компактным, но тоже с переносом строк и без one-line overflow;
  - на mobile оба поля должны быть keyboard-safe.
6. **PATCH 5 по mobile scroll нужно расширить.**  
Нужен не просто scroll списка, а полный mobile-proof:
  - вертикальный scroll ленты работает;
  - sticky input не перекрывает последние сообщения;
  - при длинном тексте вопроса textarea не ломает layout;
  - при открытии клавиатуры room не разваливается.
7. **PATCH 6 moderation нужно сделать через “текущее состояние”, а не просто через toggle-кнопки.**  
Дополни:
  - источник истины для mute/remove/hide — последнее релевантное действие пользователя в рамках `live_event_id`;
  - UI обязан сначала читать текущее состояние, потом показывать действие;
  - proof отдельно по каждому действию:
    - mute → unmute,
    - remove → restore,
    - hide → unhide,
    - delete,
    - public/private reply.
8. **PATCH 7 live-badge — правильно, но настройка должна быть отдельной от lifecycle.**  
Прямо зафиксировать:
  - badge — это только UI-метка;
  - badge не должен влиять на `platform_status`, `room_state`, player branch или resolver;
  - режимы: `auto | always_show | hidden` в metadata — ок.
9. **PATCH 8 participant count в предложенном виде слабый.**  
Не использовать только “авторы комментариев за 5 минут” как основной источник, если в проекте уже есть таблицы/механика presence/session.  
Лучше так:
  - сначала discovery по существующим сущностям присутствия;
  - если есть `live_active_sessions` / session-tracking — использовать их;
  - fallback по комментариям допустим только как временный режим и должен быть явно помечен как approximate.  
  Иначе пользователь получит неверный счётчик.
10. **Спринт 2 — lifecycle нужно формализовать жёстче.**  
Добавь явную матрицу состояний:
  - `closed` — комната закрыта;
  - `opened` — комната открыта, чат доступен, видео нет;
  - `live` — комната открыта, видео идёт;
  - `completed` — эфир завершён, replay/послесостояние.  
  И отдельно таблицу допустимых действий:
  - `closed -> opened`
  - `opened -> live`
  - `live -> completed`
  - `opened -> closed` только при необходимости и с confirm
  - запрет нелогичных прыжков.  
  Без этого подрядчик сделает рыхлую логику.
11. **В Спринте 2 нужно отдельно прописать, что room_state не заменяет platform_status.**  
Это уже упомянуто, но нужно сделать обязательным пунктом DoD:
  - `room_state` — UX-комната;
  - `platform_status` — состояние видео-источника/провайдера;
  - resolver/read-side может читать оба, но не смешивать их в одну ось.
12. **Кнопка “Завершить вебинар” внутри комнаты — только после confirm с сильной защитой.**  
Дополни:
  - modal подтверждения;
  - danger-style;
  - желательно ввод слова подтверждения;
  - недоступна обычным пользователям;
  - proof отдельно на desktop и mobile.
13. **В PATCH 10/11 нужно прямо зафиксировать до-старта чата.**  
Это важное бизнес-требование пользователя:
  - при `room_state='opened'` пользователи уже могут зайти в комнату;
  - комментарии и вопросы доступны;
  - live-player ещё не виден;
  - staff/admin могут модерировать комнату уже на этом этапе.  
  Это должно быть показано отдельным proof-сценарием.
14. **Нужен отдельный regression-блок по уже закрытым live-багам.**  
В конце каждого спринта обязательно проверить:
  - blank screen fix не сломан;
  - background-return fix не сломан;
  - hook-order crash не вернулся;
  - button sync не деградировал;
  - back/forward не деградировал.  
  Не только “comments/questions работают”.
15. **По button sync и back/forward нельзя забыть отдельный runtime-proof.**  
Добавь в план как обязательные открытые хвосты:
  - live идёт → открыть карточку → обычное “Сохранить” → кнопка остаётся “Завершить эфир” без reload;
  - live room → другая страница → back/forward → без black screen и hard reload.  
  Эти два пункта не должны потеряться на фоне нового scope.
16. **Нужен явный приоритет исполнения.**  
Я бы зафиксировал так:
  - сначала Спринт 1 полностью;
  - потом короткий runtime-proof;
  - только потом Спринт 2;
  - Спринт 3 — backlog/deferred, не блокирует rollout.  
  Иначе подрядчик смешает UX-полировку с тяжёлым lifecycle и растянет всё.
17. **Формат отчёта нужно сделать ещё жёстче.**  
Для каждого патча:
  - root cause,
  - changed files,
  - UI proof,
  - runtime proof,
  - regression proof,
  - статус: `fixed / partially fixed / deferred`.  
  Без этого они снова будут писать “всё сделано” без доказательств.

&nbsp;

&nbsp;

План: Webinar Room — UX/polish + room lifecycle + moderation hardening

Большой scope из 12 патчей разбит на **3 спринта по приоритетам**, чтобы каждый закрывался полным runtime-proof и не размывался. Все работы — **add-only**, без правок access-core / notifications / replay / recorded_webinar / live-resolve (он стабилизирован).

## Discovery — ключевые факты из кода и БД

- `live_events` сейчас имеет `platform_status` (`draft|scheduled|live|ended|replay_available`). Поля `room_state`/`room_opened_at`/`webinar_completed_at` **отсутствуют**.
- Lifecycle handler `handleLifecycleAction` в `AdminLiveEvents.tsx` поддерживает только `enable_live_event` и `complete_live_event` — старт комнаты и старт видео слиты в одно действие.
- Для текущего эфира `1514525a-...` в `live_event_product_cta_bindings` **0 записей**, в `live_event_room_blocks` тоже пусто. CTA не виден в комнате не из-за рендера — **данных нет**. Админ-таб «CTA» существует (`LiveEventProductCtaBindings`), но не заполнен. Это нужно отдельно отразить в отчёте PATCH 1.
- `LiveEventThemeEditor` уже существует и пишет в `metadata.room_theme`. Runtime в `LiveEvent.tsx` (стр. 443–455) подставляет CSS-переменные `--room-bg`, `--room-text`, `--room-panel` и т.д., но **компоненты внутри (Card, Tabs, сообщения, инпуты) их НЕ читают** — поэтому тема визуально «не доезжает».
- `LiveInlineModeration.tsx`: `mute` и `remove` всегда инсертят новое действие — нет toggle-логики (повторный клик = повторный mute, а не unmute). Это и есть наблюдаемый баг.
- Поле «Вопрос ведущему» — `<Input>` (одна строка). Нужна textarea с auto-grow.
- Console error: `Function components cannot be given refs` в `LiveEventQuestions` под `Tabs` — компонент не обёрнут в `forwardRef`. Лёгкий фикс попутно.
- Mobile scroll: `Card` имеет `min-h-[300px]` + `overflow-hidden`, у `TabsContent` нет явной flex-цепочки `min-h-0`; на узких экранах внутренний `overflow-y-auto` блокируется родителем — это и ломает скролл.

---

## Спринт 1 — UX/Polish комнаты (PATCH 1–7, 12)

Минимально-инвазивный, чисто клиентский. Доказуемо завершается за одну итерацию.

### PATCH 1 — Visibility CTA: диагностика + UX-фикс пустого состояния

- **Root cause доказан**: для тестового эфира bindings = 0. Рендерится `null`, поэтому в комнате ничего нет.
- Что делаю:
  - В админ-табе «CTA» (`LiveEventProductCtaBindings`) добавить **empty-state блок** с понятной инструкцией «добавьте первый CTA-блок» + кнопка «Добавить» (если ещё не выведена явно).
  - В `LiveEventProductCta.tsx` — добавить `console.debug('[live-cta]', { liveEventId, position, bindingsCount, visibleCount, runtimeShown })` для прозрачной диагностики.
  - В отчёте отдельно проговорить: «binding отсутствует у эфира → корректное поведение, не баг рендера».
- **Ничего не трогаем** в data-flow visibility (он уже корректен: `display_mode: always|after_minutes|at_datetime|manual` + runtime events).

### PATCH 2 — Тема реально применяется ко всем элементам

- В `LiveEvent.tsx` обернуть корневой контейнер класс `live-room-themed`.
- Добавить локальный `<style>`-блок (или extend в Tailwind через inline style on subtrees) который применяет CSS-переменные `--room-bg`, `--room-panel`, `--room-text`, `--room-text-secondary`, `--room-tabs`, `--room-accent` к:
  - фону страницы,
  - `Card` чата/вопросов (panel),
  - заголовку H1 и описанию,
  - `TabsList`/`TabsTrigger` (active/inactive цвет),
  - `Input`/`Textarea` ввода,
  - бейджам ролей (используя существующие `--room-admin-badge`, `--room-employee-badge`).
- UI-proof до/после на примере дефолтной темы и кастомной (выставить пробную тему через админку).

### PATCH 3 — Цветовая логика сообщений по ролям/авторству

- В `LiveRoleBadge.tsx` расширить mapping:
  - `presenter` (новая роль для «ведущий») — самый яркий фон,
  - `admin` — отдельный цвет,
  - `employee` — отдельный цвет,
  - regular user — нейтральный,
  - **own message** — отдельный класс highlight через сравнение `comment.user_id === auth.user.id` в `LiveEventComments`/`LiveEventQuestions`.
- Бейджи получают разные цвета (а не одинаковый `destructive/10`).
- «Ведущий» = админ, у которого `live_events.metadata.presenter_user_id === comment.user_id`. Если поле не задано — fallback к `admin`.

### PATCH 4 — Поле «Вопрос ведущему»: textarea + auto-grow

- Заменить `<Input>` в `LiveEventQuestions` (стр. 201–207) и `LiveEventComments` (стр. 201–207) на `<Textarea>` c:
  - `rows={1}`, `min-h-[40px]`, `max-h-[160px]`,
  - `onInput`-handler пересчитывает `style.height = scrollHeight`,
  - Enter без Shift → отправка, Shift+Enter → перенос.

### PATCH 5 — Mobile scroll комментариев/вопросов

- В `LiveEvent.tsx` (стр. 532): убрать жёсткий `maxHeight: 'calc(100vh - 120px)'` со стороны контейнера на mobile (только `lg:`), на mobile задать `h-[70dvh]` для Card.
- Цепочка: контейнер → `Card flex-1 min-h-0` → `Tabs h-full flex-col min-h-0` → `TabsContent flex-1 min-h-0 overflow-hidden` → внутренний `flex-1 overflow-y-auto`. Сейчас `min-h-0` пропущен на TabsContent — это и блокирует overflow на flex-cell.

### PATCH 6 — Moderation toggle: mute/unmute, remove/restore

- В `LiveInlineModeration.tsx`:
  - Добавить query: загрузить последние действия `live_event_room_moderation` для `messageUserId` за этот эфир → определить `currentMuteState`/`currentRemoveState`.
  - Превратить кнопки в **toggle**: если уже muted → действие `unmuted`, иначе `muted`. Аналогично `removed`/`restored`.
  - Tooltip и иконка отражают текущее состояние (`VolumeX`/`Volume2`, `UserX`/`UserCheck`).
- Аналогично fix в `LiveInlineModeration` для `delete` — после `delete` подтверждение (toast), без отдельного toggle (delete необратим).
- Reply public/private — уже работает корректно (отдельные ветки в `LiveEventReplies`), trace добавлю в console.

### PATCH 7 — Live-badge как dot-indicator + настройка показа

- Заменить текстовый Badge «Живой эфир» на компактный live-dot:
  - красная точка `animate-pulse` + текст «LIVE» в маленьком badge, tooltip «Живой эфир».
  - Показ управляется новым полем `metadata.live_badge_mode`: `auto` (default — показывать только при `platform_status='live'`), `always_show`, `hidden`. Поле редактируется в табе «Тема»/«Сценарий» в админке.
- Migration не нужна — поле в `metadata` jsonb.

### PATCH 12 — Regression block для Спринта 1

В отчёте отдельно подтвердить:

- blank screen не вернулся (network proof live-resolve),
- background return reload не вернулся,
- hook order crash не вернулся,
- comments/questions/replies работают,
- access-core/notifications не тронуты.

**DoD Спринта 1:** UI proof до/после по каждому патчу + console proof для CTA + regression-чек.

---

## Спринт 2 — Lifecycle 3-х состояний (PATCH 8, 9, 10, 11)

Структурный, требует миграции и edge-function. Запускается **только после approve Спринта 1** — так пользователь видит прогресс по UX и не зависит от тяжёлой части.

### PATCH 10/11 — Модель состояний `room_opened → live_started → webinar_completed`

- **DB migration** (add-only):
  - `live_events.room_state text default 'closed'` со значениями `closed | opened | live | completed`,
  - `live_events.room_opened_at timestamptz`,
  - `live_events.live_started_at timestamptz`,
  - `live_events.webinar_completed_at timestamptz`.
  - **БЕЗ** изменения существующего `platform_status` — он остаётся для совместимости с провайдером Kinescope. `room_state` — отдельная ось, отвечающая за UX комнаты, `platform_status` — за источник видео.
- **Триггер** (уже есть guard на downgrade `platform_status` пока `provider.stream_status='on-air'` — расширим аналогичный для `room_state`: запрет понижения).
- **Edge function `live-room-lifecycle**` (новая, тонкая) с действиями `open_room` / `start_live` / `complete_webinar`. Только staff/admin (JWT-actor).
- В `live-resolve` **не трогаем логику доступа**, но добавляем в response `room_state` (read-only поле). Это единственное локальное изменение в resolver — read-side, без рисков.
- В `LiveEvent.tsx` поведение:
  - `room_state='opened'` + `platform_status!='live'` → render комнаты **без плеера**, с placeholder «Эфир скоро начнётся, можно общаться», чат и вопросы активны.
  - `room_state='live'` или `platform_status='live'` → текущий рендер с плеером.
  - `room_state='completed'` → экран завершения / replay (если включён).

### PATCH 9 — Кнопки lifecycle в админке

- Заменить две кнопки («Запустить эфир»/«Завершить эфир») на **три**:
  - «Открыть комнату» (видна при `room_state='closed'`),
  - «Начать вебинар» (видна при `room_state='opened'` и `platform_status!='live'`; вызывает старый `enable_live_event` + новый `start_live`),
  - «Завершить вебинар» (видна при любом активном состоянии; danger-style + confirm-dialog с вводом слова `ЗАВЕРШИТЬ`).
- Добавить кнопку «Завершить вебинар» **в саму комнату** для staff/admin (только `isStaff`), с тем же confirm-dialog.

### PATCH 8 — Participant count

- Минимальный честный fallback v1: `SELECT COUNT(DISTINCT user_id) FROM live_event_comments WHERE live_event_id=... AND created_at > now() - interval '5 min'` через RPC. В отчёте явно зафиксировать: «v1 = активные авторы за последние 5 минут, не точный realtime presence».
- В UI комнаты: маленький счётчик у заголовка «N участников» с tooltip «активные авторы за последние 5 минут».
- v2 (отложено): полноценный Realtime Presence channel — отдельная задача после approve.

**DoD Спринта 2:** UI proof трёх состояний (closed → opened → live → completed), SQL proof значений `room_state`, edge proof вызовов, participant count видим.

---

## Спринт 3 — deferred (по запросу)

- Realtime Presence для точного participant count.
- «Ведущий» как полноценная роль с UI-выбором presenter_user_id из участников эфира.
- Полная стилизация sales-блоков по теме комнаты.
- Mobile keyboard-aware scroll-to-bottom при отправке.

---

## Файлы, которые будут затронуты

**Спринт 1** (без миграций):

- `src/pages/LiveEvent.tsx` — тема, mobile-scroll, live-badge, flex-цепочка.
- `src/components/live/LiveEventComments.tsx` — textarea, own-message highlight, presenter role.
- `src/components/live/LiveEventQuestions.tsx` — textarea, own-message highlight, forwardRef-фикс.
- `src/components/live/LiveRoleBadge.tsx` — расширенная палитра, presenter.
- `src/components/live/LiveInlineModeration.tsx` — toggle mute/remove.
- `src/components/live/LiveEventProductCta.tsx` — debug-лог.
- `src/components/admin/live/LiveEventProductCtaBindings.tsx` — empty-state.
- `src/components/admin/live/LiveEventThemeEditor.tsx` — поле `live_badge_mode`.

**Спринт 2** (миграция + edge):

- DB migration: `room_state`, `room_opened_at`, `live_started_at`, `webinar_completed_at` + триггер.
- `supabase/functions/live-room-lifecycle/index.ts` — новая.
- `supabase/functions/live-resolve/index.ts` — добавить `room_state` в payload (read-only).
- `src/pages/admin/AdminLiveEvents.tsx` — три кнопки lifecycle, confirm-dialog.
- `src/pages/LiveEvent.tsx` — рендер `room_state='opened'` без плеера.
- Новый компонент `src/components/live/LiveRoomEndButton.tsx` — кнопка завершения внутри комнаты.

---

## Формат финального отчёта (на каждый спринт)


| Бан | Root cause | Файл | Что изменено | UI proof | Runtime proof | Regression proof | Статус |
| --- | ---------- | ---- | ------------ | -------- | ------------- | ---------------- | ------ |


Никакого `fixed` без runtime-proof. Все critical actions защищены confirm.

## Что прошу подтвердить перед стартом

- Согласовать **очерёдность Спринт 1 → Спринт 2 → Спринт 3** (а не «всё разом»). Это даёт runtime-proof по каждому крупному блоку и не размывает фокус. Если нужно строго одной итерацией — ок, но тогда `webinar_completed` lifecycle получит меньше времени на verification.
- Подтвердить, что Сергей оставит OBS активным ещё ~10 минут после старта Спринта 1 для UI-proof темы/badge/moderation на живой комнате.