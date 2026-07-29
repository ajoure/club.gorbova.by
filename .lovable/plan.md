
# Отчёт о выполнении: READ-ONLY диагностика composable manual_admin 3300 BYN

Ничего не изменено: без кода, миграций, deploy, Publish, INSERT/UPDATE/DELETE/RPC-записи, выдачи доступов и сообщений.

## Найденный кейс (жив, is_deleted=false)

- Payment `pay_e16c…c85a7d`, provider=`bank`, origin=`manual_admin`, amount=3300 BYN, status=`succeeded`, paid_at=2026-07-27, created 2026-07-29 15:46:36 UTC.
- Order group `grp_bbca…8789d1` (`GRP-ORD-26-02836`, primary_order=`ord_4ffa…67916`, profile=`prof_c8bd…09d275`).
- Три `order_group_items` / три `orders_v2` (все status=`paid`, is_deleted=false):
  - primary `ord_4ffa…67916` — «Ценный бухгалтер | 1 ступень 2.0 | 20 поток», тариф «Бизнес-леди» — 2650.
  - addon `ord_c7e7…600415` — «Модуль: Учёт у ИП» (percent_discount 50 %) — 400.
  - addon `ord_603b…1888f` — «Модуль: Грузо- и пассажироперевозки» (percent_discount 50 %) — 250.
- Дубли платежа (`pay_8035…0e025` от 14:08 и `pay_2059…51702` от 17:29) уже удалены с `deleted_reason=admin_manual_delete`.

## Ответы на вопросы

**1) Дошёл ли `finalizeComposablePurchase` до каждого из 3 order_id?** Нет. `access_grant_ledger` пуст по всем трём `order_id`. `entitlements` пусто (5 живых записей у профиля — это другой продукт `prd_11c9…3616`, не Ценный бухгалтер). `subscriptions_v2` для этих order_id нет. Финализатор ни на один из трёх заказов реально не отработал.

**2) Что вернул `grant-access-for-order` по каждому?** Все инвокации падали одинаковой ошибкой ещё до входа в бизнес-логику. `audit_logs.admin_manual_payment_fulfillment_failed` три раза подряд для платежа `pay_e16c…`:
- 15:46:38 — `access_grant_failed … Edge Function returned a non-2xx status code` (`grant_code` не выставлен, потому что тело не парсилось).
- 15:46:54 — то же.
- 15:47:18 — то же.

Позже для дубль-платежа `pay_2059…` (17:29) сохранился уже структурированный `detail`: `grant_access_invoke_failed:status=401:code=unauthorized_no_bearer`, `downstream_step:grant-access-for-order`, `grant_status:401`, `grant_code:unauthorized_no_bearer` — та же причина. Тела попадания в handler `grant-access-for-order` нет ни в Deno-логах, ни в `access_grant_ledger` (проверено; аналитический запрос по `4ffa5e3d`/`bbcac816` пуст).

**3) Почему основного доступа нет в карточке?** Для этой сделки его буквально нет: `access_grant_ledger`, `entitlements`, `subscriptions_v2`, `scheduled_product_access` — пусто по всем трём `order_id`. То, что владелец видит частичный «основной» доступ (кабинет ЦБ), даёт совсем другой order `ord_9071…36ba` (audit `admin.grant_access` в 17:25:27 UTC того же дня): это `bepaid_webhook` subscription_renewal / `provider_linked_extend` по тому же продукту `prd_3e43…d630` + тарифу `tar_767b…020a`, к текущему bank-платежу отношения не имеет. Оба модуля (Учёт у ИП, Грузо- и пассажироперевозки) не имеют ни одной записи ни в одной из access-таблиц — по ним доступа нет.

