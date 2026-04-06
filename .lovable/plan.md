## да, согласен, с учетом правок:

&nbsp;

1. **Снять отдельный блок PATCH-DERGELEVA-BROWSER-PROOF**
  &nbsp;
  - Зафиксировать как **closed by manual proof**.
  - Основание: вы уже проверили несколько кейсов из техподдержки и из контакт-центра, реальные карточки открываются одинаково, доступы отображаются корректно.
  - Больше время на этот блок не тратить.
  &nbsp;
2. **Обновить статус PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX**
  &nbsp;
  - Было: code done, browser-proof pending
  - Должно стать: closed — code fixed, manual UI proof confirmed
  &nbsp;
3. **Основной фокус перенести на общий forensic по доступам**
  &nbsp;
  - Теперь главный активный блок:
    &nbsp;
    - PATCH 3 ACCESS-SCOPE-FORENSICS
    &nbsp;
  - Именно туда перенести весь дальнейший анализ:
    &nbsp;
    - почему у пользователей активны модули,
    - почему они что-то видят в библиотеке,
    - на каком основании существуют active subscriptions / entitlements,
    - где есть необъяснимые доступы.
    &nbsp;
  &nbsp;
4. **Протасевич включить в PATCH 3 как sample-case высокого приоритета**
  &nbsp;
  - Не отдельным патчем, а как один из доказательных кейсов внутри общего forensic.
  - Обязательная задача:
    &nbsp;
    - объяснить происхождение cb_module_ip,
    - объяснить происхождение cb20,
    - объяснить происхождение prd_0d01a2fdc477,
    - отдельно показать, какой из этих доступов основан на paid order, какой на subscription, какой на backfill, и какой не имеет нормального valid basis.
    &nbsp;
  &nbsp;
5. **Расширить PATCH 3 до полной матрицы “что выдано / что видно / почему”**
  &nbsp;
  - Не ограничиваться entitlements.
  - Проверять одновременно:
    &nbsp;
    - orders_v2
    - subscriptions_v2
    - entitlements
    - access_rules
    - training_modules
    - training_content_rules
    - library/sidebar resolver
    - impersonation visibility
    &nbsp;
  - Цель: получить один ответ на вопрос, **почему конкретный модуль виден пользователю прямо сейчас**.
  &nbsp;
6. **Добавить отдельный forensic-bucket для модулей, активных без явной покупки**
  &nbsp;
  - Новый bucket:
    &nbsp;
    - module_active_without_direct_order
    &nbsp;
  - Туда попадут кейсы вроде Протасевич, где:
    &nbsp;
    - paid order на модуль нет,
    - entitlement/subscription на модуль есть,
    - нужно доказать источник появления.
    &nbsp;
  &nbsp;
7. **Добавить bucket для пользователей, которые видят слишком много**
  &nbsp;
  - Новый bucket:
    &nbsp;
    - overvisible_module_scope
    &nbsp;
  - Туда включать пользователей, у которых:
    &nbsp;
    - есть доступ к одному продукту/модулю,
    - но в библиотеке или после impersonation видны дополнительные модули, не подтверждённые access basis.
    &nbsp;
  &nbsp;
8. **Добавить обязательный global audit на случаи “не платил, но видит”**
  &nbsp;
  - Проверить:
    &nbsp;
    - пользователи без paid orders, но с active entitlements,
    - пользователи без active subscriptions, но с видимыми trainings/modules,
    - пользователи с expired club, но с активными child modules,
    - пользователи, у которых source access = backfill/import/manual, но UI даёт полноценную видимость как у платного доступа.
    &nbsp;
  &nbsp;
9. **Уточнить source-of-truth hierarchy**
  &nbsp;
  - В PATCH 3 прямо потребовать определить и задокументировать:
    &nbsp;
    - что является SoT для доступа:
      &nbsp;
      - order,
      - subscription,
      - entitlement,
      - access_rule,
      - training resolver.
      &nbsp;
    &nbsp;
  - Пока эта иерархия не зафиксирована, хаос будет повторяться.
  &nbsp;
10. **Королёву оставить отдельным параллельным блоком, но не смешивать с PATCH 3**

