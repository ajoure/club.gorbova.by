# да, согласен, с учетом правок:

1. **Убрать формулировку “заменяет club-only ветку”.**  
Новая `notify-order-purchased` не заменяет `telegram-grant-access`. Она добавляется как отдельный post-payment notification layer после access grant. Club-DM «Доступ открыт» остаётся fulfilment/access-сообщением, purchase notification — отдельное коммерческое уведомление.
2. **Idempotency нельзя держать только в** `orders_v2.meta`**.**  
`meta.notify.purchased_sent` допустим как cache/status, но не как основной guard. Нужна отдельная canonical-таблица, например:
  &nbsp;
  ```sql
  order_notification_deliveries
  - id uuid
  - order_id uuid
  - channel text -- telegram/email
  - notification_type text -- product_purchased
  - status text -- pending/sent/skipped/failed
  - provider_message_id text null
  - error text null
  - created_at
  - sent_at
  - metadata jsonb
  unique(order_id, channel, notification_type)
  ```
  Это соответствует auditability / execution-ledger подходу платформы. `telegram_messages` и `email_send_log` могут быть downstream-доказательствами, но не единственным SoT.
3. **Вызов из** `grant-access-for-order` **должен быть non-blocking для доступа.**  
Если email/Telegram notification упали, доступ уже выдан и не должен откатываться. Ошибка уведомления фиксируется в ledger/log, но `grant-access-for-order` не должен становиться failed из-за уведомления.
4. **Добавить event-контракт.**  
После успешного access grant нужно создать событие уровня Communications, например:
  &nbsp;
  ```text
  order_purchase_notification_requested
  entity_id = order_id
  payload = { order_id, product_id, tariff_id, profile_id/contact_id, payment_id }
  ```
  `notify-order-purchased` может быть текущим executor’ом этого события. Это лучше соответствует event-driven core и разделению доменов.  
5. **Не перегружать** `product_email_mappings`**.**  
SMTP-маппинг и шаблоны уведомлений — разные сущности. Лучше создать отдельную таблицу:
  &nbsp;
  ```sql
  product_notification_templates
  - id uuid
  - product_id uuid
  - notification_type text
  - channel text
  - subject_override text null
  - intro_html text null
  - is_enabled boolean default true
  - metadata jsonb
  unique(product_id, notification_type, channel)
  ```
  `product_email_mappings` оставить только для выбора SMTP/account/provider.
6. **Открытые вопросы нужно закрыть прямо в плане до Execute.**  
Рекомендуемые дефолты:
  - продукты с клубом: **email отправлять всегда**, Telegram purchase-DM по умолчанию **не дублировать**, если уже был club-DM, кроме случаев `force_purchase_dm=true`;
  - guest-покупки `/pay/:token`: email отправлять, если есть валидный email в order/contact/profile;
  - рассрочка: отдельный `notification_type`, не смешивать с обычной покупкой:
    - `installment_first_payment_received`;
    - `installment_payment_received`;
    - `installment_schedule_created`.
7. **Добавить channel policy / recipient resolver.**  
В плане нужно явно описать, откуда берутся получатели:
  - email priority: `orders_v2.customer_email` → `profiles.email` → `contacts.email`;
  - Telegram priority: `contact.telegram_chat_id` / `profile.telegram_chat_id`;
  - если получателя нет — `skipped`, не `failed`.
8. **Добавить unsubscribe / transactional classification.**  
Покупка — транзакционное уведомление, не маркетинг. Но в плане нужно явно указать:
  - не использовать маркетинговый unsubscribe как обязательное условие отправки;
  - не отправлять promotional-блоки;
  - соблюдать существующую email-инфраструктуру и suppressions, если они уже есть.
9. **Backfill должен быть dry-run first.**  
Перед реальной рассылкой:
  - показать количество paid orders за N дней;
  - сколько уже notified;
  - сколько email-eligible;
  - сколько Telegram-eligible;
  - сколько skipped;
  - затем execute batch с лимитом и отчетом.
10. **Reconcile не должен слать массовые дубли.**  
В `subscriptions-reconcile` добавлять только enqueue/check недостающих notification records через idempotent delivery table. Не вызывать прямую отправку без unique guard.
11. **DoD расширить proof’ами:**

- SQL proof unique constraint по `(order_id, channel, notification_type)`;
- paid order без клуба → Telegram/email sent;
- paid order с клубом → club-DM сохранён, purchase email sent, purchase Telegram skipped или sent по настройке;
- unpaid/installment lead → skipped;
- повторный вызов `notify-order-purchased` → не создаёт дубль;
- email отсутствует → Telegram всё равно работает;
- Telegram отсутствует → email всё равно работает;
- failure одного канала не блокирует второй канал.

12. **Документацию дополнить не только** `PAYMENT_LINKS_AUDIT.md`**.**  
Добавить отдельный раздел/документ:

- notification lifecycle;
- notification types;
- idempotency keys;
- recipient resolution;
- retry/reconcile/backfill;
- где проходит граница между Access fulfilment и Communications notification.
- &nbsp;
- План: единое уведомление о покупке (Telegram + Email) для всех продуктов

## 1. Итог discovery (что уже есть, что сломано)

Канонический write-path после оплаты (Phase 2 freeze, не трогаем):

```
bepaid-webhook / stripe-webhook / public-checkout / direct-charge / admin-create-payment-link
  → grant-access-for-order  (единая точка выдачи доступа для ОПЛАЧЕННЫХ orders_v2)
     ├─ subscriptions_v2 / entitlements / access_grant_ledger
     └─ telegram-grant-access  → DM «✅ Доступ открыт!» + telegram_messages mirror
```

Проверено:

- **Telegram DM работает только если у продукта есть club-rule в `access_rules**` (`grant-access-for-order/index.ts` ≈ строки 2050–2119). Если правило не найдено — DM НЕ отправляется (`default-deny`). Это и есть основная «дыра»: продукты без клуба (консультации, разовые продукты, `cb`-пакеты и т.п.) вообще не получают уведомление.
- **Email-уведомления о покупке НЕТ нигде.** `grant-access-for-order` не вызывает `send-email` / `send-transactional-email`. Существующий `send-email` — это generic SMTP-отправитель через `product_email_mappings` (маппинг продукт → SMTP-аккаунт), никакого шаблона «покупка совершена» не существует.
- **Transactional email templates не заскаффолжены** (`supabase/functions/_shared/transactional-email-templates/` отсутствует, есть только auth-шаблоны).
- Заявки/неоплаченные счета корректно НЕ триггерят grant-access-for-order — она вызывается только с terminal-paid webhook’ов и `orders_v2.status='paid'`, поэтому инвариант «только оплаченные» уже соблюдён на уровне архитектуры.

## 2. Что делаем (add-only, без правки Phase 2 freeze)

### 2.1. Новая каноническая точка — `notify-order-purchased`

Единая edge-функция, идемпотентная по `order_id`, вызывается **из `grant-access-for-order` в самом конце** (после успешной записи в ledger). Заменяет как «club-only» ветку, так и отсутствующий email-путь:

- вход: `{ order_id }` (+ optional replay-флаг для admin backfill);
- читает `orders_v2` + `products_v2` + `tariffs` + `contacts/profiles`;
- гарантирует, что `orders_v2.status='paid'` (иначе no-op);
- идемпотентность: `orders_v2.meta.notify.purchased_sent = { telegram: ts, email: ts }` + guard в `telegram_messages` (`event=purchase_confirmation_dm`) + `email_send_log.message_id = purchase-confirm-<order_id>`;
- отправляет:
  - **Telegram DM** через `telegram-send-notification` (без club_id — DM в личку по `contacts.telegram_chat_id`), даже если у продукта нет клуба;
  - **Email** через `send-transactional-email` с шаблоном `product-purchased` (единый параметризованный шаблон: имя продукта, тариф, срок доступа, ссылки).

### 2.2. Data-driven шаблоны на продукт

Расширяем `product_email_mappings` (или создаём новую `product_notification_templates`, решим на dry-run) двумя полями:

- `purchase_email_subject_override text null`
- `purchase_email_intro_html text null`

Базовый шаблон один (React Email tsx), названия/тексты для конкретного продукта берутся из БД. Никакого «вайб-кодинга под каждый новый продукт».

### 2.3. Каноническая привязка: любая новая кнопка/тариф работает автоматически

Т.к. все существующие «оплатные» кнопки (site CTA, `/pay/:token`, admin checkout, subscription flow, installment) сходятся в `bepaid-webhook`/`stripe-webhook` → `grant-access-for-order` (см. `docs/PAYMENT_LINKS_AUDIT.md`), достаточно один раз вставить вызов `notify-order-purchased` в конце `grant-access-for-order`. Никаких правок в UI/кнопках/тарифах не требуется — новые продукты подхватываются автоматически.

### 2.4. Инфраструктура email

- Проверить статус email-домена (`check_email_domain_status`);
- при необходимости — `setup_email_infra` + `scaffold_transactional_email` (создаст `send-transactional-email`, реестр шаблонов, unsubscribe-функцию);
- добавить шаблон `product-purchased.tsx` в реестр.

### 2.5. Backfill и Recovery

- Разовый admin-скрипт (RPC) «прогнать `notify-order-purchased` по всем `orders_v2.status='paid'` за последние N дней, где `meta.notify.purchased_sent` пуст» — закрывает исторический пропуск.
- Reconcile-путь: в существующий `subscriptions-reconcile` добавить дозагрузку недостающих уведомлений через ту же функцию (идемпотентно).

## 3. DoD

1. `notify-order-purchased` развёрнут, идемпотентен, покрыт unit-тестом «paid vs unpaid vs replay».
2. `grant-access-for-order` вызывает его один раз в конце (после DM клуба, если он был).
3. Telegram DM «Продукт куплен» приходит для продуктов **без клуба** (проверено на консультации и `cb`-тарифе).
4. Email «Продукт куплен» приходит для всех оплаченных заказов, one row per `message_id` в `email_send_log`.
5. Backfill выполнен для последних 30 дней; отчёт с количеством разосланных уведомлений.
6. Аудит: новая кнопка/тариф/продукт → уведомление уходит без изменений в коде UI.
7. Guard: заявки на рассрочку / неоплаченные `orders_v2` уведомление НЕ триггерят (тест на `status != 'paid'`).
8. `docs/PAYMENT_LINKS_AUDIT.md` дополнен разделом «Post-payment notifications» с диаграммой.

## 4. Что НЕ трогаем

- bepaid recurring, stripe subscription resolver, `record_refund_atomic_multi`, `grant-access-for-order` write-логика доступа.
- Существующая ветка club-DM в `telegram-grant-access` — остаётся как есть (с кнопками входа в клуб). Новое уведомление о покупке — отдельный event `purchase_confirmation`, не конфликтует по idempotency-ключу.
- `product_email_mappings` в части SMTP-аккаунта — используется как есть.

## 5. Открытые вопросы (спрошу перед Execute)

1. Для продуктов **с клубом** отправлять и club-DM «Доступ открыт», и purchase-DM? Или объединить в одно сообщение?
2. Email должен уходить всем (в т.ч. гостевым покупкам по `/pay/:token` без user_id) или только зарегистрированным?
3. Нужен ли отдельный шаблон для рассрочки (первый платёж vs последующие), или один общий текст с блоком «график платежей»?