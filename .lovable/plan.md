# да, согласен, с учетом правок:

&nbsp;

1. **Исправь итоговую математику.**
  Сейчас снова не сходится:
  &nbsp;
  - expected_access_total = 89
  - OK 88 + MANUAL REVIEW 2 = 90
    Это нельзя отдавать в работу в таком виде.
    Нужна одна строгая база классификации:
  - либо MANUAL REVIEW входит в expected_access_total,
  - либо staff/manual cases исключаются из expected_access_total.
    Сначала пересчитать totals, потом фиксировать v4.
  &nbsp;
2. **Не делай raw SQL INSERT для irinkazar без dry-run proof структуры entitlement.**
  Для Царёвой нельзя просто вставить entitlement “по аналогии”.
  Обязательно сначала показать:
  &nbsp;
  - какой scope_resolution_mode выбран и почему,
  - какие historical_module_product_ids,
  - какие mapped_training_module_ids,
  - какой historical_tariff_id/basis used,
  - почему именно union_scope, а не module_scope_only.
    Без этого INSERT слишком рискованный.
  &nbsp;
3. **Для irinkazar сначала зафиксируй, root-only это кейс или mixed-normalized.**
  В тексте сейчас одновременно:
  &nbsp;
  - “missing entitlement”
  - “mixed purchase: root + 3 module children”
    Нужно явно указать, считаются ли split child orders источником entitlement logic или только purchase history normalization.
    Иначе выбор union_scope не доказан.
  &nbsp;
4. **[447417148@mail.ru](mailto:447417148@mail.ru) не выноси в repair без явного правила, что любой drift чинится, даже <24ч.**
  Ранее в логике audit было:
  &nbsp;
  - <24h = ok
    Сейчас ты предлагаешь repair при -9h.
    Это допустимо только если в проекте утверждено новое правило:
  - expires_at must equal business_access_end_at exactly, без tolerance.
    Если такого правила нет, этот кейс не должен идти в repair.
  &nbsp;
5. **По overchenko и elena.shirshova.21 обязательно покажи current entitlement IDs и exact target dates до execute.**
  В плане один ent_id не указан вообще.
  Нельзя утверждать SQL-ремонт без:
  &nbsp;
  - entitlement_id
  - current_expires_at
  - target_expires_at
  - drift_hours
  - reason_for_repair
  &nbsp;
6. **mazepina77 сначала проверь причину expired статуса до update.**
  Нужен mini-proof:
  &nbsp;
  - entitlement действительно должен быть active,
  - BUSINESS подписка действительно active/past_due с действующим access_end_at,
  - expired не является ожидаемым результатом ручного revoke/older source.
    Иначе есть риск “реанимировать” entitlement, который истёк не по ошибке.
  &nbsp;
7. **Все repair-операции делай через единый repair script/patch с preview table, а не пятью разрозненными SQL-командами.**
  Нужен формат:
  &nbsp;
  - preview table
  - execute table
  - post-check table
    Иначе потом невозможно нормально доказать, что ничего лишнего не обновили.
  &nbsp;
8. **Audit log должен быть не просто “запись будет”, а с проверяемым DoD.**
  Добавь в план:
  &nbsp;
  - после каждого repair проверить, что в audit_logs появилась запись
  - actor_type
  - actor_user_id / actor_label
  - action = entitlement.repaired
  - meta с old/new expires и user/profile identifiers.
    Без post-check логов пункт считается невыполненным.
  &nbsp;
9. **Не обновляй audit v4 до завершения post-check.**
  Сейчас документ не должен называться “после ремонта”, пока:
  &nbsp;
  - SQL/repair не выполнен,
  - post-check не подтвержден,
  - итоговая математика не сошлась.
    Сначала repair proof, потом обновление audit.
  &nbsp;
10. **Добавь отдельный блок “что уже можно проверять руками в ЛК, а что еще нет”.**
  Сейчас это главный практический вопрос.
  В плане должен быть явный статус:
  &nbsp;
  - кого уже можно логинить и проверять в личном кабинете,
  - кого пока нельзя,
  - какие кейсы зависят от repair,
  - какие уже полностью готовы к UI/runtime проверке.
  &nbsp;

&nbsp;

&nbsp;

Копируемый блок для Lovable:

```
Дополни план правками:

1. Исправь итоговую математику. Сейчас снова несхождение:
- expected_access_total = 89
- OK 88 + MANUAL REVIEW 2 = 90
Нужна одна строгая база классификации. Явно укажи, входят ли MANUAL REVIEW / staff cases в expected_access_total или нет. Пока математика не сошлась, план не финальный.

2. Не делай raw SQL INSERT для irinkazar без dry-run proof структуры entitlement.
Перед execute покажи:
- почему выбран именно scope_resolution_mode
- historical_module_product_ids
- mapped_training_module_ids
- basis для scope (root / modules / normalized mixed history)
- почему union_scope, а не module_scope_only

3. Уточни классификацию irinkazar:
- это root-only кейс
или
- mixed-normalized кейс с учетом split children
Нужно одно точное определение, потому что от этого зависит entitlement logic.

4. 447417148@mail.ru не выносить в repair автоматически, пока явно не зафиксировано правило:
- expires_at must equal business_access_end_at exactly, без tolerance.
Если tolerance <24h всё еще допустим, этот кейс не repair.

5. Для overchenko.lina и elena.shirshova.21 добавь preview-таблицу:
- email
- entitlement_id
- current_expires_at
- target_expires_at
- drift_hours
- reason_for_repair

6. Для mazepina77 перед update покажи mini-proof:
- current entitlement status
- current expires_at
- business subscription status
- business access_end_at
- почему expired является ошибкой, а не ожидаемым состоянием

7. Все repair-операции оформить как единый repair-пакет:
- preview table
- execute step
- post-check table
Не пять разрозненных SQL-команд без общего proof.

8. Для audit_logs добавь явный DoD:
после каждого repair должна существовать проверяемая запись в audit_logs с:
- action = entitlement.repaired
- actor_type / actor_label
- old_expires_at
- new_expires_at
- user/profile identifiers

9. Audit v4 обновлять только после post-check.
Сначала repair proof и пересчитанные totals, потом обновление audit-документа.

10. Добавь отдельный practical-status блок:
- кого уже можно проверять руками в личном кабинете
- кого пока нельзя
- какие кейсы готовы к UI/runtime проверке уже сейчас
- какие кейсы зависят от repair

План: Полная проверка и ремонт доступа BUSINESS → ЦБ 2.0
```

