да, согласен, с учетом правок:

1. **Сохрани add-only относительно предыдущего фикса.**  
Новый план не должен заменить уже согласованные требования по:
  - удалению глобального `<base target="_blank">`;
  - перехвату `href="#..."`;
  - безопасному открытию внешних ссылок через `_blank + noopener/noreferrer`;
  - `scrolling="no"` / `overflow:hidden`;
  - строгой проверке `event.source === iframeRef.current?.contentWindow`.
2. `syncFixedOverlays()` **не должен трогать все** `position: fixed` **подряд.**  
Нужно ограничить обработку только fullscreen overlay-кандидатами, например:
  &nbsp;
  &nbsp;
  - `position: fixed`;
  - `inset: 0` или близкий fullscreen-паттерн;
  - элемент видим;
  - `z-index`/классы/размеры указывают на modal overlay.  
  Обычные sticky/fixed элементы внутри HTML не ломать.
3. **При закрытии модалки обязательно возвращать исходные inline-стили.**  
Если bridge временно переводит overlay в `position:absolute`, нужно сохранять previous inline values и восстанавливать их после скрытия, чтобы не мутировать пользовательский HTML навсегда.
4. `window.scrollTo/scrollBy` **перехватывать с fallback.**  
Если родительский bridge недоступен или сообщение не обработано, нативное поведение внутри iframe должно сохраниться. Нельзя полностью убивать пользовательский JS.
5. **Root-scroll detection оформить отдельным helper и покрыть админку.**  
Нужно явно различать:
  - публичную страницу с `window/document` scroll;
  - admin preview внутри scroll-container;
  - lesson editor preview.  
  Для каждого режима должны быть разные расчёты `viewportTop`, `viewportHeight`, `scrollTop`.
6. **Mobile-фикс не должен быть глобальным CSS-обнулением.**  
Не добавлять агрессивные правила типа `* { max-width: 100vw }`, которые могут сломать авторский дизайн. Только точечная стабилизация iframe/overlay.
7. **В DoD добавить проверку закрытия модалки.**  
Нужно проверить:
  - открыть модалку;
  - закрыть;
  - открыть повторно;
  - форма снова появляется в видимой области;
  - затемнение не остаётся висеть.
8. **В DoD добавить проверку второго типа модалки.**  
Проверить обе кнопки:
  - `openModal('setup')`;
  - `openModal('access')`.
9. **В отчёте обязательно указать статус custom domain.**  
Если localhost/preview исправлен, а `gorbova.by` ещё показывает старый bundle, это не считать провалом кода. В отчёте отдельно написать:  
`Код исправлен, для публичного домена требуется Publish`.
10. **Отчет Lovable должен быть строго на русском языке.**

&nbsp;

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

План:
```

## 1. Проблема

На опубликованной странице `gorbova.by/ideologicheskaya-rabota` кнопки внутри HTML-блока визуально «зависают»: после клика появляется затемнение/blur, но форма оказывается не в видимой области. Якоря и скролл работают нестабильно, хотя в редакторе/предпросмотре поведение выглядит лучше.

## 2. Диагностика

Факты, уже проверенные:

- Страница `site_pages.id = 7e672fed-13f1-4ff1-8786-71a228a0c011`, slug `ideologicheskaya-rabota`, status `published`, один блок `type=html`.
- Публичный рендер идёт через `src/components/site-renderer/blocks/HtmlSection.tsx` → `src/components/shared/HtmlIframePreview.tsx`.
- HTML содержит модалку:
  - `#leadModal` с `class="fixed inset-0 ... hidden ..."`;
  - кнопки вызывают `openModal('setup')` / `openModal('access')`;
  - форма вызывает `handleFormSubmit(event)` и показывает `#successState`.
- Playwright на опубликованном сайте воспроизвёл дефект:
  - desktop: iframe height `9868`, modal overlay height `9868`, modal card top около `4659`;
  - tablet: iframe height `13869`, modal card top около `6659`;
  - mobile: iframe height `15000`, modal card top около `7203`, card частично уходит влево.
- Корневая причина: sandbox iframe растянут на всю высоту HTML-документа, поэтому `position: fixed` внутри iframe фиксируется не относительно реального окна браузера, а относительно огромного iframe. Текущий bridge ошибочно считает `document.scrollingElement` обычным scroll-container и передаёт высоту всего документа как viewport.

## 3. Предлагаемое решение

Исправить общий iframe-адаптер, не трогая сам HTML страницы и не меняя БД:

### A. Правильная геометрия viewport родителя

В `HtmlIframePreview.tsx` добавить корректное различение:

- root-scroll (`document.scrollingElement`, `html`, `body`) → использовать `window.innerHeight`, `window.scrollY`, `iframe.getBoundingClientRect()`;
- вложенный scroll-container в админке → использовать его `clientHeight`, `scrollTop`, `getBoundingClientRect()`.

