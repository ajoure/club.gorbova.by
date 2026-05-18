да, согласен, с учетом правок:

1. **Не подтверждаю трактовку, что “ИДЕОЛОГИЯ” = “Бизнес”.**  
Ранее в данных уже фигурировал отдельный тариф:

Gorbova Club — BUSINESS / tariff_id = 7c748940…

Поэтому в discovery нужно проверять **3 группы**, если все они существуют:

1. Gorbova Club — ИДЕОЛОГИЯ / b018e9be…

2. CB20 — Бизнес-леди / 9bc81736…

3. Gorbova Club — BUSINESS / 7c748940… / если активен

2. Добавить **Stage 0 — Tariff resolver**:

Перед основным аудитом сделать SELECT по tariffs/products/tariff_offers:

- name ILIKE '%ИДЕОЛОГ%'

- name ILIKE '%БИЗНЕС%'

- name ILIKE '%BUSINESS%'

- name ILIKE '%Бизнес-леди%'

&nbsp;

В proof явно указать:

tariff_id | tariff_name | product_id | product_name | active | included_in_audit | reason

3. Если 7c748940… существует и активен, **включить его в audit scope**.  
Иначе есть риск снова проверить не тот “Бизнес”.
4. paid orders без активного subscription/entitlement не считать автоматически активным доступом. Использовать их только как источник покупки и проверки, должен ли был быть создан доступ.
5. Для Telegram проверять не только telegram_club_members, но и фактическую связку:

telegram_club_members

telegram_channel_members

telegram_access

telegram_access_queue

6. Убрать из плана строку <presentation-artifact> — тут не нужен presentation artifact. Достаточно MD + CSV.
7. Добавить контрольный блок:

Если по любому включённому тарифу access_rules отсутствуют или пустые:

- не считать это PASS;

- пометить как access_rules_missing / no_rules_configured;

- severity = medium/high в зависимости от наличия продаж по тарифу.

Команда для Lovable:

План подтверждаю с правками.

&nbsp;

Перед аудитом обязательно выполнить Stage 0 — Tariff resolver.

&nbsp;

Не считать ИДЕОЛОГИЮ автоматически тарифом “Бизнес”.

Проверить, существует ли отдельный Gorbova Club — BUSINESS tariff_id=7c748940… или иной активный тариф с названием Business/Бизнес.

&nbsp;

В audit scope включить:

1. ИДЕОЛОГИЯ / b018e9be…

2. Бизнес-леди / 9bc81736…

3. Gorbova Club BUSINESS / 7c748940… — если найден и активен.

&nbsp;

Дальше выполнить read-only audit по плану:

- access_rules inventory;

- cohort;

- per-user checks C1–C10;

- gap_class + severity;

- final status board;

- CSV.

&nbsp;

Запрещено:

DML, grant-access-for-order, Telegram actions, provider API, changes to access_rules/entitlements/subscriptions_v2/secrets/mode.

&nbsp;

Artifacts:

.lovable/proofs/audit_ideology_business_access_2026_[05.md](http://05.md)

/mnt/documents/audit_ideology_business_users.csv

/mnt/documents/audit_ideology_business_missing_bonus.csv

Ключевое: **проверять не два, а три возможных тарифа**, если отдельный BUSINESS действительно есть в базе.

&nbsp;

План: PATCH-AUDIT-BUSINESS-IDEOLOGY-DISCOVERY-2026-05 (READ-ONLY)

## Цель

Полное discovery по всей базе: проверить, что каждый клиент с активной покупкой тарифа **ИДЕОЛОГИЯ** (Gorbova Club, `b018e9be-…`) и/или **Бизнес-леди** (CB20, `9bc81736-…`) фактически получил весь обещанный SOT-набор доступов и реально видит его в личном кабинете. Никаких изменений в БД, edge-функциях, секретах, Telegram, провайдере. Только SELECT + сводный отчёт.

## SOT-набор (что должно быть у держателя тарифа)

Источник правды — `public.access_rules` (`is_active=true`) по tariff_id.

### ИДЕОЛОГИЯ (`b018e9be-53ce-4840-8034-e09f8e319080`, product = Gorbova Club `11c9f1b8…`)

1. **Primary club access** — entitlement на `11c9f1b8…` (Gorbova Club), активная `subscriptions_v2`.
2. **Telegram (chat+channel клуба)** — `access_rules.grant_target_type='club'` для Gorbova Club; факт = `telegram_club_members` (`in_chat=true AND in_channel=true`, `access_status='ok'`).
3. **База знаний клуба** — `training_content` rule `384a670b…` (`access_mode=partial`, 19 разрешённых `module_ids`, `match_purchase_month=true`).
4. **Бонус: 9 продуктов CB20+модули** — `product_access` rule `f59d7b39…` (CB20 root + 8 модулей), условие `prior_purchase per_product`.
5. **Бонус: «Подоходный налог с физлиц»** (`4fc18564…`) — `product_access` rule `8bac4a16…`, условие `prior_purchase`.
6. `**section_access` «Нейросеть»** — rule `6fedf21d…`.
7. (доп. правила в `access_rules` — добираем полным списком в шаге 1.2).

### Бизнес-леди (`9bc81736…`, product = CB20 `7101ed3c…`)

1. **Primary CB20 access** — entitlement на `7101ed3c…`.
2. **База знаний CB20** — `training_content` rule `fc9e584e…` (`access_mode=partial`, 28 `module_ids`).
3. (доп. правила — добираем полным списком).

> Принцип «default-deny»: отсутствие явного правила ≠ «должен быть доступ». Telegram-grant ожидается ТОЛЬКО там, где есть `access_rules` с `grant_target_type='club'` для product_id.

## Когорта

```
orders_v2 paid с tariff_id ∈ {ИДЕОЛОГИЯ, Бизнес-леди}
  UNION
subscriptions_v2 (active|trial|past_due|canceled с access_end_at > now())
  с tariff_id ∈ {…}
  UNION
entitlements (active) c meta.tariff_id ∈ {…}
```

Резолв `user_id` через `orders_v2.user_id` / `subscriptions_v2.user_id` / `entitlements.user_id`, fallback profiles.

## Этапы (только SELECT)

### 1. Inventory

- 1.1 Полный список `access_rules` для обоих tariff_id (rule_id, target, conditions, duration_days).
- 1.2 Список `training_modules` под каждый `training_content` rule (для дальнейшей проверки видимости).
- 1.3 Список `target_product_ids` бонусных `product_access` rules.

### 2. Когорта

- 2.1 SELECT по `orders_v2` (paid, не `meta.source='rule_engine'`) + `subscriptions_v2` + `entitlements`. Собрать distinct `(user_id, tariff_id)`.
- 2.2 Резолв email/имя через `profiles`.

### 3. Per-user проверки (для каждой пары `user × tariff`)


| Чек                                                                | SOT                                                                                                                                   | Метод  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1. Primary entitlement                                            | `entitlements` active на product_id тарифа                                                                                            | SELECT |
| C2. Subscription окно (если recurring)                             | `subscriptions_v2.access_end_at > now()`                                                                                              | SELECT |
| C3. `ent.expires_at` ↔ `sub.access_end_at` δ ≤ 24h                 | оба                                                                                                                                   | SELECT |
| C4. `ent.meta.tariff_id` == `sub.tariff_id`                        | оба                                                                                                                                   | SELECT |
| C5. Telegram (только если есть club rule)                          | `telegram_club_members` (`in_chat`, `in_channel`, `access_status`)                                                                    | SELECT |
| C6. Bonus product entitlements (CB20+модули / Подоходный)          | по каждому `target_product_id` rule с `prior_purchase` — entitlement создан?                                                          | SELECT |
| C7. `training_content` allowlist соблюдён (база знаний)            | `useSidebarModules`/`resolveTrainingContentFilter` логика воспроизведена SQL'ом: active ent → allowed_module_ids → UI должен показать | SELECT |
| C8. `section_access` «Нейросеть» (только ИДЕОЛОГИЯ)                | `access_rules` + `section_access` factual                                                                                             | SELECT |
| C9. UI-видимость в библиотеке                                      | для каждого `target_product_id` из C6 — есть active entitlement (см. `cabinet-visibility-entitlement-dependency`)                     | SELECT |
| C10. Историческая CB1 (legacy «Ценный бухгалтер 1 ступень» до 2.0) | сверка с orders_v2 prior_purchase (`required_product_id`) — выполнено ли условие, и если да — выдан ли bonus                          | SELECT |


### 4. Gap-классификация (severity)


| gap_class                                                                                                           | severity      |
| ------------------------------------------------------------------------------------------------------------------- | ------------- |
| `missing_primary_entitlement`                                                                                       | critical      |
| `missing_telegram_when_expected` (club rule есть, `in_chat=false OR in_channel=false`)                              | critical      |
| `missing_bonus_product_entitlement` (`prior_purchase` выполнен, но bonus ent отсутствует)                           | high          |
| `partial_module_access_unexpected` (есть entitlement на CB20, но `training_content` allowlist у́же ожидаемого rule) | high          |
| `entitlement_present_but_invisible_in_ui` (resolver возвращает empty для root при active ent)                       | high          |
| `prior_purchase_unmet` (bonus rule не сработал, потому что нет required_product_id у user)                          | informational |
| `access_end_mismatch`                                                                                               | medium        |
| `tariff_id_mismatch` (`ent.meta.tariff_id` ≠ `sub.tariff_id`)                                                       | medium        |
| `telegram_link_missing` (`profiles.telegram_user_id IS NULL`) — нельзя выдать чисто invite                          | informational |
| `ok`                                                                                                                | low           |


### 5. Артефакты (read-only)

1. `.lovable/proofs/audit_ideology_business_access_2026_05.md` — методология, SOT-чек-листы, сводка, ТОП проблемных кейсов.
2. CSV: `/mnt/documents/audit_ideology_business_users.csv` — по строке на пару `(user, tariff)` со всеми C1–C10, gap_class, severity, recommended_action.
3. CSV: `/mnt/documents/audit_ideology_business_missing_bonus.csv` — детализация по C6/C9 (какой product_id не выдан).
4. `<presentation-artifact>` ссылки в финальном отчёте.

### 6. Recommended actions (НЕ выполняем в этом patch'е)

Для каждого gap указываем точечный canonical fix без запуска:

- `missing_primary_entitlement` → перепрогон `grant-access-for-order` по `sub_order_id`.
- `missing_telegram_when_expected` → manual reinvite через `telegram_access_queue` (`meta.source='reinvite'`) **только** при наличии `telegram_user_id`; иначе flow привязки бота.
- `missing_bonus_product_entitlement` → `grant-access-for-order` re-run (он сам резолвит prior_purchase rules).
- `partial_module_access_unexpected` → проверить, не висит ли stale partial entitlement из старого тарифа; ручной DML запрещён.
- `entitlement_present_but_invisible_in_ui` → invalidate React Query кеша или resolver-баг (отдельный patch).
- `access_end_mismatch` → выровнять через canonical writer (отдельный patch).

## DoD

- Все 5 артефактов сформированы.
- В отчёте указано: размер когорты, распределение по gap_class+severity, ТОП-20 critical/high кейсов с email/product/rule_id, для каждого — recommended canonical action.
- 0 DML, 0 вызовов `grant-access-for-order`, 0 Telegram-операций, 0 изменений `access_rules`/`entitlements`/`subscriptions_v2`/secrets/mode.
- БД не менялась (linter и snapshot до/после совпадают).

## Запрещено в этом патче

- Любой INSERT/UPDATE/DELETE.
- Вызов canonical writer'а или edge functions с побочными эффектами.
- Изменение `access_rules`, `entitlements`, `subscriptions_v2`, `telegram_club_members`, `telegram_access_queue`.
- Provider API, secrets/mode changes.
- Касание других тарифов/продуктов вне ИДЕОЛОГИЯ и Бизнес-леди.

## Уточнение перед execute

Подтверди трактовку «тариф Бизнес»:
(а) ИДЕОЛОГИЯ (Club, b018e9be…) — это и есть «Бизнес»-бандл, который ты имеешь в виду;
(б) Бизнес-леди (CB20, 9bc81736…) — второй тариф;
(в) проверять оба;
(г) есть третий тариф «Бизнес», который я упустил — назови id.

После approve выполню только шаги 1–5 (read-only), без recommended actions.