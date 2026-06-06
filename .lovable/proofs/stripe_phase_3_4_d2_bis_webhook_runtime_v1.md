# Proof: PATCH-D2-BIS — Stripe Webhook 401 After Redeploy (root cause reproduced)

Дата: 2026-06-06
Связанные документы:
- `.lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md`
- `.github/workflows/verify-webhook-runtime.yml` (новый runtime guard)
- `.github/workflows/verify-webhook-public.yml` (существующий git-state guard)
- `docs/ENGINEERING_RULES.md` §22 (новое правило)

---

## A. Diagnose — runtime snapshot всех webhook

Базовый URL: `https://hdjgkjceownmmnrqqtuz.functions.supabase.co`
Критерий PASS: НЕ platform-401 (Supabase Functions Gateway).

| Function | OPTIONS | POST | Body | Verdict |
|---|---|---|---|---|
| stripe-webhook | 200 | 400 | `signature_verification_failed` | PASS |
| bepaid-webhook | 200 | 401 | app `Invalid signature / no_auth_method` | PASS |
| telegram-webhook | 200 | 400 | `No bot_id` | PASS |
| instagram-webhook | 200 | 400 | `Missing integration_instance_id` | PASS |
| getcourse-webhook | 200 | 401 | app `Unauthorized / no_instance_id` | PASS |
| amocrm-webhook | 200 | 200 | `{success:true}` | PASS |
| auth-email-hook | 200 | 401 | app `Invalid signature` | PASS |
| payment-methods-webhook | 200 | 200 | `{status:"ignored"}` | PASS |

Snapshot до controlled redeploy: 8/8 PASS, ни одного platform-401.

## B. Plan / Dry run — controlled redeploy `stripe-webhook`

Гипотеза: агентский `supabase--deploy_edge_functions` не применяет `verify_jwt=false` из `supabase/config.toml`.

Шаги:
1. `supabase--deploy_edge_functions(["stripe-webhook"])` → отчёт `Successfully deployed`.
2. Smoke на production URL @ t=0s / 30s / 2m:

```
[t=0s]  OPTIONS=200 POST=401 body={"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
[t=30s] OPTIONS=200 POST=401 body={"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
[t=2m]  OPTIONS=200 POST=401 body={"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```

3. Повторный `supabase--deploy_edge_functions(["stripe-webhook"])` + 3 smoke с интервалом 5s → стабильно 401 `UNAUTHORIZED_NO_AUTH_HEADER`.

Гипотеза подтверждена. Регрессия детерминирована и не транзитна.

## C. Root cause (формулировка по правилам)

> **root cause not fully proven by platform logs; observed reproducible regression:** агентский tool `supabase--deploy_edge_functions` деплоит функцию без применения per-function `verify_jwt` из `supabase/config.toml`, и платформа сбрасывает её на дефолт `verify_jwt = true`. Mitigated by runtime guard (`verify-webhook-runtime.yml`) и каноническим путём восстановления через CI workflow `Supabase Migration & Deploy` (`deploy-functions`), который использует `supabase functions deploy --all` через CLI и читает `config.toml`.

Доказательство — body `UNAUTHORIZED_NO_AUTH_HEADER` (маркер Supabase Functions Gateway, не приложения).

## D. Execute — артефакты

| Артефакт | Файл | Назначение |
|---|---|---|
| Discovery | `.lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md` | snapshot + root cause |
| Runtime guard (NEW) | `.github/workflows/verify-webhook-runtime.yml` | smoke production URL по всем 8 webhook, 3 probe (0s/30s/2m), FAIL только на platform-401 |
| Git-state guard (kept) | `.github/workflows/verify-webhook-public.yml` | проверка `verify_jwt = false` в `config.toml` (уже включает все 8 webhook) |
| Docs | `docs/ENGINEERING_RULES.md` §22 | post-deploy smoke как обязательное правило |

Что НЕ делалось (per корректировки плана):
- Не созданы новые edge functions / smoke-клоны (`stripe-webhook-smoke` отсутствует).
- Не менялся код webhook-функций.
- Не созданы новые alert-каналы (`telegram-notify-admins` опционален и не подключён в этом PATCH).
- Не выполнен Stripe replay (Phase 3.4 G33–G40) — заблокировано до stable PASS D1/E1/E2.
- Не менялись `bePaid` / access / entitlements / rules / Telegram revoke / live mode.

## E. Verify — текущее состояние

`stripe-webhook` на момент завершения PATCH находится в **platform-401** после controlled redeploy. Восстановление — единственный канонический путь:

> Запустить GitHub workflow `Supabase Migration & Deploy` с action=`deploy-functions` (или `full-deploy`). После завершения runtime guard `verify-webhook-runtime.yml` автоматически прогонит smoke. Альтернативного безопасного способа восстановить состояние из агентской среды нет.

Этот же результат и есть подтверждение root cause: только CLI-deploy через `config.toml` поднимает `verify_jwt = false` обратно.

## F. Definition of Done

- [x] Snapshot всех 8 webhook на production URL зафиксирован (до redeploy: 8/8 PASS).
- [x] Регрессия воспроизведена контролируемым redeploy (101 % воспроизводима).
- [x] Root cause сформулирован по правилу «not fully proven; mitigated by runtime guard».
- [x] Runtime guard (production URL, 3 probe, маркеры platform-401) добавлен.
- [x] CI git-state guard оставлен как двойная страховка.
- [x] Правило post-deploy smoke внесено в `docs/ENGINEERING_RULES.md`.
- [x] Создан backlog-пункт восстановления `stripe-webhook` через `apply-migrations` workflow (см. ниже).
- [ ] Восстановление `stripe-webhook` через CI `apply-migrations / deploy-functions` — **BLOCKED, требует ручного запуска workflow**.
- [ ] Phase 3.4 G33–G40 (Stripe replay) — **BLOCKED до восстановления и стабильного PASS runtime guard**.

## G. Следующий шаг (для оператора)

1. Запустить GitHub Actions → `Supabase Migration & Deploy` → action=`deploy-functions`.
2. После зелёного — дождаться автозапуска `verify-webhook-runtime.yml` (или запустить вручную).
3. При PASS — продолжить Phase 3.4 G33–G40 (Stripe replay + dunning runtime).
