# Read-only baseline CRM

Source: main:agent#00000012982336#don:PBBIXW3C

Дополнение к ревизии (READ-ONLY). Записей нет: ни code, ни plan.md, ни commits, ни SQL-writes, ни deploy/Publish. HEAD неизменён — `363601dff31bd43a545c2c4846865572b0da3822`. Все цифры получены только SELECT-запросами.

Принимаю обе поправки: 207 не разрешены к очистке; provider/manager исключаю из purchase identity (это свойства попытки, не покупки); soft-delete без mapping недостаточен.

## A. Согласованные счётчики и денежный ledger

**orders_v2, active vs all** (all = active + is_deleted):

| status | currency | active | all | active final | active paid_amount |
|---|---|---|---|---|---|
| paid | BYN | 4393 | 4401 | 1 662 515.54 | 1 030 804.35 |
| paid | RUB | 17 | 17 | 394.75 | 0 |
| paid | USD | 1 | 1 | 2.00 | 2.00 |
| pending | BYN | 510 | 510 | 220 214.33 | 0 |
| pending | USD | 2 | 2 | 10.00 | 0 |
| draft | BYN | 107 | 107 | 73 575.00 | 0 |
| failed | BYN | 126 | 126 | 32 578.00 | 650.00 |
| refunded | BYN | 55 | 55 | 8 354.00 | 8 354.00 |
| canceled | BYN | 13 | 19 | 21 025.00 | 0 |
| lead | BYN | 5 | 5 | 0 | 0 |
| partial | BYN | 1 | 1 | 1 035.00 | 345.00 |

Удалённые: 8 paid BYN (1 853.00) + 6 canceled BYN (9 750.00). Итого active 5230, all 5244.

**Денежный ledger — только payments_v2, по валютам** (final_price не использую):

BYN, не удалённые:
- поступления succeeded: `Платеж` 3162 / 756 783.94 + `payment` 1629 / 555 642.49 + `sale` 3 / 6 275.00 = **4794 строки, 1 318 701.43**;
- возвраты/отмены succeeded: `refund` 67 / 7 601.30, `Возврат средств` 50 / 7 485.00, `void` 35 / 5 080.00, `Отмена` 150 / 3 724.00 = **302 строки, 23 890.30**;
- `refunded_amount` на succeeded-поступлениях: 5 263.00 (4 200.00 + 1 063.00);
- строки со статусом `refunded` и отрицательной суммой: 18 `payment` (−1 264.50) + 7 `refund` (−2 463.00);
- прочее: failed 1177 (259 779.20 непроведённых, из них 229 tokenization по 1.00), processing 17 / 13 245.00, canceled void 6 / 1 355.00.

USD: 1 succeeded / 2.00 (+1 удалённая 49.99). RUB: **0 строк ledger вообще** — 17 «оплаченных» RUB-заказов не подтверждены ни одним платежом.
Удалённые платежи: 330 succeeded BYN / 33 346.45 + 2 sale / 4 300.00 + 1 USD / 49.99.

Отдельный риск: `transaction_type` не нормализован (`Платеж`/`payment`, `Возврат средств`/`refund`, `Отмена`/`void`, `sale`). Любая денежная выборка без явного маппинга этих значений даст неверную сумму.

**Заказы paid/partial/refunded без строки ledger — 1354.** Разбивка (нельзя трактовать как «пустые»):
- положительная сумма, 724: getcourse 273, getcourse_historical 254, csv_active_import 78, без источника 56, revision_7101ed3c 23, provider=admin 18, getcourse_historical без провайдера 10, rr 7, composable_checkout 4, bepaid_auto 1;
- нулевая сумма, 630: owner_confirmed_historical 286, admin_grant 218, getcourse_historical 92+12, trial_no_card 21, getcourse 1.

**Поправка по колонкам:** `meta->>'grant_type'` в данных **не существует** (0 строк из 5244). В моём предыдущем ответе значения `admin_grant` пришли из `meta->>'source'` из-за coalesce — это была ошибка именования. Реальные поля provenance: `orders_v2.meta.source` (3127 строк), `orders_v2.reconcile_source` (колонка), `orders_v2.provider` (колонка), `purchase_snapshot.*`. Значения `meta.source` у безденежных: `admin_grant` 218 zero + 7 positive, `admin_from_payment` 46 positive, `trial_no_card` 21, `bulk_grant` 2, `site_form` 49 (draft). Метка «Бесплатно» должна строиться на `meta.source in (admin_grant, bulk_grant, admin_deal_only)`, «Триал» — на `trial_no_card`/`is_trial`; `owner_confirmed_historical` (есть маркер `purchase_snapshot.owner_confirmed_paid`) и `getcourse_historical` бесплатными не являются.

