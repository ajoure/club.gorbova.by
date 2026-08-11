# PLAN-ONLY / READ-ONLY: материализация инцидентного платежа d16b929f и классификация 4 живых provider-строк

Ничего не изменено: без кода, миграций, deploy, provider-вызовов на запись, Publish.

## 1. Инцидентный платёж d16b929f (provider row 7d5f31d3 — уже canceled)

### Что реально есть в системе (проверено чтением)

Строка в `payment_reconcile_queue` уже существует:

- `id = c312dc07…`, `bepaid_uid = d16b929f-f38e-49e5-b541-4e79e6875e0a`
- `amount = 150`, `currency = BYN`, `paid_at = 2026-08-11 03:00:50+00`
- `status = pending`, `status_normalized = successful`, `source = webhook`
- `tracking_id = subv2:603f9077…:order:17181a8c…`
- `matched_order_id`, `matched_profile_id`, `processed_order_id` — все NULL
- `last_error = payments_v2 write failed: there is no unique or exclusion constraint matching the ON CONFLICT specification`

Достоверные поля от провайдера: uid транзакции, сумма 15000 копеек = 150.00 BYN, валюта BYN, `paid_at`, `tracking_id` (даёт subscription_v2_id и order_id исходной подписки), карта (brand master, last4 …7502), plan `pln_8708a3d0…` (Gorbova Club — FULL, 150.00 BYN / 30 дней), `active_to = 2026-09-08T17:57:50Z`, состояние подписки после отмены `canceled`.

### Проверка существующих путей

| Путь | Что делает фактически | Пригодность |
|---|---|---|
| `bepaid-recover-payment` | Только создаёт строку в `payment_reconcile_queue` из транзакции bePaid; при существующей строке — выходит без действий | Не подходит: строка уже есть, order/payment не создаёт |
| `admin-materialize-queue-payments` | Берёт только `status='completed'`, вставляет одну строку `payments_v2` без создания order, без grant/entitlement/telegram | Частично: безопасен по доступам, но (а) не видит `status='pending'`, (б) не создаёт REBILL order, (в) не проставляет `manual_review` / `refund_candidate` |
| `admin-bepaid-webhook-replay` | Повторно отправляет webhook payload в `bepaid-webhook` | Опасно: проходит полный бизнес-путь, может тронуть подписку/доступ. Не использовать |
| `bepaid-get-subscription-details` | Канонический pull; побочно пишет `last_transaction` в `payments_v2` | Сейчас падает: `amount: lastTx.amount ? lastTx.amount/100 : null` → при отсутствии `amount` в `last_transaction` вставка нарушает NOT NULL `payments_v2.amount` и функция бросает `payment_insert_failed` |
| `payment_reconcile_queue` (таблица) | Хранилище, не исполнитель | Источник данных, не путь |

**Вывод: безопасного существующего пути, дающего ровно один REBILL order + одну строку `payments_v2` с подавленным grant и флагами `manual_review=true` / `refund_candidate=true`, сейчас нет.**

### Минимальный GitHub-патч (предложение, не выполнено)

Ветка `codex/incident-materialize-post-cancel-charge`, один PR, ровно два файла:

1. `supabase/functions/bepaid-get-subscription-details/index.ts`
   - Изменить только блок персиста `last_transaction`: если сумма транзакции не определена — не вставлять строку, а записать `audit_logs` с `bepaid.payment.upsert_skipped_no_amount` и продолжить возврат данных подписки. Никакой другой логики не трогать.
   - Эффект: read-only pull провайдера снова работает и не блокируется NOT NULL.

2. Новая функция `supabase/functions/admin-materialize-post-cancel-charge/index.ts` (admin/superadmin only, `dry_run` по умолчанию true)
   - Вход: `queue_id` (или `bepaid_uid`), обязателен явный `expected_amount`, `expected_currency`, `expected_paid_at`.
   - Идемпотентность: если существует `payments_v2` с `provider='bepaid'` и `provider_payment_id=<uid>` — выход `already_materialized`, без записи.
   - Создаёт ровно: 1 order в `orders_v2` (`status='paid'`, `provider='bepaid'`, `provider_payment_id=<uid>`, `campaign_key`/`meta.origin='post_cancel_charge_incident'`, `meta.manual_review=true`, `meta.refund_candidate=true`, `meta.access_suppressed=true`) + 1 строку `payments_v2` (`amount=150`, `currency='BYN'`, `status='succeeded'`, `paid_at` из очереди, `order_id` нового order, `meta.manual_review=true`, `meta.refund_candidate=true`).
   - Жёстко запрещено внутри функции: любые записи в `subscriptions_v2`, `entitlements`, `entitlement_sources`, `telegram_access`, любые вызовы grant/notify, любые provider POST.
   - Обновляет `payment_reconcile_queue`: `status='completed'`, `processed_order_id`, снятие `last_error`; пишет `audit_logs`.

