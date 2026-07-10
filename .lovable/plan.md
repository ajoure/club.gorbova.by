да, согласен, с учетом правок:

## **1. Добавить защиту от конкурентного двойного создания заказа**

Текущая схема:

```txt
SELECT reusable pending order
→ если не найден — INSERT orders_v2
```

не защищает от двух одновременных запросов. Оба могут не увидеть заказ и создать по одной заявке РР.

До включения runtime нужен транзакционный guard. Предпочтительный вариант:

```txt
RPC rr_get_or_create_pending_order(...)
```

RPC должна в одной транзакции:

1. Получить advisory lock по нормализованному ключу заявки.
2. Повторно найти reusable order.
3. Вернуть существующий заказ либо создать ровно один новый.
4. Возвращать признак `created | reused`.

Ключ:

```txt
provider='rr'
+ tariff_offer_id
+ user_id либо normalized contact identity
+ временное окно
```

Нельзя полагаться только на rate limit: он ограничивает частоту, но не обеспечивает идемпотентность при параллельных запросах.

---

## **2. Уточнить нормализацию телефона**

Формулировка:

```txt
только цифры (+ ведущий '+', отбрасываем)
```

неоднозначна.

Зафиксировать канон:

```txt
phone_norm = только цифры;
пробелы, скобки, дефисы и ведущий «+» удаляются;
допустимая длина — согласованный диапазон, например 9–15 цифр.
```

Исходный телефон можно хранить для операционной работы, но сравнение и rate limit выполняются только по `phone_norm`.

---

## **3. Rate limit должен учитывать несколько независимых измерений**

Один hash от:

```txt
offer_id | phone | email | ip
```

позволит обходить лимит сменой любого одного значения.

Минимально проверять отдельные buckets:

```txt
rr_initiate:ip:<hash(ip)>
rr_initiate:contact:<hash(phone_norm|email_norm)>
rr_initiate:offer_contact:<hash(offer_id|phone_norm|email_norm)>
```

Например:

- IP: согласованный предел в минуту;
- контакт: 5 запросов в минуту;
- оффер + контакт: 5 запросов в минуту.

Конкретные значения можно оставить мягкими, но защита должна быть устойчивой.

---

## **4. Укрепить SECURITY DEFINER RPC**

Для `rr_public_rate_limit_hit` и транзакционной RPC обязательно:

```sql
SECURITY DEFINER
SET search_path = public, pg_temp
```

Также:

```txt
REVOKE ALL ON FUNCTION ... FROM PUBLIC;
REVOKE ALL ON FUNCTION ... FROM anon;
REVOKE ALL ON FUNCTION ... FROM authenticated;
GRANT EXECUTE ON FUNCTION ... TO service_role;
```

Таблица `rr_public_rate_limits`:

- без клиентских политик;
- без grants для `anon` и `authenticated`;
- с CHECK `count >= 0`;
- предусмотреть периодическую очистку старых buckets либо допустимый cleanup при очередном RPC-вызове.

---



## **5. Failed order нельзя оставлять семантически обычным**

`pending`

При ошибке `createOrder` статус может остаться существующим `pending`, если новый статус вводить нельзя, но в `meta` должны быть однозначные признаки:

```json
{
  "flow": "rr_installment",
  "rr": {
    "initiation_status": "failed",
    "error_code": "...",
    "error_at": "..."
  }
}
```

Успешный заказ:

```json
{
  "rr": {
    "initiation_status": "created",
    "payment_url": "...",
    "external_id": "..."
  }
}
```

Reuse допускается только при:

```txt
initiation_status='created'
payment_url непустой
error отсутствует
```

Failed order не возвращать клиенту как успешный и не передавать в будущий Sprint C как активную заявку.

---



## **6. Не записывать чувствительные PII в**

`provider_events`

Правильно, что имя, телефон, email и комментарий не входят в payload событий.

Для `orders_v2.meta.rr.contact` дополнительно подтвердить:

- комментарий ограничен по длине;
- HTML удаляется или хранится как plain text;
- данные не попадают в `console.log`;
- edge response не возвращает PII;
- ошибки РР проходят redaction;
- `provider_events` содержит только технические идентификаторы и статусы.

---

## **7. Идемпотентность webhook — использовать hash подписи**

Не хранить полную подпись в `idempotency_key`.

Вместо:

```txt
external_id + newStatus + sign
```

использовать:

```txt
rr:<external_id>:<status_raw>:<sign_hash_short>
```

Полная подпись не должна попадать в:

- `provider_events`;
- `orders_v2.meta`;
- `integration_sync_logs`;
- console logs.

