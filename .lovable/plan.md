## Диагноз

Страница `gorbova.by/cb` = site_pages.id `d5a5c2e0-…`, единственный HTML-блок (~3 МБ Tilda-экспорт CB 2.0 2026), рендерится в песочнице `HtmlIframePreview` (`sandbox="allow-scripts allow-forms allow-popups …"`, без `allow-same-origin`).

Причины наблюдаемых сбоев:

1. **«Узнать подробнее»** — ссылка `<a href="#podrobnee">`, а якорь в HTML определён по-старому: `<a name="podrobnee">`. Bridge в `HtmlIframePreview` (`BRIDGE_SCRIPT`, строка 309) ищет цель только через `document.getElementById(id)`, не находит и «отпускает» клик. В srcdoc-iframe навигация по `#podrobnee` без соответствующего `id` ничего не делает — кнопка выглядит мёртвой.
2. **«?» над «Рассрочка»** и остальные тултипы `data-tooltip-hook="#popup:…"` — Tilda-попапы (`t706`) внутри iframe остаются `position: fixed; inset: 0` относительно ICB iframe высотой ~60 000 px. Наш repack фиксированных оверлеев исключает `t-popup*` (строка 117), поэтому попап открывается, но «уезжает» к самому верху документа iframe и в видимом viewport parent-страницы его не видно → визуально «не работает».
3. **Слайдер «Свайпай влево»** — Tilda-галерея (`t396` + `t-slds`). Кнопки-стрелки и touch внутри iframe работают, но wheel event перехватывается bridge и релеится parent’у (`iframe-wheel`), поэтому горизонтальный свайп тачпадом уходит в scroll родителя, а не в слайдер. Также кнопки навигации у слайдера отсутствуют в разметке — Tilda-JS их не инициализирует полностью из-за отсутствия `allow-same-origin` (использует `localStorage`).
4. **Пустое пространство ниже футера** — под последним `rec1739234301` (Tilda-footer) ещё несколько скрытых Tilda-декораций и большие спейсеры контейнера с высотой `500 px` при пустом контенте. Родительский iframe получает `scrollHeight` включающий эти пустые артборды.
5. **Замена футера** — сейчас последний `rec1739234301` («КАТЕРИНА GORBOVA + АЖУР инкам…») нужно полностью выкинуть и вставить единый футер как на `gorbowa.club` (уже лежит в `.lovable/artifacts/gorbova-footer.html`) с ссылками на публичную оферту / заказ и оплату / соцсети — все с `target="_blank" rel="noopener"`.
6. **Кнопка «Скачать»** (GetCourse-гайд): `<a href="https://drive.google.com/…" target="_blank">Скачать</a>`. Нужно снять `href` и `target`, оставив визуально ту же кнопку, но неактивной.
7. **Тарифный блок** — не трогаем.

## План

### 1. Патч HTML-блока в `site_pages` (rec1739234301 → новый футер, «Скачать» → без ссылки)

Скрипт `.lovable/artifacts/patch_cb20_footer_download.py` (по образцу `patch_site018_hero.py`):

- Читает `blocks[0].content.code` записи `site_pages.id = d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656` через сервис-роль.
- Сохраняет `before` в `.lovable/artifacts/cb20-before.html`.
- Находит блок `<div id="rec1739234301" class="r t-rec" …>…</div>` (последний rec) и заменяет всё его содержимое на компактный обёрнутый в `<div id="rec1739234301" …>` HTML клубного футера (адаптированный из `.lovable/artifacts/gorbova-footer.html`), где:
  - все `<a href>` = абсолютные URL клуба (`https://gorbova.by/offer`, `https://gorbova.by/order-payment`, соцсети) с `target="_blank" rel="noopener"`.
  - убраны `target="_top"` (в песочнице top-navigation закрыт).
  - фон/типографика — как на клубе (тёмный `#1a0a0e`, `Inter`).
