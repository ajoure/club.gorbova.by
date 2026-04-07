## да, согласен, с учетом правок:

&nbsp;

1. Не пиши в плане дедуплицированные victim-counts как финальные, пока не сделан **cross-path dedup** по profile_id/user_id/order_id. Сейчас у тебя есть дедуп внутри каждого path, но нет финального дедупа между admin_grant, admin_from_payment, admin_bulk. Поэтому вместо ~250 / ~235 зафиксируй формулировку:
  **«меж-path дедуп ещё не завершён, итоговое число уникальных жертв будет подтверждено отдельным after-proof»**.
2. По payments-reconcile раздели **active path** и **legacy path**.
  Сейчас у тебя они смешаны в одном блоке. Нужно явно написать:
  &nbsp;
  - **active reconcile path** — подлежит переводу на grant-access-for-order;
  - **legacy reconcile path** — не переводить автоматически без отдельного discovery по совместимости старых order/payment/link сущностей.
    Иначе подрядчик может “починить всё сразу” и сломать legacy-контур.
  &nbsp;
3. По bepaid-auto-process добавь жёсткое требование:
  после перевода на canonical flow **запрещено оставлять любой post-grant direct upsert в entitlements**, даже “на всякий случай”.
  Это ключевой риск: сейчас именно post-grant write перетирает canonical result.
