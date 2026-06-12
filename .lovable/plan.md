да, согласен, с учетом правок:

Все пункты плана сохраняются. Ниже — обязательные add-only уточнения перед выполнением Approve E.

**1. Recovery artifact нельзя хранить только в**

**/tmp**

/tmp/stripe-webhook_recovery/ допустим только как рабочая копия текущего запуска. Он не является надёжным recovery source: окружение может очиститься или смениться между deploy и восстановлением.

До deploy сохранить полный предыдущий dependency closure также в постоянный repo-artifact, например:

.lovable/recovery/stripe-webhook/2026-06-12/

Включить:

- stripe-webhook/index.ts;
- все рекурсивно импортируемые локальные _shared/*;
- supabase/config.toml;
- import map / deno.json / lockfile, если они влияют на сборку;
- manifest с SHA-256 каждого файла и aggregate hash;
- подтверждённый source commit/reference.

Recovery source не должен содержать secrets и не должен попадать в bundle функции.

Если точный предыдущий production dependency closure не найден:

Approve E = BLOCKED_NO_RECOVERY_SOURCE

&nbsp;

**2. Текущий HEAD и Approve A proof не доказывают previous production bundle**

Previous manifest нельзя строить из текущего HEAD, потому что в нём уже находится новый card-enrichment код.

Нужно доказать соответствие предыдущей production-версии через один или несколько независимых источников:

- deployment/version metadata;
- точный git commit последнего deploy;
- предыдущий proof с file hashes;
- сохранённый source snapshot;
- Lovable/Supabase deployment history.

Если доказан только index.ts, но не соответствующие ему shared dependencies, recovery gate не пройден.

&nbsp;

**3. Runtime fixture должен быть доказуемо test-mode**

До отправки событий зафиксировать:

Stripe event.livemode = false

account_code = test connection

fixture marker присутствует в metadata

созданные DB rows однозначно связаны с test event IDs

Маркер meta.test_payment=true должен фактически переноситься в локальные строки. Нельзя только предполагать его наличие.

Перед runtime убедиться, что fixture:

- не связан с production offer/payment link;
- не выдаёт entitlements/access;
- не создаёт production-документы;
- не увеличивает production payment_links.current_uses;
- не смешивается с live Stripe account.

Если изоляция конкретного события не доказана — событие не запускать и фиксировать NOT EXECUTED.

&nbsp;

**4. Разделить два уровня идемпотентности корректно**

Повтор одного и того же event_id доказывает только:

event-level idempotency

Такой event может быть остановлен в provider_events до вызова card writer, поэтому он не доказывает writer-level skipped_complete.

Writer-level идемпотентность подтвердить отдельным способом:

- двумя разными Stripe event IDs, относящимися к одному PaymentIntent/payment row, например:
- либо другим безопасным повторным source-event по той же оплате.

Ожидание:

первый distinct event → updated

второй distinct event → skipped_complete или non-destructive merge

replay того же event_id → event duplicate guard

В proof эти результаты показать раздельно.

&nbsp;

**5. Failure injection для**

**invoice.paid**

**не должна создавать новый риск**

Не подделывать Stripe-signed event и не менять secrets/runtime-конфигурацию ради искусственного падения enrichment.

Runtime failure test разрешён только при наличии полностью изолированного test-mode fixture, который гарантированно не затрагивает коммерческий lifecycle.

Если безопасно создать invoice.paid с недоступным PaymentMethod невозможно:

- подтвердить non-fatal поведение integration/unit test;
- в runtime proof указать:
- не фабриковать runtime PASS.

Успешный runtime invoice.paid по-прежнему обязателен для общего Approve E = PASS.

&nbsp;

**6. Привести проверки**

**network**

**к единому контракту**

network не является PCI-полем, но оно запрещено утверждённым canonical snapshot.

Поэтому выполнить две разные проверки:

**PCI denylist**

number

pan

cvc

cvv

exp_month

exp_year

fingerprint

**Canonical-shape guard**

network

card_holder внутри meta/audit

любые поля вне утверждённого whitelist

Ожидаемо:

0 PCI forbidden keys

0 network keys в card snapshot

0 card_holder в meta/audit

&nbsp;

**7. Deployment metadata не выдумывать**

Если supabase--deploy_edge_functions не возвращает deployment ID или version, в proof записать:

- полный фактический ответ deploy tool;
- timestamp;
- source aggregate hash;
- function name;
- post-deploy runtime evidence.

Не создавать искусственный deployment ID.

Новый bundle считать подтверждённым только совокупностью:

deploy tool success

+ proposed source hash

+ post-deploy public smoke

+ фактическое новое card-enrichment поведение

&nbsp;

**Итоговый gate**

PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve D = PASS

Approve E controlled stripe-webhook redeploy = APPROVED с указанными условиями

Historical card backfill = NOT APPROVED

Admin single/bulk deploy = NOT APPROVED в рамках Approve E

После выполнения остановиться и вернуть только фактический verdict:

Approve E = PASS

Approve E = PARTIAL

Approve E = FAIL-RECOVERED

Approve E = FAIL-NOT-RECOVERED

Approve E = BLOCKED_NO_RECOVERY_SOURCE

&nbsp;

# План: PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 / Approve E — controlled redeploy `stripe-webhook`

Scope: ровно одна функция — `stripe-webhook`. Никакие другие функции, миграции, RPC, schema, secrets, Stripe endpoint URL/events, historical backfill — не трогаются. Канонический протокол: `.lovable/architecture/public_webhook_controlled_redeploy_protocol_v1.md`.

## Шаг 0 — Recovery source gate (BLOCKING)

До любых действий доказать, что recoverable source текущего deployed production bundle существует.

- Прочитать текущий `supabase/functions/stripe-webhook/index.ts` и весь импортируемый closure (`_shared/stripe/card-enrichment.ts`, `_shared/stripe/card-extract.ts`, любые другие `_shared/*` импорты), `supabase/config.toml` block `[functions.stripe-webhook]`.
- Построить **Previous bundle manifest** (фиксирует прежний production state — то, что задеплоено сейчас, ДО Approve B-кода):
  - список файлов dependency closure;
  - sha256 каждого файла;
  - aggregate sha256;
  - git commit reference последнего production deploy `stripe-webhook` (из chat/proofs PATCH-STRIPE-CARD-DATA-ENRICHMENT-V2 Approve A baseline);
  - подтверждение, что эти исходники соответствуют текущему deployed bundle (через сопоставление с baseline Approve A, не через blind trust текущего HEAD).
- Сохранить immutable artifact: копии файлов в `/tmp/stripe-webhook_recovery/<file>` + manifest `.lovable/proofs/stripe_webhook_recovery_manifest_2026_06_12.md` с hash-ами и путями.
- Если соответствие previous deployed bundle не доказывается → **STOP, Approve E = BLOCKED_NO_RECOVERY_SOURCE**, deploy не выполнять.

## Шаг 1 — Sanitizer audit (правка к плану)

Read-only проверка `_shared/stripe/card-enrichment.ts` / `card-extract.ts`:

- whitelist sanitizer = ровно `{brand, last4, wallet.type, funding, country}`;
- поле `network` НЕ присутствует в whitelist, writer, tests, types;
- если найдено `network` — удалить из sanitizer/tests до deploy (минимальный code change, без бизнес-логики), повторно гонять tests;
- canonical snapshot shape:
  ```
  { type: "card", card: { brand, last4, wallet: {type}, funding, country } }
  ```

## Шаг 2 — Proposed bundle manifest и diff

- **Proposed bundle manifest**: те же поля, что и previous, но для текущего HEAD после Шаг 1.
- В proof — exact file-by-file diff между previous и proposed manifests (имена файлов, hash before/after, минимальный текстовый diff по изменённым файлам).
- Подтверждение: единственный card writer = `_shared/stripe/card-enrichment.ts`, inline card writers в `stripe-webhook/index.ts` отсутствуют.

## Шаг 3 — Pre-deploy gate

- `supabase/config.toml` содержит `[functions.stripe-webhook]` `verify_jwt = false`;
- `bunx vitest run` для затронутых тестов = 20/20 PASS (или эквивалент скоупа Approve B);
- build/typecheck clean (через harness);
- migrations/RPC/schema/secrets не менялись (grep по `supabase/migrations` — пусто за период патча);
- Stripe endpoint URL и enabled_events не менялись (read `stripe-ensure-webhook` canonical events, без модификации);
- deployment scope ровно `["stripe-webhook"]`.

## Шаг 4 — Pre-smoke текущего bundle (×3)

POST без Supabase JWT в `https://hdjgkjceownmmnrqqtuz.functions.supabase.co/stripe-webhook` в `t=0 / 30s / 2m`. Зафиксировать HTTP, body, headers, `sb-request-id`, `x-deno-execution-id`. PASS = application-level `signature_verification_failed`, отсутствие `UNAUTHORIZED_NO_AUTH_HEADER` / `Missing authorization header` / `Invalid JWT`. На FAIL — STOP, deploy не выполнять.

## Шаг 5 — Deploy

`supabase--deploy_edge_functions(["stripe-webhook"])`. Зафиксировать deployment id, `deployed_at`, proposed aggregate hash, expected `verify_jwt=false`.

## Шаг 6 — Post-deploy auth smoke (×3)

Те же три точки. PASS только при:

- application-level signature error от функции;
- отсутствие platform JWT markers во всех трёх probes;
- невалидная `Stripe-Signature` отклоняется самой функцией.

На FAIL → Шаг 14 (recovery).

## Шаг 7 — Stripe Dashboard delivery (раздельно)

Два независимых proof:

1. **Synthetic invalid-signature smoke** — ожидаемо `400 signature_verification_failed`.
2. **Real signed Stripe delivery** — через Stripe Dashboard `Send test webhook` (test mode) на live endpoint. PASS: 2xx (предпочт. 200), не 401, не signature error, Stripe Dashboard статус delivery = success.

## Шаг 8 — Runtime proof на изолированных test-mode событиях

Использовать Stripe test mode и подготовленные fixtures (с маркером `meta.test_payment=true`, без выдачи коммерческого access). Для каждого source path — отдельный event с фиксацией `event_id`:

- `checkout.session.completed`
- `payment_intent.succeeded`
- `invoice.paid`

Допустима одна контролируемая test subscription chain, покрывающая все три handler. Если какой-то event безопасно получить нельзя — фиксировать `NOT EXECUTED`, объявлять **Approve E = PARTIAL**.

Запрещено: реальные entitlements/access, production-документы, инкремент `payment_links.current_uses`, смешение test/live, code-inspection вместо runtime.

## Шаг 9 — Runtime card snapshot (read-only)

Через `supabase--read_query` показать для каждого test payment row:

- `payments_v2.card_brand / card_last4 / card_holder`;
- `meta.stripe.payment_method_details.{type, card.brand, card.last4, card.wallet.type, card.funding, card.country}`;
- `meta.stripe.{payment_method_id, charge_id, payment_intent_id, card_data_source, card_data_sources_seen, card_data_fetched_at}`.

Проверки:

- запрещённых полей (`number/pan/cvc/cvv/exp_month/exp_year/fingerprint/network`) нет;
- event без wallet не стёр существующий wallet;
- `card_data_sources_seen` дедуплицирован;
- NULL не затёр непустые значения;
- `card_holder` не попал в `meta` или `audit_logs`.

В proof маскировать last4 и ФИО (`*1234`, `И. И.`).

## Шаг 10 — Idempotency (двухуровневый)

Повторная доставка того же `event_id` для каждого из трёх handler. Проверить:

- **Event-level**: дубликат payment row не создан, дубликат order не создан, access/grant не выдан повторно;
- **Writer-level**: card writer возвращает `skipped_complete` (или эквивалент), snapshot не переписан без необходимости.

Зафиксировать оба уровня раздельно в proof.

## Шаг 11 — `invoice.paid` lifecycle proof

Отдельный блок proof:

- `onInvoicePaid` resolved/materialized `payment_id`;
- card enrichment отработал;
- payment не материализован повторно;
- order не создан повторно;
- subscription lifecycle не изменён повторно;
- entitlement/access не выданы повторно;
- `payment_links.current_uses` не увеличился;
- enrichment failure (имитировать через test event с PM, недоступным для retrieve) НЕ откатывает основной successful lifecycle.

## Шаг 12 — Targeted lifecycle invariants (before/after)

Diff только по test fixture IDs / event IDs / временному окну / `meta.test_payment=true`:

`orders_v2`, `payments_v2`, `subscriptions_v2`, `provider_subscriptions`, `entitlements`, `access_rules`, `payment_links.current_uses`, `ai_generated_documents`.

Разрешены только ожидаемые fixture rows и card snapshot updates. Глобальные counts не требуются.

## Шаг 13 — bePaid regression

- `bepaid-webhook` НЕ деплоится;
- внешний POST без JWT → application-level signature/auth response (smoke);
- bundle/version `bepaid-webhook` не менялся;
- контрольный bePaid payment row не обновлялся в окне теста;
- Stripe card writer не вызывается для `provider='bepaid'` (code-level grep + runtime check по `audit_logs`).

Фиктивные bePaid events не отправлять.

## Шаг 14 — PCI scans

SQL запросы (`->`-pathing, корректные скобки) по denylisted JSON keys в:

- `payments_v2.meta` where `provider='stripe'`;
- `audit_logs.meta` для `stripe/admin.stripe.*` actions;
- `provider_subscriptions.meta` where `provider='stripe'`.

Keys: `number, pan, cvc, cvv, exp_month, exp_year, fingerprint`. Ожидание: 0 rows на каждый ключ. PAN-regex — supplementary, основное доказательство = key-denylist + sanitizer unit tests.

## Шаг 15 — Recovery procedure (если потребуется)

При platform JWT failure или критической runtime regression:

1. STOP, не деплоить другие функции.
2. Восстановить полный previous manifest из `/tmp/stripe-webhook_recovery/` в репозиторий (все файлы closure, не только `index.ts`).
3. `supabase--deploy_edge_functions(["stripe-webhook"])`.
4. Повторить smoke `t=0/30s/2m` + real Stripe Dashboard delivery.
5. На PASS recovery → запись в local moratorium register (`lovable_agent_deploy_verify_jwt_regression.md`), статус **Approve E = FAIL-RECOVERED**.
6. На FAIL recovery → **Approve E = FAIL-NOT-RECOVERED**, эскалировать.

## Шаг 16 — Proof artifact

`.lovable/proofs/stripe_webhook_controlled_redeploy_2026_06_12.md` содержит:

1. Previous bundle manifest (+ ссылка на `stripe_webhook_recovery_manifest_2026_06_12.md`).
2. Proposed bundle manifest.
3. Exact diff (file-by-file).
4. Config proof (`verify_jwt=false`, tests, build, scope).
5. Pre-smoke ×3.
6. Deployment metadata.
7. Post-smoke ×3.
8. Synthetic invalid-signature result.
9. Real signed Stripe Dashboard delivery (2xx).
10. Runtime event IDs по трём source-path (или `NOT EXECUTED`).
11. Before/after card snapshot (masked).
12. Event-level + writer-level idempotency.
13. `invoice.paid` lifecycle proof.
14. Targeted lifecycle invariants (fixture-scoped diff).
15. bePaid regression.
16. PCI scans (0 forbidden keys).
17. Recovery readiness/result.
18. Подтверждение отсутствия historical backfill.

## Возможные verdict'ы

- **Approve E = PASS** — все шаги PASS, три source-path покрыты runtime.
- **Approve E = PARTIAL** — какой-то из source-path помечен `NOT EXECUTED` (нельзя безопасно сгенерировать test event).
- **Approve E = FAIL-RECOVERED** — post-smoke/runtime FAIL, recovery успешен, функция в local moratorium register.
- **Approve E = FAIL-NOT-RECOVERED** — recovery не удался, эскалация Lovable.
- **Approve E = BLOCKED_NO_RECOVERY_SOURCE** — Шаг 0 не пройден, deploy не выполнялся.

## Out of scope (явно)

- `bepaid-webhook`, `telegram-webhook`, `payment-methods-webhook`, `auth-email-hook`, `getcourse-webhook`, `amocrm-webhook`, `instagram-webhook`, `public-webhook-deploy-probe` — не деплоятся.
- `stripe-card-data-fetch`, `stripe-card-data-fetch-bulk` — не деплоятся (Approve C, отдельный gate).
- Historical card backfill — запрещён.
- Migrations, RPC, schema, secrets, Stripe endpoint config — не менять.
- Global moratorium lift — не выполняется, остаётся CONDITIONAL CONTROLLED DEPLOYMENT.

После выполнения — остановиться и вернуть один из verdict'ов выше.