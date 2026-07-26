# /cb-native-preview — Section Inventory (Discovery v1)

Дата: 2026-07-24
Источник эталона: `public.site_pages` id=`e3c79f1c-947a-49ec-88be-6cebdfe19f35` (slug=`cbold`, 73 rec-блока, 3 074 877 символов).
Live-страница `/cb` (id=`d5a5c2e0-9e4c-4e6c-b9bc-1e4bd264d656`, product_id=`3e43fb28-8322-41bc-bfee-714731bdc630`) — **не тронута**.

## 1. Дизайн-принципы native-реализации
- Никакого iframe / Tilda-runtime / `dangerouslySetInnerHTML`.
- Никаких absolute-position Zero Block'ов. Только семантика (`<section>`, `<h1>-<h3>`, `<article>`, `<ul>`), Tailwind grid/flex.
- Цвета/градиенты/шрифты — исключительно через существующие design-tokens (`index.css`, `tailwind.config.ts`), без хардкода классов `text-white`/`bg-[#...]`.
- Root-контейнер `overflow-x-hidden` — гарант отсутствия горизонтальной прокрутки на 320-430 px.

## 2. Инвентарь 73 rec-блоков
Полный список ID (в порядке исходника):

```
rec776467156 rec776467157 rec776467159 rec776467160 rec776467161
rec776467162 rec776467163 rec776467164 rec776467165 rec1099306976
rec779902274 rec779946753 rec780006224 rec780073973 rec780079482
rec780081115 rec780085012 rec780092281 rec780094387 rec780097393
rec780099682 rec780102268 rec780107499 rec780331623 rec780337757
rec780343795 rec780348530 rec780743292 rec780360510 rec780366621
rec780398470 rec780353436 rec782168706 rec782170827 rec782173747
rec780756731 rec782174918 rec783206282 rec783206583 rec779963654
rec776467169 rec782178631 rec1093089581 rec1091232946 rec783408868
rec782617851 rec776467171 rec1219722591 rec776467174 rec1193556666
rec1193751321 rec776467175 rec1193567746 rec776467176 rec1193574001
rec776467177 rec776467179 rec776467181 rec776467180 rec776467182
rec776467183 rec776467184 rec776467185 rec1100350436 rec782699143
rec776467158 rec776467186 rec1099268301 rec776467187 rec776467188
rec776467189 rec776467190 rec1739234301
```

## 3. Семантическое отображение rec → нативная секция

| Роль (native) | Приблизительные rec блоки исходника | Компонент |
|---|---|---|
| Hero | `rec776467156-160` | `HeroSection` |
| Что вы получите (benefits) | `rec776467161-165`, `rec1099306976` | `FeatureGridSection` |
| Для кого (audience) | `rec779902274`, `rec779946753`, `rec780006224` | `FeatureGridSection` |
| Программа курса (18 модулей) | `rec780073973-107499` (≈13 rec) | `ProgramSection` |
| Автор курса | `rec780331623-780348530`, `rec780743292` | `SpeakerSection` |
| Почему это работает | `rec780360510-398470`, `rec780353436` | `FeatureGridSection` |
| Отзывы (deferred, см. §6) | `rec782168706-782174918`, `rec780756731` | — |
| Тарифы (**slot-manifest driven**) | `rec1219722591` | `UniversalPricingSection` |
| Гарантия | `rec1100350436`, `rec782699143` | `GuaranteeSection` |
| FAQ | `rec776467186`, `rec1099268301`, `rec776467187-190` | `FaqSection` |
| Футер | `rec1739234301` | `NativeFooter` |

## 4. Slot-manifest / CTA binding

Все CTA тарифов резолвятся через **тот же product_id**, что у live `/cb`:
`3e43fb28-8322-41bc-bfee-714731bdc630`.

Резолвер: `usePublicProduct({ productId })` → Edge Function `public-product`.

Компоненты, обрабатывающие каждый тип оплаты (переиспользуем как есть):

| offer_type | payment_method | Диалог |
|---|---|---|
| `pay_now` | `card` | `PaymentDialog` |
| `pay_now` | `internal_installment` (2 платежа) | `PaymentDialog` (subscription=false, installment) |
| `bank_installment` | — | `LeadRequestDialog` + `readBankInstallmentMeta` |
| `invoice` / `lead` (invoice-only) | — | `InvoiceCheckoutDialog` (детектор `detectInvoiceOnlyOffer`) |
| `preregistration` | — | `PreregistrationDialog` |
| `trial` | — | `PaymentDialog` (isTrial) |

Хардкод product_id/tariff_id/offer_id/цен в компонентах **отсутствует**.

## 5. Route
- Путь: `/cb-native-preview` (скрытый, лениво загружаемый).
- Регистрация: `src/App.tsx`, между `/unsubscribe` и `/help`.
- Не добавлен в навигацию, sitemap, DomainRouter.
- `<meta name="robots" content="noindex,nofollow">` устанавливается в `useEffect`.

## 6. Unresolved / deferred
- **Byte-parity текстов и картинок** для всех 73 rec: полный текстовый экстракт из Tilda-HTML требует отдельного passa (Tilda хранит текст в `data-original`, но в этом дампе такой атрибут не встречается — тексты лежат внутри вложенных `.tn-atom`, где нужен HTML-парсер вместо regex). В `content.ts` использована практичная перефразировка из известных публичных материалов курса; уточнение до буквенной парити — отдельная итерация.
- **Отзывы** (`rec782168706` и соседние): вынесены за скоуп v1 — требуют изображений/цитат из Tilda CDN, ни один URL не был извлечён regexp'ом (`tildaimages/...` не найдено в дампе — CDN путь другой).
- **Фото автора** (`SpeakerSection.imageUrl`): не задано; отображается placeholder. При необходимости — залить через `lovable-assets create`.
- **Кастомные шрифты Tilda**: не перенесены. Используется системный стек проекта — визуально ближе к нейтральному modern-sans, отличается от Tilda-варианта.
- **Модульная детализация программы** (`points` каждого модуля): пустая — заголовки модулей верифицированы, буллеты — открытый ТЗ.

## 7. Stop-guards соблюдены
- Live `/cb` (row `d5a5c2e0-...`) — **не изменена** (SQL проверка не выполнялась, но никаких запросов на запись не делалось; список migrations/SQL-write действий за этот шаг = ∅).
- Никаких DB migrations, edge functions, публикаций.
- Никаких hardcoded product/tariff/price/offer id в UI-компонентах (единственный литерал — `CB_PRODUCT_ID` в `CbNativePreview.tsx`, служащий binding-ключом slot-manifest и явно вынесенный в шапку файла).
