да, согласен, с учетом правок:

1. **Не использовать глобальный** `<base target="_blank">` **вообще.**  
Его нужно полностью убрать из `srcdoc`, иначе он продолжит ломать якоря и `href="#"`.
2. **Для внешних ссылок не просто выставлять** `target/rel`**, а открывать безопасно.**  
В обработчике клика для внешних ссылок лучше делать:
  &nbsp;
  ```ts
  window.open(url, '_blank', 'noopener,noreferrer')
  ```
  и затем `preventDefault()`, чтобы поведение было полностью контролируемым внутри sandbox-iframe.
3. **Для** `href="#id"` **обязательно передавать в родителя не только** `id`**, но и** `targetOffsetTop`**.**  
Сообщение должно быть примерно таким:
  &nbsp;
  ```ts
  {
    type: 'iframe-anchor',
    id,
    targetOffsetTop
  }
  ```
  Иначе родитель не сможет корректно вычислить позицию внутри iframe.
4. **В родителе скроллить только сообщения от текущего iframe.**  
Проверка должна остаться строгой:
  &nbsp;
  ```ts
  if (event.source !== iframeRef.current?.contentWindow) return
  ```
  Никакой проверки `origin` для `srcdoc` как обязательной не добавлять, потому что у sandbox/srcdoc может быть opaque origin.
5. **Для** `scrollIntoView` **не ломать нативное поведение полностью.**  
Подмена `Element.prototype.scrollIntoView` внутри iframe допустима, но с fallback: если элемент не найден / postMessage невозможен / родитель не обработал сообщение, должен сработать оригинальный `scrollIntoView`.
6. **Добавить защиту от повторной инъекции скрипта.**  
Новый marker `data-lovable-resize-v2` корректен, но он должен покрывать весь общий injected script: resize + anchor intercept + scroll intercept. Не должно быть двух независимых injected scripts.
7. **Не менять контракт компонента и вызывающие места.**  
Согласен: `HtmlSection.tsx`, `HtmlRawBlock.tsx`, `HtmlBlockEditor.tsx` не трогать. Фикс должен примениться через общий `HtmlIframePreview`.
8. **Для** `href="#"` **и пустых ссылок поведение должно быть нейтральным.**  
Обязательно:
  &nbsp;
  ```ts
  preventDefault()
  stopPropagation()
  ```
  Новая вкладка не открывается, скролл наверх не происходит.
9. **Header offset сделать безопаснее.**  
Не только `document.querySelector('header')?.offsetHeight ?? 80`, а лучше:
  &nbsp;
  ```ts
  const headerOffset =
    document.querySelector('[data-site-header]')?.getBoundingClientRect().height
    ?? document.querySelector('header')?.getBoundingClientRect().height
    ?? 80
  ```
  Это уменьшит риск неверного offset в админке.
10. **Добавить clamp для итогового scroll target.**  
Чтобы не получить отрицательную позицию:

```ts
top: Math.max(0, calculatedTop)
```

11. **ResizeObserver должен остаться основным механизмом высоты.**  
Новый первичный `post()` и `requestAnimationFrame(post)` добавляются только как ускорение первого resize, но не заменяют текущий observer/load/font/image handling.
12. **В DoD добавить проверку внешней ссылки.**  
Нужно явно проверить, что обычная внешняя ссылка из HTML-блока:

- открывается в новой вкладке;
- не ломает sandbox;
- получает `noopener/noreferrer`;
- не пытается навигировать текущую страницу.

13. **В DoD добавить regression-check для lesson HTML-блока.**  
Так как компонент используется в `lesson-editor/blocks/HtmlRawBlock.tsx`, нужно проверить не только site-builder, но и lesson HTML preview/render.
14. **В отчете о выполненной работе обязательно указать:**

- изменён только `src/components/shared/HtmlIframePreview.tsx`;
- БД / RLS / edge functions / HTML-контент страницы не трогались;
- sandbox policy не расширялась;
- `allow-same-origin` не добавлялся;
- приложены screenshots до/после и результат wheel-test.

