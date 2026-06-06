да, согласен, с учетом правок:

1. **Не делать V5 как acceptance**

V5 сейчас опасный:

```text
тестовый redeploy stripe-webhook через supabase--deploy_edge_functions
```

Именно agent-deploy ломает `verify_jwt=false`.

Заменить на:

```text
V5. Lovable agent-deploy для webhook-функций НЕ использовать до отдельного исправления deploy pipeline.
```

Если нужно проверить edge deploy — только на non-webhook функции или через безопасный канал, но не через `stripe-webhook`.

2. **P2 выбрать по умолчанию вариант C**

С учётом того, что GitHub Actions не имеет прав к Lovable Supabase, оптимальный default:

```text
C — оставить только read-only guard/smoke workflows,
а write/deploy workflows отключить или пометить как not available for Lovable-managed Supabase.
```

Вариант A возможен только после подтверждения Lovable/Supabase credentials.

3. **GitHub Actions не считать каноническим deploy path**

Канонический путь сейчас:

```text
Lovable Cloud
```

Но с ограничением:

```text
webhook-функции нельзя redeploy через agent-deploy без post-deploy smoke.
```

GitHub Actions — не канонический путь, пока нет валидных прав.

4. **Добавить пункт про эскалацию Lovable**

Нужен отдельный обязательный блок:

```text
Открыть/зафиксировать Lovable platform issue:
agent deploy ignores verify_jwt=false for webhook functions in managed Supabase.
```

DoD:

- issue/сообщение в Lovable support;
- приложены project_ref, function name, timestamps, proof 401;
- ожидаемое поведение: deploy обязан применять config.toml.

5. **Не добавлять memory URI вручную как обязательный артефакт**

`mem://...` можно заменить на обычный файл:

```text
.lovable/architecture/canonical_infrastructure_v1.md
```

Именно его считать source of truth.

6. **Stripe endpoints cleanup оставить как ручной контроль, но не блокировать code cleanup**

V7 разделить:

- V7a: список endpoint’ов получен;
- V7b: лишние endpoint’ы удалены пользователем.

Если пользователь пока не прислал Stripe Dashboard, не блокировать cleanup репозитория, но Phase 3.4 runtime не запускать до подтверждения webhook URL.

7. **Добавить явное решение по старому Supabase**

Если `ypwsuumurrtkxatoyqhk` — личный старый Supabase:

```text
не деплоить туда;
не использовать в workflows;
не использовать в env;
не удалять проект физически без отдельного подтверждения пользователя.
```

После этих правок план можно принимать.

&nbsp;

План: Infrastructure Cleanup — удалить конфликт двух Supabase контуров

Stripe Phase 3.4 Runtime G33–G40 — заморожен до завершения этого плана.

## Цель

Оставить единственным рабочим Supabase project_ref = `hdjgkjceownmmnrqqtuz` (Lovable Cloud). Полностью устранить любые следы старого ref `ypwsuumurrtkxatoyqhk` и зафиксировать единственный канонический путь деплоя edge functions.

## Контекст (известное на сейчас)

- Lovable Cloud project_ref: `hdjgkjceownmmnrqqtuz` — управляется Lovable, у пользователя нет прямого доступа к Supabase Dashboard.
- В `.github/workflows/apply-migrations.yml` ref уже исправлен (предыдущий патч).
- Grep по репозиторию: `ypwsuumurrtkxatoyqhk` не встречается (подтверждено в прошлой итерации).
- Канонический путь деплоя в Lovable Cloud — внутренний agent-deploy (Lovable → Supabase). GitHub Actions → Supabase CLI — параллельный путь, который требует валидных `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` для целевого ref.

## Diagnose (этап 1, read-only)

D

1. Полный аудит репозитория на старый ref.
  - `rg -n 'ypwsuumurrtkxatoyqhk' -uu` по всему дереву (включая dot-файлы, скрипты, миграции, `.lovable/`, `docs/`, `supabase/`, `scripts/`).
  - Аудит на «битые» project_ref паттерны: `rg -n 'project[-_ ]?ref' .github supabase scripts docs`.

D

