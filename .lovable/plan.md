да, согласен, с учетом правок:

&nbsp;

1. Явно зафиксируй, что Katerina = mixed, а не module_only.  
Иначе текст местами противоречит сам себе:  

  - у нее есть split-child module orders
  - и отдельная root/history purchase  
  Значит, по нормализованной классификации это mixed.  
  Тогда строка OK = 82 root_only + 3 mixed = 85 остается математически корректной.
2. &nbsp;
3. Убери двусмысленную фразу standalone root order.  
Замени на одну из двух точных формулировок:  

  - отдельная root purchase с module-specific display name
  - или отдельная historical purchase, которая дает 4-й mapped module  
  Потому что standalone root order звучит как логическое противоречие.
4. &nbsp;
5. В блоке по Katerina раздели purchase_type и scope.  
Прямо так:  

  - purchase_type = mixed
  - scope_resolution_mode = module_scope_only  
  Это разные сущности, их нельзя визуально смешивать в одном абзаце.
6. &nbsp;
7. В строке 87 active cb20 entitlements total уточни базу подсчета.  
Напиши:  

  - 87 active cb20 entitlements among BUSINESS users  
  Чтобы не выглядело как глобальный total по всей системе.
8. &nbsp;
9. В блоке Runtime visibility audit оставь текущую оговорку, но усили формулировку.  
Вместо:  

  - Все 86 valid-scope entitlements резолвятся...  
  лучше:
  - Все 86 valid-scope entitlements проходят audit-level rule resolution without content blockers  
  Это точнее и не звучит как уже завершенный per-user UI proof.
10. &nbsp;
11. Для a.bruylo явно укажи, что user входит в expected_access_total, но исключен из auto-fix по policy.  
Формулировка:  

  - included in expected_access_total, but classified as manual/staff exception by design  
  Это снимает вопрос, почему он входит в 89, но не идет в repair.
12. &nbsp;
13. Для irinkazar зафиксируй, что старый blocker уже неактуален.  
Одной строкой:  

  - previous content blocker removed; current blocker = missing entitlement only  
  Это важный итог спринта.
14. &nbsp;
15. В финальной таблице OK-группы не оставляй скрытую расшифровку через текст.  
Лучше явно показать:  

  - root_only OK = 82
  - mixed OK = 3
  - module_only OK = 0
  - total OK = 85  
  Тогда арифметика читается сразу, без догадок.
16. &nbsp;

&nbsp;

&nbsp;

Копируемый блок для Lovable:

Дополни аудит правками.

&nbsp;

1. Явно зафиксируй:

- Katerina = purchase_type `mixed`

- Katerina = scope_resolution_mode `module_scope_only`

&nbsp;

Это разные сущности. Не смешивай purchase_type и scope в одном описании.

&nbsp;

2. Убери формулировку `standalone root order`.

Замени на:

- `отдельная root purchase с module-specific display name`

или

- `отдельная historical purchase, которая дает 4-й mapped module`

&nbsp;

3. В entitlement summary уточни базу:

- `87 active cb20 entitlements among BUSINESS users`

&nbsp;

4. В runtime audit усили формулировку:

вместо `Все 86 valid-scope entitlements резолвятся...`

напиши:

- `Все 86 valid-scope entitlements проходят audit-level rule resolution without content blockers`

&nbsp;

5. Для a.bruylo явно укажи:

- `included in expected_access_total, but classified as manual/staff exception by design`

&nbsp;

6. Для irinkazar явно укажи:

- `previous content blocker removed; current blocker = missing entitlement only`

&nbsp;

7. В финальной расшифровке OK-группы покажи числа явно:

- root_only OK = 82

- mixed OK = 3

- module_only OK = 0

- total OK = 85

&nbsp;

8. Не меняй итоговую математику:

- expected_access_total = 89

- OK 85 + REPAIR 2 + MANUAL 2 + BLOCKED 0 = 89

