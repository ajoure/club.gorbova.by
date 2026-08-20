# План: канонизация кнопок оплаты 21 потока (PRD-000044) по образцу 20 потока (PRD-000039)

Режим: PLAN-ONLY. Выполнены только SELECT-запросы. Изменений кода/БД/деплоя/Publish нет.

## 1. Факт: источник (20 поток, PRD-000039) — 4 активные кнопки на тариф

| Тариф | offer_type | button_label | amount | payment_method | ic | slot_role | variant | id |
|---|---|---|---|---|---|---|---|---|
| T-000076 Бухгалтер | bank_installment | Рассрочка от банка | 1650 | bank_transfer | — | button_5 | installment | 77dd831a |
| T-000076 | pay_now | Оплатить в 2 платежа | 1650 | internal_installment | 2 (30д) | **button_4** | installment | fc127066 |
| T-000076 | pay_now | Оплатить 100% картой | 1650 | full_payment (primary) | — | button_1 | primary | fb4b275b |
| T-000076 | invoice | Оплатить от юрлица | 1650 | bank_transfer | — | button_2 | legal_entity | b6476800 |
| T-000077 Гл. бухгалтер | bank_installment | Рассрочка от банка | 1950 | full_payment | — | button_5 | installment | 759c1fbc |
| T-000077 | pay_now | Оплатить в 2 платежа | 1950 | internal_installment | 2 (30д) | **button_3** | installment | 1f9cf610 |
| T-000077 | pay_now | Оплатить 100% картой | 1950 | full_payment (primary) | — | button_1 | primary | c1218245 |
| T-000077 | invoice | Оплатить от юрлица | 1950 | bank_transfer | — | button_2 | legal_entity | d749583b |
| T-000078 Бизнес-леди | bank_installment | Рассрочка от банка | 2650 | bank_transfer | — | button_5 | installment | fdb8bffc |
| T-000078 | pay_now | Оплатить в 2 платежа | 2650 | internal_installment | 2 (30д) | **button_3** | installment | c7f5221e |
| T-000078 | pay_now | Оплатить 100% картой | 2650 | full_payment (primary) | — | button_1 | primary | 02750b7d |
| T-000078 | invoice | Оплатить от юрлица | 2650 | bank_transfer | — | button_2 | legal_entity | 4c6d6110 |

Суммы «2 платежа»: 1650 = 825×2, 1950 = 975×2, 2650 = 1325×2 (хранится полная сумма + installment_count=2, interval 30 дней, `meta.installment.max_months=2`, rounding `round_half_up_byn`). Соответствует требованию.

Расхождение в источнике: слот кнопки «2 платежа» у T-000076 = `button_4`, у T-000077/T-000078 = `button_3`. Требование «anchors как в источнике» → копируем пер-тариф (85→button_4, 89→button_3, 86→button_3). Требуется подтверждение, если нужно единое значение.

## 2. Факт: цель (21 поток, PRD-000044) — по 5 активных офферов, ни одного канонического

| Тариф | offer_type | button_label | amount | ic | slot_role | id | вердикт |
|---|---|---|---|---|---|---|---|
| T-000085 | bank_installment | Заявка на рассрочку | 1650 | 6 | нет | c49fbc8c | обновить → «Рассрочка от банка» / button_5 |
| T-000085 | pay_now | Оплатить обучение | 1650 | — | нет | 8ac848b2 | обновить → «Оплатить 100% картой» / button_1 / primary |
| T-000085 | pay_now | Оплатить в рассрочку | 1650 | 3 | нет | 7e5d066e | обновить → «Оплатить в 2 платежа» / ic=2 / button_4 |
| T-000085 | pay_now | Оплатить от ЮЛ | 1650 | — | нет | a6064ae2 | сменить тип на invoice / button_2 |
| T-000085 | lead | Оставить заявку | 1650 | — | нет | 158832be | **деактивировать** |
| T-000089 | bank_installment | Заявка на рассрочку | 1950 | — | нет | 169bfc1e | обновить → button_5 |
| T-000089 | pay_now | Оплатить обучение | 1950 | — | нет | b89b7c53 | обновить → button_1 / primary |
| T-000089 | pay_now | Оплатить в рассрочку | 1950 | 3 | нет | 09a43ff3 | обновить → 2 платежа / button_3 |
| T-000089 | pay_now | Оплатить от ЮЛ | 1950 | — | нет | 0147b33f | → invoice / button_2 |
| T-000089 | lead | Оставить заявку | 0 | — | нет | 1c55d426 | **деактивировать** |
| T-000086 | bank_installment | Заявка на рассрочку | 2650 | — | нет | ec29a77c | обновить → button_5 |
| T-000086 | pay_now | Оплатить обучение | 2650 | — | нет | e4fe2030 | обновить → button_1 / primary |
| T-000086 | pay_now | Оплатить в рассрочку | 2650 | 3 | нет | 24ae11fb | обновить → 2 платежа / button_3 |
| T-000086 | pay_now | Оплатить от ЮЛ | 2650 | — | нет | 50bf95a4 | → invoice / button_2 |
| T-000086 | lead | Оставить заявку | 0 | — | нет | 3cefc2e3 | **деактивировать** |

