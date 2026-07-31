# План: единый релиз main `3d47bc7a8afb2d84d9092279368e655baf85c2ce`

PLAN-ONLY. Ничего не применено: без sync рабочего дерева, кода, коммитов, миграций, deploy, данных и Publish.

## 1. Preflight (факты)

- `git fetch origin main` (только чтение) → `origin/main = 3d47bc7a8afb2d84d9092279368e655baf85c2ce` — «fix(payments): restrict subscription charge cron (#255)». Совпадает с указанным SHA.
- Managed рабочее дерево сейчас на `d0e66f1f875f3eec83c89f33a493757e9a60590e` (#246) — **отстаёт на релизный набор**. `git status --porcelain` пуст, дерево чистое.
- Диф `d0e66f1f..3d47bc7a8` — 24 файла: 8 edge functions + 2 shared модуля + `supabase/config.toml` + 1 новая миграция + 8 фронтенд/тест файлов.

## 2. Состав релиза

### Миграции
| Файл | Статус в БД |
|---|---|
| `20260731072225_restore_rbac_helper_execute_grants.sql` | уже в дереве и **фактически уже применён**: `has_permission(uuid,text)` и `has_role(uuid,app_role)` имеют ACL `authenticated=X, service_role=X`, без PUBLIC. Повторный прогон идемпотентен (guard-проверка сигнатур + REVOKE/GRANT). |
| `20260731091000_harden_subscription_charge_cron.sql` | **новый**. Создаёт Vault-секрет `subscription_charge_cron_secret` (только если отсутствует), SECURITY DEFINER функцию `public.subscription_charge_cron_secret()` (revoke от PUBLIC/anon/authenticated, grant только service_role), переcоздаёт cron-jobs `subscription-charge-morning` (0 6 * * *) и `subscription-charge-evening` (0 18 * * *) с заголовком `x-subscription-charge-cron-secret`. Сейчас оба job'а существуют и авторизуются только anon-ключом — это и есть закрываемая дыра. Функции `subscription_charge_cron_secret` в БД пока нет. Расписания не меняются, пользовательские данные не трогаются. |

### Edge Functions (deploy ровно 8)
`telegram-grant-access`, `telegram-revoke-access`, `telegram-check-expired`, `verify-inline-otp`, `cancel-trial`, `bepaid-webhook`, `installment-charge-cron`, `subscription-charge`.

`supabase/config.toml` в этом SHA добавляет блоки `verify_jwt = false` для `telegram-grant-access`, `telegram-revoke-access`, `cancel-trial`, `subscription-charge` (пустой блок для `telegram-check-expired`) — авторизация переносится внутрь функций (exact managed service key / owner-check / Vault cron-secret).

### UI
Один frontend Publish этого SHA.

## 3. Порядок EXECUTE (после отдельного approve)

1. **Preflight-STOP-gate:** sync managed дерева ровно на `3d47bc7a8`, повторно подтвердить `git rev-parse HEAD` и чистое дерево. STOP при любом mismatch.
2. **Миграции по одной, в порядке имён:** сначала `20260731072225…`, затем `20260731091000…`. После каждой — read-back:
   - ACL `has_permission` / `has_role`;
   - наличие `subscription_charge_cron_secret()` и её grants (нет anon/authenticated);
   - `cron.job` содержит ровно два job'а с прежним расписанием и заголовком cron-secret.
   STOP при ошибке, лишнем job'е или неясном rowcount.
3. **Deploy ровно 8 перечисленных функций.** Никаких других.
4. **Safe smokes (без мутаций):** анонимный вызов `subscription-charge` и `installment-charge-cron` → ожидается 401/403; `telegram-check-expired` от обычного пользователя → отказ; `cancel-trial` чужой подпиской не вызывается вовсе. Ни одного `mode:"execute"`.
5. **UI Publish** — один раз, после PASS шагов 1–4.
6. **E2E test-only** (см. ниже).
7. **UI proof:** скриншоты опубликованного URL для desktop и mobile viewport.

## 4. E2E test-only сценарий (после Publish)

- Создаётся один явно помеченный тестовый пользователь (email вида `qa+release-3d47bc7a@…`) через inline 6-значный OTP; регистрация только через штатный публичный путь.
- Тестовый checkout/order в режиме `skipRedirect` / test-payment: реальный bePaid-платёж не инициируется, `mode:"execute"` не вызывается, amoCRM и GetCourse не затрагиваются.
- Read-back: профиль, `orders_v2`, доступ/entitlement, повторный вызов на том же idempotency-ключе не создаёт дубль.
- Cleanup — только безопасная проверка: фиксируем идентификаторы созданных тестовых записей и подтверждаем их изолированность. Удаление данных выполняется отдельной задачей по явному разрешению.

## 5. Запрещено в этом релизе

Реальные платежи и списания, `mode:"execute"`, отмены подписок живых клиентов, рассылки/сообщения, amoCRM, GetCourse, изменения ролей, RLS вне двух перечисленных миграций, deploy любых других функций, правки шаблонов и биллинга.

## 6. STOP-условия

SHA/state mismatch, ошибка или неясный rowcount в миграции, регрессия авторизации в smoke, 5xx у любой из 8 функций, новый critical security finding, невозможность подтвердить оба UI-proof.