---

## **8. Bad-signature event не должен создавать конфликт с неизвестным заказом**

Для невалидной подписи порядок должен быть:

```txt
получить минимальные технические поля
→ проверить подпись
→ при invalid вернуть 401
→ записать redacted security event/log
→ НЕ читать и НЕ обновлять order
```

Если `provider_events` требует обязательной связи с заказом, bad signature писать в безопасный технический лог, а не создавать фиктивную связь.

---

## **9. Уточнить поведение неизвестного заказа**

После валидной подписи, но при неизвестном `external_id`:

```txt
HTTP 200
ignored='unknown_order'
никаких INSERT/UPDATE в orders_v2/payments_v2
```

Разрешен один redacted `provider_event` или технический лог, если схема позволяет событие без заказа.

---

## **10. Исправить формулировку про остальные офферы**

В E2E написано:

```txt
2-й и 3-й офферы тарифа «Бухгалтер»
```

Правильно:

```txt
офферы двух остальных тарифов продукта:
- «Главный бухгалтер»;
- «Бизнес-леди».
```

Они должны продолжать работать через legacy `external_link`.

---

## **11. Data-fix выполнять последним и иметь rollback**

До включения runtime:

1. Развернуть migration/RPC.
2. Развернуть hardened edge-функции.
3. Проверить функции напрямую в preview на оффере без runtime.
4. Снять полный backup `meta` согласованного оффера.
5. Только затем применить `jsonb_set`.

В отчет включить rollback:

```sql
UPDATE tariff_offers
SET meta = <полный сохраненный BEFORE meta>
WHERE id = '15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74';
```

Отключение runtime должно быть возможно также быстрым add-only merge:

```json
{
  "enabled": false,
  "provider": "rr",
  "mode": "initiate_only"
}
```

Legacy `external_link` при этом остается рабочим.

---

## **12. Расширить E2E proof негативными сценариями**

Кроме happy path и reuse проверить:

```txt
- другой контакт → новый order;
- тот же email с другим user_id → старой заявкой не переиспользуется;
- отсутствующий/неактивный offer → 403/404;
- offer без rr_runtime.enabled → rr_runtime_disabled;
- подмена amount/currency в request игнорируется или отклоняется;
- honeypot заполнен → отказ без создания order;
- rate limit → 429 без нового order и без вызова РР;
- ошибка createOrder → failed meta, без payment_url и без reuse;
- CORS preflight работает.
```

---

## **13. Проверить отсутствие бизнес-сайд-эффектов не только по count**

Снять before/after:

```txt
payments_v2
entitlements
access_grant_ledger
telegram_access_grants
domain_events
CRM/deal logs
success notifications
```

Дополнительно доказать:

```txt
grant-access-for-order не вызывался;
CRM success-stage не менялся;
успешные email/Telegram-уведомления не отправлялись.
```

---

## **14. Формат итогового отчета**

```txt
Отчет о выполненной работе: Sprint B — public flow installment-initiate для РР без проведения платежа и выдачи доступов
```

В отчете отдельно разделить:

```txt
1. Изменения кода и БД
2. Data-fix одного оффера
3. Happy-path proof
4. Idempotency/concurrency proof
5. Security и negative proof
6. No-side-effects proof
7. Legacy proof двух остальных тарифов
8. Rollback
9. Что остается для Sprint C
```

После этих дополнений план можно выполнять. Sprint C не начинать до полного E2E, включая конкурентную идемпотентность, rate limit и подтверждение отсутствия платежей, доступов и CRM success-flow.

&nbsp;

План: Sprint B — hardening, data-fix и E2E runtime proof

## 0. Проверка оффера (SQL, до изменений)

Оффер `15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74` подтверждён:

- `offer_type='bank_installment'`, `is_active=true`
- `amount=1650.00`, `currency='BYN'` (продуктовая валюта)
- Тариф `Бухгалтер`, продукт `Ценный бухгалтер | 1 ступень 2.0`
- `meta.bank_installment` уже содержит `external_link`, `link_label`, `message_html`, `rr_mode`, `installment_provider`, `currency` — эти ключи трогать нельзя.

## 1. Migration 1 — durable rate limit + hardening infra

Создать `public.rr_public_rate_limits`:

- `bucket_key text primary key` — `rr_initiate:<sha256(offer_id|phone_norm|email_norm|ip)>`
- `window_started_at timestamptz`, `count int`, `updated_at timestamptz`
- GRANT только `service_role`; RLS enabled, политик нет.
- RPC `rr_public_rate_limit_hit(_key text, _window_seconds int, _max int) returns boolean` (SECURITY DEFINER) — upsert-инкремент в окне; возвращает true если лимит не превышен.