&nbsp;

&nbsp;

&nbsp;

- PATCH-KOROLYOVA-REVOKE-GUARD-FIX продолжать отдельно.
- Это другая проблема: stale / wrong access_end_at и revoke race.
- Не смешивать её с модульной видимостью и bonus/module anomalies.

&nbsp;

&nbsp;

&nbsp;

11. **Скорректировать порядок работ**

&nbsp;

&nbsp;

&nbsp;

- Новый порядок:
  &nbsp;
  1. PATCH-KOROLYOVA-REVOKE-GUARD-FIX
  2. PATCH 3 ACCESS-SCOPE-FORENSICS
  3. потом уже execute-патчи на revoke/fix по результатам forensic
  &nbsp;
- PATCH-DERGELEVA... убрать из активной очереди как закрытый.

&nbsp;

&nbsp;

&nbsp;

12. **Обновить статус-блок**

&nbsp;

&nbsp;

&nbsp;

- Должно быть так:
  &nbsp;
  - PATCH 1 — closed
  - PATCH 2 — partial
  - PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX — closed
  - PATCH-KOROLYOVA-REVOKE-GUARD-FIX — active
  - PATCH 3 ACCESS-SCOPE-FORENSICS — active discovery
  - PATCH-GHOST-PLACEHOLDER-NORMALIZATION — pending
  - PATCH-GHOST-CLAIM-BRIDGE-PROOF — pending
  - PATCH 4 duration drift — pending
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

13. **Добавить жесткий промежуточный результат PATCH 3**

&nbsp;

&nbsp;

&nbsp;

- До любого execute подрядчик обязан выдать:
  &nbsp;
  - access_origin_matrix.csv
  - access_visibility_matrix.csv
  - unexplained_active_access.csv
  - module_active_without_direct_order.csv
  - overvisible_module_scope.csv
  &nbsp;
- Без этих артефактов никаких revoke/fix не согласовывать.

&nbsp;

&nbsp;

&nbsp;

14. **Главный вопрос спринта сформулировать жёстко**

&nbsp;

&nbsp;

&nbsp;

- Не “почему есть illegal bonus”.
- А:
  &nbsp;
  - **почему у конкретного пользователя есть конкретный активный доступ,**
  - **почему он видит конкретный модуль,**
  - **какой объект это разрешил,**
  - **и является ли это поведение легальным и ожидаемым.**
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

15. **Требование к следующему сообщению подрядчика**

&nbsp;

&nbsp;

&nbsp;

- Теперь нужен уже не общий пересказ, а **обновлённый consolidated plan без блока Дергелёвой**, где в активной работе остаются только:
  &nbsp;
  - PATCH-KOROLYOVA-REVOKE-GUARD-FIX
  - PATCH 3 ACCESS-SCOPE-FORENSICS
  &nbsp;
- И с отдельным акцентом на:
  &nbsp;
  - Протасевич как sample-case,
  - глобальный аудит “видит лишнее / выдано лишнее / нет valid basis”.
  &nbsp;

&nbsp;

&nbsp;

План: CONSOLIDATED SPRINT — Browser-proof + Korolyova guard + ACCESS-SCOPE-FORENSICS

Это продолжение основной ревизии доступов. Главный вопрос: **почему пользователь реально видит конкретный продукт/модуль, на каком основании доступ существует, и какой слой является source of truth**.

---

### Общая линия

Три параллельных блока в одной нити:

1. **PATCH-DERGELEVA-BROWSER-PROOF** — закрытие UI resolver fix
2. **PATCH-KOROLYOVA-REVOKE-GUARD-FIX** — remediation race condition
3. **PATCH 3 ACCESS-SCOPE-FORENSICS** — полная карта фактического доступа (bonus / modules / visibility)

---

### Блок 1 — PATCH-DERGELEVA-BROWSER-PROOF

Код исправлен (`useTickets.ts` + `ContactDetailSheet.tsx`). Нужен browser-proof.

**Действия:**

1. Открыть Дергелёву из Support (тикет `c1723827`, profile `2fe0679d`)
2. Открыть её из Telegram/Inbox
3. Зафиксировать: подписки видны, ghost-warning исчез, counts совпадают

