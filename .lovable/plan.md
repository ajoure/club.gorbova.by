# да, согласен, с учетом правок:

1. **Не добавлять глобальный** `glass` **variant в** `src/components/ui/button.tsx`**, если он нужен только для одной таблицы.**  
Это общий UI primitive. Для одного локального use-case лучше не расширять глобальный API кнопки без доказанной повторной потребности.  
Правильнее:
  &nbsp;
  &nbsp;
  - либо локальный `className`/utility preset внутри `RoomLifecycleActions`,
  - либо маленький локальный helper/class-map рядом с этим компонентом.  
  Иначе ради 3 кнопок мы загрязняем общий button-contract проекта.
2. **Если всё же нужен reusable glass-style, сначала проверить, уже нет ли в проекте готовых glass-токенов/utility-классов.**  
В плане уже есть ссылка на glass aesthetic из `index.css`, значит сначала reuse существующих токенов, а не новый variant “с нуля”.
3. **Часть A должна быть строго UI-only.**  
Зафиксируй явно:
  - не менять `callAction`,
  - не менять `canPerformAction`,
  - не менять invalidate/query flow,
  - не менять source of truth lifecycle.  
  Только visual layer admin-layout кнопок и локальный badge override.
4. `RoomLifecycleActions` **admin-layout**  
Помимо одинаковой высоты, нужно явно зафиксировать:
  - одинаковую минимальную ширину кнопок, чтобы они не “прыгали” по ширине;
  - одинаковое выравнивание иконок;
  - одинаковый межкнопочный gap;
  - аккуратный `flex-wrap` на узких ширинах без налезания на соседнюю колонку.
5. **Бейдж состояния**  
Локальный override — правильно. Но надо прямо указать, что:
  - pulse для `live` сохраняется;
  - semantic не теряется;
  - badge не должен визуально спорить с lifecycle-buttons по контрасту и насыщенности.  
  То есть мягче, но не “бесцветно”.
6. **Проверка на 768px**  
Добавь отдельно:
  - перенос кнопок не должен увеличивать высоту строки таблицы до неканоничного состояния;
  - если row становится слишком высокой, нужен компактный fallback layout внутри lifecycle-ячейки.
7. **Часть B / mobile regression**  
Хорошо, но не смешивай `/admin/live-events` mobile и `/live/:slug` mobile в один вывод без пометки контекста.  
В отчёте отдельно разделяй:
  - admin-table mobile;
  - live-room mobile.  
  Это разные surface и разные критерии.
8. **B2 / navigation**  
Для “edit dialog” корректнее писать не `back/forward между /admin/live-events и edit dialog`, а:
  - route/state restoration списка;
  - reopen/close edit dialog;
  - reload на списке;
  - reload в открытом edit-сценарии, если это поддерживается маршрутизацией.  
  Потому что dialog может быть не route-based.
9. **B3 / moderation**  
Если делаешь 1-session runtime, зафиксируй, что это проверяет только:
  - UI invoke;
  - optimistic state/update;
  - отсутствие client-side error.  
  Но **не подтверждает** межсессионное поведение. Это важно явно написать в итоговом отчёте.
10. **B5 / vertical scroll таблицы**  
Правильно не завышать статус. Если данных мало, ставить `partial: insufficient data`. Это оставить как жёсткое правило и не превращать в “passed by code review”.
11. **Финальный verdict**  
Добавь критерий:
  - если после UI-polish остаются только `partial` из-за environmental limitations и нет blockers/major runtime defects, production-acceptance допустим.  
  Иначе можно снова упереться в вечное “почти готово”.

&nbsp;

В остальном план хороший: он не расползается, держит scope, честно разделяет UI-polish и QA, и не пытается заново трогать бизнес-логику.

&nbsp;

План: PATCH FINAL-UI/QA — последний follow-up перед production-acceptance

## Scope

Это финальный follow-up. Два блока работы:

1. **UI-polish** — визуально дополировать lifecycle-кнопки в колонке таблицы `/admin/live-events`.
2. **QA** — закрыть оставшиеся `partial` пункты regression honestly (runtime где возможно, явный статус где нет).

После этого — **один** финальный verdict без новых итераций.

---

## Часть A — UI-polish lifecycle-кнопок в таблице эфиров

### Контекст

