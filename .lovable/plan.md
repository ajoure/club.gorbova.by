# да, согласен, с учетом правок:

План правильный по направлению: сначала честный статус интеграции, затем безопасная очистка только тестовых данных, после этого — отдельный контролируемый переход в `battle`.

## 0. До очистки сохранить proof видимости платежей

Сначала завершить verification уже сделанного `PATCH-RR-PAYMENTS-VISIBILITY-V1`, потому что после удаления 12 тестовых платежей проверить интерфейс будет нечем.

Зафиксировать:

```text
DB RR payments: 12
/admin/payments, provider=RR: 12
audit order виден
фильтр работает
карточки статистики совпадают
CSV содержит provider=rr

```

Только после этого переходить к cleanup.

---

## 1. Правки к PATCH-RR-STATUS-TRUTHFUL-V1

### Не проверять edge functions через несуществующий «registry»

Сначала выяснить, существует ли в проекте реальный источник данных о задеплоенных функциях. Если его нет, не создавать фиктивную проверку.

`Backend: подключён` можно подтверждать по:

- версии RR backend capability, возвращаемой самим healthcheck;
- наличию и работе RR adapter;
- успешным runtime-операциям в БД;
- последнему успешному RR webhook/payment.

`rr-admin-deliver-test-webhook` не является обязательной частью боевого backend и не должен влиять на статус production integration.

### API reachability

Не придумывать новый `health/ping endpoint`, если его нет в документации РР.

Использовать уже существующий read-only путь:

```text
rrGetOrderStatus(existing_external_id)

```

В test-режиме — по существующему test-order/ledger.

В battle до первого реального заказа:

```text
credentials = configured
api_reachability = not_verified
overall = battle_awaiting_first_order

```

### Webhook

Сейчас healthcheck фактически не проверяет подпись webhook «как сейчас». Поэтому активный synthetic webhook probe добавлять не нужно.

Статус webhook определять по последнему реальному событию:

```text
provider_events.provider = rr
signature_valid = true
event_type = webhook_notification_received

```

Разделять:

```text
Webhook endpoint: configured
Webhook runtime: verified / not_verified

```

### Последняя операция

`mode` нужно читать не из `payments_v2.meta`, а через связанный заказ:

```text
payments_v2
JOIN orders_v2 ON orders_v2.id = payments_v2.order_id
WHERE orders_v2.meta->'rr'->>'mode' = 'battle'

```

### Статус integration_instances

До реализации проверить допустимые значения колонки `integration_instances.status`.

Не записывать туда новое значение `battle_awaiting_first_order`, если CHECK/enum разрешает только:

```text
connected
disconnected
error

```

Детальный статус хранить в response/payload healthcheck, а колонку обновлять только допустимым значением.

---

## 2. Правки к PATCH-RR-TEST-CLEANUP-V1

### Test guard не должен требовать наличие payment

Текущая all-of модель исключит тестовые заказы со статусом:

- pending;
- failed;
- rejected;
- expired;
- не дошедшие до создания `payments_v2`.

Безопасный основной guard:

```text
orders_v2.provider = rr
orders_v2.meta.flow = rr_installment
orders_v2.meta.rr.mode = test

```

Если у заказа есть payments, тогда для **каждой** связанной строки обязательно:

```text
provider = rr
origin = rr_installment

```

Если найдена связанная строка другого provider/origin — заказ блокируется.

Отсутствие payment допустимо. Отсутствие `meta.rr.mode` — fail-closed.

### Авторизация RPC

Перед миграцией найти canonical helper superadmin. Не создавать параллельную систему ролей.

Обязательно:

```sql
SECURITY DEFINER
SET search_path = public, pg_temp

REVOKE ALL ON FUNCTION ... FROM PUBLIC;
REVOKE ALL ON FUNCTION ... FROM anon;
GRANT EXECUTE ON FUNCTION ... TO authenticated;

```

Внутри — повторная server-side проверка `super_admin`.

### Cleanup разрешён только пока интеграция в test

При `_dry_run=false` дополнительно проверить:

```text
integration_instances.config.mode = test

```

Если режим уже `battle` — execute отклоняется. Старые test-записи тогда можно будет чистить только отдельным осознанным решением.

### Транзакция и конкурентность

В execute:

- заблокировать target orders через `FOR UPDATE`;
- повторно проверить guard внутри той же транзакции;
- если хотя бы один запрошенный ID blocked — отменить всю операцию;
- не выполнять частичное удаление.

### Пересчёт entitlement

В плане указано:

```sql
recalculate_entitlement_aggregate(contact_id)

```