Внутренние тарифы T-000093 / T-000094: офферов 0. Действий нет (не публиковать, кнопки не создавать).

## 3. Dry-run изменений (12 UPDATE + 3 деактивации, 0 CREATE, 0 DELETE)

Для каждого из 12 сохраняемых records:
- `button_label`, `offer_type`, `payment_method`, `is_primary`, `sort_order` (0/1/2/3) — по источнику;
- «2 платежа»: `installment_count=2`, `installment_interval_days=30`, `first_payment_delay_days=0`, `meta.installment` = копия источника (`max_months=2`, `rounding_mode=round_half_up_byn`);
- `meta.slot_role` / `meta.site_button_variant` — по таблице §1;
- `meta.acquiring` (bepaid shop_id 33524, allowed_payment_providers=["bepaid"]) — на 2-платежа и 100% картой;
- `meta.bank_installment` = `{installment_provider: rr, rr_mode: payment_url, rr_runtime:{enabled:true, mode:initiate_only, provider:rr}}` на кнопке РР;
- `meta.crm_routing` — копия источника (pipeline a0000001-…-0002 и его стадии);
- `meta.document_defaults`: `payment_due_days=3`, `unit="доступ"`, `quantity=1`, `generate_act=true`, `execution_days` 180/240/300, `amount/unit_price` = сумма тарифа, `service_name` с названием тарифа; **fixed dates не переносим** (в источнике есть `service_period_from/to`, для 21 потока их не задаём);
- `meta.document_scenarios`: для invoice-кнопки включены legal_entity + entrepreneur (executor `d0c7fe75…`, templates `4fa3160f…` / `bcf5e015…`, канал bank_transfer, requires_required_requisites=true), individual выключен; для card/2-платежа — включён individual (template `7caee05d…`, каналы card/erip/apple_pay/google_pay).
- Amount не меняем (1650/1950/2650 уже совпадают с источником).

Деактивация: 3 `lead`-оффера (158832be, 1c55d426, 3cefc2e3) → `is_active=false`. Удаление не используем (FK-ссылки ledger/CRM/document rules).

Уникальный индекс `tariff_offers_slot_role_per_tariff_uidx` требует присвоения slot_role по одному на тариф — порядок UPDATE: сначала очистка/установка в одной транзакции на тариф.

## 4. Проверки перед EXECUTE
- Invoice document params: подтверждено, что у целевых офферов `document_defaults` сейчас пуст → заполняется полностью.
- RR config: у целевых bank_installment уже есть `rr` + `initiate_only`; дополняем `rr_mode=payment_url` и слот/лейбл.
- product20 (PRD-000039, T-000076/77/78): 0 записей в scope изменений — только чтение.

## 5. Read-back после EXECUTE (при одобрении)
- по 4 активных оффера на T-000085/T-000089/T-000086, типы 1×bank_installment, 2×pay_now, 1×invoice;
- 0 активных `lead`, 0 офферов с `installment_count=3` или `max_months>2`;
- slot_role заполнен у всех 12; `document_defaults.payment_due_days=3` у всех 12;
- офферов у T-000093/T-000094 = 0; 12 офферов 20 потока идентичны исходному снимку.

STOP. Ожидаю решения по расхождению anchor «2 платежа» (button_4 vs button_3) и подтверждения EXECUTE.
