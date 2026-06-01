## ## Diagnose

URL: `/library/buhgalteriya-kak-biznes/shag-3` (и любые уроки с Kinescope-видео).

Симптом: страница появляется на секунду, затем превращается в белый экран.

### Что показали логи браузера на этой странице

1. Kinescope SDK не смог загрузить iframe — `IFrame load failed: 402` для обоих видео-блоков `bAQd3NB5E2Ft192vH2zjiB`, `8apuCGUZDHYoU8vb5uFbHj`). HTTP 402 = у Kinescope-аккаунта истекла подписка / превышена квота.

2. `useKinescopePlayer.ts` корректно ловит ошибку в `try/catch` и пишет `Player init error`, **но** SDK успевает мутировать DOM внутри React-управляемого `<div id={containerId}>` (вставить wrapper/iframe). При размонтировании плеера React пытается удалить детей, которых он сам не создавал, и падает с:

   

   ```

   NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.

   ```

   

   Эта ошибка возникает **в commit-фазе React**, поэтому пробивает все error boundary внутри страницы и роняет всё поддерево `<LazyRoute>` → пустая страница.

3. Параллельно из SDK прилетает `Uncaught (in promise)` от внутреннего awaiter — он сам по себе страницу не валит, но шумит в логах.

### Почему «у клиентов и у меня одновременно»

Триггер — Kinescope-аккаунт начал отдавать 402. Любой урок с Kinescope-видео сейчас крашится одинаково и у клиентов, и в админе. Если временно убрать видео — урок открывается, но это не решение.

## Что чиню

Только фронтенд. Доступ, RLS, edge-функции, БД не трогаю — пользователь явно просил «починить баг отображения для клиентов, у которых есть доступ».

### 1. Развязать Kinescope-контейнер от React (главный фикс)

Файл: `src/components/admin/lesson-editor/blocks/VideoBlock.tsx` (это компонент, который рендерит видео в уроках через `useKinescopePlayer`).

Сейчас:

```tsx

<div className="relative w-full aspect-video ...">

  <div id={containerId} className="absolute inset-0" />   // ← React owns this, Kinescope mutates it

</div>

```

Станет: оборачиваем mount-point ещё одним React-нейтральным слоем. React владеет только внешним wrapper; внутренний `div` создаётся вручную через `appendChild` в `useLayoutEffect` и удаляется через `innerHTML = ''` при unmount. Kinescope мутирует только этот «отвязанный» поддерево — React туда не лезет и `removeChild`-крэша не будет.

```tsx

const wrapperRef = useRef<HTMLDivElement>(null);

const containerIdRef = useRef`kinescope-player-${uniqueId.replace(/:/g, '-')}`);

useLayoutEffect(() => {

  const wrapper = wrapperRef.current;

  if (!wrapper) return;

  const target = document.createElement('div');

  [target.id](http://target.id) = containerIdRef.current;

  [target.style](http://target.style).cssText = 'position:absolute;inset:0;width:100%;height:100%;';

  wrapper.appendChild(target);

  return () => {

    // Полностью обнуляем поддерево — React сюда не заглядывает

    while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);

  };

}, []);

// JSX:

<div ref={wrapperRef} className="absolute inset-0" />

```

`useKinescopePlayer` получает `containerIdRef.current` так же, как сейчас.

### 2. Корректный fallback при сбое плеера (402 и пр.)

В том же `VideoBlock.tsx` добавляем локальный state `playerFailed`. `useKinescopePlayer({ onError })` уже есть — в обработчике ставим `setPlayerFailed(true)`. Когда `playerFailed === true`, вместо API-плеера показываем:

- обычный `<iframe src={embedUrl}>` (тот же fallback, что уже есть для не-Kinescope URL — он молча отрендерит сообщение Kinescope о недоступности, страница не упадёт);

- плюс компактный alert «Видео временно недоступно. Попробуйте обновить страницу» со ссылкой «Открыть в новой вкладке».

Так клиент видит причину, а не белый экран.

### 3. Глушим unhandled rejection от Kinescope SDK

Файл: `src/hooks/useKinescopePlayer.ts`.

После `await loadKinescopeScript()` и до создания плеера навешиваем одноразовый `window.addEventListener('unhandledrejection', handler)` с фильтром по `reason?.target?.iframe === 'IFRAME'` и `reason?.data?.message?.includes('IFrame load failed')`. Вызываем `event.preventDefault()`, чтобы рантайм не считал её uncaught. В cleanup эффекта снимаем listener. Это убирает шум в логах и страхует на случай ещё одного источника rejection.

