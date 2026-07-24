## План: завершение спринта составных продаж «Ценный бухгалтер»

### Scope (только это, ничего лишнего)
1. `AdminPaymentLinkDialog` — расширить селектор сценариев до 4: Карта (100%/2 платежа) · Внутренняя рассрочка · Счёт ЮЛ/ИП/ФЛ · Ресурс развития.
2. Invoice и Resource Development offers подтягивать из `tariff_offers` того же тарифа по `offer_type` (`invoice`, `bank_installment` c `rr_runtime.enabled=true`). Никаких хардкод UUID в UI.
3. Selected addons + composite total сохраняются в один `order_group` через существующий `materialize_composable_order_group` во ВСЕХ 4 сценариях.
4. `CreateDealDialog` (ручная сделка из карточки контакта) переиспользует ту же форму `AdminPaymentLinkDialog` (или её extracted body), а не собственный несовместимый flow.
5. Invoice PDF/назначение платежа — состав через `buildPurchaseCompositionTitle` (primary + tariff + модули). Работает для ЮЛ, ИП, ФЛ (payer_type + выбор `client_legal_details`).
6. Бизнес-правило подтверждено: «Бизнес-леди» = 2650 BYN full price, 50% скидка применяется ТОЛЬКО к каждому выбранному addon. Логика уже в `composable-checkout-quote` — только не сломать при новых сценариях.
7. Тесты + typecheck + build + Publish. Никаких реальных оплат/заявок; smoke только на sandbox-заказе.

### Как это ляжет на существующую архитектуру
- Бэкенд для invoice уже создан прошлым ходом: `supabase/functions/admin-invoice-checkout-issue/index.ts` (service-role, валидирует `profile_id`, materializes composable group, вызывает существующий invoice-writer). Оставляем как есть, только достраиваем: приём `addon_offer_ids[]`, `manual_total_override`, `payer_type`, `client_legal_details_id`.
- Для Resource Development админ-flow использует существующую `public-rr-installment-initiate` (принимает PII), инициируется от имени целевого профиля. Composite total передаётся как единая сумма; addons сохраняются в `order_group` до redirect.
- Карта и внутренняя рассрочка — уже работают через `admin-create-public-link` + composable quote, не трогаем.
- `CreateDealDialog` рефакторим тонко: рендерит тело `AdminPaymentLinkDialog` с prefilled контактом, вместо своей формы.

### Файлы
Frontend
- `src/components/admin/AdminPaymentLinkDialog.tsx` — селектор сценариев, блок payer_type + `client_legal_details` picker для invoice, вызов `admin-invoice-checkout-issue` / `public-rr-installment-initiate`, сохранение `addon_offer_ids` во всех ветках.
- `src/components/admin/CreateDealDialog.tsx` — переиспользование AdminPaymentLinkDialog body.
- Опционально extract `AdminPaymentLinkForm` из диалога, если реюз без этого невозможен.

Backend
- `supabase/functions/admin-invoice-checkout-issue/index.ts` — добить addons/payer_type/legal_details параметры, вызов `buildPurchaseCompositionTitle` для назначения счёта.
- `supabase/functions.registry.txt` — уже добавлено.
- Никаких новых миграций (данные и офферы уже расставлены).

Тесты
- `src/lib/__tests__/purchaseCompositionTitle.test.ts` — уже PASS, дополнить кейсом «модуль без tariff».
- `src/components/admin/__tests__/AdminPaymentLinkDialog.scenarios.test.tsx` — новый: рендер 4 сценариев, видимость payer_type только для invoice, передача `addon_offer_ids` в мутации.
- `supabase/functions/admin-invoice-checkout-issue/index.test.ts` — Deno test: 0/2/9 addons; ЮЛ/ИП/ФЛ; manual override; отсутствие висячих сепараторов в composition title; отказ при `profile_id` mismatch.
- Расширить `src/test/composableCheckout.test.ts` кейсом «primary=2650 + 2 addon×50%» подтверждающим отсутствие скидки на primary.

### Проверки (DoD)
1. `bun run typecheck` — 0 errors.
2. `bunx vitest run` — все существующие + новые тесты PASS.
3. `bun run build` — success.
4. Deploy `admin-invoice-checkout-issue`.
5. Sandbox smoke (без реальной оплаты): открыть диалог для тестового контакта, product PRD-000039 / тариф «Бизнес-леди», выбрать 2 модуля, проверить quote = 2650 + 2×(list×0.5), поочерёдно переключить все 4 сценария, отправить только Card (dry-run на sandbox offer) и Invoice (issue PDF на sandbox legal_details).
6. Publish; после публикации — read-only verification: `order_groups` содержит одну запись с primary+2 addons и корректной суммой; `generated_documents` для invoice содержит корректный composition title.

### Stop-guards
- Не создаём параллельные таблицы/офферы.
- Не удаляем и не переписываем существующие пути (Card, internal installments) — только расширение.
- Не хардкодим UUID офферов в UI.
- Не запускаем реальных платежей/RR-заявок — только sandbox контакт/offer.
- При отсутствии invoice- или RR-оффера у тарифа соответствующая карточка сценария disabled с tooltip, не 500.

### Отчёт по завершении
Обновлю `.lovable/discovery/cb-sprint-final/report.md` до v3.0: перечень файлов, миграций (нет), функций (1 обновлена), результаты тестов, sandbox verification, ссылка на Publish.
