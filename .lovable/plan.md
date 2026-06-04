# да, согласен, с учетом правок:

1. Добавить в Шаг 2 обязательную проверку не только `POST /v1/prices`, но и фиксацию:
  - `currency_options` отсутствует/не используется;
  - `tax_behavior`;
  - `billing_scheme`;
  - `type=recurring`.
  Это исключит ситуацию, когда Price создаётся, но не подходит для Subscription Checkout.
2. Добавить отдельный пункт в Шаг 3:


| **Probe** | **currency** | **recurring** | **Цель**                                |
| --------- | ------------ | ------------- | --------------------------------------- |
| P5        | byn          | year          | проверить ограничение interval-specific |


Если Stripe отклоняет только monthly recurring, а не recurring вообще, это нужно увидеть сразу.

3. В proof обязательно приложить:
  - `price.livemode`;
  - `product.livemode`;
  - `account.country`;
  - `account.id`.
  Секреты скрывать, идентификаторы аккаунта не скрывать.
4. В разделе «Вердикт» разделить выводы:

```text
BYN Price Capability
BYN Subscription Capability
BYN Checkout Capability
```

Это три разных утверждения.

Даже если recurring Price создаётся, это ещё не доказывает работоспособность Checkout Subscription.

5. После PASS по GAP-A не переходить сразу к MVP.

Сначала закрыть:

```text
GAP-B — billing_period_mode/days → interval resolver
```

Поскольку именно он сейчас является следующим архитектурным блокером после валюты.

Итог:

- План корректный.
- Логика проверки верная.
- Основная цель — получить фактический ответ Stripe API и убрать предположения про BYN.
- После PASS останутся GAP-B, GAP-C и GAP-D. MVP всё ещё не стартует до их закрытия.
- &nbsp;
- План: GAP-A Verification — BYN Recurring Capability Proof

## Цель

Подтвердить или опровергнуть фактическим ответом Stripe API утверждение из Phase 3.1.1: «Stripe Poland не поддерживает BYN для recurring subscriptions». Сейчас это утверждение — предположение, без технического доказательства. Ранее в проекте Stripe использовался с BYN, поэтому MVP не блокируется на основании предположения.

## Режим

- Только Discovery / read + один тестовый create в Stripe test mode.
- Никаких изменений кода приложения.
- Никаких миграций, никаких изменений UI.
- Никаких checkout, никаких subscription create, никаких webhook.
- bePaid не затронут.

## Предусловие

- Используется существующий `STRIPE_SECRET_KEY` (test mode) аккаунта `stripe_poland`. Если ключ test недоступен — остановиться и сообщить пользователю, не подменять live ключом.

## Шаг 1. Account capability snapshot (read-only)

Выполнить через Stripe API:

1. `GET /v1/account` — зафиксировать `country`, `default_currency`, `capabilities`.
2. `GET /v1/country_specs/PL` — зафиксировать `supported_payment_currencies`, `supported_payment_methods`.
3. `GET /v1/payment_method_configurations` — активные PM на аккаунте.

Сырые JSON-ответы (с маскированными секретами) сохранить в proof.

## Шаг 2. BYN Recurring Price probe (минимальный create в test mode)

Один технический вызов:

```
POST /v1/prices
  currency=byn
  unit_amount=100
  recurring[interval]=month
  product_data[name]=GAPA_BYN_PROBE_DO_NOT_USE
  metadata[purpose]=gap_a_byn_capability_proof
  metadata[do_not_use]=true
```

Требования:

- test mode (`livemode=false` в ответе обязательно проверить);
- Idempotency-Key: `gap-a-byn-probe-v1-<utc-date>`;
- никакого checkout/subscription поверх этого Price не создавать;
- если Price создался — сразу `POST /v1/prices/{id}` с `active=false` (архивирование), product оставить как есть (Stripe Product иммутабелен для удаления через API в нужных кейсах — допускается оставить с `metadata.do_not_use=true`).

Фиксируем для proof:

- полный request (тело, заголовки без секретов);
- HTTP status;
- полный response body;
- `error.code`, `error.type`, `error.param`, `error.message` (если ошибка);
- `livemode`, `id`, `currency`, `recurring` (если успех).

## Шаг 3. Контрольная проверка интерпретации ошибки

Если Шаг 2 вернул ошибку — выполнить дополнительные пробы, чтобы локализовать ограничение (каждая — отдельный API call, всё в test mode, всё с `metadata.purpose=gap_a_byn_capability_proof`):


| Проба | Параметры                                          | Цель различить                          |
| ----- | -------------------------------------------------- | --------------------------------------- |
| P2    | currency=byn, **без** `recurring` (one-time Price) | BYN запрещён вообще vs только recurring |
| P3    | currency=eur, `recurring[interval]=month`          | recurring работает на аккаунте vs нет   |
| P4    | currency=pln, `recurring[interval]=month`          | settlement-валюта recurring работает    |


Каждую успешно созданную Price немедленно `active=false`.

Результат — таблица:


| Probe | currency | recurring | HTTP | result | error.code |
| ----- | -------- | --------- | ---- | ------ | ---------- |


## Шаг 4. Вердикт

- **Вариант A (PASS)** — Шаг 2 вернул 200 и валидный `price_*` с `currency=byn`, `recurring.interval=month`, `livemode=false`: GAP-A закрыт, BYN остаётся валютой пилота, MVP по валютному вопросу разблокирован.
- **Вариант B (FAIL)** — Шаг 2 вернул ошибку: зафиксировать точный `error.code`/`error.message` и по таблице Шага 3 определить scope ограничения (аккаунт / валюта / только recurring / только Checkout). Только после этого допустимо ставить вопрос о смене валюты пилота — отдельным mini-plan, не в рамках этого discovery.

## Шаг 5. Proof artefact

Создать `.lovable/proofs/stripe_phase_3_1_1_gap_a_byn_capability_proof_v1.md` со структурой:

1. Гипотеза (цитата из Phase 3.1.1).
2. Метод проверки (Шаги 1–3, режим test).
3. Account snapshot (Шаг 1, сырые JSON, секреты замаскированы).
4. Stripe requests/responses (Шаг 2 + Шаг 3 при необходимости).
5. Таблица проб.
6. Вердикт PASS / FAIL с обоснованием на основе ответа API, а не предположений.
7. Влияние на MVP и на оставшиеся GAP B/C/D.
8. Cleanup-лог (какие Price переведены в `active=false`).

Обновить `.lovable/plan.md`: статус GAP-A — `verified_pass` либо `verified_fail (<error.code>)`, со ссылкой на proof.

## STOP-GATE

До получения фактического ответа Stripe API запрещено:

- менять валюту пилотного тарифа;
- переводить пилот в PLN/EUR/USD;
- считать GAP-A доказанным в любую сторону;
- блокировать MVP по причине BYN.

Если Шаг 2 = PASS — остаются только GAP-B (mapping days → interval), GAP-C (provisioning Product/Price для реального пилотного оффера), GAP-D (runtime proof).

## DoD

- Account snapshot зафиксирован.
- Выполнен явный `POST /v1/prices` с `currency=byn, recurring[interval]=month` в test mode.
- Полный request + полный response + HTTP status + error.* приложены в proof.
- При FAIL — выполнены контрольные пробы P2/P3/P4 и интерпретация scope ограничения.
- Все созданные за время проверки Price переведены в `active=false`.
- Никаких изменений в коде приложения, миграциях, bePaid, webhook, UI.
- `.lovable/plan.md` обновлён, GAP-A имеет вердикт на основании API, а не предположений.