- total BUSINESS = 89 + 16 = 105

&nbsp;

9. После этих правок текущую версию можно считать согласованной audit-версией.

&nbsp;

# Исправленный аудит: BUSINESS → ЦБ 2.0

## Критическое исправление: нормализация и математика

### Ошибка предыдущего аудита

Предыдущий подсчёт не включал split-child module orders (product_id != cb20 root) как нормализованные покупки. Из-за этого a.bruylo (у которой только split-children с module product IDs) выпадала из expected_access.

Кроме того, join по `profiles.id = subscriptions.user_id` был неверным — корректный join: `profiles.id = subscriptions.profile_id`.

---

## Таблица 1 — BUSINESS users summary


| Показатель                             | Значение |
| -------------------------------------- | -------- |
| Всего BUSINESS (active/trial/past_due) | **105**  |
| С нормализованными покупками ЦБ 2.0    | **89**   |
| Без отношения к ЦБ 2.0                 | **16**   |


### Формула expected_access_total (нормализованная)


| purchase_type             | Подсчёт | Примечание                                                     |
| ------------------------- | ------- | -------------------------------------------------------------- |
| root_only                 | 83      | Только root cb20 orders (без split-parent)                     |
| mixed                     | 5       | root + module orders (вкл. split-children)                     |
| module_only               | 1       | Только split-child module orders, root = split-parent excluded |
| **expected_access_total** | **89**  | 83 + 5 + 1                                                     |
| none (NO CB20)            | 16      | &nbsp;                                                         |


Правила нормализации:

- Orders с `meta.split_status IN ('children_created','finalized')` исключены как split-parents
- Split-child module orders (product_id ∈ {abee24cd, 064dd768, d7effaf4, 64d9f812, 9187db54, f833c846}) включены как живые нормализованные покупки
- Для split-кейсов source of truth = child orders

---

## Таблица 2 — CB20 purchase/access audit

### Entitlement summary

- 87 active cb20 entitlements total
- 86 valid-for-visibility (scope IS NOT NULL)
- 1 invalid scope (NULL) — [sonne.e@inbox.ru](mailto:sonne.e@inbox.ru)

### Проблемные пользователи


| #   | email                                                     | purchase_type | has_split_parent  | has_ent | scope       | drift_hours | category      | next_action               |
| --- | --------------------------------------------------------- | ------------- | ----------------- | ------- | ----------- | ----------- | ------------- | ------------------------- |
| 1   | [irinkazar@inbox.ru](mailto:irinkazar@inbox.ru)           | mixed         | yes               | **нет** | —           | —           | REPAIR NEEDED | repair_create_entitlement |
| 2   | [overchenko.lina@mail.ru](mailto:overchenko.lina@mail.ru) | mixed         | yes               | да      | union_scope | **+39h**    | REPAIR NEEDED | repair_realign_expiry     |
| 3   | [sonne.e@inbox.ru](mailto:sonne.e@inbox.ru)               | root_only     | нет               | да      | **NULL**    | —           | MANUAL REVIEW | manual_decision_required  |
| 4   | [a.bruylo@ajoure.by](mailto:a.bruylo@ajoure.by)           | module_only   | yes (parent only) | нет     | —           | —           | MANUAL REVIEW | no_action_staff_exception |


### По каждому проблемному:

**irinkazar (Царёва)**:

- 1 live normalized cb20 purchase (root, d9a29949)
- 1 split-parent history record (excluded from normalized purchase counting, status=paid, NOT finalized/canceled)
- Entitlement отсутствует. Контент теперь 128/128 active. Это REPAIR NEEDED, не BLOCKED BY CONTENT.

**overchenko.lina**:

- expires_at = 2026-05-03 12:00, biz_end = 2026-05-01 21:00
- Drift = +39h. По правилу проекта (expires_at = business_access_end_at) это REPAIR NEEDED.

**sonne.e**:

- Проблема НЕ в контенте. Проблема: scope_resolution_mode = NULL + BUSINESS past_due + business_access_end_at = NULL
- Entitlement существует, но без scope runtime блокирует доступ (entitlement-scope-safe-default)

**a.bruylo**:

- missing entitlement by design (staff_skip rule)
- Единственный cb20 order = split-parent (children_created). Split-children существуют (5 module orders), но entitlement intentionally not created.

### Katerina (Рыштакова) — в OK, пояснение по 4 модулям

- **Источник 4 mapped modules**: 3 из split-children (Розничная торговля, Производство, Маркетплейсы) + 1 из отдельного standalone root order d9a29949 (Грузо- и пассажироперевозки)
- Это корректно: 2 исторических покупки → 1 split-parent (3 модуля) + 1 standalone (1 модуль) = 4 модуля
- scope = module_scope_only
- Expected visible modules based on mapped_training_module_ids and active lessons = 4
- Expected visible lessons = подсчёт по active lessons в этих 4 модулях

---

## Таблица 3 — Runtime visibility audit

**Важная оговорка**: OK по 85 пользователям = **audit-level expected visibility**, рассчитанная по scope/rules + active lesson inventory. Это НЕ per-user UI/runtime proof.

Основание для expected visibility:

- 3 active training_content access_rules для cb20 (Бухгалтер, Главный бухгалтер, Бизнес-леди)
- 39 active modules, 128 active lessons (0 inactive)
- Все 86 valid-scope entitlements резолвятся через эти rules

На момент аудита для текущего дерева ЦБ 2.0: 39 active modules, 128 active lessons, blocked-by-content cases not detected.

Per-user UI/browser proof не выполнялся для всех 85 OK-пользователей.

---

## Duplicate entitlement audit


| Показатель                            | Значение |
| ------------------------------------- | -------- |
| Users with >1 active cb20 entitlement | **0**    |
| Duplicate risk                        | **none** |


---

## Финальная классификация (4 группы)


| Группа                 | Кол-во | Пользователи                                                 |
| ---------------------- | ------ | ------------------------------------------------------------ |
| **OK**                 | **85** | 82 root_only + 3 mixed (excl. overchenko, irinkazar)         |
| **REPAIR NEEDED**      | **2**  | irinkazar (missing ent), overchenko.lina (expiry drift +39h) |
| **BLOCKED BY CONTENT** | **0**  | —                                                            |
| **MANUAL REVIEW**      | **2**  | sonne.e (NULL scope + past_due), a.bruylo (staff_exception)  |
| *NO CB20 RELATION*     | *16*   | *вне expected_access_total*                                  |


### Контрольная формула

```text
expected_access_total = root_only(83) + mixed(5) + module_only(1) = 89
OK(85) + REPAIR(2) + BLOCKED(0) + MANUAL(2) = 89
89 = 89 ✓

Total BUSINESS = expected(89) + no_cb20(16) = 105 ✓
```

---

## Итоговый summary

```text
BUSINESS users total:               105
CB20 expected access (normalized):    89
  → OK:                               85  (expected visibility, audit-level)
  → REPAIR NEEDED:                      2  (irinkazar, overchenko.lina)
  → BLOCKED BY CONTENT:                0
  → MANUAL REVIEW:                      2  (sonne.e, a.bruylo[staff])
NO CB20 RELATION:                     16  (норма)
Duplicate active entitlements:          0
```

---

## Рекомендуемые следующие шаги

1. **irinkazar** — repair_create_entitlement через edge function
2. **overchenko.lina** — repair_realign_expiry (sync expires_at с biz_end)
3. **sonne.e** — manual_decision_required (scope + past_due status)
4. **a.bruylo** — no_action_staff_exception (закрыть без правок)
5. **Per-user runtime proof** — для перевода 85 OK из "expected visibility" в "confirmed visibility" требуется runtime check

Никаких изменений в данных на этом шаге не производится.