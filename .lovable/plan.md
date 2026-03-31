# да, согласен, с учетом правок:

&nbsp;

1. **Исправь арифметику в общем итоге READY.**
  Сейчас у тебя написано: 148 sub-based + 124 order-based CB20 + 1 moved from blocked = 273.
  Это формулировка сбивает. Правильно зафиксировать так:
  &nbsp;
  - **sub-based READY = 149**
  - **order-based READY (CB20) = 124**
  - **total READY = 273**
  &nbsp;
  Либо ещё лучше сразу дать execute-сплит:
  &nbsp;
  - **INSERT = 269**
  - **UPDATE = 4**
  - **TOTAL EXECUTE = 273**
  &nbsp;
2. **В READY_FOR_BACKFILL добавь не только users, но и action split.**
  Для каждого продукта нужна колонка:
  &nbsp;
  - insert_count
  - update_count
  - total_execute
  &nbsp;
  По текущей логике должно получиться:
  &nbsp;
  - club = 4 insert / 3 update
  - buh_business = 1 insert / 1 update
  - остальные ready-продукты = только insert
  &nbsp;
3. **В row-level preview добавь ещё 4 обязательных поля.**
  Помимо has_user_id / profile_id / user_id / resolved_execute_decision, добавь:
  &nbsp;
  - product_id
  - product_code
  - existing_entitlement_product_code
  - canonical_order_id
  &nbsp;
  Это особенно нужно для cb_2_step / prd_0d01a2fdc477, чтобы mismatch был виден сразу в строке, а не только в summary.
4. **Для BLOCKED_BY_LEGACY_CODE_MISMATCH = 8 зафиксируй отдельный stop-rule.**
  Прямо пропиши:
  &nbsp;
  - в v23.1.9B эти 8 строк должны иметь только resolved_execute_decision = skip_legacy_code_mismatch
  - никакого insert второго active entitlement по тому же product_id
  - никакого auto-rename в этом патче
  &nbsp;
5. **Для BLOCKED_BY_MISSING_USER_ID = 69 добавь row-level source key.**
  Чтобы потом не потерять deferred хвост, в preview нужна ещё колонка:
  &nbsp;
  - deferred_recovery_key
  &nbsp;
  Например: profile_id + product_id + canonical_order_id.
  Это станет основой для v23.1.9D.
6. **Для ЗАКРОЙ ГОД зафиксируй, что 19 blocked — это только order-based ambiguity, не subscription-based blocker.**
  То есть прямо напиши:
  &nbsp;
  - если есть active subscription → execute допустим
  - even if historical orders are ambiguous → expires_at берётся из sub.access_end_at
  &nbsp;
  Чтобы потом это снова не вернули в blocked.
7. **В DoD добавь явную проверку 5-way split по фактическим count.**
  Не просто “split обязателен”, а именно:
  &nbsp;
  - insert
  - update
  - skip_missing_user_id
  - skip_legacy_code_mismatch
  - skip_missing_tariff
  &nbsp;
  И сумма всех row-level строк должна сходиться с итоговыми summary counts.
8. **Добавь ещё один обязательный pre-execute deliverable для v23.1.9B:**
  execute_candidates_summary_by_action_and_product
  Таблица формата:
  &nbsp;
  - product_code
  - resolved_execute_decision
  - row_count
  &nbsp;
  Без неё execute не утверждать.
9. **Уточни статус v23.1.9D.**
  Напиши прямо: это не просто “deferred backfill”, а
  **“deferred entitlement issuance after profile→user claim”**.
  Потому что там важен не просто хвост, а событие появления user_id.
10. **По v23.1.11 добавь scope, что нормализация имён не должна менять SoT-коды в runtime без отдельного mapping-layer.**
  Иначе потом кто-нибудь начнёт “переименовывать” коды в боевых таблицах.
  Нужно зафиксировать:

&nbsp;

&nbsp;

&nbsp;

- human-readable naming = display/admin layer
- technical codes = не переписывать без отдельного migration/compat plan

&nbsp;

&nbsp;

После этих правок план можно считать финально готовым для v23.1.9A.1-final.

&nbsp;

План: PATCH v23.1.9A.1-final — Row-level conflict preview + категории блокировки

## Цель

Финальные правки к discovery перед v23.1.9B execute: пересчёт категорий, новые блоки (BLOCKED_BY_MISSING_USER_ID, BLOCKED_BY_LEGACY_CODE_MISMATCH), добавление follow-up патчей v23.1.9C/D/v23.1.11, row-level preview с `profile_state`.

---

## Что меняется

### 1. ЗАКРОЙ ГОД: 1 user из blocked → READY

Правило: если у пользователя есть active subscription и `expires_at` берётся из `sub.access_end_at`, то historical multi-period orders **не блокируют** backfill. Этот 1 user включается в execute-set.

- `course_close_year`: **55** ready (было 54)
- `DUPLICATE_CLEANUP_REVIEW` blocking: **19** (было 20)

### 2. CB20 69 без user_id → новая категория