## 2. Правка `public-rr-installment-initiate` (hardening)

1. **Нормализация PII**: `email = lower/trim`; `phone_norm = только цифры (+ ведущий '+', отбрасываем)`; длина/формат валидируются.
2. **Идемпотентность (пересобрать правило)**: pending заказ переиспользуется только если ВСЕ выполнено:
  - тот же `offer_id`,
  - `status='pending'` AND `provider='rr'` AND `meta.flow='rr_installment'`,
  - `meta.rr.payment_url` не пуст,
  - `meta.rr.error` отсутствует,
  - `user_id` совпадает (оба NULL или равны),
  - Совпадает нормализованный email ИЛИ нормализованный телефон (при наличии обоих — оба),
  - `created_at >= now() - interval '30 minutes'`.
  Иначе — создаём новый.
3. **Порядок операций**: pending order → `create_order_requested` event → `rrCreateOrder` → success: сохранить `payment_url` в meta + `create_order_succeeded`; fail: пометить `meta.rr.error`, `create_order_failed`, вернуть 502 (заказ остаётся pending, но с флагом error — не переиспользуется reuse-логикой).
4. **Rate limit**: перед созданием заказа — вызов RPC `rr_public_rate_limit_hit` с ключом от `(offer|phone_norm|email_norm|ip)` (окно 60 сек, макс 5). Отказ → 429.
5. **PII redaction**: `provider_events.payload` не содержит name/phone/email/comment (уже так); в `orders_v2.meta.rr.contact` — оставляем (нужно для операционной работы, доступ только через RLS).
6. **CORS**: origin оставить `*` для paylink-совместимости лендингов на кастомных доменах (нельзя ограничить без потери работоспособности lovable.app превью + кастомных доменов); честно зафиксировать в отчёте.

## 3. Правка `rr-webhook` (guard-ы)

Ужесточить фильтр заказа:

- `order.provider = 'rr'` AND `meta.flow = 'rr_installment'` AND `id = payload.id`;
- иначе `200 { ignored: 'not_rr_installment' }` без побочных эффектов;
- неизвестный `external_id` → `200 { ignored: 'unknown_order' }`, никаких INSERT в orders_v2;
- bad signature → 401 + `webhook_bad_signature` event;
- duplicate по `(external_id, newStatus, sign)` → `200 { duplicate: true }` без обновления meta;
- idempotency_key событий уже уникален — сохраняется.

## 4. Migration 2 — add-only merge `rr_runtime` на согласованном оффере

Один точечный UPDATE с `jsonb_set` через `meta.bank_installment.rr_runtime`:

```
UPDATE tariff_offers
SET meta = jsonb_set(meta, '{bank_installment,rr_runtime}',
      '{"enabled":true,"provider":"rr","mode":"initiate_only"}'::jsonb, true)
WHERE id = '15ce91ec-5dc1-4abf-9fab-9c97dc1e6b74'
  AND offer_type = 'bank_installment' AND is_active
  AND (meta->'bank_installment'->>'external_link') IS NOT NULL;
```

Все прочие ключи `meta.bank_installment.*` сохраняются.

## 5. E2E runtime proof

Playwright по `https://gorbova.by/cb`:

1. Клик на тариф «Бухгалтер» → диалог лида;
2. Заполнить форму, submit → перехватить сеть на `public-rr-installment-initiate`;
3. Проверить `payment_url` в ответе, редирект на `pay.rrllc.ru`;
4. Повторный submit того же контакта → `reused=true`, тот же `order_id`;
5. SQL-снимки: `orders_v2` (создан pending, provider='rr', meta.flow='rr_installment', amount=1650, currency=BYN, payment_url в meta.rr); `provider_events` (`create_order_requested` + `create_order_succeeded`); `payments_v2` — 0 записей; `entitlements`, `access_grant_ledger` — без изменений;
6. Inert webhook — 4 сценария curl через `supabase--curl_edge_functions`: valid, duplicate, bad signature, unknown order;
7. Проверить, что 2-й и 3-й офферы тарифа «Бухгалтер» продолжают открывать `external_link`.

## Итоговый заголовок отчёта

«Отчет о выполненной работе: Sprint B — public flow installment-initiate для РР без проведения платежа и выдачи доступов».

## DoD

- Оба edge deployed;
- Rate-limit таблица + RPC развёрнуты;
- Data-fix применён точечно, `external_link` не затронут;
- E2E проведён, screenshots + SQL-снимки в отчёте;
- Sprint C не начат.