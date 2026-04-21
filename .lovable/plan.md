# да, согласен, с учетом правок:

1. Зафиксируй явно, где именно сохраняется `landing_config.tariffs_layout` в `AdminProductDetailV2.tsx`:  
не просто “через тот же путь”, а конкретно:
  &nbsp;
  &nbsp;
  - какой state/handler используется;
  - какой mutation/save-action пишет `landing_config`;
  - какие query keys потом инвалидируются.  
  Это нужно, чтобы не получилось, что UI переключатель появился, а сохраняется не туда или не вызывает live-update.
2. В `UniversalPricingSection.tsx` добавь жёсткое правило приоритета источников:
  - production path: `product.landing_config.tariffs_layout`
  - fallback: `"auto"`
  - `layout` prop оставить только как debug/test override и явно пометить комментарием, что в product-driven страницах и блоках он не должен передаваться.  
  Иначе через пару спринтов снова появится page-specific хардкод.
3. В `AdminProductDetailV2.tsx` перед заменой превью на `UniversalPricingSection` сделай discovery-проверку, не использует ли текущий preview какие-то дополнительные product-specific props/бейджи/обёртки, которых нет в `UniversalPricingSection`.  
Если есть расхождение, не дублировать старую логику, а сначала явно перечислить gap и только потом свести к одному renderer.
4. Добавь в verify отдельную проверку публичной **ссылки на блок тарифов продукта**, не только `/consultation`.  
Ты сам зафиксировал, что продукт может жить и без сайта, а ссылка на блок тарифов уже существует.  
Значит proof должен быть по 4 точкам:
  - admin preview,
  - публичная product pricing link,
  - публичная `/consultation`,
  - site-builder pricing block.
5. Уточни правило для site-builder:
  - если блок `pricing` product-driven, он обязан брать layout из продукта;
  - если block manual/non-product-driven, layout продукта не применяется;
  - если product-driven + `tariff_filter_mode="selected"`, сначала берём layout из продукта, потом фильтруем тарифы.  
  Это нужно явно вписать в data-flow, чтобы не было двойного толкования.
6. Добавь regression-проверку для already existing builder pages с pricing block:
  - хотя бы 2 страницы, где pricing block привязан к другим продуктам;
  - подтвердить, что без `tariffs_layout` у продукта поведение осталось `auto`.
7. Добавь отдельный no-scroll proof:  
для `vertical-grid` на mobile/tablet/desktop подтвердить:
  - нет горизонтального скролла контейнера;
  - нет горизонтального скролла страницы;
  - нет dots/стрелок карусели.  
  Это один из главных пользовательских критериев.
8. В DoD добавь пункт про сохранение порядка:  
`vertical-grid` не меняет порядок тарифов и не делает локальный reorder.  
Карточки идут строго в том порядке, который уже задан в продукте.
9. Добавь explicit smoke-check по оплате в каждом renderer-path:  
хотя бы один клик по CTA в:
  - admin preview,
  - публичной product pricing link,
  - site-builder pricing block.  
  Нужно подтвердить, что везде открывается тот же `PaymentDialog` с корректными `productId/offerId`.
10. Добавь stop-guard:  
не менять `PricingSection.tsx` block content schema ради layout.  
Layout — только из продукта.  
В block content не должно появиться нового `layout`, иначе снова получится второй source of truth.
11. В финальном proof-пакете раздели статусы:
  - подтверждено фактами;
  - не подтверждено;
  - отложено.  
  Не смешивай кодовую готовность и реальный browser-proof.
12. После execution в отчёте обязательно покажи один явный блок фактов:
  - product id,
  - `landing_config.tariffs_layout` до/после,
  - какие renderer-paths использовали это значение,
  - какие query invalidations сработали после save.

&nbsp;

Если хочешь, следующим сообщением я соберу уже финальный короткий блок ТЗ для вставки подрядчику без пояснений.

&nbsp;

План: PATCH PRODUCT-TARIFFS-LAYOUT-SOT — единая настройка раскладки тарифов на уровне продукта

## 1. Цель

Добавить **одну универсальную настройку раскладки тарифов в продукт**, чтобы все product-driven отображения тарифов — карточка продукта, product preview, публичные ссылки, опубликованные страницы и site-builder pricing block — синхронно использовали одно и то же отображение. SoT — продукт. Page-specific хардкоды запрещены.

## 2. Discovery (зафиксировано)

**SoT настроек продукта:** `products_v2.landing_config` JSONB. Уже хранит `tariffs_title`, `tariffs_subtitle`, `price_suffix`, `show_badges` и т.п. Подходит для нового ключа без миграции.

