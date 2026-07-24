План:

## Цель
Создать скрытый маршрут `/cb-native-preview` — полностью нативную React/Tailwind-реализацию посадочной страницы «ЦБ 2.0», визуально соответствующую desktop-версии live-страницы `/cb` при 1440px и корректно перекомпоновывающуюся на 768/390px без горизонтальных переполнений. Без iframe, без Tilda runtime, без `dangerouslySetInnerHTML`, без absolute-position Zero Block'ов. Live-страница `/cb` не меняется.

## Diagnose (что уже известно)
- Source of truth: `public.site_pages` row `cbold`, id `e3c79f1c-947a-49ec-88be-6cebdfe19f35`, длина 3 074 877, 73 rec-блока — эталон визуала и текста.
- Все CTA/тарифы в проекте уже имеют нативные компоненты (`ProductLanding`, `TariffCard`, `UniversalPricingSection`, `PaymentDialog`, `LeadRequestDialog`, `PreregistrationDialog`, `InvoiceCheckoutDialog`) и slot manifest (`SiteSlotManifestContext`, `usePublicProduct`).
- Все бизнес-хендлеры (карта, 2-платёжная рассрочка, банковское РР, счёт юрлицу) уже подключены через `PaymentDialog`/`LeadRequestDialog` по `offer_id`. Их и переиспользуем.

## Source of truth и permissions
- Read-only чтение эталонного HTML `cbold` через `supabase--read_query` в discovery-фазе (для извлечения текстов, порядка секций, ссылок на assets, цветов/градиентов).
- Никаких write-операций в БД, migrations, DDL, RPC, edge functions, публикаций.
- Никаких hard-coded product/tariff/price/offer id: всё резолвится через существующий slot manifest страницы `cb` (`landing_config`, `product_id`, `tariffs`).

## Scope (что делаем)

### Артефакты discovery (read-only)
1. Извлечь из `cbold.blocks[0].content.code` инвентарь:
   - список rec-блоков и семантические роли (hero, USP, программа, тарифы, отзывы, FAQ, футер и т.д.);
   - тексты, заголовки, порядок;
   - URL картинок/иконок (Tilda CDN), шрифты, ключевые цвета/градиенты, брейкпоинты.
2. Файл `.lovable/discovery/cb-native/cb_native_section_inventory.md` — таблица «rec-id → секция → компонент → assets → CTA-binding».

### Дизайн-система (нативная, tokens only)
- Токены цвета/градиентов/теней/типографики только через `index.css` (HSL) и `tailwind.config.ts`, без хардкода классов `text-white`/`bg-[...]`.
- Отдельный скоуп: `src/pages/cb-native/tokens.css` подключается только на этой странице.
- Кастомные шрифты (если Tilda-специфичные) — либо заменяем близкими из уже подключённых, либо аплоадим через `lovable-assets` и подключаем через `@font-face` в scope странице (только если нужны для парити).

### Route
- Новый файл `src/pages/CbNativePreview.tsx` — страница-контейнер.
- Регистрация маршрута в существующем роутере (`src/App.tsx` или соответствующий router-файл) как **скрытый** путь `/cb-native-preview`, без ссылок в навигации, без sitemap, `<meta name="robots" content="noindex,nofollow">`.

### Секции (нативные компоненты)
Каждая секция — отдельный компонент под `src/pages/cb-native/sections/`:
- `HeroSection`
- `AboutCourseSection`
- `TargetAudienceSection`
- `ProgramSection` (модули)
- `SpeakerSection` (Катерина)
- `TariffsSection` — **обязательно** через существующий `UniversalPricingSection` + `usePublicProduct` (slot manifest страницы `cb`), никаких hardcoded тарифов.
- `FaqSection`
- `TestimonialsSection`
- `GuaranteeSection`
- `FooterSection`
- (и остальные из инвентаря)

Все — семантический HTML (`<section>`, `<h1>-<h3>`, `<ul>`, `<figure>`), responsive Tailwind без absolute-позиционирования, картинки с `loading="lazy"`, `alt`, `<picture>` при необходимости.

### CTA / payments (dynamic, no hardcode)
- `TariffsSection` получает `product` + `tariffs` из `usePublicProduct(productId)`, где `productId` берётся из slot manifest эталонной страницы (тот же, что использует `/cb` в его текущей нормальной конфигурации). Никаких зашитых id.
- Каждая CTA-кнопка проходит через существующие handlers:
  - карта → `PaymentDialog` (`payment_method='card'`);
  - 2-платёжная рассрочка → `PaymentDialog` (`payment_method='internal_installment'`, `installment_count=2`);
  - банковское РР → `LeadRequestDialog` (`offer_type='bank_installment'`) через `readBankInstallmentMeta`;
  - счёт юрлицу → существующий `InvoiceCheckoutDialog` через соответствующий `offer_type='lead'` c invoice-конфигом.
- Модульный «cart» (если применимо) — reuse существующего module cart компонента, если он уже используется на других лендингах; иначе оставить TODO-маркер в discovery без mock-логики.

### Responsive
- 1440: точный desktop-парите (grid/flex по инвентарю).
- 768: 1–2 колонки, читаемый flow.
- 390: 1 колонка, без горизонтального скролла (`overflow-x-hidden` на корневом контейнере страницы).
- Проверка через Playwright.

## Verification (Definition of Done)
1. `tsgo` / build проходит.
2. Route `/cb-native-preview` открывается локально, `/cb` не изменён (diff `public.site_pages` row = 0).
3. Playwright скриншоты `1440x900` и `390x844` сохранены в `/tmp/browser/cb-native/`.
4. Отчёт: список изменённых файлов, счётчик секций (`created / expected`), unresolved assets (список URL, которые не удалось смапить), evidence по CTA-биндингам (для каждой кнопки — какой компонент/offer_type/handler).
5. Никаких DB writes, migrations, edge functions, публикаций.

## Stop-guards
- Live `/cb` строка `public.site_pages` не читается на запись; любые попытки — STOP.
- Если slot manifest `cb` не отдаёт tariffs → секцию тарифов отрисовать в «pending»-состоянии и внести в unresolved-report, но НЕ хардкодить.
- Если требуется новый шрифт/asset и его нет в CDN — фиксируем в unresolved-report, не эмулируем через placeholder.
- Не публиковать, не менять маршрутизацию для `/cb`, не трогать backend.

## Технические детали
- Файлы:
  - `src/pages/CbNativePreview.tsx`
  - `src/pages/cb-native/sections/*.tsx`
  - `src/pages/cb-native/tokens.css`
  - обновление роутера (единичный `<Route>` вставкой)
  - `.lovable/discovery/cb-native/cb_native_section_inventory.md`
  - `.lovable/reports/cb-native-preview-build-report.md`
- Никаких изменений в: `src/integrations/supabase/*`, `supabase/**`, `public/**` (кроме assets при необходимости), существующих компонентах платежей, `SitePageBySlug`, `public.site_pages`.

После аппрува — исполняю в порядке: discovery inventory → tokens/route → секции (партиями) → интеграция pricing со slot manifest → responsive fix → build/typecheck → Playwright скриншоты → финальный отчёт.
