# Да, согласен, **с учетом правок**:

1. **B1 нельзя делать сейчас.**  
Не выключать `Строительство`, не менять entitlement и не переносить доступы. Только зафиксировать как `empty_training_root` и вывести в отчёт. Контентное решение — отдельный PATCH.
2. **B3 нельзя выполнять массово.**  
Только dry-run по 23 строкам: кто должен быть `full_tariff_scope`, кто `module_scope_only`, кто standalone-only. Без автоматического удаления/изменения parent-entitlement.
3. **B4 — только после discovery.**  
Не включать все `access_rules` массово. Сначала показать: какие rules, для каких products, есть ли дубли, какой canonical rule. Потом отдельное approve.
4. **C1 добавить обязательно.**  
Resolver должен временно поддерживать оба формата `hpids`: `product_id` и `training_module_id`, с audit/warn `hpids_training_id_fallback_used`.
5. **Главный DoD:**  
Для каждого active entitlement на продукт с training root:
  - продукт виден в «Моей библиотеке»;
  - если контента нет — карточка видна как «Контент не опубликован», а не исчезает;
  - доступы в карточке контакта и библиотека не расходятся.

Можно запускать с этими правками.

&nbsp;

Да, согласен, с учетом правки:

- **Пустой модуль с доступом обязан отображаться.**  
Если `entitlement active` и training/module существует, но `lessons_count=0` и `children_count=0`, карточку не скрывать.
- В UI показывать состояние: **«Уроки скоро появятся» / «Контент не опубликован»**.
- Это применить глобально ко всем тренингам/модулям, не только к «Строительству».
- Resolver не должен использовать наличие уроков как условие видимости. Условие видимости = **есть активный доступ + существует training_module**.
- В DoD добавить:
  - Алена видит «ЦБ-1 | Строительство» даже без уроков;
  - модуль открывается и показывает пустое состояние;
  - sweep по всем active entitlements: нет кейсов, где доступ есть, module существует, но карточка скрыта из-за `0 lessons`.

Можно запускать в работу.

&nbsp;

План: устранить расхождения «доступы ↔ показ тренингов»

## 1. Что найдено в дискавери (Елена Богинская, 78123ed5…)

### 1.1. Корневая причина «Строительство не активный»


| Что                                     | Маркетплейсы (d7effaf4) | Строительство (f833c846) |
| --------------------------------------- | ----------------------- | ------------------------ |
| Entitlement                             | active, до 16.05.26     | active, до 16.05.26      |
| products_v2                             | есть                    | есть                     |
| Корневой training_module                | `4c97d21c`              | `b7bae7fd`               |
| Дочерние training_modules               | **0**                   | **0**                    |
| Уроки на корне                          | **5** (есть контент)    | **0** (пусто)            |
| access_rules (product/training_content) | **все is_active=false** | **все is_active=false**  |


**Строительство не «активный» в библиотеке потому, что у его корневого тренинга нет ни дочерних модулей, ни уроков — рендерить нечего.** Доступ выдан корректно, но контента в БД нет.

### 1.2. Системные ошибки, делающие resolver хрупким

**A. Битая семантика `historical_module_product_ids**` в module-product entitlements:

- `Маркетплейсы.meta.hpids = [4c97d21c]` — это **training_module_id**, а не product_id.
- `Строительство.meta.hpids = [b7bae7fd]` — то же самое.
- `resolveBonusScopeRules` (строка 332) делает `training_modules WHERE product_id IN (hpids)` → **возвращает пусто** → синтетический bonus rule с `allowed_module_ids=[]`.
- Сейчас спасает только то, что в `useSidebarModules` корень с `parent_module_id=null` всегда виден (PATCH 2026-05-13). Но любой клиентский фильтр глубже ломается.

**B. Все access_rules для standalone module-products отключены** (`is_active=false`) — backend не имеет SOT для проверки контента этих продуктов. Любая ветка, читающая access_rules (а не entitlements напрямую), вернёт «нет доступа».

**C. Reverted CB-1 root entitlement** (7101ed3c, batch INV-PHANTOM-PARENT-V1-REVERT-2026-05-13):

- `meta.hpids = [d7effaf4]` (product_id Маркетплейсы — ОК для маппинга),
- но `scope_resolution_mode='module_scope_only'` → resolver выдаёт `partial, allowed=[4c97d21c]`,
- из-за этого вся внутренность ЦБ-1 (root c9f7e9b8 + 18+ детей) скрыта, кроме модулей, попадающих в этот allowlist. Ровно поэтому в библиотеке у Алены ЦБ-1 «торчит» как 0/4 (или вовсе не виден целиком).

**D. Несогласованность модели данных «standalone module»:**

- Один и тот же контент существует и как дочерний модуль внутри `c9f7e9b8` (CB-1 root), и как отдельный product+training (Маркетплейсы/Строительство/…).
- Покупка standalone-модуля даёт entitlement на отдельный product, но visual library показывает его рядом с CB-1, а не внутри. При этом сам standalone-training может быть пустым (Строительство).

## 2. План устранения

### Этап A — Диагностика по всем 23 reverted записям и всем module-products

Read-only sweep:

1. Для каждого `entitlement` с `meta.scope_resolution_mode='module_scope_only'`:
  - Проверить, что `hpids[]` содержит **product_id** (а не training_module_id). Битые → bucket `hpids_are_training_ids`.
  - Прогнать `resolveBonusScopeRules` симуляцию → bucket `synthetic_empty_allowlist`.
2. Для всех products, у которых `entitlements.status=active` существует, но `access_rules.is_active=true` отсутствует → bucket `product_without_active_rules`.
3. Для каждого root `training_module` с `is_active=true` посчитать `children + lessons`. Если = 0 → bucket `empty_training_root`.
4. Сохранить proof в `.lovable/proofs/access_vs_training_audit_2026_05_13.md`.

### Этап B — Починка данных (строго точечно, без массовых правок)

B

1. **Empty Строительство (b7bae7fd)** — это **контентная** проблема, не resolver. Решения на выбор (нужно подтверждение владельца контента):
  - либо завести уроки/модули для standalone Строительство,
  - либо привязать entitlement Строительство не к product `f833c846`, а к подмодулю внутри CB-1 (изменить SOT module-product → child training_module внутри c9f7e9b8).
   До решения — пометить product как `is_active=false` и вернуть «доступ к модулю Строительство внутри ЦБ-1» через access_rule на c9f7e9b8.

B

2. **Битые `hpids` (training_id вместо product_id)** в entitlements Маркетплейсы/Строительство (и аналогичных): миграция `inv_hpids_normalize_2026_05_13`:
  - Для каждой записи: если все `hpids[]` → существующие training_module_id с `parent_module_id=null` → перевести их в соответствующие `product_id` (берём `training_modules.product_id`).
  - Audit `entitlement.hpids_normalized_v1` per row.
  - DRY-RUN сначала.

B

3. **Reverted CB-1 root (Алена и аналоги)** — для всех 23 записей решить:
  - Если у пользователя есть отдельные standalone-module entitlements (Маркетплейсы/Строительство/…), parent CB-1 entitlement **не должен** иметь `scope_resolution_mode='module_scope_only'` — он должен либо быть `full_tariff_scope` (если был полный CB-1), либо вообще не существовать (видимость идёт из standalone-ents).
  - Аудит исходных заказов/основания → перевести в один из: `full_tariff_scope` / удалить / оставить `module_scope_only` с правильными hpids.
  - Без подтверждения по каждому — не менять.

B

4. **Включить access_rules для активных module-products** (Маркетплейсы, Строительство, …): миграция `module_product_rules_activate_2026_05_13` — выставить `is_active=true` на канонических `product_access` + `training_content` правилах, либо удалить дубли, оставив один SOT-rule на product.

### Этап C — Изменения резолвера (минимальные, чтобы не маскировать данные)

C

1. В `resolveBonusScopeRules`: добавить **fallback маппинг** — если `hpids[i]` не нашлось в `products_v2.id`, проверить как `training_modules.id` (с `parent_module_id=null`). Если совпало — использовать его напрямую как `allowed_module_ids[i]`. Логировать `hpids_training_id_fallback_used` (чтобы B2 двигал данные в норму).

C

2. В `useSidebarModules` библиотеки: для root-модуля с `has_access=true`, но `lessons=0 && children=0` — показывать карточку с состоянием **«Контент не опубликован»** вместо тихого скрытия. Сейчас Строительство в принципе РЕНДЕРИТСЯ (resolver его не режет — root защищён правилом 199-201), но у пользователя визуально пусто и неясно почему.

C

3. НЕ трогать: `subscriptions_v2`, `provider_subscriptions`, `access_end_at`, Telegram, write-paths grant-access.

### Этап D — Верификация (DoD)

- Audit-файл со всеми bucket'ами и поimённым списком пользователей.
- Для Алены: после B2 (нормализация hpids) синтетический rule для Маркетплейсы/Строительство выдаёт корректный allowlist; ЦБ-1 root решается через B3.
- Для Строительства: либо контент добавлен (и видно), либо product выключен и видимость идёт через access_rule на c9f7e9b8 — пользователь явно видит модуль внутри ЦБ-1.
- Sweep `(user_id, product_id)` с active entitlement → root тренинг проходит resolver И имеет ≥1 урок/child = **0 broken cases**.
- Memory: добавить `hpids-semantics-canon` (hpids = product_id only, training_id запрещён); обновить `cabinet-visibility-entitlement-dependency.md` пунктом «empty training root → явный UI-state, не молча скрывать».

## 3. Что НЕ делаю в этом плане

- Не выдаю и не отзываю никакие entitlements автоматически.
- Не редактирую `subscriptions_v2`, биллинг, Telegram, access_end_at.
- Не трогаю поведение grant-access-for-order.
- Не запускаю массовые правки без подтверждения по каждому пользователю из 23-ки.

## 4. Что мне нужно от тебя перед стартом

1. По Строительству: **добавляем контент** или **переводим entitlement внутрь ЦБ-1**?
2. По 23 reverted CB-1 ents: можно ли мне после Этапа A прислать тебе bucketed-список и идти по нему построчно (full / module_scope / удалить)?
3. Подтверждаешь, что C1 (fallback маппинг hpids) допустим как временный костыль до завершения B2?