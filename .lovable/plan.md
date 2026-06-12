# дополни план следующей информацией:

План в целом правильный, но сейчас в нём есть два опасных вывода: из текущей публичной доступности функций нельзя определить, какой именно дефолт использует **новый** agent-deploy, а контролируемо передеплоивать даже «некритичный» существующий webhook нельзя без доказанного rollback. Безопаснее проверить deploy-механизм на отдельной временной canary-функции внутри того же Supabase.

Дополни план следующей информацией:

# **1. Исправить вывод о текущем дефолте agent-deploy**

Факт:

```text
все 8 действующих webhook сейчас доступны без Supabase JWT
```

доказан внешними POST-запросами.

Но из этого нельзя делать вывод:

```text
фактический дефолт нового Lovable agent-deploy сейчас verify_jwt=false
```

Причина: действующие функции могли быть опубликованы:

- более старой версией deploy-инструмента;
- до появления регрессии;
- с сохранённой платформенной настройкой;
- иным внутренним Lovable deployment path;
- до текущего состояния `config.toml`.

Корректная формулировка discovery:

```text
CURRENT DEPLOYED STATE:
8 webhook-функций сейчас публично достижимы и не находятся за Supabase JWT-wall.

CURRENT AGENT-DEPLOY BEHAVIOR:
не доказано; требует отдельного controlled canary redeploy.
```

Не помечать мораторий ошибочным до controlled deploy proof.

---

# **2. Различать application-level 401 и platform-level 401**

Для каждого smoke фиксировать:

```text
HTTP status
response body
response headers
platform request id
function-specific error marker
```

Application-level ответы вроде:

```text
Invalid signature
Unauthorized / no_instance_id
```

означают, что запрос дошёл до функции.

Platform-level блокер:

```text
UNAUTHORIZED_NO_AUTH_HEADER
Missing authorization header
Invalid JWT
```

возникает до выполнения пользовательского кода.

Proof должен классифицировать ответы именно по телу/заголовкам, а не только по HTTP-коду.

---

# **3. Не передеплоивать существующий webhook на этапе C1**

`instagram-webhook` или `getcourse-webhook` нельзя считать безопасными только потому, что они не участвуют в Stripe lifecycle.

До передеплоя пришлось бы доказать:

- отсутствие реального трафика;
- отсутствие активных интеграций;
- отсутствие scheduled/retry calls;
- наличие исходного bundle;
- рабочий способ отката.

Сейчас rollback не доказан.

Поэтому вместо существующей функции создать временную canary Edge Function в том же Lovable-managed Supabase:

```text
public-webhook-deploy-probe
```

Это не Stripe/bePaid webhook, не внешний сервис и не параллельная платёжная инфраструктура.

Функция должна:

- не читать и не писать БД;
- не использовать secrets;
- не иметь бизнес-логики;
- отвечать фиксированным JSON:
- иметь явный блок:

```toml
[functions.public-webhook-deploy-probe]
verify_jwt = false
```

После завершения проверки canary удалить отдельным cleanup-step либо оставить выключенной до закрытия proof.

Это безопаснее, чем рисковать существующим webhook без recovery path.

---



# **4. Этап B — явный**

`config.toml`

Добавление блоков допустимо, но перед записью проверить точный синтаксис, который поддерживает текущий Lovable/Supabase runtime.

Добавить явные блоки для подтверждённых внешних webhook:

```toml
[functions.stripe-webhook]
verify_jwt = false
```

Аналогично для остальных семи функций.

Но не утверждать, что наличие блока гарантирует применение настройki agent-deploy. Это только **expected configuration**.

В proof разделить:

```text
expected auth config — из config.toml
actual runtime behavior — из внешнего smoke
```

Если deploy API не возвращает фактический auth-флаг, не писать, что он его вернул. В таком случае источником фактического результата считается внешний smoke.

---

# **5. CI guard не является deploy-механизмом**

Правка `.github/workflows/verify-webhook-public.yml` допустима только как статическая проверка репозитория.

Явно указать:

```text
GitHub Actions не деплоит функции.
GitHub Actions не меняет Supabase.
Workflow только проверяет наличие expected config в репозитории.
```

Guard должен:

- проверять обязательный список публичных функций;
- падать при отсутствии блока;
- падать, если `verify_jwt` не равен `false`;
- не утверждать фактический runtime state;
- не содержать Supabase secrets;
- не выполнять deploy.

Нужно переименовать смысл проверки, например:

```text
Verify expected public webhook configuration
```

