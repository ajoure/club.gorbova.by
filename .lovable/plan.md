# да, согласен, с учетом правок:

1. **PATCH 3.4 / mobile height**  
Не вводить расчёт `h-[calc(100dvh-var(--room-header-h,140px))]` как новый базовый layout без proof, что это не сломает desktop/tablet и встроенные контейнеры.  
Сначала сделать **локальный add-only mobile guard** только для узких viewport и только для sidebar/input зоны. Базовую высоту текущего room layout не переписывать глобально.
2. **PATCH 3.4 / visualViewport**  
Логику `visualViewport resize -> scrollToBottom` добавлять очень осторожно:
  &nbsp;
  &nbsp;
  - только для mobile;
  - только когда textarea/input в фокусе;
  - с debounce;
  - без принудительного скролла, если пользователь вручную читает старые сообщения.  
  Иначе можно сломать UX чтения. Нужен явный guard `only if near bottom before resize`.
3. **PATCH 3.5 / Tabs forceMount**  
`forceMount` для обоих табов — потенциально полезно, но это уже влияет на память, подписки и hidden DOM.  
Перед внедрением нужен mini-discovery:
  - какие realtime subscriptions живут в Comments;
  - какие в Questions;
  - не будет ли двойной активности/двойного polling/render cost.  
  Если оба таба уже держат активные подписки, `forceMount` вводить только после проверки, либо использовать локальное сохранение scroll state без постоянного mount обоих табов.
4. **PATCH 3.5 / React.memo player wrappers**  
Не просто “обернуть в memo”, а явно зафиксировать критерий сравнения:
  - `videoId` для video wrapper;
  - `embedUrl` для live embed;
  - theme/phase changes не должны размонтировать player, если source не изменился.  
  Это надо указать прямо, иначе патч останется слишком общим.
5. **PATCH 3.1 / off-room fallback states**  
Правильно, что не все full-screen fallback надо тематизировать.  
Но это надо зафиксировать как правило:
  - `waiting/live/completed/replay` — themed;
  - `access denied / removed / session expired / revoked / generic error` — neutral system states.  
  Иначе подрядчик может начать насильно тянуть theme туда, где это не нужно.
6. **PATCH 3.1 / textarea styling**  
В плане есть theme для textarea/input, но нужно явно добавить:
  - placeholder color через `--room-text-secondary`;
  - disabled/readOnly states;
  - caret color = accent/text compatible.  
  Иначе останутся мелкие дефолтные хвосты.
7. **PATCH 3.3 / CTA sidebar max-height**  
`max-h-[40vh] overflow-y-auto` для sidebar CTA — норм как идея, но только если:
  - не ломает порядок “чат выше CTA / CTA выше чата” в текущем layout;
  - не создаёт второй неудобный nested-scroll рядом с чатом на desktop.  
  Нужен guard: desktop и mobile проверить отдельно. Не делать жёсткий `40vh` без адаптивной проверки.
8. **PATCH 3.2 / role hierarchy**  
Зафиксировать единый приоритет явно в одном SoT:  
`presenter > admin > employee > own > user`.  
И использовать его не только для message highlight, но и для reply-preview/quoted-state, чтобы не было второй локальной логики.
9. **PATCH 3.7 / LiveBadge**  
Формулировку уточнить: не “убрать из header”, а **не дублировать LIVE-сигнал в header, если там уже есть lifecycle badge**.  
Если в текущем UX есть отдельный load-bearing индикатор LIVE в header, его нельзя удалить без mapping old -> new. Нужен явный mapping и проверка, что смысл не потерян.
10. **PATCH 3.6 / regression checklist**  
В checklist добавить отдельные пункты:
  - `opened -> live` без сброса scroll/chat/questions/session;
  - degraded provider scenario не только по audit, но и по UI-поведенческому результату;
  - save формы не меняет lifecycle-state;
  - lifecycle-action не перетирает theme/CTA/settings.
11. **PATCH 3.5 / participant polling**  
Если добавляется visibility-pause, зафиксировать отдельно:
  - `live-resolve` polling можно паузить в скрытой вкладке;
  - heartbeat/presence логика не должна быть случайно выключена тем же механизмом, если она нужна для active session.  
  Нельзя одним общим хелпером нечаянно “усыпить” то, что должно продолжать жить.
12. **Изменяемые файлы**  
Добавить в план явную проверку `LiveEventQuestions.tsx` на parity не только sticky/safe-area, но и input/theme/empty-state/submit-button, чтобы comments/questions реально стали симметричными.

&nbsp;

В остальном план хороший: scope удержан, новых параллельных контуров нет, Sprint 1–2 не пересобираются, а дополировываются.

&nbsp;

