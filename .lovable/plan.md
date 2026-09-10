# План: точечный возврат конкретного платежа + сведение дубля рассрочки (20 поток)

PLAN-ONLY / READ-ONLY. Код, SQL, provider-writes, deploy и Publish не выполнялись.
Опубликованный source: `b08aa42bfba39ccbafa2ffd9d296ee895e2eeffd`.

## 1. Актуальные факты (read-only, без ПД)

Продукт: `3e43fb28-8322-41bc-bfee-714731bdc630` (20 поток). Всего у клиента по этому продукту — ровно 2 заказа.

Заказ A (исходный) `e17b35b2-d908-48e1-b98f-ca5f86cdf579`
- `SUB-LINK-MS69W0DD`, статус `paid`, final_price 663.00 BYN, paid_amount 663.00, tariff `98539e5d-…`, offer NULL, создан 29.07.2026, is_deleted=false
- подписка `c6633a7b-216f-41e5-b32a-cb771add4ad6`: provider_managed, `sbs_9a86268a608fca3f`, отменена 11.08.2026 (`bepaid_terminal_state=canceled`), access_end 28.08.2026
- платёж 1: `40f01f87-79c1-44cf-9148-64c71d0d871f`, 663.00, `succeeded`, provider uid `e1908f33-…`, оплачен 29.07.2026, refunded_amount 0
- entitlement по этому заказу: 0

Заказ B (дубль/перевыпуск) `9673e359-e98e-4e7e-8196-f31f60b4e16d`
- `SUB-LINK-MSOFLH7I`, статус `paid`, final_price 663.00, paid_amount 663.00, tariff `767bb895-…`, offer `c7f5221e-…`, создан 11.08.2026
- подписка `d16b01e5-efdd-43c8-a98c-c7d15daacfa7`: `sbs_bd6975629dfe2c83`, billing_cycles 2, paid_billing_cycles 2, installment_status `completed`, статус `expired`, access_end 07.06.2027
- платёж 2: `8401bbfb-1d90-4b3f-8738-7ce581a9bc51`, 663.00, `succeeded`, uid `44c6af6c-…`, 11.08.2026, refunded_amount 0
- платёж 3: `1ad28122-537a-4272-8cc4-7df4cf4bd6ac`, 663.00, `succeeded`, uid `6e1edf0b-1fb4-47a5-a048-6f937cce7d52`, 10.09.2026, refunded_amount 0
- entitlement `17285a9f-…`: active, product_code `prd_7222cb3152c3`, expires 07.06.2027

Итого: 3 подтверждённых списания × 663 = 1989 BYN при обязательстве 1326/1325 по одной подписке; refund-строк нет (0), `installment_payments` строк нет (0 — provider-managed finite не материализует график).

Целевое состояние по требованию: одна сделка 1325 BYN, первые два 663+663 остаются, третий (`1ad28122-…` / uid `6e1edf0b-…`) должен быть возвращаемым, доступ сохраняется.

## 2. Provider GET
Свежая read-only сверка транзакций/возвратов/подписок у провайдера не выполнена: canonical credentials теперь owner-restricted (этап PR433/434), у среды нет доступа к ним, ранее прямой read-only auth возвращал 401. Фиксирую как ограничение — provider-side подтверждение нужно снять до apply (см. preconditions).

## 3. Корневая причина точечного возврата
`supabase/functions/subscription-admin-actions/index.ts` (refund):
- строки 336–341: `payments?.find(p => p.status==='succeeded' && p.provider_payment_id && p.transaction_type!=='refund')` — берётся **первый** подходящий платёж заказа. Для заказа B это платёж 2 (11.08), а не третий.
- `actualRefundAmount = refund_amount || order.final_price` — сумма не проверяется против выбранного платежа.
`src/components/admin/RefundDialog.tsx` работает на уровне `orderId`, конкретный `payment_id` не передаётся; кнопка возврата не привязана к строке платежа.