## B. Dependency inventory

**30 FK на orders_v2.id** с фактическим ON DELETE:
- CASCADE (физическое удаление уничтожает деньги/документы): `payments_v2.order_id`, `generated_documents.order_id`, `installment_payments.order_id`, `order_notification_deliveries.order_id`, `payment_sales_attribution.order_id`, `scheduled_product_access.order_id`;
- RESTRICT: `company_order_links`, `composable_refund_intents.primary_order_id`, `crm_pipeline_automation_jobs.deal_id`;
- NO ACTION: `subscriptions_v2`, `statement_lines`, `site_form_submissions`, `payment_refund_requests`, `payment_reconcile_queue.processed_order_id`, `referral_sale_attributions`, `referral_bonus_reservations.applied_order_id`, `referral_customer_credit_entries.applied_order_id|source_order_id`;
- SET NULL: `access_grant_ledger.order_id|source_order_id`, `entitlements.order_id`, `order_group_items`, `order_groups.primary_order_id`, `provider_subscriptions.order_id`, `crm_tasks.order_id|deal_id`, `contact_notes.deal_id`, `contact_files.deal_id`, `payment_reconcile_queue.matched_order_id`, `orders_v2.source_deal_id`.

Вывод: физический DELETE исключён категорически — каскад снесёт платежи и документы, а SET NULL молча оборвёт lineage у ledger, entitlements и provider_subscriptions.

JSON-ссылки без FK (проверять отдельно): `audit_logs.entity_id`+`entity_type='orders_v2'`, `provider_events.meta`, `payment_reconcile_queue` payloads, `orders_v2.meta.*`/`purchase_snapshot.*`, tracking_id формата `subv2:<sub>:order:<order>` и `link:order:<order>` в bePaid/Stripe.

**Существующие audit/backup/mapping-таблицы (переиспользовать, не плодить):** `audit_logs`, `payment_tombstones`, `payment_reconcile_queue` + `payment_reconcile_queue_archive`, `duplicate_cases`, `client_duplicates`, `_orders_cohort_b_cleanup_2026_05_backup`, `_orders_orphan_cleanup_2026_05_backup`, `_stripe_cleanup_2026_06_backup_*`, `rev_7101ed3c_backup`, `payment_delete_operations`. Канонического dedup-mapping «дубль → canonical order» **нет** — это настоящий пробел.

**Триггеры на orders_v2 — 13**, из них чувствительные: `referral_order_paid_trigger` (AFTER status='paid'), `referral_order_bonus_reservation_trigger`, `referral_customer_credit_order_state`, `referral_order_customer_discount` (BEFORE, меняет цену), `trg_crm_pipeline_automation_deal_created` (AFTER INSERT), `trg_crm_pipeline_automation_stage_entry`, `trg_crm_pipeline_automation_deal_field_changed` (следит за status, currency, product_id, tariff_id, responsible_user_id, paid_amount, final_price), `trg_validate_deal_pipeline_stage`, `orders_v2_autofill_deal_month_trg`, `trg_orders_v2_resolve_company`, `trg_orders_v2_guard_responsible_change_v1`, `normalize_order_user_id`.
Ни один из них не следит за `is_deleted` — то есть скрытие не вызовет автоматизаций, но и **нет guard-а**, запрещающего скрыть строку с деньгами/доступом или изменить routing у скрытой строки. Необходимые guard-триггеры: (1) BEFORE UPDATE OF is_deleted — запрет при наличии payments/subscriptions/entitlements/documents; (2) запрет hard DELETE на orders_v2; (3) обязательность `deletion_context.canonical_order_id` при is_deleted=true; (4) авто-восстановление видимости при появлении денег на скрытом order.

## C. Кандидаты из 207 — строго

Множество: 207 избыточных pending без единой привязки (проверено 15 таблиц). Сравнение каждого с сохраняемой строкой группы (самая ранняя по created_at) по offer_id, payment_plan_id, pricing_stage_id, flow_id, currency, final_price, is_trial, company_id, `meta.deal_month`, `purchase_snapshot.access_days`, planned access window, source_deal_id:

- полное совпадение включая planned access window — **1**;
- полное совпадение без planned window — **127** в 75 группах;
- расхождения: offer_id 78, access_days 9, final_price 7, planned_access window 206, deal_month 0, payment_plan 0, pricing_stage 0, flow 0, is_trial 0, replacement (source_deal_id) 0.

