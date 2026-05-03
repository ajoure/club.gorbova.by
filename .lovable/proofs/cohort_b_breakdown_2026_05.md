# Cohort B — диагностический разбор (63 строки, 2026-05)

Скоуп: Gorbova Club + Бухгалтерия как бизнес. Orphan orders без `payments_v2`,
не удалённые в Cohort A из-за защитных guard-ов.

## Итог по подгруппам

| Подгруппа | Кол-во | Действие |
| --------- | ------ | -------- |
| `has_subscription_ref` | 42 | Не удалять. Мусорные «ghost» orders, привязанные к реальным подпискам. |
| `has_blocking_audit` | 18 | Не удалять. Все имеют technical-checkout audit, требуют отдельного решения. |
| `paid_without_payment` | 3 | Не удалять до индивидуального разбора. Ниже разобран каждый. |

---

## 1) `has_subscription_ref` — 42

Все 42 связаны через `subscriptions_v2.order_id` (origin_order_id / extended_by_orders = 0).

Распределение по статусу подписки:

| sub_status | auto_renew | count | access_alive | access_expired | access_null |
| ---------- | ---------- | ----- | ------------ | -------------- | ----------- |
| past_due | false | 28 | 0 | 0 | 28 |
| past_due | true  | 11 | 0 | 0 | 11 |
| active   | true  | 1 | 1 | 0 | 0 |
| canceled | true  | 1 | 0 | 0 | 1 |
| canceled | false | 1 | 0 | 0 | 1 |

**Природа:** 39 / 42 — это `past_due` подписки с `access_end_at = NULL`,
т.е. подписки никогда не были оплачены (precreate без последующего charge).
`order` создавался edge-функцией для оформления чекаута, оплата так и не пришла.

**Единственный «active» случай:**

| order_id | order_number | order_status | sub_id | sub_status | access_end_at |
| -------- | ------------ | ------------ | ------ | ---------- | ------------- |
| f7f4cfe1-1a5f-4f99-af0a-4a3276df2392 | PAY-26-MM20HZRJ | canceled | 475cf69a | active | 2026-05-04 |

История пользователя `tanya_zel@tut.by` по продукту Club: 14 успешно оплаченных
сделок (paid + payment) с 2025-01 по 2026-02 + 1 успешный rebill 2026-02
через `ORD-LINK-...`. Order `f7f4cfe1` — дубль ссылочного pending от того же
дня, оплата ушла на параллельный `69a36535` (тот же tariff, тот же tariff_id).
Подписка `475cf69a` живёт корректно, доступ до `2026-05-04`. Запись является
«пустым» дублем без оплаты, но трогать её не следует — она формально
числится в `subscriptions_v2.order_id`.

**Вердикт:** не удалять, оставить. Технический мусор, но безопасный
(никакой логики на эти orders не построено).

---

## 2) `has_blocking_audit` — 18

| action | distinct_orders |
| ------ | --------------- |
| `bepaid.subscription_checkout.create` | 16 |
| `payment_checkout.subscription_precreate_failed` | 1 |
| `admin.create_deal_from_payment` | 1 |

### 16 × `bepaid.subscription_checkout.create`

Все `pending`, без `customer_email`, имена вида `SUB-26-...`. Это записи
заказов, созданных как preorder под bePaid-checkout, который пользователь
не довёл до оплаты. Ничего не fulfillment-критичного — ровно тот же класс,
что и Cohort A, но мы их сохранили из-за наличия audit-записи о попытке
открытия чекаута.

### 1 × `payment_checkout.subscription_precreate_failed`

`bbb85f04` (`SUB-LINK-MOKBHI8E`, `failed`, `shefska@gmail.com`). Чекаут
оборвался ещё до создания подписки в bePaid. Безопасно удалить, но не
делаем без отдельного approve.

### 1 × `admin.create_deal_from_payment` (order `5aa1c624`)