Текущий рендер кнопок в колонке Lifecycle (`RoomLifecycleActions` в режиме `layout="admin"`) визуально тяжёлый:

- `variant="default"` (Начать вебинар) — насыщенный синий primary;
- `variant="destructive"` (Завершить) — насыщенный красный;
- `variant="outline"` (Открыть комнату) — белый бордер;
- разный визуальный вес → нет ритма;
- не соответствует iOS-glass aesthetic (background `220 60% 97%`, glass tokens уже определены в `index.css`).

Бейдж состояния тоже добавляет визуального шума (`pulse` для live-состояния — ок, но `secondary`/`outline` выглядят чужеродно рядом с цветными кнопками).

### Что меняем

**Цель:** мягкая бледная палитра, единый ритм, glass-эффект, без потери смысловой иерархии (open / start / complete).

#### A1. Новый button variant `glass` в `src/components/ui/button.tsx`

Добавить вариант `glass` (не трогая существующие `default`/`destructive`/`outline`/`secondary`/`ghost`/`link`):

```ts
glass: "bg-white/60 backdrop-blur-md border border-white/40 text-foreground shadow-sm hover:bg-white/80 hover:shadow-md transition-all"
```

И semantic-вариации через `data-tone` атрибут (контролируемые в `RoomLifecycleActions` через `className`):

- нейтральная (open) — `text-foreground/80`;
- акцент (start) — лёгкий blue tint `text-primary`;
- destructive (complete) — лёгкий red tint `text-destructive/80`.

Это даёт **одинаковую визуальную форму** (glass surface) при сохранении смысловой подсказки через цвет иконки/текста, а не fill background.

#### A2. Унификация в `src/components/live/RoomLifecycleActions.tsx` (admin layout)

Только секция `layout === "admin"` (строки 110–179). Room layout не трогаем — там одна кнопка, политика та же.

Изменения:

- Все 3 кнопки → `variant="glass"`, `size="sm"`, **одинаковая фиксированная высота** (`h-9`), одинаковый padding, одинаковый ритм между ними (`gap-1.5`).
- Tone-классы для смысловой иерархии:
  - Открыть комнату → `text-foreground/80` (нейтральный);
  - Начать вебинар → `text-primary` + `[&_svg]:text-primary` (мягкий primary tint);
  - Завершить вебинар → `text-destructive/80` + `[&_svg]:text-destructive/80` (мягкий destructive tint, без насыщенного red fill).
- `disabled:` состояние через `disabled:opacity-40 disabled:bg-white/30` — приглушённое стекло, не visual noise.
- Hover: усиление glass (`hover:bg-white/80 hover:shadow-md`), без изменения цвета.
- Focus-ring остаётся через base button class (`focus-visible:ring-2 focus-visible:ring-ring`).

#### A3. Бейдж состояния — мягче

Сейчас `getRoomStateBadgeVM` возвращает `variant: "destructive"` для `live` — насыщенный красный. Это конфликтует с новой палитрой кнопок.

В `RoomLifecycleActions` (admin layout, строки 113–115) обернуть бейдж в обёртку с custom-классами:

- Заменить `<Badge variant={badge.variant}>` на `<Badge variant="outline" className={cn("bg-white/60 backdrop-blur-md border-white/40 text-foreground/80", badge.pulse && "text-destructive/80 border-destructive/30 animate-pulse")}>`.
- Это сохраняет pulse для live-состояния, но в мягкой glass-обёртке.
- `roomStateBadgeVariant` в `liveRoomLifecycle.ts` **не трогаем** — другие точки UI (admin-list table column, edit dialog header) могут зависеть от старой semantic. Override локальный.

### Что НЕ меняем

- `liveRoomLifecycle.ts` — source of truth, оставляем как есть.
- Room-layout кнопка (`layout === "room"`, строки 74–108) — там одна кнопка в полноэкранной комнате, glass там не уместен (нужна заметность).
- Логика `callAction`, `canPerformAction`, invalidateQueries — не трогаем (UI-only patch).
- Бейдж в других местах (admin table column, edit dialog) — не трогаем, только локальный override в `RoomLifecycleActions admin layout`.

### Файлы

- `src/components/ui/button.tsx` — добавить `glass` variant.
- `src/components/live/RoomLifecycleActions.tsx` — переписать admin layout (строки 110–179).

### Verify