### 4. Подстраховка на уровне страницы урока

Файл: `src/pages/LibraryLesson.tsx`. Оборачиваем рендер блоков `<LessonBlockRenderer ... />` и legacy-видео-секцию) в маленький локальный `ErrorBoundary` («Не удалось отобразить блок. Перезагрузите страницу»). Это не fix, а ремень безопасности на будущее: даже если завтра другой блок упадёт в commit-фазе, целая страница уроков не уйдёт в белый экран.

## Verify (в режиме симуляции)

1. Открываю `/library/buhgalteriya-kak-biznes/shag-3` через `browser--navigate_to_sandbox` (я уже логин админом через dev-пароль).

2. Жду 5 секунд → делаю `browser--screenshot`. Ожидаю: страница урока полностью отрисована (заголовок, breadcrumbs, аудио-блок, ExternalProductWorkshop-блок видны), вместо упавшего Kinescope-плеера — fallback iframe или «видео недоступно». Скрин прикладываю в ответ.

3. Дополнительно открываю `/library/buhgalteriya-kak-biznes/shag-1` и `/shag-2` (тоже статьи с возможными видео), проверяю что не падают.

4. `browser--read_console_logs error` — убеждаюсь, что `NotFoundError: removeChild` пропал; warn от Kinescope `IFrame load failed: 402`) остаётся, но как warn, без uncaught.

5. Скрин до/после прикладываю в ответе.

## Чего НЕ делаю

- Не трогаю Kinescope-подписку, edge-функции, RLS, БД, `access_rules`, доступы к продуктам.

- Не меняю URL-схему уроков, навигацию, layout.

- Не правлю `ExternalProductWorkshop` и другие блоки — они здесь ни при чём.

- Не подключаю новые библиотеки.

## DoD

- На `/library/buhgalteriya-kak-biznes/shag-3` страница не белеет: видны хлебные крошки, заголовок, аудио, воркшоп, dock внизу.

- В консоли нет `NotFoundError: Failed to execute 'removeChild'` и нет `Uncaught (in promise)` от Kinescope.

- Уроки без Kinescope-видео работают как раньше (регрессий нет).

- Скрины «после» приложены в ответе.

&nbsp;

&nbsp;

Diagnose

URL: `/library/buhgalteriya-kak-biznes/shag-3` (и любые уроки с Kinescope-видео).
Симптом: страница появляется на секунду, затем превращается в белый экран.

### Что показали логи браузера на этой странице

1. Kinescope SDK не смог загрузить iframe — `IFrame load failed: 402` для обоих видео-блоков (`bAQd3NB5E2Ft192vH2zjiB`, `8apuCGUZDHYoU8vb5uFbHj`). HTTP 402 = у Kinescope-аккаунта истекла подписка / превышена квота.
2. `useKinescopePlayer.ts` корректно ловит ошибку в `try/catch` и пишет `Player init error`, **но** SDK успевает мутировать DOM внутри React-управляемого `<div id={containerId}>` (вставить wrapper/iframe). При размонтировании плеера React пытается удалить детей, которых он сам не создавал, и падает с:
  ```
   NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.
  ```
   Эта ошибка возникает **в commit-фазе React**, поэтому пробивает все error boundary внутри страницы и роняет всё поддерево `<LazyRoute>` → пустая страница.
3. Параллельно из SDK прилетает `Uncaught (in promise)` от внутреннего awaiter — он сам по себе страницу не валит, но шумит в логах.

### Почему «у клиентов и у меня одновременно»

Триггер — Kinescope-аккаунт начал отдавать 402. Любой урок с Kinescope-видео сейчас крашится одинаково и у клиентов, и в админе. Если временно убрать видео — урок открывается, но это не решение.

## Что чиню

Только фронтенд. Доступ, RLS, edge-функции, БД не трогаю — пользователь явно просил «починить баг отображения для клиентов, у которых есть доступ».

### 1. Развязать Kinescope-контейнер от React (главный фикс)

Файл: `src/components/admin/lesson-editor/blocks/VideoBlock.tsx` (это компонент, который рендерит видео в уроках через `useKinescopePlayer`).

Сейчас:

```tsx
<div className="relative w-full aspect-video ...">
  <div id={containerId} className="absolute inset-0" />   // ← React owns this, Kinescope mutates it
</div>
```

