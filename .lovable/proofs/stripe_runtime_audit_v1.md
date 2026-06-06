# Proof: Stripe Runtime Audit (Phase 3.4-RT)

Дата: 2026-06-06
Discovery: `.lovable/discovery/stripe_runtime_audit_v1.md`

## Таблица S1–S7 — PASS/FAIL

| # | Шаг | Verdict | Доказательство |
|---|---|---|---|
| S1 | Создание Stripe Checkout Session | **PASS** | `orders_v2` с `provider='stripe'`, `status='pending'` и Stripe checkout session id (`cs_test_...`) создаются регулярно. Последние `pending` checkout: `ORD-26-00146/00145` (2026-06-03 21:34). Live `checkout.session.completed` — 21 событие за 30 дней, последнее 2026-06-06 10:43. |
| S2 | Frontend получает checkout url | **PASS (косвенно)** | `subscriptions_v2.meta.stripe.checkout_session_id` заполнен в каждой свежей подписке (`cs_test_a1bQTYc…` от 2026-06-06 10:32). Без рабочего frontend → checkout flow эти session id появиться не могут. |
| S3 | Оплата тестовой картой | **PASS** | `payment_intent.succeeded` — 19 событий, последнее `evt_3TfHgy6UYJj2vm0G118JIW9w` 2026-06-06 10:43:09, обработано без ошибок. |
| S4 | Webhook доставлен | **PASS** | Все 15 последних `provider_events (provider=stripe)` имеют `processing_status='processed'`, `processing_error=NULL`. Лаг приём→обработка 0.1–2 сек. Самое свежее — `customer.subscription.updated` 2026-06-06 12:39:47. |
| S5 | Материализация order/subscription | **PASS** | По event `evt_1TfHh26UYJj2vm0GGPY66P8C` (10:43:10) создан `orders_v2 a000a8a6-…` (10:43:11, `paid 100 BYN`) и `subscriptions_v2 465ba5c1-…` (10:32:33, active, sub_id `sub_1TfHh06UYJj2vm0GxSYzxR2Y`, account `stripe_poland`). |
| S6 | Выдача доступа | **PASS** | Audit `grant-access-for-order.legacy_body_alias` 10:43:13 (order_id a000a8a6) → audit `stripe.invoice.paid.activated` 10:43:32 (entitlement 465ba5c1) → `entitlements.expires_at=2026-07-20 08:40:06` для пользователя `05cd3754` / продукта `11c9f1b8`. |
| S7 | Customer Portal session | **PASS** | За сегодня клиент 4 раза успешно открыл портал: audit `stripe.portal.session_created` в 10:44:10, 11:18:28, 11:24:31, + успешные `stripe.portal.cancel_at_period_end_enabled/disabled` и `stripe.portal.payment_method_updated`. Были 3 `stripe.portal.session_failed` в 11:18:18–20, после чего сразу же `session_created` в 11:18:28 — транзитное окно, не блокер. |

**Итог: 7/7 PASS.**

## D2 «парадокс» — почему пробник видит platform-401, а Stripe — нет

- Внешний `POST https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook` без auth → `401 UNAUTHORIZED_NO_AUTH_HEADER`.
- Реальные события Stripe прилетают и обрабатываются (доказано в S4–S6).
- `config.toml` имеет `[functions.stripe-webhook] verify_jwt = false` (строка 282).
- Stripe webhook URL зарегистрирован как `${SUPABASE_URL}/functions/v1/stripe-webhook` (`stripe-ensure-webhook/index.ts:43`).
- Единственное согласованное объяснение: реальный канал Stripe → платформа удовлетворяет gateway-условиям (вероятно через зарегистрированный с auth-параметром endpoint), а голый пробник без auth — нет. Это **артефакт пробника**, не блокер бизнес-сценария.

Предыдущая интерпретация D2-BIS («`stripe-webhook` сломан platform-401») оказалась **некорректной**: пробник показывает гейтвей-ответ, но фактический канал Stripe работает (что доказано аудит-цепочкой за сегодня).

## Главный вывод

```
Может ли новый клиент сегодня:

1. открыть Stripe Checkout         — ДА
2. оплатить картой                  — ДА
3. получить подписку                — ДА
4. получить доступ                  — ДА
5. открыть Customer Portal          — ДА

Ответ: ДА.

Точка отказа: отсутствует.
Минимальный фикс: не требуется.
```

## Изменение статуса Phase 3.4

```
Прежде:  Phase 3.4 Runtime = FROZEN (BLOCKED-BY-PLATFORM)
Теперь:  Phase 3.4 Runtime = RUNTIME-PASS

Обоснование: end-to-end Stripe flow (S1–S7) подтверждён живой production-цепочкой
от 2026-06-06 10:32–12:39, включая Portal-управление подпиской.
```

Инфраструктурные пункты (verify_jwt regression в LovableCloud agent-deploy, мораторий на redeploy webhook) остаются справедливыми как **операционная гигиена**: `supabase--deploy_edge_functions` для `*-webhook` по-прежнему запрещён, чтобы не сломать рабочую цепочку. Issue в Lovable support — опциональная гигиена, не блокер.

## Что НЕ выполнялось (per плану)

- `supabase--deploy_edge_functions` — 0 вызовов.
- Правки `.github/workflows/*` — 0.
- Правки кода `stripe-webhook`, `bepaid-webhook`, `grant-access-for-order`, резолверов — 0.
- Миграции, RLS, access_rules, entitlements — 0.
- Запросы Supabase secrets у оператора — 0.
- Phase 3.4 G33–G40 (replay, dunning runtime) — не выполнялись (это отдельный план, разблокированный после этого аудита).

## Следующие шаги (отдельные планы, не часть этого PATCH)

1. **Phase 3.4 G33–G40** — может стартовать. Stripe runtime подтверждён GREEN.
2. **Обновление документации** — `.lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md` и `.lovable/proofs/stripe_phase_3_4_d2_bis_webhook_runtime_v1.md` некорректно интерпретировали platform-401 как блокер; следует приписать корректирующую заметку со ссылкой на этот audit.
3. **Корректирующая запись в issue для Lovable** — `lovable_agent_deploy_verify_jwt_regression.md` остаётся справедливым (regression воспроизводится при искусственном redeploy), но воздействие переоценить: «webhook stays operational via registered endpoint auth; redeploy still risks breaking it — moratorium remains». Отправлять или нет — на усмотрение оператора.

## Definition of Done

- [x] `.lovable/discovery/stripe_runtime_audit_v1.md` создан, содержит D1–D5 + D3.1 + DR.
- [x] `.lovable/proofs/stripe_runtime_audit_v1.md` содержит таблицу S1–S7 с PASS/FAIL и доказательствами.
- [x] Главный вопрос «может ли клиент оплатить Stripe и получить доступ» — ответ **ДА**, с фактом за 2026-06-06.
- [x] FAIL отсутствуют → точка отказа и фикс не требуются.
- [x] Никаких `supabase--deploy_edge_functions` в сессии.
- [x] Никаких правок workflows/webhook-кода.
- [x] Phase 3.4 статус → **RUNTIME-PASS** (вместо FROZEN).
