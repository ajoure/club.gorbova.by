# Финальная консолидированная ревизия (PLAN-ONLY)

Изменений не выполнялось: ни кода, ни данных, ни функций, ни Publish. Ниже — только проверки чтением и утверждённый план на будущий execute.

## 1. UI patch GrantAccessFromDealDialog — APPROVE с одной правкой имени

Текущее состояние на рабочем дереве (соответствует базе 886810efa):
- строка 250: `DialogContent` уже `flex max-h-[calc(100dvh-24px)] flex-col overflow-hidden` — внешний контейнер готов принять скроллящий DIV;
- строка 261: скролл сейчас живёт на `fieldset` (`min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain`), закрывается на 448;
- `fieldset disabled={grantAccessMutation.isPending}` — сохраняется как есть;
- поле точной даты — `Input type="datetime-local" step="0.001"`, состояние `exactEndValue`/`setExactEndValue`, база `exactCurrentEnd` (строка 107).

Диff одобрен: перенести `min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain py-4 pr-1` на новый внешний DIV, а `fieldset` оставить только с `disabled` и `space-y-4` (плюс `min-w-0`, иначе длинные строки снова растянут ширину на мобиле).

Кнопка «Добавить N дней по тарифу»:
- обработчик ровно один вызов `setExactEndValue(...)` от `exactCurrentEnd.getTime() + accessDays * 86400000`;
- **важная правка**: функции `localDateTimeValue` в проекте нет. Канонический форматтер local-datetime — `n()` из `@/lib/grantAccessForm` (он же используется в тестах диалога). Использовать `n(new Date(...))`, иначе typecheck упадёт;
- `disabled` при: `!exactCurrentEnd` (missing), `productSubscriptions.length > 1` (ambiguous), `subscriptionLoading`, `subscriptionError`, `!!exactError`, `!(Number.isInteger(accessDays) && accessDays > 0)`;
- кнопка только внутри ветки `useExactEnd`, `type="button"`, `variant="outline"`, рядом с полем даты.

Границы: body запроса (`buildGrantAccessBody`), RBAC (`isAdmin()`), `canGrant`, серверные функции и данные не меняются. Патч чисто презентационный + один `setState`.

Production dependency / critical finding: **нет**. Компонент не читает и не пишет ни одной таблицы напрямую, изменение не затрагивает Edge Functions, миграции, RLS и очереди. Незакрытых critical findings в этом scope нет; действующая блокировка Publish — историческая (сбой run 2773 от 06.06.2026), к патчу отношения не имеет. Требование к PR: `tests/typecheck/build PASS` + два скриншота опубликованного результата (ПК и мобильный).

## 2. Скрытые кнопки: финальный SQL-план 2+6+2 = 10

Принятые правки цен зафиксированы: цены **не меняются**.

| target tariff | offer | amount сейчас | amount после | все новые sibling amounts |
|---|---|---|---|---|
| 98539e5d (ранее учились) | 379f9ce6 pay_now | 1325.00 | 1325.00 | 1325.00 |
| 04e6c302 (доступ подарок) | 158112c1 pay_now | 1.00 | 1.00 | 1.00 |

`card_config.price_display` (1325 / 0) — только витрина, источником amount не является. `document_defaults.amount`/`unit_price` берутся из собственного amount тарифа (1325 / 1), не 2650.

### Ровно 10 операций

1. **UPDATE 2** existing pay_now (`379f9ce6`, `158112c1`): `is_active=true`, `is_primary=true`, `sort_order=2`, meta ← эталон `02750b7d` с заменой `slot_role='button_1'`, `site_button_variant='primary'`, `acquiring` (bepaid/33524; у `158112c1` отсутствует — добавить), `crm_routing` как в эталоне, `document_defaults` с собственным amount/unit_price, `document_scenarios` — новые UUID сценариев, `executor_id`/`template_id` эталона, `service_period_from=2026-08-01`, `service_period_to=2027-02-28`, `execution_days=300`. **`lead_form` у `158112c1` сохраняется** (merge, не replace). amount не трогаем.
2. **INSERT 6** недостающих sibling-офферов (по 3 на тариф), точная копия настроек эталонов с собственным amount:
   - `pay_now/internal_installment` ← `c7f5221e` (slot_role `button_3`, `meta.installment`: 2 цикла, interval 30, `first_payment_delay_days=0`);
   - `invoice/bank_transfer` ← `4c6d6110` (slot_role `button_2`, legal_entity);
   - `bank_installment/bank_transfer` ← `fdb8bffc` (slot_role `button_5`, `meta.bank_installment.rr_runtime.enabled=true`, provider `rr`, mode `initiate_only`).
   Внутренние offer-ссылки (`document_scenarios[].id`, любые `*_offer_id` внутри meta) ремапятся на новые UUID; StripePrice/product_id переносить нечего — их в исходных meta нет.
3. **UPDATE 2** tariffs `98539e5d`, `04e6c302`: `is_public=false`, `is_active` остаётся `true`.

Три основных тарифа (`38ee08c4`, `a18df7a7`, `767bb895`) и их офферы не затрагиваются. Существующие orders/subscriptions/entitlements не затрагиваются. Суммы Ксении (1326/442/884) — отдельный исходный договор, из тарифа не выводятся и не пересчитываются.