- Находит уникальный `<a class="tn-atom" href="https://drive.google.com/file/d/1UCPrOtSnAey0t8cEyWGam_7TcYzftqxF/view" target="_blank" rel="noopener">…<span…>Скачать</span></a>` и превращает его в тот же элемент без `href`/`target`/`rel` (обычный `<a class="tn-atom" aria-disabled="true" tabindex="-1" style="pointer-events:none;opacity:0.6">…</a>`), кнопка остаётся визуально, но не ведёт никуда.
- Пишет `after` в `.lovable/artifacts/cb20-after.html` и обновляет `blocks` в БД (одно UPDATE).
- В отчёте: diff по длине, число заменённых узлов (ожидаем: 1 футер, 1 «Скачать»).

Идемпотентность: при повторном запуске detect по маркеру `data-lovable-cb20-footer-v1` — если уже есть, пропуск.

### 2. Правка `src/components/shared/HtmlIframePreview.tsx` (bridge)

Минимальные, локальные правки в `BRIDGE_SCRIPT` (bump `BRIDGE_MARKER` → `v4`):

a. **Якорь `<a name="…">`**: в обработчике клика по `href="#id"` — если `document.getElementById(id)` вернул `null`, дополнительно искать `document.querySelector('a[name="'+CSS.escape(id)+'"], [id="'+CSS.escape(id)+'"]')`. При нахождении — считать `top` по нему и постить `iframe-anchor` (как сейчас). Решает «Узнать подробнее».

b. **Repack Tilda-попапов**: убрать `t-popup*` из чёрного списка `isFullscreenFixedOverlay` (строка 117) и добавить отдельный, более узкий фильтр: repack применяем к `t-popup` только когда `getComputedStyle(el).display !== 'none'` **и** `el.offsetHeight > 0`. При закрытии попапа (`display:none` → observer срабатывает) — `restoreFixedOverlay`. Это делает Tilda-попапы (в т.ч. «?»-тултипы) видимыми в viewport родителя.

c. **Горизонтальный wheel не отдавать родителю**: в обработчике `wheel` не постить `iframe-wheel`, если `Math.abs(deltaX) > Math.abs(deltaY)` — оставляем горизонтальный скролл внутри iframe (Tilda-слайдер его использует). Вертикальный wheel как сейчас релеится в parent.

### 3. Верификация (после build-mode, до финального ответа)

- `tsgo` по `HtmlIframePreview.tsx`.
- Playwright headless: открыть `http://localhost:8080/` c hostname override на `cb.gorbova.by` невозможен — вместо этого открыть `http://localhost:8080/` через SitePageBySlug: `/cb` (публичный slug). Проверить:
  1. Клик «Узнать подробнее» → страница проскроллила к секции «подробнее».
  2. Клик «?» рядом с «Рассрочка» → попап открылся в видимой части viewport.
  3. Скролл до низа страницы → внизу новый клубный футер, ссылки в новой вкладке, нет «АЖУР инкам»-Tilda-футера, пустого места после футера нет.
  4. Кнопка «Скачать» — курсор `default`, клик ничего не делает.
- Скриншоты кладём в `/tmp/browser/cb20/screenshots/`.

### 4. Definition of Done

- Кнопка «Узнать подробнее» скроллит к целевой секции.
- «?» над «Рассрочка» и аналогичные тултипы открывают попап в видимой области.
- Свайп-блок «Кейсы моих учеников» листается тачпадом/трекпадом (горизонтальный wheel не уходит в parent).
- Внизу страницы клубный футер вместо Tilda-футера, все ссылки внешние, `target="_blank"`.
- Кнопка «Скачать» без ссылки.
- Тарифный блок не изменён.
- Патч идемпотентен, есть `before`/`after` артефакты.
- Отчёт о выполнении на русском по формату ENGINEERING_RULES.

### Что НЕ входит

- Настройка кнопок «Оплатить обучение / Внести бронь / Заявка на рассрочку / Оплатить от юрлица» в тарифах — отдельный патч (по слову пользователя).
- Изменения в схеме БД, RLS, edge functions.
- Правки других site_pages / других HTML-блоков.
