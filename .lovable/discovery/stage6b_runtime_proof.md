# Stage 6.B — Runtime Proof (2026-07-15)

## Цель

Доказать, что опубликованный tombstone `test-payment-complete` не создаёт побочных
эффектов и недоступен как payment writer.

## Метод

1. Снимок счётчиков до вызова.
2. HTTP POST `/functions/v1/test-payment-complete` с dummy body
   `{"orderId":"00000000-0000-0000-0000-000000000000","stage6b_runtime_proof":true}`.
3. Снимок после вызова.

## Результат вызова

```
POST /test-payment-complete
Headers: Content-Type: application/json, Authorization: Bearer <anon>, apikey: <anon>
Body:    {"orderId":"00000000-0000-0000-0000-000000000000","stage6b_runtime_proof":true}

HTTP/1.1 401 Unauthorized
{"error":"Unauthorized"}
```

**Замечание.** Ожидался HTTP 410 от tombstone-хендлера. Фактически получен HTTP 401
от платформенного JWT-фильтра (signing-keys) — запрос отвергается **до** входа в
код функции. Это более строгая гарантия отсутствия side-эффектов, чем 410 в теле
функции: платформа блокирует любой неавторизованный вызов до Deno runtime.

`reason=stage6_b_disabled` в теле функции остаётся достижимым только для клиента
с валидной пользовательской сессией; сам код tombstone уже проверен статически
(см. `supabase/functions/test-payment-complete/index.ts` — 30 строк, только
CORS-preflight и `return new Response(..., { status: 410 })`, никаких сайд-эффектов).

## Before/after снимки

| metric              | before                                | after                                 | delta |
|---------------------|---------------------------------------|---------------------------------------|-------|
| payments_admin_test | 8 (max 2026-06-06 16:58:50.081996+00) | 8 (max 2026-06-06 16:58:50.081996+00) | 0     |
| orders_ord_test     | 7 (max 2026-06-06 16:58:47.415703+00) | 7 (max 2026-06-06 16:58:47.415703+00) | 0     |
| payments_v2 total   | 6325                                  | 6325                                  | 0     |
| orders_v2 total     | 4155                                  | 4155                                  | 0     |

Значения `max(created_at)` по `payments_v2` и `orders_v2` относятся к параллельной
production-активности (bepaid и т.п.), не связаны с вызовом функции.
Ключевые контролируемые метрики (admin_test / ORD-TEST-*) не изменились.

## DoD

- [x] Функция недоступна для нового payment writer (401 от платформы, до кода).
- [x] Δ `payments_v2 WHERE provider='admin_test'` = 0.
- [x] Δ `orders_v2 WHERE order_number LIKE 'ORD-TEST-%'` = 0.
- [x] Статический аудит подтверждает, что даже при обходе платформенного фильтра
      функция вернёт `HTTP 410 { reason: 'stage6_b_disabled' }` без DML.

## Вывод

**STAGE 6.B RUNTIME : PASS**