Это нельзя оставлять без проверки — ранее canonical пересчёт использовал tuple уровня доступа, а не просто контакт.

До удаления сохранить уникальные комбинации:

```text
user_id
product_id
tariff_id

```

После удаления вызвать существующую функцию с её фактической сигнатурой. Не создавать новый упрощённый overload.

### subscriptions_v2

Не удалять любую subscription только потому, что её `order_id` входит в cleanup.

Для каждой найденной subscription проверить:

- исходный order test;
- `extended_by_orders`;
- нет ли non-target или battle-заказов;
- нет ли реального recurring snapshot/provider subscription.

Если lineage смешанный или неоднозначный:

```text
blocked_reason = mixed_subscription_lineage

```

Execute останавливается. Автоматически удалять смешанную subscription запрещено.

### FK blockers

Dry-run должен отдельно проверять таблицы с `NO ACTION`, включая как минимум ранее обнаруженные:

```text
site_form_submissions
statement_lines
subscriptions_v2
payment_reconcile_queue

```

Если есть блокирующие строки — показать их и не выполнять cleanup.

### Telegram

Удалять только сообщения с:

```text
meta.source_order_id IN target_orders

```

и разрешёнными RR purchase event types. Не удалять все сообщения пользователя или все записи с совпавшим Telegram ID.

### Battle guard test

До появления реального battle-заказа не нужно создавать боевой заказ только ради проверки удаления.

Guard можно проверить:

- транзакционным fixture с обязательным rollback;
- существующим RR-заказом без `mode=test`;
- missing-mode order;
- обычным не-RR order.

После первого боевого заказа дополнительно подтвердить, что кнопка отсутствует и RPC возвращает blocked.

---

## 3. UI удаления

Расширение `orders` select для `/admin/payments` допустимо:

```text
orders.meta.rr.mode

```

Но это только условие отображения кнопки.

Безопасность обеспечивается исключительно RPC. Даже если frontend ошибочно покажет кнопку для battle-строки, backend обязан отклонить удаление.

На карточке интеграции bulk cleanup — основной путь. Row action в платежах — дополнительный.

---

## 4. В плане есть противоречие по Task 3

Написано:

```text
Задача 3 — никакого кода

```

Но далее требуется реализовать замок переключения `battle → test`. Это уже код.

Добавить отдельную задачу перед go-live:

```text
PATCH-RR-MODE-LOCK-V1

```

### Требование

Замок должен быть server-side, а не только предупреждением в UI.

При попытке перейти из `battle` в `test` проверить наличие заказов:

```text
provider = rr
meta.flow = rr_installment
meta.rr.mode = battle
status NOT IN terminal statuses

```

Если такие заказы есть — изменение режима отклоняется.

Если текущий UI напрямую обновляет `integration_instances.config`, нужно перевести смену режима на guarded RPC либо другой серверный mutation-path. UI-only lock недостаточен.

---

## 5. Credentials в pre-flight

В плане указано:

```text
battle_password — integration_credentials

```

Текущий loader читает:

```text
integration_instances.config.battle_login
integration_instances.config_secrets.battle_password
integration_instances.config_secrets.secret_key

```

Pre-flight должен проверять фактическое storage, используемое `loadRRConfig`, а не предполагаемую таблицу.

Также отдельно подтвердить у РР:

```text
один ли secret_key для test и battle
или требуется отдельный battle_secret_key

```

Не переключать режим до этого подтверждения.

---

## 6. Первый battle order

Обязательные проверки оставить.

Уточнения:

- повтор webhook не фабриковать вручную без оригинальной подписи;
- идемпотентность можно доказать natural retry от РР или повторным canonical fulfill/reconcile;
- комиссия может прийти не мгновенно, поэтому допустим статус `pending enrichment`, но до финального закрытия go-live она должна появиться либо должен быть документирован ответ РР, почему поле отсутствует.

Критическими для go-live являются:

```text
order paid
payment создан
доступ выдан
CRM обновлена
buyer/admin notifications отправлены
строка видна в /admin/payments

```

---

## 7. Документация

`.lovable/plan.md` обновлять только append-only.

Не заменять весь файл текстом очередного ответа. Если прежняя история Sprint C2 ещё не восстановлена после предыдущих перезаписей — сначала восстановить её, затем добавлять новые отчёты.

## Исправленный порядок

