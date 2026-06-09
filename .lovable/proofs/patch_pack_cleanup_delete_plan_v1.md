# PATCH 3 Cleanup — DELETE PLAN (Scope A, hard cleanup)

Дата: 2026-06-09  
Статус: DRY-RUN / DELETE PLAN, EXECUTE НЕ запущен. Ждёт final approve.  
Scope: Scope A (подтверждён пользователем) — единственный KEEP = реальный live Stripe платёж Сергея 5 BYN, всё остальное Stripe test/dev — hard delete.

---

## 0. Принципы

- Hard cleanup (никакого soft-hide / meta.cleanup_hidden).
- Никакого refund 5 BYN, никакого касания bePaid.
- Никакого удаления реальных профилей пользователей.
- Удаление выполняется в фиксированном порядке (низ → верх FK):
  1. `payments_v2` (delete) — у `orders_v2` FK CASCADE, поэтому payments чистятся автоматически при удалении order, но мы удалим явно для аудита.
  2. `entitlements`, `access_grant_ledger`, `entitlement_orders`.
  3. `subscriptions_v2`, `provider_subscriptions`.
  4. `orders_v2`.
  5. `payment_links` (stripe).
  6. `provider_events` (stripe).
- Каждый шаг — отдельная транзакция, перед commit — count check.
- Backup snapshot всех затрагиваемых строк в `_stripe_cleanup_2026_06_backup` (по аналогии с прошлыми cleanup-таблицами).

---

## 1. KEEP — НЕ ТРОГАТЬ

Реальный live Stripe платёж и все его прямые связи:

| Сущность | ID | Признаки live |
|---|---|---|
| `payments_v2` | `2d40bc7e-e69f-4633-88d5-102561e49a54` | `pi_3TgMkD6UYJj2vm0G1ZUpRzvH`, `cs_live_a1zPxEw8wmMyELGazXbOkshlZ55NyoZNvY8c54fFpRQPCN5qEBZhrv6rnR`, 5 BYN, succeeded, card `visa 3587 / Fedorchuk Sergey` |
| `orders_v2` | `b464dc75-f295-419d-bede-10cd47fc299e` | `ORD-26-00167`, paid, 5 BYN, provider=stripe, user=Сергей Федорчук |
| `subscriptions_v2` | `6c3cd3a5-75d0-4faa-9923-75bc2fa6b70a` | active, product `62a522a5…`, tariff `2633e0d9…`, initial_order = KEEP order |
| `entitlements` | `fabd7e5a-95b1-4bc3-89ad-a635f8ee8edc` | product_code `prd_5e87aa54b771`, active, expires 2026-07-09, order = KEEP |
| `provider_subscriptions` | — | для KEEP-order строк нет (5 BYN живёт как one-off + локальный sub), удалять нечего и не трогаем |
| `profiles` | `a4b7c8c9-8210-499e-ae3f-2a5db2121577` (Сергей Федорчук, 7500084@gmail.com) | реальный клиент |
| Provider events для `pi_3TgMkD6…` / `cs_live_a1zP…` | — | оставляем для аудита, удаление только по test/dev фильтру (см. §6) |

Запрос-сторож (должен после EXECUTE возвращать все 1):
```sql
SELECT count(*) FROM payments_v2     WHERE id='2d40bc7e-e69f-4633-88d5-102561e49a54';
SELECT count(*) FROM orders_v2       WHERE id='b464dc75-f295-419d-bede-10cd47fc299e';
SELECT count(*) FROM subscriptions_v2 WHERE id='6c3cd3a5-75d0-4faa-9923-75bc2fa6b70a';
SELECT count(*) FROM entitlements    WHERE id='fabd7e5a-95b1-4bc3-89ad-a635f8ee8edc';
```

---

## 2. DELETE — payments_v2 (22 строки)

Фильтр:
```sql
(provider='stripe' OR origin='stripe' OR meta::text ILIKE '%stripe%'
 OR provider_payment_id ~ '^(pi_|ch_|cs_|re_|in_)')
AND id <> '2d40bc7e-e69f-4633-88d5-102561e49a54'
```

Будет удалено: **22 строки** payments_v2.

