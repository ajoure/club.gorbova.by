да, согласен, с учетом правок:

&nbsp;

1. **Вкладку “Доступы” не расширять второй сущностью и не превращать в технический дебаг-экран.**
  Формулировку добавить entitlements замени на:
  **“Сделать вкладку ‘Доступы’ единой витриной всех активных доступов пользователя.”**
  Она должна показывать итоговый фактический доступ, а не только subscriptions_v2.
  Допустимо хранить внутри тип записи (subscription / entitlement), но визуально это должен быть **единый список активных продуктов**, который полностью совпадает с реальным доступом пользователя.
2. **Источник для вкладки “Доступы” — не сырые subscriptions и не сырые entitlements по отдельности, а канонический effective access.**
  Иначе вы снова получите рассинхрон:
  сделки ≠ entitlements ≠ subscriptions ≠ кабинет.
  Нужно явно дописать:
  **вкладка “Доступы” и личный кабинет должны строиться из одного и того же канонического результата доступа**
  (access_rules → resolver/effective access → UI),
  а не из двух разных запросов, склеенных на фронте.
3. **По кейсу Елизаветы не фиксировать заранее, что cb20 “должна быть видна”.**
  Сейчас это в плане звучит как предположение.
  Заменить на:
  **“Нужно доказать, какой именно доступ должен быть у Елизаветы по действующим правилам продукта, и только после этого привести вкладку ‘Доступы’ и кабинет к одному каноническому результату.”**
  То есть сперва proof, потом repair.
  Нельзя в плане заранее навязать вывод, что ей должен открываться весь cb20.
4. **Отдельно зафиксировать правило по cb20:**
  **если active access к cb20 не подтверждается действующим правилом продукта, он должен считаться закрытым по умолчанию.**
  Это должно быть написано в блоке Problem/DoD явно, без двусмысленностей.
5. **В блоке диагностики исправить арифметику по продуктам.**
  У тебя написано:
  5 subscription_based, но перечислено 6 позиций.
  Нужен точный пересчёт без расхождений.
6. **Добавить обязательный блок reconciliation по каждому продукту с 4 числами, а не с 3.**
  Не только:
  &nbsp;
  - deals
  - active access
  - runtime visibility
    Но ещё:
  - **what is shown in Access tab**
    Иначе нельзя доказать, что карточка контакта совпадает с кабинетом.
  &nbsp;
7. **Repair-листы делать не только по пользователям, но и по типу дефекта.**
  Минимум 4 отдельных списка:
  &nbsp;
  - paid_without_access
  - access_without_rule
  - shown_in_access_tab_but_not_visible_in_cabinet
  - visible_in_cabinet_but_missing_in_access_tab
  &nbsp;
8. **DoD усилить.**
  Сейчас пункт 4 слишком мягкий.
  Заменить на жёсткий вид:
  **“Для Елизаветы Андреевой после спринта вкладка ‘Доступы’, сделки, entitlements/subscriptions и личный кабинет показывают один и тот же результат, и этот результат доказан действующим access_rule_id либо явно задокументирован как deny.”**
9. **UserSubscriptions.tsx не помечать как “проверить, нужен ли патч”.**
  Здесь не должно быть неопределённости.
  Нужно написать прямо:
  **“Проверить и при необходимости обязательно привести пользовательский экран к тому же каноническому effective access, что и вкладку ‘Доступы’ в админке.”**
10. **Добавить итоговый артефакт верхнего уровня:**
  effective_access_single_source_proof.csv
  Колонки:
  user_id | product_id | has_paid_source | has_rule_source | shown_in_access_tab | shown_in_personal_cabinet | final_verdict | mismatch_reason
  Это должен быть главный proof, что система действительно сведена в одну картину.
11. **Сформулировать главный результат спринта одной фразой в начале и в DoD:**
  **“У каждого пользователя карточка ‘Доступы’ и личный кабинет обязаны показывать один и тот же набор активных продуктов, объяснимый только каноническими правилами доступа.”**
12. **Не использовать формулировку “добавить fetch entitlements” как цель.**
  Это техническая реализация, а не цель.
  Цель — **сделать единый truth-view доступа**.
  Fetch entitlements — лишь один из возможных шагов.

