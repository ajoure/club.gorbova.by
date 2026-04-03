# Аудит: BUSINESS → ЦБ 2.0 (v4 — после ремонта)

> Статус: **audit-level, после ремонта REPAIR_V4_20260403**
> Дата: 2026-04-03
> Изменения в данных: **выполнены** (5 entitlements repaired)
> Предыдущая версия: v3 (docs/audits/business-cb20-access-audit-v3.md)

---

## Что изменилось с v3

### Новые проблемы (обнаружены при re-audit)
1. **mazepina77@mail.ru** — entitlement expired сегодня из-за неверного source_access_end_at в batch repair
2. **447417148@mail.ru (Ольга Севериненко)** — drift -9h (entitlement истекал на 9ч раньше biz_end)
3. **elena.shirshova.21@gmail.com** — drift +15h

### Выполненный ремонт (batch REPAIR_V4_20260403)

| # | email | repair_type | old_status | old_expires_at | new_expires_at | drift | ent_id |
|---|---|---|---|---|---|---|---|
| 1 | mazepina77@mail.ru | reactivate+align | expired | 2026-04-03 05:41 | 2026-05-03 20:59:59 | -30d | c00c0e63 |
| 2 | irinkazar@inbox.ru | create (missing) | — | — | 2026-04-18 20:59:59 | — | 6b7960e6 (new) |
| 3 | 447417148@mail.ru | realign_expiry | active | 2026-04-08 12:00 | 2026-04-08 20:59:59 | -9h | 9dc327cc |
| 4 | overchenko.lina@mail.ru | realign_expiry | active | 2026-05-03 12:00 | 2026-05-01 20:59:59 | +39h | 261df383 |
| 5 | elena.shirshova.21@gmail.com | realign_expiry | active | 2026-05-03 12:00 | 2026-05-02 20:59:59 | +15h | a582a3a4 |

Все 5 записей подтверждены в POST-CHECK. Audit_logs: 5/5 записей с action=entitlement.repaired.

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

---

## Таблица 2 — CB20 purchase/access audit (после ремонта)

### Entitlement summary
- 88 active cb20 entitlements **among BUSINESS users** (было 87, +1 irinkazar)
- 87 valid-for-visibility (scope IS NOT NULL)
- 1 invalid scope (NULL) — sonne.e@inbox.ru

### Оставшиеся проблемные пользователи

| # | email | purchase_type | has_ent | scope | category | next_action |
|---|---|---|---|---|---|---|
| 1 | sonne.e@inbox.ru | root_only | да | **NULL** | MANUAL REVIEW | manual_decision_required |
| 2 | a.bruylo@ajoure.by | module_only | нет | — | MANUAL REVIEW | no_action_staff_exception |

### По каждому:

**sonne.e**:
- Проблема НЕ в контенте
- Проблема: scope_resolution_mode = NULL + BUSINESS past_due + business_access_end_at = NULL
- Не BLOCKED BY CONTENT, а MANUAL REVIEW — data/scope issue

**a.bruylo**:
- missing entitlement by design (staff_skip rule)
- included in expected_access_total, but classified as manual/staff exception by design

### irinkazar (Царёва) — REPAIRED

- **purchase_type**: mixed (normalized). Все заказы = module_only_standalone. Нет base_tariff_purchase.
- **scope_resolution_mode**: `module_scope_only`
- **Обоснование scope**: нет базовой тарифной покупки → доступ только к купленным модулям
- **mapped_training_module_ids**: [b7bae7fd (Строительство), 1ede03b4 (Розничная), 8f71d4a8 (Грузо-), a4a5102d (Производство)]
- **historical_tariff_id**: NULL
- **previous content blocker removed; current blocker = missing entitlement → RESOLVED**

### Katerina (Рыштакова) — OK

- **purchase_type** = mixed
- **scope_resolution_mode** = module_scope_only
- Источник 4 mapped modules: 3 из split-children + 1 из отдельной historical purchase (order d9a29949)
- Expected visible modules based on mapped_training_module_ids and active lessons = 4