**Renderer paths тарифов (актуальный список):**


| Путь                                           | Файл                                                               | Использует                                       |
| ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Публичная страница `/consultation` (и аналоги) | `src/pages/Consultation.tsx`                                       | `UniversalPricingSection`                        |
| Публичная страница продукта по slug            | `src/components/landing/LandingPricing.tsx` → `ProductLanding.tsx` | `UniversalPricingSection`                        |
| Site-builder блок «Тарифы» (product-driven)    | `src/components/site-renderer/blocks/PricingSection.tsx`           | `UniversalPricingSection`                        |
| Domain-bound лендинги                          | `src/components/layout/DomainRouter.tsx`                           | `UniversalPricingSection`                        |
| **Admin product preview**                      | `src/pages/admin/AdminProductDetailV2.tsx` (≈ строки 1200-1219)    | ❌ напрямую `TariffCarouselGrid` — **разрыв SoT** |


`UniversalPricingSection` уже принимает prop `layout: "auto" | "vertical-grid"` (PATCH CONSULTATION-TARIFFS-VERTICAL), но default — `"auto"`, и значение нигде не читается из продукта. На `Consultation.tsx` сейчас стоит хардкод `layout="vertical-grid"` — его убираем.

**Порядок тарифов и офферов:** управляется `sort_order` в БД (`tariffs_v2`, `tariff_offers_v2`), не зависит от layout — не трогаем.

**Ссылки:** `#tariffs` anchor + UUID-driven `productId/offerId` → `PaymentDialog`. От layout не зависят, не трогаем.

**Site-builder фильтрация:** `tariff_filter_mode` / `tariff_ids` в `PricingSection.tsx` работает поверх — фильтрует список тарифов до передачи в `UniversalPricingSection`. Не зависит от layout, остаётся как есть.

## 3. Бизнес-правило

- Настройка `landing_config.tariffs_layout: "auto" | "vertical-grid"` живёт **только в продукте**.
- Default — `"auto"` (полная обратная совместимость для всех существующих продуктов).
- Любой product-driven рендерер тарифов **обязан** читать это значение из `product.landing_config.tariffs_layout`. Page/block-specific override запрещён.
- Если тарифы не привязаны к продукту (manual config в site-builder) — настройка не применяется, поведение прежнее.
- Live-update: меняем в админке → React Query invalidate → preview/публичные страницы/site-builder блоки видят новое значение без redeploy.

## 4. Изменения

### A. Типы — `src/hooks/usePublicProduct.tsx`

- В `LandingConfig` добавить `tariffs_layout?: "auto" | "vertical-grid"`.

### B. Канонический рендерер — `src/components/landing/UniversalPricingSection.tsx`

- Изменить вычисление эффективного layout:
  ```
  const effectiveLayout = layoutProp ?? product.landing_config?.tariffs_layout ?? "auto";
  ```
- Prop `layout` сохраняется только для тестов/превью; в продакшен-коде его передавать **запрещено** (фиксируется комментарием в файле).

### C. Удалить page-specific хардкод — `src/pages/Consultation.tsx`

- Убрать `layout="vertical-grid"`. Значение придёт из `product.landing_config.tariffs_layout`.

### D. Admin preview parity — `src/pages/admin/AdminProductDetailV2.tsx`

- В блоке превью (≈ строки 1180-1230) **заменить прямое использование `TariffCarouselGrid` на `UniversalPricingSection**` с теми же `product` + активные `tariffs`.
- Tumbler Desktop/Mobile превью реализовать через ширину контейнера-обёртки (`max-w-[360px]` для mobile), а не через prop `forceMobile` карусели — `UniversalPricingSection` сам решит layout по `landing_config`.
- Удалить дублирование заголовка/подзаголовка/disclaimer в превью — `UniversalPricingSection` отрисует сам.

### E. Admin UI — `src/pages/admin/AdminProductDetailV2.tsx` (вкладка настроек продукта)

- В существующей секции `landing_config` добавить SegmentedControl/RadioGroup «Раскладка тарифной секции»:
  - «Авто (карусель при 4+)» → `auto`
  - «Вертикальная сетка (1 / 2 колонки)» → `vertical-grid`
- Сохранение через тот же путь обновления `landing_config` (никаких новых EF/RPC).
- После сохранения — invalidate React Query ключей `["public-product", ...]` и `["public-product-by-slug", ...]`, чтобы preview и публичные страницы обновились немедленно.

### F. Edge functions — `supabase/functions/public-product/index.ts` и `public-product-by-slug/index.ts`

