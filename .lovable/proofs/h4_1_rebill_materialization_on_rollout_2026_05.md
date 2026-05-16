# H4.1 — controlled enable BEPAID_REBILL_MATERIALIZATION=on

## 1. Pre-state (Stage 0)

**Snapshot:**
- `snapshot_at_utc` = `2026-05-16T20:58:18.520Z`
- `snapshot_at_minsk` = `2026-05-16 23:58:18 Europe/Minsk`

**Secret inventory (имена, без значений):**
- `BEPAID_REBILL_MATERIALIZATION` присутствует.
- Текущий режим: `dry_run` (подтверждено `meta.mode='dry_run'` в свежих audit `bepaid.rebill.dry_run`).
- Ни один другой secret в этом плане не трогается.

**Метрики:**

| Метрика | Значение | Ожидание | OK |
|---|---|---|---|
| `active_duplicate_pairs_count` (по `user_id, product_id, tariff_id`, `status='active' AND auto_renew=true`) | 0 | 0 | ✓ |
| `past_due_phantom_count` (`status='past_due' AND access_end_at IS NULL`) | 51 | не блокер (wave 2) | ℹ |
| `bepaid.rebill.dispatcher_error` за 7d | 0 | 0 | ✓ |
| `bepaid.rebill.conflict_uid` за 7d | 0 | 0 | ✓ |
| `bepaid.rebill.sbs_mismatch` за 7d | 0 | 0 | ✓ |

**Все `bepaid.rebill.%` события за 7 дней:**

| action | count | last_at |
|---|---|---|
| `bepaid.rebill.decision_audit` | 1 | 2026-05-16 16:31:05 UTC |
| `bepaid.rebill.dry_run` | 2 | 2026-05-16 16:31:05 UTC |

Других вариантов (`materialized`, `dispatcher_error`, `conflict_uid`, `sbs_mismatch`, `skipped_*`) за окно нет.

**Последние 3 dry-run кандидата (snapshot):**

| # | created_at | sbs | provider_payment_uid | parent_order_id | product_id | tariff_id | user_id |
|---|---|---|---|---|---|---|---|
| 1 | 2026-05-16 16:31:05 | sbs_88d5b971d22e57dd | 0baeaac6-c7b3-40bb-8c40-ceee7070b2fe | efe58870-e539-4e76-874a-9e5b03a66ae3 | 11c9f1b8-0355-4753-bd74-40b42aa53616 | 7c748940-dcad-4c7c-a92e-76a2344622d3 | ddcb6288-caed-44b6-819a-925956676a27 |
| 2 | 2026-05-16 06:45:46 | sbs_70f8efb8949a490c | bdfc574d-2f3c-4aa1-8376-9c81c7379598 | 68e2c243-8950-491e-b6d2-bdefd1e8d506 | 11c9f1b8-0355-4753-bd74-40b42aa53616 | 7c748940-dcad-4c7c-a92e-76a2344622d3 | 78123ed5-3a00-4982-87cf-72de6c0cdb8c |

Оба кандидата — recurring по одному и тому же тарифу `7c748940` продукта `11c9f1b8`. `decision='would_materialize'`, `full_refunded_uid=false`, planned grant call = `grant-access-for-order(order_id=<new_rebill_order_id>)`, planned payment repoint = существующий payment перенаправляется на новый REBILL-order (no new payment row).

**Pre-state соответствующих subscriptions_v2 (для regression check на Stage 3):**

| subscription_id | user_id | status | auto_renew | access_end_at (UTC) |
|---|---|---|---|---|
| 3266e62a-128e-4637-a485-ed0bad23928d | ddcb6288-caed-44b6-819a-925956676a27 | active | true | 2026-06-15 20:59:59 |
| 493f5559-0a1d-4a7d-b43f-d6375078e1cd | 78123ed5-3a00-4982-87cf-72de6c0cdb8c | active | true | 2026-06-16 12:00:00 |

Stage 3 проверка `access_end_at` regression идёт против этих baseline-значений.

**Gate 0:** PASS — pre-state соответствует ожиданиям. Можно flip.

---

## 2. Flip (Stage 1)

_Pending — Stage 1 будет выполнен после явного подтверждения через secrets update form._

- `flipped_at_utc` = `<TBD>`
- `flipped_at_minsk` = `<TBD>`
- Действие: `BEPAID_REBILL_MATERIALIZATION`: `dry_run` → `on`. Двойное re-read (сразу после update и перед началом observation).

---

## 3. Observation window (Stage 2)

_Pending после Stage 1. Окно — до 24h ожидания первого live REBILL. Если за 24h трафика нет → статус `enabled_awaiting_first_rebill`, без rollback._

---

## 4. First live REBILL verify (Stage 3)

_Pending. 10 пунктов проверки._

---

## 5. Verdict (Stage 4)

_Pending._

---

## 6. Rollback (Stage 5)

_Не выполнялся._

---

## Контакты, которых может коснуться

На стадии flip — никого.

На стадии verify коснётся первого реального плательщика, у которого bePaid инициирует rebill после `flipped_at`. По текущему dry-run списку первыми кандидатами с активной recurring-подпиской на тарифе `7c748940` продукта `11c9f1b8` числятся пользователи `ddcb6288-…` и `78123ed5-…` — точные ФИО фиксируются в Stage 3 после первого live-события.

Заведомо **НЕ** трогаются:
- Алеся Хомич (G25, hold до 2026-05-18 06:00 UTC).
- Рабчевская Юлия (отдельный repair).
- 51 phantom past_due (wave 2, отдельно).
- Алёна Богинская (без дубля сейчас).
