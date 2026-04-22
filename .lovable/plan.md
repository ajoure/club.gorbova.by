# да, согласен, с учетом правок:

1. Для mobile **не переворачивать порядок сообщений**. Лучший вариант — оставить чат в нормальной хронологии: старые сверху, новые снизу. Иначе будет путаница, сломается привычная логика чтения, автоскролл, pill “Новые сообщения” и later-proof станет грязным. Проблему нужно решать **не реверсом списка**, а **изоляцией scroll-area**.
2. Добавь в план как обязательное UX-решение:
  - **video-shell, reactions bar, tabs и composer на mobile не должны ездить при чтении сообщений**;
  - скроллится **только** контейнер сообщений/вопросов;
  - composer остаётся pinned/fixed снизу;
  - video остаётся сверху как отдельный блок;
  - header с названием эфира можно уводить вверх при page-scroll, но после этого верхняя точка экрана должна начинаться с video-shell.
3. Зафиксируй в плане, что на mobile выбираем именно такую архитектуру:
  &nbsp;
  &nbsp;
  - **header scroll-away**;
  - **video-shell pinned в верхней части рабочей области**;
  - **tabs под reactions**;
  - **messages area = единственный scroll-container**;
  - **composer fixed снизу viewport**.  
  Это и есть правильное решение. Не “либо это, либо реверс сообщений”, а именно этот путь.
4. Допиши отдельный блок в DoD по mobile:
  - при длинном чате пользователь может листать сообщения, **не двигая видео**;
  - новые сообщения появляются внизу списка;
  - если пользователь у низа — мягкий auto-scroll;
  - если пользователь ушёл вверх — появляется pill “Новые сообщения”;
  - composer всегда доступен без прокрутки всей страницы;
  - video не исчезает и не уезжает вместе с chat-scroll.
5. В Этап 1 добавь подзадачу **M1.3 — chat-only scroll isolation**:
  - root mobile layout: page-scroll нужен только чтобы убрать header;
  - после ухода header основной runtime-блок фиксируется по высоте viewport;
  - внутри runtime-блока scroll только у `.room-messages-scroll`;
  - у video-shell и reactions bar `flex-shrink-0`;
  - у messages area `flex-1 min-h-0 overflow-y-auto`;
  - composer fixed bottom;
  - tabs/header внутри Card не скроллятся.
6. В live-proof для Этапа 1 добавь отдельные acceptance-критерии:
  - свайп по сообщениям **не меняет позицию video-shell**;
  - список сообщений двигается независимо;
  - header уехал вверх, но video остался на месте;
  - composer виден и доступен;
  - порядок сообщений обычный: старые сверху, новые снизу;
  - pill работает корректно.
7. В план M1.2 поправь формулировку:
  - сейчас у тебя header scroll-away есть, но этого мало;
  - нужно явно написать, что **после scroll-away header body-scroll должен прекращаться**, а дальнейший скролл идёт только внутри messages list.  
  Иначе снова получится, что двигается весь экран вместе с видео.
8. По M2 и M3 план в целом правильный, но отдельно зафиксируй:
  - **Participants** должны показывать всех, кто реально сейчас в эфире, независимо от пути входа: token / direct / menu;
  - **Analytics** должны считать всех, кто реально присутствовал, тоже независимо от пути входа;
  - runtime online и историческая аналитика — это разные сущности и не смешиваются.
9. Что осталось сделать сейчас до M3:
  - добить **M1.2 + M1.3**;
  - собрать **живой mobile-proof**, что video не ездит при chat-scroll;
  - закрыть **M2 live-proof** по путям входа;
  - выпустить **closing report Этапа 1**;
  - только потом переходить к M3.

&nbsp;

Итоговое UX-решение: **не реверсировать чат**. Делать **scroll-away header + pinned video area + isolated messages scroll + fixed composer**. Это самый чистый и профессиональный вариант для mobile.

&nbsp;

План: Закрытие Этапа 1 (live-proof M1.1 + M2) + scroll-away header на mobile

## Принятые UX-решения (фиксация)

1. **Чат НЕ переворачиваем.** Старые сообщения сверху, новые снизу. Проблема mobile решается через isolated scroll + fixed composer + new-messages pill. Подрядчику запрещено возвращаться к идее реверса списка.
2. **Mobile scroll-away header (новое):** при скролле в mobile блок «название вебинара + LIVE-бейдж + кнопка "Завершить вебинар" + счётчик участников» уезжает вверх за экран. Видео-карточка и всё ниже (reactions, tabs, composer) — остаются зафиксированы как сейчас.

