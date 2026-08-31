# План: окончательная ревизия PR #404 и managed-продолжение платёжного восстановления

PR #404, head `fab9b388`, base `c1202d9c`. Diff и `docs/PAYMENTS_CANONICAL_RECOVERY_20260831.md` прочитаны read-only (без checkout, без изменений). Ниже — результат ревизии и единый план A–E. Ничего не исполнялось.

## 1. Результат ревизии кода (read-only)

Проверено по точному диффу (23 файла, +2032/−3149):

- **Схема используемых полей — совпадает с production.** `payment_reconcile_queue` (bepaid_uid, tracking_id, amount, currency, raw_payload, status, attempts, updated_at, processed_order_id, matched_order_id, matched_profile_id, last_error, next_retry_at, processed_at, last_attempt_at), `payments_v2` (provider_payment_id, order_id, profile_id, user_id, paid_at, refunded_amount, meta), `orders_v2` (provider_payment_id, order_number, final_price, meta; `paid_at` действительно отсутствует), `subscriptions_v2` (access_end_at, status, meta), `provider_subscriptions` (state, subscription_v2_id, last_charge_at, next_charge_at, updated_at, order_id), `entitlements.expires_at`, `access_grant_ledger.source_order_id/status`, `tariffs.access_days`, `products_v2.meta`. Расхождений нет.
- **Provider response поля** — `transaction.uid/status/type/amount(int, /100)/currency/paid_at` и `subscription.id/state|status/last_transaction.uid/renew_at|next_billing_at`; сравнение сумм через допуск 0.005, `paid_at` обязателен, тип только `payment|capture`. Соответствует ответам, полученным в #403.
- **Dry-run без DML** — ветка `dryRun` возвращает `{dry_run, no_writes, plan}` до claim/lease/audit; в exact-ветке нет ни одного write до этой точки; `bepaid-queue-cron` в dry-run только формирует отчёт. Ветка `dryRun` без `queueItemId` в `payments-reconcile` даёт 400.
- **Single CAS ownership** — claim/`updated_at`-CAS остался только в `reconcileExactQueuePayment`. `bepaid-queue-cron` полностью лишён claim (отдаёт snapshot `expectedUpdatedAt`), `bepaid-auto-process` делегирует recurring до legacy/fuzzy matching. Передачи уже владеющего lease и двойного claim нет.
- **Canonical REBILL при legacy tracking** — используется общий REBILL engine из `_shared/rebill`, старые пути оставлены wrappers; legacy `orders` не пишется; `updatePaymentOrderId` заменён на проверку и бросает `recovery_payment_rebind_forbidden` (нет rebind платежа).
- **Неизменяемое окно** — окно берётся из `meta.recovery_access_start_at/recovery_expected_end_at` REBILL-заказа при повторе; иначе `max(paid_at, sub.access_end_at)`; NOW не используется. `grant-access-for-order` заменил `NOW`-заглушку на первый подтверждённый `payments_v2.paid_at` (`payment_window.ts`), при отсутствии даты новое окно не создаётся.
- **Ghost profiles / direct grants** — профиль резолвится строго `order.profile_id → profiles.user_id → auth.admin.getUserById`; доступ выдаётся только через `grant-access-for-order` + read-back; прямых insert в entitlements/subscriptions нет.
- **Package isolation** — новые модули импортируют только `_shared/*` и `npm:@supabase/supabase-js@2`; сторонних зависимостей не добавлено.
- **Новые guards присутствуют**: повтор после частичного grant (`fulfillmentProof` + сохранённое окно), current profile/auth user, foreign SBS/active-sub, refund (включая `meta->>parent_payment_uid`), cancel/suppressed (`do_not_grant_access`, `refund_candidate`, `suppressed_post_cancel_charge`), persisted payment+access read-back до `completed`, повторная проверка identity/PS после CAS.
- **Уровни 1/2 у прежнего `payments-reconcile` сохранены**, exact-запрос их обходит и не шлёт массовое уведомление.
- **Миграция `20260831073813`** меняет только `timeout_milliseconds := 120000` у двух существующих jobs, с 6 STOP-проверками (число jobs, active, расписание, URL, scoped header, ровно один `net.http_post`), идемпотентна, не читает секрет и не запускает job.

## 2. Findings (не исправляю, только фиксирую)

