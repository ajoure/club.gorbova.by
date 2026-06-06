
# План: Lovable-only Supabase Deploy Model (v2 — финальный)

## Контекст и позиция

Supabase-проект `hdjgkjceownmmnrqqtuz` управляется Lovable Cloud. У оператора нет и не будет `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` для этого проекта. GitHub Actions **не может и не должен** быть рабочим каналом деплоя Supabase. Все edge functions, миграции, `verify_jwt=false` обязаны корректно применяться через Lovable Cloud agent-deploy.

GitHub остаётся **только** зеркалом кода + read-only проверки.

Phase 3.4 Runtime G33–G40 остаётся **FROZEN**.

## Главная цель плана

GitHub Actions UI больше не должен содержать автоматически падающих deploy workflow, создающих ложное ощущение, что проект сломан. После плана статус инфраструктуры:

```
Infrastructure model     = CLEAN
GitHub deploy            = DISABLED (no-op stub)
Lovable webhook deploy   = BLOCKED-BY-PLATFORM
Phase 3.4 Runtime        = FROZEN
```

---

## D — Diagnose

**D1.** Перечислить все workflow в `.github/workflows/*.yml` и классифицировать:
- группа A (write/deploy в Supabase): `apply-migrations.yml`, `deploy-functions.yml`, возможно `functions-full-audit.yml` → **no-op stub**
- группа B (read-only): `verify-webhook-public.yml`, `verify-webhook-runtime.yml`, `verify-payment-methods.yml`, `verify-no-legacy-ref.yml` → **оставить**

**D2.** `rg -n "apply-migrations|deploy-functions|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD" .lovable/ docs/ .github/` — снять список упоминаний «recovery через apply-migrations» и старого канонического пути.

**D3.** Зафиксировать, что `verify-webhook-runtime.yml` сейчас содержит recovery-инструкцию «re-run Supabase Migration & Deploy» — это утверждение больше неверно.

**D4.** `supabase--project_info` + `supabase--cloud_status` — подтвердить, что ref `hdjgkjceownmmnrqqtuz` активен.

**D5.** **НЕ воспроизводить регрессию verify_jwt.** Использовать существующий proof `.lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md` как доказательство. Никаких контролируемых redeploy webhook-функций.

---

## P — Plan действий

### P1. Отключить GitHub Actions из deploy-пути Supabase

**Решение оператора: Вариант 1 — no-op stub.** Файлы остаются для истории, но при запуске показывают явное сообщение и завершаются `exit 1`.

Применить к `apply-migrations.yml` и `deploy-functions.yml`:
- убрать `push`-триггеры (если ещё остались)
- убрать `i_understand_risks` gate (он больше не имеет смысла — нет валидного пути)
- убрать любые упоминания `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD`
- оставить один job с одним шагом:
  ```
  echo "::error::GitHub deploy disabled for Lovable-managed Supabase."
  echo "::error::Use Lovable Cloud deploy only."
  exit 1
  ```

Проверить `functions-full-audit.yml` — если он требует Supabase secrets, привести к тому же стандарту; если он read-only — оставить.

### P2. Привести read-only workflow в соответствие новой модели

`verify-webhook-runtime.yml`: заменить recovery-инструкцию в логах. Новый текст:
> Recovery: Lovable agent-deploy is currently BLOCKED-BY-PLATFORM for webhook functions (`verify_jwt=false` regression). Do NOT trigger agent-redeploy of webhook functions. Track Lovable platform issue; no operator action required.

`verify-webhook-public.yml`, `verify-no-legacy-ref.yml`, `verify-payment-methods.yml`: подтвердить, что они не требуют Supabase secrets.

### P3. Зафиксировать модель в документации

Обновить `.lovable/architecture/canonical_infrastructure_v1.md`:
- раздел «2.1 Edge functions» — единственный канал = Lovable Cloud agent-deploy; webhook-функции = **BLOCKED-BY-PLATFORM** (agent-deploy ломает `verify_jwt=false`); никаких redeploy webhook до ответа Lovable
- раздел «2.2 Database migrations» — единственный канал = `supabase--migration`
- раздел «3. Active workflows» — `apply-migrations.yml` и `deploy-functions.yml` помечены **DISABLED (no-op stub)**
- новый раздел «7. GitHub secrets policy»:
  - `SUPABASE_ACCESS_TOKEN` и `SUPABASE_DB_PASSWORD` в GitHub **не используются** ни одним workflow
  - старые значения (от ранее существовавшего ref) считаются мёртвыми; ротация — на усмотрение оператора, не блокирует ничего