**DoD:**

- Ghost-warning для live-контакта исчез
- Подписки и сделки отображаются одновременно из Support
- Counts доступов совпадают между двумя entry path

---

### Блок 2 — PATCH-KOROLYOVA-REVOKE-GUARD-FIX

**Root cause доказан:** `grant-access-for-order` создал подписку `dea78a37` с `access_end_at` из прошлого (скопировано из stale bePaid данных). Cron корректно увидел expired и сделал revoke. bePaid sync обновил дату только через 3 часа.

**Два guard-а (оба вместе):**

**Guard A — в `grant-access-for-order`:**

- При создании подписки: если `access_end_at < now()` и `billing_type = provider_managed`, установить `access_end_at = now() + 48h` (safe placeholder до bePaid sync)
- Логировать: `stale_date_overridden: true`

**Guard B — в `telegram-kick-violators`:**

- Перед revoke: если подписка создана < 48h назад и `billing_type = provider_managed`, пропустить (grace period для sync)
- Логировать: `grace_skip: true`

**Порядок:**

1. Dry-run: найти все подписки за последний месяц с `access_end_at < created_at`
2. Impact analysis: сколько таких кейсов
3. Имплементация обоих guard-ов
4. Proof: revoke не срабатывает для аналогичного сценария

**Изменяемые файлы:**

- `supabase/functions/grant-access-for-order/index.ts` — guard на stale date
- `supabase/functions/telegram-kick-violators/index.ts` — grace period

---

### Блок 3 — PATCH 3 ACCESS-SCOPE-FORENSICS

**Переименован из `illegal_bonus_access`.** Цель — не просто найти нелегальные бонусы, а построить полную матрицу фактического доступа.

#### Sample-case: Ирина Протасевич

Предварительные данные из DB:

```text
Тариф клуба: CHAT (expired 2026-02-25) — бонусного правила НЕТ (только BUSINESS)
Оплаченные заказы:
  - ЦБ 1 ступень (Бизнес-леди) — paid
  - ЦБ 2 ступень (Премиум) — paid, до 2026-08-30
  - ЗАКРОЙ ГОД — paid (x2)
Активные entitlements:
  - cb20 (1 ступень) — expires 2026-12-23 — source: backfill from order ✅
  - prd_0d01a2fdc477 (2 ступень) — expires 2026-08-30 — source: csv import ✅
  - cb_module_ip (Модуль ИП) — expires 2026-06-25 — source: backfill from subscription ⚠️
    НЕТ paid order на этот модуль!
Active subscriptions:
  - ЦБ 2 ступень (active, до 2026-08-30)
  - Модуль ИП (active, до 2026-06-25) — откуда?
```

**Вопрос по Протасевич:** entitlement на `cb_module_ip` создан из subscription, но paid order на Модуль ИП отсутствует. Подписка на модуль ИП тоже без ордера — нужно выяснить происхождение.

По словам заказчика: у неё CHAT тариф, который **не имеет бонусного правила**. Реально должен быть только доступ к ЦБ 2 ступень до августа. Остальное — потенциально необоснованный доступ.

#### Phase 1 — Классификация ВСЕХ активных entitlements по происхождению

Для каждого из 519 активных entitlements определить source:


| Bucket                       | Условие                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `direct_order_access`        | Есть paid order на тот же product_id                                      |
| `subscription_access`        | Есть active/trial подписка без paid order                                 |
| `bonus_rule_access`          | Нет direct order/sub, но есть active Club BUSINESS + prior_purchase match |
| `manual_admin_access`        | meta содержит `admin_grant` или `manual`                                  |
| `legacy_import_access`       | meta содержит `csv_import` или `historical_backfill` без order            |
| `unknown_unexplained_access` | Не попадает ни в один bucket                                              |


#### Phase 2 — Проверка parent basis для bonus entitlements

Для каждого entitlement на target-продуктах бонусного правила `1b497fba`:

- Есть ли у user_id активная подписка на Gorbova Club (BUSINESS tariff)?
- Если Club expired → `illegal_bonus_access`
- Если Club active но CHAT/FULL (не BUSINESS) → `wrong_tariff_bonus`

