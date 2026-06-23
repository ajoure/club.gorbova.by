да, согласен, с учетом правок:

1. **Не фиксировать hero жёстко через** `height: calc(100vh - 64px)` **без fallback.**  
Это может снова обрезать контент на браузерах с другой высотой header/browser UI. Лучше:
  &nbsp;
  ```css
  @media (min-width: 1025px) {
    .ir-hero-v2 {
      min-height: calc(100vh - 64px);
      height: auto;
      max-height: none;
    }
  }
  ```
  Если нужна именно посадка в первый экран — управлять через compact-padding, а не жёстко резать высоту.
2. **CTA-блок не делать** `margin-top: auto`**, если родитель не flex-column.**  
Сначала проверить структуру `.ir-hero-v2__content`. Если она не `display:flex; flex-direction:column`, то `margin-top:auto` не сработает предсказуемо. Тогда добавить явно:
3. **Кнопки должны быть подняты, а не прижаты к самому низу.**  
Добавить безопасный нижний резерв:
  &nbsp;
  ```css
  .ir-hero-v2__cta {
    margin-top: 18px;
    margin-bottom: 24px;
  }
  ```
  Цель — кнопки полностью видны, но не висят на границе hero.
4. **Glass-плашку поднять, но не перекрыть фото/контент.**  
`bottom: 56px` допустимо, но в verify проверить, что плашка:
  - не закрывает лицо/руку;
  - не налезает на CTA;
  - не обрезается снизу.
5. **Белую полосу искать по фактическому источнику.**  
Перед CSS-лечением проверить, откуда она идёт:
  - iframe/body background;
  - следующая секция;
  - margin/padding hero;
  - wrapper site-renderer;
  - `HtmlIframePreview` высота/фон.
  Не добавлять лишний `background: transparent`, если нужен наоборот тёмный фон. Правильнее:
6. **Не использовать временные edge-функции, если можно сделать через существующий безопасный SQL/update-процесс.**  
Временные edge-функции `read-site-blocks` / `apply-site-blocks-patch` — лишний риск и мусор, если уже есть рабочий процесс через SQL/base64 staging.  
Если всё-таки используются — обязательно:
  - создать;
  - применить;
  - удалить;
  - подтвердить удаление в отчёте.
7. **CSS добавлять маркированным блоком.**  
Чтобы не плодить дубли:
  &nbsp;
  ```css
  /* lovable-hero-final-bottom-v1 */
  ...
  /* /lovable-hero-final-bottom-v1 */
  ```
  Повторный запуск должен заменять этот блок, а не добавлять новый.
8. **Добавить проверку 1366×768.**  
Это критичный размер ноутбука. DoD дополнить:
9. **Проверить не только скриншотом, но и DOM-геометрией.**  
В Playwright добавить:
  &nbsp;
  ```js
  const ctaBox = await page.locator('.ir-hero-v2__cta').boundingBox();
  const viewport = page.viewportSize();
  expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(viewport.height);
  ```
  С поправкой на browser/header, если проверка идёт внутри iframe.
10. **Mobile не должен получить desktop-height.**  
В mobile override обязательно:

```css
@media (max-width: 1024px) {
  .ir-hero-v2 {
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
  }
}
```

11. **Отчет должен подтвердить, что изменён только CSS.**  
В финальном отчёте отдельно указать:

```text
HTML-разметка, кнопки, ссылки, openModal, #db, header/footer, RPC, React-код и схема БД не изменялись.
```

12. **Publish-status обязателен.**

```text
Изменения внесены в данные/preview. Для появления на gorbova.by требуется Lovable Publish.
```

13. **Обязательное требование для [Lovable.dev](http://Lovable.dev):**

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

План: Финальная правка низа hero SITE-000018
```

## Что чиним

1. CTA-кнопки уехали ниже видимой области первого экрана.
2. Кнопки выглядят несимметрично, низ обрезается.
3. Плашка «Гарантия безопасности» сидит слишком низко.
4. Белая горизонтальная полоса между hero и следующей секцией.

## Решение (только CSS-override в `<style id="hero-fullbleed-override">` HTML-блока SITE-000018)

1. **Высота hero под viewport первого экрана:**
  - `.ir-hero-v2 { min-height: calc(100vh - 64px); height: calc(100vh - 64px); max-height: 900px; }` — учёт header'а, чтобы CTA гарантированно входили на 1280×900 и 1440×1000.
  - Внутренний `padding-bottom: 24px` на `.ir-hero-v2__wrap` — резерв под кнопки.
2. **CTA-блок:**
  - Контейнер кнопок: `display: flex; gap: 12px; align-items: stretch; margin-top: auto; padding-top: 16px;`
  - Обе кнопки: `flex: 1 1 0; min-height: 56px; height: 56px; padding: 0 20px; display: inline-flex; align-items: center; justify-content: center; white-space: normal; line-height: 1.2;` — одинаковая высота, симметрия, без обрезки.
  - `.ir-hero-v2__content { padding-bottom: 8px; }` чтобы кнопки не липли к нижнему краю.
3. **Glass-плашка «Гарантия безопасности»:**
  - Поднять примерно на 1 см: `bottom: 56px` (было `1.5rem` ≈ 24px → +~32px ≈ 1 см).
  - Остальные свойства не трогаем.
4. **Белая полоса внизу hero:**
  - `.ir-hero-v2 { margin-bottom: 0 !important; border-bottom: 0 !important; }`
  - Обёртка секции и следующая секция: убрать верхний/нижний gap через `.ir-hero-v2 + * { margin-top: 0 !important; }` и на родителе hero `padding-bottom: 0`.
  - Если white gap идёт от body/section wrapper — добавить `background: transparent` на wrapper hero, чтобы тёмный фон hero доходил до следующей секции вплотную.
5. **Адаптив ≤1024px (mobile 390×844 не ломать):**
  - `.ir-hero-v2 { height: auto; min-height: auto; max-height: none; }`
  - CTA: `flex-direction: column;` кнопки `width: 100%`.
  - Glass: `position: static; bottom: auto;`.

## Не трогаем

Разметка, тексты, ссылки, `openModal('setup')`, `#db`, header, footer, остальные секции, RPC, edge-функции, миграции, RLS, фото Катерины и её URL, SITE-000017.

## Метод

Временные edge-функции `read-site-blocks` + `apply-site-blocks-patch` (создать → применить → удалить), скрипт `.lovable/artifacts/patch_site018_hero_final.py`, `UPDATE site_pages WHERE id='7e672fed-13f1-4ff1-8786-71a228a0c011'`, сохранение before/after HTML.

## DoD / Verify

1. Screenshot desktop 1280×900 — обе CTA полностью видны, симметричны.
2. Screenshot desktop 1440×1000 — обе CTA полностью видны.
3. Glass-плашка поднята ~1 см, входит в hero.
4. Белой полосы внизу hero нет.
5. Screenshot mobile 390×844 — без регрессий.
6. Клик «Настроить идеологическую работу» → модалка `setup` открывается.
7. Клик «Посмотреть 600+ готовых ответов» → скролл к `#db`.
8. Для production gorbova.by — Lovable Publish после approve.