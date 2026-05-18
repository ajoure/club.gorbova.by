Да, согласен, с учетом правок:

1. **Убрать из плана формулировку “дефолт клуба — 30 дней”.**  
Источник срока доступа — только SOT:

```text
1. tariff.access_days
2. order.purchase_snapshot.access_days / tariff_snapshot.access_days
3. subscription.access_start_at / access_end_at
4. access_rules / product_fulfillment, если там явно задан срок
```

Если `access_days` не найден — не подставлять 30 дней автоматически, а ставить:

```text
manual_review_access_days_unresolved
```

Иначе снова будет ложная классификация.

2. **Белозор — обязательный blocker-case.**  
Если по Екатерине Белозор (`zapponka1@gmail.com`) последняя оплаченная сделка Gorbova Club BUSINESS покрывает дату аудита, то:

```text
telegram revoke запрещён
verdict = missing_platform_access_but_paid_order_exists
или access_active_by_paid_order_window
```

3. **Проверять не только orders_v2, но и фактический payment.**  
Paid order сам по себе недостаточен. Для каждого order нужен связанный успешный `payments_v2`:

```text
payment.status IN ('paid','succeeded','successful')
amount > 0
refund отсутствует именно по этому payment
```

4. **Refund проверять строго по конкретному payment/order.**  
Refund по другому платежу того же клиента не должен блокировать доступ и не должен отправлять в revoke.
5. **Extend-логику считать только в пределах одного продукта/тарифа.**  
Последовательные оплаты суммируются только если совпадают:

```text
user/profile
product_id
tariff_id
club_id mapping
```

Если тариф менялся / upgrade / downgrade — `manual_review_refund_or_conflict`.

6. **Для Gorbova Club учитывать оба источника доступа.**

```text
product 11c9f1b8 — Gorbova Club
product 9d0d6de8 + tariff c1b4bb88 — Платная консультация bonus-rule
```

Но по `Платная консультация` доступ к club считать только при точном совпадении `tariff_id=c1b4bb88`.

7. **Для “Бухгалтерия как бизнес” не проверять channel.**  
Там SOT — только chat/group. Channel не должен попадать в ошибки.
8. **Добавить отдельную итоговую категорию для data repair.**  
Все строки:

```text
missing_platform_access_but_paid_order_exists
```

должны автоматически попасть в следующий backlog:

```text
PATCH-DATA-REPAIR-MISSING-ENT
```

Не в revoke.

9. **Execute после 2A запрещён.**  
Даже если останется 1–2 `revoke_confirmed`, этот патч только read-only. Revoke — отдельный approve.
10. **Proof должен содержать source trace по каждому из 13 кандидатов.**  
Для каждой строки указать:

```text
почему был в revoke list
какой active access найден / не найден
какой paid order найден / не найден
какой payment подтверждает оплату
какой срок доступа рассчитан
какой итоговый verdict
```

Итоговая команда:

```text
PATCH-TG-REVOKE-2A подтверждаю с правками.

Выполни строго read-only.

Главное:
не банить пользователя из Telegram только потому, что нет entitlement/subscription, пока не проверена последняя оплаченная сделка и её расчётное окно доступа.

Особенно проверить Екатерину Белозор / zapponka1@gmail.com как blocker-case.

Если paid order + successful payment дают действующий доступ на snapshot_at:
- revoke запрещён;
- строка уходит в missing_platform_access_but_paid_order_exists или access_active_by_paid_order_window;
- дальше это PATCH-DATA-REPAIR-MISSING-ENT, а не Telegram revoke.

Не использовать “30 дней по умолчанию”, если срок не доказан из tariff/order/subscription/access_rules. Если срок не найден — manual_review_access_days_unresolved.

Artifacts:
.lovable/proofs/patch_tg_revoke_2a_payment_access_revalidation_2026_05.md
/mnt/documents/patch_tg_revoke_2a_revalidated_candidates_2026_05.csv

После dry-run остановиться. Execute не запускать.

План: дополнение к текущему Telegram-аудиту
```

## STOP-условие

PATCH-TG-REVOKE-2 execute **НЕ approve**. Контрольный кейс Екатерина Белозор (`zapponka1@gmail.com`) показывает, что текущая логика revoke неполная:

- `expected_access=no`, `active_entitlement_id=NULL`, `active_subscription_id=NULL`
- `actual_in_chat=true`, `actual_in_channel=true`
- но в админке — оплаченные Gorbova Club BUSINESS сделки, в т.ч. 22.04.2026 на 250 BYN

При сроке доступа 30 дней от оплаты на дату аудита (18.05.2026) она должна была иметь действующий доступ до ~22.05.2026. Это не Telegram-проблема, а возможный missing entitlement/subscription bug.

Поэтому перед любым revoke добавляется обязательный preflight-патч.

---

## PATCH-TG-REVOKE-2A — Revoke candidates payment/access revalidation

**Тип:** read-only, dry-run only.
**Scope:** ровно 13 строк из `/mnt/documents/telegram_revoke_candidates_verified_2026_05.csv` (12 Gorbova Club + 1 Бухгалтерия как бизнес).
**Execute запрещён.**

