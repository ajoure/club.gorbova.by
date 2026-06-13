да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Перед изменением `stripe-webhook` добавить следующие обязательные уточнения.



## **1. Сначала подтвердить фактический контракт**

`telegram-notify-admins`

До реализации прочитать:

```text
supabase/functions/telegram-notify-admins/index.ts
supabase/functions/bepaid-webhook/index.ts
```

Зафиксировать:

- точный request DTO;
- обязательные и необязательные поля;
- допустимые `source`;
- допустимые `event_type`;
- формат суммы и валюты;
- способ определения админского Telegram-чата;
- текущую дедупликацию;
- audit/log actions;
- поведение при отсутствии Telegram-конфигурации.

Не отправлять предполагаемый JSON-контракт, пока он не сверен с фактическим обработчиком.

Если bePaid использует shared helper, переиспользовать его. Не копировать восемь inline-вызовов в Stripe без необходимости.

---







## **2. Не уведомлять одновременно из**

`payment_intent.succeeded` **и** `charge.succeeded`

Один Stripe-платёж обычно порождает связанные события:

```text
payment_intent.succeeded
charge.succeeded
checkout.session.completed
```

Если добавить уведомление в несколько веток, админы могут получить дубли.

Для разовой успешной оплаты выбрать **один канонический бизнес-триггер**, соответствующий текущему payment lifecycle.

Предпочтительный trigger определяется по фактическому коду:

```text
ветка, которая атомарно завершила:
payment succeeded
→ order paid
→ grant-access completed/accepted
```

Остальные Stripe-события должны:

- обновлять технические данные;
- не создавать повторное админское уведомление;
- либо проходить через общий idempotency guard.

В отчёте указать выбранный trigger и почему остальные события не дублируют сообщение.

---





## **3.**

`invoice.paid` **также может пересекаться с первым платежом подписки**

Для первой subscription invoice Stripe может одновременно прислать:

```text
checkout.session.completed
payment_intent.succeeded
invoice.paid
```

Нужно различать:

```text
первичная покупка подписки
повторное рекуррентное списание
```

`event_type='recurring_charge'` отправлять только если invoice действительно относится к последующему циклу, а не к первичной оплате.

Использовать доказанный marker, например по фактической архитектуре:

- billing reason;
- subscription cycle;
- уже существующая локальная подписка;
- invoice sequence;
- metadata contract.

Не определять recurring только по наличию `subscription_id`.

---

## **4. Обязательная идемпотентность уведомлений**

Добавить canonical notification key:

```text
stripe_admin_notify:
<business_event_type>:
<provider_object_id>
```

Примеры:

```text
stripe_admin_notify:payment_succeeded:pi_...
stripe_admin_notify:refund:re_...
stripe_admin_notify:recurring_charge:in_...
```

Повторная доставка того же Stripe event или другого Stripe event для того же бизнес-факта не должна создавать второе уведомление.

Перед добавлением новой таблицы проверить существующие механизмы:

```text
provider_events
audit_logs
pending_telegram_notifications
telegram notification dedup helpers
```

Новая таблица или migration в этом патче запрещена без доказанной необходимости.

Если `telegram-notify-admins` уже принимает `idempotency_key`, использовать её.

---

## **5. Refund trigger должен использовать точный refund object**

Для возврата не ограничиваться только `charge.refunded`, поскольку одно событие может отражать:

- полный возврат;
- частичный возврат;
- несколько refund objects по одному charge;
- повторную доставку события.

Уведомление должно содержать и дедуплицироваться по точному:

```text
refund_id = re_*
```

Поля:

```text
refund amount
currency
parent payment/order
refund status
provider refund ID
```

Если из `charge.refunded` невозможно однозначно получить новый конкретный refund без Stripe list/search:

```text
STOP
REFUND_NOTIFICATION_EXACT_ID_NOT_RESOLVED
```

Не выбирать refund по сумме или дате.

Допускается использовать другую уже существующую Stripe webhook-ветку, где точный `re_*` известен.

---

## **6. Уведомлять только после подтверждённого бизнес-результата**

Для successful payment уведомление вызывается после того, как подтверждены:

```text
payments_v2 succeeded
orders_v2 paid
canonical payment/order relation
```

`grant-access-for-order` может корректно завершиться `default-deny` для продукта без клубного доступа. Это не должно блокировать админское уведомление об оплате.

Следовательно, критерий:

```text
платёж и заказ успешно зафиксированы
```

а не обязательное создание Telegram-access или entitlement.

Если `grant-access-for-order` завершился технической ошибкой, определить по существующей политике:

- уведомить об оплате с warning;
- либо не уведомлять до reconcile.

Это решение должно совпадать с bePaid parity.

---

## **7. Не передавать лишние персональные и карточные данные**

В `telegram-notify-admins` передавать только поля, которые реально используются существующим шаблоном.

Допустимо:

```text
имя клиента
product name
amount/currency
provider
masked card brand/last4
order number
```

Запрещено:

```text
полный PAN
email, если он не нужен шаблону
телефон
billing_details целиком
Stripe customer object
payment method object
raw webhook payload
client_secret
receipt URL с query
```

`provider_payment_id` в Telegram при необходимости показывать только маскированно либо хранить внутри технической metadata, не в основном сообщении.

---

## **8. Вызов должен быть non-blocking, но контролируемым**

Не использовать бесконтрольный fire-and-forget, который Edge runtime может завершить до отправки запроса.

Использовать тот же надёжный pattern, что применяется в bePaid:

- bounded timeout;
- `try/catch`;
- безопасный лог результата;
- ошибка Telegram не меняет HTTP-ответ Stripe;
- ошибка Telegram не откатывает payment lifecycle.

Если используется `await`, вызов должен иметь короткий timeout и не блокировать webhook надолго.

Если проект использует `EdgeRuntime.waitUntil`, переиспользовать канонический pattern.

---

## **9. Не дублировать код в трёх webhook-ветках**

Создать один локальный/shared helper, если подходящего уже нет:

```text
notifyAdminsAboutStripePayment(...)
```

или provider-agnostic:

```text
notifyAdminsAboutPaymentEvent(...)
```

Helper отвечает за:

- canonical DTO;
- idempotency key;
- timeout;
- safe logging;
- вызов `telegram-notify-admins`;
- sanitization.

Webhook-ветки только формируют доказанные бизнес-поля.

Не выполнять глобальный рефакторинг `stripe-webhook` или `bepaid-webhook`.

---

## **10. Scope событий**

В рамках патча реализовать только:

```text
payment_succeeded
refund_succeeded
recurring_charge_succeeded
```

Не добавлять автоматически:

- payment failed;
- invoice failed;
- dispute;
- cancellation;
- chargeback;
- access granted/revoked.

Их parity проверить в discovery и вынести в backlog, если действительно нужны.

---

## **11. Тесты до deploy**

Добавить минимум:

1. Разовая Stripe-оплата → одно уведомление.
2. `payment_intent.succeeded` + связанный `charge.succeeded` → одно уведомление.
3. Повторная доставка Stripe event → одно уведомление.
4. Первая subscription invoice не создаёт одновременно `payment_succeeded` и `recurring_charge`.
5. Последующая invoice → `recurring_charge`.
6. Полный refund → одно уведомление по `re_*`.
7. Частичный refund → правильная сумма.
8. Повторный refund event → без дубля.
9. Telegram endpoint 500 → webhook lifecycle остаётся успешным.
10. Telegram timeout → webhook lifecycle остаётся успешным.
11. Продукт без Telegram access rules → admin notify всё равно отправляется.
12. В payload отсутствуют forbidden card/Stripe fields.
13. bePaid код и поведение не изменены.
14. Никаких дополнительных записей в payments/orders/entitlements из notification helper.

---

## **12. Deploy safety**

Поскольку меняется критическая public webhook-функция:

```text
stripe-webhook
```

перед deploy выполнить controlled public webhook protocol:

1. Сохранить recovery source текущей версии.
2. Зафиксировать текущую deployed version.
3. Подтвердить:
4. Pre-deploy unsigned smoke:
  - endpoint доступен;
  - ответ — signature verification failure;
  - нет Supabase JWT-wall.
5. Deploy только:
  &nbsp;
  ```text
  stripe-webhook
  ```
  и shared helper, входящий в его bundle.
6. Post-deploy smoke на t=0, t=30s, t=2m:
  - endpoint публично доступен;
  - Stripe signature guard работает;
  - `verify_jwt=false` сохранён.
7. `bepaid-webhook` не передеплоивать.

Если агентский deploy меняет JWT-доступность:

```text
STOP
PUBLIC_WEBHOOK_DEPLOY_REGRESSION
```

и восстановить recovery version.

---

## **13. Runtime proof**

Не требовать нового реального платежа 7 BYN специально ради теста.

Допустимые варианты:

### **Предпочтительно**

Безопасная test-mode Stripe fixture с подписанными событиями:

```text
payment succeeded
recurring invoice
refund
```

### **Если test-mode больше не используется**