---

## Таблица 3 — Runtime visibility audit

**Важная оговорка**: OK по 87 пользователям = **audit-level expected visibility**, рассчитанная по scope/rules + active lesson inventory. Это НЕ per-user UI/runtime proof.

Все 87 valid-scope entitlements **проходят audit-level rule resolution without content blockers**.

На момент аудита для текущего дерева ЦБ 2.0: 39 active modules, 128 active lessons, blocked-by-content cases not detected.

---

## Duplicate entitlement audit

| Показатель | Значение |
|---|---|
| Users with >1 active cb20 entitlement | **0** |
| Duplicate risk | **none** |

---

## Финальная классификация (после ремонта)

| Группа | Кол-во | Пользователи |
|---|---|---|
| **OK** | **87** | см. расшифровку ниже |
| **REPAIR NEEDED** | **0** | — (все 5 repaired) |
| **BLOCKED BY CONTENT** | **0** | — |
| **MANUAL REVIEW** | **2** | sonne.e (NULL scope + past_due), a.bruylo (staff_exception) |
| *NO CB20 RELATION* | *16* | *вне expected_access_total* |

### Расшифровка OK-группы

| purchase_type | OK count |
|---|---|
| root_only OK | 82 |
| mixed OK | 5 |
| module_only OK | 0 |
| **total OK** | **87** |

### Контрольная формула

```text
expected_access_total = root_only(83) + mixed(5) + module_only(1) = 89
OK(87) + REPAIR(0) + BLOCKED(0) + MANUAL(2) = 89
89 = 89 ✓

Total BUSINESS = expected(89) + no_cb20(16) = 105 ✓
```

---

## Practical status — кого можно проверять в ЛК

### Готовы к проверке в личном кабинете (87 users):
- Все 87 OK-пользователей с active entitlements и valid scope
- Включая 5 только что отремонтированных: mazepina77, irinkazar, 447417148, overchenko.lina, elena.shirshova.21

### НЕ готовы к проверке (2 users):
- **sonne.e@inbox.ru** — scope=NULL, runtime заблокирует доступ даже при наличии entitlement. Нужен manual_decision_required.
- **a.bruylo@ajoure.by** — нет entitlement by design (staff). Нужен no_action_staff_exception.

### Зависят от ремонта — ВСЕ ПОЧИНЕНЫ:
- mazepina77 ✓ (реактивирована)
- irinkazar ✓ (entitlement создан)
- 447417148 ✓ (drift устранён)
- overchenko.lina ✓ (drift устранён)
- elena.shirshova.21 ✓ (drift устранён)

### Особое замечание по Ольге (447417148@mail.ru):
- Данные в БД корректны (entitlement active, scope = union_scope, drift устранён)
- Если Ольга всё ещё жалуется на отсутствие доступа — проблема скорее всего в сессии/кеше/повторном входе
- Рекомендация: попросить Ольгу перелогиниться

---

## Итоговый summary

```text
BUSINESS users total:               105
CB20 expected access (normalized):    89
  → OK:                               87  (audit-level expected visibility)
      root_only OK:                    82
      mixed OK:                         5
      module_only OK:                   0
  → REPAIR NEEDED:                      0  (all repaired)
  → BLOCKED BY CONTENT:                 0
  → MANUAL REVIEW:                      2  (sonne.e, a.bruylo[staff])
NO CB20 RELATION:                     16  (норма)
Duplicate active entitlements:          0
Repaired in this batch:                 5
```

---

## Рекомендуемые следующие шаги

1. ~~irinkazar~~ ✓ repaired
2. ~~overchenko.lina~~ ✓ repaired
3. **sonne.e** — manual_decision_required (scope + past_due status)
4. **a.bruylo** — no_action_staff_exception (закрыть без правок)
5. **Per-user runtime proof** — для перевода 87 OK из "expected visibility" в "confirmed visibility"
6. **Ольга Севериненко** — если доступ не появился, диагностировать runtime/session
