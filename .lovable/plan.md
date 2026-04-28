План:

## 1. Проблема

Есть два связанных дефекта в уведомлениях и платёжных ссылках:

1. В Telegram/уведомлениях иногда показывается «разовая оплата» или «разовая покупка — продление не требуется», хотя у продукта/тарифа есть активная кнопка тарифа с автопродлением.
2. Логика продления сейчас местами выводится из текущей подписки пользователя (`billing_type`, `auto_renew`, наличие SBS/provider-managed), а должна выводиться из настроек активных кнопок тарифа по UUID: `product_id`, `tariff_id`, `offer_id`.

Из-за этого при отсутствии действующей provider-managed подписки система может ошибочно считать продукт разовым и не предложить продление/подписочную ссылку.

## 2. Диагностика

Факты по текущей системе:

- `subscription-renewal-reminders` содержит локальный классификатор `isOneTimeProduct`, который принимает решение по `tariff_offers`, но проверяет в основном наличие активного `offer_type='subscription'`. В текущей модели автопродление у кнопок хранится не так: для `pay_now`-кнопок признак подписки лежит в `tariff_offers.meta.recurring.is_recurring = true` и `requires_card_tokenization = true`.
- Для Gorbova Club активные кнопки тарифа действительно рекуррентные:
  - BUSINESS: active `pay_now`, `requires_card_tokenization=true`, `meta.recurring.is_recurring=true`, цена 250 BYN.
  - CHAT: active `pay_now`, `requires_card_tokenization=true`, `meta.recurring.is_recurring=true`, цена 100 BYN.
- Shared helper `generate-renewal-ctas.ts` всегда генерирует две ссылки: `one_time` и `subscription`, без проверки того, какие кнопки реально разрешены тарифом.
- `telegram-send-reminders` — отдельная legacy edge function — также генерирует CTA через `generateRenewalCTAs`, но `resolveProductAndTariff` читает устаревшие/сомнительные поля (`tariffs.price`, `tariffs.billing_type`) и не смотрит на `tariff_offers.meta.recurring`.
- `AdminPaymentLinkDialog.tsx` уже частично исправлялся, но последнее сообщение в логах показывает, что в 16:36 ушло сообщение:
  - продукт: «Подоходный налог ИП»
  - тариф: «2 этапа»
  - тип: «Разовая оплата»
  - хотя созданная ссылка была installment: `payment_method='internal_installment'`, `selected_installment_months=2`, amount per-payment 195 BYN.
  Это значит, что UI-состояние/расчёт Telegram-сообщения не должен полагаться только на локальный `isInstallmentOffer`, а должен дополнительно сверяться с данными созданной ссылки/offer.
- На скриншоте ошибка «Failed to send a request to the Edge Function» в контакт-центре. По доступным логам за последние 24 часа успешные отправки `telegram-admin-chat` были, явного backend-лога с ошибкой нет. Вероятный класс проблемы — UI показывает сырой SDK/network error, а не нормализованную причину. Также `telegram-admin-chat` не всегда возвращает структурированный `success:false` в catch для всех кейсов.

## 3. Предлагаемое решение

### 3.1. Ввести единый backend-resolver для платёжных возможностей тарифа

да, согласен, с учетом правок:

1. Новый resolver — правильно. Источник истины только `tariff_offers`, не `subscription.billing_type` и не `product.entitlement_mode`.
2. Для installment в reminders: **не создавать CTA автоматически**, только помечать продукт как renewable/installment и давать безопасный переход в кабинет/страницу продукта.
3. В `AdminPaymentLinkDialog` финальный текст Telegram брать из созданной ссылки/ответа writer-а, а не из локального состояния формы.
4. `ContactTelegramChat` — только нормализация ошибки, без изменения логики отправки.
5. В DoD добавить grep-proof: нет старой фразы «разовая покупка — продление не требуется» для тарифов, где есть active subscription/installment offer.

Можно выполнять.

&nbsp;

Создать shared helper в `supabase/functions/_shared/renewal-offer-resolver.ts`:

- Вход: `productId`, `tariffId`, optional `preferredOfferId`.
- Читает `tariffs`, `tariff_offers`, `tariff_prices`.
- Работает только по UUID и активным `pay_now` offer-ам.
- Классифицирует кнопки так:
  - `subscription`: `offer.meta.recurring.is_recurring === true` или `requires_card_tokenization === true` при `payment_method='full_payment'`.
  - `installment`: `payment_method='internal_installment'` и `installment_count/max_months >= 2`.
  - `one_time`: активная `pay_now`-кнопка без recurring и без installment.
