# да, согласен, с учетом правок:

&nbsp;

1. **Не считать PATCH G закрытым после children_created.**
  Зафиксировать статус так:
  &nbsp;
  - PATCH G1 = children_created
  - PATCH G2 = price_normalized
  - PATCH G3 = parent_ui_clean
  - PATCH G4 = parents_finalized
    До G4 split считается незавершённым.
  &nbsp;
2. **PATCH H обязателен и должен идти раньше PATCH E execute.**
  Сейчас выявлен реальный дефект: child-сделки получили полную цену parent.
  Нужно явно исправить:
  &nbsp;
  - существующие 22 child orders в БД
  - логику edge function split-multi-module-orders, чтобы при следующих запусках цена сразу считалась правильно
  &nbsp;
3. **Правило расчёта цены child order прописать жёстко.**
  Для каждого parent:
  &nbsp;
  - child_base_price = parent_base_price / module_count
  - child_final_price = parent_final_price / module_count
  - child_paid_amount = parent_paid_amount / module_count
  - округление детерминированное
  - сумма всех child = сумма parent 1:1
    Отдельно указать, что для parent с нулевой суммой child тоже нулевые.
  &nbsp;
4. **PATCH H делать в двух частях.**
  &nbsp;
  - H1 — data-fix для уже созданных 22 child orders
  - H2 — code-fix в split-multi-module-orders/index.ts, чтобы больше не копировалась полная цена parent в каждый child
  &nbsp;
5. **PATCH I расширить: это не только visibility cleanup, но и canonical rendering cleanup.**
  Сейчас дубли и старые названия видны:
  &nbsp;
  - в списке сделок
  - во вкладке сделок контакта
  - в карточке/detail сделки
    Нужно привести к одному каноническому виду на всех слоях UI.
  &nbsp;
6. **Для parent split-order запретить показ как обычной живой сделки клиента.**
  До финализации:
  &nbsp;
  - parent должен быть явно помечен как split parent / архивная / разделена
  - не должен визуально конкурировать с child-сделками
    После финализации:
  - parent не должен отображаться как обычная активная пользовательская сделка
  &nbsp;
7. **Добавить отдельный PATCH I1 для названий parent/child в карточке контакта.**
  По скриншотам видно, что именно там остались смешанные старые и новые названия.
  Проверить и исправить:
  &nbsp;
  - outer row
  - contact deals list
  - detail sheet
  - view/edit modal
    Название должно совпадать везде.
  &nbsp;
8. **PATCH F считать не просто verify-only, а закрывать только после system-wide UI proof.**
  Потому что проблема была не только в одном месте.
  В DoD PATCH F добавить:
  &nbsp;
  - одинаковое отображение названия сделки снаружи и внутри карточки
  - корректное отображение split child deals
  - отсутствие root-name там, где должен быть модуль
  &nbsp;
9. **Добавить отдельный PATCH J как system-wide audit, но не отрывать его от основной задачи.**
  Формулировка:
  &nbsp;
  - это supporting patch для доказательства корректности цепочки сделка → продукт → доступ
  - не отдельный side-project
    Проверить по всей системе:
  - все split parents
  - все split children
  - все historical standalone orders
  - все кейсы с неверной ценой child
  - все кейсы с неверным названием в UI
  - все кейсы, где parent и child одновременно выглядят как обычные активные сделки
  &nbsp;
10. **Добавить обязательную audit-таблицу по всем split кейсам.**
  Минимум поля:

&nbsp;

&nbsp;

&nbsp;

- profile_email
- parent_order_number
- child_order_count
- parent_status
- split_status
- parent_visible_as_normal_deal
- child_prices_ok
- titles_ok_everywhere
- needs_cleanup

&nbsp;

&nbsp;

&nbsp;

11. **PATCH E не запускать execute до завершения PATCH H и PATCH I.**
  Иначе entitlement будет чиниться на ещё не нормализованных данных сделок/UI.
  Новый порядок:

&nbsp;

```
1. PATCH H1 data-fix prices
2. PATCH H2 code-fix split function
3. PATCH I UI cleanup parent/child + titles
4. PATCH J audit/proof
5. PATCH E dry_run
6. PATCH E execute approved cohort
7. PATCH G finalize_parents
8. PATCH B browser proof
```

