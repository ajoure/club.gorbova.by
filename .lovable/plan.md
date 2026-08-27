# Отчет о выполнении: PLAN-ONLY DIAGNOSIS — RR-ссылка из карточки контакта. Ноль изменений

Только чтение: production logs, analytics, каталог офферов, audit_logs, orders_v2, provider_events. Ни одной записи, деплоя, миграции, Build или Publish. RR create-order не вызывался.

## 1. Точные логи — ограничение (без догадок)

В retained edge-логах production по `public-rr-installment-initiate` за сегодня присутствуют **только** preflight-записи:

- `OPTIONS | 200 | .../public-rr-installment-initiate` — 2026-08-27 09:27:35.84 UTC
- `OPTIONS | 200 | .../composable-checkout-quote` — 2026-08-27 09:27:44.79 UTC
- function logs: `booted (31ms)` 09:27:35, `shutdown` 09:30:55

Записей POST с HTTP-статусом за обе неудачные попытки в доступном окне логов **нет** (ретенция/ингест). Поэтому **точный HTTP status и внутренний error code двух конкретных попыток документально не подтверждены** — ниже root cause доказан конфигурацией данных и кодом, а не угаданным кодом ответа.

## 2. Доказанный root cause (данные + код)

UI считает квоту по **pay_now**-офферу, а RR-инициацию отправляет на **bank_installment**-оффер того же тарифа, передавая при этом тот же список `addon_offer_ids`.

Каталог CB21 / «Бизнес-леди» (product «Ценный бухгалтер | 1 ступень 2.0 | 21 поток»):

| parent offer | тип | active addon-links |
|---|---|---|
| `24ae11fb…` | pay_now | 9 |
| `e4fe2030…` | pay_now | 9 |
| `ec29a77c…` | bank_installment (RR runtime enabled) | 9 |

Множества `addon_offer_id` у pay_now-родителей и у RR-родителя **полностью непересекающиеся**: у pay_now дети — pay_now-офферы модулей, у RR-родителя дети — bank_installment-офферы тех же модулей (проверено: `0fb61b3b…` = pay_now «Маркетплейсы» 800, `08e29a10…` = bank_installment «Маркетплейсы» 800).

Код:
- `AdminPaymentLinkDialog.tsx:421-436` — квота считается по `effectiveOffer` (pay_now).
- `AdminPaymentLinkDialog.tsx:1142-1150` — в RR уходит `tariff_offer_id: rrSiblingOffer.id` (bank_installment) + те же `selectedAddonOfferIds`.
- `_shared/resolve-composable-checkout.ts` — для каждого запрошенного `addon_offer_id`, отсутствующего среди addon-правил именно этого parent-оффера, бросается `addon_not_allowed`.
- `public-rr-installment-initiate/index.ts:360-371` — `ComposableCheckoutError` → `errorResponse("addon_not_allowed", 400)`.

Итог: при выборе хотя бы одного модуля (в обеих попытках итог 1675 и 1650 BYN превышает базовые 2650 − корректировка, т.е. модули были выбраны) функция гарантированно завершается **400 `addon_not_allowed`** на этапе (3) composable quote — до loadRRConfig, CRM-routing, создания заказа и вызова РР. Supabase-js превращает это в generic `Edge Function returned a non-2xx status code`, который и виден в toast.

Побочно исключено:
- (1) `requirePaymentsEdit` — не при чём: при отказе прав вернулся бы 403 `admin_fields_forbidden`, а сообщение было бы тем же generic-текстом; но факт создания одной RR-заявки сегодня и работоспособность панели указывают на прохождение RBAC. Прямого лог-подтверждения нет.
- (4) `loadRRConfig` — конфиг РР валиден: `integration_instances(provider='rr')` `status=connected`, `mode=battle`, есть `battle_login`, `battle_password`, `secret_key`.
- Оффер/runtime корректны: RR-оффер active, `offer_type=bank_installment`, `meta.bank_installment.rr_runtime={enabled:true, provider:"rr"}`.

## 3. Побочные эффекты — ничего не создано

- `audit_logs` за 48 ч: нет ни одной записи `rr.admin_payment_link_initiated`, `rr.create_order.*` — этапы (6)-(8) не достигались.
- `orders_v2`: за сутки ровно один RR-заказ `207d4e56…`, `status=pending`, создан 06:00:15 UTC — задолго до попыток и не относится к ним.
- `provider_events(provider='rr')`: 2 события, последнее 06:00:16 UTC. За время неудачных попыток — ноль.
- `rr_mark_call_started` / внешний вызов РР не выполнялись.

Вывод: ни order, ни provider event, ни payment link по неудачным попыткам не создавались; денежных/клиентских побочных эффектов нет.

## 4. Кого затрагивает

Дефект **не связан с ролью**: он воспроизводится одинаково у admin/super_admin и у менеджеров с `payments:edit`, так как ломается не RBAC, а сопоставление addon-офферов между pay_now- и bank_installment-родителем. Без выбранных модулей (только базовый тариф) RR-ссылка проходит — поэтому дефект проявляется только на составных продажах CB21 (и на любом продукте, где addon-матрица заведена отдельно под каждый тип родительского оффера).

## 5. Расхождение с GitHub SHA 8fd0da79

`git diff 8fd0da79b8e954c195185cef3fad968108f89b3a` по `supabase/functions/public-rr-installment-initiate/**` и её shared-импортам (`_shared/rr/*`, `admin-section-auth.ts`, `resolve-composable-checkout.ts`, `materialize-composable-order-group.ts`, `composable-checkout.ts`, `crm-routing.ts`) — **пусто**. Расхождений нет, синхронизация не требовалась и не выполнялась.

## 6. Минимальный исправляющий план (не выполнен)

Предпочтительный вариант — **frontend-only**, без изменения Edge Function и без миграций:

1. В `AdminPaymentLinkDialog.tsx` при открытии RR-панели запрашивать отдельную квоту `composable-checkout-quote` с `parent_offer_id = rrSiblingOffer.id`.
2. Выбор модулей для RR транслировать по `addon_product_id` (а не по `addon_offer_id`): из `available_addons` RR-квоты подбирать соответствующий `addon_offer_id`. Модули, у которых нет RR-эквивалента, — отключать в UI с явной подсказкой, а не отправлять на бэкенд.
3. Кнопку RR блокировать, если какой-либо выбранный модуль не транслируется, и показывать сумму именно RR-квоты (иначе итог на экране может расходиться с суммой заявки).

Альтернатива (если продукт-решение — «одна матрица на тариф»): data-only выравнивание `offer_addons`, чтобы RR-родитель принимал те же `addon_offer_id`. Это меняет коммерческую матрицу и требует отдельного согласования; сейчас не рекомендуется.

## 7. Безопасные regression tests

- Unit/контракт (без сети): тест трансляции выбора модулей — набор `addon_offer_id` для RR-родителя ⊂ его `available_addons`; несопоставимый модуль блокирует кнопку.
- Расширение `src/test/contactPaymentLinksRbacRegression.test.ts`: контракт, что RR-вызов использует addon-ids из RR-квоты, а не из pay_now-квоты.
- Read-only DB-проверка каталога: для каждого RR-родителя CB21 множество `addon_offer_id` совпадает по `addon_product_id` с pay_now-родителем (детект будущих расхождений).
- Production smoke только безопасный: `OPTIONS` 200 и POST с заведомо невалидным Bearer → 401. Реальные RR-заявки не создавать.

**Вердикт: root cause доказан (конфигурация данных + код), точные логи двух попыток недоступны. PASS TO IMPLEMENT — фикс frontend-only, redeploy Edge Functions и SQL не требуются.**
