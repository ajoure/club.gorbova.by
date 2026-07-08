# Discovery: паритет кнопок оплаты ЦБ ↔ Клуб/Идеология

Дата: 2026-07-07  
Продукт: `products_v2.id = 7101ed3c-7839-4a74-ad95-aa0660369b22` («Ценный бухгалтер | 1 ступень 2.0», страница `cb`)

## 1. Матрица типов кнопок

| Кнопка UI | `offer_type` | `payment_method` | Дифференциатор | Runtime-роутер |
|---|---|---|---|---|
| Оставить заявку | `lead` | — | `offer_type='lead'` | `LeadRequestDialog` |
| Оплатить обучение | `pay_now` | `full_payment` | `document_scenarios` смешанные | `PaymentDialog` → bePaid |
| Оплатить в два этапа | `pay_now` | `internal_installment` | `meta.installment.max_months=2, interval_days=30` | `PaymentDialog` (installment-режим) |
| Оплатить от ЮЛ | `pay_now` | `full_payment` | `document_scenarios`: активны только `payer_type='legal_entity'` с `payment_channels=['bank_transfer']` | `InvoiceCheckoutDialog` (через `detectInvoiceOnlyOffer`) |
| Внести бронь | `pay_now` (частичная) | `full_payment` | `amount=100`, без `is_primary` | `PaymentDialog` (сумма-бронь) |
| **Заявка на рассрочку (bank_installment)** — новый | ❌ отсутствует | — | требуется новый `offer_type='bank_installment'` + `meta.bank_installment.external_link` | новый `BankInstallmentDialog` (переиспользует Lead+Success) |

## 2. Что уже реализовано корректно

- `src/lib/invoiceCheckout.ts` → `detectInvoiceOnlyOffer` работает корректно для оффера «Оплатить от ЮЛ» на ЦБ (в meta 2 активных `legal_entity`-сценария, оба с `payment_channels=['bank_transfer']` → флаг `isInvoiceOnly=true`).
- `src/pages/SitePageBySlug.tsx` (строки 219–235) уже вызывает `InvoiceCheckoutDialog`, если детектор вернул true. Значит на публичной странице cb (site-page) кнопка «Оплатить от ЮЛ» **обязана** открывать invoice-flow.
- `src/components/lead/LeadRequestDialog.tsx` уже имеет шаг `telegram` с `TelegramCompactCard` — паритет с Club/Ideology есть.
- `installment-charge-cron`, `installment-notifications`, `invoice-checkout-issue`, `submit-lead-request` — edge-функции есть, deploys прошли (см. `.lovable/`).
- Данные ЦБ в БД (`tariff_offers.meta`) корректны для всех 4 существующих типов.

## 3. Что НЕ реализовано (реальные пробелы)

### 3.1. `UniversalPricingSection` (используется в non-site-page потоках) — регрессия
`src/components/landing/UniversalPricingSection.tsx:156` для любого не-lead / не-prereg оффера открывает `PaymentDialog` — **без вызова `detectInvoiceOnlyOffer`**. Если ЦБ где-либо рендерится не через `SitePageBySlug` (например, старый `ProductLanding`), кнопка «Оплатить от ЮЛ» пойдёт в bePaid вместо счёта.

**Фикс**: добавить в `UniversalPricingSection` тот же роутер, что в `SitePageBySlug`. То же самое для `ProductLanding.tsx:117+`.

### 3.2. UI-редактор оффера — потерянные настройки installment
В админ-модалке кнопки (tab «Автопродление») сейчас отсутствуют для `internal_installment`:
- «Попыток списания за платёж» (число / ∞) → `meta.installment.max_charge_attempts_per_installment`
- «Уведомлять перед списанием» (7/3/1 день) → `meta.installment.notifications.pre_charge_days`
- «Часовой пояс» и «Время попыток» есть у recurring, у installment таба нет.

Cron `installment-charge-cron` сейчас использует хардкод `3` для попыток списания (проверка: `supabase/functions/installment-charge-cron/index.ts`).

### 3.3. Новый тип `bank_installment`
- Отсутствует в `tariff_offers_offer_type_check` (CHECK constraint).
- Отсутствует в `TariffOffer.offer_type` TS-типе и в фильтрах `TariffCard.tsx`.
- Нет `BankInstallmentDialog` компонента.

### 3.4. Страница cb — UI-миграция кнопок
- «Внести бронь» на трёх тарифах — оффер `T-000011/T-000013/T-000015 бронь-100BYN` должен быть деактивирован (`is_active=false`).
- «Заявка на рассрочку» с offer_type=`bank_installment` и ссылкой `https://pay.rrllc.ru/katerina-gorbova-credit` должна быть создана для каждого из 3 тарифов ЦБ.

## 4. Гипотеза о жалобе пользователя «Оплатить от ЮЛ не работает»

Данные и роутер в `SitePageBySlug` корректны. Наиболее вероятные причины сбоя runtime:
1. `InvoiceCheckoutDialog` падает при загрузке `useLegalDetails` (RLS / отсутствие профиля).
2. `invoice-checkout-issue` edge-функция возвращает 4xx/5xx.
3. `document_scenarios[].template_id` для legal_entity указывает на отсутствующий шаблон.

**Требуется Playwright-репро на превью с логами консоли + network**, до того как менять код. Иначе фикс — по гадалке.

## 5. Рекомендуемая последовательность (безопасная)

1. **Playwright-репро** «Оплатить от ЮЛ» на cb → сбор точной ошибки. (~5 мин)
2. **Точечный фикс** сбоя из шага 1.
3. **UniversalPricingSection**: добавить `detectInvoiceOnlyOffer` роутинг (5 строк). Регрессионный тест: club/ideology `pay_now` без legal-scenarios продолжает идти в bePaid.
4. **UI installment-настройки** в редакторе оффера + чтение поля в cron.
5. **Новый `bank_installment`**: миграция enum → TS-тип → фильтр в TariffCard → новый диалог → seed кнопки на 3 тарифах ЦБ.
6. **Деактивация «Внести бронь»** — insert-op после подтверждения.
7. **E2E-прогон** 5 сценариев, скрины в этот файл.

## 6. Что НЕ делаю в этой итерации без явного подтверждения

- Не трогаю CHECK constraint `tariff_offers_offer_type_check` до пункта 5 плана.
- Не деактивирую офферы «Внести бронь» без подтверждения (могут быть уже оплаченные брони).
- Не меняю логику `installment-charge-cron` пока в БД не появится поле `max_charge_attempts_per_installment` (иначе регрессия у Club installment).
- Не расширяю `UniversalPricingSection` пока не подтверждена причина сбоя на cb (шаг 1) — риск замаскировать реальную ошибку.