- новый раздел «8. Webhook deploy moratorium»:
  - до ответа Lovable platform на issue (см. P4) **запрещён** agent-redeploy любых webhook-функций (`stripe-webhook`, `bepaid-webhook`, `telegram-webhook`, `payment-methods-webhook`, `auth-email-hook`, `instagram-webhook`, `getcourse-webhook`, `amocrm-webhook`)
  - статус `stripe-webhook`: **BLOCKED-BY-PLATFORM** (в текущем platform-401 после прошлой регрессии); не лечить
  - статус остальных 7 webhook: PASS (snapshot из `.lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md` секция A); не трогать

### P4. Lovable platform issue — готовый текст

Создать `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` с:
- статус: **ESCALATED, awaiting Lovable response**
- готовый текст для копипаста оператором в Lovable support:

```
Title: agent-deploy ignores per-function `verify_jwt = false` in supabase/config.toml

Project ref: hdjgkjceownmmnrqqtuz
Lovable project ID: 796a93b9-74cc-403c-8ec5-cafdb2a5beaa
Affected functions: all *-webhook (confirmed on stripe-webhook)

Expected: after agent-deploy, POST without signature to
  https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook
returns application-level 400 with body `signature_verification_failed`.

Observed: returns platform-level 401 with body
  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
This is the Supabase Functions Gateway JWT wall, injected because the
deploy did not apply per-function `verify_jwt = false` from
supabase/config.toml.

Reproduction (deterministic, 3 probes at t=0s/30s/2m all FAIL with the
same platform-401):
1. config.toml has `verify_jwt = false` for `stripe-webhook` (line 282)
2. Trigger agent-deploy of `stripe-webhook` only
3. POST without signature → platform-401

Proof attached: .lovable/proofs/stripe_phase_3_4_d2_bis_webhook_runtime_v1.md
Discovery:    .lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md

Requested workaround (any one):
(a) flag at agent-deploy time: "respect config.toml verify_jwt"
(b) per-function verify_jwt setting in Lovable Cloud UI
(c) gateway-level allowlist for webhook functions

Impact: Stripe webhook (and any redeployed webhook) is unreachable by
external providers until restored. We have no canonical recovery path
without this fix — CLI-based recovery via `supabase functions deploy
--all` is not available to us because the project is Lovable-managed
and we have no SUPABASE_ACCESS_TOKEN.

Phase 3.4 Runtime is FROZEN until Lovable responds.
```

- инструкция оператору: скопировать блок выше → отправить через Lovable support; исполнитель прямого канала не имеет.

### P5. Webhook deploy moratorium (вместо прежнего «попытка восстановления»)

**Не выполнять agent-redeploy webhook-функций.** Прежний P5 (попытка agent-redeploy `stripe-webhook` + smoke) **удалён из Execute** — он сам по себе является источником регрессии (доказано в `.lovable/discovery/stripe_webhook_redeploy_d2_bis_v1.md`).

Действия:
- зафиксировать `stripe-webhook` в текущем состоянии (platform-401) как **BLOCKED-BY-PLATFORM**
- не вызывать `supabase--deploy_edge_functions` ни для одной webhook-функции до ответа Lovable
- runtime-guard продолжает мониторить и алертить, но FAIL по `stripe-webhook` интерпретируется как known-blocked, а не как новая регрессия
- никаких дополнительных действий от оператора с Supabase secrets не требовать

---

## DR — Dry run

- **DR1.** `rg -n "SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD" .github/` — список всех мест, где workflow упоминают secrets
- **DR2.** `rg -n "apply-migrations|deploy-functions" .lovable/ docs/` — документы со ссылкой на старый recovery
- **DR3.** `supabase--project_info` + `supabase--cloud_status` — подтвердить ref и lifecycle
- **DR4.** **БЕЗ deploy** — только просмотр текущего состояния через существующий runtime guard (можно прочитать последний run `verify-webhook-runtime.yml`)