- replay существующего provider event только через доказанно idempotent processing path;
- либо integration proof с реальным signed Stripe fixture без создания нового заказа/доступа;
- первый будущий реальный платёж — `DEFERRED_OPERATIONAL_UAT`.

Нельзя повторно обработать существующий event так, чтобы создать:

- второй payment;
- второй order;
- повторное продление;
- повторный entitlement;
- повторный CRM stage.

---

## **14. Runtime DoD**

Для каждого доступного сценария подтвердить:

```text
одно Telegram admin notification
один idempotency key
actor/source = stripe webhook/system
payment/order lifecycle delta ожидаемый либо 0 при replay
0 дублей AGL
0 повторных CRM actions
0 повторной генерации документа
0 Telegram client-access изменений
```

Лог должен подтверждать вызов helper, но не обязательно содержать точную строку:

```text
[telegram-notify-admins] Starting notification
```

Использовать фактические безопасные log markers проекта.

---

## **15. Audit и SYSTEM ACTOR**

Если `telegram-notify-admins` или очередь создаёт audit:

```text
actor_type = system
actor_user_id = NULL
actor_label = stripe-webhook
source_event_id/provider_object_id заполнен
```

Если audit для admin-notify архитектурой не предусмотрен:

```text
SYSTEM ACTOR = NOT APPLICABLE
```

с доказательством фактического существующего контракта.

Не создавать фиктивный audit только ради proof.

---

## **16. Уточнённый итоговый DoD**

Патч закрывается как PASS, если:

1. Канонический trigger разовой оплаты выбран.
2. Нет дублей между `payment_intent.succeeded`, `charge.succeeded` и `checkout.session.completed`.
3. Recurring notification не дублирует первую оплату.
4. Refund привязан к точному `re_*`.
5. Все уведомления идемпотентны.
6. Ошибка Telegram не влияет на Stripe webhook response.
7. Продукты без Telegram access rules всё равно создают admin payment notification.
8. Payload безопасен.
9. bePaid не изменён и не передеплоен.
10. `stripe-webhook` controlled deploy PASS.
11. Public endpoint после deploy не получил JWT-wall.
12. Tests PASS.
13. Доступные runtime-сценарии PASS.
14. Отсутствующий первый реальный сценарий оформлен как `DEFERRED_OPERATIONAL_UAT`, а не как новый открытый спринт.
15. Grant/access/AGL/orders/payments/CRM/documents regression отсутствует.

## **Итоговый scope**

Разрешено изменить только:

```text
supabase/functions/stripe-webhook/index.ts
существующий shared notification helper
либо один новый узкий shared helper
tests
proof
```

Запрещено изменять:

```text
bepaid-webhook
telegram access functions
grant-access-for-order
document generation
CRM lifecycle
payments/orders schema
RLS
```

После выполнения вернуть:

```text
Отчёт о выполненной работе:
PATCH-STRIPE-TELEGRAM-ADMIN-NOTIFY-PARITY-V1
```

Следующие Stripe-патчи автоматически не начинать.

&nbsp;

План: Аудит Stripe-платежа pi_3ThrF46UYJj2vm0G13OzIbVS и парити Telegram-уведомлений с bePaid

## Diagnose — что проверено по реальному платежу

Платёж: 7.00 BYN, Stripe, VISA ****3587, Сергей Федорчук, продукт «Платная консультация / Несрочная консультация», order_id `f230633f-30b9-441e-8433-5dab8b073471`.

### Что работает корректно (PASS)

1. **payments_v2** — запись создана: `status=succeeded`, `paid_at=13:05:01`, `receipt_url` от Stripe сохранён, `card_brand=visa`, `card_last4=3587`. PASS.
2. **orders_v2** — `status=paid`, `provider_payment_id=pi_3ThrF...`, `final_price=7.00 BYN`. PASS.
3. **grant-access-for-order** — отработал по канону: AGL запись `action_type=extend`, `reason_code=paid_order`, `source_event_key=gafo:webhook:f230633f...`, `source_window_rule=tariff_duration`, `window_days=30`. Подписка `0ea21015-...` продлена с 2026-07-10 до 2026-08-09 (tariffMatch + sbsMatch). Entitlement `44caec9c-...` обновлён. PASS.
4. **CRM** — `crm_stage_applied_success` сработал дважды (success-stage воронки «Платная консультация»). PASS.
5. **Документы** — `document_data.snapshot_created` в 13:05:15, в orders_v2.meta.document_data 97 типизированных b97-полей + executor + scenario `e28a9ea1-...` (payer=individual, channel=card), template `7caee05d-...`. В UI на скриншоте зелёная иконка «документ готов». PASS.
6. **Возврат денег** — Stripe-канал поддерживается каноническим путём `record_refund_atomic` (RPC) + UI кнопка возврата в /admin/payments. Видны успешные возвраты (Julia Gr -100 BYN bePaid). Для Stripe refund-кнопка использует тот же RPC через `stripe-refund` функцию. PASS (требуется реальный смок-возврат вне аудита).
7. **Public checkout link** — `system.payment_link.created` → `public_checkout.created` → `public_checkout.link_consumed`. Lifecycle чистый. PASS.

