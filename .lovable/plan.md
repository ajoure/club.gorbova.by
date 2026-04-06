## Отчет о выполнении: CONSOLIDATED SPRINT

Это продолжение основной ревизии доступов. Главный вопрос: **почему пользователь реально видит конкретный продукт/модуль, на каком основании доступ существует, и какой слой является source of truth**.

---

### Закрытые патчи

| Патч | Статус | Комментарий |
|---|---|---|
| PATCH 1 | closed | — |
| PATCH 2 | partial | 12 ghost кейсов ждут fix |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** | code fixed, manual UI proof confirmed |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** | manual proof confirmed |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | **root cause proved** | — |

---

### Активные блоки

---

### Блок 1 — PATCH-KOROLYOVA-REVOKE-GUARD-FIX

**Root cause доказан.** `grant-access-for-order` создал подписку с `access_end_at` из прошлого (stale bePaid данные). Cron корректно увидел expired и сделал revoke. bePaid sync обновил дату через 3 часа.

#### Dry-run результаты

- **224** подписки за 2 месяца с `access_end_at < created_at`
- **0 active** среди stale — все expired/superseded
- **2 provider_managed** (Gorbova Club, expired) — именно паттерн Королёвой
- **221 mit** (ЗАКРОЙ ГОД) — исторический импорт с датами из прошлого, не опасны (все expired)

**Вывод:** проблема узкая, затрагивает только provider_managed подписки при создании через grant-access-for-order. Активного stale нет, но guard необходим для предотвращения повторения.

#### Два guard-а (оба вместе)

**Guard A — в `grant-access-for-order`:**
- При создании подписки: если `access_end_at < now()` и `billing_type = provider_managed`, установить `access_end_at = now() + 48h`
- Логировать: `stale_date_overridden: true`

**Guard B — в `telegram-kick-violators`:**
- Перед revoke: если подписка создана < 48h назад и `billing_type = provider_managed`, пропустить
- Логировать: `grace_skip: true`

**Статус: ready for execute. Dry-run завершён.**

---

### Блок 2 — PATCH 3 ACCESS-SCOPE-FORENSICS

#### Результаты discovery (Phase 1-4 завершены)

##### Классификация 519 активных entitlements по происхождению

| Bucket | Количество | Продукты |
|---|---|---|
| `direct_order_access` | **467** (90%) | cb20, prd_0d01a2fdc477, course_close_year, club, buh_business, cb_2_step, 1769009596189-398a |
| `subscription_without_order` | **49** (9.4%) | cb_module_ip (ВСЕ) |
| `manual_admin_access` | **3** (0.6%) | cb_module_marketplaces, cb_module_production, cb_module_retail |
| `unexplained_active_access` | **0** | — |

**Ключевой вывод:** 0 необъяснимых доступов. Все 519 entitlements имеют прослеживаемое происхождение.

##### 49 cb_module_ip — bulk_grant forensic

Все 49 подписок на Модуль ИП:
- Созданы **2026-03-27** одним системным batch (`bulk_grant_v6`, batch_id: `a2ff3724`)
- `meta_source: bulk_grant`, без order_id
- Tariff: Стандарт, `access_end_at: 2026-06-25`
- Entitlements созданы backfill-ом (v23.1.9B) из этих подписок
- **У всех 49 пользователей есть paid order на cb20 (1 ступень), но НЕТ paid order на cb_module_ip**

Это была **админ-операция массовой выдачи модульного доступа** пользователям, купившим 1 ступень.

##### Bonus parent check (170 entitlements на target-продуктах бонусного правила `1b497fba`)

| Parent basis | Количество | Описание |
|---|---|---|
| `valid_business_club` | **127** (75%) | Есть active Club BUSINESS — легальный бонус |
| `no_active_club` | **24** (14%) | Клуб expired или отсутствует |
| `wrong_tariff_club` | **19** (11%) | Клуб active, но тариф CHAT/FULL (не BUSINESS) |

**43 entitlements (24 + 19) на bonus-target продуктах не имеют валидного BUSINESS-клуба.**

НО: из этих 43 большинство имеют `direct_order_access` (paid order на сам продукт). Бонусное правило — не единственный путь получения entitlement. Нужна проверка: сколько из 43 реально зависят от bonus rule vs имеют прямой ордер.

##### Sample-case: Ирина Протасевич