- Возвращает:
  - `isRenewable`: есть subscription или installment или one_time кнопка, по которой можно оплатить продление.
  - `hasSubscriptionOffer`: есть активная кнопка автопродления.
  - `hasInstallmentOffer`: есть активная рассрочка.
  - `hasOneTimeOffer`: есть активная разовая кнопка.
  - canonical offer IDs и цены для каждого типа.
  - `classificationSource`: подробные сигналы для audit/logs.

Важно: это не новая таблица и не новый source of truth. Source of truth остаётся `tariff_offers`.

### 3.2. Исправить `generate-renewal-ctas.ts`

Сейчас helper всегда создаёт `one_time` + `subscription`. После правки:

- Он сначала вызывает resolver.
- Создаёт только те CTA, которые разрешены активными кнопками тарифа.
- Если у тарифа есть автопродление — создаёт subscription-ссылку даже если у пользователя сейчас нет действующей provider-managed подписки.
- Если есть one-time кнопка — создаёт one-time ссылку.
- Если есть installment кнопка — не смешивает её с обычной `one_time`; либо не создаёт автоматом без явного выбора срока, либо создаёт только при наличии однозначного `installment_count`. Для reminder-CTA безопаснее: не добавлять installment в автоматические reminder-кнопки без явного выбора, но не называть продукт разовым.
- В audit/meta писать, почему ссылка создана/не создана: `offer_id`, `offer_kind`, `has_subscription_offer`, `has_one_time_offer`, `has_installment_offer`.

### 3.3. Исправить `subscription-renewal-reminders`

- Заменить `isOneTimeProduct` на resolver из shared helper.
- Убрать зависимость «продукт разовый» от отсутствия активной provider-managed подписки.
- Если `tariff_offers` говорит, что у продукта есть recurring-кнопка — уведомление должно быть про продление, а не «разовая покупка».
- `hasActiveSBS` использовать только для текста «автопродление уже активно и спишется автоматически», а не для классификации продукта.
- Если SBS нет, но recurring-кнопка есть — сформировать subscription CTA.
- Email-ветку привести к той же логике, чтобы email и Telegram не расходились.

### 3.4. Исправить `telegram-send-reminders` legacy-функцию

- Перевести `resolveProductAndTariff` на тот же resolver.
- Не использовать `tariffs.price`/`tariffs.billing_type` как источник истины для способа продления.
- Если есть recurring-кнопка — предлагать продление/подписочную ссылку даже без текущей active SBS.
- Если нет продукта/тарифа/активной кнопки — не писать «разовый продукт», а отправлять безопасный fallback «открыть кабинет/страницу продукта» и логировать stop-reason.

### 3.5. Исправить Telegram-сообщение при создании публичной ссылки из админки

В `AdminPaymentLinkDialog.tsx`:

- Вынести построение текста Telegram в одну функцию, чтобы не было двух расходящихся веток (`sendToTelegramMutation` и `combined-flow`).
- Определять installment не только по локальному `isInstallmentOffer`, но и по фактически созданной ссылке/offer:
  - если `effectiveOffer.payment_method === 'internal_installment'`, всегда показывать «Оплата в рассрочку» и `N × per_payment BYN`;
  - не использовать `effectivePaymentType === 'one_time'` для label, если offer installment.
- После создания ссылки использовать ответ `admin-create-public-link` (`payment_type`, `amount`, `meta.installment`) как финальный источник отображения, если он доступен.
- В UI toast не показывать сырой `Failed to send a request to the Edge Function`; нормализовать ошибку в понятный текст.

### 3.6. Улучшить ошибку отправки из контакт-центра

В `ContactTelegramChat.tsx` и при необходимости `telegram-admin-chat`:

- Нормализовать SDK/network error `Failed to send a request to the Edge Function` в понятное сообщение: «Не удалось связаться с backend-функцией отправки. Сообщение не отправлено, попробуйте ещё раз; если повторится — проверьте доступность Lovable Cloud/бота».
- Не менять бизнес-логику отправки сообщений, только обработку ошибок и диагностику.
- Добавить в ошибочный toast больше контекста без сырого stack/error.

## 4. Изменяемые компоненты

Edge/shared:

- `supabase/functions/_shared/renewal-offer-resolver.ts` — новый shared helper, без новой таблицы.
- `supabase/functions/_shared/generate-renewal-ctas.ts` — использовать resolver и создавать CTA только по активным кнопкам тарифа.
- `supabase/functions/subscription-renewal-reminders/index.ts` — заменить классификацию one-time/renewable.
- `supabase/functions/telegram-send-reminders/index.ts` — привести legacy reminders к тому же источнику истины.

UI:

- `src/components/admin/AdminPaymentLinkDialog.tsx` — единый построитель Telegram-текста ссылки, корректная рассрочка/подписка/разовый тип.
- `src/components/admin/ContactTelegramChat.tsx` — нормализация ошибки Edge Function при отправке.

