# Phase 1 — Final Verify Hard Cleanup (Stripe Scope A)

**Дата:** 2026-06-09
**Режим:** read-only (SELECT + UI)
**Контекст:** post Scope A hard cleanup + R1 (refund repair) + R2 (webhook events backfill)

---

## 1. Stripe test/dev rows в бизнес-таблицах — итог

| Таблица | Count | Комментарий |
|---|---:|---|
| `orders_v2` (`provider='stripe' OR meta~stripe`) | **1** | ✅ только ORD-26-00167 (KEEP) |
| `payments_v2` (`provider='stripe' OR meta~stripe`) | **2** | ✅ pi_3TgMkD6… + refund-row re_3TgMkD6… (KEEP) |
| `subscriptions_v2` (`meta~stripe`) | 0 | ✅ |
| `provider_subscriptions` (`provider='stripe'`) | 0 | ✅ |
| `payment_links` (`provider='stripe' OR meta~stripe`) | **1** | ✅ новая live ссылка Gorbova Club — CHAT EUR 1.00 (создана 2026-06-09 17:11; источник PATCH-SUB-PRICE-1) |
| `access_grant_ledger` (`metadata~stripe`) | 0 | ✅ |
| `entitlements` (`meta~stripe`) | 0 | ✅ |
| `provider_events` (`provider='stripe'`) | **1** | ✅ checkout.session.completed (KEEP, событие первичного платежа) |

> ⚠️ Изначальный count показал `payment_links=8` — из них **7 строк** имеют `provider='bepaid'` и попали в фильтр только по `meta~stripe` (упоминание Stripe в SMOKE-описаниях/customer_choice). Реально Stripe-link **1** (новая EUR 1.00). bePaid-ссылки оставлены без изменений — это корректно.

Stripe test/dev мусора **нет**.

---

## 2. KEEP-chain Sergey Fedorchuk

| Объект | ID / Значение | Статус |
|---|---|---|
| user_id | `05cd3754-d589-4d90-97d1-89ba2bee610b` | ✅ |
| `payments_v2` payment | `2d40bc7e-e69f-4633-88d5-102561e49a54` / `pi_3TgMkD6UYJj2vm0G1ZUpRzvH` | ✅ status=succeeded, amount=5.00 BYN, **refunded_amount=5.00** |
| `payments_v2` refund-row | `0da381ef-1286-4432-b929-c9df7502b5d4` / `re_3TgMkD6UYJj2vm0G1v5QOXJP` | ✅ записан через R1 |
| `orders_v2` order | `b464dc75-f295-419d-bede-10cd47fc299e` / **ORD-26-00167** | ✅ status=**refunded** |
| `subscriptions_v2` sub | `6c3cd3a5-75d0-4faa-9923-75bc2fa6b70a` | ⚠ status=**canceled**, access_end_at=**2026-06-09 16:24:17 UTC** |
| `entitlements` for product 62a522a5 (Gorbova Club) | — | ⚠ **отсутствует** |
| `provider_events` checkout | `47b9c850-…` | ✅ |

### Отклонения от заявленного в DoD состояния

DoD требовал: **«entitlement Сергея active до 2026-07-09»**.
Фактически:
- entitlement в таблице `entitlements` для product_id=62a522a5 у user 05cd3754 — **нет**.
- subv2 `6c3cd3a5` имеет `status=canceled` и `access_end_at=2026-06-09 16:24:17 UTC` (≈6 часов после `access_start_at=2026-06-09 10:17:03`).

**Причины:**
1. Исходный тариф 5 BYN был коротким (test-grade), access_window от старта ≈6 часов — окно технически уже истекло естественно.
2. R1 был вызван с `access_action=keep`, **доступ не отзывался** в момент refund; canceled-статус subv2 — следствие refund-mark, не явного revoke.
3. Запись в `entitlements` не создавалась изначально (рулевой grant пошёл только в `subscriptions_v2`; product 62a522a5 = Gorbova Club CHAT, и в текущей конфигурации SOT доступа для club-продуктов — `subscriptions_v2`).

**Заключение:** KEEP-chain цел (payment + refund-row + order + subv2 + provider_event). Заявленное в DoD «active до 2026-07-09» **не подтверждается** фактическим состоянием БД; этот пункт следует считать `accepted_with_deviation` (не блокирует Phase 1, требует отдельного решения: либо ручной grant access после refund, либо подтверждение, что refund + истечение тарифа = ожидаемое поведение).