## 4. Минимальный GitHub-first патч (одним PR)
1. Edge `subscription-admin-actions`, action `refund`:
   - принимать необязательный `payment_id`; если передан — выбирать именно эту строку `payments_v2` с проверками: `order_id` совпадает, `status='succeeded'`, `transaction_type!=='refund'`, `is_deleted` не true, есть `provider_payment_id`; иначе `payment_not_refundable`.
   - валидация суммы: `refund_amount <= payment.amount - payment.refunded_amount`, иначе `refund_exceeds_payment_balance`. Без `payment_id` — прежнее поведение (обратная совместимость).
   - идемпотентность: `refund_request_key` обязателен при переданном `payment_id`; фактическая защита остаётся в `record_refund_atomic` (dedup по `provider_payment_id` refund-uid). Ничего нового в БД не создаётся.
   - `access_action` по умолчанию `keep` — доступ и entitlement не трогаются.
2. UI: в списке платежей сделки/рассрочки (DealDetailSheet и вкладка рассрочек) кнопка «Возврат» на каждой строке платежа; `RefundDialog` получает `paymentId`, `maxAmount = amount - refunded_amount`, показывает дату/сумму конкретного списания и передаёт `payment_id` + `refund_request_key`.
3. Тесты: unit на выбор платежа (третий, не первый), на превышение суммы, на повторный вызов с тем же ключом; UI-тест наличия кнопки на каждой строке.
4. Никаких изменений схемы, RLS, grants, RPC.

## 5. Сведение дубля (отдельный apply, не в этом PR)
Без удаления платежей, orders и доступа:
- заказ A `e17b35b2-…`: пометить в `meta` как `superseded_by = 9673e359-…`, статус и платёж не менять, is_deleted не ставить.
- заказ B `9673e359-…`: сделать носителем обязательства 1325/1326 (`meta.installment.effective_total_byn`), связать платёж 1 как учтённый по этому обязательству через `meta`, без переноса строк платежей.
- подписки, entitlement `17285a9f-…` (expires 07.06.2027) и access_rules не менять.
- после возврата третьего платежа: `orders_v2.status` остаётся `paid` (частичный возврат), классификатор UI покажет «Частичный возврат» по paidSum/refundedSum.

## 6. Ожидаемые rowcounts при apply
Возврат 663 по `1ad28122-…`:
- +1 строка `payments_v2` (`transaction_type='refund'`, amount −663.00, provider uid возврата), всего 4
- `payments_v2.refunded_amount` у `1ad28122-…`: 0 → 663.00 (1 UPDATE)
- `orders_v2` `9673e359-…`: 1 UPDATE meta, status остаётся `paid`
- `entitlements`: 0 изменений; `subscriptions_v2`: 0 изменений; `installment_payments`: 0
- audit: 1 запись `admin.subscription.refund_recorded`
Сведение дубля: 2 UPDATE в `orders_v2` (только meta / пометка), 0 DELETE.

## 7. Preconditions для apply
- PR смержен, checks PASS, exact SHA сообщён; функция `subscription-admin-actions` задеплоена из approved source.
- Свежий provider read-only GET по uid `6e1edf0b-…`: транзакция `successful`, возвратов по ней 0; подписка `sbs_bd6975629dfe2c83` в terminal/completed состоянии; `sbs_9a86268a608fca3f` — canceled.
- Повторная сверка: refunded_amount по всем трём платежам = 0, refund-строк 0.
- Возврат запускается ровно один раз с `payment_id=1ad28122-…`, `refund_amount=663.00`, `access_action='keep'`, уникальным `refund_request_key`.
- Read-back по п.6; при любом расхождении, provider-ошибке или новом critical — STOP.

Реальный возврат не запускался.

---

# Дополнение по консолидированной ревизии Codex (READ-ONLY, EXECUTE не разрешён)

## 1. Идемпотентность до вызова провайдера — принято
Подтверждаю: live `record_refund_atomic` дедуплицирует только по УЖЕ полученному `provider_payment_id = p_refund_uid`, то есть защищает лишь запись, а не повторный POST в bePaid. Раздел 4 плана заменяется:
- новая service-only таблица `payment_refund_requests` (RLS: только service_role; никаких anon/authenticated grants);
- reserve-RPC `SECURITY DEFINER`: `SELECT ... FOR UPDATE` по строке `payments_v2`, вставка заявки с уникальным fingerprint `request_key + payment_id + amount_minor + access_action`;
- состояния: `reserved → provider_called → recorded | failed`; повторный вызов с тем же fingerprint возвращает существующую заявку, конкурирующий вызов с другим fingerprint по тому же payment получает отказ; «неопределённая» попытка (нет terminal-ответа провайдера) блокирует повтор до ручного разбора;
- провайдер вызывается только после успешного reserve; после ответа — `record_refund_atomic` в той же логической цепочке.
Managed-копия допускается только как тот же SQL с новым timestamp после exact SHA.

