## Отчет о выполнении: CONSOLIDATED SPRINT — ACCESS-SCOPE-FORENSICS

Главный вопрос: **почему у пользователя есть конкретный доступ, почему он видит конкретный модуль, как это названо в UI, и совпадает ли с реальной сущностью в БД**.

---

### Статус-блок

| Патч | Статус |
|---|---|
| PATCH 1 | closed |
| PATCH 2 | partial — 12 ghost кейсов |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** — manual proof |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** — manual proof |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **root cause proved** |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX | **done** — Guard A + Guard B deployed |
| PATCH-GHOST-PLACEHOLDER-NORMALIZATION | pending |
| PATCH-GHOST-CLAIM-BRIDGE-PROOF | pending |
| PATCH 3 ACCESS-SCOPE-FORENSICS | **done — phases 1-9** |
| — Phase 5: 43 overvisible classification | done |
| — Phase 6: naming audit | done |
| — Phase 7: default-deny visibility | done |
| — Phase 8: purchase→access→visibility matrix | done |
| — Phase 9: product card access SoT | done |
| PATCH-PRODUCT-MODULE-TARIFF-NAMING-AUDIT | **done** (Phase 6) |
| PATCH-DEFAULT-DENY-TRAINING-VISIBILITY | **done** (Phase 7) |
| PATCH-PRODUCT-CARD-ACCESS-SOT | **done** (Phase 9) |
| PATCH 4 duration drift | pending |

---

### PATCH-KOROLYOVA-REVOKE-GUARD-FIX — DONE

**Guard A** (`grant-access-for-order`): если `accessEndAt < now()` при создании подписки → override на `now() + 48h`. Логирование: `subscription.stale_date_overridden`.

**Guard B** (`telegram-kick-violators`): перед kick проверяет наличие `provider_managed` подписки, созданной < 48h назад → skip kick с audit `KICK_SKIP_PROVIDER_GRACE`.

Оба guard-а задеплоены.

---

### PATCH 3 ACCESS-SCOPE-FORENSICS — Результаты

#### Phase 5: 43 overvisible → классификация

| Bucket | Кол-во | Описание |
|---|---|---|
| HAS_DIRECT_ORDER | 37 | cb20, есть paid order — легально |
| NO_CLUB_BASIS | 6 | cb_module_ip, нет paid order, нет active club — **аномалия** |

6 аномальных кейсов = entitlement на cb_module_ip, source=historical_backfill от subscription без order. Все 49 cb_module_ip подписок — от admin bulk_grant_v6 (2026-03-27).

#### Phase 6: Naming audit

| Anomaly | Кол-во |
|---|---|
| ok | 1949 |
| module_missing_module_label | 19 |
| no_name_anywhere | 18 |

Модули cb_module_* в БД именуются: `Ценный бухгалтер | 1 ступень 2.0 | Модуль: X` — содержат слово «Модуль», но начинаются с названия родительского продукта. 18 заказов без product_id → не имеют названия.

#### Phase 7: Default-deny visibility

| Anomaly | Кол-во |
|---|---|
| access_controlled | 56 |
| active_without_access_binding | 3 |

3 тренинговых модуля без product_id и без module_access → видимы всем по умолчанию.

#### Phase 8: Purchase→Access→Visibility matrix

| Anomaly | Кол-во |
|---|---|
| ok | 510 |
| paid_but_no_entitlement | 102 |
| entitled_without_direct_order | 49 |
| subscribed_without_order | 10 |
| entitled_without_purchase_or_sub | 3 |

102 кейса `paid_but_no_entitlement` — заказы, для которых не был создан entitlement (возможно исторические).

#### Phase 9: Product card Access SoT

- `ProductAccessRulesTab` читает из `access_rules` — это **конфигурационный инструмент**, не SoT фактического доступа.
- Фактический SoT: `entitlements` (кто имеет) + `subscriptions_v2` (кто платит).
- Вкладка «Доступы» продукта показывает **правила выдачи**, а не реальных получателей.
- cb_module_ip: 49 active entitlements, 59 active subscriptions, 0 paid orders.

#### Sample-case: Протасевич

| Слой | Продукт | Статус | Срок | Basis |
|---|---|---|---|---|
| ORDER | Gorbova Club (CHAT) | paid | 2026-01-26 | club expired |
| ORDER | ЦБ 1 ступень (Бизнес-леди) | paid | 2026-03-28 | ✅ direct |
| ORDER | ЦБ 2 ступень (Премиум) | paid | 2026-03-29 | ✅ direct |
| ORDER | ЗАКРОЙ ГОД (x2) | paid | 2026-03-29 | ✅ direct |
| SUB | cb_module_ip | active | 2026-06-25 | ⚠️ bulk_grant, no order |
| SUB | prd_0d01a2fdc477 (2 ступень) | active | 2026-08-30 | ✅ from order |
| ENT | cb_module_ip | active | 2026-06-25 | ⚠️ historical_backfill from sub |
| ENT | prd_0d01a2fdc477 | active | 2026-08-30 | ✅ from order |
| ENT | cb20 | active | 2026-12-23 | ✅ historical_backfill from order |

**Вывод по Протасевич:** cb_module_ip — необоснованный доступ. Нет paid order. Subscription создана admin bulk_grant. Club CHAT не дает бонусов. UI-название `Ценный бухгалтер | 1 ступень 2.0 | Модуль: Учет у ИП` — содержит модуль, но начинается с названия основного продукта.

---

### Source-of-Truth Hierarchy (зафиксировано)

1. **orders_v2** — факт оплаты (purchase basis)
2. **subscriptions_v2** — период активного доступа (access period)
3. **entitlements** — факт наличия права (access fact, canonical SoT)
4. **access_rules** — конфигурационная логика выдачи (config)
5. **training_modules + useSidebarModules** — UI visibility resolver (1:1 с entitlements)

Вкладка продукта «Доступы» = access_rules (config), НЕ entitlements (fact).

---

### Артефакты (CSV)

| Файл | Строк | Описание |
|---|---|---|
| access_origin_matrix.csv | ранее | Классификация 519 entitlements |
| module_active_without_direct_order.csv | ранее | 49 cb_module_ip без orders |
| bonus_parent_check.csv | ранее | Бонусные entitlements + клуб |
| overvisible_module_scope.csv | ранее | 43 overvisible |
| deal_product_naming_audit.csv | 1987 | Naming audit всех paid orders |
| mislabelled_ui_entities.csv | 37 | Модули, названные как родитель |
| default_deny_training_visibility_audit.csv | 59 | Все active training modules + binding |
| purchase_to_access_to_visibility_matrix.csv | 2048 | Полная матрица |
| product_access_tab_sot_audit.csv | 26 | Все products + access data |

---

### STOP-guards

- **До утверждения execute-патча запрещено:**
  - Массовые revoke по cb_module_ip
  - Массовые revoke bonus access
  - Изменение UI labels без матрицы
- Не менять auth, RLS, edge functions (кроме Korolyova guards — done)
- Сначала полная карта, потом execute

---

### Следующие шаги (pending approval)

1. **Execute-решение по 49 cb_module_ip** — revoke или оставить? Все от admin bulk_grant, без orders.
2. **3 training modules без access binding** — добавить binding или скрыть?
3. **102 paid_but_no_entitlement** — создать missing entitlements?
4. **18 orders без product_id** — привязать к продуктам?
5. **Naming normalization** — сделать UI-название модулей отличимым от parent product?