```text
0. Runtime proof PATCH-RR-PAYMENTS-VISIBILITY-V1
1. PATCH-RR-STATUS-TRUTHFUL-V1
2. Отчёт и контрольная точка
3. PATCH-RR-TEST-CLEANUP-V1
4. Dry-run cleanup
5. Подтверждение irreversible execute
6. Cleanup + повторный dry-run
7. PATCH-RR-MODE-LOCK-V1
8. Проверка battle credentials + webhook
9. Переключение в battle
10. Один реальный боевой заказ
11. Полная post-authorization verification
12. Финальный статус «Боевой режим — подключено»

```

Статус плана:

```text
PATCH-RR-GO-LIVE-PREP-V1: APPROVED WITH CORRECTIONS
Task 1: AUTHORIZED
Task 2: AUTHORIZED AFTER TASK 1 CHECKPOINT
Mode lock: REQUIRED BEFORE BATTLE
Battle switch: NOT YET AUTHORIZED


План: PATCH-RR-GO-LIVE-PREP-V1
```

Три последовательные задачи. Каждая — отдельный подпатч со своим DoD. Между ними — контрольная точка, не идём дальше без подтверждения.

---

## Задача 1. PATCH-RR-STATUS-TRUTHFUL-V1 — карточка и healthcheck

### Проблема

Карточка РР показывает «Настроено частично — backend не подключён», потому что `integration-healthcheck` (RR-ветка) всё ещё возвращает `api_test: pending_backend` и держит интеграцию в `disconnected`. Backend реализован и прошёл E2E — статус ложный.

### Изменения в backend

Файл: `supabase/functions/integration-healthcheck/index.ts`, RR-ветка.

1. Удалить возврат `api_test: 'pending_backend'` и текст «API-проверка будет доступна после подключения backend».
2. Ввести раздельные под-проверки, каждая со своим статусом (`ok | not_configured | not_verified | error`):
  - `backend`: наличие всех РР edge functions (`public-rr-installment-initiate`, `rr-webhook`, `rr-fulfill-order`, `rr-admin-deliver-test-webhook`) в registry.
  - `credentials`: по `integration_instances.config.mode` проверить, что заполнены соответствующие поля (`test_login`+`test_password` или `battle_login`+`battle_password`) и `secret_key` в `config_secrets`.
  - `api_reachability`: read-only запрос к РР (health/ping endpoint или GET существующего заказа). Никаких `POST /orders`, никаких новых заказов во время healthcheck.
  - `webhook`: как сейчас — проверка публичности `rr-webhook` и валидности подписи.
  - `last_successful_operation`: последняя строка `rr_test_ledger` (test) или последний `payments_v2 provider='rr' origin='rr_installment'` с `meta.rr.mode='battle'` (battle) — дата и `order_id`.
3. В battle-режиме до появления первой боевой строки в `payments_v2`:
  - Не выдавать `overall = 'connected'`.
  - Отдавать `overall = 'battle_awaiting_first_order'` c текстом «Боевые реквизиты настроены. Боевой runtime ещё не подтверждён реальным заказом».
4. В test-режиме `api_reachability` может использовать существующий тестовый `rr_test_ledger` заказ (только чтение).

### Изменения в UI

Файлы (уточнить чтением, вероятные кандидаты):

- `src/pages/admin/integrations/OtherIntegrations.tsx` или соответствующий раздел карточек.
- Компонент карточки РР и его хук.

Карточка отображает **пять отдельных строк** вместо одной сводной:

```text
Backend:            подключён
Режим:              тестовый | боевой
Реквизиты режима:   настроены
API режима:         проверен | ещё не проверен
Webhook:            проверен
Последняя операция: 2026-07-12 · order #RR-...
```

Удалить строки/бейджи:

- «Настроено частично»
- «backend не подключён»
- «API-проверка будет доступна после подключения backend»

Верхний бейдж карточки = агрегат:

- Всё `ok` → «Подключено» (green).
- Battle + `battle_awaiting_first_order` → «Боевой режим — ожидает первую заявку» (amber, не green).
- Любая `error` → «Ошибка» (red).
- `credentials.not_configured` → «Не настроено» (grey).

### DoD задачи 1

- `integration-healthcheck` больше не возвращает `pending_backend`.
- Healthcheck не создаёт заказов.
- Test-режим показывает «API режима: проверен» на основе реального read-only запроса.
- Battle-режим до первой заявки показывает честный «ещё не проверен» и не «Подключено».
- UI больше не содержит трёх устаревших текстов.
- Скриншот карточки РР в test-режиме и dry-run вызов healthcheck подтверждают новые поля.

---

## Задача 2. PATCH-RR-TEST-CLEANUP-V1 — guarded удаление только test-данных

### Ключевой инвариант

