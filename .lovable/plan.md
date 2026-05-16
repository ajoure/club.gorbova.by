да, согласен, с учетом правок:

1. **Backup-таблицы убрать из этого плана или вынести в отдельную migration-approval.**  
Сейчас в запретах стоит `0 migrations`, но план создаёт:

```text
subscriptions_v2_repair_backup_h3x_b_a_2026_05
entitlements_repair_backup_h3x_b_a_2026_05
```

Это схема/миграция. Для текущего шага лучше:

```text
Before-snapshot хранить в proof + audit before/after JSON.
Новые backup-таблицы не создавать.
```

2. **Rollback переписать без backup-таблиц.**  
Rollback должен быть сгенерирован из before-snapshot в proof:

```sql
UPDATE subscriptions_v2
SET status = '<before>',
    auto_renew = <before>,
    access_end_at = '<before>',
    meta = '<before_json>'::jsonb
WHERE id = '<sub_id>';

UPDATE entitlements
SET expires_at = '<before>',
    meta = '<before_json>'::jsonb
WHERE id = '<ent_id>';
```

3. **Разделить план на два этапа.**

```text
Stage 1 — dry-run only:
- SELECT;
- dry-run table;
- planned SQL;
- rollback SQL;
- DML=0.

Stage 2 — execute:
- только после отдельного approve;
- транзакционный SQL;
- verify.
```

Сейчас разрешать можно только **Stage 1 dry-run**.

4. **Уточнить, что это approved data-repair, а не canonical writer.**  
Здесь будут прямые UPDATE в `subscriptions_v2` и `entitlements`, поэтому добавить:

```text
Это отдельный approved data-repair duplicate subscriptions, не grant-access-for-order.
```

5. **Исправить поля в** `meta`**.**  
Использовать фактическое поле:

```text
meta.source_subscription_v2_id
```

Не создавать новый alias:

```text
meta.source_subscription_id
```

6. **Убрать** `external_subscription_id`**.**  
Ранее подтверждено фактическое поле:

```text
provider_subscription_id
```

Если где-то поле отсутствует — помечать `field_missing`.

7. `Глобальный COUNT active duplicate-пар ≠ 7` **— это preflight STOP, не transaction rollback.**  
Формулировка:

```text
Перед execute проверить COUNT=7. Если не 7 — execute не начинать.
```

8. `status='superseded'` **проверить в dry-run.**  
До execute подтвердить, что статус уже используется/поддерживается UI и логикой. Если нет — STOP.
9. `updated_at` **зафиксировать.**  
Добавить в planned SQL:

```text
updated_at = now()
```

для изменяемых `subscriptions_v2` и `entitlements`, если это принято в проекте. Если не принято — явно указать, что `updated_at` не меняется.

10. **Транзакционный механизм описать точно.**  
Если execute будет SQL, указать:

```sql
BEGIN;
...
COMMIT;
```

Если через Edge/RPC — отдельный план. Не писать “одной транзакцией”, если это не подтверждено механизмом выполнения.

11. **DoD поправить: Cluster B — это 2 пары, не 3.**

```text
0 изменений по Cluster B: P5, P7.
```

12. **Команда на текущий шаг:**

```text
Выполни только Stage 1 — dry-run read-only по H3.x-b-execute-A.

Запрещено:
- создавать backup-таблицы;
- выполнять UPDATE/INSERT/DELETE;
- писать audit;
- менять subscriptions_v2 / entitlements;
- трогать Cluster B;
- включать mode=on.

В proof дай:
- before-snapshot;
- dry-run table;
- planned SQL;
- rollback SQL из before-snapshot;
- STOP-guards;
- rowcount expectations.

Execute не запускать без отдельного approve.
```

После этих правок план можно запускать как **dry-run only**.

&nbsp;

План: H3.x-b-execute-A — local duplicate subscriptions cleanup

## Контекст

- H3.x-a (root-fix `subscription-conflict`) задеплоен и подтверждён.
- H3.x-b dry-run и H3.x-b2 классификация закрыты: 7 active duplicate-пар, root-fix не нарушен.
- Этот план закрывает только Cluster A: **P1, P2, P3, P4, P6** — local MIT / race / admin_grant duplicates без active provider subscription.
- Cluster B (**P5, P7**, provider-managed legacy) — отдельный план H3.x-b-execute-B, не трогаем.

## Scope (строго)

In-scope пары (5):