&nbsp;

&nbsp;

Если хочешь, следующим сообщением я соберу тебе уже финальный копируемый блок плана для Lovable в жёсткой форме без двусмысленностей.

&nbsp;

## План: FULL-ACCESS-RECONCILIATION — полный инвентаризационный аудит и ремонт всей системы доступов

---

### Проблема

1. **Вкладка «Доступы» показывает только `subscriptions_v2**`, но не `entitlements`. Продукты с `entitlement_mode = order_based_only` (cb20, модули, вебинары) полностью невидимы во вкладке «Доступы», даже если entitlement active.
2. **Blocker-кейс: Елизавета Андреева** — BUSINESS-клуб, 3 paid сделки по cb20, active entitlement (id: `42e26b5b`, rule `1b497fba`), но вкладка «Доступы» не показывает cb20 (потому что нет subscription), и в личном кабинете cb20 не отображается (из-за `scope_resolution_mode: module_scope_only` — видна только 1 модуль Грузоперевозки).
3. **Нет полной картины по всем 26 продуктам** — до сих пор аудиты касались только cb20.

### Диагностика (факты из БД)

**Елизавета Андреева** (profile: `a13d99e5`, user: `692f22b7`):

- Subscriptions active: Gorbova Club BUSINESS (до 06.05.26), ЗАКРОЙ ГОД (до 01.05.26), ЦБ 2 ступень Премиум (до 30.08.26)
- Entitlements active: Gorbova Club, ЗАКРОЙ ГОД, ЦБ 2 ступень, **cb20** (до 06.05.26, rule `1b497fba`)
- Вкладка «Доступы» = 3 записи (только subscriptions) — **cb20 не видна**
- Личный кабинет: только ЗАКРОЙ ГОД + ЦБ 2 ступень — **cb20 не видна** (scope `module_scope_only`, разрешён только модуль Грузоперевозки, но даже он не отображается как отдельный root)

**Корневая причина вкладки «Доступы»**: запрос идёт ТОЛЬКО к `subscriptions_v2` (L464-474 ContactDetailSheet.tsx). Entitlements не запрашиваются. Для `order_based_only` продуктов это = невидимость.

**Корневая причина личного кабинета**: cb20 root training module (`c9f7e9b8`) привязан к product_id `7101ed3c`. Entitlement есть → `has_access=true`. НО `scope_resolution_mode: module_scope_only` + `historical_module_product_ids: [64d9f812]` = synthetic training_content rule разрешает только модуль Грузоперевозки. Root-модуль не показывается, если нет видимых children → cb20 скрыт.

**26 активных продуктов в системе:**

- 5 subscription_based (Gorbova Club, Бухгалтерия как бизнес, ЗАКРОЙ ГОД, ЦБ 2 ступень, Подоходный налог ИП, Учет у ИП) — видны во вкладке «Доступы»
- 17 order_based_only (cb20, 8 модулей, вебинары) — **невидимы** во вкладке «Доступы»
- 2 legacy_skip — исключены

---

### Предлагаемое решение

#### EXECUTE 1: Вкладка «Доступы» — добавить entitlements

Дополнить вкладку «Доступы» в `ContactDetailSheet.tsx` запросом к `entitlements` для `order_based_only` продуктов. Показывать их отдельной секцией или объединённым списком с маркером типа (subscription / entitlement).

**Файлы:**

- `src/components/admin/ContactDetailSheet.tsx` — добавить fetch entitlements, объединить в общий список
- `src/components/user/UserSubscriptions.tsx` — проверить, нужен ли аналогичный патч для пользовательского view

#### EXECUTE 2: Полный инвентаризационный аудит всех 26 продуктов

Для каждого из 26 активных продуктов собрать полную матрицу:

- product_id, public_id, name, entitlement_mode
- has_training_content_rules, has_product_access_rules, has_club_rules
- active_deals_count, active_entitlements_count, active_subscriptions_count
- users_with_runtime_visibility_count
- status_verdict (ok / mismatch / orphan / expired_should_be_closed)

**Артефакт:** `full_access_inventory.csv`

#### EXECUTE 3: Контактный аудит — cross-check сделки vs доступы vs кабинет

