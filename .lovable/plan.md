
# SPRINT: TARIFFS v2 — Статус выполнения

## Выполнено (PATCH 1-9)

### PATCH 1: public_id для тарифов ✅
- DB migration: `public_id_sequences` (entity_type='tariff', prefix='T'), trigger `set_tariff_public_id`, backfill 11 tariffs (T-000001..T-000011), NOT NULL + unique index
- FIX: trigger обновлён на `IF NEW.public_id IS NULL OR NEW.public_id = '' THEN` — ловит и NULL, и пустую строку
- DEFAULT `''` оставлен для совместимости с TypeScript Insert-типами (trigger перезапишет на INSERT)
- UI: badge `T-000xxx` в `TariffCardCompact.tsx` + read-only в диалоге редактирования
- Build ✅, есть runtime warning: `forwardRef` в `DialogFooter` (косметический, не блокирует)
- DoD-пруфы: total=11, with_pid=11, non_empty=11, empty_cnt=0; 0 дублей; column_default=`''`, nullable=NO
- **BACKLOG:** future PATCH "Types regen + DROP DEFAULT" — после регена типов и проверки всех insert-путей убрать DEFAULT `''`

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

### PATCH 5: TG Welcome Message — offer-first, tariff-fallback ✅
- EF `telegram-grant-access/index.ts` строки 699-800: перестроена логика
- Иерархия: OFFER welcome (приоритет) → TARIFF welcome (fallback) → GC link (last resort)
- Idempotency: проверка `audit_logs` по action=`telegram_welcome_sent`, meta.source_id → skip если уже отправлено
- После отправки — INSERT audit_log (actor_type='system', actor_label='telegram-grant-access')
- Error-guard на audit insert (не прерывает основной процесс)
- UI labels: TariffWelcomeMessageEditor — "(по умолчанию, если на кнопке не задано)"
- UI labels: OfferWelcomeMessageEditor — "(приоритетное — отправляется вместо сообщения тарифа)"
- 3 лог-кейса: `Sent OFFER welcome`, `Sent TARIFF welcome (fallback)`, `Sent GC link`

### PATCH 6: Единый компонент TariffCard ✅
- Вынесен `TariffCard` из `ProductLanding.tsx` → `src/components/landing/TariffCard.tsx`
- Props: dual source — `resolvedFeatures = props.features ?? tariff.features ?? []`
- Price logic: `current_price → base_price → price_monthly → primaryOffer.amount`
- CTA: все offers (pay_now + trial)
- `ProductLanding.tsx`: импортирует из нового файла
- `AdminProductDetailV2.tsx`: заменён `TariffPreviewCard` → `TariffCard`
- Удалён `src/components/admin/product/TariffPreviewCard.tsx`

### PATCH 7: Standalone pricing page (EF + route) ✅
- NEW EF `public-product-by-slug/index.ts` — lookup по `slug` OR `public_id`, output 1:1 с public-product + `primary_domain`
- NEW hook `usePublicProductBySlug` в `usePublicProduct.tsx`
- NEW page `src/pages/ProductPricing.tsx`
- Route `/pricing/:productSlug` (выше `/pricing` redirect в App.tsx)
- Старый `/pricing` → `/#pricing` redirect сохранён
- EF протестирован: 200 для PRD-000003, 404 для несуществующих

### PATCH 8: Banner при primary_domain ✅
- `primary_domain` добавлен только в output `public-product-by-slug` (контракт `public-product` не тронут)
- `ProductPricing.tsx`: banner "Полная версия сайта: {domain}" с внешней ссылкой

### PATCH 9: Чистка формы тарифа ✅
- Основные поля: name*, subtitle, period_label, badge, access_days, description, is_popular, is_active
- Collapsible "Расширенные": code (read-only), public_id (read-only)

## Изменённые файлы

| Файл | Изменение |
|---|---|
| SQL migration (3) | public_id + sequence + trigger + backfill + NOT NULL + DEFAULT + trigger fix |
| `TariffCardCompact.tsx` | +public_id badge, +productIsActive prop, +inherited inactive badge |
| `AdminProductDetailV2.tsx` | -6 refetch, -code field, +public_id in dialog, +Advanced collapsible, +productIsActive, TariffPreviewCard→TariffCard |
| NEW `src/components/landing/TariffCard.tsx` | Unified tariff card component |
| `ProductLanding.tsx` | Import from TariffCard.tsx instead of inline |
| `useTariffFeatures.tsx` | +invalidate preview-tariff-features in 4 mutations |
| DELETE `TariffPreviewCard.tsx` | Replaced by unified TariffCard |
| `telegram-grant-access/index.ts` | Offer-first → tariff-fallback → GC link + idempotency |
| `TariffWelcomeMessageEditor.tsx` | Updated label: "(по умолчанию)" |
| `OfferWelcomeMessageEditor.tsx` | Updated label: "(приоритетное)" |
| NEW `supabase/functions/public-product-by-slug/index.ts` | EF for slug/public_id lookup |
| `src/hooks/usePublicProduct.tsx` | +usePublicProductBySlug hook + PublicProductBySlugData type |
| NEW `src/pages/ProductPricing.tsx` | Standalone pricing page with banner |
| `src/App.tsx` | +Route /pricing/:productSlug, +lazy import ProductPricing |
| `supabase/functions.registry.txt` | +public-product-by-slug |
