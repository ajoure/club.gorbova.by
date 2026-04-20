# да, согласен, с учетом правок:

1. **Часть A — не только tint фона, но и одинаковая сетка внутри lifecycle-ячейки.**  
Зафиксируй явно:
  &nbsp;
  &nbsp;
  - одинаковая высота `h-9`;
  - одинаковая минимальная ширина;
  - одинаковый внутренний gap;
  - одинаковое выравнивание иконок и текста;
  - `flex-wrap` не должен раздувать строку таблицы до некрасивой высоты.  
  Если на 768px row становится слишком высокой, нужен компактный fallback внутри lifecycle-ячейки.
2. **Часть A — бейдж состояния.**  
Локальный override правильный, но нужно явно сохранить:
  - `pulse` только для `live`;
  - читаемость текста на tinted фоне;
  - отсутствие конфликта между бейджем и тремя кнопками по насыщенности.  
  То есть бейдж должен быть тише кнопок, а не спорить с ними.
3. **Часть B — layout комнаты.**  
`max-w-[1600px]` выглядит разумно, это лучше, чем сразу full-bleed.  
Но добавь в Verify отдельную проверку:
  - на 1920px чат не уезжает слишком далеко вправо;
  - на 1102px фиксированный sidebar не становится слишком узким;
  - CTA под видео не ломает высоту player-колонки.  
  И отдельно зафиксируй, что `lg:self-start`/единая верхняя линия не должна ломать waiting-state и replay-state.
4. **Часть B — чат справа.**  
Нужно явно проверить не только `comments`, но и `questions` в этом новом layout.  
Иначе можно выровнять чат, а соседняя вкладка вопросов останется с другой высотой/ритмом.
5. **Часть C — анонимные вопросы.**  
Поддерживаю. Но текст hint-а лучше сделать ещё короче и нейтральнее:
  - «🔒 Анонимные вопросы. Их видят модераторы и ведущий.»  
  Этого достаточно. Без лишней второй фразы про чат, если она визуально перегружает блок.
6. **Часть D — безопасность клика по участнику.**  
Здесь всё правильно, но добавь прямой verify-пункт:
  - для non-staff проверить не только отсутствие `cursor-pointer`, но и отсутствие интерактивных aria/button/link-ролей на имени/аватаре;
  - для staff — клик действительно открывает `ContactDetailSheet`.  
  То есть security-check должен быть и визуальный, и DOM-поведенческий.
7. **Часть D — минимизация данных.**  
Хорошо, что ты ограничил поля. Зафиксируй ещё жёстче:
  - если legacy fallback через `profiles` нужен только для `avatar_url`, не тянуть `full_name/first_name/last_name` из `profiles`, если snapshot `author_display_name` уже есть;
  - snapshot/display-name остаётся основным SoT для имени автора сообщения.
8. **Часть E — room-layout кнопка.**  
Поддерживаю glass destructive tint и синхронизацию формы с admin-кнопками.  
Но проверь на тёмном themed-room фоне, что контраст не проседает.  
То есть verify должен быть не только на дефолтной комнате, но и на кастомной тёмной теме.
9. **Verify после реализации**  
Добавь ещё два обязательных пункта:
  - `questions` и `comments` обе вкладки показывают аватары одинаково;
  - для non-staff нет утечки интерактивности на имени/аватаре ни в чате, ни во вкладке вопросов.
10. **Итоговый DoD**  
Добавь явный пункт:
  - никакие admin/staff-only данные и действия не стали доступны обычным участникам после патча.

&nbsp;

В остальном план хороший: scope чистый, backend не трогается, security по профилям сформулирована правильно, и исправляется именно то, что просили — цветные glass-кнопки, layout комнаты, анонимные вопросы и аватары.

&nbsp;

План: финальная полировка lifecycle-кнопок (admin) + переработка вебинарной комнаты

## Scope

UI-only patch. БД, edge functions, бизнес-логику не трогаем. 4 блока:

1. **Lifecycle-кнопки в /admin/live-events** — переработка под «матовое стекло с цветным fill», как Sonner-уведомления.
2. **Layout вебинарной комнаты** — выровнять видео и чат, увеличить ширину рабочей области.
3. **Анонимные вопросы** — пометка вкладки.
4. **Аватарки в чате/вопросах** — реальные фото для всех; клик → карточка только для staff.

---

## Часть A — Lifecycle-кнопки в админке (исправление прошлой итерации)

**Файл:** `src/components/live/RoomLifecycleActions.tsx` (admin layout, строки 110–179)

### Что не так сейчас

По скриншоту: кнопки glass с цветом **только в тексте/иконке**, фон одинаково белый. Пользователь хочет, чтобы **сам фон был цветным** (мягкий tint), оставаясь стеклянным/матовым/полупрозрачным — как Sonner-уведомления (`mem://ui/notifications/sonner-visual-standard`).

### Что меняем

