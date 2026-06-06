# Да, согласен.

Этот план как раз возвращает вас к главному вопросу:

Работает ли Stripe для клиента от начала до конца?

После нескольких недель работы вы накопили много инфраструктурных гипотез, но пока не получили самый важный ответ:

- создаётся ли Checkout;
- проходит ли оплата;
- приходит ли webhook;
- создаётся ли подписка;
- выдаётся ли доступ;
- открывается ли Portal.

Из того, что я вижу, сейчас нельзя делать новые планы по GitHub, Lovable Cloud, deploy-модели или support, пока не будет завершён этот аудит.

Единственное дополнение к плану:

### **Добавить D3.1 — последнюю успешную реальную Stripe-транзакцию**

Перед S1–S7 подрядчик должен отдельно ответить:

- какая последняя Stripe-оплата успешно прошла через систему;
- дата/время;
- `checkout.session.completed`;
- `invoice.paid`;
- создан ли `orders_v2`;
- создан ли `payments_v2`;
- выдан ли доступ.

Если такая транзакция была уже после последних изменений Stripe Phase 3.2–3.3, то это очень сильное доказательство того, что система в целом жива и проблема может быть локальной.

### **Добавить правило для итогового отчёта**

В конце отчёта обязателен блок:

```text
Главный вывод

Может ли новый клиент сегодня:

1. открыть Stripe Checkout
2. оплатить картой
3. получить подписку
4. получить доступ
5. открыть Customer Portal

Ответ: ДА / НЕТ

Если НЕТ:
точка отказа = Sx
минимальный фикс = ...
```

Без этого блок считается незавершённым.

Во всём остальном план правильный. Сейчас не нужно ничего деплоить, ничего переписывать и ничего отправлять в поддержку. Сначала нужно получить факт:

**Stripe реально работает или не работает для клиента прямо сейчас.** Это и должен показать Phase 3.4-RT.

&nbsp;

План: Stripe End-to-End Runtime Audit (Phase 3.4-RT)

## Контекст и позиция

Инфраструктурная ветка (GitHub workflows, Lovable deploy model, verify_jwt regression) **замораживается** на текущем состоянии:

- `Infrastructure model = CLEAN`
- `GitHub deploy = DISABLED`
- `Lovable webhook deploy = BLOCKED-BY-PLATFORM` (issue составлен, ждёт оператора)
- Stripe Phase 3.4 Runtime = **снимается с FROZEN и переводится в RT-AUDIT**

Главный вопрос, на который план обязан ответить ровно одним словом PASS/FAIL по каждому шагу:

> **Может ли клиент сейчас открыть Stripe checkout, оплатить тестовой картой, получить подписку, получить доступ и открыть Customer Portal?**

Никаких новых deploy, никаких redeploy webhook, никакой работы по GitHub/CI до завершения этого аудита.

## Запрещено в рамках этого плана

- `supabase--deploy_edge_functions` для любых `*-webhook` (мораторий из §8 canonical_infrastructure_v1).
- Любые правки `.github/workflows/*`.
- Любые правки кода `stripe-webhook`, `bepaid-webhook`, `grant-access-for-order`, `subscriptions_v2`-резолверов.
- Любые миграции, RLS, access_rules, entitlements.
- Любые попытки «починить» `verify_jwt=false` руками агента.
- Любые шаги Phase 3.4 G33–G40 (replay, dunning runtime) до зелёного RT-аудита.

Разрешены только: чтение БД, чтение логов edge functions, `curl` на public endpoints, чтение исходников, документация результата.

## D — Diagnose (read-only inventory)

**D1. Карта Stripe-сценария в коде.** По репо собрать фактический список endpoints/функций, через которые проходит клиент Stripe:

- создание checkout (frontend entry + edge function);
- callback/return URL;
- webhook endpoint(s) — public URL и имена функций;
- материализация `orders_v2` + `subscriptions_v2`;
- вызов `grant-access-for-order`;
- открытие Customer Portal (`stripe-create-customer-portal-session`).

Источник правды: `supabase/functions/`, `supabase/functions.registry.txt`, `src/` (Stripe вызовы), `.lovable/discovery/stripe_*`.

**D2. Текущее состояние webhook (runtime snapshot, без deploy).** Один проход `curl OPTIONS + POST(no sig)` по production URL каждого Stripe-relevant webhook. Фиксируем body. Маркер `UNAUTHORIZED_NO_AUTH_HEADER` ⇒ platform-401, иначе ⇒ долетает до бизнес-логики.

**D3. Состояние SOT-таблиц по последним Stripe-операциям.** `read_query` по:

- `provider_events` где provider='stripe' за последние 14 дней (счётчик по типам, последние 20 строк);
- `orders_v2` с meta->>'provider'='stripe' за тот же период;
- `subscriptions_v2` с meta->>'provider'='stripe' (status, period_end, last_event_at);
- `entitlements` для тех же `user_id` (есть ли реально выданный доступ);
- `audit_logs` с action ILIKE 'stripe%' или 'grant_access%' для тех же order_id.

Нужен ответ: «последняя реально дошедшая до БД Stripe-оплата — когда, и был ли по ней выдан доступ».

**D4. Логи edge functions за период.** `supabase--edge_function_logs` для: `stripe-webhook`, `grant-access-for-order`, `stripe-create-customer-portal-session`, `subscriptions-reconcile` (Stripe-ветки), `public-checkout` (если используется для Stripe). Ищем последние успешные и последние ошибочные вызовы, маркер регрессии.

