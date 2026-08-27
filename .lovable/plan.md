# План: безопасный production-тест создания платёжных ссылок по ролям (PLAN-ONLY)

Read-only discovery выполнен. Ничего не изменено: код, файлы, SQL, миграции, RLS, Auth, Storage, secrets, deploy, Publish, бизнес-записи — не трогались. PII, email, ФИО, JWT, полные UUID и платёжные URL не выводятся.

## 0. SHA-гейт

Managed mirror HEAD = `6cab9e03a98ba9131cae2fbcb36ccb151f852660` (merge PR #379) — совпадает с указанным origin/main. Рабочее дерево чистое. PASS.

## 1. Фактические grants (production, read-only)

Секция `payments` (`role_admin_section_access`):

| Роль | Секция payments | Ресурс `links` | Прочие ресурсы |
|---|---|---|---|
| admin | manage | manage | manage на всех 7 ресурсах |
| menedzher | edit | edit | edit на `manual-payment` |
| support | view | нет override | edit на `manual-payment` |
| user (обычный) | нет строки → none | нет | нет |

Соответствие требуемой матрице:
- (A) admin/manage — есть.
- (B) menedzher с `payments:edit` + `links:edit` — есть.
- (C) `payments:view` без edit — роль `support` (единственная).
- (D) без доступа к payments — роль `user`.

Гейт функций: все writer-функции используют `requirePaymentsEdit` → `has_admin_section_access(uid,'payments','edit')`; 401 при отсутствии/битом Bearer, 403 при недостатке прав. `admin-invalidate-payment-link` — тот же гейт, делает только `UPDATE status='invalidated'`, без DELETE.

## 2. Обезличенные QA-акторы и сущности: чего НЕТ

- Носители ролей: admin — 7, super_admin — 2, menedzher — 5, support — 1, user — 233. Среди аккаунтов с признаками `qa/test/example/+alias` **ни один не имеет ролей admin/menedzher/support** (только `user` либо роли отсутствуют).
- Отдельных QA-аккаунтов под роли B и C **не существует**. Использовать реальных сотрудников для runtime-теста нельзя без отдельного разрешения.
- QA-продукты: два продукта с именем «тестовый» активны, но **у них нет ни одного тарифа**. `admin-create-public-link` требует `product_id` + `tariff_id` + `amount` → создать ссылку на этих продуктах технически невозможно. Тарифов/офферов с именем test/qa нет.

Вывод: **BLOCKED** для настоящего Edge runtime по акторам B, C, D (нет безопасных сессий) и дополнительно BLOCKED по данным (нет QA-оффера с тарифом). Подменять service-role ключом не будем — это не проверяет RBAC-путь.

## 3. Что можно выполнить без новых аккаунтов и без записей

Разрешённый безопасный набор (все шаги без записи бизнес-данных):

1. **Contract probes по Edge** (без валидных сессий):
   - OPTIONS на `admin-create-public-link`, `admin-invalidate-payment-link` → ожидание 2xx + CORS.
   - POST без Authorization и POST с заведомо невалидным Bearer → ожидание **401 `unauthorized`** до любой бизнес-валидации.
2. **Read-only SQL-матрица прав** (без записи): для одного носителя каждой роли (в отчёте — только хэш uid, роль и результат)
   - `has_admin_section_access(uid,'payments','edit')`, `...,'view')`, `...,'manage')`
   - `has_admin_resource_access(uid,'payments','links','edit')`
   - ожидание: A = true/true/true/true; B = true/true/false/true; C = false/true/false/false; D = false/false/false/false.
3. **Read-only проверка RPC/RLS-контракта**: `get_admin_payment_links_v1` гейтится `has_admin_section_access(...,'payments','view')`; политики `payment_links`: SELECT=view, INSERT/UPDATE=edit, DELETE=manage.
4. **Транзакционный RLS/RPC-тест с ROLLBACK** (см. §5) — отдельно от Edge runtime.

## 4. Полный runtime-тест `admin-create-public-link` → `admin-invalidate-payment-link` (только после отдельного EXECUTE и снятия блокеров)

Предусловия, которые должен подтвердить пользователь:
- Разрешение выполнить один вызов от актора A (admin) и один от актора B (menedzher) с их реальными сессиями, **или** явное решение по QA-аккаунтам.
- Наличие QA-оффера: у продукта «тестовый» должен быть активный тариф. Сейчас его нет; создание тарифа — это запись, поэтому в текущем scope запрещено.

Тестовый сценарий (на каждого актора A и B):
1. POST `admin-create-public-link` с QA product_id + tariff_id, `amount = 100` (минимум по коду: `< 100` → 400), `payment_type` = разовый, `max_uses = 1`, `expires_at = now + 15 минут`, `description = "TEST-RBAC-20260827"`, без `user_id` (unassigned → `auth_policy='required'`).
   - Ожидание A и B: **200**, создана 1 строка `payment_links` со `status='active'`, `current_uses=0`.
2. Немедленно POST `admin-invalidate-payment-link` с полученным `payment_link_id`.
   - Ожидание: **200**, `status='invalidated'`.
3. Read-back (SQL, по хэшу id): `payment_links.status='invalidated'`, `current_uses=0`; `orders_v2` = 0 строк по ссылке; `provider_events` = 0; `payments` = 0; `invoices` = 0. Публичный URL не открывается и не выводится в отчёт.
4. Акторы C и D: тот же POST `admin-create-public-link` с заведомо валидным телом → ожидание **403 `forbidden`**, 0 новых строк. Это негативный тест — мусора не создаёт.
5. Не тестируем: `admin-invoice-checkout-issue`, `public-rr-installment-initiate`, RR create-order, любые оплаты и уведомления — они создают downstream-записи.

Остаточный след после теста: 2 строки `payment_links` в статусе `invalidated` с маркером `TEST-RBAC-20260827` (удаление — это DELETE, требует отдельного разрешения; функция инвалидации намеренно не удаляет).

## 5. Транзакционный RLS/RPC тест с ROLLBACK (не заменяет Edge runtime)

Отдельный, явно помеченный как **не-runtime** тест: в одной транзакции
`BEGIN; SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '{"sub":"<uid актора>","role":"authenticated"}'; ... ; ROLLBACK;`
внутри:
- `SELECT has_admin_section_access(...)`, `has_admin_resource_access(...)` для 4 акторов;
- `SELECT * FROM get_admin_payment_links_v1(...)` — ожидание: A/B/C → строки, D → `42501`/пусто;
- пробный `INSERT INTO payment_links (...)` от каждой роли — ожидание: A/B → успех, C/D → `42501`;
- пробный `UPDATE ... SET status='invalidated'` — A/B успех, C/D `42501`;
- `DELETE` — только A успех, B/C/D `42501`.
Финальный `ROLLBACK` не оставляет строк; после транзакции — контрольный `count(*)` по `payment_links` до/после (должен совпасть).

Важное ограничение: это проверяет **только RLS и RPC**, а не JWT-путь Edge Functions (`requirePaymentsEdit`, CORS, service-role writes). Отдельно докладывается как «RLS-proof», не как runtime-proof.

## 6. Stop / cleanup условия

STOP немедленно, если:
- любой актор получает 5xx или `rbac_check_failed`;
- после шага 1 появляется хотя бы одна строка в `orders_v2`/`provider_events`/`payments`/`invoices`;
- `current_uses > 0` на тестовой ссылке (значит ссылка была открыта/оплачена);
- C или D получают 200 вместо 403 (critical finding, эскалация без продолжения);
- SHA mirror перестаёт совпадать с `6cab9e03a`.

Cleanup: сразу после теста — инвалидация ссылки (шаг 2) в том же прогоне; при обрыве прогона — инвалидация всех `payment_links` с `description = 'TEST-RBAC-20260827'` и `status='active'` (UPDATE, не DELETE). Публичные URL и токены не выводятся и не пересылаются.

## Вердикт

- Матрица прав, contract-probes и ROLLBACK-тест — **готовы к EXECUTE**.
- Настоящий Edge runtime `admin-create-public-link` → **BLOCKED**: нет обезличенных QA-сессий для ролей B/C/D и нет QA-тарифа/оффера. Требуется отдельное решение пользователя; создавать аккаунты, тарифы или подменять service-role я не буду.
