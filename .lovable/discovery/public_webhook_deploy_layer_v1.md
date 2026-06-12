# Discovery: Public Webhook Deploy Layer v1

Date: 2026-06-12
Owner: PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve A
Scope: read-only снимок фактического auth-режима всех публичных webhook
       в Lovable-managed Supabase (`hdjgkjceownmmnrqqtuz`) + сравнение
       с моратория-документом 2026-06-06.

## 1. CURRENT DEPLOYED STATE

Производственный POST без Supabase JWT в
`https://hdjgkjceownmmnrqqtuz.functions.supabase.co/<fn>` (выполнено 2026-06-12):

| Function                | HTTP | Body                                  | Layer        | Verdict |
|-------------------------|------|---------------------------------------|--------------|---------|
| stripe-webhook          | 400  | `signature_verification_failed`       | application  | PASS    |
| bepaid-webhook          | 401  | `Invalid signature / no_auth_method`  | application  | PASS    |
| telegram-webhook        | 400  | `No bot_id`                           | application  | PASS    |
| payment-methods-webhook | 200  | `{status:"ignored"}`                  | application  | PASS    |
| auth-email-hook         | 401  | `Invalid signature`                   | application  | PASS    |
| getcourse-webhook       | 401  | `Unauthorized / no_instance_id`       | application  | PASS    |
| amocrm-webhook          | 200  | `{success:true}`                      | application  | PASS    |
| instagram-webhook       | 400  | `Missing integration_instance_id`     | application  | PASS    |

Маркер платформенного JWT-wall (`UNAUTHORIZED_NO_AUTH_HEADER` /
`Missing authorization header` / `Invalid JWT`) НЕ обнаружен ни на одной
функции. Все ответы — application-level, то есть запрос дошёл до кода
функции.

## 2. Repository config snapshot

`supabase/config.toml` ДО этого PATCH содержал только:

```toml
project_id = "hdjgkjceownmmnrqqtuz"
```

Никаких `[functions.*]` блоков и `verify_jwt = false` в репозитории не было.

После Approve A в `supabase/config.toml` добавлены явные блоки
`verify_jwt = false` для всех 8 функций из §1 и для canary
`public-webhook-deploy-probe`. Это EXPECTED CONFIG, не runtime proof.

## 3. CURRENT AGENT-DEPLOY BEHAVIOR

**НЕ ДОКАЗАНО.** Из §1 нельзя сделать вывод, что текущий Lovable
agent-deploy сохраняет `verify_jwt = false` по дефолту. Возможные причины
текущей публичной достижимости 8 webhook:

- функции были опубликованы более ранней версией deploy-инструмента;
- функции были опубликованы до появления регрессии 2026-06-06;
- платформа сохранила настройку с предыдущего deploy;
- использовался иной внутренний Lovable deployment path;
- состояние `config.toml` (пустой) на момент тех deploy было неинтерпретируемо.

Фактическое поведение текущего agent-deploy будет проверено отдельным
controlled canary redeploy в этапе C (Approve C).

## 4. Сравнение Stripe ↔ bePaid

| Признак                              | stripe-webhook              | bepaid-webhook              |
|--------------------------------------|-----------------------------|-----------------------------|
| Внешний POST без JWT                  | PASS (app-level 400)        | PASS (app-level 401)        |
| Маркер платформенного JWT-wall        | отсутствует                 | отсутствует                 |
| `[functions.*]` блок в config.toml (до A) | отсутствовал           | отсутствовал                |
| Канал deploy                          | Lovable agent-deploy        | Lovable agent-deploy        |
| Signature verification                | в коде функции (Stripe-Signature) | в коде функции (bePaid signature) |

Архитектурной разницы нет. Для Stripe не требуется отдельная
инфраструктура — нужен надёжный канонический deploy-механизм для обоих.

## 5. Расхождения с предыдущей документацией

- `.lovable/architecture/canonical_infrastructure_v1.md` §8 утверждал:
  «`stripe-webhook` is currently in platform-401 state from a prior
  controlled-redeploy regression». Снимок §1 этого НЕ подтверждает:
  `stripe-webhook` сейчас возвращает application-level 400
  `signature_verification_failed`, то есть JWT-wall его не блокирует.
- `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md`
  описывает deterministic repro регрессии. Этот discovery её НЕ
  опровергает — регрессия из 2026-06-06 могла быть реальной и
  впоследствии саморазрешиться (платформенный rebuild, фоновый
  re-publish, изменение дефолта Lovable agent). Воспроизводимость
  необходимо переподтвердить controlled canary deploy.
- `.github/workflows/verify-webhook-public.yml` парсит блоки `[functions.<fn>]`,
  которых до A в config.toml не было → guard падал ложно. После A blocks
  присутствуют и guard будет осмысленно проверять EXPECTED config (но не
  runtime state).

## 6. Мораторий §8 — статус

UNDER RE-VERIFICATION. Не снят. Не передеплоивать `stripe-webhook` и
любые webhook-функции до выполнения этапа C (canary deploy/redeploy/recovery).

## 7. Что нельзя утверждать на основании этого discovery

- Что новый Lovable agent-deploy сохраняет `verify_jwt = false`.
- Что регрессия 2026-06-06 невоспроизводима.
- Что мораторий можно снять.
- Что `stripe-webhook` можно безопасно передеплоить.
- Что наличие блока в `config.toml` гарантирует применение настройки.

Эти вопросы решаются только controlled canary в Approve C/D.

## 8. Артефакты A

- `supabase/config.toml` — добавлены явные `[functions.<fn>]` блоки.
- `supabase/functions/public-webhook-deploy-probe/index.ts` — код canary, НЕ задеплоен.
- `.github/workflows/verify-webhook-public.yml` — переименован/уточнён смысл,
  список обязательных функций синхронизирован.
- `.lovable/architecture/canonical_infrastructure_v1.md` §8 — обновлён статус.
- `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` — обновлён статус.