#### Phase 3 — Module inheritance audit

Собрать:

- Какие продукты — "главные" (parent), какие — модули (child)
- Где хранится связь parent → module (access_rules.conditions.target_product_ids)
- Есть ли fallback "если есть доступ к ступени — показать все модули"
- Проверить `useSidebarModules.ts` строка 134: `userEntitlementProductIds.has(effectiveProductId)` — достаточно entitlement на product, чтобы модуль был видим

**Ключевой код (useSidebarModules.ts:126-136):**

```text
effectiveProductId = m.product_id ?? parent.product_id
hasAccess = isAdminUser || userEntitlementProductIds.has(effectiveProductId)
```

Модуль виден, если у пользователя есть **любой active entitlement** на `effectiveProductId`. Это значит:

- entitlement на `cb20` → видны ВСЕ child-модули с `product_id = cb20`
- entitlement на отдельный модуль (cb_module_ip) → виден конкретный модуль

#### Phase 4 — Visibility vs entitlement matrix

Глобальная проверка:

- Пользователи без active subscriptions, но с active entitlements
- Пользователи с expired club, но с active child module entitlements
- Пользователи с entitlement на product, для которого нет paid order И нет active subscription

#### Phase 5 — Обязательные артефакты (CSV)

1. `**access_origin_matrix.csv**` — по строкам: user_id, product_code, product_name, has_paid_order, has_active_sub, has_active_entitlement, source_type, expires_at, anomaly_type
2. `**unexplained_active_access.csv**` — только кейсы без valid basis: модуль/продукт активен, но нет ясного основания
3. `**bonus_parent_check.csv**` — все entitlements на bonus-target продуктах + статус родительского Club/BUSINESS

#### Phase 6 — Training/library resolver audit

Проверить цепочку видимости:

1. `useSidebarModules.ts` — entitlement → module visibility
2. `useContainerLessons.ts` — lesson visibility
3. `useTrainingContentRules.ts` — training_content filter + synthetic bonus rules
4. `useActiveTrainingContentRules` — safe default `no_scope` для legacy entitlements без meta

Ответить: пользователь видит модуль потому что у него есть entitlement, или потому что resolver показывает по слишком широкому условию?

---

### STOP-guards

- **До завершения PATCH 3 discovery запрещено:**
  - Массовые revoke child modules
  - Массовые revoke bonus access
  - Любые fix library visibility "вслепую"
- Не менять auth, RLS, edge functions (кроме guard-ов Королёвой)
- Не менять handle_new_user trigger
- Сначала полная карта "почему видно / почему выдано", потом execute

---

### DoD

1. Browser-proof Дергелёвой: ghost-warning исчез, доступы видны из Support
2. Korolyova guard: dry-run + impact + оба guard-а имплементированы
3. ACCESS-SCOPE-FORENSICS: все 519 active entitlements классифицированы по происхождению
4. Sample-case Протасевич: объяснено каждое entitlement и subscription
5. Три CSV артефакта сгенерированы
6. Resolver audit: доказано, по какому условию UI показывает модули
7. `unexplained_active_access.csv` — готов как основа для будущих revoke/fix

---

### Статус-блок


| Патч                                      | Статус                               |
| ----------------------------------------- | ------------------------------------ |
| PATCH 1                                   | closed                               |
| PATCH 2                                   | partial — 12 ghost кейсов ждут fix   |
| PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX | code done, browser-proof pending     |
| PATCH-DERGELEVA-BROWSER-PROOF             | **этот sprint**                      |
| PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS     | root cause proved                    |
| PATCH-KOROLYOVA-REVOKE-GUARD-FIX          | **этот sprint**                      |
| PATCH-GHOST-PLACEHOLDER-NORMALIZATION     | discovery done, execute not approved |
| PATCH-GHOST-CLAIM-BRIDGE-PROOF            | pending — обязателен                 |
| PATCH 3 ACCESS-SCOPE-FORENSICS            | **этот sprint — discovery**          |
| PATCH 4 duration drift                    | pending (независим)                  |
