# Аудит: BUSINESS → ЦБ 2.0 (согласованная версия v3)

> Статус: **audit-level, согласован**
> Дата: 2026-04-03
> Изменения в данных: **не производились**

---

## Критическое исправление: нормализация и математика

### Ошибка предыдущего аудита
Предыдущий подсчёт не включал split-child module orders (product_id != cb20 root) как нормализованные покупки. Из-за этого a.bruylo (у которой только split-children с module product IDs) выпадала из expected_access.

Кроме того, join по `profiles.id = subscriptions.user_id` был неверным — корректный join: `profiles.id = subscriptions.profile_id`.

---

## Таблица 1 — BUSINESS users summary

| Показатель | Значение |
|---|---|
| Всего BUSINESS (active/trial/past_due) | **105** |
| С нормализованными покупками ЦБ 2.0 | **89** |
| Без отношения к ЦБ 2.0 | **16** |

### Формула expected_access_total (нормализованная)

| purchase_type | Подсчёт | Примечание |
|---|---|---|
| root_only | 83 | Только root cb20 orders (без split-parent) |
| mixed | 5 | root + module orders (вкл. split-children) |
| module_only | 1 | Только split-child module orders, root = split-parent excluded |
| **expected_access_total** | **89** | 83 + 5 + 1 |
| none (NO CB20) | 16 | |

Правила нормализации:
- Orders с `meta.split_status IN ('children_created','finalized')` исключены как split-parents
- Split-child module orders (product_id ∈ {abee24cd, 064dd768, d7effaf4, 64d9f812, 9187db54, f833c846}) включены как живые нормализованные покупки
- Для split-кейсов source of truth = child orders

---

## Таблица 2 — CB20 purchase/access audit

### Entitlement summary
- 87 active cb20 entitlements **among BUSINESS users**
- 86 valid-for-visibility (scope IS NOT NULL)
- 1 invalid scope (NULL) — sonne.e@inbox.ru

### Проблемные пользователи

| # | email | purchase_type | has_split_parent | has_ent | scope | drift_hours | category | next_action |
|---|---|---|---|---|---|---|---|---|
| 1 | irinkazar@inbox.ru | mixed | yes | **нет** | — | — | REPAIR NEEDED | repair_create_entitlement |
| 2 | overchenko.lina@mail.ru | mixed | yes | да | union_scope | **+39h** | REPAIR NEEDED | repair_realign_expiry |
| 3 | sonne.e@inbox.ru | root_only | нет | да | **NULL** | — | MANUAL REVIEW | manual_decision_required |
| 4 | a.bruylo@ajoure.by | module_only | yes (parent only) | нет | — | — | MANUAL REVIEW | no_action_staff_exception |

### По каждому проблемному:

**irinkazar (Царёва)**:
- 1 live normalized cb20 purchase (root)
- 1 split-parent history record (excluded from normalized purchase counting, status=paid, NOT finalized/canceled)
- Entitlement отсутствует. Контент теперь 128/128 active.
- **previous content blocker removed; current blocker = missing entitlement only**
- Классификация: REPAIR NEEDED

**overchenko.lina**:
- expires_at = 2026-05-03 12:00, biz_end = 2026-05-01 21:00
- Drift = +39h. По правилу проекта (expires_at = business_access_end_at) это REPAIR NEEDED.

**sonne.e**:
- Проблема НЕ в контенте.
- Проблема: scope_resolution_mode = NULL + BUSINESS past_due + business_access_end_at = NULL
- Entitlement существует, но без scope runtime блокирует доступ (entitlement-scope-safe-default)
- Не BLOCKED BY CONTENT, а MANUAL REVIEW — это data/scope issue, не content issue.

**a.bruylo**:
- missing entitlement by design (staff_skip rule)
- Единственный cb20 order = split-parent (children_created). Split-children существуют (5 module orders), но entitlement intentionally not created.
- **included in expected_access_total, but classified as manual/staff exception by design**

### Katerina (Рыштакова) — в OK

- **purchase_type** = mixed
- **scope_resolution_mode** = module_scope_only

Источник 4 mapped modules:
- 3 из split-children (Розничная торговля, Производство, Маркетплейсы)
- 1 из отдельной historical purchase, которая даёт 4-й mapped module (Грузо- и пассажироперевозки, order d9a29949)

Итого: 2 исторических покупки → 1 split-parent (3 модуля) + 1 отдельная historical purchase (1 модуль) = 4 модуля

Visibility:
- Expected visible modules based on mapped_training_module_ids and active lessons = 4
- Expected visible lessons = подсчёт по active lessons в этих 4 модулях
- Рассчитано по mapping + active lesson inventory.

---

## Таблица 3 — Runtime visibility audit

**Важная оговорка**: OK по 85 пользователям = **audit-level expected visibility**, рассчитанная по scope/rules + active lesson inventory. Это НЕ per-user UI/runtime proof.

Основание для expected visibility:
- 3 active training_content access_rules для cb20 (Бухгалтер, Главный бухгалтер, Бизнес-леди)
- 39 active modules, 128 active lessons (0 inactive)
- Все 86 valid-scope entitlements **проходят audit-level rule resolution without content blockers**

На момент аудита для текущего дерева ЦБ 2.0: 39 active modules, 128 active lessons, blocked-by-content cases not detected.

Per-user UI/browser proof не выполнялся для всех 85 OK-пользователей.

---

## Duplicate entitlement audit

| Показатель | Значение |
|---|---|
| Users with >1 active cb20 entitlement | **0** |
| Duplicate risk | **none** |

---

## Финальная классификация (4 группы)

| Группа | Кол-во | Пользователи |
|---|---|---|
| **OK** | **85** | см. расшифровку ниже |
| **REPAIR NEEDED** | **2** | irinkazar (missing ent), overchenko.lina (expiry drift +39h) |
| **BLOCKED BY CONTENT** | **0** | — |
| **MANUAL REVIEW** | **2** | sonne.e (NULL scope + past_due), a.bruylo (staff_exception) |
| *NO CB20 RELATION* | *16* | *вне expected_access_total* |

### Расшифровка OK-группы

| purchase_type | OK count |
|---|---|
| root_only OK | 82 |
| mixed OK | 3 |
| module_only OK | 0 |
| **total OK** | **85** |

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
  → OK:                               85  (audit-level expected visibility)
      root_only OK:                    82
      mixed OK:                         3
      module_only OK:                   0
  → REPAIR NEEDED:                      2  (irinkazar, overchenko.lina)
  → BLOCKED BY CONTENT:                 0
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