Срез:
- 8 × `in_1T…` (subscription invoice payments, test stripe);
- 2 × `pi_sim_*` (sandbox);
- 6 × `re_3T…` (test refund rows);
- 5 × `pi_3T…` без card_holder (test stripe one-off);
- 1 × `pi_3TeJWM…` (5 USD test).

Все: `card_last4 = NULL`, `card_holder = NULL`, `cs_test_*` или test invoice.

---

## 3. DELETE — orders_v2 (32 строки)

Фильтр:
```sql
provider='stripe' AND id <> 'b464dc75-f295-419d-bede-10cd47fc299e'
```

Будет удалено: **32 - 1 = 31 строка** orders_v2 (все stripe-orders кроме KEEP).

Срез:
- 15 paid (test/sim/cs_test_/invoice);
- 14 pending (`cs_test_*` без оплаты);
- 2 failed.

Все — без `cs_live_*`, без реального `pi_3T*` live, либо `pi_sim_*`, либо invoice от test sub, либо `cs_test_*`.

FK CASCADE на `payments_v2.order_id` обеспечит удаление оставшихся связанных payments_v2 (если они вдруг проскользнут мимо §2).

---

## 4. DELETE — subscriptions_v2 (16 строк)

Фильтр:
```sql
meta::text ILIKE '%stripe%' AND id <> '6c3cd3a5-75d0-4faa-9923-75bc2fa6b70a'
```

Будет удалено: **16 строк** (все stripe-test subs на product `11c9f1b8…` / tariff `31f75673…`).

Statuses: 3 active (orphan test), 2 pending, 10 canceled, 1 superseded.

KEEP-sub `6c3cd3a5` (product `62a522a5…`, tariff `2633e0d9…`) — другой product/tariff, не пересекается.

---

## 5. DELETE — provider_subscriptions (16 строк)

Фильтр:
```sql
provider='stripe'
```

Будет удалено: **16 строк** (все stripe-test provider subs `sub_1T*` + `pending:*`).

---

## 6. DELETE — entitlements + access_grant_ledger + entitlement_orders

### entitlements
Фильтр:
```sql
order_id IN (<31 удаляемых stripe order>)
```
Будет удалено: **5 строк** (`club` + 1 `general` на тестовые stripe orders).

Влияние:
- Сергей теряет club-entitlement из тестового sub до 2026-09-06 — но Сергей всё равно реальный club-член по другим каналам (надо подтвердить отдельно; в пределах cleanup это ожидаемо).
- Тестовые юзеры (QA, Андрей, Юлия) теряют тестовый club.

### access_grant_ledger
Фильтр: `order_id IN (<31 удаляемых stripe order>)`  
Будет удалено: **11 строк**.

### entitlement_orders
Фильтр: тот же.  
Будет удалено: **0 строк**.

---

## 7. DELETE — payment_links (Stripe, 17 строк)

Фильтр:
```sql
provider='stripe' OR account_code ILIKE '%stripe%'
```
Будет удалено: **17 строк** payment_links (все `provider='stripe'`, `account_code='stripe_poland'`, test/dev links). bePaid links не трогаем.

Из них:
- 13 active (тестовые ссылки, не использованные либо использованные в test потоке);
- 4 invalidated.

KEEP `payment_links` строки, связанные с live 5 BYN: нет (5 BYN был прямой checkout, не через link).

---

## 8. DELETE — provider_events (123 строки)

Фильтр:
```sql
provider='stripe' OR event_type ILIKE '%stripe%'
OR payload::text ~ '(pi_3T|cs_test_|in_1T|sub_1T)'
```
**За вычетом** событий, относящихся к KEEP-payment (`pi_3TgMkD6UYJj2vm0G1ZUpRzvH` / `cs_live_a1zP…`):
```sql
AND NOT (payload::text ILIKE '%pi_3TgMkD6UYJj2vm0G1ZUpRzvH%'
      OR payload::text ILIKE '%cs_live_a1zPxEw8wmMyELGazXbOkshlZ55NyoZNvY8c54fFpRQPCN5qEBZhrv6rnR%')
```
Будет удалено: ≈ **120 строк** (точное число после re-count в EXECUTE pre-commit). KEEP-связанные события (~3) сохраняем для аудита live платежа.

---

