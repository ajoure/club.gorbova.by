дополни план следующей информацией:

1. **SOT автопродления только один:** включенный чекбокс/режим **«Подписка / автопродление»** в настройках кнопки тарифа (`tariff_offers.meta.recurring.is_recurring=true`).  
Всё остальное — разовые продукты.
2. **Разовые продукты не попадают в** `/admin/payments/auto-renewals`**.**  
По ним можно только отправлять уведомление об окончании доступа. Без автопродления, без учёта в таблице автопродлений.
3. **Продукты с включённой подпиской попадают в автопродления независимо от карты.**  
Если карта не привязана — это всё равно автопродляемый продукт, просто статус «без карты».
4. **Для продуктов с автопродлением должны уходить уведомления за 7/3/1 день:**
  - Telegram;
  - Email;
  - текст о скором окончании подписки;
  - две ссылки: **разовая оплата** и **подписка / автопродление**.
5. **Серые/зелёные точки в таблице — обязательный DoD.**  
После успешной отправки Telegram/Email соответствующая точка 7/3/1 должна становиться зелёной.  
Если не отправлено — серая/жёлтая с причиной в tooltip.
6. **Запрещено ломать уже реализованную механику** `generate-renewal-ctas`**.**  
Нужно восстановить прежнее поведение: для recurring-продуктов создаются обе ссылки — one-time и subscription.
7. **Исправить именно регрессию, а не менять архитектуру.**  
Не вводить новый workflow уведомлений, не менять grant/access/payment-flow, не включать разовые продукты в автопродления.

Коротко: автопродление определяется только включённой подпиской в кнопке тарифа. Всё остальное — разовое и не должно попадать в таблицу автопродлений.

&nbsp;

План:

## 1. Проблема

Сейчас страница `/admin/payments/auto-renewals` и ежедневный cron уведомлений показывают/обрабатывают неправильную реальность:

1. Уведомления за 7/3/1 день по email фактически не появляются в `email_logs`, поэтому email-точки в UI остаются серыми.
2. Основной блок уведомлений по Telegram за 7/3/1 часто не отправляет сообщения, а пишет `skipped: subscription_changed`.
3. Второй блок внутри того же cron отправляет Telegram как `no_card_warning`, из-за чего статистика показывает `expiry_reminders_sent: 0`, `no_card_warnings_sent: 29`, а не нормальные напоминания окончания доступа/подписки.
4. UI автопродлений до сих пор классифицирует подписочность через `requires_card_tokenization` / `product.category`, что противоречит текущему SOT: тип продукта определяется только через `resolveProductRenewability` / active `tariff_offers.meta.recurring.is_recurring` и другие canonical offer-сигналы.
5. Из-за этого разовые продукты попадают в автопродления и в MIT/«без карты», хотя они не должны считаться автопродляемыми.
6. Надпись MIT вводит в заблуждение: по данным сейчас есть активные provider-managed/bePaid подписки, а локальная MIT-модель не должна отображаться как отдельная живая когорта, если MIT реально не используется.

## 2. Диагностика: фактическое состояние

Проверено read-only:

- Cron `subscription-renewal-reminders` существует и активен, расписание `0 6 * * *`.
- Последний запуск есть: `2026-04-29 06:00 UTC`.
- Последний summary:
  - `total_processed: 31`
  - `telegram_sent_count: 29`
  - `expiry_reminders_sent: 0`
  - `no_card_warnings_sent: 29`
  - `duplicate_suppressed_count: 25`
- За последние 14 дней в `telegram_logs` есть subscription reminder записи, но много `skipped`, а сегодня основной блок пишет `reason=subscription_changed`.
- В `email_logs` за последние 14 дней нет ни одной записи с `meta.event_type like 'subscription_reminder_%'`.
- В коде `sendEmailReminder()` вызывает `send-email`, но фактические логи отсутствуют. Значит email-ветка либо не доходит до вызова, либо падает до логирования, либо блокируется логикой основного цикла.
- В UI `AutoRenewalsTabContent.tsx` сейчас:
  - основной запрос берет `subscriptions_v2_safe` с `.eq('auto_renew', true)`;
  - `is_subscription` вычисляется через `tariff_offers.requires_card_tokenization === true || product.category === 'subscription'`;
  - это запрещено текущим SOT для типа продукта.