Миграции не требуются: используются существующие таблицы и колонки.

### Контракты dry-run / read-back (для будущего EXECUTE)

- Dry-run: `processed=1`, `would_create_orders=1`, `would_create_payments=1`, `access_actions=0`, ноль DML и ноль provider-запросов.
- Снимок до/после (counts + md5): `subscriptions_v2` 1471, `entitlements` 1088, `telegram_access` 266 — обязаны совпасть; `orders_v2` 4600 → 4601, `payments_v2` 6585 → 6586 и только за счёт uid `d16b929f…`.
- Read-back: ровно одна строка `payments_v2` с этим `provider_payment_id`, привязанная к одному новому order; `manual_review=true`, `refund_candidate=true`; повторный вызов возвращает `already_materialized`.

## 2. Четыре живые provider-строки — таймлайн-классификация (только чтение)

Пользователи обозначены префиксами.

| Row | provider sub | Локальная sub | Локальный статус | provider active_to / renew_at | Наблюдаемые списания | Классификация |
|---|---|---|---|---|---|---|
| `d120f76e` | `sbs_e5a0f6…` | `2a50d1aa…`, u `44985cf1` | superseded, access_end 2026-08-25 | 2026-08-25T07:12 | 250 BYN 26.06 07:12, 26.07 07:15 — совпадает с созданием строки 26.06 07:11 | **Доказанное живое биллинг-расписание.** Параллельно у того же пользователя идёт второй поток 250 BYN 25-го числа (25.06, 25.07) — фактическое двойное списание. Отмена провайдера здесь недопустима без бизнес-решения, какой из двух потоков канонический |
| `ef99dcc8` | `sbs_076d0a…` | `24d05c0f…`, u `4a94ab96` | expired 2026-07-31 | 2026-07-31T09:16 (snapshot от 31.07 09:40, renew не сдвинулся) | 250 BYN 01.06 09:16 совпадает; 31.07 09:30 и 01.08 03:01 не атрибутируются однозначно | **Ambiguous.** Нужен свежий канонический pull (заблокирован дефектом amount=null) |
| `ea2eea93` | `sbs_a6ad6a…` | `52884e7d…`, u `3328ff3b` | superseded, access_end 2026-08-14 | 2026-08-14T20:04 (snapshot от 24.07) | Списаний по 14-му числу не найдено; активный доступ пользователя обеспечен другой локальной sub `a4081874` (350 BYN 15-го числа, без provider-строки) | **Ambiguous, склоняется к zombie.** Требуется свежий pull до 14.08, иначе риск списания |
| `74993d13` | `sbs_e1f92f…` | `572175f0…`, u `8b5bc345` | superseded, access_end 2026-08-15 | 2026-08-15T17:50 (snapshot от 17.07) | Списаний по 15-му числу не найдено; у пользователя платежи 16-го (250 BYN 16.06, 16.07) и 442 BYN 31.07 | **Ambiguous, склоняется к zombie.** Требуется свежий pull до 15.08 |

Никаких provider-отмен и записей не выполнялось. Ни одна строка не классифицирована как zombie «по факту» — доказанным считается только `d120f76e` как живой биллинг.

## Порядок безопасного продолжения

1. Merge патча (2 файла) → sync exact SHA → deploy ровно `bepaid-get-subscription-details` и новой функции.
2. Свежий read-only pull по `ea2eea93`, `ef99dcc8`, `74993d13` (после починки amount) — до дат ближайшего renew.
3. Dry-run материализации инцидента, затем execute с read-back выше.
4. Решение по `d120f76e` (двойной поток) выносится отдельно, как бизнес-вопрос, не в этом спринте.
