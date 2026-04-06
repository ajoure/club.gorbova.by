да, согласен, с учетом правок:

&nbsp;

1. Зафиксируй execute-scope как immutable список из 13 subscription_id  
Во время execute не делать повторный “живой” отбор по условиям.  
Сначала сохранить exact scope в 18_patch2_before_missing_entitlement.csv, и далее INSERT выполнять только по этим 13 ID.
2. Усиль duplicate guard  
Проверять NOT EXISTS не только по user_id + product_id, но и дополнительно по user_id + product_code для active/trial entitlements.  
Это важно, чтобы не создать дубль в кейсе, если уже есть legacy/null-product entitlement с тем же product_code.
3. Явно зафиксируй ожидаемый post-state  
После execute должно быть не просто “safe scope = 0”, а:  

  - missing_entitlement по 13 safe = 0
  - глобально missing_entitlement = ровно 4
  - эти 4 — только:  

    - 2130e4fc
    - 64c68953
    - 52af34ae
    - 1703a459
  - &nbsp;
4. &nbsp;
5. Добавь idempotency-guard  
Если патч запускается повторно, результат должен быть:  

  - created = 0
  - skipped_duplicate_guard = 13
  - без новых insert  
  Это нужно отдельно проверить и отразить в финальном отчёте как свойство безопасного повторного запуска.
6. &nbsp;
7. Не использовать никаких inferred полей вне SoT  
Для INSERT брать только:  

  - user_id из subscriptions_v2
  - product_id из subscriptions_v2
  - product_code из products_v2
  - order_id из subscriptions_v2
  - expires_at = subscription.access_end_at  
  Никаких попыток восстанавливать что-либо из purchase_snapshot, email, имени, UI.
8. &nbsp;
9. Расширь audit_logs meta  
Помимо subscription_id, entitlement_id, user_id, product_id, product_code, batch_id, добавь:  

  - subscription_access_end_at
  - order_id
  - duplicate_guard_result
  - execution_scope='patch2-safe-13'  
  Это упростит последующую сверку.
10. &nbsp;
11. Добавь machine-check на scope leakage по INSERT  
Отдельной проверкой докажи:  

  - новых entitlements создано ровно 13
  - все 13 принадлежат exact target subscription_id
  - вне target 13 новых entitlements = 0
12. &nbsp;
13. Финальный отчёт сделай в двух разрезах  
Отдельно показать:  

  - created / excluded / duplicate_guard / errors
  - список created entitlement_id ↔ source subscription_id
  - список 4 excluded с причинами
  - глобальный diff bucket’ов до/после
14. &nbsp;
15. Формулировку STOP-guard уточни  
Вместо “НЕ трогать cb_module_* NULL product_id” напиши точнее:  
не трогать deferred legacy entitlements с NULL product_id; создание новых entitlements для safe subscriptions cb_module_ip разрешено в scope PATCH 2.  
Иначе формулировка сейчас двусмысленная.
16. Артефакт сверки дублей добавь отдельно  
Добавь 25_patch2_duplicate_guard_proof.csv:

&nbsp;

&nbsp;

&nbsp;

- subscription_id
- user_id
- product_id
- product_code
- existing_active_entitlement_by_product
- existing_active_entitlement_by_code
- guard_result

&nbsp;

&nbsp;

После этих правок план можно исполнять.

&nbsp;

## План: PATCH-MISSING-ENTITLEMENTS-EXECUTE-SAFE

### Discovery результат (post-PATCH1 baseline)

Свежий запрос показал **17 active/trial subscriptions без entitlement** — ровно столько же, сколько было в v2 audit. Но sub-классификация выявила **неоднородность**, которая требует разделения scope.

### Sub-классификация 17 missing_entitlement


| Категория                   | Count | Subscription IDs                                                                                   | Причина                                                                                                                                                                 |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **safe: cb_module_ip**      | 10    | 4b930e75, 982843b3, 31930c10, 72fec27f, 0c3abfab, b1a6311e, 40e7faa6, b0086876, 087bb790, a0d29127 | Продукт существует (ea98d043), другие пользователи с тем же продуктом уже имеют entitlements, product_code и product_id однозначны, access_end_at = 2026-06-25 (future) |
| **safe: buh_business**      | 1     | 052126fb                                                                                           | order_id=c015c84a, product_id=85046734, future access                                                                                                                   |
| **safe: course_close_year** | 1     | 0c999415                                                                                           | order_id=0bb9ee3f, product_id=73c29914, future access                                                                                                                   |
| **safe: prd_0d01a2fdc477**  | 1     | be19fa2e                                                                                           | product_id=87a8870f, access_end_at=2026-08-30 (future)                                                                                                                  |
| **excluded: expired trial** | 1     | 2130e4fc                                                                                           | club, status=trial, access_end_at=**2026-03-12** (истёк 24 дня назад). Создавать entitlement для истёкшего trial бессмысленно                                           |
| **excluded: test product**  | 3     | 64c68953, 52af34ae, 1703a459                                                                       | product_code=prd_3318c30fdf2c, name="Тестовый продукт для админов". Админские тестовые данные                                                                           |