## 2. Выбор платежа и суммы — принято
- Без `payment_id` при >1 refundable платеже — явная ошибка `payment_id_required` (никакого «первого»).
- UI загружает безопасный список: `payment_id`, дата, сумма, остаток; передаёт exact ID.
- Сумма: целое положительное в копейках, `<= amount - refunded_amount` выбранного платежа.
- Провайдеры не смешиваются: возврат идёт только через провайдера самого платежа (bePaid ≠ Stripe ≠ банковская рассрочка); чужой провайдер — отказ.
- `access_action='revoke'` запрещён, если возврат частичный по сделке; допустим только при полном возврате всей суммы.

## 3. Сведение дубля — принимаю вариант Codex (B — носитель)
Обновлённые факты зависимостей (не-PII):

| объект | A `e17b35b2…` | B `9673e359…` |
|---|---|---|
| payments_v2 | 1 | 2 |
| subscriptions_v2 | 1 (`c6633a7b…`, canceled) | 1 (`d16b01e5…`, expired/completed) |
| provider_subscriptions | 1 `5c816d58…`→A? нет: `77ad2163…` `sbs_9a86268a608fca3f` state `canceled` | 1 `5c816d58…` `sbs_bd6975629dfe2c83` state `completed` |
| entitlements | 0 | 1 (`17285a9f…`, до 07.06.2027) |
| order_groups / order_group_items | 1 / 1 (`9fcacc8f…`, primary, final_amount 2650.00, group `6ec21793…`) | 1 / 1 (`0235abb4…`, primary, final_amount 2650.00, group `806f3295…`) |
| payment_allocations | 0 | 0 |
| access_grant_ledger | 1 | 9 |
| order_notification_deliveries | 7 | 8 |
| payment_reconcile_queue | 1 | 1 |
| payment_sales_attribution | 0 | 1 |
| installment_payments / generated_documents / crm_tasks / statement_lines / scheduled_product_access / company_order_links / site_form_submissions / composable_refund_intents / referral_* | 0 | 0 |
| payment_links | таблица не имеет `order_id`; связь через offer/link meta — уточнить отдельным read-only шагом |

Целевой сценарий (для отдельного apply, не сейчас):
- B остаётся носителем доступа и обязательства: `final_price = 1325.00`, `meta.installment.effective_total_byn = 1325`, `meta.rounding_adjustment = 1` (первые два платежа net 1326);
- payment 1 `40f01f87…` переносится A → B с `meta.previous_order_id = A` и audit-записью; сумма/статус/provider uid не меняются;
- payment 3 `1ad28122…` помечается `meta.refund_candidate = true`, доступ не трогается;
- A: soft-delete/архив с `meta.superseded_by = B`; исторические строки (ledger, notifications, group item, reconcile) сохраняются, physical DELETE запрещён;
- старая подписка `c6633a7b…` / `sbs_9a86268a608fca3f` скрывается из активной рассрочки существующим механизмом (уже `canceled` + provider `canceled`), без DELETE;
- расхождение `order_group_items.final_amount = 2650.00` против 1325 фиксирую как отдельный вопрос — трогать группы в этом apply не планирую.

## 4. Provider read-only — точный доступный инструмент
Owner RLS действительно не блокирует service role, поэтому фиктивного GET не будет. Доступные штатные read-only функции: `bepaid-raw-transactions`, `bepaid-fetch-transactions`, `bepaid-list-subscriptions`. Все требуют admin/owner JWT; у среды его нет, прямой вызов ранее вернул HTTP 401. Credentials не читались и не выводились. Сведение данных выполняется только после доказанных terminal provider states (сейчас локально: `sbs_9a86268a608fca3f` = `canceled`, `sbs_bd6975629dfe2c83` = `completed`) — подтверждение со стороны провайдера должен дать owner-запуск одной из трёх функций.