План: Sprint 3 — финальный UX/polish и боевая доводка live-room

## Discovery (что уже есть, не дублируем)

- **Тема:** `.live-room-themed` + CSS-переменные `--room-bg/text/text-secondary/panel/accent/tabs/admin-badge/employee-badge` (`liveRoomTheme.css`). Применяется на root, header, чат-панель, табы, message-text, meta-text, input-обёртку. **Не покрыты:** waiting-state, ended/replay-state, source_unavailable, removed_from_room, scheduled, error, фокус/border textarea, кнопка Send, сам Textarea (использует `bg-background`), ScrollArea-bar, sticky bottom (`bg-background` хардкод в LiveEventComments:248), CTA-карточки (`<Card>` shadcn → дефолтный bg).
- **Роли:** `LiveRoleBadge.tsx` — единый SoT с 4 ролями (presenter/admin/employee/user), highlight + badge classes. Sprint 1 уже развёл цвета. Полировать только мелочи (reply-state, dark/light читаемость).
- **Polling:** `dataRef.current` уже защищает от ре-маунта при resolve refresh; `hasAccessToken` как primitive не дёргает effect на TOKEN_REFRESHED. **Дёргается:** `useHasActiveCtaBindings` без `staleTime` на `["cta-bindings-exists"]` (есть 60s), но `useActiveParticipants` polling 20s + invalidate всей room — проверить scope.
- **Mobile:** sticky input + safe-area уже есть в `LiveEventComments.tsx:248-253`, `LiveAutoGrowTextarea` корректный. **Не покрыто:** аналогичный sticky/safe-area в `LiveEventQuestions.tsx` (проверить parity), `h-[70dvh]` для сайдбара на mobile может конфликтовать с клавиатурой (нужно `dvh` уже стоит — ок, но CTA в сайдбаре + чат вместе могут переполнять).
- **Lifecycle SoT:** `liveRoomLifecycle.ts` (Sprint 2) — единый mapper. Используется в admin/cabinet/room. Не трогаем логику, только consistency проверки.

---

## PATCH 3.1 — полное покрытие темы (add-only в `liveRoomTheme.css`)

Добавить scoped правила под `.live-room-themed`:

- **Textarea/Input:** `.room-panel-input textarea, .room-panel-input input` — `background-color: var(--room-panel)`, `color: var(--room-text)`, `border-color: color-mix(in srgb, var(--room-text) 15%, transparent)`, focus-ring через `--room-accent`.
- **Send button (ghost):** `.room-panel-input button:hover` — `background: color-mix(--room-accent 10%, transparent)`.
- **Sticky bottom wrapper:** заменить `bg-background` в `LiveEventComments.tsx:248` и `LiveEventQuestions.tsx` (аналог) на класс `room-panel-sticky` → `background-color: var(--room-panel, hsl(var(--card)))`.
- **CTA card:** новый класс `.room-cta-card` для `<Card>` в `LiveEventProductCta.tsx` и `LiveEventRoomBlocks.tsx` → `var(--room-panel)` + accent для CTA-кнопки.
- **Empty/loading states чата и вопросов:** `room-meta-text` уже применён, добавить `room-empty-state` с большим padding и иконкой в тон.
- **Waiting state:** `RoomWaitingState.tsx` — заменить `bg-muted` / `text-foreground` / `bg-primary/10` на room-tokens (`room-panel`, `room-title`, accent badge).
- **Полноэкранные fallback-состояния** (`scheduled`, `ended_no_replay`, `source_unavailable`, `removed_from_room`, `error`, `session_expired`, `session_revoked`): сейчас рендерятся **до** обёртки `.live-room-themed`, без темы. Не оборачиваем их в room-theme (это off-room экраны), но для `ended_no_replay` (replay-state) и `scheduled` сделать опциональную обёртку с темой, если она уже в `dataRef` — иначе остаётся neutral.
- **ScrollArea-thumb:** scoped правило `.live-room-themed [data-radix-scroll-area-thumb]` → `bg: color-mix(--room-text 25%, transparent)`.

DoD: дефолтный grey-bg не выпадает ни на одном видимом элементе комнаты при выставленной теме.

---

## PATCH 3.2 — финальная иерархия сообщений и ролей

`LiveRoleBadge.tsx`:

- **Reply-state:** добавить новый класс `getReplyStateClass()` — лёгкий left-indent + `border-l border-l-muted-foreground/20`, чтобы reply визуально отделялся от parent message без конфликта с role highlight.
- **Own message:** уже есть `getOwnMessageClass()`. Усилить: если own + presenter → presenter highlight выигрывает (presenter > admin > employee > own > user). Зафиксировать приоритет в одной функции `resolveMessageHighlight({ isOwn, role })`.
- **Reply preview (quoted):** в `LiveEventReplies.tsx` добавить класс `room-reply-quote` — `bg: color-mix(--room-panel 50%, transparent)`, `border-l-2 border-l-room-accent`, маленький font.
- **Dark/light читаемость:** все текущие role-classes используют `text-{color}-600 dark:text-{color}-400` — оставить, добавить fallback `text-room-text` если custom theme override.

