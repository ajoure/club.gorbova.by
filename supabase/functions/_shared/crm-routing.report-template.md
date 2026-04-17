# CRM Routing — Layer A — Final Proof Report (TEMPLATE)

> **Статус шаблона:** заполняется после ручного прогона 4 сценариев на тестовом оффере с `crm_routing.enabled=true`.
> Подставляются: `<TEST_OFFER_ID>`, `<TEST_PIPELINE_ID>` и 4 `order_id`. Никакого нового discovery.

---

## 0. Контекст

- **Scope:** Layer A — offer-driven первичная оплата (one-time + subscription init).
- **Out of scope:** recurring, rebill, refund, site-form-submit (admin-link-payment-to-order — вне Layer A).
- **SOT:** `orders_v2.meta.crm_routing_snapshot` (immutable). `offer.meta.crm_routing` НЕ читается на terminal.
- **Helper:** `_shared/crm-routing.ts` → `resolveOfferRouting`, `applyCrmStageOnTerminal`.
- **Audit actions:** `crm_stage_applied_pending`, `crm_stage_applied_success`, `crm_stage_applied_failed`, `crm_stage_apply_skipped_manual_override`, `crm_stage_apply_skipped_invalid_config`.

**Тестовые ID (заполняются):**

| Поле | Значение |
|---|---|
| TEST_OFFER_ID | `<...>` |
| TEST_PIPELINE_ID | `<...>` |
| stage_on_pending | `<...>` |
| stage_on_success | `<...>` |
| stage_on_failed | `<...>` |
| ORDER_ID_guest_success | `<...>` |
| ORDER_ID_guest_failed | `<...>` |
| ORDER_ID_pay_success | `<...>` |
| ORDER_ID_pay_failed | `<...>` |
| ORDER_ID_immutability | `<...>` (опц.) |
| ORDER_ID_manual_override | `<...>` (опц.) |

---

## 1. Coverage Proof

Подтверждение, что helper подключён во ВСЕХ ветках Layer A.

| # | Flow | File | Line | Status/event | Helper called | Action name | Scope |
|---|---|---|---|---|---|---|---|
| 1 | one_time create | `_shared/create-payment-checkout.ts` | 222–246 | `pending` (insert) | `resolveOfferRouting` → snapshot + `pipeline_stage_id=stage_on_pending` | — (audit нет на pending; стадия выставляется напрямую) | Layer A |
| 2 | subscription init create | `_shared/create-payment-checkout.ts` | 591–615 | `pending` (insert) | `resolveOfferRouting` → snapshot + `pipeline_stage_id=stage_on_pending` | — | Layer A |
| 3 | admin test payment (`skipRedirect`) | `bepaid-create-token/index.ts` | 508–540 | `pending` (insert) | `resolveOfferRouting` → snapshot + `pipeline_stage_id=stage_on_pending` | — | Layer A |
| 4 | webhook `link-order` paid (subscription init success / `/pay/:token` success) | `bepaid-webhook/index.ts` | 2268 | `paid` (update) | `applyCrmStageOnTerminal('success')` | `crm_stage_applied_success` | Layer A |
| 5 | webhook `link-order` failed/expired | `bepaid-webhook/index.ts` | 3167 | `failed` (update) | `applyCrmStageOnTerminal('failed')` | `crm_stage_applied_failed` | Layer A |
| 6 | webhook `link-order` paid (вторая success-ветка subscription init) | `bepaid-webhook/index.ts` | 3387 | `paid` (update) | `applyCrmStageOnTerminal('success')` | `crm_stage_applied_success` | Layer A |
| 7 | webhook one-time main paid (guest checkout success / authed success) | `bepaid-webhook/index.ts` | 3861 | `paid` (update) | `applyCrmStageOnTerminal('success')` | `crm_stage_applied_success` | Layer A |
| 8 | webhook one-time payment failed/expired | `bepaid-webhook/index.ts` | 4658 | `failed` (update) | `applyCrmStageOnTerminal('failed')` | `crm_stage_applied_failed` | Layer A |

**Out of scope (helper намеренно НЕ вызывается):**

| Flow | File | Причина |
|---|---|---|
| recurring/rebill payments | `bepaid-webhook` (recurring branches) | Не первичная оплата. Стадия не меняется. |
| refunded transactions | `bepaid-webhook` (refund handlers) | Refund — отдельное событие после успеха; отдельной стадии нет. |
| `admin-link-payment-to-order` | `admin-link-payment-to-order/index.ts` | Ручная привязка платежа администратором, вне Layer A. |
| site-form-submit | (отдельная функция) | Layer B (follow-up). |

**Verdict:** ✅ 8/8 точек Layer A подключены к helper. Out-of-scope ветки изолированы.

---

## 2. DB Proof

> SQL-блоки из `_shared/crm-routing.proof.sql`. Подставить `<TEST_OFFER_ID>` и 4 `order_id`.

### 2.1 Конфигурация оффера (Block A)

```sql
SELECT id, button_label, meta -> 'crm_routing' AS crm_routing, updated_at
FROM tariff_offers WHERE id = '<TEST_OFFER_ID>';
```

**Expected:** `enabled=true`, 4 валидных uuid, 3 разные стадии.

**Result:**
```
<paste here>
```

### 2.2 Семантика стадий (Block B)