## 9. DELETE — profiles / contacts

**0 удалений.**  
Все 4 user_id на stripe orders (`05cd3754…` Сергей, `638a13ec…` QA, `0df89f06…` Андрей, `03182abc…` Юлия) — реальные существующие профили. Никаких ghost/test-only профилей, созданных Stripe sprint'ом, не найдено. Профили не трогаем.

---

## 10. NO-OP / не трогаем

| Сущность | Причина |
|---|---|
| bePaid payments_v2 (provider='bepaid' без stripe meta) | не входит в scope |
| bePaid payment_links | не входит в scope |
| bePaid subscriptions/provider_subscriptions | не входит в scope |
| `bepaid_statement_rows` | не входит в scope |
| `payment_reconcile_queue` | не входит в scope |
| `audit_logs` / `domain_events` / `domain_executions` | оставляем — это аудит истории |
| profiles | см. §9 |
| reseller/CRM pipeline-deals | в текущем срезе на stripe-test orders pipeline-сделок не создавалось (`pipeline_id` пустой у всех 31 удаляемых stripe order) — отдельный sweep не требуется |

---

## 11. REVIEW (STOP if found)

Перед EXECUTE re-run этих guard-запросов; если хоть один вернёт > 0 — STOP и эскалация:
```sql
-- live Stripe payment, не равный KEEP
SELECT id, provider_payment_id, meta->'stripe'->>'checkout_session_id'
FROM payments_v2
WHERE provider='stripe'
  AND id <> '2d40bc7e-e69f-4633-88d5-102561e49a54'
  AND (meta->'stripe'->>'checkout_session_id' LIKE 'cs_live_%'
       OR meta->'stripe'->>'livemode'='true');

-- live Stripe order
SELECT id, provider_payment_id
FROM orders_v2
WHERE provider='stripe'
  AND id <> 'b464dc75-f295-419d-bede-10cd47fc299e'
  AND (meta->'stripe'->>'checkout_session_id' LIKE 'cs_live_%'
       OR meta->'stripe'->>'livemode'='true');
```
Текущий результат guard-запросов: **0 / 0**. Live-rогрешностей нет — Scope A корректно применим.

---

## 12. Сводка DELETE / KEEP

| Таблица | DELETE | KEEP |
|---|---:|---:|
| payments_v2 (stripe) | 22 | 1 |
| orders_v2 (stripe) | 31 | 1 |
| subscriptions_v2 (stripe) | 16 | 1 |
| provider_subscriptions (stripe) | 16 | 0 |
| entitlements (на test stripe orders) | 5 | 1 (KEEP-fabd7e5a) |
| access_grant_ledger (на test stripe orders) | 11 | n/a |
| entitlement_orders | 0 | n/a |
| payment_links (stripe) | 17 | 0 |
| provider_events (stripe) | ~120 | ~3 (по KEEP-payment) |
| profiles | 0 | все |
| bePaid* | 0 | все |

---

## 13. EXECUTE protocol (после approve)

1. Создать backup-таблицы `_stripe_cleanup_2026_06_backup_*` с snapshot всех удаляемых строк (по каждой сущности).
2. Один transaction per table, в порядке §6 → §5 → §4 → §3 → §2 → §7 → §8.
3. После каждого DELETE — `count(*)` check vs ожидаемое число; mismatch → ROLLBACK + STOP.
4. После всех DELETE — verify §1 guard (4 строки на месте) + §11 guard (0/0).
5. UI smoke: `/admin/payments`, `/admin/payments/links`, карточка Сергея — нет stripe test/dev мусора, live 5 BYN на месте.
6. Финальный proof: `.lovable/proofs/patch_pack_cleanup_execute_v1.md` с before/after-count'ами и ID backup-таблиц.

---

## 14. Open approvals required

- [ ] Approve EXECUTE по этому плану (Scope A).
- [ ] Approve удаление test-stripe entitlement Сергея (1 строка `c60cb8f0…`, club до 2026-09-06) — фактически тестовый club, не реальная покупка; согласно Scope A — удаляем.
- [ ] Approve удаление stripe `payment_links` (17), включая 6 с `current_uses=1` (все привязаны к test orders из §3).

EXECUTE НЕ запускается до прихода approve.