### Шаги

**1. Сбор paid orders по каждому кандидату**

Для каждой из 13 строк (user_id / profile_id / email) найти в `orders_v2`:

- `status='paid'`
- успешный `payments_v2` (succeeded / paid)
- `product_id` принадлежит множеству продуктов, которые открывают club_id кандидата (по `access_rules` с `grant_target_type='club'`, `is_active=true`):
  - Gorbova Club (`fa547c41`): `11c9f1b8` (любой тариф) + `9d0d6de8` только tariff `c1b4bb88`
  - Бухгалтерия как бизнес (`4f8f9d8f`): `85046734` (любой тариф)
- собрать: `order_id`, `deal_date`, `paid_at`, `tariff_id`, `tariff_name`, `final_price`, `refund_status` / `partial_refund`, `meta.payment_flow`

**2. Расчёт expected access window**

Приоритет источников access_days:

1. `tariffs.access_days` по `tariff_id` заказа
2. `purchase_snapshot.access_days` из order
3. дефолт клуба (Gorbova Club — 30 дней, если ничего нет)

`expected_access_until = paid_at + access_days` (с учётом extend-логики: при повторной покупке того же `tariff_id` подписка продлевается — суммируем окна последовательных оплат того же тарифа).

Сверить с:

- `subscriptions_v2.access_end_at` (если есть)
- `entitlements.expires_at` (если есть)

Если расчётный `expected_access_until > snapshot_at (2026-05-18T13:00Z)` — доступ должен быть активен.

**3. Реклассификация (новый verdict)**


| verdict                                         | условие                                                                                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revoke_confirmed`                              | нет active entitlement, нет active subscription, **нет** paid order с window, покрывающим snapshot                                                                        |
| `missing_platform_access_but_paid_order_exists` | есть paid order, который ДОЛЖЕН давать активный доступ на snapshot, но entitlement/subscription отсутствуют → **НЕ банить**, в DATA repair через `grant-access-for-order` |
| `access_active_by_paid_order_window`            | оплата покрывает window на дату snapshot → **НЕ банить**                                                                                                                  |
| `manual_review_refund_or_conflict`              | refund, partial_refund, upgrade, конфликт тарифов, несколько противоречивых заказов                                                                                       |


**4. Контрольный кейс — Екатерина Белозор / `zapponka1@gmail.com**`

Обязательно вывести отдельным блоком:

- список всех paid orders по Gorbova Club продуктам
- последнюю оплату (ожидаем 22.04.2026, 250 BYN)
- `tariff_id`, `access_days`, расчёт `expected_access_until`
- наличие/отсутствие entitlement/subscription
- объяснение причины попадания в revoke
- новый verdict из 4 категорий

**5. Итоговые таблицы (в proof и CSV)**

- `revoke_confirmed` (N)
- `do_not_revoke_access_repair_needed` (N)
- `do_not_revoke_active_by_paid_order` (N)
- `manual_review` (N)

Сумма = 13.

### Artifacts

- `.lovable/proofs/patch_tg_revoke_2a_payment_access_revalidation_2026_05.md`
- `/mnt/documents/patch_tg_revoke_2a_revalidated_candidates_2026_05.csv` (13 строк со всеми полями: orders, paid_at, access_days, expected_until, ent/sub, verdict)

### Запреты (hard stop)

- 0 INSERT в `telegram_access_queue`
- 0 вызовов Telegram API
- 0 вызовов `grant-access-for-order`
- 0 DML
- 0 изменений `subscriptions_v2` / `entitlements` / `access_rules` / `telegram_club_members`
- 0 изменений secrets

### DoD


| критерий                                                     | &nbsp; |
| ------------------------------------------------------------ | ------ |
| Для всех 13 кандидатов собраны paid orders                   | ☐      |
| Для каждого рассчитан expected access window                 | ☐      |
| Каждый получил новый verdict из 4 категорий                  | ☐      |
| Белозор разобрана отдельным блоком с расчётом                | ☐      |
| Сумма категорий = 13                                         | ☐      |
| Получены 4 итоговых числа: revoke / repair / active / manual | ☐      |
| Execute не запускался                                        | ☐      |


---

## Порядок дальнейших действий

1. **PATCH-TG-REVOKE-2A** (этот патч) — выполнить read-only ревалидацию.
2. По результатам — пересобрать окончательный revoke list (ожидаем << 13).
3. Параллельно открыть **PATCH-DATA-REPAIR-MISSING-ENT** для `missing_platform_access_but_paid_order_exists` кандидатов (отдельный approve, через canonical `grant-access-for-order`).
4. Только после 2А — отдельный approve на PATCH-TG-REVOKE-2 уже по очищенному списку.
5. PATCH-TG-REINVITE-1 (5 строк) и PATCH-UI-RESOLVER-F1-F2 — остаются в очереди, не блокируются 2А.

Execute ничего из вышеперечисленного — только после явного approve по каждому патчу отдельно.