а не «verify actual public webhook».

---

# **6. Исправить controlled deploy protocol**

Новый порядок этапа C:

## **C1. Pre-smoke canary до deploy**

До первого deploy URL может отсутствовать — это ожидаемо.

Зафиксировать:

- исходный source hash;
- `config.toml` block;
- отсутствие БД/secrets;
- код фиксированного ответа.

## **C2. Deploy только canary**

Через Lovable agent:

```text
public-webhook-deploy-probe
```

Никакие существующие webhook не трогать.

## **C3. Post-smoke**

Внешний POST без Supabase JWT:

```text
t=0
t=30 секунд
t=2 минуты
```

Ожидаемо:

```json
{"ok":true,"probe":"public-webhook-deploy-v1"}
```

Если появляется platform JWT error:

```text
D-broken
```

Если запрос доходит до функции во всех трёх точках:

```text
D-stable-candidate
```

## **C4. Повторный redeploy canary**

Одного первого deploy недостаточно, потому что проблема связана именно с redeploy.

Изменить только безопасный marker ответа:

```json
{"ok":true,"probe":"public-webhook-deploy-v2"}
```

Повторно задеплоить canary и повторить smoke:

```text
t=0
t=30 секунд
t=2 минуты
```

Только если **первый deploy и повторный redeploy** сохранили публичность, считать регрессию невоспроизведённой.

---

# **7. D-stable не означает безусловную безопасность**

После canary PASS присвоить статус:

```text
D-stable-candidate
```

Затем выполнить второй контрольный gate на webhook, который:

- точно не имеет live-трафика;
- имеет сохранённый исходный код;
- имеет проверенный способ повторного deploy предыдущего source;
- одобрен отдельно.

Если такого webhook нет, не рисковать существующими функциями и переходить сразу к отдельному approve на `stripe-webhook` только с усиленным pre/post protocol и owner approval.

Нельзя обещать «автоматический rollback», пока не доказано, что Lovable agent умеет восстановить предыдущую версию и правильный auth-mode.

Корректная формулировка:

```text
При failed smoke — STOP, alert, запрет дальнейших deploy.
Rollback выполняется только если заранее доказан recovery path.
```

---

# **8. Recovery path — отдельный обязательный gate**

До redeploy `stripe-webhook` доказать один из вариантов:

1. Lovable позволяет повторно развернуть сохранённый предыдущий source bundle.
2. Доступен deployment history rollback внутри Lovable/Supabase.
3. Есть подтверждённый операторский recovery без GitHub и внешнего сервера.

Proof должен содержать:

```text
previous source snapshot
previous deployment/version, если доступно
команда/действие recovery
результат теста recovery на canary
```

На canary нужно реально проверить:

```text
deploy v1
deploy v2
restore v1
external smoke показывает v1
```

Без успешного canary recovery:

```text
stripe-webhook redeploy = NOT APPROVED
```

---

# **9. Не снимать мораторий глобально после одного теста**

После успешного canary не заменять мораторий на безусловное разрешение всех webhook-deploy.

Ввести controlled protocol:

```text
PUBLIC WEBHOOK DEPLOY — CONDITIONAL
```

Для каждого webhook отдельно обязательны:

- явный `verify_jwt=false`;
- source snapshot;
- dependency/diff scope;
- pre-smoke;
- deploy;
- post-smoke;
- application-signature smoke;
- lifecycle regression;
- recovery proof или STOP.

Мораторий можно снять только для конкретной функции после её собственного PASS.

---

# **10. Этап E — Stripe webhook**

Только после:

```text
canary first deploy PASS
canary redeploy PASS
canary recovery PASS
config guard PASS
```

подготовить отдельный approve E.

Перед redeploy `stripe-webhook`:

1. Сохранить текущий source/runtime snapshot.
2. Убедиться, что Stripe Dashboard endpoint не меняется.
3. Проверить текущий внешний POST:
4. Задеплоить только `stripe-webhook`.
5. Немедленно проверить:
  - без Supabase JWT запрос доходит до функции;
  - неверная Stripe-подпись отклоняется самой функцией;
  - нет `UNAUTHORIZED_NO_AUTH_HEADER`.
6. Проверить Stripe Dashboard delivery.
7. Проверить три source-path card enrichment.
8. Проверить отсутствие повторной materialization/access grant.

Admin-функции:

```text
stripe-card-data-fetch
stripe-card-data-fetch-bulk
```

можно деплоить отдельно раньше, поскольку для них `verify_jwt=true` является правильным режимом.

---