**Expected:** `stage_on_pending=open`, `stage_on_success=closed_won`, `stage_on_failed=closed_lost`, все принадлежат `<TEST_PIPELINE_ID>`.

**Result:**
```
<paste here>
```

### 2.3 Pending proof — все 4 заказа (Block C)

**Expected:** для всех 4-х `pipeline_stage_id = snapshot.stage_on_pending`, snapshot содержит pipeline_id + stage_on_*+ offer_id + offer_updated_at + pipeline_name + stage_names + offer_title.

**Result:**
```
<paste here>
```

### 2.4 Terminal proof (Block D)

**Expected verdict:**

| order_id | expected verdict |
|---|---|
| ORDER_ID_guest_success | `OK_SUCCESS` |
| ORDER_ID_guest_failed | `OK_FAILED` |
| ORDER_ID_pay_success | `OK_SUCCESS` |
| ORDER_ID_pay_failed | `OK_FAILED` |

**Result:**
```
<paste here>
```

---

## 3. Audit Proof

### 3.1 Per-order audit chain (Block E)

**Expected — по каждому order:**

| order_id | expected actions (в хронологическом порядке) |
|---|---|
| ORDER_ID_guest_success | `crm_stage_applied_pending` → `crm_stage_applied_success` (trigger=`webhook_first_payment_paid`) |
| ORDER_ID_guest_failed | `crm_stage_applied_pending` → `crm_stage_applied_failed` (trigger=`webhook_first_payment_failed`) |
| ORDER_ID_pay_success | `crm_stage_applied_pending` → `crm_stage_applied_success` (trigger=`webhook_link_order_paid` или `webhook_link_paid`) |
| ORDER_ID_pay_failed | `crm_stage_applied_pending` → `crm_stage_applied_failed` (trigger=`webhook_link_failed`) |

> Примечание: `crm_stage_applied_pending` пишется только при insert через helper; в текущей реализации для скорости pending выставляется напрямую без отдельной audit-записи (стадия в snapshot — самодостаточный proof). Если требуется audit на pending — отдельный follow-up.

**Result:**
```
<paste here>
```

---

## 4. Snapshot Immutability Proof

**Сценарий:**
1. Создать заказ при текущем routing → `ORDER_ID_immutability`.
2. Изменить `crm_routing.stage_on_success` на оффере (другой closed_won-stage).
3. Завершить оплату webhook'ом (success).
4. Прогнать Block F.

**Expected verdict:** `OK_SNAPSHOT_WINS` — `pipeline_stage_id` совпадает со snapshot, НЕ с текущим offer.meta.

**Result:**
```
<paste here>
```

---

## 5. Manual Override Proof

**Сценарий:**
1. Создать заказ → `ORDER_ID_manual_override`. Pending выставлен из snapshot.
2. В Kanban вручную перетащить сделку в другую `open`-стадию (НЕ pending/success/failed из snapshot).
3. Завершить оплату webhook'ом.
4. Прогнать Block G.

**Expected:**
- `verdict = OK_MANUAL_NOT_OVERWRITTEN` — стадия осталась там, куда менеджер перетащил.
- В `audit_logs` есть `crm_stage_apply_skipped_manual_override` с `reason=stage_changed_manually`.

**Result:**
```
<paste here>
```

---

## 6. Invalid Config / No-Routing Proof (Block H)

**Сценарий:** оплата заказа на оффере БЕЗ `crm_routing` (или `enabled=false`).

**Expected:**
- Заказ создаётся как обычно (`pipeline_stage_id=NULL`, snapshot отсутствует).
- Никаких ошибок в edge function logs.
- Если webhook доходит до helper (а он НЕ дойдёт, потому что snapshot отсутствует — defensive в `applyCrmStageOnTerminal` вернёт `no_snapshot` и запишет `crm_stage_apply_skipped_invalid_config` с `reason=no_snapshot_in_order_meta`).

**Result:**
```
<paste here>
```

---

## 7. Out-of-Scope Confirmation

| Категория | Подтверждение |
|---|---|
| recurring/rebill | Helper НЕ вызывается в rebill-ветках webhook (grep подтверждён). |
| refund | refunded НЕ маппится в `stage_on_failed`. Отдельной стадии для refund в Layer A нет. |
| `admin-link-payment-to-order` | Helper НЕ интегрирован, ручная операция. |
| site-form-submit | Layer B, отдельный спринт. |

---

## 8. Definition of Done

- [ ] Block A: routing включён, валиден.
- [ ] Block B: 3 стадии семантически корректны.
- [ ] Block C: 4 заказа имеют snapshot + pending-stage.
- [ ] Block D: 4/4 verdict = OK_SUCCESS / OK_FAILED.
- [ ] Block E: 4/4 audit chains полные.
- [ ] Block F: snapshot immutability = OK_SNAPSHOT_WINS.
- [ ] Block G: manual override = OK_MANUAL_NOT_OVERWRITTEN + skip audit запись.
- [ ] Block H: invalid_config skip без побочных эффектов.
- [ ] Out-of-scope ветки не задеты (helper там не вызывается).

**После выполнения всех 9 пунктов — Layer A считается закрытым.**

---

## 9. Финальный статус (до заполнения)

- код внесён;
- Layer A реализован;
- grep-audit завершён;
- live-proof не завершён (ожидание 4 order_id).