4. Добавь отдельный **before/after grep-proof** по коду:
  &nbsp;
  - direct .from("subscriptions_v2").insert( / .upsert( в этих двух функциях;
  - direct .from("entitlements").insert( / .upsert( в этих двух функциях;
  - прямые решения по product_code в write-side.
    DoD без grep-proof не закрывать.
  &nbsp;
5. Добавь обязательный **runtime-proof dry-run** для обеих edge functions:
  &nbsp;
  - один кейс subscription product;
  - один кейс order_based_only product;
  - один кейс с bonus/product_access rule;
  - один кейс club side-effect.
    Недостаточно только code review.
  &nbsp;
6. В payments-reconcile зафиксируй отдельно, что должно сохраниться **без потерь**:
  &nbsp;
  - payment creation/update,
  - queue completion / retry semantics,
  - admin notifications,
  - audit trail,
  - telegram side-effects через canonical path, а не вторым вызовом.
    Это нужно вынести в отдельный mini-DoD блока, чтобы подрядчик не убрал нужные эффекты вместе с bypass.
  &nbsp;
7. По bepaid-auto-process добавь явную проверку, что после патча:
  &nbsp;
  - для is_subscription = true не создаются дубли entitlement;
  - для is_subscription = false доступ тоже проходит через grant-access-for-order;
  - entitlement_orders не становится вторым источником истины по доступу.
    Сейчас это не дожато.
  &nbsp;
8. В блоке victim-counts раздели:
  &nbsp;
  - **historical victims total**,
  - **currently active victims**,
  - **currently harmful victims**.
    Потому что отсутствие entitlement у уже истёкшего доступа и отсутствие entitlement у активного доступа — это разные по приоритету дефекты.
  &nbsp;
9. В DoD добавь жёстко:
  &nbsp;
  - **UI root-fix = completed**
  - **Edge root-fix = completed only when both functions patched, deployed, dry-run proved**
  - **Full root closure forbidden until edge paths no longer bypass canonical flow**
  - **Backfill не входит в этот патч и идёт отдельным следующим шагом**
    Это важно, чтобы не было ложной формулировки “root cause fixed”.
  &nbsp;
10. В артефакты добавь ещё 2 файла:

&nbsp;

&nbsp;

&nbsp;

- edge_write_bypass_inventory.csv — полный список bypass-точек по строкам/операциям/таблицам;
- edge_canonical_migration_proof.csv — до/после по каждой функции: что писалось напрямую раньше и что теперь идёт через grant-access-for-order.

&nbsp;

&nbsp;

&nbsp;

11. Формулировку про 0 reconciliation path / 0 bepaid_auto path уточни. Это не значит, что path безопасен; это значит только:
  **«на текущем active sweep не найдено активных жертв, но bypass в коде существует и остаётся риском»**.
  Иначе звучит как будто проблем там нет.
12. В конце плана явно добавь следующий шаг после этого патча:
  **отдельный backfill/discovery sprint по historical victims**, уже после deploy и подтверждения, что новые жертвы больше не создаются.

&nbsp;

&nbsp;

План: Discovery-патч edge-function write-paths + обновление отчёта с дедуплицированными victim-counts

---

### Суть

Два edge-function пути (`payments-reconcile`, `bepaid-auto-process`) продолжают писать subscriptions/entitlements в обход canonical fulfillment. Нужен детальный discovery каждого, dry-run миграционный план и обновление отчёта с честными дедуплицированными цифрами.

---

### БЛОК 1: payments-reconcile — discovery bypass-точек

**Найденные direct writes (из кода):**


| Строка  | Операция      | Таблица                          | Что теряется vs canonical                                                                                         |
| ------- | ------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 532-546 | Direct INSERT | `subscriptions_v2`               | Нет `access_rules` resolution, нет `access_rule_id` в meta                                                        |
| 558-569 | Direct UPSERT | `entitlements`                   | По `product_code` (не product_id), нет `access_rule_id`, UPSERT by `user_id,product_code` может перетереть данные |
| 574-578 | Direct invoke | `telegram-grant-access`          | Дублирует side-effect, который canonical flow уже делает                                                          |
| 702-717 | Direct INSERT | `subscriptions_v2` (legacy path) | Та же проблема + legacy order без FK                                                                              |
| 736-746 | Direct UPSERT | `entitlements` (legacy path)     | По `product_code`, без order_id FK                                                                                |


**Ключевые дефекты:**

- Entitlement создаётся по `product_code` (text matching), а не по `product_id` (UUID) — нарушение id-first contract
- Нет вызова `grant-access-for-order` → нет resolution access_rules → нет бонусных/условных доступов
- UPSERT by `user_id,product_code` может перезаписать entitlement от другого order

**Исторические жертвы:** 3 subscription с source `reconciliation_legacy`. Активных жертв 0 (по текущим данным reconcile path не создавал массовых записей).

**Safe migration plan:**

1. В `fixOrderAndCreateSubscription`: после `UPDATE orders_v2 SET status='paid'` — вызвать `grant-access-for-order` с `orderId`
2. Удалить весь блок прямого INSERT subscription (строки 507-546) и прямого UPSERT entitlement (строки 548-569)
3. Удалить дублирующий telegram-grant-access (строки 572-579) — canonical flow сам вызывает
4. Legacy path (`processLegacyQueueItem`): оставить как есть (исторический, legacy orders не совместимы с grant-access-for-order), но добавить audit warning
5. Dry-run: вызвать функцию с `execute: false` и проверить, что все pending orders корректно матчатся

**Side-effects, которые нельзя потерять:**

- Telegram notification admins (строки 595-626) — сохранить
- Queue item completion (строки 477-484) — сохранить
- Payment record creation (строки 458-469) — сохранить (это до fulfillment)

---

### БЛОК 2: bepaid-auto-process — discovery bypass-точек

**Найденные direct writes:**


| Строка   | Операция                         | Таблица              | Проблема                                                                                    |
| -------- | -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| 821-835  | `grant-access-for-order`         | —                    | ✅ Canonical, НО только если `mapping.is_subscription && profileUserId`                      |
| 838-900+ | Direct INSERT/UPDATE             | `entitlements`       | ❌ Выполняется ВСЕГДА после grant-access, дублирует/перетирает entitlement по `product_code` |
| —        | Direct entitlement_orders INSERT | `entitlement_orders` | Параллельно с canonical flow — потенциальный конфликт                                       |


**Ключевой дефект:**

- Строки 821-835: grant-access-for-order вызывается **только для подписок** (`is_subscription`)
- Строки 838-900: **после** grant-access всё равно идёт direct entitlement upsert по `product_code` — дублирует то, что canonical flow уже сделал, и может перетереть `access_rule_id`
- Для не-подписочных продуктов (`!is_subscription`): grant-access НЕ вызывается вообще, entitlement создаётся напрямую

**Исторические жертвы:** `reconcile_source = 'bepaid_auto'` — 0 orders в текущей БД (функция не запускалась массово или пока не создала записей через этот путь).

**Safe migration plan:**

1. Убрать весь блок direct entitlement write (строки 838-950+)
2. Расширить вызов `grant-access-for-order` на ВСЕ случаи (не только `is_subscription`): после создания order+payment → всегда вызывать canonical fulfillment
3. Сохранить entitlement_orders link как post-step (или перенести в grant-access-for-order)
4. Dry-run: запустить с `dryRun: true` и проверить маппинг

---

### БЛОК 3: Обновление victim-counts с дедупликацией

**Дедуплицированные данные из БД:**


| Write path                                       | Total orders | Unique profiles | Missing entitlement (by order) | Unique profiles missing |
| ------------------------------------------------ | ------------ | --------------- | ------------------------------ | ----------------------- |
| ContactDetailSheet (admin_grant)                 | 19           | 17              | 15                             | 14                      |
| CreateDealFromPaymentDialog (admin_from_payment) | 211          | 137             | 190                            | 126                     |
| BulkCreateDealsDialog (admin_bulk)               | 431          | 131             | 422                            | 129                     |
| **ИТОГО UI paths**                               | **661**      | **~250***       | **627**                        | **~235***               |


*дедуп cross-path не выполнен, реальное число уникальных profiles может быть меньше*

**Active subscriptions без entitlement (текущий sweep):**

- 10 bulk_grant (модуль ИП) — content product, need separate check
- 7 unknown source — mixed (3 тестовых, 1 club, 1 ЗАКРОЙ ГОД, 1 модуль, 1 ЦБ2)
- 0 reconciliation path
- 0 bepaid_auto path

**Repaired:** Матук (1 entitlement created). Остальные — 0.

---

### БЛОК 4: Обновление plan.md и артефактов

**Изменения в plan.md:**

- Добавить БЛОК: Edge-function discovery для payments-reconcile и bepaid-auto-process
- Обновить victim-counts с дедупликацией
- Добавить explicit status: `UI root-fix = completed`, `Edge root-fix = pending`
- Уточнить: payments-reconcile имеет 5 bypass-точек, bepaid-auto-process имеет 2 bypass-точки (1 partial canonical + 1 full bypass)

**Новые артефакты:**

- Обновить `write_paths_root_fix_status.csv` с victims_count deduped
- Обновить `repair_actions_by_defect_type.csv`

**DoD (жёсткий):**

- `grant-access-for-order` = единственный canonical write-path
- Новые victim-кейсы из UI = 0 (доказано code review)
- Новые victim-кейсы из edge paths = 0 только после system patch
- Historical backfill выполнен и доказан (before/after counts)

### Объём изменений

**Код (edge functions):**

- `supabase/functions/payments-reconcile/index.ts` — удалить direct INSERT sub + UPSERT entitlement из `fixOrderAndCreateSubscription`, заменить на вызов `grant-access-for-order`
- `supabase/functions/bepaid-auto-process/index.ts` — удалить direct entitlement block (строки 838-950+), расширить grant-access-for-order на все случаи (не только is_subscription)

**Документация:**

- `.lovable/plan.md` — обновить статусы и victim-counts
- `/mnt/documents/write_paths_root_fix_status.csv` — обновить

**Данные:** никаких INSERT/UPDATE в этом патче — только code fix. Backfill выполняется отдельным следующим шагом после deploy + dry-run.

### Порядок исполнения

1. Code fix payments-reconcile
2. Code fix bepaid-auto-process
3. Deploy обеих функций
4. Dry-run test каждой
5. Обновить plan.md и артефакты
6. Backfill — отдельный следующий шаг