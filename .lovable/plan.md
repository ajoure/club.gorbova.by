Да, согласен, с учетом правок:

&nbsp;

1. Fixture-данные не через schema migration.  
Не создавать test subscriptions миграцией. Это одноразовые runtime-фикстуры, значит нужен отдельный smoke SQL script / admin debug script / one-off seed, а не постоянная миграция, иначе тестовые строки останутся в истории развёртываний.
2. Fixture A для subscription-charge нельзя запускать с риском реального списания.  
Текущий вариант со stub payment_method_id слишком опасен и логически слабый.  
Добавь жёсткое правило:  

  - либо используется только sandbox/test-mode provider token, который гарантированно не спишет реальные деньги;
  - либо smoke для renew-path считается BLOCKED_SAFE_GUARD и не выполняется в prod/real billing environment.  
  Важное уточнение: просто «пусть упадёт с payment error» не годится как smoke renew-path, потому что это уже другой сценарий, и он не доказывает success-ветку extend.
3. &nbsp;
4. Для Fixture B обязательно изолировать другие active sources.  
Иначе subscriptions-reconcile может корректно вернуть skipped, а не revoked, из-за multi-source protection.  
Добавь в plan явный pre-check перед запуском:  

  - у test user нет других active entitlements / active subscriptions / manual club access, которые сохранят доступ;
  - это фиксируется в eligibility-proof отдельным блоком other_active_sources = 0.
5. &nbsp;
6. Cleanup нельзя делать через status='smoke_completed'.  
Такой статус, скорее всего, не входит в бизнес-словарь статусов и может сломать проверки.  
Замени cleanup на одно из двух:  

  - hard delete fixture rows по meta.smoke_fixture = 'v22.5', если это безопасно;
  - либо rollback в исходное валидное состояние с сохранением proof, без введения нового статуса.
7. &nbsp;
8. Для subscription-charge нужно развести 2 допустимых smoke-исхода.  
В proof явно зафиксируй:  

  - PASS-SUCCESS: renew/extend path реально отработал и создал ledger row extend;
  - BLOCKED_SAFE_GUARD: в окружении нельзя безопасно инициировать renew без риска реального списания.  
  Но FAILED payment не считать валидной заменой success-smoke для renew-path, если это не та ветка, которую вы хотите доказать.
9. &nbsp;
10. Для subscriptions-reconcile ожидаемый результат формулировать как revoked OR skipped, но только с доказательством причины.  
Если вышел skipped, proof обязан показать:  

  - какой именно active source сохранил доступ;
  - что executeRevoke() реально вызвался;
  - что ledger row всё равно записана корректно.
11. &nbsp;
12. Добавь отдельный proof по fixture lifecycle.  
Новый файл:  

  - .lovable/proofs/p0_runtime_fixture_lifecycle_proof.txt  
  В нём:
  - кто создан,
  - какими SQL/script-командами,
  - какие id,
  - какой meta.smoke_fixture,
  - чем и когда очищены,
  - подтверждение, что fixture не остались активными после smoke.
13. &nbsp;
14. Обнови финальный cutover guard.  
phase1_ledger_cutover_at разрешён только если:  

  - grant-access-for-order = PASS
  - subscriptions-reconcile = PASS
  - subscription-charge = PASS или BLOCKED_SAFE_GUARD с явно одобренным решением не тестировать renew в текущем окружении  
  Если хотите именно строгие 3/3 PASS, тогда это тоже надо зафиксировать отдельно и не подменять failed/blocked на pseudo-pass.
15. &nbsp;
16. Eligibility-proof должен быть add-only и числовым.  
Для каждого blocked path покажи не просто причину текстом, а таблицу:  

  - candidate id
  - gate name
  - expected value
  - actual value
  - excluded_by_gate = yes/no
17. &nbsp;

&nbsp;

&nbsp;

После этих правок план уже можно запускать.

# План: PATCH v22.5 — Close Runtime Gate for remaining 2 paths

## Цель

Закрыть runtime-proof для `subscription-charge` и `subscriptions-reconcile` контролируемыми fixture-кейсами. Создать eligibility-proof. Обновить smoke proof до 3/3 PASS (или зафиксировать FAIL).

## Диагностика: почему paths заблокированы

### subscription-charge

Eligibility gates (все должны пройти):

1. `next_charge_at <= endOfDay(APP_TZ)`
2. `status IN ('active','trial','past_due')`
3. `auto_renew = true`
4. `charge_attempts < 3`
5. `wasChargeAttemptedToday()` = false
6. `billing_type = 'provider_managed'` (иначе — MIT-disabled, не чарджится)
7. `payment_method_id IS NOT NULL`

Подписка `e53c5c45` отфильтрована gate #5 или #6 (already attempted / not provider_managed).

### subscriptions-reconcile