15. **Добавить обязательное требование по языку для [Lovable.dev](http://Lovable.dev).**

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

План: исправить рендер HTML-блока (site-builder/lesson) — внутристраничные ссылки, открытие в новой вкладке и "залипание" скролла
```

## Диагноз

HTML-страница "Идеологическая работа" (`site_pages.id=7e672fed…011`, единственный блок `type=html`) сама по себе валидна. Все проблемы вызваны рендерером `src/components/shared/HtmlIframePreview.tsx`, через который контент монтируется в sandbox-iframe (используется и в админ-превью, и в публичном `site-renderer/blocks/HtmlSection.tsx`, и в `lesson-editor/blocks/HtmlRawBlock.tsx`).

Три корневые причины:

1. **«Ссылки/кнопки не работают»** — в `buildSrcdoc` принудительно инжектится `<base target="_blank">`. В результате:
  - Все `<a href="#paths">`, `<a href="#benefits">` и т.п. открываются в новой вкладке как `about:srcdoc#paths` (пустая страница) вместо скролла родителя.
  - Логотип-ссылка `<a href="#">` тоже открывает новую вкладку.
2. **«Якоря и `scrollToSection(...)` ничего не делают»** — iframe сэндбоксирован и его высота подгоняется под `scrollHeight` контента. Внутренний `window.scrollTo({behavior:'smooth'})` скроллит документ iframe, который не имеет собственного скролла (всё видно), поэтому визуально не происходит ничего. Родительская страница не получает команды скроллить к нужному `id`.
3. **«Скролл колесом срабатывает только со второго раза»** — пока не пришёл первый `iframe-resize` postMessage, iframe держит `minHeight=100px` и имеет внутренний скролл. Первое прокручивание колесом «съедается» внутренним скроллом маленького iframe, и только после ресайза (или второго тика) колесо передаётся родителю. Дополнительно `style="overflow: auto"` на iframe оставляет внутренний скролл как фоллбэк.

Контент пользователя править не нужно — фикс на уровне общего рендерера.

## Скоуп изменений

Только `src/components/shared/HtmlIframePreview.tsx`. Никаких изменений в самой HTML-странице, в edge-функциях, в БД, в RLS/GRANT, в скоупах E.1–E.4. Контракт `HtmlIframePreview({ html, emptyText, minHeight })` остаётся прежним.

## Что меняется в `HtmlIframePreview.tsx`

### A. Умный `<base target=…>` + intercept якорей (фикс bug #1 и #2)

Вместо `<base target="_blank">` инжектится небольшой скрипт, который при `click` на `<a>`:

- `href` начинается с `#` и не пустой → `preventDefault`, `postMessage({type:'iframe-anchor', id})` родителю;
- `href` пустой / `#` → `preventDefault` (не открывать новую вкладку);
- иначе (внешняя ссылка) → принудительно `target="_blank" rel="noopener noreferrer"`.

То же самое перехватывается на уровне делегирования (`document.addEventListener('click', …, true)`), чтобы работало и для `<a>` внутри admin-авторских кнопок. Существующий пользовательский `scrollToSection(id)` оставляем как есть — он `return false` и не помешает, но дополнительно патчим: если `el = getElementById(id)` найден, скрипт сам шлёт `iframe-scroll-to-element` родителю с координатой относительно iframe (см. ниже), плюс возвращает `false`, чтобы не было дефолтного перехода. Существующий `scrollIntoView` в `setSearchFilter` обворачивается перехватом: подменяем `Element.prototype.scrollIntoView` на вариант, который сначала пытается postMessage родителю.

### B. Родительский listener скроллит окно (фикс bug #2)

В компоненте уже есть `handleMessage`. Добавляем ветки:

- `type === 'iframe-anchor'`: вычисляем абсолютный Y = `iframeRect.top + window.scrollY + targetOffsetTop − headerOffset`, где `targetOffsetTop` приходит из iframe в том же сообщении (iframe знает позицию якоря у себя через `getBoundingClientRect().top + iframeScroll`). Скроллим `window.scrollTo({top, behavior:'smooth'})`. `headerOffset` берётся как `document.querySelector('header')?.offsetHeight ?? 80` — мягкий фоллбэк.
- `type === 'iframe-scroll-to-element'`: то же самое, но с готовой относительной координатой.

Сам iframe считает Y якоря у себя (`el.getBoundingClientRect().top` относительно своего документа) и кладёт это в сообщение — родитель добавляет смещение iframe и собственный header.

### C. Отключить внутренний скролл iframe + быстрый первичный ресайз (фикс bug #3)

- На iframe-элементе ставим `scrolling="no"`, `style.overflow="hidden"` (вместо `auto`). Поскольку высота всегда подгоняется под контент, внутренний скролл не нужен; колесо сразу уходит родителю.
- Внутри `RESIZE_SCRIPT`: добавляем инжект CSS `html,body{overflow:visible !important;height:auto !important;}` через `<style>`-блок в `<head>` сразу при выполнении (DOMContentLoaded не дожидаемся, т.к. скрипт ставится в самом конце `<body>`).
- Первичный `post()` вызываем синхронно сразу при выполнении (не только на `load`), плюс `requestAnimationFrame(post)` — чтобы первый ресайз доехал до родителя за один-два кадра, до того как пользователь успеет прокрутить.
- На стороне родителя: пока `height === minHeight` (т.е. ресайз ещё не пришёл), оставляем `pointer-events: none`? — нет, это сломает первый клик. Вместо этого ставим начальный `minHeight={1}` для site-renderer-кейса не трогаем (контракт), но изменим дефолт: в публичном `HtmlSection` уже сейчас вызывает без аргументов; оставляем `minHeight=100`, но добавляем CSS-флаг: до прихода ресайза iframe растягиваем на `min-height: 100vh` через стилизацию — нет, это не нужно. Достаточно `scrolling=no`+`overflow:hidden` — короткий iframe без своего скролла не «съест» колесо.

### D. Идемпотентность

Маркер `RESIZE_MARKER` теперь покрывает и новый интерсептор (всё в одном `<script>`). Версионируем маркер: `data-lovable-resize-v2`, чтобы старые закэшированные srcdoc-ы регенерировались.

## Технические замечания

- Sandbox-политика остаётся прежней (`allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation`). `allow-same-origin` по-прежнему НЕ выдаётся — `postMessage` работает без него.
- Внешние ссылки получают `target="_blank" rel="noopener noreferrer"` — это улучшение безопасности по сравнению с текущим глобальным `<base target="_blank">` без `rel`.
- Origin родительского сообщения проверяется как раньше через `e.source === iframe.contentWindow`.
- Никакой пользовательский JS из HTML-блока не ломается: `scrollToSection`, `switchTab`, `openModal`, `calculateSavings`, `filterDatabase` продолжают работать; перехватываем только дефолтное поведение `<a>` и `scrollIntoView`.

## Проверка (DoD)

1. В админ-превью страницы `/ideologicheskaya-rabota`:
  - клик по «3 пути», «Выгоды», «Что делаем», «Для кого», «База знаний», «Как начать», «Оплата» → плавный скролл родителя к соответствующей секции, новая вкладка НЕ открывается;
  - клик по логотипу `<a href="#">` → ничего не открывается, новой вкладки нет;
  - клик по «Настроить идеологическую работу» → открывает модалку (внутри iframe, как сейчас);
  - клик по «Открыть демо-доступ» / «Участвовать» → открывает модалку;
  - футерные ссылки `#paths`, `#benefits`, `#what-we-do`, `#db` → скролл родителя;
  - чипы фильтра базы знаний → фильтруют карточки и iframe сам шлёт scroll-to-element родителю (родитель плавно скроллит к области поиска).
2. Скролл колесом сразу после загрузки страницы прокручивает родителя с первого тика (Chrome desktop, Safari iOS, Firefox).
3. Превью корректно перерасчитывает высоту при `switchTab('accountant')` (ResizeObserver) — отсутствует обрезка контента.
4. Mobile (375), tablet (768), desktop (1280, 1440) — iframe растягивается на ширину контейнера, контент рендерится без горизонтального скролла родителя (на странице есть `overflow-x-hidden` у `body`).
5. Smoke-проверка через Playwright на `localhost:8080/admin/sites/7e672fed-13f1-4ff1-8786-71a228a0c011` (preview tab) — скриншоты до/после клика по якорю, скриншот после ручного wheel-теста через `page.mouse.wheel(0, 600)`.

## Не входит в этот патч

- Правки самого HTML-кода страницы — не нужны.
- Изменения схемы блоков, миграции, RLS, edge functions, audit.
- Изменения в `HtmlBlockEditor.tsx`, `HtmlSection.tsx`, `HtmlRawBlock.tsx` (используют тот же `HtmlIframePreview`, фикс применится автоматически).
- Открытые ранее этапы E.1–E.4 (document packages) — не трогаются.

## Файлы

- edit `src/components/shared/HtmlIframePreview.tsx`