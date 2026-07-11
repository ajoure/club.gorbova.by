# Mock RR ledger contract

Mock RR endpoint развёртывается **только** в preview environment. Production обращается к реальному РР.

## Endpoint

- `POST /createOrder` — принимает `{ external_id, amount, currency, customer, ... }`.
- `POST /{external_id}/getOrderStatus` — принимает `{}`.

## Управление сценариями

Сценарий фиксируется секретом `RR_MOCK_SCENARIO` или заголовком `X-RR-Mock-Scenario`, читаемым только внутри preview mock (никогда — production edge). Публичный клиент не может влиять на выбор сценария.

## Ledger

Каждый входящий запрос mock RR добавляет запись в JSON-ledger:

```json
{
  "external_id": "uuid",
  "correlation_id": "uuid",
  "timestamp": "2026-07-10T21:30:00Z",
  "endpoint": "createOrder",
  "call_number": 1,
  "response_scenario": "happy_path",
  "http_status": 200,
  "request_body_redacted": { ... },
  "response_body_redacted": { ... }
}
```

Персональные данные (email/phone/full name) — redacted в ledger.
URL и токены — redacted (`link_present=true, link_len=N`).

## Экспорт

По завершению suite ledger экспортируется в `runtime_proof/mock_rr_ledger.json` и включается в отчёт.

## Требования к mock

1. Строгая идемпотентность `createOrder` по `external_id` в рамках одного теста.
2. Возможность задать response scenarios:
   - `happy_path` — 200 + valid https link;
   - `network_timeout` — hang > client timeout;
   - `http_500` — 500 body;
   - `http_400_generic` — 400 без документированного кода;
   - `http_400_documented_<code>` — 400 с указанным кодом (для будущего allowlist);
   - `http_409_conflict` — при повторном createOrder;
   - `http_200_alt_url` — 200 с другим URL при повторе (для теста URL conflict);
   - `getStatus_not_found` — 404/пустое тело;
   - `getStatus_ok_with_url` — валидный URL;
   - `getStatus_ok_unsafe_url` — `http://` или `https://user@host` (для теста 12);
   - `getStatus_ok_no_url` — 200 без URL.
3. Ответы не могут содержать PII, реальные банковские данные, реальные суммы производственных заказов.
4. Mock изолирован от production сети (доказательство — outbound firewall/allowlist в preview).

## Что не относится к mock

- Реальная авторизация РР не используется. Никаких реальных API-ключей.
- Никаких данных реальных клиентов; тесты используют фикстурные `test+*@ex.com`.
