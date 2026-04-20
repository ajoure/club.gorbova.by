# да, согласен, с учетом правок:

1. **Не ограничивать scope только 3 UI-багами.**  
Этот план нужно оформить как:
  &nbsp;
  &nbsp;
  - исправление найденных багов;
  - **сразу после этого — полный regression всех спринтов**.  
  То есть это не отдельный микро-патч, а **bugfix + финальный тестовый проход**.
2. **Bug 1 / закругление таблицы**  
Фикс правильный, но явно зафиксируй, что:
  - `rounded-md overflow-hidden` должен стоять на **том же контейнере**, который является scroll-wrapper;
  - sticky header после этого не должен обрезаться/ломаться;
  - horizontal scroll должен сохраниться.  
  Это надо включить в DoD отдельно.
3. **Bug 2 / горизонтальный scroll табов в диалоге**  
Фикс через `overflow-x-auto` правильный.  
Добавь:
  - `TabsList` не должен сжиматься;
  - табы должны оставаться кликабельными по всей ширине;
  - на desktop не должно появиться лишнего scrollbar, если все табы помещаются.  
  То есть поведение должно быть адаптивным, а не всегда со скроллом “ради скролла”.
4. **Bug 3 / scroll комментариев в диалоге**  
Правильно, что проблема в контейнере, а не в `LiveEventComments`.  
Но нужно зафиксировать:
  - одинаковую высоту дать не только `comments`, `questions`, `moderation`, но проверить и остальные admin-tabs;
  - если `scenario`, `blocks`, `cta`, `theme` не требуют собственного scroll — это должно быть подтверждено, а не предположено;
  - если хотя бы один из них тоже переполняется, его тоже нужно привести к тому же контейнерному контракту.
5. **Не делать локальную починку только в одном месте, если те же табы есть в room/admin-view.**  
Нужно прямо проверить:
  - вкладки комнаты;
  - вкладки диалога редактирования;
  - любые staff/admin-варианты того же интерфейса.  
  Если баг со scroll/tabs повторяется в двух местах, фикс должен быть системным, а не точечным.
6. **После bugfix — обязательный полный regression.**  
Добавить отдельный этап:
  - table/admin smoke;
  - regression по `docs/SPRINT_FINAL_REGRESSION.md`;
  - повторная проверка именно тех багов, которые ты только что исправил:
    - угол таблицы;
    - horizontal scroll табов;
    - внутренний scroll комментариев/вопросов/модерации.
7. **Regression не разбивать.**  
После этих исправлений не делать ещё один отдельный мини-спринт на тесты.  
Сразу один проход:
  - bugfix proof;
  - полный regression;
  - единый финальный список remaining defects, если они останутся.
8. **Финальный отчёт**  
В отчёте потом обязательно показать отдельно:
  - какие баги пользователя были исправлены;
  - где именно были root causes;
  - что проверено runtime;
  - какие пункты regression passed / failed / partial;
  - есть ли ещё blockers до финальной приёмки.

&nbsp;