Убрать из NEED_POLICY_DECISION. Создать:

**BLOCKED_BY_MISSING_USER_ID = 69**

Правила:

- В v23.1.9B эти записи не backfill-ятся (entitlements.user_id обязателен)
- Сохраняются как отложенный pending-backfill хвост
- После появления user_id (auto-claim / first-login) — отдельный follow-up механизм выдачи

CB20 READY: **124** (193 - 69)

### 3. cb_2_step 8 users → BLOCKED_BY_LEGACY_CODE_MISMATCH

Без изменений по сути — 8 users исключены из execute, но категория переименована явно.

### 4. NEED_POLICY_DECISION сужен

Остаётся только: **CB20 без tariff_id = 3**

### 5. Новые патчи в roadmap


| Патч         | Scope                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v23.1.9C** | Cleanup legacy code mismatch (cb_2_step → prd_0d01a2fdc477 normalization)                                                                                                          |
| **v23.1.9D** | Deferred entitlement backfill для archived profiles без user_id (69 CB20). Source of truth уже есть, доступ не теряется, выдача откладывается до появления user_id                 |
| **v23.1.11** | Product/training code normalization + admin-readable naming. Audit всех product_code, slug, legacy aliases. Таблица соответствий technical_code → human label → product → training |


### 6. profile_state в final preview

Добавить колонки в row-level preview:

- `has_user_id` (bool)
- `profile_id`
- `user_id`
- `resolved_execute_decision` (insert / update / skip_missing_user_id / skip_legacy_code_mismatch / skip_missing_tariff)

### 7. Stop-guard для v23.1.9B

Execute запрещён, если row-level preview не разделяет строки минимум на:

- `insert`
- `update`
- `skip_missing_user_id`
- `skip_legacy_code_mismatch`
- `skip_missing_tariff`

---

## Пересчитанные итоги


| Категория                               | Count                                                                 |
| --------------------------------------- | --------------------------------------------------------------------- |
| **READY_FOR_BACKFILL**                  | **273** (148 sub-based + 124 order-based CB20 + 1 moved from blocked) |
| **NEED_POLICY_DECISION**                | **3** (CB20 без tariff_id)                                            |
| **BLOCKED_BY_MISSING_USER_ID**          | **69** (CB20 profiles без auth user)                                  |
| **BLOCKED_BY_LEGACY_CODE_MISMATCH**     | **8** (ЦБ 2 ступень cb_2_step)                                        |
| **DUPLICATE_CLEANUP_REVIEW (blocking)** | **19** (ЗАКРОЙ ГОД multi_different_periods)                           |


### READY_FOR_BACKFILL breakdown


| Продукт            | Users   | Mode                   |
| ------------------ | ------- | ---------------------- |
| cb_module_ip       | 59      | sync_from_subscription |
| course_close_year  | **55**  | sync_from_subscription |
| cb20               | **124** | fixed_from_order       |
| prd_0d01a2fdc477   | **18**  | sync_from_subscription |
| 1769009596189-398a | 8       | sync_from_subscription |
| club               | 7       | sync_from_subscription |
| buh_business       | 2       | sync_from_subscription |
| **Итого**          | **273** | &nbsp;                 |


---

## Последовательность патчей (обновлённая)


| Патч                 | Scope                                                           | Статус          |
| -------------------- | --------------------------------------------------------------- | --------------- |
| **v23.1.9A**         | Discovery + classification + canonical selection                | ВЫПОЛНЕН        |
| **v23.1.9A.1-final** | Row-level conflict preview с новыми категориями                 | **Этот патч**   |
| **v23.1.9B**         | Execute только по resolved_execute_decision in (insert, update) | Ожидает preview |
| **v23.1.9C**         | Cleanup legacy code mismatch (cb_2_step)                        | Планируется     |
| **v23.1.9D**         | Deferred backfill для archived profiles без user_id             | Планируется     |
| **v23.1.10**         | Fix root cause в creation paths                                 | Планируется     |
| **v23.1.11**         | Product/training code normalization + admin-readable naming     | Планируется     |


---

## Изменяемые компоненты


| Компонент          | Изменение                                                   |
| ------------------ | ----------------------------------------------------------- |
| `.lovable/plan.md` | Пересчёт категорий, новые патчи, profile_state, stop-guards |


Код и данные НЕ меняются.

## DoD

1. ЗАКРОЙ ГОД: 55 ready (1 user moved из blocked)
2. BLOCKED_BY_MISSING_USER_ID = 69 (отдельная категория, не NEED_POLICY)
3. BLOCKED_BY_LEGACY_CODE_MISMATCH = 8 (отдельная категория)
4. NEED_POLICY_DECISION = 3 (только CB20 без tariff_id)
5. READY_FOR_BACKFILL = 273
6. v23.1.9D зафиксирован: deferred backfill для profiles без user_id
7. v23.1.11 зафиксирован: code normalization + readable naming
8. profile_state / identity_state добавлен в preview
9. Stop-guard: 5-way split обязателен для execute