&nbsp;

12. **По Царёвой явно зафиксировать: основной blocker сейчас не mapping, а inactive content.**
  Это важный итог, его нельзя размазывать.
  В proof-блоке отдельно показать:

&nbsp;

&nbsp;

&nbsp;

- matched modules = 4/4
- visible_module_count
- visible_recursive_lesson_count = 0
- inactive lessons count
- итог: repair blocked by inactive content, not by mapping

&nbsp;

&nbsp;

&nbsp;

13. **По Катерине добавить обязательный pre-execute proof.**
  До execute показать:

&nbsp;

&nbsp;

&nbsp;

- parent order
- child orders после split
- corrected child prices
- matched training module ids
- target_expires_at
- visible_recursive_lesson_count
  Только после этого execute.

&nbsp;

&nbsp;

&nbsp;

14. **Добавить отдельный proof-пакет по child orders после PATCH H.**
  Таблица:

&nbsp;

&nbsp;

&nbsp;

- child_order_number
- parent_order_number
- split_module_product_id
- resolved_product_name
- base_price
- final_price
- paid_amount
- expected_unit_price
- match
- ui_visible_correctly

&nbsp;

&nbsp;

&nbsp;

15. **STOP-guard перед finalize_parents усилить.**
  Финализация запрещена, если не закрыто хотя бы одно:

&nbsp;

&nbsp;

&nbsp;

- child price mismatch
- parent still visible as normal deal
- titles mismatch across UI layers
- standalone repair cohort not reviewed
- reference proof for Царёва/Катерина not collected

&nbsp;

&nbsp;

&nbsp;

16. **Для PATCH G зафиксировать add-only правило на данные:**

&nbsp;

&nbsp;

&nbsp;

- не создавать новые products/tariffs/training_modules
- не удалять child orders
- parent не переводить в canceled до полного proof-пакета
- все изменения parent/child должны быть обратимо диагностируемы через meta

&nbsp;

&nbsp;

&nbsp;

17. **В meta child orders добавить поля для прозрачного аудита цен.**
  Если ещё нет, добавить:

&nbsp;

&nbsp;

&nbsp;

- split_parent_final_price
- split_parent_module_count
- split_price_strategy = per_module_equal
- split_price_batch_id

&nbsp;

&nbsp;

&nbsp;

18. **В главной цели спринта уточнить финальный бизнес-результат.**
  Не просто “нормализовать standalone orders”, а:

&nbsp;

&nbsp;

&nbsp;

- historical standalone deals корректно разделены
- child prices корректны
- parent/child дубли устранены
- названия модулей единообразны на всех экранах
- entitlements repaired только по доказуемо корректным кейсам
- срок доступа и фактическая видимость контента подтверждены proof-таблицами

&nbsp;

&nbsp;

&nbsp;

19. **PATCH B оставить последним, но расширить.**
  Это не только lesson editing proof.
  Добавить browser proof:

&nbsp;

&nbsp;

&nbsp;

- admin/superadmin lesson edit/save
- Катерина: корректные child deals в списке и карточке контакта
- Царёва: корректные child deals + parent не мешает UI
- корректное название сделки внутри и снаружи

&nbsp;

&nbsp;

&nbsp;

20. **Главную формулировку “не уходить от основной темы” закрепить прямо в плане.**
  Добавить строку:

&nbsp;

&nbsp;

&nbsp;

- PATCH G/H/I/J — поддерживающие нормализационные шаги
- основная тема спринта неизменна: корректная цепочка продукт → тариф → тренинг → сделка → доступ → срок

&nbsp;

&nbsp;

План: PATCH H + I + J + нормализация данных после split

## Главная цель спринта (уточнённая)

1. Historical standalone deals разделены и нормализованы
2. Цены child deals корректны (per-module, не копия parent)
3. Parent/child визуальные дубли устранены
4. Standalone entitlements repaired по approved cohort
5. Срок доступа и видимость контента доказаны на reference-cases

