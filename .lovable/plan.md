# да, согласен, с учетом правок:

## 1. Этим этапом нельзя закрыть весь Sprint C2

После PASS можно закрыть только:

```text
Sprint C2 — Этап D: VERIFIED, PASS

```

Общий статус `Sprint C2: VERIFIED, PASS` возможен только после завершения и проверки Этапов B, C, E и F:

- самостоятельные основания доступа и revoke/recalculation;
- повторные заявки с разными данными;
- CRM contact/deal lifecycle;
- универсальная кнопка на другом продукте.

Исправить итоговую метку DoD.

## 2. Исправить ожидание по `commission_history`

При первом заполнении комиссии:

```text
commission отсутствует → commission записана

```

`commission_history` не должна обязательно получать запись. История нужна при **замене уже существовавшего значения**.

Ожидаемая последовательность:

1. Первое значение → `updated`, актуальная `meta.commission`, history пустая или отсутствует.
2. То же значение → `unchanged`, history не растёт.
3. Другое значение → старое значение добавляется в history, актуальное заменяется.

Не считать отсутствие history после первого enrichment ошибкой.

## 3. Failure isolation — не менять secrets и endpoint

Запрещено временно:

- портить `test_password` или `secret_key`;
- менять общий RR endpoint;
- затрагивать integration instance, который может использоваться другими запросами.

Использовать существующий изолированный test-only механизм. Если его нет, не добавлять новый механизм только ради этой проверки без отдельного плана.

Допустимый вариант без изменения кода:

- вызвать canonical helper после недоступного/пустого status-result;
- либо использовать заведомо отсутствующий test-order в отдельном admin-only вызове;
- подтвердить по уже реализованной обработке, что exception после promotion не меняет paid/access.

Если физически воспроизвести сбой безопасно невозможно, зафиксировать `NOT REPRODUCED`, но проверить код и успешный последующий retry. Это не должно блокировать остальные runtime-тесты.

## 4. Новый заказ должен быть действительно новым

Не использовать существующий профиль с уже активным entitlement, если это мешает увидеть фактический срок новой покупки.

Предпочтительно:

- отдельный тестовый пользователь;
- либо другой тестовый продукт/профиль без действующего доступа.

Если используется прежний пользователь, отдельно проверить созданный `entitlement_source` конкретного нового заказа, а не только агрегированный `entitlements.expires_at`.

## 5. Проверять canonical таблицу уведомлений

Использовать фактическую таблицу проекта:

```text
order_notification_deliveries

```

Не писать `notification_outbox`, если такой таблицы в этом flow нет.

Проверить:

- одна email delivery;
- одна Telegram delivery либо явный `skipped`;
- после повторного webhook количество не увеличилось.

## 6. Комиссию брать только из фактического RR status

`rr-admin-deliver-test-webhook` создаёт synthetic authorized webhook, но комиссия должна поступить именно из ответа `rrGetOrderStatus`.

Если test API для созданного заказа не возвращает status/commission, не подставлять значение вручную ради PASS:

```text
commission = unavailable

```

Helper можно отдельно проверить контролируемым вызовом, но это будет unit/runtime proof helper, а не доказательство фактической комиссии РР.

## 7. Legacy enrichment — stop-on-failure

После PASS pilot `ORD-26-00300` последовательно проверить 296 → 297 → 298.

Остановиться, если:

- изменились amount/currency;
- появился второй payment;
- helper обновил не тот заказ;
- status API вернул противоречивую валюту;
- произошла ошибка, способная затронуть остальные строки.

`unavailable` для конкретного старого заказа не является failure и не требует записи нулевой комиссии.

## Правильный итоговый статус

После успешного выполнения этого плана:

```text
Sprint C2 Stage D: VERIFIED, PASS
Sprint C2 overall: IN PROGRESS

```

После этих правок план можно выполнять.

&nbsp;

План: Sprint C2 — Runtime-верификация D.1–D.3 на новом RR-заказе, затем D.4 pilot

## Порядок

```text
новый RR test-order
  → runtime D.1–D.3 (структура payment)
  → commission enrichment (успех)
  → повтор webhook (идемпотентность)
  → failure isolation (сбой rrGetOrderStatus)
  → D.4 pilot (ORD-26-00300)
  → backfill остальных трёх legacy payments
  → компактный отчёт
```

