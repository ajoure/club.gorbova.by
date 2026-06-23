## План: уплотнить hero страницы «Идеологическая работа» (SITE-000018)

**Цель.** На десктопе ~900–1000 px по высоте первый экран должен включать одновременно блок «Решение под ключ за 1 день» и полосу «Гарантия безопасности». Фото Катерины показать как в оригинальном HTML-макете (видны плечо и рука), убрать ощущение размытия за счёт уменьшения upscale-зума.

### Diagnose (уже выполнено)
- `site_pages` id `7e672fed-13f1-4ff1-8786-71a228a0c011`, `blocks[0].content.code` — единственный html-блок (~425 КБ).
- Текущие правила (после прошлого патча):
  - `.ir-hero-v2`, `.ir-hero-v2__wrap`, `.ir-hero-v2__visual` → `min-height: 715px`.
  - `.ir-hero-v2__person` принудительно растянут `inset:0; width/height:100%; object-fit:cover; object-position:center top` — отсюда сильный zoom на лицо и видимое размытие base64-PNG.
  - `.ir-hero-v2__title` `clamp(44px,5.2vw,70px)`, `margin: 44px 0 24px`.
  - `.ir-hero-v2__content` `padding: 18px 38px 32px 30px`.
  - `.ir-hero-v2__features` `gap: 23px`.
  - `.ir-guarantees-strip` `padding: 2.5rem 1.25rem 3rem`; `__wrap` `padding: 2rem 2.25rem`; `__grid` `gap: 2rem`; `__stats` `margin-top: 1.75rem; padding-top: 1.25rem`.
- Изображение — встроенный base64 PNG фиксированного разрешения; реальное «улучшение качества» возможно только через уменьшение upscale-фактора (меньше растягивать).

### Изменения (только CSS-оверрайды внутри `<style id="hero-fullbleed-override">` уже существующего блока)

1. **Уменьшить высоту hero**
   - `.ir-hero-v2, .ir-hero-v2__wrap, .ir-hero-v2__visual { min-height: 560px; }` на десктопе ≥1025px.
   - На промежуточных (≤1280px) — 520px; на планшете (≤900px) — auto.

2. **Уплотнить текстовый блок**
   - `.ir-hero-v2__title { font-size: clamp(36px, 4.2vw, 56px); margin: 18px 0 14px; }`.
   - `.ir-hero-v2__content { padding: 12px 30px 18px 24px; }`.
   - `.ir-hero-v2__lead { margin: 0 0 14px; font-size: 15px; line-height: 1.45; }`.
   - `.ir-hero-v2__features { gap: 12px; margin-bottom: 18px; }`.
   - `.ir-hero-v2__cta { margin-top: 14px; }`.

3. **Фото Катерины — показать шире, как в оригинале**
   - Оставить `position:absolute; inset:0; width:100%; height:100%; display:block;`.
   - Поменять `object-fit: cover; object-position: center top` → **`object-fit: contain; object-position: right bottom;`** + фон контейнера `background: linear-gradient(180deg,#0f1722 0%, #121d28 100%)` (чтобы не было «обрезанной» полосы сверху).
   - Добавить `image-rendering: auto; -webkit-backface-visibility: hidden; transform: translateZ(0);` для устранения субпиксельного размытия.
   - На десктопе photo выровнено по правому-нижнему углу — видно плечо, руку, подбородок (как в оригинальном `сайт Экран 1 КП.html`).
   - Лёгкий градиентный fade снизу `.ir-hero-v2__visual::after { height: 14%; }` (уменьшить с 28%).

4. **Полоса «Гарантия безопасности» — компактнее**
   - `.ir-guarantees-strip { padding: 1rem 1.25rem 1.25rem; }`.
   - `.ir-guarantees-strip__wrap { padding: 1.1rem 1.5rem; border-radius: 18px; }`.
   - `.ir-guarantees-strip__label { margin-bottom: 0.75rem; }`.
   - `.ir-guarantees-strip__grid { gap: 1.25rem; }`.
   - `.ir-guarantees-strip__body h3 { font-size: 0.98rem; margin-bottom: 0.2rem; }`.
   - `.ir-guarantees-strip__body p { font-size: 0.8rem; line-height: 1.4; }`.
   - `.ir-guarantees-strip__stats { margin-top: 0.9rem; padding-top: 0.75rem; }`.

5. **Ничего другого не менять**: разметка `<section>`, картинка (тот же base64), кнопки, `openModal('setup')`, навигация, поиск, `#db`, `#timeline`, `#payment`, React, edge-functions, RPC, миграции — без изменений. SITE-000017 не трогаем.

### Технический процесс
1. Прочитать текущий `blocks[0].content.code` из БД целиком (через временную таблицу/edge-стейджинг, как делали ранее).
2. Локальный python-скрипт `.lovable/artifacts/patch_site018_hero_compact.py` хирургически заменяет содержимое блока `<style id="hero-fullbleed-override">…</style>` на новую версию с правилами выше. Все остальные стили и HTML — байт-в-байт без изменений.
3. Залить обратно через временную таблицу + base64-чанки (точно тот же приём, что в прошлый раз) и удалить временные артефакты после `UPDATE`.
4. Сохранить before/after: `site018-hero-compact-before.html`, `site018-hero-compact-after.html`.

### Verify (Playwright, headless)
- Десктоп 1280×900: скриншот первого экрана — видны заголовок, lead, чек-листы, обе CTA-кнопки **и** полоса «Гарантия безопасности» с 3 пунктами и «400+ проверок». Скриншот в `.lovable/artifacts/site018-hero-compact-desktop-900.png`.
- Десктоп 1440×1000 — то же.
- Мобильный 390×844 — стек: контент → фото (видно плечо/рука) → гарантии в 1 колонку.
- Клик по «Настроить идеологическую работу» — открывается модал `setup`.
- DOM-проверка: блок `#db` (поиск по 600+ ответов) не затронут, кнопка «Участвовать» работает.

### DoD
- [ ] На 1280×900 hero + гарантии помещаются в один экран без скролла.
- [ ] Фото Катерины показано шире (плечо, рука, как в оригинале), без видимого размытия.
- [ ] Никаких регрессий: модалы, поиск по базе знаний, навигация, мобильная вёрстка, остальные секции работают как раньше.
- [ ] Скриншоты desktop/mobile приложены в артефактах.
- [ ] Изменений в коде React/edge/DB schema/RPC нет — только обновление html-блока в `site_pages`.
