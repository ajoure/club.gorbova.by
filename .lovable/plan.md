выполни и подтверди скринами, да, согласен, с учетом правок:

&nbsp;

1. Добавь в начало плана явный **add-only mapping**:
  &nbsp;
  - старый route PATCH -> остается
  - старый ProtectedRoute PATCH -> остается
  - новый tab-switch PATCH -> добавляется отдельно
  - browser restore / bfcache PATCH -> отдельный
  - запрет на удаление/замену старых фаз без явного mapping старый пункт -> новый пункт.
  &nbsp;
2. В ФАЗЕ 1A зафиксируй, что trace нужен **не только в консоль**, а в виде сохраняемого единого timeline-лога по одному сценарию, чтобы можно было приложить до/после и сопоставить timestamps.
3. В ФАЗЕ 1B добавь обязательный proof **первого источника reset**:
  &nbsp;
  - первый код/компонент, после которого scrollY уходит вверх;
  - это именно DOM collapse, scrollTo/scrollIntoView, step reset или remount;
  - с указанием файла и строки.
  &nbsp;
4. В ФАЗЕ 1C отдельно потребуй доказать, есть ли **page-level skeleton collapse** именно в:
  &nbsp;
  - LibraryLesson.tsx
  - useTrainingLessons.tsx
  - useTrainingModules.tsx
    и кто из них первым запускает схлопывание layout.
  &nbsp;
5. В ФАЗЕ 2 явно запиши правило:
  &nbsp;
  - **background refetch на том же lesson route не имеет права включать full-page skeleton и убирать уже отрисованный контент**;
  - loader допустим только на cold start / first load / реальном route change.
  &nbsp;
6. В P0 fix добавь, что нужно проверить и закрыть **оба источника**:
  &nbsp;
  - route-level/page-level collapse;
  - внутренний автоскролл/step sync внутри KvestLessonView.
    Нельзя считать баг закрытым, если устранён только один из двух.
  &nbsp;
7. Для ScrollToTop и visibility backup добавь пометку:
  &nbsp;
  - это **backup-only layer**;
  - старый scroll patch не удалять и не объявлять ошибочным без trace;
  - новый fix не должен ломать ранее утверждённый PUSH/POP сценарий.
  &nbsp;
8. Добавь отдельный STOP-guard:
  &nbsp;
  - без trace запрещено писать формулировки root cause fixed, P0 applied, issue resolved;
  - разрешены только статусы diagnostic, hypothesis, confirmed by trace, fixed with proof.
  &nbsp;
9. В Proof requirements добавь обязательный пункт:
  &nbsp;
  - **один и тот же маршрут, один и тот же аккаунт, одна и та же позиция скролла** для before/after;
  - сравнение на одном dataset, без “после второго обновления стало нормально”.
  &nbsp;
10. В DoD добавь ещё 2 пункта:

&nbsp;

&nbsp;

&nbsp;

- после tab return **не происходит remount page subtree**, если route не менялся;
- после tab return **scrollY сохраняется без ручного повторного движения мышью/тачпадом**.

&nbsp;

&nbsp;

&nbsp;

11. Добавь техническое правило исполнения:

&nbsp;

&nbsp;

&nbsp;

- если в trace подтвердится гипотеза LibraryLesson -> useTrainingLessons -> lessonsLoading -> full-page skeleton, fix должен быть **минимальным и локальным**;
- без переписывания всего scroll subsystem, auth subsystem и router-level логики.

&nbsp;

&nbsp;

&nbsp;

12. В финале плана добавь обязательную формулировку:

&nbsp;

&nbsp;

&nbsp;

- **этот новый P0 PATCH для tab-switch не отменяет и не заменяет ранее утвержденный PATCH для route-navigation; оба патча существуют параллельно до отдельного proof по каждому сценарию.**

&nbsp;

&nbsp;

ADD-ONLY / NO-LOSS RULE

Новый P0 PATCH для tab-switch / focus-return добавляется к уже существующему PATCH по route-navigation и не отменяет его. Ничего из ранее утвержденных правок по `ScrollToTop`, `ProtectedRoute`, PUSH/POP DoD, proof-требований и scenario coverage не удаляется и не переписывается без явного mapping `старый пункт -> новый пункт`.

Дополнение плана: три отдельных бага скролла

## Статус по сценариям


| Сценарий                                          | PATCH                                                     | Proof   |
| ------------------------------------------------- | --------------------------------------------------------- | ------- |
| Route navigation (PUSH/POP)                       | implementation present (`ScrollToTop` + `ProtectedRoute`) | missing |
| Tab switch (visibilitychange/focus, тот же route) | не закрыт                                                 | missing |
| Browser restore / bfcache (`pageshow/pagehide`)   | diagnostic pending                                        | missing |