Ручная сделка, созданная админом из реального успешного платежа
`e9e365de` (succeeded, 250 BYN). НО `payments_v2.order_id` этого платежа
указывает на **другой** order — `7e47007c-5141-4a3a-b98b-a0808262f553`
(не на `5aa1c624`). Админ создал «дубль-сделку» поверх уже привязанного
платежа. Безопасно удалить только после ручной проверки админом, что
канонический order — это `7e47007c`.

**Вердикт:** не удалять автоматически. 16 + 1 — кандидаты в Cohort A
после явного подтверждения. 1 (`5aa1c624`) — ручной разбор админа.

---

## 3) `paid_without_payment` — 3

### 3.1 `97e22bb3` — `15-club-ТО-N8GLF6` (2025-07-24, bogy98@mail.ru)

Meta:
```
source: admin_bulk_from_payments
deal_only: true
is_historical: true
payment_id: c42ea072-a927-4f84-9990-1ce0b4a09e3c
deal_sequence: 15
```

Платёж `c42ea072` существует, `succeeded`, 250 BYN, но `payments_v2.order_id = NULL`.
Это историческая «deal-only» запись: order создан админ-bulk-импортом для
учёта в CRM, фактическая оплата прошла отдельно и не была привязана
обратно к этому order. **Не удалять.** Корректно — добавить апдейт
`payments_v2.order_id = '97e22bb3...'` чтобы платёж и order сошлись
(отдельная задача, не в этом скоупе).

### 3.2 `c0af8ad4` — `ORD-26-MKDNM34Z` (2026-01-14, slmmls@mail.ru)

Meta:
```
repair_reason: bepaid_uid_collision_legacy_duplicate
superseded_by_repair: true
legacy_order_id: f7749162-5cd4-4d68-93aa-d4ade9ce24bc
bepaid_subscription_id: sbs_2c7191865864fef9
gc_sync_status: success
```

Запись помечена `superseded_by_repair = true` — это легаси-дубль после
ремонта bepaid_uid коллизии. При этом `subscriptions_v2.order_id` указывает
на этот order (sub `cd8791aa`, active, до 2026-05-10, bepaid sub
`sbs_4665c1ef51f08fb1` — другой!). **Не удалять**: подписка на него
ссылается. Действие — отдельная задача: перепривязать `subscriptions_v2.order_id`
на канонический order, после чего эту запись можно удалить.

### 3.3 `02302928` — `ORD-ADM-1769114549787` (2026-01-22)

Meta:
```
type: admin_manual_charge
repair_reason: 3ds_redirect_reconciled_no_payment
superseded_by_repair: true
requires_3ds: true
previous_status: pending
reconciled_by: orders.reconcile_from_payments
```

Помечен `superseded_by_repair = true`. Платёж не пришёл (3DS-redirect не
завершён), но reconcile-engine перевёл order в `paid` ошибочно по
unrelated сигналу. **Не удалять автоматически**: status=`paid` без денег
требует ручного решения — либо вернуть в `failed`/`canceled`, либо
оставить как «admin charge marker».

---

## DoD диагностики

- [x] 42 / 18 / 3 разложены индивидуально.
- [x] Для каждой подгруппы зафиксирована природа и риск удаления.
- [x] Никаких мутаций не выполнено.
- [x] Артефакты: `cohort_b_orphan_2026_05.csv` (полный список) +
      этот разбор.

## Рекомендованные следующие шаги (требуют отдельного approve)

1. **Безопасно удалить (после явного approve)** — 16 × `bepaid.subscription_checkout.create`
   pending без email + 1 × `payment_checkout.subscription_precreate_failed`.
   = 17 строк, идентичная природа Cohort A.
2. **Ручной разбор админом** — `5aa1c624` (дубль-сделка к чужому платежу).
3. **Repair, не delete** — 3 × `paid_without_payment`:
   - `97e22bb3`: привязать `payments_v2.order_id` к этому order.
   - `c0af8ad4`: перепривязать подписку и удалить legacy-дубль.
   - `02302928`: перевести статус из `paid` в `canceled` (3DS не прошёл).
4. **Не трогать** — 41 × `has_subscription_ref` (39 past_due + 1 active dup + 2 canceled).