Для каждого пользователя с active сделками/подписками/entitlements:

- что в сделках
- что во вкладке «Доступы» (subscriptions)
- что в entitlements
- что реально видно в кабинете (sidebar modules)
- mismatch → причина на уровне rule/resolver/entitlement/runtime/UI

**Артефакты:**

- `contact_access_vs_runtime_vs_ui.csv`
- `product_access_reconciliation.csv`

#### EXECUTE 4: Blocker-кейс Елизавета Андреева — полный разбор

Пошаговый trace:

1. profile_id: `a13d99e5`, user_id: `692f22b7`
2. Сделки cb20: 3 paid (order `052e202c` с tariff Бизнес-леди, `0dc1cb3d` и `3f28d6c6` без tariff)
3. Rule `1b497fba`: product=Gorbova Club, tariff=BUSINESS, type=product_access, condition=prior_purchase → target includes cb20
4. Entitlement `42e26b5b`: active, expires 2026-05-06, source_rule_id=`1b497fba`, scope=`module_scope_only`
5. Проблема 1: вкладка «Доступы» не показывает (нет subscription для cb20)
6. Проблема 2: кабинет не показывает (scope ограничен одним модулем, root hidden)
7. Вопрос: правильно ли `module_scope_only`? Она покупала cb20 напрямую (tariff Бизнес-леди) — значит по правилу `fc9e584e` (training_content для tariff Бизнес-леди) она должна видеть 28 модулей, а не 1.

#### EXECUTE 5: Три числа по каждому продукту

Для продуктов с тренингами:

- users_with_paid_deals
- users_with_active_access (subscription или entitlement)
- users_with_runtime_visibility
Mismatch → repair-list.

#### EXECUTE 6: Специализированные repair-листы

- `expired_products_access_leak.csv` — доступ есть, но должен быть закрыт
- `paid_without_access_repair_list.csv` — сделка paid, но доступ не выдан
- `access_without_rule_or_paid_source.csv` — доступ есть, но нет ни сделки, ни правила

#### EXECUTE 7: UI public_id patch (secondary, из предыдущего спринта)

Уже запланирован, включён как add-only.

---

### Изменяемые компоненты

1. `src/components/admin/ContactDetailSheet.tsx` — fetch entitlements + отображение
2. `src/components/user/UserSubscriptions.tsx` — проверить entitlements display
3. Скрипты аудита (Python/SQL) → артефакты в `/mnt/documents/`

### Что НЕ изменяется

- access-resolver.ts, grant-access-for-order, entitlement-sync — уже переведены
- Таблицы БД — без миграций
- training_modules tree — без изменений

### Dry-run

1. SELECT-only аудит всех 26 продуктов
2. Cross-check Елизаветы Андреевой по всей цепочке
3. Подсчёт mismatches до execute

### STOP-guards

1. Если аудит выявляет > 50 пользователей с полным отсутствием доступа при paid сделках — STOP, ручная проверка
2. Если entitlements query в ContactDetailSheet ломает существующий access tab — STOP
3. Если после патча кол-во записей во вкладке «Доступы» изменилось неожиданно — STOP

### DoD

1. Вкладка «Доступы» показывает И subscriptions, И entitlements (для order_based_only продуктов)
2. `full_access_inventory.csv` — все 26 продуктов с полной матрицей
3. `contact_access_vs_runtime_vs_ui.csv` — cross-check по всем пользователям
4. Елизавета Андреева: cb20 видна во вкладке «Доступы» и в кабинете (или задокументирована точная причина почему нет)
5. 3 числа по каждому продукту (deals / access / visibility) совпадают или mismatch задокументирован
6. 3 repair-листа сгенерированы
7. 0 кейсов где в карточке одно, в сделках другое, в кабинете третье — без задокументированного объяснения
8. 8+ артефактов в `/mnt/documents/`

### Обязательные артефакты

1. `full_access_inventory.csv`
2. `product_access_reconciliation.csv`
3. `contact_access_vs_runtime_vs_ui.csv`
4. `expired_products_access_leak.csv`
5. `paid_without_access_repair_list.csv`
6. `access_without_rule_or_paid_source.csv`
7. `elizaveta_andreeva_full_trace.csv`
8. Final after-proof summary