- Проверить, что оба возвращают `landing_config` целиком (по данным discovery — да). Никаких правок не требуется, поле уже включено.

## 5. Файлы


| Файл                                                 | Изменение                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/hooks/usePublicProduct.tsx`                     | + `tariffs_layout` в `LandingConfig`                                                          |
| `src/components/landing/UniversalPricingSection.tsx` | fallback prop → `product.landing_config.tariffs_layout` → `"auto"`                            |
| `src/pages/Consultation.tsx`                         | удалить хардкод `layout`                                                                      |
| `src/pages/admin/AdminProductDetailV2.tsx`           | (1) UI-настройка `tariffs_layout`; (2) preview через `UniversalPricingSection` для 1:1 parity |


## 6. Не трогаем

- БД, миграции, RLS, edge functions — поле живёт в существующем JSONB.
- API `TariffCard`, `PaymentDialog`, `usePublicProduct`, `usePublicTariff`.
- `TariffCarouselGrid` — продолжает работать в режиме `auto`.
- `tariff_filter_mode` / `tariff_ids` логику в `site-renderer/blocks/PricingSection.tsx`.
- Порядок тарифов и офферов (`sort_order`).
- Anchor `#tariffs`, публичные ссылки на тарифы и checkout flow.

## 7. Verify (data-flow proof)

**Single source of truth:**

1. Открыть админку → продукт «Платная консультация» → раздел настроек landing → переключатель раскладки видим, значение по умолчанию `auto`.
2. Установить `vertical-grid` → сохранить.
3. **Admin preview** (Desktop): 2 колонки × 2 ряда без карусели; Mobile (max-w 360): 1 колонка.
4. **Публичная** `/consultation`: 375 → 1 колонка; 768 → 2 колонки; 1280 → 2 колонки.
5. **Site-builder страница** с product-driven pricing block, привязанным к этому продукту: тот же layout.
6. Вернуть `auto` → во всех трёх местах сразу карусель/грид по count (без redeploy, без перезагрузки страницы кроме React Query refetch).

**Регрессия:**
7. Любой другой продукт без `tariffs_layout` в `landing_config` → поведение строго прежнее (`auto`).
8. Site-builder pricing block в manual-config режиме (не привязан к продукту) → настройка продукта не применяется, поведение прежнее.
9. `tariff_filter_mode="selected"` поверх `vertical-grid` → отфильтрованные тарифы отрисованы в 1/2 колонки, фильтрация работает.
10. Оплата с любой карточки во всех точках → `productId` + `offerId` корректны, открывается `PaymentDialog`, checkout flow не изменён.

**Визуальный DoD для `vertical-grid`:**

- mobile 1 кол / tablet+desktop 2 кол;
- нет dots, стрелок, горизонтального скролла;
- одинаковая высота карточек (`items-stretch` + `h-full`);
- CTA на одной линии в пределах ряда;
- порядок тарифов = `sort_order` из продукта.

## 8. STOP-guards

- НЕ менять API `TariffCard` / `PaymentDialog` / `usePublicProduct`.
- НЕ заводить новые таблицы / колонки / EF — только ключ внутри существующего `landing_config`.
- НЕ оставлять `layout="..."` хардкод ни в одной странице/блоке.
- НЕ трогать manual-config режим site-builder pricing block.
- НЕ менять `sort_order` тарифов и офферов.
- НЕ менять anchor `#tariffs` и публичные ссылки.
- Если `landing_config.tariffs_layout` отсутствует — поведение **строго** `auto`.

## 9. DoD

1. В `LandingConfig` появился ключ `tariffs_layout` (`"auto" | "vertical-grid"`, default `auto`).
2. В админке продукта есть UI-переключатель раскладки, значение сохраняется в `landing_config`.
3. Admin preview использует тот же `UniversalPricingSection`, что и публичные страницы → 1:1 parity (Desktop/Mobile).
4. `/consultation` рендерит 1/2/2 колонки, потому что у продукта выбрано `vertical-grid` (хардкод в `Consultation.tsx` удалён).
5. Site-builder pricing block, привязанный к продукту, подхватывает ту же настройку без правок content блока.
6. Все остальные продукты остаются на `auto` без визуальных изменений.
7. Live-update: смена настройки в админке → preview + публичные страницы + site-builder обновляются без redeploy.
8. Оплата по ID-first контракту работает во всех точках.
9. Приложены 5 скриншотов: admin preview Desktop, admin preview Mobile, публичная `/consultation` 375, публичная `/consultation` 1280, site-builder страница с тем же продуктом.