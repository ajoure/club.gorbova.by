согласен. также убери made on tilda внизу страницы блок.

&nbsp;

&nbsp;

План: HTML-блок ЦБ 2.0 — восстановление якорей и Tilda popup

## Диагностика

Страница `/cb` (site_pages.id = `d5a5c2e0-…`) содержит один HTML-блок объёмом ~3 076 875 символов — экспорт Tilda с `tilda-popup-1.1.min.css`, `tilda-blocks-page*.min.js` и т.д. HTML корректно сохранён и рендерится в изолированном iframe через `src/components/shared/HtmlIframePreview.tsx`.

В HTML найдены такие внутренние ссылки:

- `#tarif`, `#podrobnee` — обычные якоря;
- `#popup:biz-l`, `#popup:biz-l_rass`, `#popup:buh`, `#popup:buh_ras`, `#popup:gl_buh`, `#popup:gl_buh_rass` — Tilda-синтаксис открытия модалок (`t-popup`), обрабатывается собственным JS Tilda в bubble-phase (`t_popup__showPopup`, `t396_init` и т.п.).

Внешние ссылки — абсолютные `https://…` (offer, getcourse, tilda CDN, telegram, instagram).

**Причина сбоя** находится в `BRIDGE_SCRIPT` (`HtmlIframePreview.tsx`, строки 273–328) — единый capture-phase click-handler для всех `<a>`:

1. Для любого `href`, начинающегося с `#`, вызывается `ev.preventDefault(); ev.stopPropagation();` и `parent.postMessage({type:'iframe-anchor', id, targetOffsetTop, found})`.
2. Для `#popup:xxx` `getElementById('popup:xxx')` возвращает `null` → `targetOffsetTop=0`, а `stopPropagation` съедает event до собственного Tilda-хендлера popup'а. Итог: popup никогда не открывается, а страница дергается вверх.
3. Для несуществующих id (`found=false`) parent-обработчик всё равно скроллит родителя к `top=0` — визуально «прыжок наверх», выглядит как «якорь не работает».
4. Для внешних ссылок `window.open(url, '_blank', 'noopener,noreferrer')` вызывается изнутри sandbox без `allow-same-origin`. В Safari popup-blocker периодически глушит такой вызов; без fallback ссылка кажется «мёртвой». Также остаётся риск `about:srcdoc/...` для теоретических относительных ссылок (в этом файле их нет, но правило общее).

Механика самого блока (`SitePageService`, `PublicPageSlugRoute`, `HtmlSection`) исправна — HTML доходит до iframe целиком, проблема только в bridge-скрипте.

## Что меняем (только фронт, только `HtmlIframePreview.tsx`)

### 1. Не перехватывать Tilda-popup ссылки

В capture-хендлере после `findAnchor`:

- Если `rawHref` начинается с `#popup:` (или маркер `data-tooltip-hook`, `class` содержит `t-popup__close`/`t-popup__btn`) — `return` без `preventDefault/stopPropagation`. Автор-код Tilda сам откроет модалку в bubble-phase.

### 2. Fallback для «неизвестных» hash-ссылок

- Перед `preventDefault` проверить `document.getElementById(id)`. Если элемент не найден **и** id содержит `:` или начинается с известного Tilda-префикса — не перехватывать (даём Tilda-скриптам шанс).
- Если элемент не найден и id «обычный» — также не перехватывать (не портим UX «скачком наверх»), только логируем в `console.debug`.

### 3. Внешние ссылки — устойчивое открытие

- Первым делом пробуем `var w = window.open(url, '_blank', 'noopener,noreferrer')`.
- Если `w === null` (popup-blocker) — шлём `parent.postMessage({type:'iframe-open-url', url})`; parent открывает через `window.open` из своего origin (не заблокировано, т.к. вызов внутри user-activation click bubble).
- В parent (`HtmlIframePreview` message handler) добавить ветку `iframe-open-url`: строгая проверка `url` — только `http://` / `https://` / `mailto:` / `tel:` (regex whitelist), затем `window.open(url, '_blank', 'noopener,noreferrer')`.

### 4. Не мешать Tilda popup-элементам

- В `isFullscreenFixedOverlay` исключить элементы с классом `t-popup` / `t-popup__container` / `t-popup__close` — эти overlay'ы Tilda управляет сам (открытие/закрытие, backdrop). Наш «упаковщик fixed→absolute» ломает центрирование модалки и её backdrop.

### 5. Обычные якоря (`#tarif`, `#podrobnee`)

Логика скролла в parent (`iframe-anchor` handler, строки 525–559) остаётся — она корректна, если id реально есть в документе. После правки п.2 они начнут работать (сейчас они, возможно, тоже работали, но правки п.1–4 не должны их сломать).

### 6. Bump `BRIDGE_MARKER`

Поднимаем `data-lovable-resize-v2` → `data-lovable-resize-v3`, чтобы старый закешированный srcdoc принудительно переинициализировался.

## Технические детали

Файлы:

- `src/components/shared/HtmlIframePreview.tsx` — единственный правимый файл. Изменения: click-handler в `BRIDGE_SCRIPT`, `isFullscreenFixedOverlay`, `handleMessage` (новая ветка `iframe-open-url`), `BRIDGE_MARKER`.

Ничего не трогаем: `HtmlSection.tsx`, `SitePreview.tsx`, `SitePageService`, БД, стор HTML-блока, `sandbox` политику (остаётся прежней, popup-blocker mitigation через parent-relay).

## Verification (после реализации)

1. `/admin/sites/d5a5c2e0-…` → «Предпросмотр»: клик по `#popup:biz-l` открывает Tilda-модалку внутри iframe, backdrop и close корректно работают.
2. Клик по `#tarif`, `#podrobnee` — плавный скролл parent к соответствующей секции; страница не «прыгает наверх».
3. Клик по `https://gorbova.getcourse.ru/yurlizo1` — открывается в новой вкладке (проверить в Chrome и Safari; Safari с включённым Prevent Cross-Site Tracking).
4. Опубликованная страница `https://gorbova.by/cb` — те же три сценария.
5. `console.warn` про `[HtmlIframePreview] height clamped` не появляется (не должен и не должен появиться после правок).

## DoD

- Tilda `#popup:*` открываются и закрываются в предпросмотре и на продакшене.
- Якоря `#tarif`, `#podrobnee` скроллят parent-страницу.
- Внешние ссылки открываются в новой вкладке в Chrome и Safari.
- Нет прыжка страницы вверх при клике по «мёртвым» hash-ссылкам.
- `tsgo` / build без ошибок; `HtmlIframePreview` unit-тесты (если есть) зелёные.
- Никаких изменений вне `HtmlIframePreview.tsx`.