## Диагностика

### Ольга Севериненко ([447417148@mail.ru](mailto:447417148@mail.ru))

Данные в БД **корректны**: entitlement active, scope = `union_scope`, expires_at = 2026-04-08 12:00:00. Однако обнаружен **drift -9 часов** (entitlement истекает на 9 часов раньше, чем BUSINESS подписка). Runtime-резолвер должен показывать полный доступ. Возможная причина жалобы — кеш браузера или не выполнен вход. Drift будет устранён.

### Новый проблемный пользователь (не был в audit v3)

**[mazepina77@mail.ru](mailto:mazepina77@mail.ru)** — entitlement **EXPIRED сегодня** (expires_at = 2026-04-03 05:41). Batch repair использовал неверный `source_access_end_at` (взял дату из другого источника вместо BUSINESS subscription `access_end_at = 2026-05-03`). Сейчас пользователь потерял доступ к ЦБ 2.0.

### Полный список проблем (5 пользователей)


| #   | email                                                               | проблема                    | действие                                              |
| --- | ------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------- |
| 1   | [mazepina77@mail.ru](mailto:mazepina77@mail.ru)                     | entitlement expired сегодня | reactivate + realign expires_at → 2026-05-03 20:59:59 |
| 2   | [irinkazar@inbox.ru](mailto:irinkazar@inbox.ru)                     | missing entitlement         | create с expires_at → 2026-04-18 20:59:59             |
| 3   | [447417148@mail.ru](mailto:447417148@mail.ru)                       | drift -9h                   | realign expires_at → 2026-04-08 20:59:59              |
| 4   | [overchenko.lina@mail.ru](mailto:overchenko.lina@mail.ru)           | drift +39h                  | realign expires_at → 2026-05-01 20:59:59              |
| 5   | [elena.shirshova.21@gmail.com](mailto:elena.shirshova.21@gmail.com) | drift +15h                  | realign expires_at → 2026-05-02 20:59:59              |


Без изменений (как в v3):

- [sonne.e@inbox.ru](mailto:sonne.e@inbox.ru) — MANUAL REVIEW (NULL scope + past_due)
- [a.bruylo@ajoure.by](mailto:a.bruylo@ajoure.by) — staff exception

## Что будет сделано

### Шаг 1 — Миграция SQL для ремонта 5 пользователей

Один SQL-скрипт с 5 операциями:

1. **mazepina77**: `UPDATE entitlements SET status = 'active', expires_at = '2026-05-03 20:59:59+00' WHERE id = 'c00c0e63-...'`
2. **irinkazar**: `INSERT INTO entitlements (user_id, product_code, product_id, status, expires_at, meta)` — scope `union_scope` (mixed purchase: root + 3 module children: Розничная, Грузо-, Производство)
3. **[447417148@mail.ru](mailto:447417148@mail.ru)**: `UPDATE entitlements SET expires_at = '2026-04-08 20:59:59+00' WHERE id = '9dc327cc-...'`
4. **overchenko.lina**: `UPDATE entitlements SET expires_at = '2026-05-01 20:59:59+00' WHERE id = '261df383-...'`
5. **elena.shirshova.21**: `UPDATE entitlements SET expires_at = '2026-05-02 20:59:59+00' WHERE id = ...` (нужно получить ent_id)

Каждая операция пишет audit_logs запись с `action = 'entitlement.repaired'`.

### Шаг 2 — Обновление audit-документа

Обновить `docs/audits/business-cb20-access-audit-v3.md` → v4:

- mazepina77 добавлена в проблемный список и отмечена как repaired
- Drift-кейсы (Ольга, elena.shirshova.21) добавлены и отмечены как repaired
- Пересчитанная финальная математика

### Итоговая формула после ремонта

```
expected_access_total = 89
  OK (после ремонта): 88 (+3 repaired)
  REPAIR NEEDED: 0
  MANUAL REVIEW: 2 (sonne.e, a.bruylo)
  BLOCKED BY CONTENT: 0
  NO CB20 RELATION: 16
```

## Жёсткие правила

- Каждое изменение с audit_logs записью
- Только точечные UPDATE/INSERT по конкретным entitlement ID
- Никаких массовых операций без предпросмотра
- irinkazar: scope = union_scope (mixed: root + modules)