### STOP-guard: scope ≠ 17

По условиям PATCH-листа: "если fresh count missing_entitlement ≠ ожидаемому — STOP". Count = 17, совпадает. Но **безопасный scope = 13**, а не 17, потому что:

- 1 stale trial с истёкшим доступом — создание entitlement не имеет смысла и нарушает SoT (entitlement с будущим expires_at при expired подписке)
- 3 тестовых продукта — не production-данные

**Решение**: execute по **13 строкам**. 4 excluded — зафиксировать в отчёте с причинами.

### Порядок выполнения

1. **Before-snapshot** → `18_patch2_before_missing_entitlement.csv` (все 17 строк с sub-классификацией)
2. **Duplicate guard**: для каждого из 13 target user_id + product_id проверить NOT EXISTS active/trial entitlement
3. **Execute**: INSERT 13 entitlements:
  - `user_id` = из subscription
  - `product_id` = из subscription
  - `product_code` = из products_v2
  - `order_id` = из subscription (если есть)
  - `expires_at` = subscription.access_end_at
  - `status` = 'active'
  - `meta` = `{source: 'subscription_remediation', subscription_id, batch_id: 'patch2-missing-ent-2026-04-05', plan_name: 'PATCH-MISSING-ENTITLEMENTS-EXECUTE-SAFE'}`
4. **Audit logging**: 13 записей в audit_logs
  - `action` = 'entitlement.created_from_subscription_remediation'
  - `actor_type` = 'system'
  - `actor_label` = 'PATCH-MISSING-ENTITLEMENTS-EXECUTE-SAFE'
  - `meta`: subscription_id, entitlement_id, user_id, product_id, product_code, batch_id
5. **After-snapshot + verification**:
  - `19_patch2_execution_results.csv` (13 created + 4 excluded с причинами)
  - `20_patch2_after_subscription_classification.csv` (повторная классификация)
  - `21_patch2_created_entitlements.csv` (только созданные)
  - `22_patch2_audit_logs.csv`
  - `23_patch2_diff_summary.csv`
  - `24_patch2_final_report.md`

### Данные для 13 target INSERT


| #   | subscription_id | user_id  | product_id | product_code      | order_id | expires_at          |
| --- | --------------- | -------- | ---------- | ----------------- | -------- | ------------------- |
| 1   | 052126fb        | 341e6f46 | 85046734   | buh_business      | c015c84a | 2026-05-05 21:59:59 |
| 2   | 0c999415        | 17b35d62 | 73c29914   | course_close_year | 0bb9ee3f | 2026-05-01 21:59:59 |
| 3   | be19fa2e        | 539ea1b3 | 87a8870f   | prd_0d01a2fdc477  | NULL     | 2026-08-30 23:59:59 |
| 4   | 4b930e75        | a1dc94b8 | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 5   | 982843b3        | 7d82bafe | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 6   | 31930c10        | 722f0e30 | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 7   | 72fec27f        | 73d79b29 | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 8   | 0c3abfab        | b1bcc844 | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 9   | b1a6311e        | c34b515c | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 10  | 40e7faa6        | 6112b4d0 | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 11  | b0086876        | 4ffb8977 | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 12  | 087bb790        | deaa83d1 | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |
| 13  | a0d29127        | eba22d2e | ea98d043   | cb_module_ip      | NULL     | 2026-06-25 06:56:49 |


### Явные исключения


| subscription_id | Причина исключения                                          |
| --------------- | ----------------------------------------------------------- |
| 2130e4fc        | club trial, access_end_at=2026-03-12 (expired 24 дня назад) |
| 64c68953        | prd_3318c30fdf2c = "Тестовый продукт для админов"           |
| 52af34ae        | prd_3318c30fdf2c = "Тестовый продукт для админов"           |
| 1703a459        | prd_3318c30fdf2c = "Тестовый продукт для админов"           |


### STOP-guards

- НЕ трогать существующие entitlements (только INSERT новых)
- НЕ создавать entitlements для excluded (4 строки)
- Duplicate guard: NOT EXISTS active/trial entitlement по user_id + product_id
- НЕ трогать valid_rule_based_bonus, illegal_bonus_access, drift, cb_module_* NULL product_id
- Никаких UPDATE/DELETE

### Machine-check DoD


| Проверка                                       | Ожидание                  |
| ---------------------------------------------- | ------------------------- |
| Строк в dry-run                                | 17 (13 safe + 4 excluded) |
| Created                                        | 13                        |
| Skipped (excluded)                             | 4                         |
| Skipped (duplicate guard)                      | 0                         |
| missing_entitlement после execute (safe scope) | 0 из 13                   |
| Новых NULL product_id                          | 0                         |
| Новых дублей (user_id + product_id)            | 0                         |
| audit_logs count                               | 13                        |
| Существующие entitlements изменены             | 0                         |


### Технические детали

- Python-скрипт через code--exec
- INSERT через insert tool (не migration)
- Все артефакты в `/mnt/documents/access_audit/`