Это три независимых сценария. Смешивать запрещено.

## Add-only mapping


| Старый пункт                             | Новый статус                                               |
| ---------------------------------------- | ---------------------------------------------------------- |
| Старый PATCH scroll restore (route)      | остается без изменений, покрывает только route-navigation  |
| Старый PATCH ProtectedRoute optimization | остается без изменений, не объявляется решением tab-switch |
| Новый PATCH tab-switch P0                | добавляется отдельно                                       |
| Общий DoD                                | расширяется, не заменяется                                 |


## READ-ONLY code review — уже выполнен

По коду найден более сильный кандидат на source of reset для tab-switch, чем прежняя гипотеза про `useLessonProgressState`.

### Наиболее вероятный виновник сейчас

`LibraryLesson.tsx` + `useTrainingLessons.tsx`

Связка по коду:

1. `AuthContext.tsx` на auth-event делает `setUser(session?.user ?? null)` — объект `user` обновляется по ссылке.
2. `useTrainingLessons.tsx` зависит от `[moduleId, user, isAdminUser]`.
3. На каждом таком re-run `fetchLessons()` делает `setLoading(true)` до запроса.
4. `LibraryLesson.tsx` при `lessonsLoading` возвращает full-page skeleton:
  - `if (moduleLoading || lessonsLoading) return <DashboardLayout>...<Skeleton/>`
5. Это размонтирует длинный lesson/kvest DOM, схлопывает высоту страницы и естественно уводит `scrollY` к верху.
6. После загрузки `KvestLessonView` монтируется заново уже с новым layout.

Это лучше объясняет реальный симптом, чем текущая версия про `useLessonProgressState`, потому что здесь есть именно page-level collapse, а не только внутренний refetch состояния квеста.

### Почему предыдущие патчи не закрыли баг

- `ScrollToTop` работает по `pathname`; при tab switch route не меняется.
- `ProtectedRoute` оптимизация помогает route-navigation, но сама по себе не устраняет page-level skeleton внутри `LibraryLesson`.
- PATCH в `useLessonProgressState` мог убрать часть refetch/step-reset, но не перекрывает `useTrainingLessons -> lessonsLoading -> full-page skeleton`.
- visibility restore без устранения collapse — только страховка, не root fix.

## Рабочая гипотеза P0 (не root cause, пока без trace proof)

При возврате во вкладку триггерится auth/session refresh или иной re-render цепочки, после чего:

- `useTrainingLessons` перезапускается из-за identity churn по `user`;
- `setLoading(true)` включает page-level skeleton;
- `LibraryLesson` временно убирает реальный контент;
- DOM height падает;
- скролл уходит вверх;
- затем квест монтируется заново.

Отдельно остаётся проверить, не добавляется ли после этого вторичный автоскролл внутри `KvestLessonView`.

## ФАЗА 1 — обязательная диагностика tab-switch

### 1A. Единый event trace timeline с timestamp

Для сценария:
`открыть длинный квест -> прокрутить вниз -> уйти на другую вкладку на 5–10 сек -> вернуться`

Логировать в один timeline:

- `visibilitychange`
- `focus` / `blur`
- `pageshow` / `pagehide`
- `event.persisted`
- `performance.getEntriesByType('navigation')`
- `onAuthStateChange` event type
- `AuthContext` render
- `ProtectedRoute` render / mount / unmount
- `LibraryLesson` render
- `KvestLessonView` render / mount / unmount
- `useTrainingLessons.fetchLessons`
- `useTrainingModules.fetchModules`
- `useLessonProgressState.fetchState`
- `loading=true/false` для page-level hooks
- `currentStepIndex` before/after
- `window.scrollY` before hidden / on visible / at reset
- `document.documentElement.scrollHeight`
- высота контейнера квеста
- все вызовы `window.scrollTo`
- все вызовы `scrollIntoView`
- все вызовы `goToStep` / `setCurrentStepIndex`

### 1B. Обязательный proof DOM collapse

Нужно доказать не предположение, а конкретный механизм:

- падает ли `scrollHeight`;
- исчезает ли контейнер квеста;
- появляется ли full-page skeleton;
- в какой точке timeline это происходит;
- был ли в этот момент вызов scroll API или scroll пропал без него из-за collapse.

### 1C. Identity churn proof

Проверить и приложить trace:

- меняется ли только ссылка `user`, а не `user.id`;
- пересоздаётся ли `fetchLessons` из-за зависимости от объекта `user`;
- вызывается ли `setLoading(true)` именно после такого re-run;
- касается ли это также `useTrainingModules`.

### 1D. Отдельный trace для browser restore / bfcache

Это третий сценарий, отдельно от route и tab switch:

- `pageshow`
- `pagehide`
- `event.persisted`
- `performance.getEntriesByType('navigation')`

## ФАЗА 2 — точечный fix после подтверждения trace

### P0. Главный fix: убрать page-level collapse на tab return

Файлы:

- `src/hooks/useTrainingLessons.tsx`
- при background refetch запрещено:
  - включать `loading=true`, если уроки уже загружены;
  - очищать уже отрисованный список;
  - вызывать full-page skeleton на том же lesson route.
- разрешён только silent refresh поверх существующего DOM.
- зависимости стабилизировать по `user?.id`, а не по объекту `user`, если trace подтвердит identity churn.

### P0.2. Аналогично проверить `useTrainingModules.tsx`

Если trace покажет тот же паттерн:

- не схлопывать layout на background refresh;
- стабилизировать зависимости;
- не ломать access state при tab return.

### P0.3. Guard в `LibraryLesson.tsx`

Даже если refetch идёт:

- не подменять уже открытый lesson full-page skeleton’ом;
- skeleton допустим только на cold start / first load;
- при tab return реальный DOM страницы должен оставаться на месте.

### P0.4. Guard в `KvestLessonView.tsx`

Если refetch пришёл с тем же `lessonId` и тем же `currentStepIndex`:

- никаких `setCurrentStepIndex`
- никаких `goToStep`
- никаких `scrollToBlock`
- никаких `scrollIntoView`
- transient `null/undefined` state во время refetch не должен влиять на UI state.

### P1. visibilitychange restore — только backup layer

Оставлять только как страховку после закрытия P0 причины.
Не использовать как “замазку” вместо устранения page-level collapse.

### P2. Миграция на React Query

Не обязательна первой мерой.
Рассматривать только если минимальный P0 fix не решает баг без побочных эффектов.

## STOP-guard

До event trace запрещено:

- объявлять root cause доказанной;
- удалять старый route PATCH;
- объявлять старую причину “ложной” без trace;
- переписывать весь scroll subsystem;
- закрывать PATCH по code review, build clean или общему описанию изменений.

Без видео + trace + before/after на одном и том же маршруте PATCH не считается выполненным.

## Proof requirements после выполнения

Обязательный маршрут для сравнения до/после:

- один и тот же длинный lesson route, например `/library/.../...`

Обязательные сценарии на одном и том же маршруте:

1. длинный квест;
2. прокрутка в середину/низ;
3. переход между шагами внутри квеста;
4. уход на другую вкладку на 5–10 секунд;
5. возврат;
6. back/forward;
7. hard refresh.

По каждому сценарию:

- видео до фикса;
- видео после фикса;
- event trace до фикса;
- event trace после фикса;
- before/after по `scrollY`, `scrollHeight`, `currentStepIndex`;
- указание, был ли spinner / DOM collapse / remount.

## DoD (расширенный, add-only)

Сохраняется из предыдущих планов:

- route POP восстанавливает scroll;
- PUSH сбрасывает в 0;
- повторные визиты не показывают init spinner;
- cold start не сломан;
- banned redirect не сломан;
- logout/login не ломает навигацию.

Добавляется:

- root cause для tab-switch либо доказан, либо явно помечен как not proven;
- найден первый конкретный код, который сбрасывает scroll / step / DOM subtree;
- при tab return DOM не схлопывается: `scrollHeight` и высота контента не падают до loader-state;
- при tab return нет spinner;
- при tab return нет прыжка вверх;
- при tab return не меняется текущий шаг;
- нет скрытого `scrollTo` / `scrollIntoView` после возврата;
- приложены видео и trace до/после на одном и том же маршруте;
- browser restore / bfcache проверен отдельно.

## Финальный статус плана


| Что                       | Статус                                                 |
| ------------------------- | ------------------------------------------------------ |
| Route-navigation bug      | отдельный PATCH, implementation present, proof missing |
| Tab-switch bug            | отдельный PATCH, root cause unconfirmed until trace    |
| Browser restore / bfcache | отдельный PATCH, diagnostic pending                    |


Итог направления: следующий шаг не “ещё один blind scroll patch”, а read-only event trace по tab-switch с проверкой `LibraryLesson -> useTrainingLessons -> lessonsLoading -> skeleton collapse` как текущей основной P0-гипотезы. Только после доказательства этой точки сброса — точечный фикс.