### Что НЕ работает (FAIL — корневая причина найдена)

**Telegram-уведомление админам о платеже отсутствует.**

Корень: `supabase/functions/bepaid-webhook/index.ts` вызывает `telegram-notify-admins` в 8 точках (charge.succeed, refund, recurring и т.д.). `supabase/functions/stripe-webhook/index.ts` — **0 вызовов** `telegram-notify-admins`. Это разрыв webhook parity. По мемори [bePaid Webhook Parity](mem://architecture/subscriptions/bepaid-webhook-parity-standard) Stripe должен делать те же операции, что и bePaid.

Доказательство в логах:

- `[telegram-process-access-queue] No pending items` — очередь пуста, потому что у продукта «Платная консультация» обе `access_rules` (club / product_access) `is_active=false` (отключены 2026-05-22, by-design — продукт не клубный, без TG-club).
- В `pending_telegram_notifications` для user `05cd3754-...` после 12:50 — 0 записей.
- Поток `grant-access → telegram-grant-access` корректно отработал `pending_downstream` → `[grant-access] No club rule found ... default-deny`. PASS (это правильное поведение — у консультаций нет TG-клуба).

Итого: уведомления в TG-клуб клиенту по продукту правильно не отправлены (продукт без клуба). Но **админское уведомление «прошла оплата 7 BYN, продукт X»** не отправлено, потому что stripe-webhook не зовёт `telegram-notify-admins`.

## Plan — что сделать (одно небольшое изменение)

Добавить в `supabase/functions/stripe-webhook/index.ts` вызов `telegram-notify-admins` с parity-полями относительно bePaid:

1. После успешной обработки события `payment_intent.succeeded` / `charge.succeeded` (после того как `grant-access-for-order` отработал успешно) — выполнить fire-and-forget вызов:
  ```ts
   await fetch(`${supabaseUrl}/functions/v1/telegram-notify-admins`, {
     method: 'POST',
     headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
     body: JSON.stringify({
       source: 'stripe_webhook',
       event_type: 'payment_succeeded',
       order_id, order_number,
       user_id, profile_id,
       product_id, product_name,
       amount, currency,
       provider: 'stripe',
       provider_payment_id,
       card_brand, card_last4,
       paid_at,
     }),
   }).catch(err => console.error('[stripe-webhook] notify-admins failed:', err));
  ```
2. Аналогично — для `charge.refunded` (parity с bePaid refund-уведомлением).
3. Для `invoice.paid` (recurring) — отдельное уведомление с `event_type='recurring_charge'`.

Все три точки заворачиваются в try/catch так же, как в bePaid (никогда не блокируют ответ Stripe).

## Verify (DoD)

1. После деплоя — повторный реальный Stripe-платёж (или test-mode) → в админ-чате Telegram появляется сообщение «Stripe • 7.00 BYN • Платная консультация • Сергей Федорчук».
2. Возврат через Stripe → в админ-чате сообщение о refund.
3. Логи `stripe-webhook` содержат строки `[telegram-notify-admins] Starting notification, source=stripe_webhook`.
4. Никаких регрессий в grant-access / AGL / orders_v2 / CRM.

## Backlog (не входит в этот патч)

- Per-user TG-DM по факту оплаты (если когда-нибудь захочется) — отдельный модуль, не относится к админскому notify.
- Smoke-возврат реальных 7 BYN через Stripe Dashboard / админ-UI — выполнит владелец после фикса.
- Продукт «Платная консультация» намеренно без TG-клуба — никаких access-rule изменений не требуется.

## Технический раздел (для разработчика)

Файл: `supabase/functions/stripe-webhook/index.ts`
Точки вставки:

- ветка `payment_intent.succeeded` (после `grant-access-for-order` invoke)
- ветка `charge.refunded` (после `record_refund_atomic` RPC)
- ветка `invoice.paid` (после продления subscription)

Параметры берутся из локальных переменных, уже доступных в ветках (order, payment, product), без дополнительных DB-запросов. Деплой: только одна функция `stripe-webhook`.