DoD: 5 типов сообщений (user/own/admin/employee/presenter) + reply-quote визуально различимы и читаемы.

---

## PATCH 3.3 — polish CTA

В `LiveEventProductCta.tsx` и `LiveEventRoomBlocks.tsx`:

- Применить `.room-cta-card` класс (PATCH 3.1).
- Унифицировать spacing: `gap-3 p-3 md:p-4` для всех CTA-карточек, `mb-2` между несколькими CTA.
- Mobile: `under_video` CTA — full-width, `sidebar` CTA — `max-h-[40vh] overflow-y-auto` чтобы не съедал чат.
- Empty-state без CTA: уже корректно (компонент возвращает `null`). Проверить что `useHasActiveCtaBindings` не вызывает лишний placeholder div в `LiveEvent.tsx:546-553`.
- CTA-кнопка: `bg-room-accent text-room-bg` через CSS-var, hover — `accent + 10% opacity`.

DoD: CTA выглядит частью комнаты, не ломает sticky input, на mobile sidebar-CTA скроллится отдельно от чата.

---

## PATCH 3.4 — финальная mobile-доводка

- **Questions parity:** в `LiveEventQuestions.tsx` повторить sticky bottom + `safe-area-inset-bottom` + `room-panel-sticky` класс как в Comments.
- **Sidebar высота:** заменить `h-[70dvh]` на `h-[calc(100dvh-var(--room-header-h,140px))]` — CSS-var `--room-header-h` выставляется на `.live-room-themed` через `style` (140px desktop / 110px mobile), чтобы клавиатура не перекрывала input.
- **Auto-scroll:** при открытии клавиатуры в Comments — детектить `visualViewport` resize и удерживать `scrollTop = scrollHeight` через 200ms debounce.
- **Длинные сообщения:** `break-words whitespace-pre-wrap` уже стоит, добавить `max-w-full overflow-wrap-anywhere` на `.room-message-text`.
- **CTA на mobile:** sticky-CTA не блокирует input — проверить z-index (input z-10, CTA — без sticky на mobile, только в потоке).

DoD: mobile комната стабильна, sticky input не перекрывается клавиатурой, чат и вопросы ведут себя одинаково.

---

## PATCH 3.5 — performance / анти-дёргание

- `**useHasActiveCtaBindings`:** добавить `staleTime: 60_000` (уже есть) + `refetchOnWindowFocus: false` — чтобы возврат во вкладку не ре-фетчил CTA.
- `**useActiveParticipants`:** убедиться что `useVisibilityPolling(20_000)` используется (если нет — добавить), invalidate scope только `["live-active-participants", eventId]`, **не** инвалидировать комнату.
- **resolve polling:** уже `12s` + AbortController + dataRef-guard. Добавить `useVisibilityPolling` обёртку, чтобы при скрытом табе polling паузился (heartbeat остаётся активным до browser-suspend).
- **Tab content:** `<TabsContent>` уже использует `forceMount={false}` дефолтно — Radix размонтирует inactive tab. Добавить `forceMount` чтобы чат и вопросы оба остались в DOM (не теряют scroll position при переключении). Подписка realtime тоже не пересоздаётся.
- **Player wrapper:** `KinescopePlayerWrapper` ре-маунтится только при смене `videoId`. `LiveEmbedPlayer` — при смене `embedUrl`. Обернуть в `React.memo` с поверхностным сравнением.
- **Phase transition `waiting → live`:** сейчас при переходе меняется `state`, но root `<div className="live-room-themed">` остаётся — чат/CTA/header не размонтируются. Только колонка плеера переключается с `RoomWaitingState` на player. Это уже корректно — добавить comment в коде, чтобы будущие правки не сломали.

STOP-guard: не вводить новый state-manager, не менять структуру компонентов.

DoD: при polling нет ре-маунтов, переключение табов сохраняет scroll, переход waiting→live меняет только player-колонку.

---

## PATCH 3.6 — финальный regression checklist (документ)

Создать `docs/SPRINT_FINAL_REGRESSION.md` с единым checklist (без кода):