Боевые записи (`meta.rr.mode='battle'`) **технически недоступны** для удаления ни через UI, ни через RPC. Удаление разрешено только по строгой конъюнкции признаков теста.

### Определение test-записи (all-of)

```
payments_v2.provider   = 'rr'
payments_v2.origin     = 'rr_installment'
orders_v2.provider     = 'rr'
orders_v2.meta->>'flow' = 'rr_installment'
orders_v2.meta->'rr'->>'mode' = 'test'
```

Дополнительные допустимые маркеры (усиливают, не заменяют):

- `orders_v2.meta->>'test_marker' IS NOT NULL`
- `orders_v2.product_id` = Stage F test product
- Наличие связки в `rr_test_ledger`

Отклонение при любом из:

- `orders_v2.meta->'rr'->>'mode' = 'battle'`
- Отсутствие `mode` в meta (fail-closed).

### Новая RPC (миграция)

`public.admin_rr_cleanup_test_data(_order_ids uuid[] DEFAULT NULL, _dry_run boolean DEFAULT true)`:

- `SECURITY DEFINER`, вызов только `is_super_admin(auth.uid())` — иначе `raise exception`.
- Если `_order_ids IS NULL` — берёт все заказы, удовлетворяющие определению test-записи выше.
- Каждый id прогоняется через guard-функцию `public.rr_order_is_test_safe(uuid)`; при отказе — либо исключение (в non-dry-run), либо пометка `blocked` в отчёте (в dry-run).
- Собирает отчёт: количества по `orders_v2`, `payments_v2`, `entitlement_sources`, `order_notification_deliveries`, `telegram_messages` (test mirrors), `provider_events`, `subscriptions_v2` (по `_order_ids`, если есть), список `order_id + amount + created_at`.
- При `_dry_run = true` — только отчёт, ничего не удаляет.
- При `_dry_run = false`:
  1. В транзакции удалить в порядке FK:
    `order_notification_deliveries` → `telegram_messages` (только зеркала тестового заказа) → `provider_events` → `payments_v2` → `entitlement_sources` → тестовые связи `subscriptions_v2` (если найдутся) → `orders_v2`.
  2. Для каждого затронутого контакта: `select public.recalculate_entitlement_aggregate(contact_id)`.
  3. **Сохранить**: `audit_logs`, `access_grant_ledger`, `integration_logs`. Ссылки на удалённый `order_id` в этих таблицах — `SET NULL` (без удаления строк).
  4. Записать в `audit_logs` итоговый отчёт cleanup.

Гарантия неудаляемости battle: guard-функция + CHECK в RPC на mode. Отдельный e2e-тест: попытка cleanup на battle-заказ возвращает `blocked` в dry-run и `raise` в execute.

### UI: карточка интеграции РР

Superadmin-only секция (через `useSuperAdmin`):

```
[ Очистить тестовые данные РР ]
```

Флоу:

1. Клик → вызов RPC с `_dry_run=true`.
2. Модалка dry-run:
  ```
   Заказов: 12
   Платежей: 12
   Источников доступа: N
   Уведомлений: N
   Telegram-сообщений: N

   Список: RR-001 · 100.00 BYN · 2026-07-10
           RR-002 · ...
  ```
3. Поле подтверждения: пользователь вводит фразу `УДАЛИТЬ ТЕСТОВЫЕ ДАННЫЕ RR` (строго). Кнопка активна только при точном совпадении.
4. Клик подтверждения → RPC с `_dry_run=false`.
5. После — повторный dry-run для верификации нулей, инвалидация `useUnifiedPayments`, `admin-deals`, интеграционного healthcheck.

### UI: `/admin/payments` — точечное действие

В `PaymentsTable.tsx` для строки с `provider='rr'` **и** проверкой `meta.rr.mode='test'` на связанном ордере (доступно во view/запросе, если нет — расширить select):

```
⋮ → Удалить тестовый заказ и связанные данные (superadmin only)
```

Действие вызывает ту же RPC с `_order_ids=[order_id]`, `_dry_run=true`, затем подтверждение.

Для строк `mode='battle'` пункт **не рендерится вовсе** (не просто disabled).

### DoD задачи 2

- Миграция с RPC и guard-функцией применена.
- RLS/GRANT: RPC вызывается `authenticated`, внутри — жёсткая проверка super_admin.
- Кнопка cleanup видна только super_admin.
- Dry-run показывает точные счётчики и список.
- Non-dry-run удаляет ровно указанные сущности, оставляет audit.
- Попытка удалить battle-заказ через любой путь возвращает ошибку без побочных эффектов.
- Повторный dry-run после cleanup показывает нули.

