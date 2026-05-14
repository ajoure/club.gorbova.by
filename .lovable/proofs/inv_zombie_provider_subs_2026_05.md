# REPAIR-BEPAID-ACCESS-2026-05 v3 — Dry-run zombie provider_subscriptions

## Discovery (read-only, на момент 2026-05-14)

| метрика | значение |
|---|---|
| `provider_subscriptions.state='active' AND provider='bepaid'` (всего) | 179 |
| Из них **healthy** (linked → sv2.status='active' AND access_end_at ≥ now) | 152 |
| Из них **unlinked** (`subscription_v2_id IS NULL`) | 5 |
| Из них **linked_dead** (linked → sv2.status ∈ expired/superseded/canceled или access_end_at < now) | 22 |
| **Кандидаты на repair (zombies)** | **27** |

Распределение кандидатов по продуктам:

| product | count |
|---|---|
| Gorbova Club | 21 |
| Бухгалтерия как бизнес | 1 |
| (нет linked sv2 → продукт не определён через sv2) | 5 |

## Кейс Вероники Матук (явный)

- `provider_sub_row_id=a8999dac-4f65-4693-9b2e-12482732409a`
- `provider_subscription_id=sbs_b541fac39dd6f089`
- `user_id=341e6f46-79dd-4920-b500-da78e3574aab` (Вероника Матук, nika.1900735@mail.ru)
- класс: **unlinked** (`subscription_v2_id=NULL`)
- `next_charge_at=2026-06-10`, `last_charge_at=NULL`, `card=master 4854`, `amount=250.00 BYN`
- последний успешный платёж по Gorbova Club: order `47d54498-…` от 2026-04-11 (покрытие до 11.05.2026)
- локальная sub `subscriptions_v2.22576f44-…` → `expired`, `auto_renew=false`, `access_end_at=2026-05-11` ✅ корректна
- ожидаемое действие: `cancel_provider_then_local`
  - bePaid `cancel-subscriptions` по `sbs_b541fac39dd6f089`
  - `provider_subscriptions.a8999dac-… → state='canceled'`, `meta.cancel_reason='inv_zombie_provider_dead_2026_05'` или `local_expired_provider_active_2026_05` (зависит от ответа bePaid)
  - **доступ не восстанавливается**, Telegram-grant не вызывается
  - subscriptions_v2.22576f44 не трогаем
  - `subscription_v2_id` не привязываем задним числом

## Полный список кандидатов (27)

См. `tools://supabase/.../zombies.tsv` (TSV приложен ниже как сырой дамп для backlog/proof).

Ключевые поля: `provider_sub_row_id, provider_subscription_id, user_id, email, sv2_id, sv2_status, access_end_at, auto_renew, product_name, tariff_id, next_charge_at, last_charge_at, amount_cents, card_last4, class`.

## Алгоритм repair (на каждой строке)

1. **Pull** через `bepaid-get-subscription-details` (canonical, не прямой DB write).
2. Классификация ответа bePaid:
   - `provider_state ∈ {canceled, expired, terminated}` → action `cancel_local_only`, локально `state='canceled'`, `meta.cancel_reason='inv_zombie_provider_dead_2026_05'`.
   - `provider_state='active'` → action `cancel_provider_then_local`: вызвать `bepaid-cancel-subscriptions` → при успехе локально `state='canceled'`, `meta.cancel_reason='local_expired_provider_active_2026_05'`. При 4xx/5xx от bePaid — НЕ менять локально, пометить candidate `failed_to_cancel_provider`, оставить для ручного review.
   - `provider_state` ambiguous / API недоступен → STOP по строке, `manual_review`.
3. Audit на каждое изменение:
   ```
   actor_type='system'
   actor_user_id=NULL
   actor_label='inv_zombie_repair_2026_05'
   target_user_id=<ps.user_id>
   action='provider_subscription.canceled.zombie_repair_2026_05'
   meta = {
     provider_sub_row_id, provider_subscription_id, subscription_v2_id,
     before_state:'active', after_state:'canceled',
     bepaid_response_status, bepaid_response_excerpt,
     repair_batch:'REPAIR-BEPAID-ACCESS-2026-05',
     reason_class
   }
   ```

## STOP-guards

- Не трогать `provider_subscriptions` где linked sv2 = `active` AND `access_end_at >= now()` (152 healthy).
- Если bePaid cancel API вернул ошибку — НЕ ставить локально canceled. Пометить как `failed_to_cancel_provider`.
- Если найден active local subscription с future `access_end_at` для того же `(user, product, tariff)` — НЕ трогать.
- Если provider_sub связан с несколькими locale entities или продукт не определим — STOP по строке.
- Не трогать `payments_v2`, `orders_v2`, `entitlements`, `subscriptions_v2.access_end_at`.
- Не вызывать Telegram grant/revoke в рамках этого repair.

## Execute план (после approve)

- Этап 3.1 — точечный запуск только по Веронике (1 строка): `a8999dac-…`.
- Этап 3.2 — UI patches (см. Этап 1 плана), не зависит от repair.
- Этап 3.3 — массовый repair батчем 27 строк, с per-row pull+cancel.
- Этап 5 — Verify SQL: counter zombies = 0 + skip-list `failed_to_cancel_provider`.

## Aggregate snapshot ДО repair

```
zombie_total                     = 27
healthy_active                   = 152
unlinked_active                  = 5
linked_dead_active               = 22
provider_subs_active_total       = 179
```

## Snapshot ПОСЛЕ repair (заполняется по факту)

```
zombie_total_after               = ?
canceled_by_repair               = ?
failed_to_cancel_provider        = ?
manual_review                    = ?
healthy_active_after             = 152 (must remain unchanged)
```
