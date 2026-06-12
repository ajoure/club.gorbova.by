# Canonical protocol: Controlled redeploy of a public webhook function

Status: ACTIVE
Owner: PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve D
Last updated: 2026-06-12
Scope: ЛЮБОЙ публичный webhook в Lovable-managed Supabase
(`hdjgkjceownmmnrqqtuz`), для которого требуется agent-deploy через
`supabase--deploy_edge_functions`.

## 0. Условия применимости

- Глобальный безусловный мораторий снят и заменён на
  **CONDITIONAL CONTROLLED DEPLOYMENT** (см.
  `canonical_infrastructure_v1.md` §8 и
  `lovable_agent_deploy_verify_jwt_regression.md`).
- Массовый redeploy по-прежнему ЗАПРЕЩЁН. Этот протокол применяется
  индивидуально к одной целевой функции на один approve.
- Canary `public-webhook-deploy-probe` доказала на 2026-06-12, что
  `verify_jwt=false` сохраняется при first deploy, redeploy и source
  recovery. Этот factual baseline — единственное основание для
  переходного режима. Любая канонизация поведения для другой функции
  требует пройти полный gate ниже.

Производственные webhook-функции в scope:
`stripe-webhook`, `bepaid-webhook`, `telegram-webhook`,
`payment-methods-webhook`, `auth-email-hook`, `getcourse-webhook`,
`amocrm-webhook`, `instagram-webhook`.

## 1. Обязательный порядок шагов (на КАЖДЫЙ deploy)

### 1.1 Pre-deploy config check

Проверить в `supabase/config.toml` наличие явного блока:

```toml
[functions.<fn>]
verify_jwt = false
```

Если блока нет — STOP, добавить блок отдельным change, не деплоить.

### 1.2 Source snapshot

- Записать `sha256` текущего `supabase/functions/<fn>/index.ts`.
- Сохранить ровно эту версию вне репозитория (`/tmp/<fn>_prev.ts`)
  как recovery-материал.
- Если функция состоит из нескольких файлов — снапшотить все.

### 1.3 Pre-smoke (current bundle)

Без Supabase JWT, тремя точками:

```
POST https://hdjgkjceownmmnrqqtuz.functions.supabase.co/<fn>
t=0, t=30s, t=2m
```

Зафиксировать HTTP, тело, `sb-request-id`, `x-deno-execution-id`,
`x-served-by`. PASS = function-level ответ (HTTP application-level
ошибка подписи провайдера или штатный 200). FAIL = любой platform
маркер: `UNAUTHORIZED_NO_AUTH_HEADER`, `Missing authorization header`,
`Invalid JWT`, `jwt expired`, `jwt malformed`.

При pre-smoke FAIL — STOP, не деплоить, эскалировать как новую
регрессию.

### 1.4 Diff и dependency scope

- Точный diff target function (показать в proof, не «полный файл»).
- Список import-зависимостей (`_shared/*`, `npm:*`, `https:*`).
- Подтверждение: НИКАКИЕ другие функции в этом deploy не идут.

### 1.5 Deploy (одна функция)

```
supabase--deploy_edge_functions(["<fn>"])
```

Ровно один элемент в массиве. Никаких bulk-deploy.

### 1.6 Post-smoke (new bundle)

Те же три точки `t=0 / 30s / 2m` без Supabase JWT.

PASS только если одновременно:

- response — function-level (наш код выполнился);
- platform-level JWT marker отсутствует во всех трёх probes;
- невалидная подпись соответствующего провайдера отклоняется самой
  функцией (Stripe `signature_verification_failed`, bePaid
  `Invalid signature`, Telegram `secret token mismatch` и т. д.);
- lifecycle regression (см. §1.7) не сработала.

### 1.7 Lifecycle / regression checks

Минимум:

- провайдер-специфичная сигнатурная проверка возвращает application
  error на подделанный POST;
- НИ ОДНА запись в `orders_v2`, `subscriptions_v2`, `entitlements`,
  `access_rules`, `provider_subscriptions`, `payments` НЕ создана
  smoke-запросами;
- bePaid функции (если deploy касался не bePaid) не задеты:
  отдельный smoke `bepaid-webhook` остаётся PASS.

### 1.8 На FAIL любого шага — recovery

Немедленно:

1. STOP. Не деплоить другие функции.
2. Восстановить snapshot `/tmp/<fn>_prev.ts` в репозиторий.
3. `supabase--deploy_edge_functions(["<fn>"])` — recovery deploy.
4. Повторить smoke `t=0 / 30s / 2m`.
5. Если recovery PASS — зафиксировать FAIL+recovered, вернуть
   функцию в локальный мораторий (см. §3).
6. Если recovery FAIL — D-BROKEN, эскалировать Lovable, оставить
   функцию в текущем состоянии, не пытаться повторно.

### 1.9 Proof

Создать `.lovable/proofs/<fn>_controlled_redeploy_<date>.md` с:

- pre/post `sha256`;
- diff;
- 6 smoke-таблиц (3 pre + 3 post) с `sb-request-id`;
- провайдер-specific signature check;
- lifecycle regression check;
- verdict: PASS | FAIL-RECOVERED | D-BROKEN;
- подтверждение, что другие функции не деплоились.

## 2. Что НЕ часть протокола

- GitHub Actions deploy — нет. `.github/workflows/verify-webhook-public.yml`
  и `verify-webhook-runtime.yml` — read-only guards, не deploy-канал.
- Bulk redeploy (несколько функций за раз) — запрещён.
- Авто-redeploy при изменении `_shared/*` — запрещён без отдельного
  approve.
- Прогрев / replay реальных провайдерских событий до полного proof — запрещён.

## 3. Локальный мораторий per-function

Если для функции этот протокол завершился FAIL-RECOVERED или D-BROKEN —
функция возвращается в индивидуальный мораторий:

- запись в `lovable_agent_deploy_verify_jwt_regression.md`;
- запрет на повторный agent-deploy этой функции без явного нового
  approve;
- глобальное состояние остаётся CONDITIONAL CONTROLLED DEPLOYMENT для
  остальных функций.

## 4. Snapshot canary

`public-webhook-deploy-probe` остаётся в состоянии v1 как safe baseline
для будущих переисследований deploy layer. Не удалять до закрытия
PATCH.