# **11. Исправленные approve gates**

## **Approve A**

Разрешено:

- discovery-файл;
- обновление архитектурной документации со статусом `UNDER RE-VERIFICATION`;
- явные блоки `config.toml`;
- статический CI guard;
- код canary-функции.

Запрещён любой deploy.

## **Approve C1**

Deploy и redeploy только canary:

```text
public-webhook-deploy-probe
```

Плюс smoke и recovery test.

## **Approve D**

Вердикт:

```text
D-BROKEN
или
D-STABLE-CANDIDATE
```

Не снимать глобальный мораторий автоматически.

## **Approve E**

Отдельный redeploy `stripe-webhook` только после canary deployment/redeployment/recovery PASS.

---

# **12. Обновлённый DoD PATCH**

PATCH считается PASS, если:

1. Expected config всех публичных webhook явно записан.
2. Статический guard проходит и не является deploy-каналом.
3. Canary first deploy сохраняет публичность.
4. Canary redeploy сохраняет публичность.
5. Canary recovery предыдущей версии фактически работает.
6. Различие platform-level и application-level auth доказано.
7. Controlled protocol задокументирован.
8. `stripe-webhook` redeploy выполняется только после отдельного approve.
9. После Stripe redeploy:
  - внешний доступ без Supabase JWT сохранён;
  - Stripe signature обязательна;
  - card-enrichment runtime работает;
  - payment lifecycle не сломан;
  - bePaid не затронут.
10. GitHub не используется для deploy.
11. Внешняя инфраструктура не создаётся.

Сейчас можно одобрить только Approve A. Существующие webhook и Stripe не передеплоивать.

&nbsp;

PATCH-LOVABLE-PUBLIC-WEBHOOK-DEPLOY-V1 — план

Stripe архитектурно в порядке. Чинить нужно не Stripe, а механизм публикации публичных webhook-функций в Lovable-managed Supabase. Один раз, для всех провайдеров.

## 0. Read-only снимок: фактический auth-режим всех webhook (выполнен сейчас)

Производственный POST без Supabase JWT в `https://hdjgkjceownmmnrqqtuz.functions.supabase.co/<fn>`:


| Function                | HTTP | Тело                                 | Кто отвечает | Verdict                  |
| ----------------------- | ---- | ------------------------------------ | ------------ | ------------------------ |
| stripe-webhook          | 400  | `signature_verification_failed`      | сама функция | PASS (публично достижим) |
| bepaid-webhook          | 401  | `Invalid signature / no_auth_method` | сама функция | PASS                     |
| telegram-webhook        | 400  | `No bot_id`                          | сама функция | PASS                     |
| payment-methods-webhook | 200  | `{status:"ignored"}`                 | сама функция | PASS                     |
| auth-email-hook         | 401  | `Invalid signature`                  | сама функция | PASS                     |
| getcourse-webhook       | 401  | `Unauthorized / no_instance_id`      | сама функция | PASS                     |
| amocrm-webhook          | 200  | `{success:true}`                     | сама функция | PASS                     |
| instagram-webhook       | 400  | `Missing integration_instance_id`    | сама функция | PASS                     |


Платформенного `UNAUTHORIZED_NO_AUTH_HEADER` нет ни у одной функции. Все 8 публичных webhook сейчас за JWT-wall НЕ заведены.

Конфиг:

- `supabase/config.toml` содержит ТОЛЬКО `project_id = "hdjgkjceownmmnrqqtuz"`. Никаких `[functions.*]` блоков и `verify_jwt = false` в репозитории нет.
- Тем не менее все 8 webhook публично достижимы. Значит фактический дефолт Lovable agent-deploy для edge-функций сейчас = `verify_jwt = false`, а не `true`, как зафиксировано в `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` и `canonical_infrastructure_v1.md` §8.
- CI guard `.github/workflows/verify-webhook-public.yml` парсит `[functions.<fn>]` блоки, которых в config.toml нет → этот guard сейчас даёт ложный FAIL и не отражает реальное состояние.

Следствие: документированная моратория («stripe-webhook платформенно в 401, не передеплоивать») по факту НЕ соответствует текущему состоянию. Stripe-webhook сейчас рабочий и публично достижим. Регрессия из 2026-06-06 была реальной, но воспроизводимость надо переподтвердить контролируемо.

## 1. Цель PATCH

Получить канонический Lovable-механизм деплоя публичных webhook-функций, который:

1. читает per-function конфигурацию (включая verify_jwt) из `supabase/config.toml`;
2. публикует функцию с `verify_jwt = false`, если так указано;
3. не подменяет это дефолтом `true`;
4. после deploy возвращает фактическую auth-конфигурацию;
5. имеет pre-deploy guard, который BLOCKS deploy, если ожидание ≠ факт;
6. имеет post-deploy внешний smoke без Supabase JWT;
7. имеет автоматический rollback при failed smoke.

Никакого GitHub Workflow, внешнего сервера, прокси, параллельной БД или второго webhook.

## 2. Что НЕ делаем

- Не трогаем работающий `stripe-webhook` bundle до фиксации deploy-механизма.
- Не передеплоиваем ни одну функцию из списка §0.
- Не создаём новые webhook-эндпоинты для Stripe / bePaid.
- Не меняем код самих webhook.
- Не подключаем GitHub Actions как канал деплоя (политика `canonical_infrastructure_v1.md` §2, §7).
- Не запрашиваем у оператора Supabase secrets.

## 3. Scope работы (по этапам)

### Этап A — Discovery и обновление документации (read-only)

A

1. Зафиксировать фактический снапшот §0 в новом файле `.lovable/discovery/public_webhook_deploy_layer_v1.md`:

- таблица 8 функций с HTTP/body/verdict;
- факт пустого `config.toml`;
- факт расхождения с моратория-документом и CI guard;
- актуальное состояние `stripe-webhook` = PUBLIC, application-level 400.

A

2. Обновить (не удалить) `.lovable/architecture/canonical_infrastructure_v1.md` §8 и `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md`:

- пометить мораторий как «UNDER RE-VERIFICATION на основании discovery v1»;
- не снимать мораторий до выполнения этапа C.

A

3. Сравнение Stripe ↔ bePaid:

- обе функции сейчас публикуются ОДИНАКОВО (Lovable agent-deploy, без `[functions.*]` блока в config.toml);
- обе сейчас PASS на внешнем POST;
- значит для Stripe не нужна отдельная инфраструктура — нужен только надёжный canonical deploy.

### Этап B — Канонизация config.toml (репозиторий)

B

1. Завести в `supabase/config.toml` явные `[functions.<name>]` блоки с `verify_jwt = false` для всех 8 публичных webhook из §0. Это:

- делает контракт явным и читаемым CI guard'ом;
- даёт инструменту deploy то, что он должен «прочитать и сохранить»;
- не меняет runtime, пока не выполнен redeploy.

B

2. Починить `.github/workflows/verify-webhook-public.yml`:

- сейчас он ищет блоки, которых нет → ложный FAIL;
- после B1 он начнёт корректно подтверждать ожидание `verify_jwt=false`.

B

3. Никаких других изменений в config.toml (project-level настройки не трогаем, см. правила Lovable Cloud).

### Этап C — Контролируемая проверка deploy-механизма Lovable

C

1. Выбрать одну НЕ-критическую публичную функцию для контролируемого редеплоя (кандидат: `instagram-webhook` или `getcourse-webhook` — обе сейчас отвечают application-level ошибкой и не участвуют в live commercial flow). Stripe и bePaid НЕ участвуют в C1.

C

2. Snapshot до:

- внешний POST без JWT → ожидание PASS (application-level);
- зафиксировать deployment id / version / source ref, если доступны.

C

3. Запустить `supabase--deploy_edge_functions` ровно на одну выбранную функцию.

C

4. Snapshot после @ t=0s / 30s / 2m:

- если все три PASS → дефолт `verify_jwt = false` стабилен у Lovable agent-deploy, регрессия не воспроизводится;
- если хотя бы один FAIL c `UNAUTHORIZED_NO_AUTH_HEADER` → регрессия подтверждена, переходим к этапу D.

C

5. Pre-/post-deploy фиксируется в `.lovable/proofs/public_webhook_deploy_layer_v1_controlled_redeploy.md`.

### Этап D — Решение по deploy layer

Два сценария:

**D-stable** (регрессия НЕ воспроизводится на C4):

- Lovable agent-deploy сохраняет `verify_jwt = false` по дефолту.
- Объявить deploy layer условно безопасным для публичных webhook ПРИ соблюдении:
  - в `config.toml` есть явный `[functions.<fn>]` с `verify_jwt = false` (§B1);
  - перед каждым редеплоем выполняется pre-deploy внешний smoke + сохраняется previous bundle marker;
  - после редеплоя — внешний smoke @ t=0/30s/2m;
  - при FAIL — немедленный alert и моратория до ручной эскалации к Lovable.
