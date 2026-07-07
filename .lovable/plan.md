
## План: очистка блока «Как открыть доступ» + динамические кнопки оплаты на /cb

### Контекст
- Страница `site_pages.slug='cb'` (id `d5a5c2e0-…`) — один html-блок (Tilda-выгрузка) в iframe (`HtmlIframePreview`).
- Страница уже связана: `site_pages.product_id = 7101ed3c-…` = продукт `cb20` («Ценный бухгалтер | 1 ступень 2.0»).
- Продукт `cb20` содержит 3 тарифа и по одному офферу «Оплатить обучение» (pay_now, full_payment):
  - Бухгалтер — 1650 BYN — offer `29b0ee41-…`
  - Главный бухгалтер — 1950 BYN — offer `badded0d-…`
  - Бизнес-леди — 2650 BYN — offer `c667880e-…`
- На сайте кнопки «Оплатить обучение» сейчас ведут в Tilda-поп-апы: `#popup:buh` (Бухгалтер), `#popup:gl_buh` (Главный бухгалтер), `#popup:biz-l` (Бизнес-леди). Это стабильный ключ маппинга «карточка → тариф».
- Блок «Как открыть доступ» — Tilda-контейнер `<div id="rec776467190">…</div>` (сразу перед футером `rec1739234301`).

Другие кнопки в карточках (Заявка на рассрочку, Оплатить от юрлица) не трогаем — оставим Tilda-поведение, пользователь подключит их отдельным патчем.

### Что делаем

#### 1. Удаляем блок «Как открыть доступ» (SQL-миграция)
- В `site_pages.blocks[0].content.code` вырезаем контейнер `<div id="rec776467190" …>…</div>` целиком (по стабильному rec-id, регэксп нежадный до закрывающего `</div>` уровня секции). Дальше рядом остаётся футер `rec1739234301` — его не трогаем.
- Ставим маркер-версию `data-lovable-cb20-remove-rec776467190-v1="1"` рядом с началом футера, чтобы можно было верифицировать применение SQL.
- Верификация: `position('rec776467190' in code) = 0` и маркер найден.

#### 2. Добавляем стабильные атрибуты для кнопок оплаты (SQL-миграция, тем же файлом)
Для каждой из трёх ссылок `<a class="tn-atom" href="#popup:{buh|gl_buh|biz-l}">…Оплатить обучение…</a>` добавляем data-атрибуты:
- `data-lovable-pay="1"`
- `data-lovable-tariff-key="buh" | "gl_buh" | "biz-l"`

Ничего другого в HTML не меняем — Tilda-поп-апы других кнопок продолжают работать по-прежнему.

#### 3. Прокидываем продукт cb20 в html-блок (frontend)
- В `src/pages/SitePageBySlug.tsx`: если `page.product_id` задан — подтянуть его через уже существующий `usePublicProduct({ productId })` и передать в `SitePageRenderer` новым пропом `linkedProduct` (product + tariffs с офферами).
- В `src/components/site-renderer/SitePageRenderer.tsx`: пробросить `linkedProduct` в `HtmlSection`.
- В `src/components/site-renderer/blocks/HtmlSection.tsx`: передать `linkedProduct` в `HtmlIframePreview` новым опциональным пропом `paymentBridge`.

Никаких новых таблиц/эндпоинтов — только использование существующего `usePublicProduct` и `PaymentDialog`.

#### 4. Мост «iframe → PaymentDialog» в `HtmlIframePreview`
- Bump `BRIDGE_MARKER` до `v6`.
- Строим статический маппинг `tariffKey → { tariffId, tariff, primaryPayOffer }` из `paymentBridge.tariffs` (правило: `offer_type === 'pay_now'` c минимальной ценой; если оффера нет — кнопка остаётся с исходным `href="#popup:…"`).
  - Ключ карточки определяется по позиции карточки в Tilda-разметке (1-й `data-lovable-tariff-key="buh"` → первый тариф продукта по возрастанию amount и т.д.). Сначала используем прямое соответствие по amount (1650→buh, 1950→gl_buh, 2650→biz-l), чтобы порядок не сломался, если админ поменяет сортировку.
- В inject-скрипт iframe добавляем обработчик: для всех `a[data-lovable-pay="1"]` с известным маппингом:
  - убираем Tilda popup-click, вешаем свой click → `parent.postMessage({ type: 'lovable:openPayment', offerId, tariffId, productId, tariffKey }, '*')`;
  - остальные `#popup:*` не трогаем.
- Родитель (`HtmlIframePreview` в React-контексте) слушает сообщение и монтирует уже существующий `PaymentDialog` (как в `ProductLanding.tsx`) с теми же параметрами (offerId, price, tariffCode, paymentMethod, isTrial=false, isClubProduct=false, isSubscription=false — офферы pay_now/full_payment).

Дизайн Tilda-кнопок не меняем — только перехват click, визуал остаётся прежним.

### Что НЕ входит в этот патч (по явной просьбе)
- Не рендерим тарифные карточки динамически — Tilda-разметка остаётся.
- Не подключаем «Заявка на рассрочку» и «Оплатить от юрлица» — сделаем отдельным патчем, когда пользователь настроит соответствующие офферы в продукте.
- Не добавляем блок `pricing` — визуально сохраняем текущую Tilda-раскладку.

### Verify (Definition of Done)
- В preview `/cb`: блока «Как открыть доступ» больше нет; сразу под FAQ идёт футер.
- Клик по «Оплатить обучение» в любой из 3 карточек → открывается `PaymentDialog` с корректной суммой (1650/1950/2650) и тарифом.
- Остальные кнопки (Заявка на рассрочку, Оплатить от юрлица) продолжают вести на Tilda-поп-апы / внешнюю ссылку без изменений.
- Playwright-скрин каждой из 3 карточек с открытым `PaymentDialog`.
- Скрин страницы после удаления блока (нет пустой розовой секции с «СКАЧАТЬ»).

### Технические заметки
- Изменяемые файлы: SQL-миграция; `src/pages/SitePageBySlug.tsx`; `src/components/site-renderer/SitePageRenderer.tsx`; `src/components/site-renderer/blocks/HtmlSection.tsx`; `src/components/shared/HtmlIframePreview.tsx`.
- Никаких изменений схемы БД, RLS/GRANT, edge-функций.
