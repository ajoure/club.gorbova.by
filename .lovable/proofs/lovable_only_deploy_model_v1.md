# Proof: Lovable-only Supabase Deploy Model (v1)

Дата: 2026-06-06
План: `.lovable/plan.md` (Lovable-only Supabase Deploy Model, v2 — финальный)

## Финальный статус инфраструктуры

```
Infrastructure model     = CLEAN
GitHub deploy            = DISABLED (no-op stub)
Lovable webhook deploy   = BLOCKED-BY-PLATFORM
Phase 3.4 Runtime        = FROZEN
```

## Что сделано

| # | Артефакт | Изменение |
|---|---|---|
| E1 | `.github/workflows/apply-migrations.yml` | Превращён в no-op stub: `workflow_dispatch` only, один шаг `exit 1` с сообщением «GitHub deploy disabled for Lovable-managed Supabase. Use Lovable Cloud deploy only.» Все ссылки на `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` удалены. |
| E1 | `.github/workflows/deploy-functions.yml` | То же. Удалены: `push`-триггер (был уже), `validate project ref`, `lint guards`, `registry deploy`, smoke / canary / wait-until-ready шаги, любые env-блоки с секретами. |
| E1 | `.github/workflows/functions-full-audit.yml` | Не тронут. Уже manual-only (`workflow_dispatch`), не требует `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD`, использует только `SUPABASE_URL` для read-only audit. |
| E2 | `.github/workflows/verify-webhook-runtime.yml` | Recovery hint в FAIL-ветке заменён: «Lovable agent-deploy is currently BLOCKED-BY-PLATFORM. Do NOT trigger agent-redeploy of webhook functions.» |
| E3 | `.lovable/architecture/canonical_infrastructure_v1.md` | Раздел 2.1 (webhook = BLOCKED-BY-PLATFORM), 2.2 (миграции только через Lovable), 3 (workflow-таблица обновлена), новый раздел 7 (GitHub secrets policy), новый раздел 8 (Webhook deploy moratorium). |
| E4 | `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` | Создан с готовым текстом issue для копипаста оператором в Lovable support. |
| E5 | — | **НЕ выполнялось.** Agent-redeploy webhook-функций заблокирован моратарием. |
| E6 | `.lovable/proofs/lovable_only_deploy_model_v1.md` | Этот файл. |

## Verify (DoD)

- [x] **V1.** В `.github/workflows/` ни один файл не использует `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD`. Подтверждено: `rg -n "SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD" .github/` после правок не находит ничего, кроме комментариев в шапках stub-файлов.
- [x] **V2.** Manual dispatch `apply-migrations.yml` / `deploy-functions.yml` — единственный шаг печатает `::error::GitHub deploy disabled for Lovable-managed Supabase.` + `Use Lovable Cloud deploy only.` и `exit 1`. Никакого обращения к секретам.
- [x] **V3.** Actions UI больше не создаёт автоматически падающих deploy-запусков. У обоих stub'ов **только `workflow_dispatch`** — нет `push`, `schedule`, `workflow_run`. Background red runs невозможны.
- [x] **V4.** `verify-no-legacy-ref.yml` не тронут, продолжает гарантировать отсутствие legacy ref.
- [x] **V5.** `verify-webhook-public.yml` не тронут, продолжает гарантировать `verify_jwt=false` в `config.toml`.
- [x] **V6.** `verify-webhook-runtime.yml` — мониторинг продолжается, FAIL по `stripe-webhook` трактуется как known-blocked-platform (документировано в canonical_infrastructure_v1.md §8 и в выводе самого workflow при FAIL).
- [x] **V7.** `canonical_infrastructure_v1.md` обновлён в полном объёме.
- [x] **V8.** Backlog-файл с готовым текстом для копипаста создан.
- [x] **V9.** Этот proof-файл зафиксирован.
- [x] **V10.** Phase 3.4 G33–G40 явно помечен **FROZEN** в `canonical_infrastructure_v1.md` §8.

## Что НЕ делалось (по требованию плана)

- Не вызывали `supabase--deploy_edge_functions` ни для одной функции.
- Не пытались «восстановить» `stripe-webhook`.
- Не трогали код edge functions, миграций, RLS, бизнес-логику.
- Не запрашивали Supabase secrets у оператора.
- Не удаляли GitHub secrets (off-scope, policy: считать мёртвыми).
- Не удаляли физически workflow-файлы (Вариант 1: no-op stub).
- Не пытались ставить Phase 3.4 в FULL PASS.

## Что делать дальше (оператор)

1. Скопировать блок из `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md`
   («Copy-paste text for Lovable support») и отправить через Lovable support.
2. Дождаться ответа Lovable platform с одним из workaround'ов (a/b/c).
3. После появления безопасного механизма deploy для webhook — снять
   мораторий §8 и выполнить разовое восстановление `stripe-webhook`.
4. Только после стабильного PASS runtime guard — разморозить Phase 3.4
   Runtime G33–G40.