**PATCH G/H/I/J — поддерживающие работы.** Основной результат: корректная цепочка продукт → тариф → тренинг → сделка → доступ → срок.

## Статусы патчей


| Patch   | Статус                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH F | ✅ done / verify only                                                                                                                      |
| PATCH C | ✅ done / verify only                                                                                                                      |
| PATCH D | ⏳ proof base ready                                                                                                                        |
| PATCH G | ✅ execute_children_only done, post-check PASS (22/22). **Data normalization NOT finished**: prices wrong, parent/child duplicates visible |
| PATCH H | ➡️ **NEW** — price normalization for 22 child orders                                                                                      |
| PATCH I | ➡️ **NEW** — parent/child UI visibility cleanup                                                                                           |
| PATCH J | ➡️ **NEW** — system-wide audit all historical standalone                                                                                  |
| PATCH E | ⏳ queued after H/I                                                                                                                        |
| PATCH B | ⏳ final browser proof                                                                                                                     |


## Диагностика: текущее состояние данных

### Проблема с ценами (PATCH H)

Все child orders получили **полную цену parent** вместо per-module:


| Parent                      | parent_final | modules | Expected child price | Actual child price |
| --------------------------- | ------------ | ------- | -------------------- | ------------------ |
| GC-3831920 (katerina)       | 250          | 3       | 83.33                | 250 ❌              |
| GC-3813592 (lori)           | 19204.08     | 2       | 9602.04              | 19204.08 ❌         |
| GC-3818307 (overchenko)     | 1100         | 2       | 550                  | 1100 ❌             |
| GC-3814251 (princessa)      | 28823.23     | 3       | 9607.74              | 28823.23 ❌         |
| GC-3830657 (bruylo)         | 0            | 5       | 0                    | 0 ✅ (trivial)      |
| GC-1767629483208 (Царёва)   | 0            | 3       | 0                    | 0 ✅ (trivial)      |
| GC-3818501 (irkaguzarevich) | 0            | 4       | 0                    | 0 ✅ (trivial)      |


**Причина:** строки 168-170 edge function копируют `parent.base_price / final_price / paid_amount` напрямую.

### Проблема с дублями (PATCH I)

У katerina и Царёвой в UI одновременно видны parent multi-module deal И child module deals — создаёт визуальные дубли.

## Execution order (обновлённый)

```text
1. PATCH H — price normalization (UPDATE 22 child orders)
2. PATCH I — parent visibility cleanup в UI
3. PATCH J — system-wide audit table
4. PATCH F — verify display names consistency
5. PATCH E — dry_run on normalized data
6. PATCH E — execute approved cohort
7. PATCH G — finalize_parents (только после всех проверок)
8. PATCH B — browser proof
```

## PATCH H — Нормализация цен child deals

### Что делать

1. **UPDATE 22 child orders** через insert tool (data operation):
  - `child_base_price = parent_base_price / module_count`
  - `child_final_price = parent_final_price / module_count`
  - `child_paid_amount = parent_paid_amount / module_count`
  - Округление: `ROUND(x / n, 2)` с коррекцией остатка на последний child (чтобы сумма = parent точно)
2. **UPDATE purchase_snapshot** каждого child: добавить поля `normalized_unit_price`, `parent_total_price`, `parent_module_count`
3. **Исправить edge function** `split-multi-module-orders/index.ts` строки 168-170: заменить копирование full price на per-module division, чтобы при повторных запусках логика была корректной

### Post-check таблица (обязательная)

| parent_order_number | parent_final_price | parent_module_count | expected_child_price | child_order_number | actual_child_price | match |

### Файлы

- `supabase/functions/split-multi-module-orders/index.ts` — fix price calculation (строки 168-170)

## PATCH I — Parent/child visibility cleanup

### Два этапа

**I1 — До finalize:** Parent order получает UI-маркер `split_parent = true` в meta. UI-компоненты фильтруют/помечают:

- `ContactDetailSheet.tsx` (строка ~2976) — при рендере deals: если `meta.split_status = 'children_created'`, показать как "Архивная (разделена)" с пониженной opacity или collapse, не как обычную живую сделку
- `AdminDeals.tsx` — аналогичный фильтр/бейдж
- `DealDetailSheet.tsx` — бейдж "Split parent" + список child order_numbers