---

## Задача 3. PATCH-RR-GO-LIVE-V1 — переключение в battle и первый боевой заказ

**Никакого кода в этой задаче — только процедура.** Все требуемые механизмы (выбор реквизитов по `config.mode`, atomic promotion, идемпотентность webhook) уже верифицированы.

### Pre-flight checklist (перед переключением)


| Проверка                                    | Как                                        |
| ------------------------------------------- | ------------------------------------------ |
| `battle_login` заполнен                     | `integration_instances.config`             |
| `battle_password` заполнен                  | `integration_credentials` (battle)         |
| `secret_key` (battle) подтверждён с РР      | ручная сверка                              |
| Production webhook URL внесён в кабинете РР | скриншот из кабинета                       |
| Test cleanup выполнен (task 2)              | нули в dry-run                             |
| Stage F test product = inactive             | `products_v2.is_active=false`              |
| Выбран коммерческий offer                   | product_id + tariff_offer_id зафиксированы |


Всё — вручную/через админку, без миграций.

### Переключение

Через UI карточки РР или `integration_instances.config.mode := 'battle'`. Сразу после — прогнать новый healthcheck: должен показать `battle_awaiting_first_order`.

### Первый боевой заказ (одна контролируемая заявка)

```text
реальная страница продукта
  → форма рассрочки
  → public-rr-installment-initiate  (canonical flow)
  → страница РР без «Тестовый режим»
  → реальная авторизация РР
  → production rr-webhook
```

Запрещено использовать в battle: `rr-admin-deliver-test-webhook`, тестовые кнопки авторизации, ручная подмена статуса.

### Post-authorization verification

```text
orders_v2.status = paid
payments_v2.provider = rr, origin = rr_installment, mode(meta) = battle
строка в /admin/payments
контакт + сделка связаны
продукт + тариф отображаются
entitlement_source создан, entitlement активен
CRM: success-stage
email покупателю отправлен
buyer Telegram отправлен
ровно 4 admin Telegram отправлены
комиссия РР записана
```

### Idempotency check

Повторная доставка того же webhook (через РР или ручной replay): без изменений в `payments_v2`, `entitlement_sources`, `entitlements`, `order_notification_deliveries`, `telegram_messages`.

### Замок режима

После создания первого боевого заказа **не переключать** обратно в test до достижения им терминального статуса. Зафиксировать в карточке текст-предупреждение при попытке смены mode: «Есть активные боевые заказы без терминального статуса. Переключение в test запрещено.» (Enforcement — либо в UI-хендлере смены mode, либо серверной проверкой перед update `config.mode`.)

### DoD задачи 3

- Карточка показывает «Боевой режим — подключено» (после первого paid).
- Один боевой order прошёл весь список verification.
- Повторный webhook идемпотентен.
- Замок против переключения в test работает.

---

## Порядок выполнения (без пропусков)

1. Реализовать Задачу 1 (backend healthcheck + UI карточки). Верификация.
2. Пауза, отчёт пользователю. **Ждём подтверждения.**
3. Реализовать Задачу 2 (RPC + UI cleanup). Верификация guard.
4. Пользователь запускает dry-run, затем реальный cleanup тестовых РР-заказов.
5. Пользователь проходит pre-flight checklist Задачи 3, переключает mode, проводит одну боевую заявку, отчитывается по verification-листу.
6. Финальная фиксация статуса «Боевой режим — подключено» в `.lovable/plan.md`.

## Технические детали

**Файлы под изменение (task 1):**

- `supabase/functions/integration-healthcheck/index.ts` — RR-ветка.
- UI карточки РР (уточнить чтением `src/pages/admin/integrations/*` и `src/components/admin/integrations/*`).
- Возможно, тип статусов healthcheck в общем shared-модуле.

**Файлы под изменение (task 2):**

- Новая миграция: `admin_rr_cleanup_test_data` RPC + `rr_order_is_test_safe` guard.
- `src/components/admin/integrations/` — новый диалог cleanup.
- `src/components/admin/payments/PaymentsTable.tsx` — добавить условный row-action (только test + super_admin).
- `src/hooks/` — вспомогательный хук вызова RPC.

**Файлы под изменение (task 3):** нет, процедура.

## Явно вне scope

- Никакого «универсального удаления платежей».
- Никаких изменений в legacy `subscriptions_v2` создание (заморожен ранее).
- Никаких изменений backend путей `public-rr-installment-initiate`, `rr-webhook`, `rr-fulfill-order` — они уже верифицированы.
- Никаких новых edge functions вне healthcheck и RPC миграции.