Станет: оборачиваем mount-point ещё одним React-нейтральным слоем. React владеет только внешним wrapper; внутренний `div` создаётся вручную через `appendChild` в `useLayoutEffect` и удаляется через `innerHTML = ''` при unmount. Kinescope мутирует только этот «отвязанный» поддерево — React туда не лезет и `removeChild`-крэша не будет.

```tsx
const wrapperRef = useRef<HTMLDivElement>(null);
const containerIdRef = useRef(`kinescope-player-${uniqueId.replace(/:/g, '-')}`);

useLayoutEffect(() => {
  const wrapper = wrapperRef.current;
  if (!wrapper) return;
  const target = document.createElement('div');
  target.id = containerIdRef.current;
  target.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  wrapper.appendChild(target);
  return () => {
    // Полностью обнуляем поддерево — React сюда не заглядывает
    while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
  };
}, []);

// JSX:
<div ref={wrapperRef} className="absolute inset-0" />
```

`useKinescopePlayer` получает `containerIdRef.current` так же, как сейчас.

### 2. Корректный fallback при сбое плеера (402 и пр.)

В том же `VideoBlock.tsx` добавляем локальный state `playerFailed`. `useKinescopePlayer({ onError })` уже есть — в обработчике ставим `setPlayerFailed(true)`. Когда `playerFailed === true`, вместо API-плеера показываем:

- обычный `<iframe src={embedUrl}>` (тот же fallback, что уже есть для не-Kinescope URL — он молча отрендерит сообщение Kinescope о недоступности, страница не упадёт);
- плюс компактный alert «Видео временно недоступно. Попробуйте обновить страницу» со ссылкой «Открыть в новой вкладке».

Так клиент видит причину, а не белый экран.

### 3. Глушим unhandled rejection от Kinescope SDK

Файл: `src/hooks/useKinescopePlayer.ts`.

После `await loadKinescopeScript()` и до создания плеера навешиваем одноразовый `window.addEventListener('unhandledrejection', handler)` с фильтром по `reason?.target?.iframe === 'IFRAME'` и `reason?.data?.message?.includes('IFrame load failed')`. Вызываем `event.preventDefault()`, чтобы рантайм не считал её uncaught. В cleanup эффекта снимаем listener. Это убирает шум в логах и страхует на случай ещё одного источника rejection.

### 4. Подстраховка на уровне страницы урока

Файл: `src/pages/LibraryLesson.tsx`. Оборачиваем рендер блоков (`<LessonBlockRenderer ... />` и legacy-видео-секцию) в маленький локальный `ErrorBoundary` («Не удалось отобразить блок. Перезагрузите страницу»). Это не fix, а ремень безопасности на будущее: даже если завтра другой блок упадёт в commit-фазе, целая страница уроков не уйдёт в белый экран.

## Verify (в режиме симуляции)

1. Открываю `/library/buhgalteriya-kak-biznes/shag-3` через `browser--navigate_to_sandbox` (я уже логин админом через dev-пароль).
2. Жду 5 секунд → делаю `browser--screenshot`. Ожидаю: страница урока полностью отрисована (заголовок, breadcrumbs, аудио-блок, ExternalProductWorkshop-блок видны), вместо упавшего Kinescope-плеера — fallback iframe или «видео недоступно». Скрин прикладываю в ответ.
3. Дополнительно открываю `/library/buhgalteriya-kak-biznes/shag-1` и `/shag-2` (тоже статьи с возможными видео), проверяю что не падают.
4. `browser--read_console_logs error` — убеждаюсь, что `NotFoundError: removeChild` пропал; warn от Kinescope (`IFrame load failed: 402`) остаётся, но как warn, без uncaught.
5. Скрин до/после прикладываю в ответе.

## Чего НЕ делаю

- Не трогаю Kinescope-подписку, edge-функции, RLS, БД, `access_rules`, доступы к продуктам.
- Не меняю URL-схему уроков, навигацию, layout.
- Не правлю `ExternalProductWorkshop` и другие блоки — они здесь ни при чём.
- Не подключаю новые библиотеки.

## DoD

- На `/library/buhgalteriya-kak-biznes/shag-3` страница не белеет: видны хлебные крошки, заголовок, аудио, воркшоп, dock внизу.
- В консоли нет `NotFoundError: Failed to execute 'removeChild'` и нет `Uncaught (in promise)` от Kinescope.
- Уроки без Kinescope-видео работают как раньше (регрессий нет).
- Скрины «после» приложены в ответе.