**I2 — После finalize:** Parent переходит в `status = 'canceled'` с `canceled_reason = 'split_into_modules'` — автоматически перестаёт показываться как активная сделка (если UI фильтрует canceled).

### Файлы

- `src/components/admin/ContactDetailSheet.tsx` — визуальное разделение parent/child
- `src/pages/admin/AdminDeals.tsx` — бейдж/фильтр split parent
- `src/components/admin/DealDetailSheet.tsx` — бейдж + child links

## PATCH J — System-wide audit

### SQL-запрос для полного аудита

Собрать таблицу по ВСЕМ historical standalone deals:

| profile_email | parent_order | child_count | parent_visible_in_ui | child_prices_ok | needs_cleanup |

Проверить:

- Все split parents и их children
- Cases где parent + child одновременно видны как обычные сделки
- Cases где child price = parent price (некорректно)
- Все single-module standalone (не split) — проверить consistency

### Deliverable

Markdown-таблица или CSV в `/mnt/documents/`

## PATCH F — Verify consistency

Проверить что одно и то же название модуля отображается одинаково:

- Внешний список сделок (AdminDeals)
- Вкладка сделок контакта (ContactDetailSheet)
- Detail sheet сделки (DealDetailSheet)
- Edit/view modal
- ContactPaymentsTab
- LinkDealDialog / LinkSubscriptionDealDialog

## PATCH E — Уточнения

### Царёва ([irinkazar@inbox.ru](mailto:irinkazar@inbox.ru)) — proof-блок


| Поле                           | Значение                                               |
| ------------------------------ | ------------------------------------------------------ |
| matched modules                | 4/4 (Розница, Грузо, Производство, Строительство)      |
| visible_module_count           | 0                                                      |
| visible_recursive_lesson_count | 0                                                      |
| inactive_lessons_count         | 12+                                                    |
| **Статус**                     | **repair blocked by inactive content, not by mapping** |


### Катерина ([katerina5515530@gmail.com](mailto:katerina5515530@gmail.com)) — pre-execute proof

Обязательно показать перед execute:

- module_product_ids из child orders
- matched_training_module_ids
- visible_module_count / visible_recursive_lesson_count
- target_expires_at
- child orders after split

Финальный статус: один из трёх — `repair executed` / `blocked with exact reason` / `manual review`

### Режим execute

- dry-run показывает оба варианта: `strict_hold` и `partial_safe`
- Выбор после просмотра результатов
- Базовый приоритет для reference-cases: `partial_safe`

## STOP-guard перед finalize_parents

Finalize запрещён если хотя бы одно:

- ❌ child price mismatch (PATCH H не закрыт)
- ❌ parent/child duplicate visibility in UI (PATCH I не закрыт)
- ❌ wrong titles в contact/deal card
- ❌ repair cohort не подтверждён
- ❌ post-check не включает UI integrity proof

## Reference cases — before/after proof

Для Царёвой и Катерины обязательный 4-этапный proof:

1. До split (текущее состояние parent)
2. После children_created + price normalization
3. После UI cleanup (parent скрыт/помечен)
4. После repair (entitlement created/blocked)

## Child orders proof-пакет (каждый child)

| child_order_number | product_id | resolved_product_name | final_price | parent_order_number | split_module_product_id | ui_visible_correctly |

## DoD спринта

### Основная цепочка

- Child deals имеют корректную модульную цену (sum children = parent)
- Parent multi-module deal не выглядит как обычная активная сделка
- Названия модулей совпадают на всех экранах
- System-wide audit completed
- Duplicate visual rows eliminated

### Entitlements

- standalone_safe dry-run и execute по approved cohort
- Царёва: documented proof (blocked by inactive content)
- Катерина: pre-execute proof → execute/block/manual
- expires_at = business_access_end_at
- Нет дублей активных cb20 entitlements
- Runtime visibility доказана UI proof

### Finalize

- PATCH G finalize_parents только после полного post-check (DB + UI)
- Browser proof admin + superadmin