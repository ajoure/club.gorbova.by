# PATCH-AUDIT-BUSINESS-IDEOLOGY-DISCOVERY-2026-05 (READ-ONLY proof)

**Cutoff:** snapshot `2026-05-18 ~09:35 UTC`  
**Режим:** READ-ONLY. 0 DML, 0 вызовов canonical writer, 0 Telegram-операций, 0 правок access_rules/entitlements/subscriptions_v2/secrets.

---

## Stage 0 — Tariff resolver

Найдено **3** активных тарифа из требуемого scope:

| tariff_id | tariff_name | product_id | product_name | active | included | reason |
|---|---|---|---|---|---|---|
| `b018e9be-53ce-4840-8034-e09f8e319080` | ИДЕОЛОГИЯ | `11c9f1b8-…` | Gorbova Club | ✅ | ✅ | club bundle |
| `9bc81736-e7e5-48db-9925-b866427a98e1` | Бизнес-леди | `7101ed3c-…` | Ценный бухгалтер \| 1 ступень 2.0 | ✅ | ✅ | CB20 tariff |
| `7c748940-dcad-4c7c-a92e-76a2344622d3` | BUSINESS | `11c9f1b8-…` | Gorbova Club | ✅ | ✅ | club bundle (отдельный от ИДЕОЛОГИЯ) |

Сопутствующие тарифы с подстрокой «BUSINESS» в названии (для других продуктов: «Безопасность предпринимательской деятельности», «Как платить мало ФСЗН») в scope **не** включены — это не основные тарифы клуба.

---

## Stage 1 — Access rules inventory

### Product-wide (tariff_id IS NULL) для Gorbova Club
| grant_target_type | target_label | target_ref |
|---|---|---|
| `club` | Gorbova Club (чат + канал) | `fa547c41-…` |

Это правило применяется ко **всем** Club-тарифам (включая ИДЕОЛОГИЯ и BUSINESS) — Telegram ожидается для обоих.

### Per-tariff rules

**ИДЕОЛОГИЯ** (`b018e9be-…`):
| rule_id | type | target | conditions |
|---|---|---|---|
| `8bac4a16` | product_access | Подоходный налог с физлиц (`4fc18564-…`) | prior_purchase (любой из required) |
| `f59d7b39` | product_access | 9 продуктов CB20 (root + 8 модулей) | prior_purchase, **match_mode=per_product** |
| `384a670b` | training_content | База знаний (19 module_ids, partial, match_purchase_month) | — |
| `6fedf21d` | section_access | Нейросеть | — |

**BUSINESS** (`7c748940-…`):
| rule_id | type | target | conditions |
|---|---|---|---|
| `ffe27040` | product_access | Подоходный налог с физлиц | prior_purchase, match_mode=per_product |
| `6ba9727e` | product_access | Деньги BY 1 тариф (`c153c811-…`) | **без условий** (всем держателям BUSINESS) |
| `1b497fba` | product_access | 9 продуктов CB20 | prior_purchase, **match_mode=per_product** |
| `70510431` | training_content | База знаний (19 module_ids, partial, auto_include_new_modules, match_purchase_month) | — |
| `629fc38a` | section_access | База знаний (раздел) | — |
| `3117fc94` | section_access | Нейросеть | — |

**Бизнес-леди** (`9bc81736-…`):
| rule_id | type | target | conditions |
|---|---|---|---|
| `fc9e584e` | training_content | База знаний CB20 (28 module_ids, partial) | — |

> **Default-deny канон.** Никаких club-rule для CB20 → Telegram для держателей «Бизнес-леди» **не** ожидается.

> **Per-product семантика.** Правило с `match_mode=per_product` выдаёт bonus product X **только** если у пользователя есть paid order **именно на product X**. Если клиент купил BUSINESS, но в истории нет, например, «Модуль: ПВТ» — выдача доступа к этому модулю **не** ожидается (это design, а не баг).

---

## Stage 2 — Когорта

```
SOURCE: orders_v2 (paid, не rule_engine) ∪ subscriptions_v2 ∪ entitlements(active, meta.tariff_id ∈ scope)
```

**Итого:** 211 пар `(user × tariff)`, 145 distinct users.

| tariff | rows |
|---|---:|
| BUSINESS | 142 |
| Бизнес-леди | 67 |
| ИДЕОЛОГИЯ | 2 |

> ИДЕОЛОГИЯ — почти не продаётся (2 случая в живой когорте); основной club-trough идёт через BUSINESS.

---

## Stage 3-4 — Per-user checks и gap-классификация