| #   | subscription_v2_id (canonical) | subscription_v2_id (duplicate) | source                                            |
| --- | ------------------------------ | ------------------------------ | ------------------------------------------------- |
| P1  | 1b68252b…                      | …                              | race_condition_B1 / mit                           |
| P2  | 3c6d812a…                      | …                              | race_condition_B1 / mit                           |
| P3  | 7261e727…                      | …                              | race_condition_B1 (один order_id, 2 sub за 2 мин) |
| P4  | …                              | …                              | admin_manual (admin_grant double-click)           |
| P6  | …                              | …                              | admin_manual (admin_grant double-click)           |


Out-of-scope: P5, P7, любые другие пары — STOP plan и эскалация.

## Запреты

- Никаких вызовов provider API (bePaid cancel/get/update).
- Никаких telegram-grant / telegram-revoke / queue insert.
- Никаких изменений в `orders_v2`, `payments_v2`, `provider_subscriptions`, `access_rules`, `telegram_access`.
- Никаких migrations.
- Не менять `BEPAID_REBILL_MATERIALIZATION` (остаётся `dry_run`).
- `mode=on` не включается.
- Никаких edge-function deploy.

## Действия (только при approve на execute)

Для каждой пары:

1. Определить canonical и duplicate согласно canonical-chain из H3.x-b dry-run (provider safety > GREATEST(access_end_at) > paid_orders_count > updated_at).
2. `subscriptions_v2` (duplicate row):
  - `status = 'superseded'`
  - `auto_renew = false`
  - `meta.superseded_by = canonical_id`
  - `meta.superseded_reason = 'h3x_b_execute_a_local_duplicate_cleanup'`
  - `meta.repair_batch = 'H3X-B-EXECUTE-A-2026-05'`
3. `subscriptions_v2` (canonical row):
  - `access_end_at = GREATEST(canonical.access_end_at, duplicate.access_end_at)` — НИКОГДА не снижаем.
  - `meta.extended_by_orders` = merge dedup union(canonical, duplicate).
  - `meta.merged_from = [duplicate_id]` (append).
  - `meta.repair_batch = 'H3X-B-EXECUTE-A-2026-05'`.
  - Другие поля canonical (`status`, `auto_renew`, `next_charge_at`, `provider_subscription_id`, `external_subscription_id`) НЕ трогаем.
4. `entitlements` (если активный entitlement привязан к duplicate ИЛИ его `expires_at < canonical.access_end_at`):
  - `expires_at = GREATEST(current, canonical.access_end_at)` — только UP, никогда DOWN.
  - При смене источника — `meta.source_subscription_id = canonical_id`, `meta.repair_batch = 'H3X-B-EXECUTE-A-2026-05'`.
  - Если align не требуется — НЕ трогаем строку.
5. `audit_logs` (одна строка на действие):
  - `actor_type='system'`, `actor_user_id=NULL`, `actor_label='h3x-b-execute-a-2026-05'`.
  - `action ∈ {repair.h3x_b_a.subscription_superseded, repair.h3x_b_a.subscription_merged, repair.h3x_b_a.entitlement_aligned}`.
  - `meta`: `{ batch_id, pair_code, canonical_id, duplicate_id, user_id, product_id, tariff_id, before, after, rule }`.

Всё выполняется одной транзакцией на пару с rowcount-guards (expected vs actual). Любой mismatch → RAISE EXCEPTION → откат.

## Before-snapshot (обязательно)

Backup-таблицы (RLS deny authenticated, доступ только service_role):

- `subscriptions_v2_repair_backup_h3x_b_a_2026_05` — обе строки пары (canonical + duplicate).
- `entitlements_repair_backup_h3x_b_a_2026_05` — все активные entitlements обоих user/product (для каждой пары).

Каждый backup row помечается `batch_id='H3X-B-EXECUTE-A-2026-05'`. Snapshot создаётся ДО любых UPDATE в той же транзакции.

## Dry-run table (в proof, до execute)

Колонки:

`pair | user | product | tariff | canonical_id | duplicate_id | canonical.access_end_at | duplicate.access_end_at | new_access_end_at | greatest_changed | entitlement_id | ent.expires_at_before | ent.expires_at_after | ent_changed | provider_sub_exists_either_side | risk | verdict`

`verdict ∈ {ready_for_execute, manual_review, defer}`. Execute только если **все 5 = `ready_for_execute**`.