---

## Часть A — M1.2: Mobile scroll-away header

### Цель

На mobile (≤1023px) при скролле страницы header с названием эфира уходит вверх. Стартовая зона экрана после скролла = video-shell. Ниже всё остаётся pinned по текущей механике M1.1.

### Архитектурное изменение

Текущий mobile-layout (после M1.1) = `h-[100dvh] flex flex-col overflow-hidden` — **вся страница не скроллится вообще**, header всегда виден. Это и есть причина, почему сейчас header нельзя «увезти».

Новая структура mobile (только `isMobile === true`):

```
<div class="min-h-[100dvh] flex flex-col">     // НЕ overflow-hidden, НЕ h-100dvh
  <header class="flex-shrink-0">…title+badges…</header>   // скроллится с body
  <main class="sticky top-0 h-[100dvh] flex flex-col overflow-hidden">
    <video-shell compact />                     // pinned top после ухода header
    <reactions-bar />
    <Card class="flex-1 min-h-0 overflow-hidden">
      <Tabs>…messages-scroll + fixed composer…</Tabs>
    </Card>
  </main>
</div>
```

Логика:

- Body scroll переносит header вверх; как только `<main>` достигает top, он залипает (`sticky top-0`) и дальнейший body-scroll не происходит (главный имеет высоту `100dvh`).
- Внутри залипшего main всё работает как M1.1: composer fixed, messages list — единственный scroll.

Desktop (`lg:`) — без изменений.

### Изменения

`**src/pages/LiveEvent.tsx**` (mobile-only):

- Убрать с root `h-[100dvh] overflow-hidden`, заменить на `min-h-[100dvh] flex flex-col`.
- Header-блок: добавить data-attr `data-mobile-header`, `flex-shrink-0`, без sticky.
- Main-обёртка над video+sidebar: на mobile `sticky top-0 h-[100dvh] overflow-hidden flex flex-col`; на desktop — текущее поведение.
- Композеры (`.room-composer`) уже `position: fixed bottom: 0` — продолжают работать (привязаны к viewport, не к sticky-родителю).

`**src/components/live/liveRoomTheme.css**`:

- Без изменений. `.room-composer` остаётся fixed mobile / sticky desktop.

### DoD M1.2

- 390×844 mobile: при свайпе вниз header «название + LIVE + Завершить вебинар + счётчик» уходит за верхний край.
- После ухода header верхний край экрана = video-shell.
- video / reactions / tabs / composer после скролла остаются зафиксированы.
- Composer всегда виден внизу (fixed).
- Скролл сообщений по-прежнему изолирован в `.room-messages-scroll`.
- Desktop ≥1024px: ничего не меняется, header не двигается.

---

## Часть B — Live-proof Этапа 1 (M1 + M1.1 + M1.2 + M2)

Без proof Этап 1 не закрывается и к M3 не переходим. **Stop-guard: миграции аналитики M3 не начинать до closing report.**

### B1. M1/M1.1/M1.2 live-proof (mobile 390×844)

Сценарии и доказательства:


| #   | Сценарий                      | Что показать                                                                                                                                              |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | idle waiting/live state       | screenshot: header + compact video + reactions + tabs + composer на первом экране без скролла                                                             |
| 2   | focused composer              | screenshot: фокус в input, клавиатура (если эмулируется) — composer над клавиатурой, video не двигается                                                   |
| 3   | scroll page вниз              | screenshot: header ушёл, экран стартует с video-shell, остальное pinned                                                                                   |
| 4   | scroll messages list          | screenshot: список прокручивается, video/tabs/composer на месте                                                                                           |
| 5   | new message at bottom         | пользователь у низа → автоскролл вниз; screenshot до/после                                                                                                |
| 6   | new message при скролле вверх | автоскролла нет, появляется pill «↓ Новые сообщения»; screenshot                                                                                          |
| 7   | click pill                    | scroll to bottom, pill исчезает; screenshot                                                                                                               |
| 8   | DOM proof                     | через `browser--observe` подтвердить: `.room-composer { position: fixed }` (mobile), `.room-messages-scroll` — единственный ancestor с `overflow-y: auto` |


**Desktop regression** (1366×768):

- screenshot desktop layout: video слева, sidebar справа, header виден всегда, composer sticky внутри Card, порядок сообщений старые→новые.

### B2. M2 live-proof — 4 сценария + edge