## 5. Live `record_refund_atomic` — баг подтверждён
Сигнатура: `record_refund_atomic(uuid,uuid,numeric,text,text,uuid,uuid,jsonb)`, SHA256 определения `b7ef76965246c6fb6467de7d0d900c8de46651f770e7aee2e9b188be921f7847`.
В live-версии сохранён цикл 2026-05-22: `v_prior_refunded += p.refunded_amount` для всех строк И дополнительно `+= ABS(p.amount)` для refund-строк. Так как канонический writer пишет ОБА признака, второй и последующие частичные возвраты считают предыдущий возврат дважды → преждевременный `refund_status='full'` и `orders_v2.status='refunded'`. Исправлений в live нет.
Следствие для плана: до исправления этой функции последовательные частичные возвраты по одной сделке некорректны. В GitHub-патч добавляется правка счётчика (учитывать `refunded_amount` по не-refund строкам, а `ABS(amount)` — только по legacy refund-строкам без parent) вместе с regression-тестом на два подряд частичных возврата. Возврат третьего платежа — первый по сделке B, поэтому текущий баг его не искажает, но патч должен войти в тот же PR.

Ожидаемые rowcounts из раздела 6 сохраняются; дополнительно перенос payment 1: 1 UPDATE `payments_v2.order_id`, 1 UPDATE `orders_v2` B (final_price+meta), 1 UPDATE `orders_v2` A (архив+superseded_by), 0 DELETE.
Provider writes, SQL-мутации, код, коммиты и Publish не выполнялись.

---

# Дополнение 2 (READ-ONLY): группы, items, ссылка, guards. Блокирующие замечания

## Факты (не-PII)

`order_groups` (обе, `payer_type=individual`, `source=admin_payment_link`, `payment_method=internal_installment`, `currency=BYN`, `paid_at=null`, `meta keys`: `separate_entitlements`, `single_crm_deal`; `quote_snapshot keys`: `adjustment_amount, adjustment_reason, available_addons, currency, items, selected_addon_offer_ids, subtotal, total`):
- A: `6ec21793-7901-46b2-9540-b4defeec84db`, `GRP-SUB-LINK-MS69W0DD`, primary A, `status=pending`, subtotal 2650.00, adjustment −1325.00, **total_amount 1325.00**, создана 29.07.2026
- B: `806f3295-6327-4831-b2c4-a6631b217fcf`, `GRP-SUB-LINK-MSOFLH7I`, primary B, `status=pending`, subtotal 2650.00, adjustment −1325.00, **total_amount 1325.00**, создана 11.08.2026

`order_group_items` (по одному, `role=primary`, `quantity=1`, `sort_order=0`, `discount_amount=0.00`, product `3e43fb28-8322-41bc-bfee-714731bdc630`, tariff `767bb895-30fa-49c9-8f31-d0794590020a`, offer `c7f5221e-715e-4b4e-8312-f542616d9416`, `item_snapshot keys`: `discount_amount, final_amount, list_amount, offer_id, product_id, product_name, role, sort_order, tariff_id, tariff_name`):
- A item `9fcacc8f-d4b5-472f-8561-858d32b974b6`: list 2650.00, final **2650.00**
- B item `0235abb4-67ee-4b36-b718-525957e5e9fa`: list 2650.00, final **2650.00**
- `payment_allocations` по обоим items: 0

`payment_links`: у A группы ссылок нет; у B ровно одна — `a11f2595-6bfc-486a-981c-3ebcd2706b39`, `status=active`, amount 66300 (копейки, 663.00 BYN), `payment_type=subscription`, `provider=bepaid`, `provider_mode=fixed`, `max_uses=null`, `current_uses=0`, `expires_at=null`, tariff/offer/product как выше, `order_group_id=B`.

Поля для guards: `orders_v2` — `id, order_number, status, final_price, paid_amount, currency, product_id, tariff_id, offer_id, is_deleted, meta`; `subscriptions_v2` — `id, order_id, status, installment_status, billing_cycles, paid_billing_cycles, access_start_at, access_end_at, provider_subscription_id`; `provider_subscriptions` — `id, order_id, provider_subscription_id, state`; `payments_v2` — `id, order_id, amount, status, transaction_type, provider, provider_payment_id, refunded_amount, is_deleted, paid_at`.

## Блокирующие замечания (только к этим уточнениям)