Опционально только если диагностика покажет необходимость:

- `supabase/functions/telegram-admin-chat/index.ts` — добавить более структурированный error response/audit при неожиданных ошибках отправки.

## 5. Что не будет изменено

- Не создавать новые таблицы, enum, статусы или параллельный notification workflow.
- Не менять `src/integrations/supabase/client.ts` и `src/integrations/supabase/types.ts`.
- Не менять RLS и роли.
- Не менять canonical write-path платежей: `admin-create-public-link` остаётся writer для public links, `create-payment-checkout` остаётся downstream checkout path, `grant-access-for-order` остаётся write-path доступа.
- Не выполнять массовые UPDATE/DELETE.
- Не менять существующие подписки/заказы вручную.

## 6. Dry-run

Перед выполнением патча:

1. SQL-read проверка активных offer-ов для Gorbova Club и проблемного продукта «Подоходный налог ИП»:
  - `product_id`, `tariff_id`, `offer_id`, `payment_method`, `requires_card_tokenization`, `meta.recurring.is_recurring`, `installment_count`, `meta.installment`.
2. Проверить последние `payment_links` и `telegram_logs`, чтобы подтвердить:
  - installment-ссылка создана корректно;
  - уведомление ушло с неверным `message_text`.
3. Проверить последние failed/blocked записи `notification_outbox`, `telegram_logs`, `telegram_messages`.

## 7. Execute

После подтверждения плана:

1. Добавить shared resolver.
2. Подключить resolver в `generate-renewal-ctas`.
3. Обновить `subscription-renewal-reminders`.
4. Обновить `telegram-send-reminders`.
5. Обновить `AdminPaymentLinkDialog`.
6. Обновить нормализацию ошибки в `ContactTelegramChat`.
7. Задеплоить изменённые edge functions:
  - `subscription-renewal-reminders`
  - `telegram-send-reminders`
  - при необходимости `telegram-admin-chat`

## 8. STOP-guards

Остановить выполнение и не отправлять/не создавать новые ссылки, если:

- У тарифа нет активных `pay_now` кнопок.
- Найден active offer, но он не принадлежит `tariff_id`.
- `product_id` из тарифа не совпадает с ожидаемым `product_id`.
- Цена меньше 1 BYN или не определена.
- У recurring-кнопки нет валидной цены (`amount` или `auto_charge_amount`).
- У installment-кнопки нет валидного `installment_count/max_months >= 2`.
- Resolver возвращает несколько conflicting primary offer-ов — выбрать deterministic fallback, но записать audit warning.
- Telegram API возвращает ошибку — не считать отправку успешной, писать structured log.

## 9. DoD

Задача считается выполненной, если:

1. Для Gorbova Club resolver показывает `hasSubscriptionOffer=true` по active `tariff_offers.meta.recurring.is_recurring=true`.
2. Напоминание для продукта с recurring-кнопкой больше не может попасть в ветку «разовая покупка — продление не требуется» только из-за отсутствия active SBS.
3. Для пользователя без действующей provider-managed подписки, но с recurring-кнопкой тарифа, создаётся subscription CTA.
4. Для installment-ссылки Telegram-текст показывает:
  - «Оплата в рассрочку»;
  - «Рассрочка · N платежей»;
  - `N × per_payment BYN (итого total BYN)`.
5. `telegram-send-reminders` и `subscription-renewal-reminders` используют один и тот же resolver, а не разные эвристики.
6. UI больше не показывает сырой текст `Failed to send a request to the Edge Function`; ошибка нормализована.
7. В `audit_logs`/`telegram_logs` есть достаточные признаки source-of-truth: `offer_id`, `offer_kind`, `has_subscription_offer`, `has_one_time_offer`, `has_installment_offer`.
8. Не создано новых таблиц/статусов/workflow.

## 10. Риски и зависимости

- Автоматическое создание installment CTA в reminder-ах может быть спорным, потому что рассрочка требует явного выбора срока. Поэтому безопасный вариант: использовать installment как признак renewability, но не создавать installment-ссылку без однозначного срока.
- Если у тарифа одновременно есть one-time и subscription кнопки, уведомление может показать обе кнопки — это допустимо только если обе активны в настройках тарифа.
- Если старая legacy-функция `telegram-send-reminders` фактически не используется cron-ом, её всё равно нужно исправить, потому что пользователь просит проверить все edge functions, и она может быть запущена вручную/из другого места.
- Проверка Edge Function логов сейчас не вернула runtime logs; верификацию надо делать через database logs/audit, прямой `curl_edge_functions` и targeted SQL-read.

## 11. Требуется дополнительная информация

Дополнительная информация от вас не требуется. Нужно подтверждение плана, после чего внесу патч и проведу проверку.