Результаты — в `.lovable/discovery/lovable_only_deploy_dry_run_v1.md`.

---

## E — Execute (после approve)

- **E1.** Применить P1 к `apply-migrations.yml`, `deploy-functions.yml` (и `functions-full-audit.yml` при необходимости) — no-op stub
- **E2.** Обновить тексты в `verify-webhook-runtime.yml` (recovery hint → moratorium)
- **E3.** Обновить `.lovable/architecture/canonical_infrastructure_v1.md` (разделы 2.1, 2.2, 3, новый 7, новый 8)
- **E4.** Создать `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` с готовым текстом issue
- **E5.** ~~Восстановление stripe-webhook~~ **УДАЛЕНО.** Заменено на: «Не выполнять agent-redeploy webhook-функций до ответа Lovable platform / появления безопасного deploy-механизма.»
- **E6.** Записать proof: `.lovable/proofs/lovable_only_deploy_model_v1.md` со статусом инфраструктуры (4 строки из «Главной цели»)

Изменения — только в `.github/workflows/`, `.lovable/`. Никаких изменений в коде edge functions, миграций, RLS, бизнес-логике. **Никаких agent-deploy.**

---

## V — Verify (Definition of Done)

- [ ] V1. В `.github/workflows/` ни один файл не использует `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` (`rg -n` пуст)
- [ ] V2. Попытка manual dispatch `apply-migrations.yml` / `deploy-functions.yml` сразу даёт `::error::GitHub deploy disabled for Lovable-managed Supabase. Use Lovable Cloud deploy only.` и завершается failure без обращения к секретам
- [ ] V3. **Actions UI больше не содержит автоматически падающих deploy workflow** (нет `push`-триггеров, нет `schedule`, нет `workflow_run` → нет фоновых красных запусков)
- [ ] V4. `verify-no-legacy-ref.yml` зелёный
- [ ] V5. `verify-webhook-public.yml` зелёный (git-state OK, `verify_jwt=false` сохранён)
- [ ] V6. `verify-webhook-runtime.yml` — 7/8 webhook PASS; `stripe-webhook` в known-blocked-platform состоянии, прописанном в документации (не считается регрессией)
- [ ] V7. `canonical_infrastructure_v1.md` обновлён: GitHub deploy = DISABLED, Lovable agent-deploy для webhook = BLOCKED-BY-PLATFORM, секреты не используются, moratorium зафиксирован
- [ ] V8. `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` создан с готовым текстом для копипаста
- [ ] V9. Proof `lovable_only_deploy_model_v1.md` зафиксирован с финальным статусом:
  ```
  Infrastructure model     = CLEAN
  GitHub deploy            = DISABLED
  Lovable webhook deploy   = BLOCKED-BY-PLATFORM
  Phase 3.4 Runtime        = FROZEN
  ```
- [ ] V10. Phase 3.4 G33–G40 явно помечен **FROZEN** (не FULL PASS, не unblocked)

---

## Что НЕ делается в этом плане

- **Не вызываем `supabase--deploy_edge_functions` ни для одной webhook-функции** (это и есть источник регрессии)
- Не пытаемся «восстановить» `stripe-webhook` — он остаётся BLOCKED-BY-PLATFORM до ответа Lovable
- Не трогаем код edge functions
- Не запускаем миграции
- Не меняем RLS, access, entitlements, telegram, live, dunning
- Не запрашиваем у оператора Supabase secrets и не требуем от него запускать GitHub Actions
- Не удаляем GitHub secrets — они просто становятся неиспользуемыми
- Не удаляем физически workflow-файлы (Вариант 1: no-op stub)
- Не удаляем старый Supabase project `ypwsuumurrtkxatoyqhk` (out of scope)
- Не пытаемся ставить Phase 3.4 в FULL PASS

---

## Ответы оператора (зафиксированы)

1. **P1 вариант:** Вариант 1 — no-op stub с сообщением «GitHub deploy disabled for Lovable-managed Supabase. Use Lovable Cloud deploy only.»
2. **P5 политика:** `stripe-webhook` остаётся BLOCKED-BY-PLATFORM. Не лечить через agent-redeploy. Никаких действий от оператора с Supabase secrets.
3. **Lovable platform issue:** исполнитель готовит полный текст + proof для копипаста; оператор отправляет через Lovable support.