Никаких новых миграций и правок кода на этом шаге не планируется — все структурные фиксы уже применены в D.1–D.3. Только runtime observations + один вызов `rr_update_payment_financials` на pilot.

---

## Шаг 1. Новый RR test-order (D.1–D.3 runtime)

1. Через публичный RR flow в `mode=test` инициировать новый заказ (реальным профилем или через `LeadRequestDialog` с test-tariff).
2. Зафиксировать `order_id`, `initiation_status`, отсутствие `payments_v2` до webhook.
3. Выполнить `rr-admin-deliver-test-webhook` (test-only guards уже проверены в предыдущем спринте).
4. Проверить в БД по order_id:


| Инвариант                        | Ожидание                 |
| -------------------------------- | ------------------------ |
| `orders_v2.status`               | `paid`                   |
| `payments_v2` count              | ровно 1                  |
| `provider_payment_id`            | `NULL`                   |
| `meta.rr.external_reference`     | `= orders_v2.id`         |
| `meta.rr.reference_semantics`    | `merchant_order_id_echo` |
| `meta.promotion.source`          | `rr-webhook`             |
| `meta.fulfillment.status`        | `completed`              |
| `entitlements`                   | доступ выдан             |
| `notification_outbox` / telegram | уведомления отправлены   |


## Шаг 2. Commission enrichment (тот же новый заказ)

### 2a. Успешный enrichment

- rr-webhook при успешном auth вызывает `rrGetOrderStatus` → `rr_update_payment_financials`.
- Проверить: `meta.commission.amount_minor`, `meta.commission.currency` заполнены, `commission_history` содержит 1 запись.
- Второй вызов helper с тем же значением → `status='unchanged'`, `commission_history` без роста, `payments_v2` count не изменился.

### 2b. Повторный webhook

- Повторно доставить тот же signed test webhook.
- Ожидание: `already_promoted`, `entitlements` не расширяются, `notification_outbox` не дублируется, `meta.commission` остаётся одной актуальной записью.

### 2c. Failure isolation (без ломки production secrets)

- Контролируемый test-mode сценарий: временно вернуть ошибку из `rrGetOrderStatus` (test-hook или временно неверный test-endpoint в secret, только для одного вызова).
- Ожидание:
  - webhook возвращает 200;
  - `orders_v2.status='paid'`, `payments_v2` создан, access/notifications выданы;
  - `meta.commission` отсутствует ИЛИ помечен диагностическим `unavailable`-состоянием (без записи `0`);
  - последующий успешный вызов enrichment позже дозаполняет commission через `rr_update_payment_financials` (status `updated`).

Точный механизм имитации ошибки согласую перед выполнением, чтобы не задеть production secrets.

## Шаг 3. D.4 pilot — ORD-26-00300

Только если Шаги 1–2 PASS.

1. Получить RR status для `external_reference` ORD-26-00300 через существующий helper.
2. Если commission доступна:
  - вызвать `rr_update_payment_financials` → `status='updated'`;
  - повторить с тем же значением → `status='unchanged'`;
  - подтвердить: `amount_minor`/`currency` неизменны, `payments_v2` count не изменился, `commission_history` содержит одну запись.
3. Если status недоступен:
  - зафиксировать `unavailable` в отчёте;
  - НЕ писать `0`;
  - не считать это регрессией D.1–D.3.

## Шаг 4. Backfill остальных трёх legacy payments

ORD-26-00296 / 297 / 298 — тем же helper-вызовом, идемпотентно. Каждый — отдельная строка в отчёте (updated / unchanged / unavailable).

## Отчёт

Компактный: новый order_id, payment_id, commission (или unavailable), результат повтора webhook, результат failure-isolation, D.4 pilot + 3 legacy строки. Без правок кода/миграций если все инварианты выполняются.

## DoD

- Новый RR payment имеет `provider_payment_id=NULL` и корректный `meta.rr.external_reference`.
- Commission enrichment idempotent (updated → unchanged).
- Повтор webhook = `already_promoted`, ноль дублей.
- Сбой status API не ломает paid/access/notifications.
- D.4 pilot прошёл или зафиксирован как `unavailable` без записи `0`.
- Legacy backfill завершён по всем 4 заказам.
- Итоговая метка спринта после полного PASS: **Sprint C2: VERIFIED, PASS**; до этого — **IMPLEMENTED, NOT VERIFIED**.