1. **Коррекция суммы — только item, не group.** Обе группы уже имеют `total_amount = 1325.00` (adjustment −1325.00 «повторный клиент»). Расхождение 2650 живёт в `order_group_items.final_amount`/`list_amount` и в `item_snapshot`. SQL должен править `final_amount` у **B item `0235abb4…`** до 1325.00 и синхронно `item_snapshot.final_amount`, с сохранением старых значений в `meta`/audit; `list_amount 2650.00` как прейскурант оставить, иначе потеряется база скидки. Трогать `order_groups.total_amount` нельзя — иначе двойная коррекция. Требуется подтвердить по коду `getDealCommercialAmount`, что он читает item, а не group — иначе правка item не изменит UI.
2. **Активная многоразовая ссылка B — блокер.** `a11f2595…`: `status=active`, `max_uses=null`, `expires_at=null` → допускает новые оплаты 663 BYN и новый заказ поверх уже закрытой рассрочки. До/в составе сведения её нужно перевести в неактивное состояние существующим механизмом (без DELETE). Иначе сведение может быть аннулировано новой оплатой.
3. **A-заказ без offer, item с offer.** У заказа A `offer_id` пуст, а у его group item offer `c7f5221e…`. При soft-delete A это не мешает, но guard должен не считать A источником коммерческих сумм и не переносить его item в B (переносим только payment 1).
4. **Фильтр `is_deleted` — да, но шире.** Скрывать soft-deleted нужно не только в списке рассрочек: те же данные читают карточка сделки, суммы контакта и отчёты. Патч должен добавить фильтр во всех читающих путях, иначе A исчезнет в одном месте и останется в суммах в другом.
5. **`refund_preflight` — принимаю, с условиями.** Read-only action в существующем `subscription-admin-actions` + кнопка «Проверить в bePaid» в `RefundDialog`: только authenticated admin, обязательный exact `payment_id`, server-side GET транзакции и подписок того же user/product, ответ строго `id/status/amount/date/http`, без raw payload/PII, без DB и provider writes. Согласен, что `bepaid-list-subscriptions` не годится — он делает массовые upsert. Условие: новый action не должен переиспользовать общий helper, который пишет в `payment_reconcile_queue`/`provider_subscriptions`; нужен отдельный чистый GET-путь и явный запрет любых write-хелперов, иначе «read-only» станет фактическим импортом.
6. **Порядок.** Сведение данных выполняется только после fresh provider proof через `refund_preflight` (после deploy) и подтверждения terminal states; локально: `sbs_9a86268a608fca3f = canceled`, `sbs_bd6975629dfe2c83 = completed`.

Реализаций, SQL, коммитов, deploy и provider writes не выполнялось.

---

# Дополнение 3 (READ-ONLY): причина третьего списания, cron-риски, статусы ссылки, фильтры is_deleted

## Хронология (audit_logs, system-акторы, без ПД)

A `e17b35b2…` / `sbs_9a86268a608fca3f`
- 29.07.2026 16:02:03 `installment.retry_policy.resolved_pre_bepaid` (`create-payment-checkout`)
- 29.07.2026 16:02:05 `system.payment_link.created`, затем `public_checkout.created` (`public-checkout`)
- 29.07.2026 16:03:00–16:03:03 `grant-access-for-order.provider_linked_extend`, `entitlement.tariff_id_persisted`, `admin.grant_access` (service_role)
- 29.07.2026 16:03:11 `bepaid.subscription.installment_processed`: `billing_cycles=2`, `installment_count=2`, `model=bepaid_finite_subscription`, `state=active`, `original_order_id=A`
- 11.08.2026 09:01:36 `bepaid.subscription.cancel` (`bepaid-cancel-subscription`, actor_type=system): `source=public_link_replace`, `is_admin=false`, `requested=1`, `canceled=1`, `remote_missing=0`

B `9673e359…` / `sbs_bd6975629dfe2c83`
- 11.08.2026 09:01:40–09:01:41 (через 4 сек после отмены A): `installment.retry_policy.resolved_pre_bepaid`, `system.payment_link.created`, `public_checkout.created`
- 11.08.2026 09:02:01 `bepaid.webhook.grant_skipped_no_fallback`, затем `installment_processed`: **`billing_cycles=2`, `installment_count=2`, `original_order_id=B`**
- 10.09.2026 09:16:02–09:16:17: `provider_linked_extend` (`previous_status=past_due`, tracking `subv2:d16b01e5…:order:9673e359…`), `admin.grant_access` (`duration_days=300`, до 2027-06-07), `installment_processed` (`last_tx_uid=6e1edf0b…`), `installment_completed` (`paid_billing_cycles=2`)