Browser navigate к `/admin/live-events` на 1102×893, screenshot, zoom на колонку lifecycle, сравнить:

- одинаковая высота кнопок (h-9);
- одинаковый glass-фон;
- мягкие tint-цвета вместо fill;
- бейдж в той же палитре;
- disabled-состояние приглушено;
- hover работает.

Также проверить на 768px (узкий) — `flex-wrap` уже есть, кнопки должны переноситься аккуратно.

---

## Часть B — Финальный QA по оставшимся partial

Закрыть честно, без раздувания статуса.

### B1. Mobile regression (пункты 27–30)

- `browser--set_viewport_size` 375×812.
- Navigate `/admin/live-events`, проверить:
  - таблица скроллится горизонтально без слома углов;
  - lifecycle-кнопки переносятся через flex-wrap;
  - bulk actions bar не ломает layout;
- Navigate в edit dialog: tabs scroll работает, internal scroll панелей работает.
- Если есть тестовый эфир с публичной страницей `/live/:slug` — навигировать туда, проверить mobile sticky input в чате (ссылка на `LiveEventChat.tsx`).

**Статус после:** `passed` если runtime проходит, `partial` если нет тестовой комнаты с активной сессией.

### B2. Navigation / background return (пункт 33–34)

- `browser--act` back/forward в браузере между `/admin/live-events` и edit dialog.
- Reload через `navigate_to_sandbox` повторно — проверить, что состояние таблицы (column settings, фильтры) восстанавливается.
- Background return — невозможно через automation (нет фокуса/blur события); честно фиксируем как `partial: code-reviewed only` со ссылкой на `mem://features/webinars/session-stability-protocol`.

### B3. Moderation 2 окна (пункты 13–15)

- Browser-automation поддерживает 1 сессию. Сделать runtime-proof в 1 окне:
  - открыть moderation panel в edit dialog;
  - вызвать mute-action, проверить optimistic update;
- Code-review realtime channel в `useRoomModerationState.ts` (или эквиваленте) — подтвердить, что postgres_changes subscription корректна.
- Статус: `partial: 1-session runtime + code review`.

### B4. Provider degraded-mode (пункты 38–39)

- Невозможно вызвать без искусственного сбоя Kinescope.
- Code-review `live-event-lifecycle` edge function — подтвердить, что `provider.attempted && !provider.ok` → toast warning + fallback в audit_logs (логика уже видна в `RoomLifecycleActions.tsx` строки 59–63).
- Статус фиксируем явно: `partial: code-reviewed only`. Без runtime-имитации.

### B5. Vertical scroll таблицы (B1 smoke)

- Если в системе только 1 эфир — фиксируем как `partial: insufficient data for vertical scroll proof`, не выдаём за `passed`.
- Если эфиров достаточно (≥10 при дефолтной высоте таблицы) — runtime-проверка scroll внутри table-shell, sticky header остаётся приклеен.

---

## Часть C — Финальный verdict

Один отчёт со структурой:

1. **UI-polish результат** — screenshot до/после, подтверждение единого ритма.
2. **QA закрытие partial** — таблица 5 пунктов (B1–B5) с honest-статусом (`passed` / `partial: <reason>`).
3. **Файлы изменены** — список (ожидается 2: button.tsx, RoomLifecycleActions.tsx).
4. **Final verdict** — один из:
  - ✅ **Live-модуль принят для production** (UI-polish готов, partial-пункты закрыты с honest-статусом и приемлемыми ограничениями).
  - ❌ **Consolidated residual list** (если UI-polish не сошёлся или найден runtime-blocker).

---

## Ограничения

- 2-окна moderation, background return, degraded-mode — environmental limitations browser-automation, **не code-bug**. Зафиксировать как `partial` с обоснованием, не как `failed`.
- UI-polish субъективен — после patch делаем screenshot и принимаем визуально. Если не сходится с iOS-glass aesthetic из `index.css` — итерируем точечно (не более 1 раза).
- Никаких изменений в business logic, edge functions, database — это UI-only + QA patch.

## DoD

- Lifecycle-кнопки в admin-таблице эфиров: одинаковая высота, glass-эффект, мягкие tint-цвета, аккуратный disabled/hover.
- Бейдж состояния в той же палитре.
- 5 partial-пунктов закрыты с honest-статусом.
- Один финальный verdict выдан без новых итераций.