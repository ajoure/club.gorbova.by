План:

## Контекст (discovery)

- `tariff_offers.offer_type` = { `pay_now`, `trial`, `lead`, `preregistration` } — тип кнопки.
- Различие «Оплатить обучение / Оплатить от ЮЛ / Оплатить в два этапа» — не по `offer_type`, а по:
  - `payment_method`: `full_payment` vs `internal_installment`;
  - `meta.document_scenarios[].payer_type='legal_entity'` (счёт вместо checkout);
  - `meta.installment.*` (интервал/кол-во платежей).
- «Оставить заявку» = `offer_type='lead'` (см. Бухгалтер T-000011).
- Существующие edge-функции покрывают почти всё: `invoice-checkout-issue`, `installment-charge-cron`, `installment-notifications`, `submit-lead-request`, `public-checkout`.
- ЦБ (product `7101ed3c…`) уже имеет полностью настроенные offers с корректными `meta` (проверено в БД). Значит проблема — не в данных, а в:
  1. Runtime-обработке кнопок на публичной странице (какие payment_method вызывают invoice-flow, а не bepaid checkout);
  2. Настройке `installment` (у cron нет лимита `max_charge_attempts` per-offer);
  3. UI редактора кнопки (пропала настройка «попыток списания» для installment, нет tab «Уведомления» как в подписке);
  4. Telegram-привязке после лида (не переиспользована из Club/Ideology потока).

## Этапы

### Фаза 1 — Discovery-отчёт (артефакт `.lovable/discovery/buttons_parity_ccb_v1.md`)
Сравниваю по каждому продукту (ЦБ, Клуб, Идеология) для 4 существующих типов + новый:
- какая edge-функция вызывается,
- какие поля `meta` читаются,
- где ломается runtime на ЦБ.

Формат: таблица «Тип кнопки × { data / runtime / UI-редактор / notifications / telegram-link }», с ✓/✗ и ссылками на файлы.

### Фаза 2 — Фикс runtime «Оплатить от ЮЛ»
- В `PublicPayPage`/`public-checkout` при `offer.payment_method='full_payment'` + активный `document_scenarios[].payer_type='legal_entity' AND is_enabled=true` → маршрут в `invoice-checkout-issue` (выставление счёта), а не bepaid checkout.
- Согласовать с поведением Club/Ideology (сделать shared-helper `resolveCheckoutRoute(offer)`), чтобы правило было единым для всех продуктов.

### Фаза 3 — Фикс «Оплатить в два этапа»
- В `EditOfferDialog` (installment-таб): добавить поля:
  - «Попыток списания за платёж» (число или ∞), сохранение → `meta.installment.max_charge_attempts_per_installment`;
  - «Уведомлять перед списанием» (toggle) + «За сколько дней» (multi: 7/3/1) — как у recurring, храним в `meta.installment.notifications`;
  - «Часовой пояс + время попыток», Grace — как у автопродления.
- `installment-charge-cron` читает `meta.installment.max_charge_attempts_per_installment` (fallback = 3). При исчерпании → статус `failed`, subscription/order archive, аудит.
- `installment-notifications` расширяется на pre-charge reminder (7/3/1 день), reuse шаблонов из recurring-подписок.

### Фаза 4 — Новый тип кнопки «Рассрочка от банка»
- БД (миграция): расширить CHECK `tariff_offers_offer_type_check`, добавить `'bank_installment'`.
- `meta.bank_installment = { external_link: string, message_html: string }`.
- UI редактора: новая tab «Основное» — поле «Ссылка банка» (default: `https://pay.rrllc.ru/katerina-gorbova-credit`), текст сообщения (WYSIWYG).
- Runtime: клик → форма заявки (email/phone, как lead) → `submit-lead-request` создаёт сделку в pipeline из `meta.crm_routing` → показ модалки с `message_html` и кнопкой «Перейти к банку (ссылка)» → отправка email + Telegram сообщения через существующий `notify-lead-created`.

### Фаза 5 — Миграция кнопок на страницу ЦБ (`cb`)
- Убрать «Внести бронь» (деактивировать / скрыть).
- Добавить/включить «Заявка на рассрочку» = `bank_installment` со ссылкой pay.rrllc.ru.
- Проверить рендер `TariffCard` на публичной странице для всех 5 типов.

### Фаза 6 — Telegram-привязка после заявки
- Проверить, что после `lead` и `bank_installment` в success-модалке показывается предложение «Привязать Telegram» через тот же компонент, что в Club/Ideology (найти `TelegramLinkPrompt` / `LinkTelegramButton` в потоке club).
- Reuse без копирования, вынести в shared, подключить в общий success-flow заявок.

### Фаза 7 — E2E-тест (Playwright, headless, `test_mode`)
Скрипт `/tmp/browser/buttons_e2e/run.py` прогоняет на превью-URL:
1. cb → «Оплатить обучение» → bepaid test-card → success.
2. cb → «Оплатить в два этапа» → bepaid subscription → проверка `subscriptions_v2` + 2 installment_payments.
3. cb → «Оплатить от ЮЛ» → форма реквизитов → генерация счёта (проверка `generated_documents`).
4. cb → «Оставить заявку» → сделка + email + Telegram-prompt.
5. cb → «Заявка на рассрочку» (bank) → сделка + модалка со ссылкой банка.
Скриншоты + отчёт в `.lovable/discovery/buttons_parity_ccb_v1.md` (раздел «Verify»).

## Технические детали

- Новый payment_method-роутер: `src/lib/checkout/resolveCheckoutRoute.ts` (shared client+edge через `_shared/`).
- Миграция:
  - `ALTER TABLE tariff_offers DROP CONSTRAINT tariff_offers_offer_type_check`;
  - `ADD CONSTRAINT ... CHECK (offer_type IN ('pay_now','trial','lead','preregistration','bank_installment'))`.
- `meta`-схема расширяется без миграции (jsonb), но добавляется валидатор в `tariff_offers_acquiring_validate`.
- Cron `installment-charge-cron`: логика лимита попыток и архивации внутри уже существующего файла, без новой cron-задачи.
- UI-редактор: `src/components/admin/product/OfferEditDialog.tsx` (или как называется — уточню перед правкой) — добавляем 2 таба: «Автопродление» уже есть, дублируем секцию «Уведомления»+«Попытки» в installment-режиме.

## DoD

- [ ] discovery-отчёт зафиксирован в `.lovable/discovery/buttons_parity_ccb_v1.md` с матрицей 5×5.
- [ ] На cb все 5 кнопок присутствуют и корректно срабатывают (Playwright-скрины).
- [ ] «Оплатить от ЮЛ» на cb генерирует счёт (запись в `generated_documents`), а не bepaid checkout.
- [ ] «Оплатить в два этапа» имеет per-offer лимит попыток и уведомления 7/3/1 день до списания.
- [ ] Новый offer_type `bank_installment` работает на cb, ссылка сохраняется в `meta`, сделка создаётся, письмо+Telegram отправляются.
- [ ] После любой lead-заявки предлагается привязка Telegram (тот же UX, что в Club/Ideology).
- [ ] Нет регрессий на страницах club и ideology (smoke: открытие + первая кнопка каждого типа).