Локальный helper `GLASS_BASE` остаётся (h-9, min-w, backdrop-blur, border, shadow, hover, disabled — всё корректно по форме). Меняем только `GLASS_TONE`: вместо tint текста → tint фона.

```ts
const GLASS_TONE = {
  // нейтральная (Открыть комнату): мягкий серо-белый стеклянный fill
  neutral: "bg-white/60 hover:bg-white/80 text-foreground/85 [&_svg]:text-foreground/70",
  // primary (Начать вебинар): мягкий blue-tinted стеклянный fill
  primary: "bg-primary/15 hover:bg-primary/25 border-primary/25 text-primary [&_svg]:text-primary",
  // destructive (Завершить): мягкий red-tinted стеклянный fill
  destructive: "bg-destructive/12 hover:bg-destructive/20 border-destructive/25 text-destructive/85 [&_svg]:text-destructive/85",
} as const;
```

В `GLASS_BASE` убрать жёстко прибитый `bg-white/60` (уйдёт в `neutral`), оставить только: размеры, padding, gap, `backdrop-blur-md`, базовый `border`, `shadow-sm`, hover-shadow, transitions, disabled.

Бейдж «Комната открыта/Live/...» — тоже tint фона в тон состоянию:

- idle/scheduled → `bg-muted/60 text-foreground/70 border-white/40`;
- opened/waiting → `bg-primary/15 text-primary border-primary/25`;
- live → `bg-destructive/12 text-destructive/85 border-destructive/25 animate-pulse`;
- completed → `bg-muted/60 text-foreground/60 border-white/40`.

Маппинг по `roomState` через локальный helper в самом компоненте (без правки `liveRoomLifecycle.ts`).

### Что НЕ меняем

- Логику `callAction`, `canPerformAction`, invalidateQueries — не трогаем (UI-only).
- `liveRoomLifecycle.ts` (SOT) — не трогаем.
- Room-layout кнопку — отдельно в Части D.
- Глобальный `button.tsx` — не трогаем (единый use-case).

### DoD A

- 3 кнопки одной формы (h-9, min-w-[148px], одинаковый padding/gap, одинаковое выравнивание иконки).
- У каждой кнопки **цветной полупрозрачный glass-фон** (не только текст).
- Hover усиливает tint, не меняет hue.
- Disabled — приглушённое стекло, не visual noise.
- Бейдж состояния — в той же палитре, pulse сохранён для live.
- На 1102px и 768px рендер не ломается, flex-wrap работает.

---

## Часть B — Layout вебинарной комнаты

**Файл:** `src/pages/LiveEvent.tsx` (строки 485–611)

### Проблемы (по скриншоту /live/test-nomer-2)

- `max-w-[1400px]` — много пустоты по бокам на широких viewport;
- Видео-колонка визуально выше чата (нет одной верхней линии);
- Чат не прижат вправо.

### Изменения

1. **Контейнер**: `max-w-[1400px]` → `max-w-[1600px]` (контролируемый full-width, не безусловный full-bleed на ultrawide). На 1920px остаётся читаемая ширина без пустот по бокам ≤160px.
2. **Пропорция player/chat**:
  - desktop (`lg+`): video `flex-[3]` + chat `w-[360px] xl:w-[400px]` (фиксированная правая колонка);
  - mobile (`<lg`): без изменений — column stack, video first.
3. **Top alignment**: добавить `lg:items-start` на flex-row контейнер; chat `lg:self-start`. Видео получает высоту из `aspect-video`, chat — `lg:h-[calc(100vh-180px)]` — оба начинаются от одной верхней границы.
4. **Внутри player-колонки**: убрать лишний `gap`, который опускает player относительно top.

### Verify (обязательно во всех viewport)

- 1102×893 — текущий пользовательский;
- 1440×900;
- 1920×1080 — нет пустот по бокам, чат не «уплывает»;
- 375×812 — mobile stack работает.

### DoD B

- Top видео и top чата — на одной линии (desktop).
- Чат фиксированной ширины 360–400px справа.
- На 1920px нет неиспользованных полей по бокам, читаемость не теряется.
- Mobile layout не сломан.

---

## Часть C — Анонимные вопросы

**Файлы:** `src/pages/LiveEvent.tsx` (TabsTrigger «questions»), `src/components/live/LiveEventQuestions.tsx`.

### Изменения

1. В `TabsTrigger value="questions"`: добавить иконку `Lock` (h-3 w-3, opacity-60) рядом с текстом «Вопросы».
2. В `LiveEventQuestions` сверху списка — компактный hint-блок (короткий, нейтральный, без юридизации):
  > 🔒 Анонимные вопросы. Видят только модераторы и ведущий.
  - Стиль: `bg-muted/50 rounded-md px-2 py-1.5 text-xs text-muted-foreground`.
3. Placeholder textarea: «Задать вопрос…» → «Задать анонимный вопрос…».

### DoD C

- Lock-иконка в табе «Вопросы».
- Hint-баннер виден всегда (не только в empty state).
- Placeholder обновлён.

---

## Часть D — Аватарки + кликабельность (security-sensitive)