```text
План: bugfix найденных UI-багов + полный финальный regression live-модуля

## Жёсткие правила исполнения для Lovable.dev

### Обязательные принципы и критерии исполнения
- ничего не ломать и не трогать лишнее;
- add-only;
- dry-run → execute;
- строгие STOP-предохранители;
- после исправления багов сразу провести полный regression, не откладывая его на отдельный микро-спринт;
- финальный отчёт с proof, списком изменённых файлов, diff-summary и статусом passed / failed / partial по regression-checklist.

## Scope этого этапа

Этот этап включает сразу два блока:
1. исправление найденных UI-багов;
2. затем полный regression всех Sprint 1–3 и финального follow-up.

---

## PATCH B1 — разрыв закругления таблицы

### Файл
- `src/components/admin/live/LiveEventsTable.tsx`

### Проблема
Визуальный разрыв/слом угла таблицы при scroll.

### Причина
Border/radius и scroll clipping находятся не в одном и том же контейнере.

### Исправление
- перенести `rounded-md overflow-hidden` на реальный scroll-wrapper;
- сохранить horizontal scroll;
- проверить, что sticky header после этого не ломается и не режется.

### DoD
- угол таблицы визуально цельный;
- horizontal scroll работает;
- sticky header сохраняется корректно.

---

## PATCH B2 — горизонтальный scroll табов в диалоге редактирования эфира

### Файл
- `src/pages/admin/AdminLiveEvents.tsx`

### Проблема
Табы не помещаются и обрезаются, скролл отсутствует.

### Причина
`TabsList` не обёрнут в horizontal scroll container.

### Исправление
- обернуть `TabsList` в `overflow-x-auto`;
- `TabsList` сделать `w-max` / non-shrinking;
- проверить адаптив:
  - на узком экране есть горизонтальный scroll;
  - на широком экране лишний scroll не появляется.

### DoD
- все табы доступны;
- horizontal scroll работает на узких viewport;
- на широких viewport UI не деградирует.

---

## PATCH B3 — не работает внутренний scroll комментариев/вопросов/модерации в диалоге

### Файл
- `src/pages/admin/AdminLiveEvents.tsx`

### Проблема
Внутренние панели не скроллятся, растягивается весь диалог.

### Причина
`TabsContent` не имеет фиксированной/ограниченной высоты, а внутренние панели завязаны на `h-full/min-h-0`.

### Исправление
- задать корректный height/max-height контейнеру tab content в диалоге;
- применить не только к `comments`, `questions`, `moderation`, но и проверить остальные tab panes;
- если другие табы тоже переполняются, привести их к тому же контейнерному контракту.

### DoD
- комментарии скроллятся внутри панели;
- вопросы скроллятся внутри панели;
- модерация скроллится внутри панели;
- диалог не растягивается бесконтрольно.

---

## PATCH B4 — системная проверка табов room/admin surfaces

### Задача
Проверить, не дублируется ли тот же баг scroll/tabs:
- в комнате эфира;
- в admin/staff room view;
- в диалоге редактирования эфира.

### Требование
Если баг общий, фикс должен быть системным, а не точечным.

### DoD
- одинаковые проблемы tabs/scroll не остались в соседних surface.

---

## PATCH B5 — table/admin smoke после bugfix

### Обязательно проверить
- sticky header;
- horizontal scroll таблицы;
- vertical scroll таблицы;
- resize колонок;
- reorder колонок;
- hide/show columns;
- tri-state checkbox;
- select-all на текущей выборке;
- single delete;
- bulk delete;
- delete only platform;
- delete with Kinescope;
- partial delete при наличии `live`-эфира;
- очистка selection после delete/refetch.

### DoD
- каноническая таблица `/admin/live-events` проходит smoke без новых регрессий.

---

## PATCH B6 — полный regression live-модуля

После B1–B5 пройти единый checklist из `docs/SPRINT_FINAL_REGRESSION.md`.

### Обязательно включить
- Sprint 1 proof;
- Sprint 2 lifecycle/waiting-state/participant count;
- Sprint 3 theme/mobile/performance;
- F-follow-up delete flow;
- повторную проверку трёх свежих багов:
  - угол таблицы;
  - horizontal scroll табов;
  - внутренний scroll комментариев.

### Формат результата
Для каждого пункта:
- passed
- failed
- partial

С runtime proof для load-bearing сценариев.

---

## PATCH B7 — финальный consolidated результат

После bugfix и regression:
- либо модуль принят;
- либо вернуть **один consolidated список** remaining defects.

Без запуска нового мелкого согласовательного цикла.

## Итоговый DoD
- исправлены все три заявленные UI-проблемы;
- таблица `/admin/live-events` не сломана после фиксов;
- выполнен table/admin smoke;
- выполнен полный regression live-модуля;
- выдан финальный статус по модулю.
```

&nbsp;

&nbsp;

# План: фикс 3 UI-багов в `/admin/live-events`

## Bug 1 — разрыв закругления таблицы (угол)