2. Аудит всех workflow-файлов `.github/workflows/*.yml`:
  - какой `PROJECT_REF` / `SUPABASE_PROJECT_REF` / URL используется;
  - какие secrets читаются (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`);
  - какие из них реально работали последние 30 дней (по run history в GitHub — потребует от пользователя).

D

3. Аудит frontend env:
  - `.env` (autogen) — проверить `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
  - `src/integrations/supabase/client.ts` — read-only проверка, что использует только `import.meta.env.VITE_SUPABASE_*`.
  - `supabase/config.toml` — `project_id`.

D

4. Аудит edge functions:
  - `rg -n 'functions\.supabase\.co|supabase\.co' supabase/functions` — найти любые хардкод-URL.
  - Особое внимание: `stripe-webhook`, `bepaid-webhook`, `telegram-webhook`, `payment-methods-webhook`, `auth-email-hook`, любые callback-URL.

D

5. Аудит Stripe webhook endpoints (требует ручной проверки в Stripe Dashboard пользователем):
  - Список всех зарегистрированных endpoint URL.
  - Ожидаемо допустимый: `https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook`.
  - Всё остальное — кандидат на удаление.

D

6. Lovable integrations / connectors:
  - Cloud — единственный backend; подтвердить через `supabase--project_info` / `cloud_status`.
  - Список connectors (если есть) — на предмет «второго» Supabase.

## Plan (этап 2)

P

1. Зафиксировать канонический путь деплоя:
  - Основной: Lovable → Supabase (agent-deploy через инструмент `supabase--deploy_edge_functions`). Автоматический, не требует GitHub.
  - Вторичный (опциональный): GitHub Actions `apply-migrations.yml` — только если у пользователя есть `SUPABASE_ACCESS_TOKEN` и `SUPABASE_DB_PASSWORD` для Lovable-managed Supabase. Если нет — workflow отключается.

P

2. Решение по GitHub Actions deploy (требует решения пользователя):
  - Вариант A — оставить как backup: проверить, что secrets валидны для `hdjgkjceownmmnrqqtuz`. Если валидны — оставить, добавить guard «hard-fail если project_ref ≠ hdjgkjceownmmnrqqtuz».
  - Вариант B — отключить полностью: переименовать `apply-migrations.yml` → `apply-migrations.yml.disabled` (или удалить `workflow_dispatch`), чтобы он не появлялся в Actions UI и не давал ложных красных запусков.
  - Вариант C — оставить только `verify-webhook-runtime.yml` (read-only smoke) и `verify-webhook-public.yml` (config guard). Они безопасны и не пишут.

P

3. Cleanup-патч (исполняется после выбора варианта):
  - Удалить любые найденные на этапе D следы `ypwsuumurrtkxatoyqhk` (ожидаемо — 0).
  - Добавить CI-guard `verify-no-legacy-ref.yml`: `rg -q 'ypwsuumurrtkxatoyqhk' && exit 1`.
  - Зафиксировать в `mem://architecture/infrastructure/canonical-supabase-ref` правило: «единственный валидный project_ref = `hdjgkjceownmmnrqqtuz`; legacy `ypwsuumurrtkxatoyqhk` запрещён».

P

4. Stripe endpoints cleanup (пользователь):
  - Удалить в Stripe Dashboard все webhook endpoints кроме `https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook`.
  - Прислать список оставшихся для фиксации в proof.

## Dry run (этап 3)

DR1. Прогнать grep'ы из D1, D2, D4 и приложить полный вывод в отчёт (ожидаемо: пусто по legacy ref).
DR2. Прогнать `supabase--project_info` и `cloud_status` для подтверждения единственного backend.
DR3. Сформировать proof-файл `.lovable/proofs/infrastructure_cleanup_dry_run.md` с таблицей: файл → найденный ref → действие.

## Execute (этап 4)

E

1. Применить выбранный вариант P2 (A/B/C) одним коммитом.

E

2. Если есть реальные находки — отдельные коммиты per-file.

E

3. Добавить `.github/workflows/verify-no-legacy-ref.yml` (P3 guard).

E

4. Записать memory `mem://architecture/infrastructure/canonical-supabase-ref`.

## Verify (этап 5, DoD)

V

1. `rg 'ypwsuumurrtkxatoyqhk' -uu` → 0 совпадений.

V

2. Все workflow'ы в `.github/workflows/*.yml` либо ссылаются на `hdjgkjceownmmnrqqtuz`, либо отключены.

V

3. `supabase/config.toml` → `project_id = "hdjgkjceownmmnrqqtuz"`.

V

4. `.env` → `VITE_SUPABASE_URL` указывает на `hdjgkjceownmmnrqqtuz.supabase.co`.

V

5. Edge functions деплоятся через Lovable agent-deploy без ошибок (тестовый redeploy `stripe-webhook` через `supabase--deploy_edge_functions`).

V

6. `verify-webhook-runtime.yml` проходит с PASS: POST на `stripe-webhook` без подписи → HTTP 400 `signature_verification_failed`, не 401.

V

7. Stripe Dashboard содержит только канонический webhook URL (подтверждение пользователя — скриншот/список).

V

8. Memory обновлена; proof-файл закоммичен.

## Что требуется от пользователя

U

1. Решение по P2: вариант A, B или C.

U

2. Список текущих webhook endpoints в Stripe Dashboard (скриншот или текст) для V7.

U

3. Подтверждение, есть ли у GitHub workflow валидные `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` для Lovable Cloud — без них вариант A невозможен.

## Что НЕ делается в этом плане

- Никаких изменений в edge functions stripe-* / bepaid-* / telegram-*.
- Никаких миграций БД.
- Никакого запуска Phase 3.4 Runtime G33–G40 до полного PASS этого плана.
- Никаких изменений в `src/integrations/supabase/client.ts` и `src/integrations/supabase/types.ts`.

## DoD

Все пункты V1–V8 — PASS. Отчёт о выполнении с приложенными grep-выводами, ссылками на коммиты и подтверждением Stripe endpoints.