Важно: `planned_access_start_at/end_at` пишутся в снимок в момент создания заказа, поэтому различаются почти всегда и **не являются объявленным периодом/когортой**. Полей `period`, `cohort`, `composition`, `purchase_context` в `purchase_snapshot` нет вовсе (0 строк) — определение периода/когорты/состава нужно ввести явно до любой чистки. Поэтому expected counts к удалению я не даю: разрешённых к очистке строк — **0**. Классификация: strict-кандидаты ≤127 (и только после утверждения определения периода), uncertain ≥80 (разный offer/цена/access_days), плюс 156 спорных с привязками — вне scope полностью.

## D. 442 сделки без pipeline/stage

По статусу: paid 407, pending 17, draft 14, canceled/refunded/lead/partial 4, failed 0. Нулевая сумма — 339. Историческое происхождение (`reconcile_source is not null` или provider getcourse/historical_import) — 320. Без product_id — 0. Создано за последние 90 дней — 392 (то есть это преимущественно свежие импорты/выдачи, а не древний legacy).

Routing-консистентность на active-множестве: stage не из своего pipeline — **0**; pipeline без stage — **0**; stage без pipeline — **0**. Manual override: полей `routing_manual_override` / `manual_stage_override` / `crm_routing` в meta — **0 строк**, то есть механизма ручного переопределения в данных сейчас нет (в коде есть `_shared/crm-routing.ts` — контракт нужно читать там). Product bindings — 17 при 12 pipeline. Unknown: какие из 17 биндингов «enabled», и охватывают ли они продукты этих 442 — ответ требует чтения `crm_pipeline_product_bindings` в связке с логикой `crm-routing.ts`, что я не делаю без задачи.

## E. Writers и разрывы

Ключи покупки у текущих writers (`_shared/create-payment-checkout.ts`, `public-checkout`, `composable-checkout.ts`, `consume-payment-link.ts`, `admin-create-public-link`, `invoice-checkout-issue`, `public-rr-installment-initiate`, `stripe-create-checkout`, `stripe-create-subscription-checkout`, `admin-create-deal-from-payment`, `admin-create-manual-payment`, RPC `admin_create_deal*`): единого ключа нет. Reuse-ветка существует только в `create-payment-checkout.ts` и опирается на `(user_id, product_id, status='pending', meta.checkout_expired is null)` + возраст заказа (15 мин one_time на строке 344, 24 ч subscription на 791). Все остальные writers создают новый order безусловно.

Критические разрывы:
1. **bePaid stale-token guard** — «протухание» определяется только временем создания заказа на нашей стороне; `expired_at` провайдеру не передаётся, ответ HPP о сроке не используется. Поздний успешный callback по старой сессии придёт с `tracking_id`, который уже помечен `checkout_expired` — ветка обработки этого случая в `bepaid-webhook` не выделена, есть только `unrecognized_tracking_id`.
2. **Stripe subscription invoice materialization** — `invoice.paid` обрабатывается, и есть компенсирующая ветка «если `invoice.paid` не пришёл после `checkout.session.completed`»; порядок событий и идемпотентность держатся на meta, а не на уникальном ключе в БД.
3. **RR** — состояние живёт в `orders_v2.meta.rr.initiation_status/reconciliation_status`, идемпотентность обеспечивается аудитом и `provider_events`, без атомарного claim на уровне строки.
4. Общий разрыв: нет уникального индекса, который делал бы «одна незавершённая покупка = одна строка», и нет таблицы истории попыток — попытки сейчас размазаны по `orders_v2.meta.checkout_tokens_history`, `provider_events`, `payment_reconcile_queue`.

Предлагаемая модель, которую поддерживаю: `orders_v2` — каноническая покупка; идентичность = получатель + продукт + тариф + offer + payment_kind + currency + amount + период/когорта + состав + признак replacement, **без provider и без manager**; атомарный DB-claim через частичный уникальный индекс по незавершённым покупкам + `SELECT … FOR UPDATE`; отдельная таблица истории попыток (provider, session/token, TTL, исход) со ссылкой на canonical order. Подтверждённый успешный callback старой сессии обязан приземлиться на canonical order (деньги не теряются), при этом повторное реальное списание не должно «схлопываться» — различение по `provider_payment_id`, а не по сессии.

**Stop-guards для будущего EXECUTE:** любое расхождение baseline-счётчиков из раздела A между dry-run и выполнением — STOP; появление привязки у кандидата — пропуск строки; физический DELETE на orders_v2 — запрещён; RUB-«оплаченные» без ledger и 1354 заказа без ledger — вне любой автоматической обработки.

**Открытые unknowns:** определение периода/когорты/состава (в данных отсутствует); реальный TTL bePaid; статус enabled у 17 product bindings; природа 724 положительных paid без ledger (legacy-импорт или потерянные платежи); отсутствие канонической dedup-mapping таблицы.

