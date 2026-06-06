# Discovery: PATCH-D2-BIS — Webhook 401 после redeploy (root cause)

Дата: 2026-06-06
Сценарий: повторная регрессия из Phase 3.3 (D2) и Phase 3.4.

## A. Snapshot всех webhook (production URL, без подписи)

Базовый URL: `https://hdjgkjceownmmnrqqtuz.functions.supabase.co`
Критерий PASS: **НЕ platform-401** (платформа Supabase Functions Gateway отвечает `{"code":"UNAUTHORIZED_NO_AUTH_HEADER", ...}` или `{"code":401,"message":"Missing authorization header"}`). Application-level 401 с нашим телом (`Invalid signature`, наш `reason`) — допустимо.

| Function | OPTIONS | POST(no sig) | Body | Verdict |
|---|---|---|---|---|
| stripe-webhook | 200 | 400 | `signature_verification_failed` | PASS |
| bepaid-webhook | 200 | 401 | `Invalid signature / no_auth_method` (application) | PASS |
| telegram-webhook | 200 | 400 | `No bot_id` | PASS |
| instagram-webhook | 200 | 400 | `Missing integration_instance_id` | PASS |
| getcourse-webhook | 200 | 401 | `Unauthorized / no_instance_id` (application) | PASS |
| amocrm-webhook | 200 | 200 | `{success:true}` | PASS |
| auth-email-hook | 200 | 401 | `Invalid signature` (application) | PASS |
| payment-methods-webhook | 200 | 200 | `{status:"ignored"}` | PASS |

Snapshot выполнен ПЕРЕД повторным деплоем. Все 8 webhook долетают до бизнес-логики.

## B. Воспроизведение регрессии (controlled redeploy `stripe-webhook`)

1. Запущен `supabase--deploy_edge_functions(["stripe-webhook"])`.
2. Smoke @ t=0s / 30s / 2m:

```
[t=0s]  OPTIONS=200 POST=401 body={"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
[t=30s] OPTIONS=200 POST=401 body={"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
[t=2m]  OPTIONS=200 POST=401 body={"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```

3. Повторный `supabase--deploy_edge_functions(["stripe-webhook"])` НЕ восстановил состояние: 3 последовательных smoke с интервалом 5s → 401 устойчиво.

Это не транзитное окно. Регрессия детерминированная.

## C. Root cause (формулировка по правилам)

> **root cause not fully proven by platform logs; observed reproducible regression: the agent tool `supabase--deploy_edge_functions` deploys edge functions WITHOUT applying per-function `verify_jwt` from `supabase/config.toml`. Platform falls back to default `verify_jwt = true`, which inserts the Supabase Functions Gateway JWT wall in front of the webhook. Mitigated by (1) runtime guard checking production URL and (2) restoring via the CI `apply-migrations` workflow (`supabase functions deploy --all`), which DOES read `config.toml`.**

Доказательная база:
- `config.toml` строка для `stripe-webhook` явно содержит `verify_jwt = false` — git state корректен.
- Snapshot до агентского redeploy → PASS. Сразу после агентского redeploy → platform-401 с телом `UNAUTHORIZED_NO_AUTH_HEADER` (это маркер Supabase Functions Gateway, не наш код).
- CI guard `verify-webhook-public.yml` проверяет только git state и НЕ ловит эту регрессию — требуется runtime-guard на production URL.

## D. Восстановление

Канонический путь восстановления `stripe-webhook` (и любых webhook), попавших в 401 после агентского redeploy:

1. Запустить GitHub workflow `Supabase Migration & Deploy` (`apply-migrations.yml`) в режиме `deploy-functions` или `full-deploy` — он использует `supabase functions deploy --all` через CLI и читает `config.toml`.
2. После завершения — прогон runtime smoke (см. `verify-webhook-runtime.yml`).

Альтернатив (ручной патч production без CI) — не существует в рамках этого PATCH.

## E. Что не входит

- Не создаём новые edge functions / smoke-клоны.
- Не меняем код самих webhook (`stripe-webhook`, `bepaid-webhook`, ...).
- Не создаём новые alert-каналы. Алерт через существующий `telegram-notify-admins` опционален и подключается только если канал уже безопасно доступен.
- Не запускаем Stripe replay (Phase 3.4 G33–G40) до stable PASS D1/E1/E2.