- Скан показал расхождение:
  - текущий UI включает 253 записи;
  - canonical renewable по offer-SOT — 183;
  - примерно 70 разовых записей попадают в UI ошибочно.

## 3. Предлагаемое решение

### A. Починить cron `subscription-renewal-reminders`

1. Убрать ложный anti-stale guard:
  - сейчас он сравнивает `freshSub.status !== sub.status`, но `sub.status` не выбран в SELECT;
  - из-за этого `freshSub.status !== undefined` почти всегда true и основной блок пропускает реальные напоминания.
  - Нужно добавить `status` в SELECT и/или сравнивать только реально выбранные поля.
2. Сделать email-ветку доказуемой:
  - если email отсутствует — писать `email_logs` skip `email_missing`;
  - если `send-email` вернул ошибку — писать `email_logs` failed;
  - если отправка принята — писать canonical `email_logs` sent/success с `meta.subscription_id`, `meta.event_type`, `days_left`, `product_id`, `is_one_time`.
3. Убрать вредный второй блок `EXPIRING WITHOUT SBS` как отдельный отправщик Telegram:
  - он дублирует основной 7/3/1 workflow;
  - он не отправляет email;
  - он маскирует нормальные напоминания как `no_card_warning`;
  - после исправления основного блока он станет источником дублей.
  - Вместо него оставить только audit/diagnostic summary либо полностью отключить sending-часть.
4. Сохранить бизнес-логику текстов:
  - активная provider-managed подписка: уведомление о ближайшем автосписании/автопродлении;
  - продлеваемый продукт без active provider-managed: уведомление о скором окончании + корректные CTA;
  - разовый продукт: только уведомление о скором окончании доступа, без продления/автосписания.

### B. Починить UI автопродлений

1. В `AutoRenewalsTabContent.tsx` заменить вычисление `is_subscription`:
  - убрать `requires_card_tokenization` и `product.category` как классификаторы;
  - использовать canonical offer-SOT: active offers продукта, где:
    - `meta.recurring.is_recurring=true`, или
    - `payment_method='internal_installment'`, или
    - `is_installment=true`, или
    - `offer_type='subscription'`.
2. Разовые продукты не должны попадать в таблицу автопродлений.
  - Они остаются в уведомлениях окончания доступа через cron, но не отображаются как автопродления/карточные проблемы.
3. Исправить верхние счетчики:
  - «Всего подписок» считать только canonical renewable cohort;
  - «К списанию сегодня» — только provider-managed или реально списываемые подписки с `next_charge_at` сегодня;
  - «Без карты» — не показывать как MIT для разовых продуктов;
  - если MIT как способ списания реально не используется — убрать подпись `MIT` из split или заменить на нейтральное «Локальные»/«Без provider-managed» только если такие записи реально есть и являются renewable.
4. Исправить фильтры:
  - фильтр `no_card` должен считать только renewable non-provider-managed записи;
  - `bepaid` — только active provider_subscriptions;
  - `link_only/requires_3ds/broken_token` не должны включать one-time продукты.
5. Исправить email/TG точки:
  - UI должен читать успешные email outcome из `email_logs` по `meta.subscription_id + meta.event_type`;
  - TG — из `telegram_logs` по `meta.subscription_id + event_type`;
  - зеленая точка должна появляться при фактическом `sent/success`, а `skipped` должен оставаться желтым.

## 4. Изменяемые компоненты

Файлы:

- `supabase/functions/subscription-renewal-reminders/index.ts`
- `src/components/admin/payments/AutoRenewalsTabContent.tsx`
- `src/hooks/useAutoRenewalAlerts.ts`

Вероятная миграция:

- поправить/добавить индекс идемпотентности Telegram, если текущий уникальный индекс `(user_id,event_type,event_day)` мешает нескольким подпискам одного пользователя в один день.
- Текущий индекс не содержит `subscription_id`, который лежит в `meta`; это риск ложного duplicate suppression для пользователей с несколькими продуктами. Предпочтительно заменить на expression unique index по `(user_id, event_type, event_day, (meta->>'subscription_id'))` для reminder-событий.

Edge functions:

- redeploy `subscription-renewal-reminders` после правки.

UI:

- таблица, счетчики, фильтры и точки уведомлений на `/admin/payments/auto-renewals`.

## 5. Что не будет изменено

- Не трогаю доступы пользователей и даты подписок.
- Не делаю массовых UPDATE/DELETE по подпискам.
- Не меняю платежный grant/access flow.
- Не меняю `grant-access-for-order`.
- Не создаю новый параллельный workflow уведомлений.
- Не включаю разовые продукты в автопродления.

## 6. Dry-run

Перед execute будут выполнены read-only проверки:

1. Посчитать ожидаемую cohort для 7/3/1 дней по `access_end_at` в Europe/Minsk.
2. Разделить ее на:
  - provider-managed active;
  - renewable без provider-managed;
  - one-time.
3. Проверить, сколько email/TG outcome должно быть создано и сколько уже есть сегодня.
4. Проверить, сколько записей UI должен показывать после canonical фильтра.
5. Проверить, не даст ли новый idempotency-index конфликтов на исторических данных.

## 7. Execute

После подтверждения:

1. Исправлю anti-stale bug в `subscription-renewal-reminders`.
2. Уберу/отключу дублирующий второй sending-блок `EXPIRING WITHOUT SBS`.
3. Усилю email outcome logging.
4. Переведу UI на canonical product renewability SOT.
5. Исправлю счетчики/фильтры и подписи MIT/bePaid.
6. При необходимости добавлю безопасную миграцию idempotency-index для Telegram reminder по `subscription_id`.
7. Redeploy edge function.

## 8. STOP-guards

Остановить выполнение, если:

- canonical renewable cohort неожиданно отличается от текущей больше чем на ожидаемые 70 разовых записей без объяснения;
- найдено несколько активных provider_subscriptions на одну subscription_v2 без правила дедупа;
- новый индекс идемпотентности конфликтует с историческими дублями;
- `send-email` не развернут/не имеет активного email account;
- cron вызывает не тот deployed function version;
- dry-run показывает потенциальную отправку массово не тем пользователям.

## 9. DoD

Задача считается выполненной, когда подтверждено сканами:

1. Dry-run показывает корректную cohort 7/3/1: active provider-managed, renewable без provider-managed, one-time отдельно.
2. Симуляция/ручной безопасный запуск cron возвращает `expiry_reminders > 0` при наличии cohort и не пишет всё как `no_card_warning`.
3. В `telegram_logs` появляются `subscription_reminder_7d/3d/1d` с `status=success` и `meta.subscription_id`.
4. В `email_logs` появляются строки с `meta.event_type=subscription_reminder_*` и `meta.subscription_id`; UI email-точки могут стать зелеными.
5. В UI автопродлений разовые продукты больше не входят в список и счетчики.
6. Верхние счетчики соответствуют backend SQL scan.
7. Подпись MIT не показывает несуществующую отдельную cohort, если таких подписок реально нет.
8. Edge function redeployed.

## 10. Риски и зависимости

- Email зависит от существующей функции `send-email` и активного email account. Если account не настроен, будет честный failed outcome, а не серая пустота.
- Если у одного пользователя несколько подписок с одинаковым event_type в один день, текущий Telegram unique index может подавлять часть отправок. Это нужно исправить миграцией индекса.
- Разовые продукты будут исключены из UI автопродлений, но останутся в cron уведомлений окончания доступа — это ожидаемое поведение.

## 11. Требуется дополнительная информация

Дополнительных данных от пользователя не требуется. Нужен approve плана для внесения изменений, миграции и redeploy.