| Сценарий                         | Network proof                                                     | SQL proof                                                                                                  | UI proof                |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| token-link `/live-access/:token` | `live-token-validate` 200                                         | `SELECT count(*) FROM live_active_sessions WHERE user_id=… AND live_event_id=… AND revoked_at IS NULL` = 1 | user в Participants tab |
| direct `/live/:slug` (admin)     | `live-session-heartbeat` soft-join 200 + `session_key` в response | count = 1                                                                                                  | user в Participants     |
| из меню эфиров                   | `live-session-heartbeat` 200 с `entry_path='menu'`                | row + (после M3) `live_view_sessions.entry_path='menu'`                                                    | user в Participants     |
| вторая вкладка                   | `live-session-heartbeat` 200                                      | count = 1 (UNIQUE constraint)                                                                              | один user, без дубля    |
| без доступа                      | `live-session-heartbeat` 403                                      | count = 0                                                                                                  | user НЕ в Participants  |


**Acceptance Participants:**

- один и тот же user виден независимо от пути входа;
- count в badge header (`<2/> N`) = количество строк в Participants tab;
- повторная вкладка не плодит дубль;
- user без доступа не появляется ни в UI, ни в `live_active_sessions`.

### B3. Особый pin по entry_path='menu'

В план явно зафиксировать **частичную готовность menu-path**:

**Что сейчас есть:** soft-join принимает поле `entry_path` (после Этапа 2 будет писаться в `live_view_sessions`). Сейчас в `live_active_sessions` оно не сохраняется (там нет колонки) → различить menu vs direct можно только по network-payload.

**Что нужно добавить в Этапе 1 (минимальный hint):**

- В `src/pages/LiveEvent.tsx`: при mount читать `sessionStorage['live_entry_path_${slug}']`. Если ключ есть → передавать как `entry_path` в первый soft-join, затем удалять ключ. Иначе — `'direct'`.
- В компоненте списка эфиров (страница меню) — `src/pages/LiveEventsListing.tsx` или эквивалент: при клике на карточку перед navigate записывать `sessionStorage.setItem('live_entry_path_${slug}', 'menu')`.
- Token-flow ставит `'token'` в `live-token-validate` (уже корректно).

**Статус в closing report:**

- `entry_path='token'` — полностью закрыто (в `live-token-validate`).
- `entry_path='menu'` — **частично закрыто**: hint пишется на клиенте, передаётся в edge, но **долгосрочное хранение** в истории появится только в M3 (`live_view_sessions.entry_path`).
- `entry_path='direct'` — fallback по умолчанию.

### B4. Файлы Этапа 1

- `src/pages/LiveEvent.tsx` — M1.2 layout + entry_path hint reader.
- Список эфиров (определить точный файл при выполнении: `src/pages/LiveEventsListing.tsx` / `src/pages/cabinet/LiveEvents.tsx` — найти через search) — set `live_entry_path_${slug}` перед navigate.
- (опционально) `src/components/live/LiveEventComments.tsx` / `LiveEventQuestions.tsx` — мелкие правки, если scroll-away root меняет flex-контейнер.

---

## Часть C — Closing report по Этапу 1

Перед стартом M3 обязательный отчёт со структурой:

1. **Что сделано** — M1, M1.1, M1.2, M2 (soft-join + entry_path hint).
2. **Файлы изменены** — список с краткими заметками.
3. **Diff-summary** — по каждому файлу 1–3 строки.
4. **Доказано живыми скринами/UI** — таблица из B1+B2 со ссылками на screenshots.
5. **Доказано только кодом/SQL/network** — что не показано визуально (например, sweeper не существует, 403 на edge).
6. **Что ещё не закрыто / частично** — `entry_path='menu'` хранение (ждёт M3), отсутствие `live_view_sessions`, отсутствие админской аналитики.
7. **T1 regression** — `T1 checked / no code changes required`.

---

## Часть D — После Этапа 1 (последовательность)

1. **M3 analytics** — миграции `live_view_sessions` / `live_session_events`, sweeper, `live-session-leave`, RPC, admin-вкладка. **Не начинать до closing report**. План M3 — без изменений (как утверждён ранее).
2. **Follow-ups** — отдельным PATCH после M3:
  - reactions overlay fade-out live proof;
  - player stability live proof (mount counter);
  - non-staff Participants live proof;
  - финальный room proof-pack.

---

## Stop-guards (повторно зафиксировано)

- НЕ реверсировать чат.
- НЕ начинать M3 до closing report Этапа 1.
- НЕ трогать desktop layout.
- НЕ ломать token-flow.
- НЕ менять access logic — только entry tracking после успешной access-проверки.
- `live_view_sessions` / `live_session_events` (когда появятся в M3) — server-only write, UI напрямую запрещено.