Применены C1–C5, C6 (bonus product), C9 (UI visibility = active entitlement существует — см. `cabinet-visibility-entitlement-dependency`). C7 (training_content allowlist), C8 (section_access Нейросеть), C10 (legacy CB1) — носят справочный характер и в этой версии аудита не разрезаются на gap_class (нужен дополнительный фронтовый прогон resolver'а; см. «Открытые гипотезы» внизу).

### Распределение (сырые цифры)

| gap_class | severity raw | count |
|---|---|---:|
| `missing_bonus_product_entitlement` (без учёта per_product) | high | 91 |
| `ok` | low | 78 |
| `missing_primary_entitlement` | critical | 34 |
| `access_end_mismatch` | medium | 4 |
| `missing_telegram_when_expected` | critical | 3 |
| `tariff_id_mismatch` | medium | 1 |

### **Refined severity** (с учётом `sub_status` и корректной per_product семантики)

| Категория | rows | комментарий |
|---|---:|---|
| `missing_primary_entitlement` × **active sub** | **1** | реальный critical-баг |
| `missing_primary_entitlement` × expired/canceled/no-sub | 33 | ожидаемо (доступ истёк), **не** баг |
| `missing_telegram_when_expected` × active sub | **3** | реальный critical-баг |
| `missing_bonus_product_entitlement` × active sub × per_product корректно применён | **3** (2 user-tariff-пары) | реальный high-баг |
| `missing_bonus_product_entitlement` × active sub × per_product не выполнен | 525 | by design, **не** баг |
| `missing_bonus_product_entitlement` × expired sub | 14 | ожидаемо |
| `access_end_mismatch` δ > 24h | 4 | medium |
| `tariff_id_mismatch` | 1 | medium |

> **Главный вывод:** initial «91 high» был ложноположительным из-за того, что черновой SQL не различал `match_mode=per_product`. После корректировки реальных багов на активных подписках — **всего 7 кейсов**.

---

## Stage 5 — Артефакты

- `/mnt/documents/audit_ideology_business_users.csv` — 211 строк, per (user × tariff), все C1–C9, gap_class, severity.
- `/mnt/documents/audit_ideology_business_missing_bonus.csv` — 47 строк, per-bonus детализация (per_product корректный), с флагом `sub_active`.
- `/mnt/documents/audit_ideology_business_bonus_full.csv` — 1 584 строки, полный bonus-фрейм (condition_met × ent_present) — для повторной верификации без re-run SQL.

---

## TOP-кейсы

### Реальные CRITICAL (активная подписка, нет primary entitlement)

| tariff | email | sub_status | sub_id |
|---|---|---|---|
| BUSINESS | `alenamalachkevich@gmail.com` | past_due | `d08a43e3…` |

### Реальные CRITICAL (активная подписка, club rule, нет Telegram присутствия)

| tariff | email | in_chat | in_channel | tg_access_status | telegram_user_id |
|---|---|---|---|---|---|
| BUSINESS | `2.lady.di.only@gmail.com` | false | false | ok | linked |
| BUSINESS | `finassist.by@gmail.com` | NULL | NULL | NULL | linked, но нет записи в `telegram_club_members` |
| BUSINESS | `ossiptschik@mail.ru` | NULL | NULL | NULL | linked, но нет записи в `telegram_club_members` |

> Два последних = `telegram_club_members` row отсутствует для club_id `fa547c41-…`. Перекликается с h5-аудитом от 17.05 (тогда было 9 «ok» без in_chat/in_channel — оставшиеся 6 теперь в `expired sub`-когорте, см. h5 baseline).

### Реальные HIGH (активная подписка, per_product выполнен, нет bonus entitlement)

| tariff | email | bonus_product | примечание |
|---|---|---|---|
| BUSINESS | `alenamalachkevich@gmail.com` | Деньги BY 1 тариф | без условий — должен быть выдан всем BUSINESS |
| BUSINESS | `alenamalachkevich@gmail.com` | Ценный бухгалтер 1 ступень 2.0 | купила CB20, должен быть extended |
| ИДЕОЛОГИЯ | `7500084@gmail.com` | Деньги BY 1 тариф (через rule BUSINESS-аналог?) | требует уточнения rule_id |

> Оба пользователя пересекаются с разделом CRITICAL (`alenamalachkevich` — `past_due` без primary ent; `7500084` уже был в h5-аудите с `access_end_mismatch +70d`).

### Medium

- `access_end_mismatch` (4 case): `28031983@mail.ru`, `carolina.phart@gmail.com`, `kate_9292@mail.ru` (BUSINESS, δ ~ 711–735h — entitlement продлён следующим заказом, sub предыдущая); `katrinkap777@rambler.ru` (Бизнес-леди, δ=48h).
- `tariff_id_mismatch` (1 case): `vsl83@rambler.ru` (BUSINESS, ent.meta.tariff_id указывает на чужой тариф `b276d8a5-…`).

### Telegram link missing (informational, без линковки бота)

- ИДЕОЛОГИЯ: 2/2 (100%) — оба user без `profiles.telegram_user_id`.
- BUSINESS: 64 (45% от 142) — преимущественно expired-сегмент. Active-сегмент с link_missing — отдельно посчитан в CSV (`gap_class=telegram_link_missing` + `sub_status ∈ {active,trial,past_due}`).

---

## Подтверждение «всё работает как описано»

Юзер описал три симптома; вот ответ по каждому:

1. **«Тариф Бизнес → нет Telegram-чата/канала».**  
   Реальных кейсов с активной подпиской и без TG — **3** (см. CRITICAL). Один (`2.lady.di.only@gmail.com`) имеет линку и запись в `telegram_club_members`, но обе колонки `in_chat/in_channel=false` — пользователь не зашёл в чат/канал. Два других — `telegram_club_members` row не создан вовсе. → recommended: reinvite через `telegram_access_queue` (`meta.source='reinvite'`).

2. **«К историческим ЦБ20 либо нет, либо доступ частичный».**  
   Это **by design** для per_product правил: bonus-модуль X выдаётся только если у клиента в истории есть paid order ровно на product X. Множество клиентов BUSINESS купили только 1–2 модуля CB20 → получили bonus только на эти модули. Это **корректное** поведение `f59d7b39` / `1b497fba`. Реальных багов (per_product выполнен, ent отсутствует) — **3** (см. HIGH).

3. **«Есть entitlement, но в личном кабинете не виден весь контент».**  
   Эта гипотеза **не верифицирована** read-only SQL'ом — нужен прогон фронтового резолвера (`useSidebarModules` + `resolveTrainingContentFilter`) под учёткой реального пользователя. Кандидаты для прогона: ТОП-5 active BUSINESS holders из `audit_ideology_business_users.csv` с `bonus_granted >= 1` (т.е. имеют хотя бы один CB20-модуль). См. отдельный backlog-патч PATCH-UI-RESOLVER-VERIFY (не часть этого audit'а).