### Dry-run и защита
- одна транзакция, `lock_timeout=3s`, `statement_timeout=15s`, стабильный порядок ID;
- каждый UPDATE — CAS по `id + updated_at`, ожидаемый rowcount ровно 1; INSERT — по 1 строке, всего 6;
- предвычисленный `SELECT` diff (before) и независимый read-back (after) по тем же 10 строкам;
- ожидаемые счётчики: `tariff_offers` UPDATE=2, INSERT=6; `tariffs` UPDATE=2; новых orders/payments/subscriptions/entitlements=0; уведомлений=0;
- любое отклонение rowcount или ошибка → ROLLBACK и STOP, без адаптации операции и без догадок по UUID;
- аудит `operation='cb20-hidden-tariff-offers-v1'` с before/after по каждой из 10 строк.

### Валидность invoice / RR / минимальной суммы — есть блокер по gift
- **invoice**: `AdminPaymentLinkDialog` ищет sibling по `is_active && offer_type='invoice'` — после INSERT условие выполняется для обоих тарифов. PASS.
- **RR**: условие `is_active && offer_type='bank_installment' && meta.bank_installment.rr_runtime.enabled===true && provider==='rr'` — выполняется. PASS для 1325.00.
- **Минимум 1 BYN — не молчу**: для gift-тарифа `04e6c302` amount=1.00 BYN.
  - `pay_now/full_payment` 1.00 BYN — валидно (равно минимуму).
  - `pay_now/internal_installment` на 2 цикла даёт 0.50 BYN за списание, что **ниже минимально допустимой суммы списания**; при `rounding_mode='ceil_to_whole_byn'` получится 1.00 × 2 = 2.00 BYN, то есть сумма к оплате превысит цену оффера. Обе ветки некорректны.
  - `bank_installment/RR` на 1.00 BYN банк заведомо не примет; `invoice` на 1.00 BYN формально проходит, но акт/счёт на 1 рубль сомнителен по смыслу.
  - **Рекомендация**: для `04e6c302` в этом execute создавать только `invoice` (и, по решению, не создавать `internal_installment` и `bank_installment`). Тогда счётчик станет 2 UPDATE + 4 INSERT + 2 UPDATE = 8. Выполнять полные 6 INSERT можно только по вашему явному подтверждению, что 0.50/2.00 BYN и RR на 1 рубль допустимы. Молча невалидную настройку не создаю.

### offer_addons — назначение и обезличенный инвентарь (не копируем)
Назначение: `offer_addons` привязывает к «родительскому» офферу дополнительные покупки (модули/направления) — витрина допродажи в чекауте. Ключевые поля: `pricing_mode` (`offer_price|fixed_price|percent_discount|free`), `discount_percent`, `is_required`, `is_default_selected`, `access_delivery_mode` (`immediate|fixed_date|manual`), `sort_order`, уникальность `(parent_offer_id, addon_offer_id)`.

Фактические конфигурации эталонов (96 строк не подтверждаются; в БД 48):

| parent offer | всего | активных | конфигурация |
|---|---|---|---|
| 02750b7d (pay_now full) | 9 | 9 | все `percent_discount 50%`, `is_required=false`, `is_default_selected=false`, `access_delivery_mode='fixed_date'` |
| c7f5221e (pay_now installment) | 9 | 9 | то же |
| 4c6d6110 (invoice) | 15 | 9 | 9 активных — addon-офферы типа `invoice`, `fixed_date`; 6 неактивных — старые `pay_now`, `immediate` |
| fdb8bffc (bank_installment) | 15 | 9 | та же структура |

Цены addon-офферов (сами addon-офферы, не скидка): 500.00 ×5, 700.00, 800.00 ×2, 1000.00 — по 9 модулей на каждый родительский оффер; скидка ко всем 50%. Модули (из `meta.module`): Грузо- и пассажироперевозки, Розничная торговля, Маркетплейсы, Производство, Строительство + базовые «Стандарт/Стандартный/Вид деятельности: ПВТ». Источники записей: `cb_sprint_final`, `cb_page_addon_backfill_v1`.

В согласованные 10 (или 8) изменений addons не входят и в этом execute не копируются. Отдельным решением можно позже добавить по 9 активных addon на каждый новый оффер (это +18…+36 INSERT) — только после подтверждения, что допродажи должны быть доступны и на скрытых технических тарифах.

## 3. Ксения — только GitHub-first, без вызовов

Ничего не вызывается и не создаётся: ни мандат, ни ссылка, ни отмена, ни списание. Четыре уже выполненных исправления (`paid_at` ×2, `parent.bepaid_subscription_id` ×2) не повторяются.

Подтверждённый риск существующего пути `bepaid-admin-create-subscription-link`: сумма берётся из `tariff_offers.auto_charge_amount || amount` по `sub.meta.offer_id = c7f5221e` → 2650.00 BYN вместо 442.00, а план создаётся бессрочным (`interval` без `billing_cycles`). Поэтому endpoint в текущем виде для этой рассрочки непригоден.

План реализации в отдельной ветке `codex/ksenia-installment-relink` (один PR, без production-действий):
1. **admin link writer** — режим «доплата по существующей рассрочке»: сумма из `sub.meta.installment.per_payment_byn`, циклы = `billing_cycles − успешные`, привязка к существующим order/sub, запрет создания новых сущностей.
2. **public checkout** — ветка возврата в существующий installment-контекст вместо порождения нового order/subscription.
3. **finite webhook/progress** — учёт оплаченных циклов, завершение при `paid_cycles = billing_cycles`, заполнение `installment_payments` (сейчас 0 строк).
4. **contact installment UI** — прогресс «442 из 1326, остаток 884» и кнопка доплаты по графику.
5. **safe old-mandate replacement** — идемпотентная замена мандата в состоянии `failed_attempt` с переносом `subscription_v2_id`/`order_id`, без отмен и списаний.

Все пять пунктов покрываются серверными тестами; выполнение и любые вызовы провайдера — отдельной явной задачей после merge.