- Block 1 (cancel_at_passed): 0 подписок с `cancel_at < now() AND status != 'canceled'`
- Block 2 (trial_expired): `2130e4fc` найден, но `cancel_at IS NULL` → ledger не пишется (by design)
- Block 3 (access_end_at expired): 0 подписок с `access_end_at < dayStart AND status IN (active, past_due)`
- Block 4 (telegram sync): все telegram_access проверены через hasValidAccess → revoke skipped

## Шаги реализации

### Шаг 1. Создать `p0_runtime_candidate_eligibility_proof.txt`

Документирует для каждого blocked path:

- A. Какие кандидаты ожидались
- B. Какие eligibility-gates их отфильтровали (с конкретными значениями полей)
- C. Почему это BLOCKED_NO_ELIGIBLE_INPUT, а не FAIL

Секции:

- `subscription-charge`: gate analysis для `e53c5c45`, фикс `todayUtc → todayKey`
- `subscriptions-reconcile`: block-by-block analysis, trial `2130e4fc` cancel_at=NULL

### Шаг 2. Fixture A — subscription-charge:renew

Создать тестовую подписку через SQL migration:

- Новая строка в `subscriptions_v2` с:
  - `status = 'active'`
  - `next_charge_at = '2026-03-29'` (вчера — гарантированно due)
  - `auto_renew = true`
  - `charge_attempts = 0`
  - `billing_type = 'provider_managed'`
  - `payment_method_id` = привязать к существующему test payment method (или создать stub)
  - `user_id` = тестовый пользователь
  - `product_id` = существующий product
  - `tariff_id` = существующий tariff
- Пометить как `meta->>'smoke_fixture' = 'v22.5'` для идентификации

**Риск:** bePaid реально попытается списать. Если нет test-mode токена, charge упадёт с payment error → ledger row с `status='failed'`. Это допустимый smoke-результат — проверяем failed-contract вместо extended-contract.

### Шаг 3. Fixture B — subscriptions-reconcile (Block 1: cancel_at_passed)

Создать тестовую подписку через SQL migration:

- `status = 'active'`
- `cancel_at = '2026-03-29'` (вчера — гарантированно passed)
- `user_id` = тестовый пользователь
- `product_id` = существующий product
- Пометить `meta->>'smoke_fixture' = 'v22.5'`

Block 1 должен: обновить status → canceled, вызвать `executeRevoke()`, записать ledger row.

### Шаг 4. Invoke subscription-charge

```
POST /subscription-charge
Body: { "action": "process_renewals" }
```

Проверить ledger row с `source_event_key LIKE 'sub-renew:%'` и `created_at >= proof_started_at`.

Machine-check:

- `action_type` = `extend` или path к `failed`
- `status` = `extended` или `failed`
- `reason_code` = `subscription_renew`
- `target_type` = `subscription_tier`
- `source_subject_type` = `subscription`
- `result.post_check` (если extend) или `result.error_message` (если failed)

### Шаг 5. Invoke subscriptions-reconcile

```
POST /subscriptions-reconcile
Body: {}
```

Проверить ledger row с `source_event_key LIKE 'cron-reconcile:%'` и `created_at >= proof_started_at`.

Machine-check:

- `action_type` = `revoke` или `skip`
- `status` = `revoked` или `skipped`
- `reason_code` = `subscription_expired`
- `target_type` = `subscription_tier`
- `source_subject_type` = `subscription`
- `result.reconcile_basis` = `cancel_at_passed`

### Шаг 6. Обновить proof-файлы

1. `p0_ledger_runtime_smoke_proof.txt` — заменить BLOCKED на PASS/FAIL с фактическими строками
2. `p0_ledger_contract_validation_proof.txt` — добавить runtime rows
3. Проверить cutover guard: все 3 пути = PASS → можно двигаться дальше

### Шаг 7. Cleanup fixture rows

После smoke пометить fixture-подписки `status = 'smoke_completed'` или удалить через migration, чтобы не мешали production reconcile.

## Файлы


| Действие      | Файл                                                         |
| ------------- | ------------------------------------------------------------ |
| Создать       | `.lovable/proofs/p0_runtime_candidate_eligibility_proof.txt` |
| SQL migration | fixture subscriptions для smoke                              |
| Обновить      | `.lovable/proofs/p0_ledger_runtime_smoke_proof.txt`          |
| Обновить      | `.lovable/proofs/p0_ledger_contract_validation_proof.txt`    |


## STOP-guards

1. Нет eligibility-proof для blocked path → STOP
2. `phase1_ledger_cutover_at` при < 3 PASS → STOP
3. Fixture создаёт реальное списание в prod без test-mode → зафиксировать failed как допустимый smoke
4. После fixture path не пишет ledger row и нет eligibility explanation → FAIL