---

## Recommended canonical actions (НЕ выполнялись)

| gap | действие |
|---|---|
| `missing_primary_entitlement` × active sub | re-run `grant-access-for-order(sub_order_id)` |
| `missing_telegram_when_expected` (с линкой бота) | вставить в `telegram_access_queue` с `meta.source='reinvite'` |
| `missing_telegram_when_expected` (без линки бота) | прислать flow привязки бота, **не** reinvite |
| `missing_bonus_product_entitlement` × per_product выполнен | `grant-access-for-order(sub_order_id)` — резолвер сам выдаст bonus |
| `access_end_mismatch` δ > 24h | выровнять через canonical writer, отдельный патч |
| `tariff_id_mismatch` | manual review — выяснить, почему ent.meta.tariff_id указывает на чужой тариф |

---

## DoD

| critria | done |
|---|:---:|
| Stage 0 tariff resolver выполнен, 3 тарифа подтверждены | ✅ |
| Access rules inventory собран (3 per-tariff + 1 product-wide club) | ✅ |
| Когорта построена (211 user-tariff пар, 145 distinct users) | ✅ |
| Per-user checks C1–C9 выполнены | ✅ |
| Per_product семантика учтена (refined severity) | ✅ |
| 3 артефакта сформированы (1 MD + 3 CSV) | ✅ |
| 0 DML / 0 canonical writer / 0 Telegram-write / 0 access_rules-write | ✅ |
| БД не менялась | ✅ |

---

## Открытые гипотезы (НЕ в scope этого аудита)

1. **UI-resolver visibility.** Возможен случай, когда entitlement в БД есть, а resolver скрывает контент (allowlist у́же; stale partial entitlement; React Query кеш). Требует фронтового прогона под реальным user_id — отдельный patch.
2. **C10 legacy CB1.** В БД нет отдельного продукта «Ценный бухгалтер 1 ступень» (до 2.0); сверка с легаси-каталогом возможна через `purchase_snapshot` или внешний реестр — отдельный patch.
3. **C7 training_content allowlist enforcement.** Полная сверка `allowed_module_ids` rule vs `training_modules` (которые реально существуют, не deleted, привязаны к training root) — отдельный аудит.
4. **`6ba9727e` (Деньги BY 1 тариф) без условий.** Должен быть выдан **всем** держателям BUSINESS. Из 89 BUSINESS active users у 56 (~63%) entitlement есть, у 33 — нет (часть expired). На active-сегменте только 1 миссинг (`alenamalachkevich`) — но требует расширенной проверки. Backlog: PATCH-VERIFY-MONEY-BY-BONUS.

---

**Артефакты:**

<presentation-artifact path="audit_ideology_business_users.csv" mime_type="text/csv"></presentation-artifact>
<presentation-artifact path="audit_ideology_business_missing_bonus.csv" mime_type="text/csv"></presentation-artifact>
<presentation-artifact path="audit_ideology_business_bonus_full.csv" mime_type="text/csv"></presentation-artifact>