Результат: iframe будет получать реальную видимую область браузера, а не высоту всего HTML-документа.

### B. Починить fixed-модалки внутри iframe

В bridge-скрипте для полноэкранных fixed-overlay:

- переводить overlay в `position:absolute` только на время показа;
- выставлять `top = parentViewport.top`, `height = parentViewport.height`, `bottom:auto`, `left:0`, `right:0`;
- синхронизировать сразу после клика, после DOM mutation, resize, scroll и получения viewport-сообщения.

Результат: `#leadModal` и карточка формы будут появляться в текущей видимой области, а не в середине 10–15 тыс. px iframe.

### C. Починить авторские scroll-функции HTML

Сейчас HTML вызывает `window.scrollTo(...)` внутри iframe (`scrollToSection`). Это не скроллит родительскую страницу. Нужно в bridge:

- перехватить `window.scrollTo` / `window.scrollBy` внутри iframe и делегировать scroll родителю;
- сохранить существующий перехват `scrollIntoView`;
- для `href="#..."` отправлять родителю точный target offset с учётом header внутри HTML-страницы.

Результат: верхние якоря, `Посмотреть 600+ готовых ответов`, `scrollToSection('db')`, `setSearchFilter()` не будут «самолистать» в iframe и сбрасываться.

### D. Стабилизировать mobile/tablet

Минимально в injected CSS:

- убрать горизонтальный сдвиг overlay на мобильных;
- не ломать произвольный HTML-контент;
- оставить auto-height iframe без внутреннего scroll.

## 4. Изменяемые компоненты

Только:

- `src/components/shared/HtmlIframePreview.tsx`

Будут затронуты UI-пути, которые уже используют этот компонент:

- публичный site-builder HTML block;
- preview в админке конструктора сайтов;
- preview HTML-блоков в lesson editor.

## 5. Что не будет изменено

- Не менять HTML-код страницы в `site_pages.blocks`.
- Не менять `site_pages`, `site_domain_bindings`, формы, RLS, edge functions, миграции.
- Не добавлять новую систему форм/лидов.
- Не менять `HtmlSection.tsx`, `SitePageRenderer.tsx`, `SitePageBySlug.tsx`, если после фикса bridge это не потребуется.
- Не публиковать приложение автоматически без отдельной команды на публикацию.

## 6. Dry-run

Перед изменением:

- использовать текущий Playwright reproduction как baseline;
- подтвердить, что проблема именно в iframe viewport/fixed overlay, а не в данных страницы.

После изменения, до финального отчёта:

- проверить локальный preview/localhost на том же route;
- проверить desktop/tablet/mobile сценарии;
- если опубликованный домен ещё отдаёт старый bundle, отдельно указать, что нужен Publish приложения.

## 7. Execute

Внести точечный патч в `HtmlIframePreview.tsx`:

1. Добавить helper для root-scroll-container detection.
2. Переписать `postParentViewport()` так, чтобы root document не давал высоту всего документа вместо viewport.
3. Уточнить `syncFixedOverlays()` для fixed fullscreen overlay.
4. Добавить safe relay для `window.scrollTo/scrollBy` из iframe в parent.
5. Уточнить anchor offset с учётом header внутри iframe и parent header только там, где он реально есть.
6. Добавить scroll listener для найденного scroll-container и cleanup.

## 8. STOP-guards

Остановиться и не патчить вслепую, если:

- окажется, что HTML больше не рендерится через `HtmlIframePreview`;
- обнаружится второй публичный renderer для этой страницы;
- Playwright покажет, что клики ломаются не из-за iframe geometry, а из-за JS runtime error в HTML;
- фикс начнёт ломать админский preview или lesson HTML preview.

## 9. DoD

Задача считается закрытой, когда Playwright подтверждает и в отчёте приложены скриншоты:

- desktop: клик `Настроить идеологическую работу` открывает видимую форму, не тёмный пустой экран;
- tablet: форма открывается в видимой области;
- mobile: форма не уезжает влево/вниз и доступна для заполнения;
- `Отправить данные эксперту` показывает `Заявка принята!`;
- `Посмотреть 600+ готовых ответов` и верхний якорь `База знаний` скроллят к секции `#db` без новой вкладки и без сброса;
- первый wheel-scroll не «залипает»;
- в консоли нет новых критичных ошибок.

## 10. Риски и зависимости

- Публичный custom domain может продолжать показывать старый bundle до публикации приложения. В таком случае код будет исправлен в preview, но для `gorbova.by` потребуется отдельное действие Publish.
- Компонент общий: изменение должно быть совместимо с админским preview и lesson HTML preview.
- HTML использует CDN Tailwind в production; это даёт warning, но не является причиной текущего зависания и не входит в scope.