| Ресурс | Данные | Происхождение | Легальность |
|---|---|---|---|
| Gorbova Club | expired 2026-02-25 | paid order, тариф CHAT | ✅ expired корректно |
| ЦБ 1 ступень (cb20) | entitlement до 2026-12-23 | paid order (Бизнес-леди) → backfill | ✅ direct order |
| ЦБ 2 ступень (prd_0d01a2fdc477) | entitlement до 2026-08-30 | paid order (Премиум) → csv_import | ✅ direct order |
| **Модуль ИП (cb_module_ip)** | **entitlement до 2026-06-25** | **bulk_grant subscription → backfill** | **⚠️ нет paid order** |
| ЗАКРОЙ ГОД | 2 orders paid, subs expired | paid orders | ✅ expired корректно |

**Протасевич: cb_module_ip выдан bulk_grant-ом 2026-03-27 без ордера. У неё тариф CHAT, бонусное правило НЕ применяется к CHAT. Доступ к модулю ИП — результат массовой админ-операции, а не автоматического бонуса.**

---

#### SoT hierarchy (зафиксировано)

```
Уровень 1 (Fact of access):     entitlements — primary SoT
Уровень 2 (Evidence/window):    subscriptions_v2, orders_v2
Уровень 3 (Rules):              access_rules (product_access, training_content, club)
Уровень 4 (UI visibility):      useSidebarModules → userEntitlementProductIds.has(effectiveProductId)
Уровень 5 (Content filter):     useTrainingContentRules → scope resolver
```

**Цепочка видимости модуля:**
1. `entitlements` содержит active запись на product_id модуля
2. `useSidebarModules.ts:134` проверяет `userEntitlementProductIds.has(effectiveProductId)`
3. Если entitlement есть → модуль виден в sidebar
4. `useTrainingContentRules` дополнительно фильтрует scope (partial/full)

**Вывод: пользователь видит модуль ПОТОМУ ЧТО у него есть entitlement. UI resolver не расширяет доступ сверх entitlements. Проблема не в resolver, а в том, КАК и КОМУ были выданы entitlements.**

---

#### CSV-артефакты (все сгенерированы)

| Файл | Строк | Описание |
|---|---|---|
| `access_origin_matrix.csv` | 519 | Все active entitlements с классификацией origin |
| `unexplained_active_access.csv` | 0 | Без valid basis (пусто — всё объяснено) |
| `module_active_without_direct_order.csv` | 52 | Модули без paid order (49 cb_module_ip + 3 manual) |
| `bonus_parent_check.csv` | 170 | Entitlements на bonus targets + club status |
| `overvisible_module_scope.csv` | 43 | Entitlements на bonus targets без valid BUSINESS club |

---

#### Промежуточные выводы PATCH 3

1. **Система не "течёт"** — 0 unexplained access, все 519 entitlements имеют прослеживаемый origin
2. **Главный anomaly-bucket:** 49 cb_module_ip выданы bulk_grant без ордеров. Это осознанная админ-операция, но без бизнес-правила
3. **43 entitlements на bonus targets** без валидного BUSINESS club — нужно проверить, сколько из них зависят от bonus vs имеют direct order
4. **Resolver не виноват** — видимость строго по entitlements, нет "утечки" через широкие условия

---

### STOP-guards

- До завершения PATCH 3 discovery запрещено: массовые revoke, fix visibility "вслепую"
- Не менять auth, RLS, edge functions (кроме guard-ов Королёвой)
- Сначала полная карта, потом execute

---

### Статус-блок

| Патч | Статус |
|---|---|
| PATCH 1 | closed |
| PATCH 2 | partial — 12 ghost кейсов ждут fix |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | **closed** |
| PATCH-DERGELEVA-BROWSER-PROOF | **closed** |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS | root cause proved |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX | **active — dry-run done, ready for execute** |
| PATCH 3 ACCESS-SCOPE-FORENSICS | **active — discovery phases 1-4 done** |
| PATCH-GHOST-PLACEHOLDER-NORMALIZATION | pending |
| PATCH-GHOST-CLAIM-BRIDGE-PROOF | pending — обязателен |
| PATCH 4 duration drift | pending |

---

### Следующие шаги

1. **PATCH-KOROLYOVA-REVOKE-GUARD-FIX:** имплементировать оба guard-а (edge functions)
2. **PATCH 3 Phase 5:** уточнить 43 overvisible — сколько зависят от bonus rule vs direct order
3. **PATCH 3 Phase 6:** resolver audit (useContainerLessons, useTrainingContentRules) — подтвердить, что scope фильтрация корректна
4. **Решение по 49 cb_module_ip:** бизнес-решение — оставить или revoke после 2026-06-25