- Снять моратории §8 в `canonical_infrastructure_v1.md`, заменив на «controlled-redeploy protocol».

**D-broken** (регрессия воспроизводится на C4):

- Зафиксировать deterministic repro второй раз.
- Оставить мораторий §8 в силе.
- Эскалировать Lovable Cloud (copy-paste блок из backlog) и заблокировать любые redeploy webhook.
- Stripe card enrichment остаётся CODE READY / DEPLOY BLOCKED.

В обоих сценариях НЕ создаются: GitHub Workflow деплоя, внешний сервер, прокси, параллельный webhook.

### Этап E — Stripe card enrichment redeploy (ТОЛЬКО при D-stable)

E

1. Точечный redeploy `stripe-webhook` по controlled-redeploy protocol из D-stable.

E

2. Pre/post внешний smoke без JWT (ожидание: `signature_verification_failed`, не `UNAUTHORIZED_NO_AUTH_HEADER`).

E

3. Runtime proof трёх source-path: `checkout.session.completed`, `payment_intent.succeeded`, `invoice.paid` — по уже согласованному плану Approve B из `.lovable/plan.md`.

E

4. Lifecycle invariants + bePaid regression + PCI proof — без изменений к Approve B.

E ВЫПОЛНЯЕТСЯ только после успешного D-stable. Иначе Stripe-bundle остаётся CODE READY / DEPLOY BLOCKED, а админская `stripe-card-data-fetch` и bulk-функция могут быть задеплоены отдельно (они не webhook, JWT-wall для них корректен).

## 4. Временный режим до закрытия PATCH

- действующий `stripe-webhook` НЕ передеплоивать;
- live Stripe payment lifecycle продолжает работать на текущем bundle;
- админские `stripe-card-data-fetch` и `stripe-card-data-fetch-bulk` разрешено деплоить отдельно (admin-only, JWT обязателен — для них регрессия нерелевантна);
- исторические карты обогащаются через эти admin-функции, не через webhook;
- webhook card-enrichment = CODE READY / DEPLOY BLOCKED.

## 5. DoD

PATCH = PASS только если ВСЕ выполнено:

1. Discovery v1 сохранён, моратория переподтверждена/снята явно.
2. `config.toml` содержит явные `[functions.<fn>]` с `verify_jwt = false` для всех 8 публичных webhook.
3. CI guard `verify-webhook-public.yml` отражает реальное состояние и проходит.
4. Контролируемый редеплой одной не-критической функции выполнен, исход (D-stable / D-broken) зафиксирован в proof.
5. При D-stable: задокументирован controlled-redeploy protocol (config → pre-smoke → snapshot версии → deploy → post-smoke t=0/30s/2m → rollback при FAIL).
6. При D-broken: мораторий §8 сохранён, эскалация Lovable оформлена.
7. Stripe card enrichment redeploy выполнен ТОЛЬКО при D-stable, runtime proof трёх source-path собран, bePaid regression чистая, PCI scans = 0, коммерческие сущности не изменены.
8. GitHub Workflow деплоя НЕ добавлен. Внешняя инфраструктура НЕ добавлена.
9. bePaid webhook не сломан.

## 6. Артефакты (создаются после Approve)

- `.lovable/discovery/public_webhook_deploy_layer_v1.md` (этап A1)
- обновление `.lovable/architecture/canonical_infrastructure_v1.md` §8 (A2)
- обновление `.lovable/backlog/lovable_agent_deploy_verify_jwt_regression.md` (A2)
- правка `supabase/config.toml` (B1) + правка `.github/workflows/verify-webhook-public.yml` (B2)
- `.lovable/proofs/public_webhook_deploy_layer_v1_controlled_redeploy.md` (C5)
- при D-stable: `.lovable/architecture/public_webhook_controlled_redeploy_protocol_v1.md` (D)
- при E: `.lovable/proofs/stripe_card_enrichment_v2_webhook_runtime.md` + `.lovable/proofs/stripe_card_enrichment_v2_pci.md` (E)

## 7. Approve gates

- Approve A → выполнить этапы A + B (read-only discovery + явный config + CI guard fix). Никаких deploy.
- Approve C → выполнить этап C (контролируемый редеплой одной не-критической функции).
- Approve D → зафиксировать вердикт D-stable / D-broken и обновить мораторий.
- Approve E → ТОЛЬКО при D-stable: redeploy `stripe-webhook` + runtime proof Approve B.

После каждого Approve — STOP и возврат `PASS|FAIL` без перехода к следующему gate.