**D5. Конфигурация Stripe account_code(s).** Через `read_query` подтянуть активные acquiring-аккаунты, наличие `STRIPE_SECRET_KEY*` и `STRIPE_WEBHOOK_SECRET*` в secrets (через `fetch_secrets`, только имена). Это нужно, чтобы знать, какой ключ использовать в E2E-тесте.

## P — Plan E2E прохода

E2E делится на 7 шагов; каждый имеет явный PASS/FAIL critereon и артефакт-доказательство.

```
Step  Действие                                   PASS-критерий                         Артефакт
S1    Создание Stripe Checkout Session            HTTP 200, url *.stripe.com/c/pay/    JSON ответа edge function
S2    Frontend получает checkout url              UI редиректит/открывает url          network log / ручной checkout
S3    Оплата тестовой картой 4242…                Stripe Dashboard: payment succeeded  Stripe test-mode event id
S4    Webhook доставлен                           provider_events row с event_id       SQL snapshot
S5    Материализация order/subscription           orders_v2 row + subscriptions_v2 row SQL snapshot + meta.stripe
S6    Выдача доступа                              entitlements строка с корректным    SQL snapshot + audit_logs
                                                  access_end_at; audit grant_access
S7    Customer Portal session                     stripe-create-customer-portal-       JSON ответа edge function
                                                  session возвращает url
```

Метод проведения:

- **S1, S7** — `supabase--curl_edge_functions` на соответствующие функции с тестовым `account_code`, реальным `tariff_id`/`customer_id` из D3 (берём подписку, которая уже существует, чтобы не плодить мусор).
- **S2** — browser viewing preview (только если S1 PASS и URL получен).
- **S3** — выполняет оператор в Stripe Checkout (тест-карта), агент только мониторит.
- **S4–S6** — `read_query` после S3 (polling с интервалом 5s × 6 попыток).
- **S7** — `supabase--curl_edge_functions` на существующего клиента из D3.

Если S4 FAIL и body webhook = `UNAUTHORIZED_NO_AUTH_HEADER` ⇒ зафиксировать как уже известный платформенный блокер, **не пытаться лечить redeploy'ем**. Если body иной (например 500/400 на бизнес-логике) — это новая находка, идёт в FAIL-точку.

## DR — Dry run

Перед E2E:

1. Подтвердить через `supabase--cloud_status` что backend `ACTIVE_HEALTHY`.
2. Подтвердить через D2, что НИ ОДИН webhook не находится в неожиданном platform-401 (кроме уже известного `stripe-webhook`, если он там).
3. Подтвердить через D5, что для выбранного `account_code` есть рабочий `STRIPE_SECRET_KEY` (по факту вызова `stripe-create-customer-portal-session` на известного клиента — он либо вернёт url, либо явную Stripe-ошибку).
4. Выбрать конкретный `tariff_id` и `customer_id` (или email для нового клиента) для E2E. Зафиксировать в proof.

## E — Execute

E

1. Выполнить D1–D5, сохранить в `.lovable/discovery/stripe_runtime_audit_v1.md`.

E

2. Выполнить DR, сохранить там же блоком «Dry run».

E

3. Выполнить S1.

E

4. Выполнить S7 (независимо от S1, проверяет существующую подписку).

E

5. Запросить у оператора реальный прогон S2–S3 (оплата тестовой картой), агент мониторит S4–S6 в реальном времени через `read_query` + `edge_function_logs`.

E

6. Свести результаты в `.lovable/proofs/stripe_runtime_audit_v1.md` в виде таблицы S1–S7 с PASS/FAIL и ссылками на артефакты.

E

7. Для каждого FAIL — отдельный раздел «Точка отказа + минимальный фикс» (без выполнения фикса в рамках этого плана; фикс уйдёт отдельным PATCH).

## V — Verify (Definition of Done)

- `.lovable/discovery/stripe_runtime_audit_v1.md` существует, содержит D1–D5 + DR.
- `.lovable/proofs/stripe_runtime_audit_v1.md` существует, содержит таблицу S1–S7 с PASS/FAIL и доказательствами.
- На главный вопрос «может ли клиент оплатить Stripe и получить доступ» дан однозначный ответ ДА/НЕТ.
- Если НЕТ — указана единственная точка отказа и предложен минимальный фикс (без его выполнения).
- Никаких `supabase--deploy_edge_functions` вызовов в логе сессии.
- Никаких правок `.github/workflows/*` и кода webhook-функций.
- Phase 3.4 статус обновлён: либо `RUNTIME-PASS` (если S1–S7 = PASS), либо `BLOCKED-AT-<step>` с указанным шагом.

## Открытые вопросы для оператора (нужны до E5)

1. **Stripe test-mode card flow:** готов ли оператор лично выполнить S2–S3 (открыть checkout url, оплатить картой 4242 4242 4242 4242), или нужен другой способ (например, использовать существующий test-mode subscription из истории и не платить заново)?
2. **Account scope:** прогонять E2E на одном `account_code` (укажите каком) или на всех активных Stripe-аккаунтах?
3. **Что считать «клиентом» для S7 (Portal):** реальный test-mode `customer_id` из БД, или агент должен сначала создать тестового customer через S1–S3?