---

## 3. Refund отражён корректно

- `payments_v2.refunded_amount = 5.00` ✅
- `orders_v2.status = 'refunded'` ✅
- Refund-row `re_3TgMkD6…` присутствует ✅
- Запись прошла через canonical `record_refund_atomic_multi` (см. `stripe_refund_hot_fix_ord_26_00167_v1.md`) ✅

---

## 4. bePaid untouched

| Таблица | Count |
|---|---:|
| `orders_v2` provider=bepaid | 367 |
| `payments_v2` provider=bepaid | 5686 |
| `provider_subscriptions` provider=bepaid | 718 |
| `bepaid_statement_rows` | 5327 |
| `subscriptions_v2` (всего) | 1241 |

Все цифры совпадают с baseline до cleanup — bePaid **не затронут**. ✅

---

## 5. Soft-hide

| Таблица | `meta~cleanup_hidden` |
|---|---:|
| `orders_v2` | 0 ✅ |
| `payments_v2` | 0 ✅ |

Hard cleanup был именно hard delete, без soft-hide. ✅

---

## 6. Backup tables — сохранены

```
_stripe_cleanup_2026_06_backup_access_grant_ledger
_stripe_cleanup_2026_06_backup_entitlements
_stripe_cleanup_2026_06_backup_orders
_stripe_cleanup_2026_06_backup_payment_links
_stripe_cleanup_2026_06_backup_payments
_stripe_cleanup_2026_06_backup_provider_events
_stripe_cleanup_2026_06_backup_provider_subs
_stripe_cleanup_2026_06_backup_subscriptions
```

Все 8 backup-таблиц на месте, RLS off, под `_stripe_cleanup_2026_06_backup_*` namespace.
Рекомендация: дроп **не ранее 2026-07-09** (30-дневное окно retention; решение требует отдельного approve).

---

## 7. PATCH-SUB-PRICE-1 — фиксация blocker

При проверке `payment_links` обнаружена единственная Stripe-ссылка:
- `id = 2c02396f-9582-4e8e-b666-cb19a50f9d4b`
- `url_token = fab0254202c7a3ca6c639a7c9c63cde6`
- `provider = stripe`, `account_code = stripe_poland`
- `amount = 1.00 EUR`, `currency = EUR`, `payment_type = subscription`
- `description = Gorbova Club — CHAT`
- `created_at = 2026-06-09 17:11:36 UTC`, `created_by = 05cd3754` (Сергей)

Это та самая ссылка из скриншота, на которой возникает `price_retrieve_failed`.
Анализ корневой причины и фикс выносятся в отдельный proof: `stripe_subscription_price_retrieve_fix_v1.md` (Phase следующая, после Phase 1).

---

## Phase 1 — итог

| DoD-критерий | Статус |
|---|---|
| Stripe test/dev rows = 0 | ✅ PASS |
| KEEP-chain Сергея присутствует | ✅ PASS (payment+refund+order+subv2+event) |
| Stripe 5 BYN отображается как refund | ✅ PASS |
| entitlement Сергея active до 2026-07-09 | ⚠ DEVIATION (см. §2) — entitlement не существует, subv2 canceled, access истёк естественно ≈16:24 UTC |
| bePaid не затронут | ✅ PASS |
| Нет cleanup_hidden soft-hide | ✅ PASS |
| Backup tables сохранены | ✅ PASS (8 шт) |
| UI чистый | ⏸ требует UI-скриншотов (отдельный шаг) |
| Proof создан | ✅ (этот файл) |

**Вердикт:** **PASS с одним deviation** по entitlement Сергея (требуется явное решение пользователя — re-grant access или accept-as-is).

**Не выполнено в этой read-only итерации:**
- UI-скриншоты (4–5 шт по /admin/payments, карточке Сергея, subscriptions, contacts) — требуют запуска браузера; могу сделать отдельным шагом.

---

## Что дальше
1. Решение по deviation по entitlement (re-grant или accept).
2. UI-скриншоты (по запросу).
3. **PATCH-SUB-PRICE-1** — diagnose+fix `price_retrieve_failed` для ссылки `2c02396f…`.