## STOP-guards (hard stop, откат транзакции)

- У любой строки пары есть запись в `provider_subscriptions` со `state ∈ ('active','pending')`.
- `new_access_end_at < canonical.access_end_at` ИЛИ `new_access_end_at < duplicate.access_end_at`.
- Любой `entitlement.expires_at_after < expires_at_before`.
- В `orders_v2` / `payments_v2` найдена неоднозначная связь (paid order без линковки ни к canonical, ни к duplicate; или линковка к третьей подписке).
- `external_subscription_id` различается между canonical и duplicate и обе непустые.
- `installment_payments` со `status='pending'` у любой стороны.
- `access_rules` ссылается на duplicate_id.
- В выборку попадает не P1/P2/P3/P4/P6.
- Глобальный COUNT active duplicate-пар ≠ 7.

## Rollback

Idempotent SQL (отдельный блок в proof):

```sql
-- subscriptions_v2
UPDATE subscriptions_v2 s
SET status = b.status,
    auto_renew = b.auto_renew,
    access_end_at = b.access_end_at,
    meta = b.meta
FROM subscriptions_v2_repair_backup_h3x_b_a_2026_05 b
WHERE s.id = b.sub_id AND b.batch_id = 'H3X-B-EXECUTE-A-2026-05';

-- entitlements
UPDATE entitlements e
SET expires_at = b.expires_at, meta = b.meta
FROM entitlements_repair_backup_h3x_b_a_2026_05 b
WHERE e.id = b.ent_id AND b.batch_id = 'H3X-B-EXECUTE-A-2026-05';
```

`audit_logs` строки rollback-batch добавляются отдельно (не удаляем audit, добавляем `repair.h3x_b_a.rolled_back`).

Provider state восстанавливать не требуется — provider API не вызывался.

## Verify (после execute)

Для каждой пары:

1. `duplicate.status = 'superseded'`, `auto_renew=false`, `meta.superseded_by = canonical_id`.
2. `canonical.access_end_at >= MAX(before.canonical, before.duplicate)`.
3. `canonical.meta.extended_by_orders` ⊇ union(before).
4. Все relevant `entitlements.expires_at` не уменьшились.
5. `telegram_access`, `provider_subscriptions`, `orders_v2`, `payments_v2` — diff = 0.
6. backup rows count = 2 sub + N ent на пару, audit rows count = ожидаемому.
7. Глобальный `SELECT count(*)` active duplicate-пар: было 7 → стало 2 (P5, P7).

## DoD

- 5 пар обработаны, 0 STOP-нарушений.
- Production DML = только описанный UPDATE/INSERT по subscriptions_v2/entitlements/audit_logs/backup-таблицам.
- 0 migrations.
- 0 provider/telegram/grant вызовов.
- 0 изменений в orders_v2/payments_v2/provider_subscriptions/access_rules.
- `BEPAID_REBILL_MATERIALIZATION=dry_run` не менялся.
- `mode=on` не включался.
- 3 пары Cluster B (P5, P7 — и любые out-of-scope) не тронуты.
- Proof заполнен.

## Proof

`.lovable/proofs/h3x_duplicate_subscriptions_execute_a_2026_05.md`

Структура: scope check (count=7), per-pair before-snapshot, dry-run table, STOP-guards check, planned SQL per pair, rollback SQL, (после approve) execute rowcount guards, verify table, audit excerpt, DoD checklist.

## Backlog (зафиксировать отдельно, вне этого плана)

- **ISSUE-AG-DOUBLECLICK** — `admin_grant` нуждается в debounce/idempotency-ключе (источник P4, P6).
- **ISSUE-WEBHOOK-META-OVERWRITE** — bepaid-webhook должен апдейтить meta только по matching `provider_subscription_id`, не по (user_id, product_id) wide-match (источник P5, P7 — relevance для Cluster B).

## Что НЕ делает этот план

- Не трогает Cluster B (P5, P7) — отдельный H3.x-b-execute-B.
- Не запускает execute. Только готовит dry-run table + rollback в proof.
- Не включает mode=on. До mode=on требуется: execute-A done → execute-B done → H4 preconditions.

## Команда на следующий шаг

После approve этого плана:

1. Собрать per-pair snapshot и dry-run table в proof (read-only).
2. Остановиться. Ждать отдельного approve `H3.x-b-execute-A: run execute`.
3. Только после второго approve — выполнить транзакционный execute с rowcount guards.