
# SPRINT: TARIFFS v2 — Статус выполнения

## Выполнено (PATCH 1-4, 6, 9)

### PATCH 1: public_id для тарифов ✅
- DB migration: `public_id_sequences` (entity_type='tariff', prefix='T'), trigger `set_tariff_public_id`, backfill 11 tariffs (T-000001..T-000011), NOT NULL + unique index
- UI: badge `T-000xxx` в `TariffCardCompact.tsx` + read-only в диалоге редактирования

### PATCH 2: Code — скрыть из формы, автогенерировать ✅
- STOP-guard: `tariff.code` остаётся NOT NULL, 10+ точек используют `.eq("code", tariffCode)`. Никаких попыток перейти на tariff_id
- `handleSaveTariff`: если code пуст → `trf_${crypto.randomUUID().slice(0,12)}`
- Поле "Код *" убрано из основной формы, показано в Collapsible "Расширенные настройки" (read-only)

### PATCH 3: effective_active (наследование) ✅
- `TariffCardCompact`: prop `productIsActive`, badge "Унаследовано неактивен"
- Превью: если `!product.is_active` → placeholder "Продукт неактивен"

### PATCH 4: Убрать ручные refetch ✅
- Убраны `refetch: refetchTariffs` и `refetch: refetchOffers` из деструктуризации
- Убраны 6 ручных `refetchTariffs()`/`refetchOffers()` вызовов
- Добавлен invalidate `["preview-tariff-features"]` в 4 мутации `useTariffFeatures.tsx`

### PATCH 6: Единый компонент TariffCard ✅
- Вынесен `TariffCard` из `ProductLanding.tsx` → `src/components/landing/TariffCard.tsx`
- Props: dual source — `resolvedFeatures = props.features ?? tariff.features ?? []`
- Price logic: `current_price → base_price → price_monthly → primaryOffer.amount`
- CTA: все offers (pay_now + trial)
- `ProductLanding.tsx`: импортирует из нового файла
- `AdminProductDetailV2.tsx`: заменён `TariffPreviewCard` → `TariffCard`
- Удалён `src/components/admin/product/TariffPreviewCard.tsx`

### PATCH 9: Чистка формы тарифа ✅
- Основные поля: name*, subtitle, period_label, badge, access_days, description, is_popular, is_active
- Collapsible "Расширенные": code (read-only), public_id (read-only)

## Не выполнено (PATCH 5, 7, 8)

### PATCH 5: TG Welcome Message — offer-first, tariff-fallback
- EF `telegram-grant-access/index.ts`: перестроить логику welcome messages
- Safety-guard: offerId=null → tariff fallback → GC link
- UI labels: "(по умолчанию)" / "(приоритетное)"

### PATCH 7: Standalone pricing page (EF + route)
- NEW EF `public-product-by-slug` (1:1 с public-product shape)
- NEW hook `usePublicProductBySlug`
- NEW page `src/pages/ProductPricing.tsx`
- Route `/pricing/:productSlug` (заменить redirect в App.tsx)

### PATCH 8: Merge standalone → полноценный сайт
- Banner при наличии primary_domain
- `/pricing/{slug}` всегда работает (без redirect)

## Изменённые файлы

| Файл | Изменение |
|---|---|
| SQL migration | public_id + sequence + trigger + backfill + NOT NULL + DEFAULT |
| `TariffCardCompact.tsx` | +public_id badge, +productIsActive prop, +inherited inactive badge |
| `AdminProductDetailV2.tsx` | -6 refetch, -code field, +public_id in dialog, +Advanced collapsible, +productIsActive, TariffPreviewCard→TariffCard |
| NEW `src/components/landing/TariffCard.tsx` | Unified tariff card component |
| `ProductLanding.tsx` | Import from TariffCard.tsx instead of inline |
| `useTariffFeatures.tsx` | +invalidate preview-tariff-features in 4 mutations |
| DELETE `TariffPreviewCard.tsx` | Replaced by unified TariffCard |
