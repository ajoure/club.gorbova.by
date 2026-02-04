План исправлений: bePaid Provider-Managed Subscriptions (✅ IMPLEMENTED)

Статус: ВСЕ ПАТЧИ ВЫПОЛНЕНЫ (2026-02-04)

1. BLOCKER: Все subscription webhooks падают с invalid_signature

Факты из БД:
	•	Найдены orphaned webhooks: sbs_719b3c5c9ebba327, sbs_ff186eb3d76a6827, sbs_2deb6ff0833038f7
	•	reason = 'invalid_signature'
	•	Tracking ID: subv2:0798ceb0-9ff8-4cdf-ad8f-b2548af902fc
	•	Подписки фактически оплачены, но в системе считаются неуспешными

Причина (по документации bePaid):
	1.	Подпись проверяется по RAW body
	2.	RSA-подпись (Content-Signature) — обязательна
	3.	Public key берётся из личного кабинета bePaid

Текущая проблема в коде (bepaid-webhook/index.ts):
	•	Используется захардкоженный BEPAID_PUBLIC_KEY
	•	Подпись проверяется не по raw body
	•	Возможна несовместимость формата ключа

Конфигурация bePaid (БД):

shop_id: 33524
secret_key: 51206ca1b40e6eb48cd4b112ab2040686da36b8aa2d4cd7b5f97be3b8e39a466
public_key: MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...


⸻

2. Критические проблемы в bepaid-create-subscription-checkout

Проблема	Описание
listUsers()	Загружает всех пользователей
ip: '127.0.0.1'	Некорректный IP
billing_type: 'mit'	Неверно для provider-managed
PII в логах	Утечки email / customer
raw_data = full response	Хранится card / customer


⸻

3. PaymentDialog блокирует provider-managed

if (paymentFlowType === 'provider_managed' && ... && !savedCard)

→ при наличии savedCard пользователь не видит выбор.

⸻

4. PaymentMethods UX
	•	Не объяснено, что такое bePaid-подписка
	•	Нет предупреждения про 30-дневный цикл
	•	Неясно, как менять карту

⸻

План исправлений

⸻

PATCH-1 (BLOCKER): bePaid webhook signature + subscriptions

Файл: supabase/functions/bepaid-webhook/index.ts

1.1 Подпись webhook (КРИТИЧНО)

Обязательные требования:
	•	Читать тело строго один раз:

const bodyText = await req.text(); // RAW BODY

	•	Проверка RSA-SHA256 только по raw body
	•	Убрать BEPAID_PUBLIC_KEY
	•	Использовать integration_instances.config.public_key
	•	Приводить ключ к PEM (BEGIN/END PUBLIC KEY)
	•	Никаких fallback’ов:
	•	❌ нельзя принимать webhook без подписи
	•	❌ нельзя подменять RSA BasicAuth’ом

Если verify=false → 401 + запись в provider_webhook_orphans

⸻

1.2 Обработка subscription webhook

Распознавание: id = sbs_*, state, plan, tracking_id

Парсинг tracking_id:

subv2:{subscription_v2_id}:order:{order_id}

Если не парсится → orphan bad_tracking_id

При state='active' и last_transaction.status='successful':
	•	orders_v2.status = 'paid'
	•	subscriptions_v2.status = 'active'
	•	subscriptions_v2.billing_type = 'provider_managed'
	•	provider_subscriptions.state = 'active'
	•	next_charge_at = renew_at
	•	Создать payments_v2
	•	Выдать entitlements
	•	Отправить уведомления (email + TG)

При state='canceled':
	•	provider_subscriptions.state = 'canceled'
	•	subscriptions_v2.auto_renew = false
	•	Доступ не отзываем ретроактивно

Идемпотентность
	•	Дедуп по last_transaction.uid
	•	Повторный webhook не создаёт дубликаты

⸻

1.3 SYSTEM ACTOR Proof (обязательно)

Создать audit_logs:
	•	actor_type = 'system'
	•	actor_user_id = NULL
	•	actor_label = 'bepaid-webhook'
	•	action = 'bepaid.subscription.processed'
	•	meta: {subscription_v2_id, order_id, provider_subscription_id, event, state, last_tx_uid}

⸻

DoD PATCH-1
	•	Новые webhooks не попадают в provider_webhook_orphans
	•	orders_v2.status='paid'
	•	payments_v2 создан
	•	provider_subscriptions.state='active'
	•	Есть audit_logs SYSTEM ACTOR
	•	Уведомления отправлены

⸻

PATCH-2: bepaid-create-subscription-checkout

Файл: supabase/functions/bepaid-create-subscription-checkout/index.ts
	1.	Убрать listUsers()

from('profiles').select('user_id').ilike('email', customerEmail).maybeSingle()

	2.	IP:

	•	Убрать 127.0.0.1
	•	Или взять из x-forwarded-for

	3.	billing_type = 'provider_managed'
	4.	Логи без PII
	5.	raw_data → safe subset:

{ subscription_id, state, created_at, has_checkout_url, last_tx_uid }


⸻

PATCH-3: PaymentDialog

Файл: src/components/payment/PaymentDialog.tsx

// было
if (paymentFlowType === 'provider_managed' && ... && !savedCard)

// стало
if (paymentFlowType === 'provider_managed' && isSubscription && !isTrial)

UI:

{isSubscription && !isTrial && ( ... )}


⸻

PATCH-4: PaymentMethods UX

Файл: src/pages/settings/PaymentMethods.tsx
	•	Ясно разделить:
	•	MIT карты — гибкие списания
	•	bePaid подписки — каждые 30 дней
	•	Предупреждение о смещении дат
	•	Показ продукта + тарифа
	•	Tooltip “Изменить карту”:
Фактически создаётся новая подписка, остаток переносится

⸻

SQL-пруфы (обязательны)

select * from provider_webhook_orphans where reason='invalid_signature';

select id, state, next_charge_at
from provider_subscriptions
order by created_at desc;

select id, status
from orders_v2
where meta->>'payment_flow'='provider_managed_checkout';

select * from audit_logs
where actor_type='system' and actor_label='bepaid-webhook';


⸻

Порядок выполнения
	1.	PATCH-1 (BLOCKER)
	2.	PATCH-2
	3.	PATCH-3
	4.	PATCH-4

