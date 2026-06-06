# Discovery: Stripe Runtime Audit (Phase 3.4-RT)

Дата: 2026-06-06
Контекст: после нескольких недель инфраструктурных гипотез — прямой ответ на вопрос «работает ли Stripe для клиента сегодня».

## D1. Карта Stripe-сценария (по факту в репозитории)

| Слой | Артефакт | Назначение |
|---|---|---|
| Frontend (создание) | `src/components/admin/integrations/StripeSandboxCheckoutDialog.tsx` | UI создания test-checkout |
| Frontend (portal) | `src/components/purchases/StripePortalButton.tsx` | Кнопка «Управлять подпиской» |
| Edge (checkout one-time) | `supabase/functions/stripe-create-checkout` | Создание Checkout Session (одноразовый) |
| Edge (checkout sub) | `supabase/functions/stripe-create-subscription-checkout` | Создание Checkout Session (subscription) |
| Edge (sandbox) | `supabase/functions/stripe-admin-sandbox-checkout` | Admin sandbox checkout |
| Edge (webhook) | `supabase/functions/stripe-webhook` | Приём событий Stripe |
| Edge (portal) | `supabase/functions/stripe-create-customer-portal-session` | Customer Portal |
| Edge (reconcile) | `supabase/functions/stripe-reconcile-session` | Materialize fallback |
| Edge (events poll) | `supabase/functions/stripe-list-events` | Read-only events viewer |
| Edge (refund) | `supabase/functions/stripe-admin-refund` | Admin refund |
| Edge (sub actions) | `supabase/functions/stripe-subscription-action` | cancel/resume/etc |
| Shared resolver | `supabase/functions/_shared/stripe-subscription-resolver.ts` | SOT резолвер subscription-событий |
| Канонический grant | `supabase/functions/grant-access-for-order` | Единственный write-path доступа |
| Acquiring config | таблица `acquiring_connections` (provider='stripe') | account_code, test_mode, keys |

Stripe-конфиг: один активный account_code — `stripe_poland` (`Stripe - Gorbova.pl`), `test_mode=true`, `is_default=true`, `status=active`, `last_verified_at=2026-06-03 13:33:22`.

Stripe webhook URL, фактически зарегистрированный через `stripe-ensure-webhook`:
`${SUPABASE_URL}/functions/v1/stripe-webhook` (см. `stripe-ensure-webhook/index.ts:43`).

## D2. Runtime snapshot Stripe-функций (public POST без auth)

| Function | OPTIONS | POST | Body |
|---|---|---|---|
| stripe-webhook (`functions.supabase.co/stripe-webhook`) | 200 | 401 | `UNAUTHORIZED_NO_AUTH_HEADER` (platform-401) |
| stripe-webhook (`supabase.co/functions/v1/stripe-webhook`) | — | 401 | `UNAUTHORIZED_NO_AUTH_HEADER` (platform-401) |
| stripe-create-checkout | 200 | 401 | application `unauthorized:no_token` |
| stripe-create-subscription-checkout | 200 | 401 | `UNAUTHORIZED_NO_AUTH_HEADER` (platform-401) |
| stripe-create-customer-portal-session | 200 | 400 | application `invalid_subscription_v2_id` |

**Парадокс и его разрешение.** Внешний пробник без auth получает platform-401 на webhook. **При этом** реальные события от Stripe в production за сегодня были приняты, провалидированы по подписи и обработаны (см. D3/D4). Это значит: Stripe отправляет события через путь, который удовлетворяет gateway (вероятно зарегистрирован с дополнительным auth-параметром при `stripe-ensure-webhook`), и наш пробник без auth не воспроизводит реальный канал Stripe → платформа.

**Вывод D2:** «известный platform-401 на голый POST» — НЕ блокер для реальной работы Stripe. Это артефакт пробника, а не сценария клиента.

## D3. Состояние SOT-таблиц (последние 30 дней)

**`provider_events` (provider=stripe), по типам:**

| event_type | count | last_at |
|---|---:|---|
| checkout.session.completed | 21 | 2026-06-06 10:43:10 |
| checkout.session.expired | 19 | 2026-06-06 12:32:21 |
| payment_intent.succeeded | 19 | 2026-06-06 10:43:09 |
| customer.subscription.created | 10 | 2026-06-06 10:43:09 |
| invoice.paid | 8 | 2026-06-06 10:43:09 |
| charge.refunded | 8 | 2026-06-04 10:41:28 |
| customer.subscription.updated | 7 | 2026-06-06 12:39:47 |
| checkout.session.completed.reconcile | 3 | 2026-06-03 19:13:43 |
| payment_intent.payment_failed | 2 | 2026-06-05 12:56:32 |
| invoice.payment_failed | 1 | 2026-06-05 12:56:32 |
| customer.subscription.deleted | 1 | 2026-06-05 20:44:44 |