## Причина третьего списания
Сценарий `public_link_replace`: клиент прошёл по новой публичной ссылке, система отменила старую подписку A (после 1 оплаченного цикла из 2) и создала **новый конечный план заново с `billing_cycles=2`**. Ранее оплаченный 663 от 29.07 в новый мандат **не засчитывался** (`original_order_id=B`, `paid_billing_cycles` считались с нуля). Итог 1+2 = 3 × 663 = 1989 при обязательстве 1325/1326. Это дефект контура замены мандата: при replace remaining cycles должны рассчитываться от уже оплаченной суммы по исходному заказу, а не сбрасываться в полный график.

## Риск следующих списаний — сейчас отсутствует, кроме одного канала
Подписки клиента по продукту ровно две:
- `c6633a7b…` (order A): `canceled`, `auto_renew=false`, `next_charge_at=null`, meta `installment_status=terminated`, paid 1 из 2, access_end 28.08.2026
- `d16b01e5…` (order B): `expired`, `auto_renew=false`, `next_charge_at=null`, meta `installment_status=completed`, paid 2 из 2, access_end 07.06.2027

`installment_payments` = 0 строк; provider states: `canceled` и `completed`. Активные cron, которые вообще могут списывать: `installment-charge-cron-morning/evening` (0 6/18 * * *), `subscription-charge-morning/evening` (743/744), `preregistration-charge-*` (1–4 числа). Все они отбирают строки с `next_charge_at`/активным статусом — у обеих подписок таких признаков нет, поэтому автосписаний по ним не ожидается.
Единственный оставшийся канал нового списания — **активная многоразовая ссылка `a11f2595…`** (`status=active`, `max_uses=null`, `current_uses=0`, `expires_at=null`, amount 66300 копеек, `payment_type=subscription`): повторный переход создаст новый заказ и новый мандат, ровно как 11.08. Её отключение — обязательная часть точечного apply.

## Допустимые статусы ссылки
`payment_links.status` фактически принимает три значения: `active`, `completed`, `invalidated`. Для отключения корректен `invalidated` (не DELETE); дополнительно можно выставить `expires_at`. Колонки для guard: `id, status, max_uses, current_uses, expires_at, order_group_id, amount, payment_type, provider`.

## Фильтры is_deleted — что уже есть, чего нет (по коду)
Уже фильтруют `orders_v2.is_deleted=false`: `src/pages/admin/AdminDeals.tsx:222,380`, `src/hooks/useDealsBoard.ts:61`, `src/components/admin/shared/pickers/DealPickerDialog.tsx:141,176,202`, `src/components/admin/bepaid/ContactDealsDialog.tsx:87`, `src/components/admin/payments/AutoRenewalsTabContent.tsx:598`, `src/hooks/useUnifiedPayments.tsx:263`.
Не фильтруют: `src/hooks/useContactInstallmentsData.ts` — запрос `orders_v2` (строки ~117–130) не содержит `.eq("is_deleted", false)`; `is_deleted` там применяется только к вложенным `payments_v2` (строка 57). Это и есть единственное доказанное место, требующее правки — после soft-delete A рассрочка A иначе останется видимой. Расширение на отчёты не требую: отдельных report-запросов без фильтра я не нашёл.

## Подтверждение по сумме сделки
`getDealCommercialAmount` (`src/lib/payments/composableDealAmount.ts:13-26`) берёт `composable_line_amount`, а он заполняется из `item.final_amount` (`src/components/admin/ContactDetailSheet.tsx:563`), иначе fallback на `orders_v2.final_price`. Значит правка именно `order_group_items.final_amount` + `item_snapshot.final_amount` у B item `0235abb4…` до 1325.00 (при `list_amount 2650.00` и `order_groups.total_amount 1325.00` без изменений) корректно уберёт «2650» из UI.

Изменений, SQL-мутаций, коммитов, deploy и provider-вызовов не выполнялось.
