# CRM Routing — Чек-лист live proof (Layer A)

> Scope: только offer-driven первичная оплата (one-time + первая оплата подписки).
> Recurring/rebill/refund/site-form-submit — вне scope (Layer B).

---

## 0. Подготовка тестового оффера

1. Открыть `Admin → Продукты → <тестовый продукт> → Тарифы → Offer Dialog`.
2. В секции «🎯 Привязка к воронке (CRM)»:
   - включить switch **enabled**;
   - выбрать тестовую воронку (должна содержать `open`, `closed_won`, `closed_lost`);
   - подтвердить, что 3 стадии подставились по семантике;
   - сохранить оффер.
3. Проверить SQL-блок **A** и **B** из `crm-routing.proof.sql` — конфиг валиден.
4. Зафиксировать:
   - `<TEST_OFFER_ID>` =
   - `<TEST_PIPELINE_ID>` =
   - `<STAGE_PENDING>` / `<STAGE_SUCCESS>` / `<STAGE_FAILED>` =

---

## 1. Coverage proof — 4 обязательных сценария

| #   | Канал                    | Сценарий | Ожидаемая стадия | Order ID |
| --- | ------------------------ | -------- | ---------------- | -------- |
| 1   | Guest checkout (виджет)  | success  | stage_on_success |          |
| 2   | Guest checkout (виджет)  | failed   | stage_on_failed  |          |
| 3   | Public `/pay/:token`     | success  | stage_on_success |          |
| 4   | Public `/pay/:token`     | failed   | stage_on_failed  |          |

Для каждого после оплаты выполнить блок **C** (pending), **D** (terminal), **E** (audit).

### Как воспроизвести failed
- Тестовая карта bePaid с decline-сценарием **либо** закрыть платёжное окно → статус `canceled`.

---

## 2. Snapshot immutability proof

1. Создать заказ при текущем routing.
2. В оффере поменять `stage_on_success` на другую стадию `closed_won` (или временно создать вторую такую).
3. Дождаться webhook успеха по заказу из шага 1.
4. Выполнить блок **F**. Ожидаемый verdict: `OK_SNAPSHOT_WINS`.
5. Вернуть routing оффера к исходному состоянию.

---

## 3. Manual override proof

1. Создать заказ (pending выставлен).
2. В CRM Kanban вручную перетащить сделку в **другую open-стадию** (не pending, не success).
3. Завершить оплату → webhook должен НЕ перезаписать стадию.
4. Выполнить блок **G**. Ожидаемые verdicts:
   - `OK_MANUAL_NOT_OVERWRITTEN` в orders_v2;
   - запись `crm_stage_apply_skipped_manual_override` в audit_logs.

---

## 4. Skipped invalid_config proof

1. Оплатить заказ через любой оффер **без crm_routing** (или с enabled=false).
2. Выполнить блок **H** — должна быть запись `crm_stage_apply_skipped_invalid_config`.

---

## 5. Финальный итог proof-пакета

После всех 7 шагов отчёт должен содержать:

- [ ] DB proof: 4 заказа с корректными pending → terminal стадиями (блоки C+D)
- [ ] DB proof: snapshot полный (offer_id, offer_updated_at, pipeline_name, stage_names, offer_title)
- [ ] Audit proof: pending + success/failed по каждому из 4-х заказов
- [ ] Audit proof: skipped_manual_override по заказу из шага 3
- [ ] Audit proof: skipped_invalid_config по заказу из шага 4
- [ ] Immutability proof: snapshot выигрывает у текущего offer.meta
- [ ] Manual override proof: ручной перенос не перетёрт webhook'ом

Только при всех 7 ✅ статус = «Layer A завершён».