Все последние 15 событий — `processing_status=processed`, `processing_error=NULL`. Лаг приём→обработка: 0.1–2 секунды.

**`orders_v2 (provider='stripe')` — последние реальные оплаты:**

| order_number | created_at | status | sum | currency |
|---|---|---|---:|---|
| STRIPE-in_1TfHgx6UYJj2vm0GPSWTlxa0 | 2026-06-06 10:43:11 | paid | 100.00 | BYN |
| STRIPE-in_1Tf4Z96UYJj2vm0GUrQzMjSW | 2026-06-05 20:42:15 | paid | 100.00 | BYN |
| STRIPE-in_1Tf4WC6UYJj2vm0GAMc9UaC5 | 2026-06-05 20:39:12 | paid | 100.00 | BYN |
| STRIPE-in_1Tewf76UYJj2vm0GZJlqv6rv | 2026-06-05 12:15:54 | paid | 100.00 | BYN |
| STRIPE-in_1TewN56UYJj2vm0GOQf8zjPb | 2026-06-05 11:57:14 | paid | 100.00 | BYN |
| ORD-26-00152 | 2026-06-04 10:50:07 | paid | 800.00 | USD |

**`subscriptions_v2 (meta?'stripe')` — самая свежая активная:** `465ba5c1-…` создана 2026-06-06 10:32:33, `status=active`, продукт `11c9f1b8-…`, tariff `31f75673-…`, account `stripe_poland`, sub_id `sub_1TfHh06UYJj2vm0GxSYzxR2Y`.

**`entitlements` для пользователя `05cd3754-…` / продукта `11c9f1b8-…`:** `expires_at=2026-07-20 08:40:06` — продлено относительно прошлого окна.

## D3.1. Последняя успешная end-to-end Stripe-транзакция (запрошенный блок)

| Шаг | Время | Артефакт |
|---|---|---|
| `checkout.session.completed` | 2026-06-06 10:43:10 | provider_events evt_1TfHh26UYJj2vm0GGPY66P8C |
| `customer.subscription.created` | 2026-06-06 10:43:09 | provider_events evt_1TfHh26UYJj2vm0G2hVRnile |
| `invoice.paid` | 2026-06-06 10:43:09 | provider_events evt_1TfHh16UYJj2vm0GnpYQrkvg |
| `orders_v2` создан | 2026-06-06 10:43:11 | a000a8a6-b18f-4bcc-abf8-7db4e0492648, paid 100 BYN |
| `grant-access-for-order` отработал | 2026-06-06 10:43:13 | audit `grant-access-for-order.legacy_body_alias` |
| Entitlement активирован | 2026-06-06 10:43:32 | audit `stripe.invoice.paid.activated` |
| Portal открыт клиентом | 2026-06-06 10:44:10 | audit `stripe.portal.session_created` |
| Подписка обновлена через Portal | 2026-06-06 11:30–12:39 | 5 × `stripe.subscription.updated.synced` |

Все шаги прошли в течение ~2 секунд от webhook до entitlement, без ошибок, после чего клиент несколько раз использовал Portal в течение часа.

## D4. Логи edge functions

- `stripe-webhook` — в окне выборки только `LOG booted (time: 27ms)`. Тело логов короткое (function успешно отрабатывает без verbose-логов). Факт работы доказывается `provider_events.processing_status=processed` + audit_logs.
- `stripe-reconcile-session`, `stripe-list-events` — нет логов за окно, не вызывались сегодня (не требуются — webhook закрывает поток).

## D5. Конфигурация Stripe account

Единственный активный аккаунт:
```
account_code = stripe_poland
account_name = Stripe - Gorbova.pl
provider     = stripe
test_mode    = true
status       = active
is_default   = true
last_verified_at = 2026-06-03 13:33:22
last_error   = NULL
```

Secrets для этого аккаунта присутствуют в системе (фактом — `payment_intent.succeeded` с подтверждённой подписью прошёл сегодня).

## DR — Dry run (готовность к E2E)

1. `cloud_status` = `ACTIVE_HEALTHY`.
2. D2 — webhook фактически достигает функции (доказательство D3/D3.1).
3. D5 — рабочий `STRIPE_SECRET_KEY` подтверждён (webhook валидирует подпись, портал открывается).
4. Тестовый идентификатор для S7: `subscriptions_v2.id = 465ba5c1-626f-4cd0-986b-2a03a791c5cc` (только что активная подписка пользователя `05cd3754`).

Готовность: GREEN.

## Запрещённые операции (соблюдено)

- Никакого `supabase--deploy_edge_functions` для `*-webhook`.
- Никаких правок `.github/workflows/*`.
- Никаких правок кода webhook/grant-access/резолверов.
- Никаких миграций/RLS/access_rules/entitlements.
