# Да, согласен, с учетом правок:

1. В verify по реакциям исправь критерий:
  &nbsp;
  &nbsp;
  - проверять нужно, что реакции **не пишутся в** `live_event_comments` **/** `live_event_questions`;
  - рост в `live_event_reactions` — это **нормально**, потому что bar отправки как раз пишет туда.  
  Текущая формулировка про `live_event_reactions ... без неожиданного роста` неверная.
2. По rail реакций зафиксируй норму ещё жёстче:
  - **только bottom-right rail**;
  - ширина `72–96px`;
  - высота активной зоны не больше `30–35%` высоты video-shell;
  - без случайного `left`, без drift, без появления выше средней линии видео;
  - максимум `5` desktop / `3` mobile одновременно;
  - одинаковые реакции агрегируются в `×N`.
3. В acceptance для overlay добавь явный критерий:
  - rail не должен пересекать центральные `40%` ширины видео;
  - rail не должен выходить за границы video-shell;
  - overlay контейнер обязан быть дочерним элементом именно video-shell, а не общего layout.
4. По player stability:
  - сначала discovery обязан доказать, что remount/re-render реально идёт от UI-state;
  - если у текущего wrapper нет штатного `onError` / retry API, **soft reconnect не делать** и не имитировать remount’ами;
  - тогда в этом патче оставить только `React.memo`, stable props/callbacks и key-guard;
  - silent reconnect в этом случае вынести в follow-up PATCH отдельным пунктом.
5. Временное `console.log('[player-shell] mount')` допустимо только как proof-инструмент, но:
  - в финальном diff его быть не должно;
  - в отчёте отдельно указать, что инструментирование добавлялось временно и удалено до сдачи.
6. Mobile verify уточнить:
  - composer должен быть виден **без дополнительного скролла** на первом экране;
  - скроллится только messages area;
  - tabs/header/composer не прыгают при открытии клавиатуры;
  - video остаётся видимым хотя бы частично в верхней зоне при focus на input.
7. По T1-regression:
  - `LiveEventRoomBlocks.tsx` повторно **не трогать**, если регрессии нет;
  - regression proof допустим, но без лишней архитектуры и без постоянных dev-route;
  - в отчёте отдельно: `T1 checked / no code changes required` либо `T1 checked / direct relation proven / file changed`.
8. Stop-guards дополни:
  - не менять `LiveRoomReactionsBar.tsx`, если для rail это не требуется;
  - не менять `LiveEventRoomBlocks.tsx`, кроме случая доказанной прямой связи с rail/mobile;
  - не трогать submit/write path реакций в БД;
  - не добавлять миграций и edge-правок в этом патче.
9. В финальном отчёте добавь отдельный блок:
  - **что доказано живыми скриншотами/UI**;
  - **что доказано только кодом/DOM/network**;
  - **что вынесено в follow-up** и почему.
10. В секции proof поправь SQL-пункт:

- вместо проверки `live_event_reactions` на отсутствие роста используй:
  - `live_event_comments` не увеличились;
  - `live_event_questions` не увеличились;
  - `live_event_reactions` увеличились ожидаемо на число отправленных реакций или больше/меньше только в рамках агрегации UI, но без записи в чат.

Если подрядчик это учтёт, план можно запускать.

&nbsp;

План: PATCH стабилизации вебинарной комнаты (reactions / player / mobile)

## Discovery (что уже прочитано)

- `src/components/live/LiveRoomReactionsOverlay.tsx` — overlay сейчас `absolute inset-0`, разлёт по ширине, opacity 1, без агрегации, размер `text-3xl/4xl`.
- `src/hooks/useLiveReactionOverlayStream.ts` — INSERT-стрим, MAX=30, TTL=3000, без агрегации.
- `src/components/live/liveRoomTheme.css` — изолированная темизация под `.live-room-themed`.
- `src/hooks/use-mobile.tsx` — breakpoint 768.
- `src/components/live/LiveRoomReactionsBar.tsx` — bar реакций (не трогаем).

## Discovery to-do (выполнить в Execute ДО любых правок)

1. `code--list_dir src/components/live` — найти runtime room page, player wrapper, composer, video-shell.
2. `code--search_files "LiveRoomReactionsOverlay"` — найти точку монтирования overlay (требование: должен быть **внутри** video-shell, не у layout root).
3. `code--search_files "Kinescope|iframe|HlsPlayer"` в `src/components/live` — определить player wrapper и его пропсы.
4. Прочитать runtime room page целиком — определить mobile/desktop ветвление и текущую композицию.
5. Прочитать player wrapper — есть ли `key`, зависящий от UI-state; есть ли `onError`/штатный retry hook.

**Условные ветки по результатам discovery:**

- Если overlay уже внутри video-shell → правим только сам overlay.
- Если overlay снаружи → переносим точку монтирования внутрь video-shell (правка в room page).
- Если у player wrapper нет штатного error API / SDK → soft reconnect **НЕ делаем**, выносим в follow-up. Оставляем только memo + key guard + stable callbacks.

---

## PATCH-план (add-only, минимально инвазивно)

### Часть 1. Reactions overlay — bottom-right rail внутри video-shell

**Файл:** `src/components/live/LiveRoomReactionsOverlay.tsx`

- Контейнер: `absolute right-2 md:right-3 bottom-3 md:bottom-4 w-[72px] md:w-[96px] h-[32%] pointer-events-none overflow-hidden z-20 flex flex-col-reverse items-center gap-1`.
  - `flex-col-reverse` — новые снизу, уходят вверх.
  - Высота 32% video-shell (в норме 30–35%).
  - Центр видео физически не затрагивается.
- Без `left`, без `drift`, без горизонтального разлёта.
- Размер: `text-xl md:text-2xl`. Opacity: `0.55`. Тень: `drop-shadow(0 1px 2px rgba(0,0,0,0.35))`.
- TTL: 2600ms (синхронно с CSS).
- Бейдж `×N` рядом с emoji при `count > 1`: `<span class="text-[10px] font-semibold opacity-80 ml-0.5">×{count}</span>`.

**Файл:** `src/hooks/useLiveReactionOverlayStream.ts`

- Тип `FloatingReaction`: добавить `count: number`, `lastUpdatedAt: number`.
- Окно агрегации: `AGGREGATION_WINDOW_MS = 800`.
- Логика: при INSERT того же `emoji`, если последний активный элемент с тем же emoji обновлялся < 800ms назад — `count++`, `lastUpdatedAt = now`. TTL **не продлеваем** (визуальная стабильность).
- Хук принимает `isMobile?: boolean` (передаётся из overlay через `useIsMobile()`).
- Лимиты: `MAX_DESKTOP = 5`, `MAX_MOBILE = 3`. При превышении — drop старейших.
- Пишем **только в локальный state** — никаких `INSERT` в `live_event_reactions`/`comments`/`questions`. Это уже соблюдается, фиксируем явно.

**Гарантия позиционирования:** в discovery шаг 2 проверить вложенность overlay. Если overlay вне video-shell — перенести (точечная правка JSX в room page).

---

### Часть 2. Player stability — только то, что доказуемо без backend

**Файл:** player wrapper (определить в discovery).

Действия (только при подтверждении в discovery):

1. **Memo guard:** обернуть player container в `React.memo` со сравнением только по `sourceUrl`, `provider`, `isLive`, `eventId`. UI-состояние (tabs, reactions, новые сообщения) **не должно** проходить через props плеера.
2. **Key guard:** убрать любые `key={tab}` / `key={reactionsCount}` у iframe/video. Разрешён только `key={sourceUrl}` или отсутствие key.
3. **Callback stability:** `onEvent`/`onReady`/`onError` стабилизировать через `useCallback` с минимальным deps в родителе.
4. **Silent retry:** **только если** у wrapper уже есть штатный `onError` hook. Тогда — локальный retry 1s → 2s → 4s, max 3 попытки **внутри wrapper**, без remount комнаты. Banner показывать после 3-й неудачи.
5. **Если штатного error API нет** → soft reconnect **НЕ имитируем**. Явно фиксируем в финальном отчёте как **follow-up PATCH**.

**Stop-guards в этой части:**

- НЕ трогаем `LiveEvent.tsx` session refresh memoization (mem://features/webinars/session-stability-protocol).
- НЕ трогаем `live-resolve` edge function.
- НЕ меняем провайдера, ABR не дублируем.
- НЕ добавляем костылей-ремоунтов.

---

### Часть 3. Mobile UX — sticky composer + 100dvh + scroll-area

**Файл:** runtime room page (определить в discovery), под `useIsMobile() === true`:

Структура:

```
[root: room-mobile-shell — h-[100dvh] flex flex-col]
  [video shell]    shrink-0, aspect-video, position:relative (хост overlay)
  [reactions bar]  shrink-0
  [tabs header]    shrink-0
  [messages area]  room-mobile-scroll (flex-1 min-h-0 overflow-y-auto)
  [composer]       room-mobile-composer (sticky bottom-0 + safe-area)
```

**Файл:** `src/components/live/liveRoomTheme.css` — добавить **новые** классы (существующие не трогаем):

```css
.room-mobile-shell {
  height: 100dvh;
  display: flex;
  flex-direction: column;
}
.room-mobile-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.room-mobile-composer {
  position: sticky;
  bottom: 0;
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--room-panel, hsl(var(--background)));
  border-top: 1px solid color-mix(in srgb, var(--room-text, hsl(var(--foreground))) 10%, transparent);
}
```

Keyboard guard: `100dvh` сам корректно отрабатывает появление клавиатуры — JS-логика не нужна.

**Desktop:** не трогаем, изменения только в mobile-ветке.

---

### Stop-guards (что НЕ трогаю)

- `supabase/functions/*` — ноль изменений.
- DB / migrations / `live_event_reactions` / `live_event_comments` / `live_event_questions` / `live_event_room_blocks` — ноль изменений.
- `LiveEntryDialog`, privacy flow, pre-start, sales-blocks, table-shell, admin tables.
- Submit-логика чата/вопросов.
- `LiveEventRoomBlocks.tsx` — **не трогаю** (T1 был починен в прошлом проходе, прямой связи с новым rail/mobile нет).
- `LiveEvent.tsx` session refresh logic.
- `LiveRoomReactionsBar.tsx` — bar отправки, не входит в scope overlay.
- Провайдер видео, ABR, `live-resolve`.

---

### Файлы под изменение (ожидаемо)

1. `src/components/live/LiveRoomReactionsOverlay.tsx` — bottom-right rail, opacity, count badge, размер, без drift.
2. `src/hooks/useLiveReactionOverlayStream.ts` — агрегация по emoji+window, лимиты по платформе, count.
3. `src/components/live/liveRoomTheme.css` — 3 новых класса (`room-mobile-shell` / `room-mobile-scroll` / `room-mobile-composer`).
4. **[discovery]** Runtime room page — mobile flex-column layout + (условно) перенос overlay внутрь video-shell.
5. **[discovery, условно]** Player wrapper — `React.memo` + key guard + stable callbacks. Soft reconnect — только при штатном error API.

---

### Verify / DoD

**Reactions proof:**

- Desktop: 10 одинаковых эмодзи подряд → один пузырь с `×10` в правом нижнем rail. Скриншот.
- Desktop: 5 разных серией → вертикальный стек ≤5, без горизонтального разлёта. Скриншот.
- Mobile (375×812): стек ≤3, rail 72px, центр видео и зона ведущего свободны. Скриншот.
- DOM-проба: overlay контейнер физически вложен в video-shell (`document.querySelector` цепочка в DevTools), `pointer-events: none` подтверждён.
- DOM-переход 0 → ≥1 → 0 наблюдается в Elements panel (через TTL).
- SQL-проверка: `select count(*) from live_event_reactions where created_at > now() - interval '2 minutes'` до и после серии overlay-only взаимодействий — без неожиданного роста (overlay только читает realtime, не пишет).

**Player stability proof:**

- Временное инструментирование: `console.log('[player-shell] mount', Date.now())` в effect c `[]` deps в player wrapper.
- Сценарий: переключение табов 10 раз подряд → ровно **1** mount-лог.
- Сценарий: 20 реакций подряд → ровно **1** mount-лог.
- После proof — `console.log` удалить тем же патчем.
- Если soft reconnect не реализуем → явно зафиксировать в отчёте секцией follow-up.

**Mobile UX proof (375×812):**

- Скриншот idle: на первом экране одновременно видны video, reactions bar, tabs header, composer.
- Скриншот с фокусом на input: composer прижат к низу клавиатуры, video остаётся видимым в верхней части (не исчезает полностью), layout не "прыгает".
- Скриншот скролла messages: скроллится только messages area; video, tabs, composer — на месте.

**T1 regression check (без правок файла):**

- Создать временный banner+text блок (миграция add-only, `proof_tag='REGRESSION-T1-RAIL-PATCH'`) с длинной строкой без пробелов.
- Скриншот: текст переносится, layout не ломается, overflow не возвращается.
- Cleanup миграцией строго по `proof_tag`.
- Если регрессии нет — `LiveEventRoomBlocks.tsx` повторно **не трогаем**, явно зафиксировать в отчёте.

---

### Финальный отчёт (4 секции)

1. **Reactions overlay** — changed files, что изменено, скриншоты desktop/mobile, DOM-вложенность, SQL count-сверка.
2. **Player stability** — changed files, mount-counter proof (tabs ×10 → 1 mount, реакции ×20 → 1 mount), что НЕ удалось доказать локально и вынесено в follow-up (если применимо).
3. **Mobile UX** — changed files, 3 скриншота (idle / focused / scroll messages).
4. **Regression / что не тронуто** — T1 проверен (banner/text overflow в норме, файл не менялся повторно), явный список stop-guards.

---

### Follow-up PATCH (только при необходимости из discovery)

Если у текущего player wrapper нет штатного error API / SDK для soft reconnect:

- Локально стабилизировано: memo, key-guard, stable callbacks.
- Не реализовано без provider-level доступа: programmatic retry, ABR-tuning, network-level recovery.
- Эти пункты выносятся отдельной задачей с явной пометкой требуемого scope (Kinescope SDK / провайдерский API).