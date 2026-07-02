# План: динамические тарифы на странице «Идеологическая работа»

## Что делаем
Заменяем статичный блок «Способы оплаты» на странице `ideologicheskaya-rabota` (page_id `7e672fed-13f1-4ff1-8786-71a228a0c011`) на **динамический**, который тянет тарифы и офферы из уже существующего продукта `Gorbova Club — идеология` (`3ea08f79-afe8-4361-81fe-4c0f318f9a2b`). Никаких новых таблиц/сущностей не создаём — используем существующую Edge-функцию `public-product` и уже работающий `lovable:site-action` bridge из `HtmlIframePreview.tsx`.

## Что уже готово в системе (проверено)
- В админке тарифы продукта настроены:
  - `КОРПОРАТИВНОЙ КАРТОЙ` → offer `pay_now`, 350 BYN, кнопка «Оплатить картой».
  - `ПО СЧЁТУ` → offer `pay_now`, 375 BYN, кнопка «Оплатить».
  - `ИНДИВИДУАЛЬНЫЙ ДОГОВОР` → offer `preregistration`, 0 BYN, кнопка «Хочу премиальные условия».
  - (Также есть `Доступ к +600 ответов` — trial, к оплатам не относится, в новом блоке отфильтровывается.)
- Edge-функция `public-product?product_id=…` уже возвращает `{ product, tariffs: [{ …, offers:[…] }] }`.
- Мост `HtmlIframePreview.BRIDGE_SCRIPT` уже перехватывает клики `data-lovable-action="open-offer" data-product-id=… data-offer-id=…` и открывает `PaymentDialog` через `SitePageBySlug`. `open-preregistration` открывает `PreregistrationDialog`. Никакой доработки моста не нужно.

## Изменения (единственный файл — HTML-блок страницы в БД)

Пишем в блоке `3b63835a-f510-4cc8-992b-2de33b2b3f8c` страницы `7e672fed-13f1-4ff1-8786-71a228a0c011` (поле `blocks[0].content.code`) SQL-миграцией:

1. **Заменить секцию `<section id="payment">…</section>` (строки 1487–1566 текущего HTML)** на новый блок:
   - Тот же дизайн-шелл (заголовок «Способы оплаты» + описание, grid 3 колонки, карточка «премиум» в burgundy-фоне).
   - Внутри — контейнер `<div id="ir-tariff-cards" data-product-id="3ea08f79-…">` с плейсхолдером-лоадером.
   - Инлайновый `<script>` в конце секции:
     - Фетчит `SUPABASE_URL/functions/v1/public-product?product_id=…` (публичный ключ анон).
     - Определяет «слот» карточки по имени тарифа: `card` (КАРТ), `invoice` (СЧЁТ), `premium` (ИНДИВИД/ПРЕМИ).
     - Рендерит карточку под слот: иконка (`fa-credit-card`, `fa-file-invoice`, `fa-gem`), цвета (burgundy/coolgray/premium-burgundy-900), цена из `offer.amount` («350 BYN / месяц»), кнопка с `offer.button_label`.
     - Список «Плюсов» берётся из `tariffs.features` (jsonb-массив) или `tariffs.description`, если админ их заполнит; иначе показываются те же буллеты, что в текущей вёрстке (fallback, чтобы дизайн не «поплыл»).
     - Кнопка карточки — `<button data-lovable-action="open-offer|open-preregistration" data-product-id data-offer-id>` (для preregistration используется `open-preregistration`). Мост в `SitePageBySlug` уже валидирует UUID и открывает соответствующий диалог.
     - XSS-safe: значения из БД экранируются локальной `esc()`; в DOM пишутся только через контролируемые шаблоны.
     - Graceful fallback: если EF недоступна — показать сообщение «Тарифы временно недоступны. Обновите страницу».
2. **CTA-кнопки «Настроить идеологическую работу»** (шапка сайта, hero, финальный CTA) переводятся с `onclick="openModal('setup')"` на плавный скролл к `#payment`:
   `onclick="var el=document.getElementById('payment'); if(el){el.scrollIntoView({behavior:'smooth',block:'start'});} return false;"`.
   Мост `HtmlIframePreview` уже перехватывает `scrollIntoView` и корректно скроллит родительскую страницу.
3. Модалка `openModal('setup')` в HTML не удаляется — она остаётся для потенциального переиспользования, просто CTA к ней больше не ведут (изоляция изменений: минимальный риск сломать соседние блоки).

## Что НЕ трогаем
- Схема БД, миграции, RLS.
- Компоненты фронта (`SitePageBySlug.tsx`, `HtmlIframePreview.tsx`, `PaymentDialog.tsx`, `PreregistrationDialog.tsx`) — их поведение уже подходит.
- Остальной контент страницы (hero, база знаний, тайминги, футер).

## Как проверить
- Открыть `/ideologicheskaya-rabota`, дождаться подгрузки карточек (≤ 1 сек).
- Кликнуть «Оплатить картой» → должен открыться `PaymentDialog` для 350 BYN.
- Кликнуть «Оплатить» на «По счёту» → `PaymentDialog` для 375 BYN.
- Кликнуть «Хочу премиальные условия» → `PreregistrationDialog`.
- Изменить в админке продукта `КОРПОРАТИВНОЙ КАРТОЙ` цену/лейбл кнопки → перезагрузить страницу → карточка обновилась без правок HTML.
- CTA «Настроить идеологическую работу» (в шапке, hero и финальном CTA) — плавный скролл до блока «Способы оплаты».

## Готов выполнить
План минимально-инвазивный: одна SQL-правка HTML-блока страницы, ничего в коде фронта/БД/EF не меняем. Переключите режим в build — и я применю миграцию.
