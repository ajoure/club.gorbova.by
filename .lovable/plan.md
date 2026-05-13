да, согласен, с учетом правок:

1. До Execute обязательно приложить dry-run таблицу по 3 sub_id: bucket, age_hours, pull_result, planned_action.
2. Execute делать только по строкам, где после pull provider всё ещё expired/redirecting/dead.
3. В audit обязательно писать:
  - sub_id
  - provider_subscription_id
  - before
  - after
  - pull_result
  - bucket
  - age_hours
4. Финальный verify:
  - SOT count = 0
  - отдельно подтвердить, что access_end_at, entitlements, Telegram-доступы не менялись.
5. Если хотя бы одна подписка после pull окажется живой — её не закрывать, а вынести отдельной строкой pull_alive_skip.

&nbsp;

## План: INV-22 разбор 3 зомби-подписок

### Контекст

Детектор подтверждён через `inv22_subscription_desync` SOT-запрос. Найдено ровно 3 строки, совпадают с алертом:


| sub_id (short) | provider_sub     | bucket                    | age_hours | access_end_at |
| -------------- | ---------------- | ------------------------- | --------- | ------------- |
| 727c05bf…      | sbs_d522c09a6105 | never_charged_expired     | 1675ч     | 2026-05-30    |
| 555a69bb…      | sbs_9e596dfe6f8c | never_charged_expired     | 236ч      | 2026-05-27    |
| b1676866…      | sbs_cf5b0c60c895 | never_charged_redirecting | 159ч      | 2026-06-05    |


Все три подходят под канон `mem://commercial-logic/subscriptions/inv22-desync-resolution`:

- два `expired` — без grace;
- один `redirecting` с возрастом **159ч > 48ч** — grace пройден, eligible.

### Действия (Diagnose → Plan → Dry run → Execute → Verify)

**1. Dry-run (read-only)**  
Вызвать `system-health-inv22-plan` (super_admin JWT) на все 3 `sub_id`. Зафиксировать в отчёте:

- `action` per row (ожидается `pull_then_close` для всех трёх),
- `bepaid-get-subscription-details` pull-результат каждой подписки,
- если bePaid после pull вернёт живую подписку — НИЧЕГО не делаем по этой строке (re-read правило).

**2. Execute (только по тем, кто после pull всё ещё мёртв)**  
Вызвать `system-health-inv22-resolve` с `confirm: true` и явным списком `subscription_ids`. На каждую строку:

- `subscriptions_v2`: `auto_renew=false`, `status='canceled'`, `canceled_at=now()`, `cancel_reason='inv22_provider_dead_local_active'`.
- `provider_subscriptions.state` — НЕ перезаписываем (provider = SoT).
- `access_end_at` и Telegram-доступ — НЕ трогаем (отдельное решение владельца).
- Audit: `inv22.repair_provider_dead_local_active` с `before/after/pull_result/bucket/age_hours`.

**3. Verify (DoD)**  
Повторить SOT-запрос:

```sql
SELECT count(*) FROM subscriptions_v2 s
JOIN provider_subscriptions ps ON ps.subscription_v2_id = s.id
WHERE s.status='active' AND s.auto_renew=true AND s.access_end_at > now()
  AND (ps.state IN ('expired','redirecting')
       OR (ps.state='active' AND ps.next_charge_at IS NULL AND ps.last_charge_at IS NULL));
```

Должен вернуть `0` или меньше с обоснованием по каждой оставшейся (`pull_alive` / `skip_too_fresh`).

### Запрещено (per канон)

- Прямые `UPDATE provider_subscriptions SET state=...`.
- Авто-revoke Telegram / entitlements / `access_end_at`.
- Bulk-execute без `confirm:true` или без явного списка `subscription_ids`.

### Что не входит в план

- Никаких code/schema-изменений: вся инфраструктура (`system-health-inv22-plan`, `system-health-inv22-resolve`, `Inv22ResolverPanel`) уже задеплоена и подтверждена в memory.
- Это разовый operational run строго по существующему protocol.

### Отчёт по итогам

- Список 3 sub_id с outcome (`repaired` / `pull_alive` / `skip`).
- Запросы audit_logs по `inv22.repair_provider_dead_local_active`.
- Финальный count = 0 (или объяснение остатка).
- Подтверждение, что `access_end_at` и Telegram у этих 3 пользователей не изменились.