1. **CRITICAL для сценария D (INV-25, очередь `e8d645fa`).** `tracking_id` — legacy формат `orderId_userId`; `ae01ab65` существует только в legacy `orders` (250 BYN, paid, user `9267a27e`), в `orders_v2` его нет, `payments_v2` с UID `41ad0f04` нет, SBS в payload нет. По коду #404 exact dry-run детерминированно упадёт на `recovery_provider_tracking_mismatch` / `recovery_no_canonical_order`. Это корректное поведение (нет legacy-записей), но означает, что D не завершится «одним REBILL» без отдельного решения о canonical parent order в `orders_v2`. У клиента есть только `pending`-заказы того же продукта и более старые `paid` — автоподбор запрещён.
2. **Окно доступа INV-25.** Продукт `11c9f1b8` (`club`) имеет `meta.access_window_rule = calendar_month`, поэтому расчётный конец окна берётся из `calcCalendarMonthEnd`, а не «Aug29 12:00 → Sep29 12:00». Требование Aug29 noon→Sep29 noon выполнимо только через явные `customAccessStartAt/EndAt` в плане восстановления; иначе значения в dry-run не совпадут.
3. **Побочный эффект деплоя `payments-reconcile`.** Массовая выборка расширена с `status=pending` на `status in (pending,error)`. Ближайший scheduled run начнёт подхватывать исторические `error`-строки (например `77128219`, attempts=0). Это усиливает требование: деплой воркеров = согласование ближайшего cron-run.
4. **Очередь и attempts.** 4 строки к закрытию (`4747b8d9`, `99e8c678`, `b25ef91e`, `4708a0f9`, `ec947f62`, `3acc35a0` — набор из ранее согласованного списка) имеют `attempts = 5`, то есть воркером они уже не обрабатываются; закрытие возможно только точечным metadata-UPDATE, как и запланировано.
5. **`17f2686e`** сейчас `paid_at = 2026-08-22 08:45:34+00`, целевое значение провайдера `2026-08-22T08:45:36.492Z` — подтверждено.

## 3. План (plan-only, исполнение по отдельному разрешению)

### A. Merged SHA и guard-доступ
1. Дождаться зелёного CI, получить точный merged SHA в `main`; синхронизировать репозиторий ровно на него (без ручных правок).
2. Первым деплоить только `grant-access-for-order`.
3. Negative-auth без побочных эффектов: `OPTIONS` и запрос без валидного scoped-заголовка → ожидаем 401/403 до любых бизнес-веток; никаких `orderId` в теле.

### B. Metadata-транзакция (одна транзакция, CAS, rowcount-строгий)
Состав ровно: 6 PS + 4 queue + 1 payment.
1. Пересчитать fingerprint по 11 строкам; **новая версия включает старую ссылку `ad0aaf53.subscription_v2_id = eaeb666b`**; прежний `1ee9271029db29082170bdd27a450138` считается устаревшим и не используется как guard.
2. 6 × `UPDATE provider_subscriptions SET last_charge_at, next_charge_at` — значения строго из fresh provider GET (`transaction.paid_at`, `subscription.renew_at`), `WHERE id = <exact> AND updated_at = <snapshot> AND state='active'`.
3. Дополнительно **только у `ad0aaf53`**: `subscription_v2_id: eaeb666b → 6c83f4af` в той же строке того же UPDATE (не новая подписка, не новый платёж), на основании принятого preflight: exact provider UID `1fa9b9ee` → единственный succeeded payment → order `1057fe3b` → единственная active sub `6c83f4af`, обе replacement-ссылки, совпадение user/profile/product/tariff, отсутствие другой PS/active sub. Правило «NULL SBS = тот же SBS» не применяется.
4. 4 × `UPDATE payment_reconcile_queue SET status='completed', processed_order_id/matched_order_id = <фактический paid order>, matched_profile_id, last_error=NULL, next_retry_at=NULL` с CAS по `updated_at`.
5. 1 × `UPDATE payments_v2 SET paid_at = '2026-08-22T08:45:36.492Z'` для платежа UID `b83b0e91` (`339`), CAS по `updated_at`.
6. Перед фиксацией — повторная проверка fingerprint и всех preflight-guards; любой rowcount ≠ ожидаемому → ROLLBACK всей транзакции.
7. Read-back SELECT: 6 PS (last/next/ссылка), 4 queue (`completed` + order), 1 payment (`paid_at`).

### C. Остальные 5 функций + timeout-миграция
Выполняются **только после отдельного разрешения на фактическое восстановление и стандартные уведомления**, потому что их развёртывание открывает ближайший scheduled run (см. finding 3):
`payments-reconcile`, `bepaid-queue-cron`, `bepaid-auto-process`, `bepaid-webhook`, `admin-materialize-post-cancel-charge`; затем managed-миграция `20260831073813` (перед применением — сверка формы двух текущих cron-команд; расхождение → STOP).

### D. INV-25
1. Свежий exact dry-run строки `e8d645fa` (`dryRun=true`, `expectedUpdatedAt`), без claim и без записей.
2. Ожидание: 1 REBILL-заказ + 1 payment, та же подписка/клуб, окно Aug29 12:00 → Sep29 12:00.
3. **Ожидаемое отклонение по findings 1 и 2**: dry-run, вероятнее всего, вернёт `recovery_no_canonical_order` (legacy tracking, заказа нет в `orders_v2`), а окно клуба по умолчанию считается по календарному месяцу. При любом таком результате — STOP и точный finding, без самостоятельного подбора заказа и без изменения legacy `orders`.
4. Только при полном совпадении dry-run с ожиданием — единичное canonical recovery (exact `queueItemId`), затем read-back: payment → paid order → subscription/entitlement/ledger, SELECT-инварианты INV-25 и INV-P0-1.

### E. Publish
Только после PASS всех предыдущих шагов: зелёный merged SHA, миграция, точечные деплои, metadata read-back, INV-25 read-back, отсутствие нового critical finding.

## 4. Границы

До отдельного разрешения: не запускать workers, cron runs и health-функции с уведомлениями; никаких business DML, grant, сообщений, платежей, отмен и возвратов; remap `ad0aaf53` остаётся неисполненным до повторной проверки всех guards непосредственно перед execute.
