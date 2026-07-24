План: Спринт «Ценный бухгалтер» — финализация

Порядок работы по ENGINEERING_RULES: Diagnose → Plan → Dry run → Execute → Verify. Каждая фаза с DoD.

## Контекст (Diagnose завершён)

- `site_pages.slug='cb'` → `product_id=3e43fb28…` (PRD-000039, «ЦБ 20 поток»). Один HTML-блок Tilda — источник цен и списка карточек.
- В `products_v2` уже есть 8 канонических модулей ЦБ: Грузоперевозки, Маркетплейсы, Общепит, ПВТ, Производство, Розничная торговля, Строительство, Учет у ИП. НЕТ: «Посредничество».
- `offer_addons` уже существует со схемой (parent_offer_id, addon_offer_id, pricing_mode ∈ {offer_price, fixed_price, percent_discount, free}, discount_percent, is_required, is_default_selected, sort_order, is_active, unique(parent_offer_id, addon_offer_id)). Ранее уже создано 144 связи — их нужно ревизовать, не пересобирать hardcode-ом.
- Существует `buildComposableQuote` (`supabase/functions/_shared/composable-checkout.ts`) с уже реализованным `percent_discount`. Значит, скидка «Бизнес-леди 50%» = данные в `offer_addons`, не код.

## Требуемый объём

### 1. Каталог модулей на /cb (idempotent SQL migrations, backend-only)

1.1. Извлечь из HTML `site_pages.blocks[0]` все активные карточки-модули (не «СКОРО») с ценой и `data-tariff-key`. Артефакт — `.lovable/discovery/cb-sprint-final/cb_cards_source.json` (в отчёте, не в БД).
1.2. Сверить с текущими продуктами по человеко-читаемому маппингу:
   - Учет у ИП → `cb_module_ip`: проверить цену тарифа = 800 BYN, offers активны для pay_now/invoice/bank_installment. Fix, если 0.
   - Посредничество → создать `cb_module_intermediary` product + tariff + offers (только если карточка активна и цена видна).
   - Общепит `cb_module_catering`, ПВТ `cb_module_pvt` (не создавать дубль, привязать к канонике), Грузоперевозки, Маркетплейсы, Производство, Розничная торговля, Строительство.
1.3. Для каждого модуля обеспечить tariff (`is_active=true`) + `tariff_offers`: `pay_now` (full_payment), `invoice` (invoice-only), `bank_installment` (lead-form). Идемпотентно: сначала SELECT по (product_id, offer_type, meta-key), INSERT только при отсутствии.
1.4. Пропустить карточки «СКОРО» — не создавать.

**DoD:** SQL прогон дважды подряд не создаёт дубликаты; для каждой активной карточки на /cb есть ровно один канонический `products_v2` + активный tariff + активные offers всех трёх типов; цены идентичны /cb (Учет у ИП = 800).

### 2. offer_addons матрица (data-driven, без hardcode)

2.1. Три родительских тарифа PRD-000039: Бухгалтер, Главный бухгалтер, Бизнес-леди. Для каждого — все не-lead офферы (pay_now/invoice/bank_installment, включая internal_installment).
2.2. Настроить `offer_addons`: parent_offer × каждый (addon_offer модуля тех же трёх типов). `pricing_mode='offer_price'` по умолчанию.
2.3. Для тарифа «Бизнес-леди»: все addon_offers → `pricing_mode='percent_discount'`, `discount_percent=50`. Для остальных двух тарифов — `offer_price` (0%).
2.4. Все связи через UPSERT ON CONFLICT DO UPDATE — идемпотентно. Скидка = столбец, не код.

**DoD:** `SELECT count(*)` по (parent_tariff, addon_product, offer_type) даёт полное покрытие; повторный прогон = 0 новых строк; `buildComposableQuote` для Бизнес-леди с 2 модулями возвращает primary_amount + Σ(addon*0.5); для Бухгалтер/Гл.бухгалтер — Σ(addon).

### 3. OfferAddonsEditor (admin UI)

3.1. Прочитать текущий `src/components/admin/…/OfferAddonsEditor.tsx` (существует).
3.2. Убедиться, что поля `pricing_mode`, `discount_percent`, `is_required`, `is_default_selected`, `sort_order`, `is_active` редактируются; поиск любого продукта/оффера как аддона (не ограничен ЦБ).
3.3. В checkout UI (`TariffCard` / composable checkout summary) показать зачёркнутую list_amount и итоговую final_amount, если скидка > 0. Клиентская цена всегда пересчитывается сервером (`composable-checkout-quote`).

