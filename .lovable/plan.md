да, согласен, с учетом правок:

План разумный и позволяет закончить Sprint C1 без реальной тестовой карты. Но результат нужно называть **контролируемым signed-webhook E2E**, а не реальным webhook от РР.

**Обязательные guards для**

**rr-admin-deliver-test-webhook**

Функция должна:

- verify_jwt=true;
- разрешать только admin/superadmin;
- работать только при integration_instances.provider='rr' AND mode='test';
- принимать только order_id, без произвольного payload/status;
- проверять:
  - orders_v2.provider='rr';
  - meta.flow='rr_installment';
  - заказ создан через test RR runtime;
  - заказ ещё не paid для первого запуска;
- формировать payload строго по фактическому контракту РР;
- разрешать только фиксированный тестовый статус authorized;
- вычислять подпись внутри функции из test secret_key;
- не возвращать и не логировать secret_key, полную подпись или персональные данные;
- писать audit: actor, order_id, mode=test, synthetic_delivery=true;
- не работать при mode='prod' ни при каких условиях.

**Bad-signature test**

Не добавлять публичный параметр вроде bad_signature=true.

Сделать отдельный жёстко ограниченный admin-action либо внутренний второй вызов, который:

- меняет один символ подписи;
- выполняется только в test mode;
- ожидает 401;
- подтверждает отсутствие любых изменений заказа, payment и доступа.

**Что этот тест доказывает**

Он подтверждает цепочку:

подписанный RR-format webhook

→ rr-notification

→ rr-webhook

→ promotion.source=rr-webhook

→ paid

→ payments_v2

→ grant-access

→ notifications

Он **не доказывает** сетевую доставку webhook непосредственно серверами РР. Но ранее реальный webhook РР уже приходил для ORD-26-00296/297/298, поэтому совокупного доказательства достаточно для Sprint C1.

**Порядок**

1. Создать нового тестового пользователя и RR test-order через public-rr-installment-initiate.
2. Убедиться, что заказ pending, provider=rr, mode=test.
3. Вызвать rr-admin-deliver-test-webhook.
4. Проверить:
  - paid;
  - ровно один payment;
  - правильный entitlement и срок;
  - email/Telegram;
  - promotion.source='rr-webhook';
  - fulfillment.status='completed'.
5. Повторить ту же доставку — ноль дублей.
6. Выполнить bad-signature — 401, ноль изменений.
7. Коротко проверить CRM-контракт renewal.

После успешного результата можно закрывать:

Sprint C1: VERIFIED, PASS

Саму test-helper функцию после проверки оставить admin-only и test-mode-only либо отключить флагом; она не должна стать универсальным способом вручную авторизовывать production-заказы.

&nbsp;

YСм. сообщение выше. Кратко: добавить admin-only edge `rr-admin-deliver-test-webhook` (verify_jwt=true, guards: admin + integration_instances.mode='test'), которая по `order_id` из `orders_v2` считает MD5-подпись из test secret_key и доставляет подписанный webhook в production `rr-notification`. Затем прогнать полный direct-webhook E2E на реально созданном через `public-rr-installment-initiate` заказе (без изменений в rr-webhook/promote/grant-access/CORS), проверить paid/1 payment/entitlement/notifications/promotion.source=rr-webhook/fulfillment=completed, идемпотентность повторной доставки, отклонение bad-signature. Отдельно короткая read-only проверка CRM-контракта для renewal. Финал — компактный фактический отчёт без новых .md.