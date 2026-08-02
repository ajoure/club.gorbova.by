# План: единый безопасный EXECUTE по инцидентам A / B / C (SHA 627089964811f1b20e52c48dfb347a7a96625639)

Ниже — только план. На этом шаге ничего не изменено: кода, коммитов, миграций, deploy, Publish, production-данных, вызовов bePaid и выдачи доступов не было.

## 0. Факты, установленные read-only

Preflight: managed HEAD = `627089964811f1b20e52c48dfb347a7a96625639` («fix(payments): restore paid club rebill access (#257)»), дерево чистое. Диф PR #257 — ровно 8 файлов внутри `bepaid-webhook` и `grant-access-for-order` (включая новые `provider_subscription_link_repair.ts`, `provider_linked_subscription_resolver.ts` и тесты). Другие функции, миграции и UI не затронуты.

### A. Два genuine rebill-заказа (подтверждено)

| order_id | payment | статус | provider sub | связанная subv2 | текущий доступ |
|---|---|---|---|---|---|
| b6b02e58… | 00166bef… succeeded, refunded_amount=0, paid_at 2026-07-31 12:01 | orders_v2=paid | sbs_50c2b31efad2850b, state=active, order_id=b68bf688… | 64067f5d… = **superseded**, access_end 2026-07-31 20:59:59 | ledger=0, entitlement active=0; subv2 94cb9348… expired, access_end 2026-08-01 12:00 |
| b0212d5c… | 42d4046d… succeeded, refunded_amount=0, paid_at 2026-07-31 03:06 | orders_v2=paid | sbs_65ec39b56bea0ee4, state=active, order_id=db4f19c5… | ff133d28… = **expired**, access_end 2026-07-29 20:59:59 | ledger=0, entitlement active=0; subv2 af220fc4… expired, access_end 2026-08-01 12:00 |

Важно: у обеих provider-подписок `state=active`, но привязанная `subscription_v2` терминальна (superseded/expired) и её `order_id` — другой (старый) заказ. По действующему стандарту provider-linked extend это состояние даёт `manual_review_provider_linkage_conflict`, поэтому repair линковки в новом коде обязателен ДО вызова grant. Договорный `access_end_at` = 2026-08-31 12:00:00+00 (продление от 2026-08-01 12:00, 30 дней), а не now()+30d.

### B. INV-20 — 4 «paid orders без payments_v2»: реальной пропажи платежа НЕТ

Полные id и доказательства:

| order_number | order_id | user | meta | реальный платёж |
|---|---|---|---|---|
| ORD-26-02908-A1 | a6c4a129-d145-48e9-9445-eca5caf66194 | 94dd8f18… | group_child_order=true, group_payment_id a09169c1…, parent 68ed9a89… | payment a09169c1… succeeded, bepaid UID be60e9b6…, 1925 BYN, refunded=0 |
| ORD-26-02908-A2 | 2ed72842-2414-4c26-887e-940f76c5fde4 | 94dd8f18… | тот же group_payment_id | тот же родительский платёж |
| ORD-26-02836-A1 | c7e73d97-6c49-4832-a3a1-a0f3cb600415 | f32ff3d9… | group_child_order=true, group_payment_id 80355c88…, parent 4ffa5e3d… | payment 80355c88… succeeded, provider=bank, 3300 BYN, refunded=0 |
| ORD-26-02836-A2 | 603b779a-814f-41eb-accd-e7442d11888f | f32ff3d9… | тот же group_payment_id | тот же родительский платёж |

У всех четырёх нет собственного provider UID и `orders_v2.provider_payment_id` пуст — это дочерние строки split-заказа, оплата учтена на родителе. Создание отдельных `payments_v2` для них удвоит выручку и создаст фиктивные UID (`repair:{order_id}`). Поэтому **actionable-строк для создания платежей = 0**; правильное действие — подтвердить это dry-run’ом и признать INV-20 ложноположительным для `group_child_order`.

### C. INV-25 — зависшая очередь

Полный id `7927df81-321c-45d7-bc89-d31dfebfbb39`; `bepaid_uid = 7d08a6bf-2912-4050-98e3-8860a21993ca`; source=webhook, status=processing с 2026-07-29 18:00 (возраст ~3 дн 17 ч), attempts=1/5, last_error пуст, `processed_order_id`/`matched_order_id` пусты, status_normalized=successful, 250 BYN, paid_at 2026-07-29 08:15. Canonical `payments_v2` с этим UID **не существует**; `tracking_id` указывает на order `bc0f7a90-…`, которого в `orders_v2` нет. Это единственная stale-processing строка.

## 1. Preflight (STOP-gate)

1. `origin/main` и managed HEAD ровно `627089964811f1b20e52c48dfb347a7a96625639`, дерево чистое.
2. Повторить снимок таблицы-кандидатов A/B/C (без PII, без payload/token) и сверить с разделом 0.
3. STOP при любом расхождении SHA, состояния заказов, появлении refund/void/chargeback или новых stale-строк.

## 2. Deploy

Развернуть с этого SHA ровно две функции: `bepaid-webhook`, `grant-access-for-order`. Никаких миграций, UI Publish, других функций, AmoCRM/GetCourse.

## 3. Группа A — по одному заказу

Для каждого из двух заказов последовательно:

1. Read-only проверка линковки: `provider_subscriptions.provider_subscription_id` ↔ subv2 ↔ user/product/tariff/order.
2. Repair линковки допускается только если старая привязанная цепочка терминальна (`superseded`/`expired`/`canceled`) и user/product/tariff совпадают с заказом. Если привязанная subv2 окажется `active` или принадлежит другому пользователю/продукту — **STOP**, без изменений.
3. Вызвать канонический `grant-access-for-order` ровно один раз для одного заказа. Прямой DML по `entitlements`, `subscriptions_v2`, `access_rules`, датам доступа запрещён.
4. Read-back до перехода ко второму заказу: ledger-запись появилась, entitlement active, `access_end_at = 2026-08-31 12:00:00+00` (не now()+30d), subv2 не разветвилась, notification outcome записан.
5. STOP при `manual_review_*`, при отклонении даты от договорной или при появлении второй параллельной активной subv2.

## 4. Группа B — dry-run прежде всего

1. Вызвать `admin-repair-missing-payments` с `dry_run: true` и зафиксировать `total_missing / repaired / no_real_payment / suppressed` и список order_id.
2. Execute разрешён **только** для строк, где доказан собственный succeeded-платёж: provider UID или успешный webhook/queue/provider record, отсутствие refund/void/chargeback и отсутствие UID collision.
3. По текущим данным ни одна из 4 строк этому не соответствует (все — `group_child_order` с оплатой на родителе), поэтому ожидаемый execute-набор = 0. Если dry-run это подтверждает — execute не запускается вовсе; фиксируется вывод «INV-20 actionable = 0, ложноположительное срабатывание на дочерних заказах группы».
4. Если dry-run внезапно покажет строку с собственным provider UID — только она обрабатывается точечно, затем read-back `payments_v2` (UID уникален, сумма/валюта совпадают) и лишь после этого канонический grant access, если продукт требует доступ и доступ действительно отсутствует. Никакого массового blind execute.

## 5. Группа C — идемпотентное закрытие или безопасный retry

1. Повторно проверить наличие canonical `payments_v2` по UID `7d08a6bf-…` и по tracking_id.
2. Если платёж уже есть — идемпотентно закрыть строку очереди с привязкой к существующему платежу, без повторной materialization и без grant.
3. Если платежа нет (текущее состояние) — вернуть строку в `pending/next_retry` **только** при валидном provider evidence (успешный статус транзакции в записи webhook и разрешимый order/tracking). Сейчас `tracking_id` указывает на несуществующий заказ, поэтому при сохранении этой картины строка помечается как требующая ручного разбора и не реплеится.
4. Новых списаний и вызовов bePaid charge не выполняется ни при каком исходе.

## 6. Read-back после каждого batch

Уникальность payment UID, статусы order/payment, наличие ledger-записи, entitlement active, точный договорной срок, состояние subscription, notification outcome. Уже активные доступы не продлеваются.

## 7. Критерии завершения

- INV-20 actionable = 0 (с доказательством, что 4 строки — дочерние заказы с оплатой на родителе).
- INV-25 stale processing = 0.
- Genuine paid/succeeded club-заказов с действующим договорным окном без active entitlement = 0.
- Отдельным запросом доказать неизменность: 9 expired `trial_no_card` заказов и 3 уже активных no-ledger заказа (`f524ffd5…`, `0bce577f…`, `ca5c13a2…`) — `updated_at`, статусы, entitlement и access_end до и после совпадают.

## 8. Общие STOP-условия

SHA/state mismatch; refund/void/chargeback у кандидата; active чужая provider-цепочка; `manual_review_*` от grant; расхождение даты доступа с договорной; UID collision; попытка создать платёж без provider evidence; любая ошибка RLS/permission (не маскируется).