**Файлы:** `src/components/live/LiveEventComments.tsx`, `src/components/live/LiveEventQuestions.tsx`, `src/pages/LiveEvent.tsx`.

### Контракт безопасности (жёсткий)

- **Аватары видны всем** (staff и обычные участники).
- **Клик по имени/аватару → карточка контакта (`ContactDetailSheet`) — только если `isStaff === true**`.
- Для не-staff: курсор `default`, нет hover-affordance, нет onClick handler в DOM, нет popover/sheet.
- Никакого `PublicProfilePeek`, никакой публичной карточки, никакого peek для обычных пользователей.
- Запрос на participant-facing UI тянет **только минимальный набор**: `author_display_name`, `author_role`, `author_avatar_url`, текст, timestamps. Email/phone/internal IDs/соцконтакты — не запрашиваются и не попадают в DOM комнаты.
- Legacy fallback через `profiles.avatar_url` — **только для рендера аватара**, не для других полей профиля.

### Изменения

1. **Query**: в `LiveEventComments.tsx` (~строка 64) и `LiveEventQuestions.tsx` добавить `author_avatar_url` в `select`. Legacy-fetch (если есть join к `profiles`) — добавить только `avatar_url`, остальные поля профиля не трогаем.
2. **Render**: импорт `AvatarImage` из `@/components/ui/avatar`. Helper:
  ```ts
   function resolveAvatarUrl(c): string | null {
     return c.author_avatar_url || c.profile?.avatar_url || null;
   }
  ```
   Рендер:
   Имя автора — аналогично: `cursor-pointer` и `onClick` только при `isStaff`.
3. `**LiveEvent.tsx**`: `onOpenProfile={isStaff ? openContactSheet : undefined}` (как сейчас). Жёстко зафиксировать комментарием в коде, что non-staff передача запрещена политикой `mem://security/access-control/webinar-staff-action-guards`.

### DoD D (security-check включён)

- Аватары рендерятся у всех сообщений (real photo + fallback инициалы).
- Для staff: имя и аватар кликабельны → `ContactDetailSheet`.
- Для non-staff:
  - в DOM нет `onClick` на имени/аватаре;
  - нет `cursor-pointer`/hover-affordance;
  - нет email/phone/admin-данных в участнике участника UI;
  - нет открывающегося popover/sheet/peek любого вида.
- Query в participant UI — только `author_display_name`, `author_role`, `author_avatar_url`, текст, timestamps.
- Legacy fallback `profiles.avatar_url` — только для аватара.

---

## Часть E — Lifecycle-кнопка в room-layout

**Файл:** `src/components/live/RoomLifecycleActions.tsx` (room layout, строки 74–108)

### Изменения

- Применить тот же `GLASS_BASE` + `GLASS_TONE.destructive` (с tint фона из Части A) к кнопке «Завершить вебинар» в комнате.
- Сохранить заметность: на тёмном/светлом фоне комнаты destructive tint должен оставаться различимым → `bg-destructive/15` (чуть плотнее, чем admin-таблица), border `border-destructive/30`.
- Высота и форма — синхронно с админскими кнопками (`h-9`, `min-w-[148px]`).
- Логику confirm-dialog/`callAction` не трогаем.

### DoD E

- Кнопка glass с цветным destructive tint фоном, не насыщенный fill.
- Заметна для staff на любом фоне комнаты.
- Форма синхронна с admin-кнопками.

---

## Файлы

- `src/components/live/RoomLifecycleActions.tsx` — Части A, E.
- `src/pages/LiveEvent.tsx` — Части B, C, D.
- `src/components/live/LiveEventComments.tsx` — Часть D.
- `src/components/live/LiveEventQuestions.tsx` — Части C, D.

## НЕ трогаем

- `liveRoomLifecycle.ts`, `button.tsx`, `index.css` (glass-токены не нужны — локально), БД, edge functions, триггеры snapshot, RLS, moderation hooks.

## Verify после реализации

1. `/admin/live-events` на 1102×893 — screenshot колонки Lifecycle: цветные glass-фоны, единый ритм.
2. `/live/<slug>` на 1102×893, 1440×900, 1920×1080, 375×812 — layout, выравнивание, чат справа, mobile stack.
3. Tab «Вопросы» — lock-иконка, hint-баннер, placeholder.
4. Чат: аватары рендерятся; security-check — для не-staff в DOM нет onClick/cursor-pointer.
5. Если state=live: кнопка «Завершить» в комнате — glass destructive tint.

## Итоговый DoD

- Admin lifecycle-кнопки: цветные glass-фоны (не только текст), единая форма, бейдж в палитре.
- Room layout: видео+чат на одной линии, контролируемая полная ширина (max-w-[1600px]), чат фиксирован справа.
- Анонимные вопросы: lock + hint + placeholder.
- Аватары: видны всем; клик/hover только у staff; в DOM не утекли admin-данные.
- Room-layout «Завершить вебинар»: glass destructive tint, заметна.