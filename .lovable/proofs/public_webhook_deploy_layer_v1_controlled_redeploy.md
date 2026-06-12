# Proof: PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve C1 controlled canary

Date: 2026-06-12
Scope: ТОЛЬКО функция `public-webhook-deploy-probe`. Никакая другая edge
function в рамках C1 не деплоилась (`stripe-webhook`, `bepaid-webhook`,
`telegram-webhook`, `payment-methods-webhook`, `auth-email-hook`,
`getcourse-webhook`, `amocrm-webhook`, `instagram-webhook`,
`stripe-card-data-fetch`, `stripe-card-data-fetch-bulk` — НЕ ТРОГАЛИСЬ).

## 0. Expected config (`supabase/config.toml`)

```toml
[functions.public-webhook-deploy-probe]
verify_jwt = false
```

Функция не имеет: DB-клиента, secrets, service-role, бизнес-логики,
внешних HTTP-вызовов, scheduled triggers, доступа к таблицам.

## 1. Source snapshots

### Source v1 — sha256 `df9cf7e464843014de70c9cef3b8dbf195df285a13a91b9246b0244b17fa7f91`

```ts
const PROBE_MARKER = "public-webhook-deploy-v1";

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = { ok: true, probe: PROBE_MARKER, method: req.method, ts: new Date().toISOString() };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

### Source v2 — sha256 `9832b40782dc1d79736866d79ce163715f5b2a36960d58755cf4e4e44f6457df`

Единственное отличие от v1:

```diff
-const PROBE_MARKER = "public-webhook-deploy-v1";
+const PROBE_MARKER = "public-webhook-deploy-v2";
```

## 2. Первый deploy v1

- `supabase--deploy_edge_functions(["public-webhook-deploy-probe"])` → `Successfully deployed`.
- External POST без Supabase JWT на
  `https://hdjgkjceownmmnrqqtuz.functions.supabase.co/public-webhook-deploy-probe`.

| t      | HTTP | body marker                  | sb-request-id                          | platform 401 |
|--------|------|------------------------------|----------------------------------------|--------------|
| 0s     | 200  | `public-webhook-deploy-v1`   | 019ebb88-2264-7e65-9e76-d53961a48be9   | нет          |
| 30s    | 200  | `public-webhook-deploy-v1`   | 019ebb88-9b26-7383-a8bc-8bbad81786f7   | нет          |
| 2m     | 200  | `public-webhook-deploy-v1`   | 019ebb89-fb6e-7ced-945a-9e15598d52d7   | нет          |

Headers (стабильно во всех трёх): `server: cloudflare`,
`sb-gateway-version: 1`, `sb-project-ref: hdjgkjceownmmnrqqtuz`,
`x-served-by: supabase-edge-runtime`, `x-sb-edge-region: eu-west-3`.
`UNAUTHORIZED_NO_AUTH_HEADER` / `Missing authorization header` /
`Invalid JWT` отсутствуют.

**Verdict v1 = PASS.**

## 3. Redeploy v2

- Изменён только marker → `public-webhook-deploy-v2`.
- `supabase--deploy_edge_functions(["public-webhook-deploy-probe"])` → `Successfully deployed`.

| t      | HTTP | body marker                  | sb-request-id                          | platform 401 |
|--------|------|------------------------------|----------------------------------------|--------------|
| 0s     | 200  | `public-webhook-deploy-v2`   | 019ebb8a-5f61-7ba7-84e0-7f6970ab9d03   | нет          |
| 30s    | 200  | `public-webhook-deploy-v2`   | 019ebb8a-d6af-736f-bb2b-0b6d2041f33f   | нет          |
| 2m     | 200  | `public-webhook-deploy-v2`   | 019ebb8c-36f8-7798-8a23-2e6a43b8e71f   | нет          |

Новый bundle активен (marker сменился во всех трёх probes), JWT-wall
не появился ни в один из моментов, ни transient.

**Verdict v2 = PASS.**

## 4. Recovery v1 (повторный deploy предыдущего source)

- Source перезаписан из сохранённой копии `/tmp/probe_v1.ts`; sha256
  совпал с исходным `df9cf7e4…fa7f91`.
- `supabase--deploy_edge_functions(["public-webhook-deploy-probe"])` → `Successfully deployed`.

| t      | HTTP | body marker                  | sb-request-id                          | platform 401 |
|--------|------|------------------------------|----------------------------------------|--------------|
| 0s     | 200  | `public-webhook-deploy-v1`   | 019ebb8c-96a9-7fad-b316-c15d96527e33   | нет          |
| 30s    | 200  | `public-webhook-deploy-v1`   | 019ebb8d-0e3e-7c68-a808-d7a8c4a9df5c   | нет          |
| 2m     | 200  | `public-webhook-deploy-v1`   | 019ebb8e-6e7f-78c8-8599-3ef4642bd14c   | нет          |

Marker v1 восстановлен, функция остаётся публично достижимой без
Supabase JWT, platform-level auth error не возникает.

**Verdict recovery = PASS.**

## 5. Platform-level vs function-level

Во всех 9 probes ответ — function-level (HTTP 200, JSON-тело собрано
кодом функции, заголовок `x-served-by: supabase-edge-runtime`,
присутствует `x-deno-execution-id`). Маркеры platform-level JWT-wall
(`UNAUTHORIZED_NO_AUTH_HEADER`, `Missing authorization header`,
`Invalid JWT`, `jwt expired`, `jwt malformed`) не встретились ни разу.

## 6. Итоговый verdict

**D-STABLE-CANDIDATE.**

Доказано на canary `public-webhook-deploy-probe`:

- первый Lovable agent-deploy функции с объявленным
  `[functions.<fn>] verify_jwt = false` публикует её без JWT-wall;
- повторный agent-deploy (redeploy) не вводит JWT-wall, новый bundle
  заменяет старый (marker сменился c v1 → v2);
- повторный deploy предыдущего source восстанавливает marker v1 и
  при этом тоже не вводит JWT-wall.

## 7. Что НЕ доказано (out of scope C1)

- Поведение agent-deploy для других webhook-функций (`stripe-webhook`,
  `bepaid-webhook` и др.) — не проверено напрямую.
- Long-term стабильность за пределами 2 минут.
- Что регрессия 2026-06-06 невоспроизводима в иной комбинации условий.

Поэтому общий мораторий §8 НЕ снимается автоматически. Решение по
снятию — Approve D (verdict/документация) и далее Approve E
(redeploy `stripe-webhook`).

## 8. Что НЕ выполнялось

- `supabase--deploy_edge_functions` для любых других функций.
- Изменение secrets, env, БД, RPC, миграций.
- Удаление canary (cleanup — отдельный approve, см. план §6).
- Historical Stripe card backfill.
- Любые изменения в production webhook bundles.

## 9. Состояние canary после C1

- Source в репозитории = v1 (sha256 `df9cf7e4…fa7f91`).
- Deployed bundle = v1 (подтверждено по marker в §4).
- Функция оставлена в этом состоянии до cleanup approve.