**Файл:** `src/components/admin/live/LiveEventsTable.tsx` (line 350–355)

**Причина:** Внешний `<div className="rounded-md border bg-card">` имеет border и закругления, но внутренний scroll-контейнер `<div className="overflow-x-auto">` не клипит содержимое по этим углам — когда таблица шире viewport, появляется визуальный «разрыв» в угле.

**Фикс:** Перенести `rounded-md overflow-hidden` на scroll-обёртку, чтобы скруглить и клипнуть содержимое в одном элементе:

```tsx
<div className="rounded-md border bg-card overflow-hidden">
  <div ref={containerRef} onMouseDown={handleMouseDown}
       className="overflow-x-auto select-none relative">
```

Закруглены все 4 угла, scroll работает, sticky header не ломается.

---

## Bug 2 — нет горизонтального scroll вкладок в диалоге «Редактирование эфира»

**Файл:** `src/pages/admin/AdminLiveEvents.tsx` (line 2329–2352)

**Причина:** В диалоге 7 табов (Комментарии/Вопросы/Модерация/Сценарий/Блоки/CTA/Тема), `TabsList` по умолчанию `inline-flex` без overflow, а контейнер диалога имеет `overflow-x-hidden` (line 945) → табы просто обрезаются, перенос отсутствует, скролла нет.

**Фикс:** Обернуть `TabsList` в горизонтальный scroll-контейнер:

```tsx
<div className="overflow-x-auto -mx-1 px-1">
  <TabsList className="w-max">
    ...все 7 TabsTrigger...
  </TabsList>
</div>
```

`w-max` даёт TabsList свою ширину, обёртка с `overflow-x-auto` обеспечивает горизонтальный scroll внутри узкого диалога.

---

## Bug 3 — не работает scroll комментариев в диалоге «Редактирование эфира»

**Файл:** `src/pages/admin/AdminLiveEvents.tsx` (lines 2353–2374)

**Причина:** `LiveEventComments` / `LiveEventQuestions` / прочие табы используют `flex flex-col h-full min-h-0 + flex-1 overflow-y-auto` (как в `LiveEvent.tsx`). В комнате это работает — родитель имеет фиксированную высоту. Но `<TabsContent>` в диалоге высоту не задаёт → `h-full = 0`, scroll внутри панели мёртвый, диалог растягивается и пользователь скроллит весь диалог.

**Фикс:** Дать `TabsContent` фиксированную высоту, чтобы внутренний `flex-1 overflow-y-auto` имел якорь:

```tsx
<TabsContent value="comments" className="border rounded-lg mt-2 h-[500px] overflow-hidden">
  <LiveEventComments liveEventId={editingId} />
</TabsContent>
<TabsContent value="questions" className="border rounded-lg mt-2 h-[500px] overflow-hidden">
  <LiveEventQuestions liveEventId={editingId} />
</TabsContent>
```

Применяется к табам с внутренним scroll: `comments`, `questions`, `moderation`. Для остальных (`scenario`, `blocks`, `cta`, `theme`) высота не нужна — они без своего scroll-а, естественно растут с диалогом.

---

## Изменяемые файлы

- `src/components/admin/live/LiveEventsTable.tsx` — фикс закругления (1 строка).
- `src/pages/admin/AdminLiveEvents.tsx` — обёртка над `TabsList` + высота для 3-х `TabsContent` (`comments`, `questions`, `moderation`).

## Не трогается

`LiveEventComments.tsx`, `LiveEventQuestions.tsx`, `LiveEventModerationPanel.tsx` — внутренняя flex-логика остаётся как есть, она корректна для комнаты. Чиним только контейнер диалога.

## DoD

- Закругление таблицы целое со всех 4-х углов даже при горизонтальном scroll.
- Горизонтальный scroll табов «Редактирование эфира» работает на 1102px и уже.
- Скроллинг комментариев / вопросов / модерации работает внутри своей панели в диалоге, диалог не растягивается.
- Sprint 1+2+3, F-CANON и прочие функции live-модуля не сломаны.