**DoD:** админ может для любой пары tariff_offer↔addon_offer выставить скидку 0–100 и это отражается в quote и checkout UI.

### 4. Helper назначения для счетов (единый placeholder)

4.1. Новый helper `supabase/functions/_shared/purchase-composition-title.ts` + зеркало в `src/lib/purchaseCompositionTitle.ts`:
   - Вход: `{primary: {product_name, tariff_name}, addons: [{product_name}...]}`.
   - Выход: `«<primary.product_name>, тариф <primary.tariff_name>»` + `. Модуль <n1>. Модуль <n2>...` только если addons ≠ ∅.
   - Никаких висячих точек/пробелов, никаких «undefined»/пустых placeholder.
4.2. Заменить формирование `назначения платежа`/`наименования услуги` в: `invoice-checkout-issue`, каноническом генераторе счетов ИП/физлицо/юрлицо, документах (`ai-generated-documents` где строится title). Grep по коду выявит существующие места.
4.3. В табличной части документа каждый модуль — отдельная строка (использовать текущий шаблон, ничего не хардкодить).

**DoD:** 3 фикстуры (ИП / физлицо / юрлицо) × 3 варианта (0/1/2 модуля) = 9 сгенерированных документов, назначение форматируется корректно, сумма = quote.total, позиции = primary + модули.

### 5. Admin payment-link из карточки контакта

5.1. Регрессионно проверить flow `ContactPaymentLinkDialog` (существует): выбор продукт → тариф → модули (multi-select с чекбоксами и per-module discount из offer_addons), общий пересчёт через `composable-checkout-quote`, ручная корректировка, внутренняя рассрочка на общую сумму.
5.2. Ничего не менять в бизнес-логике, если тест зелёный. Smoke без создания реальной ссылки (transaction-rollback wrapper в тесте).

**DoD:** integration test проходит; UI не регрессирует.

### 6. Верификация

- `bun run test` (unit): `composableCheckout.test.ts` + новые тесты helper'a + скидка Бизнес-леди.
- SQL contract: `supabase/tests/composable_checkout_catalog_contract.sql` без изменений — должен проходить.
- Build: авто через harness.
- Playwright: /cb на 390×844 и 1440×900, admin OfferAddonsEditor, admin payment-link dialog. Screenshots в `/tmp/browser/cb-sprint/`.
- Идемпотентность: повторный прогон всех миграций (они idempotent by design).

### 7. Publish

- После PASS всех проверок — `preview_ui--publish`. Frontend edits активируются.

## Технические детали (SQL/RLS/безопасность)

- Все новые таблицы отсутствуют — только INSERT/UPDATE в `products_v2`, `tariffs`, `tariff_offers`, `offer_addons`. Схема не меняется.
- Никаких новых RPC не нужно — `buildComposableQuote` уже поддерживает `percent_discount`.
- RLS/GRANT уже настроены (offer_addons: admin RLS policies).
- Все SQL в миграциях под транзакцией; идемпотентность через `ON CONFLICT`.

## Stop-guards

- Если карточка «Посредничество» на /cb размечена как «СКОРО» — не создавать продукт, залогировать в отчёт.
- Если цена в БД отличается от /cb более чем на 0.01 — abort с отчётом (кроме подтверждённого fix Учет у ИП = 800).
- Если `buildComposableQuote` unit-test падает после наполнения данных — rollback data-миграции, отчёт.

## Deliverables

1. Миграции: `20260724_cb_sprint_final_catalog.sql`, `20260724_cb_sprint_final_addons_matrix.sql`.
2. Код: `_shared/purchase-composition-title.ts`, `src/lib/purchaseCompositionTitle.ts`, правки в invoice/document paths, правки OfferAddonsEditor (по необходимости), TariffCard UI (перечёркнутая цена).
3. Тесты: расширение `composableCheckout.test.ts`, новый `purchaseCompositionTitle.test.ts`.
4. Отчёт: `.lovable/discovery/cb-sprint-final/report.md` с точными IDs продуктов/тарифов/офферов/связей и PASS/FAIL.
5. Publish в Lovable Cloud.

## Оценка объёма

~3–5 миграций + ~8 файлов кода + ~4 файла тестов. Время: длинная сессия. Плана достаточно для реализации в один прогон при вашем подтверждении.

**Прошу подтверждение: приступать к реализации по этому плану?**