**4) Active или scheduled? Есть ли scheduled строки?** Ни у одного из трёх `order_group_items.item_snapshot` нет ключей `access_delivery_mode` / `access_opens_at` / `access_duration_days` — snapshot содержит только `product_id/tariff_id/offer_id/list_amount/final_amount/discount/role/sort_order/product_name/tariff_name`. По access-контракту (`access_rules` для `prd_3e43…d630`+`tar_767b…020a` = `grant_target_type=training_content`, `access_mode=full`; для `prd_ea98…` addon = full; для `prd_64d9…` addon = full) все три позиции должны быть выданы **сразу (active)**, а не отложены. `scheduled_product_access` по группе пуст — то есть не отложено и не активировано, финализация просто не запускалась.

**5) Точная граница сбоя.** Сбой строго на HTTP-границе между `admin-create-manual-payment` (после успешной записи `payments_v2` и recalc) и `grant-access-for-order`:

```text
admin.createManualPayment
  → payments_v2 insert OK (payment_id pay_e16c…)
  → orders_v2 recalc OK (before 3300 → after 6600, дубль-платёж, потом удалён)
  → invoke grant-access-for-order
       ← HTTP 401  code=unauthorized_no_bearer
  → audit_logs.admin_manual_payment_fulfillment_failed
```

`finalizeComposablePurchase` в handler-е `grant-access-for-order` вообще не стартует: 401-гейт (`resolveGrantAccessCaller` → `!authResult.ok`) отсекает вызов до `detectBranch` / order lookup / записи в `access_grant_ledger`. Auth-регрессия та же семья, что PR #215 (`_shared/caller-user.ts`), но на пути `admin-create-manual-payment → grant-access-for-order` bearer не пробрасывается для composable-веток (одиночные заказы, судя по остальным audit, проходят). Смены Publish-SHA между 15:46 и 17:29 не было — символа новой регрессии deploy-а нет; это устойчивая брешь для composable manual-admin вызовов.

**6) Безопасный минимальный план (ничего не выполнять сейчас).**

Discovery-only next steps:
1. Прочитать текущий `supabase/functions/admin-create-manual-payment/index.ts` и подтвердить, как формируется `Authorization` при `functions.invoke("grant-access-for-order", …)` — ожидается `Authorization: Bearer <SERVICE_ROLE_KEY>` + `x-internal-call`, но по факту вызов уходит без bearer (см. `unauthorized_no_bearer`).
2. Прочитать `grant-access-for-order/caller_auth.ts` (`resolveGrantAccessCaller`) и подтвердить, какой code возвращает ветка «нет Authorization header» → это и есть срабатывающий 401-гейт.
3. Проверить, есть ли отдельный composable-путь (`finalizeComposablePurchase` per-order loop) — вероятно, он использует общую invoke-обёртку, поэтому падение синхронно для всех трёх `order_id` (в аудите видно только primary, потому что вызов бросается ещё до итерации по группе).

Фиксирующий PR (готовить, не применять):
- В `admin-create-manual-payment` явно передавать `Authorization: Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` и `x-internal-call: 1` во всех invoke к `grant-access-for-order` (и симметрично в `admin-retry-manual-payment-downstream`).
- В `grant-access-for-order` подтвердить, что service_role + `x-internal-call` маршрутизируется в ветку, разрешающую composable grant (не `adminManualAccessEdit`).
- Юнит: source-level тест, проверяющий, что `admin-create-manual-payment` формирует Authorization для invoke (аналогично `grantAccessForOrder.handlerOrder.test.ts`).
- Read-back после фикса (в отдельном EXECUTE-раунде, не сейчас): по этому кейсу вручную retry через админку, ожидаемо появляются 3 строки в `access_grant_ledger` (по одной на order), entitlements/subscriptions по бизнес-контракту, и `admin_manual_payment_fulfillment_ok` в `audit_logs`.

Ничего из перечисленного не выполнено — только диагностика.

## Что НЕ трогалось

Ни deploy, ни миграций, ни Publish, ни retry, ни ручной grant, ни отправки email/Telegram, ни правок карточки контакта, ни удалений. Идентификаторы в отчёте маскированы (префикс/суффикс), email/имя/телефон/карты не выводились.