1. Lifecycle: `closed → opened → live → completed` через 3 кнопки в админке + кнопка завершения в комнате.
2. Waiting-state: пользователь заходит в `opened`, видит чат/вопросы/CTA/тему, плеера нет.
3. Chat / Questions / Replies: отправка, realtime, threaded reply, длинный текст.
4. Moderation 2 окна: mute/unmute + remove/restore (Sprint 1 deferred).
5. CTA visibility / mobile.
6. Theme apply: 8 CSS-переменных применяются ко всем элементам PATCH 3.1.
7. Participant count v1.
8. Role colors / hierarchy: 5 типов сообщений + reply.
9. Mobile regression: sticky input, клавиатура, длинные сообщения, sidebar scroll.
10. Button sync во время live-save (Sprint 2 deferred).
11. Back/forward navigation room ↔ list ↔ edit.
12. Background return / reload — нет ре-маунта плеера и чата.
13. Replay-state + theme.
14. Provider degraded-mode: Kinescope упал, lifecycle перешёл, audit с `degraded:true`.

DoD: документ существует, все Sprint 1+2 deferred включены.

---

## PATCH 3.7 — финальная sync-проверка label/badges

- Проверить что в `AdminLiveEvents.tsx` (список + карточка), `LiveEvents.tsx` (cabinet), `LiveEvent.tsx` (room header) используются **только** `roomStateLabels` / `roomStateShortLabels` / `getRoomStateBadgeVM` из `liveRoomLifecycle.ts`. Никаких локальных строк.
- `platform_status` badge остаётся как **provider-уровень** (рядом с `room_state`) — добавить tooltip «Источник видео» чтобы не путать с lifecycle.
- Replay-state: если `room_state = completed` + `replay_enabled = true` → label «Запись доступна» (единый), если без replay → «Эфир завершён».
- `LiveBadge` (mode `auto/live/off`) — оставить только для player-area (внутри плеера), убрать из header (там уже `roomBadgeVM` badge).

DoD: одна терминология, нет визуального конфликта между `room_state` и `platform_status`.

---

## Изменяемые файлы

**Новые:**

- `docs/SPRINT_FINAL_REGRESSION.md` (PATCH 3.6)

**Изменяемые (add-only, без удаления существующих веток):**

- `src/components/live/liveRoomTheme.css` (PATCH 3.1 — расширение scoped правил)
- `src/components/live/LiveRoleBadge.tsx` (PATCH 3.2 — `resolveMessageHighlight`, reply-quote class)
- `src/components/live/LiveEventReplies.tsx` (PATCH 3.2 — применить reply-quote)
- `src/components/live/LiveEventComments.tsx` (PATCH 3.1/3.4/3.5 — `room-panel-sticky` класс, `forceMount`, visualViewport scroll)
- `src/components/live/LiveEventQuestions.tsx` (PATCH 3.1/3.4 — parity sticky/safe-area)
- `src/components/live/LiveEventProductCta.tsx` (PATCH 3.1/3.3 — `room-cta-card`, mobile spacing)
- `src/components/live/LiveEventRoomBlocks.tsx` (PATCH 3.1/3.3 — `room-cta-card`)
- `src/components/live/RoomWaitingState.tsx` (PATCH 3.1 — room-tokens)
- `src/hooks/useActiveParticipants.ts` (PATCH 3.5 — `useVisibilityPolling`)
- `src/pages/LiveEvent.tsx` (PATCH 3.4/3.5/3.7 — CSS-var `--room-header-h`, visibility polling, badge consistency, `forceMount` на TabsContent)
- `src/pages/admin/AdminLiveEvents.tsx` (PATCH 3.7 — tooltip для `platform_status`, единые label)
- `src/pages/LiveEvents.tsx` (PATCH 3.7 — completed/replay label единый)

---

## DoD Sprint 3

- Все 8 CSS-переменных темы применяются: header, чат, вопросы, textarea, табы, CTA, waiting, replay, empty-state.
- 5 типов сообщений + reply визуально различимы, не теряют читабельность в light/dark.
- CTA polished: spacing, mobile, не ломает sticky input.
- Mobile: sticky input + safe-area в Comments **и** Questions, sidebar высота через CSS-var, длинный контент скроллится.
- Polling тихий: visibility-pause, AbortController, dataRef-guard, `forceMount` табов, memo плееров.
- Final regression checklist задокументирован, все Sprint 1+2 deferred включены.
- `room_state` и `platform_status` визуально разведены, label единый через `liveRoomLifecycle.ts`.
- Sprint 1+2 не сломаны: lifecycle actions, waiting-state, participant count, moderation banner, role badges, theme — всё работает как раньше.

## Deferred → финальный regression после Sprint 3

Не плодим новые. Все из Sprint 1+2 (moderation 2 окна UI proof, button sync во время live-save, back/forward navigation, background return) идут в единый regression PATCH 3.6.