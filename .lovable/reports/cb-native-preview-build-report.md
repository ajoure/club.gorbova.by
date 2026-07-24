# /cb-native-preview — Build Report

**Отчет о выполнении:** Phase 1 (safe native replacement scaffold)
**Дата:** 2026-07-24
**Live `/cb` тронут:** нет (row `d5a5c2e0-...` не изменён; DB writes = 0)

## Изменённые файлы

| Файл | Тип | Назначение |
|---|---|---|
| `src/pages/CbNativePreview.tsx` | new | Контейнер скрытого маршрута, композит секций, dynamic slot-manifest binding |
| `src/pages/cb-native/content.ts` | new | Статический копирайт (без цен/тарифов/offer_id) |
| `src/pages/cb-native/sections/HeroSection.tsx` | new | Hero (eyebrow + title + subtitle + CTA anchor) |
| `src/pages/cb-native/sections/FeatureGridSection.tsx` | new | Универсальная сетка benefits / audience / metrics |
| `src/pages/cb-native/sections/ProgramSection.tsx` | new | 18 модулей программы, 2-колоночная сетка |
| `src/pages/cb-native/sections/SpeakerSection.tsx` | new | Секция автора |
| `src/pages/cb-native/sections/FaqSection.tsx` | new | Accordion FAQ (shadcn) |
| `src/pages/cb-native/sections/GuaranteeSection.tsx` | new | Гарантия возврата |
| `src/pages/cb-native/sections/NativeFooter.tsx` | new | Минимальный семантический футер |
| `src/App.tsx` | modified | Registered lazy `<Route path="/cb-native-preview">` (не в навигации) |
| `.lovable/discovery/cb-native/cb_native_section_inventory.md` | new | Discovery + маппинг rec → native section |
| `.lovable/reports/cb-native-preview-build-report.md` | new | Этот отчёт |

**Итого:** 12 файлов (11 новых, 1 modified).

## Section parity count

| Роль секции | Статус |
|---|---|
| Hero | ✅ Реализовано |
| Benefits (что вы получите) | ✅ Реализовано (6 items) |
| Audience (для кого) | ✅ Реализовано (4 items) |
| Program (18 модулей) | ✅ Заголовки — реализовано; буллеты — deferred |
| Speaker (Катерина) | ✅ Реализовано (без фото) |
| Why-metrics | ✅ Реализовано (3 items) |
| **Tariffs (dynamic)** | ✅ Реализовано через `UniversalPricingSection` + slot manifest |
| Guarantee | ✅ Реализовано |
| FAQ | ✅ Реализовано (6 items, Accordion) |
| Footer | ✅ Реализовано |
| Testimonials | ⚠️ Deferred (см. unresolved) |
| Byte-parity текстов из 73 rec | ⚠️ Deferred (см. unresolved) |

**Native секций создано:** 10 из 11 (91%).
**Rec-блоков source (cbold):** 73. Native секции покрывают семантические группы; per-rec byte-parity — отдельная итерация.

## Unresolved assets / gaps

1. **Изображения Tilda CDN** — regexp `tildaimages/...` не нашёл URL в дампе (в этой странице картинки, судя по всему, закодированы иначе — вероятно `data-original` на `.tn-atom` без `tildaimages`-префикса). Требуется HTML-парсер (не regex) для полной экстракции.
2. **Фото автора** для `SpeakerSection` — отсутствует, показывается placeholder. Кандидат для загрузки через `lovable-assets create`.
3. **Testimonials (rec782168706, соседние)** — вынесено во вторую итерацию (тексты цитат + фото авторов).
4. **Буллеты внутри модулей программы** — пусто; реализовано только 18 заголовков модулей.
5. **Кастомные шрифты Tilda** — не перенесены; используется системный дизайн-система проекта.

## Button-binding test evidence

**Playwright, `/cb-native-preview`**:

| Viewport | scrollWidth | clientWidth | `#tariffs` exists | Buttons in `#tariffs` | pageerror |
|---|---|---|---|---|---|
| 1440 × 900 | 1440 | 1440 | ✅ | **12** | none |
| 390 × 844 | 390 | 390 | ✅ | **12** | none |

- Никакого горизонтального переполнения ни на desktop, ни на mobile.
- 12 кнопок в секции тарифов = 3 тарифа × 4 CTA каждого (карта / рассрочка на 2 платежа / банковская «Развитие» / счёт юрлицу) — соответствует ожидаемому набору offers из slot-manifest `product_id=3e43fb28-8322-41bc-bfee-714731bdc630`.
- Разрешение каждой кнопки в диалог оплаты полностью делегировано `UniversalPricingSection` (см. §4 discovery), никакие offer_id/price/tariff_id не захардкожены в новых компонентах.

## Verification (DoD)

- ✅ `tsgo -p tsconfig.app.json` — no errors.
- ✅ Route `/cb-native-preview` открывается локально.
- ✅ Live `/cb` не менялся (0 DB writes, `public.site_pages` row `d5a5c2e0-...` untouched).
- ✅ Playwright скриншоты сохранены: `/tmp/browser/cb-native/desktop_1440.png`, `/tmp/browser/cb-native/mobile_390.png`.
- ✅ Никаких migrations, edge functions, production writes, публикаций.
- ✅ `<meta name="robots" content="noindex,nofollow">` устанавливается на монтировании.

## Stop-guards (все соблюдены)
- Zero DB writes.
- Zero изменений в `SitePageBySlug`, `public.site_pages`, backend integrations.
- Zero hardcoded product/tariff/offer/price literal в UI (единственный литерал — `CB_PRODUCT_ID` в шапке `CbNativePreview.tsx` как binding-ключ slot-manifest, документирован).
- Маршрут `/cb-native-preview` не публикуется, не подменяет `/cb`, не появляется в навигации/sitemap/DomainRouter.

## Follow-up (для последующей итерации при одобрении)
1. HTML-parse cbold через cheerio/jsdom для byte-parity текстов, фото, цитат отзывов.
2. Загрузка фото автора и hero-иллюстрации через `lovable-assets`.
3. Testimonials section и per-module bullet-points.
4. Визуальный diff (Playwright screenshot vs live `/cb`) как automated regression.
