## >'tariff_id' as tariff_id, status, expires_at, created_at FROM entitlements WHERE user_id='a832c11e-1715-4646-bfcb-859fff931a0e' AND status='active' ORDER BY created_at DESC\"}">

Диагностика:

Корень бага (cb20 «1 ступень 2.0» не виден):

Пользователь Екатерина (a832c11e…) имеет:

- entitlement cb20 (product 7101ed3c…), активный, `meta.tariff_id = NULL` (выдан админом «через BUSINESS» 31.03.26).

- subscriptions_v2 — только клуб (tariff 7c748940…), нет тарифа cb20.

- access_rules для cb20 (training_content) — ровно 3 правила, все привязаны к `tariff_id` (543940b1, adbe94e8, 9bc81736). Product-level правила (без tariff_id) нет.

Резолвер `resolveTrainingContentFilter` идёт по приоритетам:

- P1 db_tariff — её tariff_ids `[7c748940 (клуб)] ∪ entitlementTariffs[cb20]=[]` ни с одним из правил cb20 не совпадают.

- P2 db_product — нет product-only правила.

- P3 synthetic_bonus — нет `scope_resolution_mode` в meta.

- P4 synthetic_legacy — подавлен, потому что для cb20 уже есть DB-rules `productsWithDbRules`).

- P5 rule_unresolved → default-deny `partial` с пустым allowlist).

Дальше в `useTrainingModules`: root остаётся с `has_access=true`, но все дети получают `has_access=false`, `computeVisibleRecursiveLessonCount(root)=0` → root скрывается строкой `if (visibleRecursive === 0) return false`. Это и есть исчезновение «Ценный бухгалтер | 1 ступень 2.0» из «Моя библиотека», хотя в «Доступах» он значится «Активен».

То же ловит других пользователей: любой ручной/business-grant без `meta.tariff_id` на продукт, у которого DB-правила только tariff-scoped, получит default-deny.

Это противоречит UX-ожиданию: админ выдал доступ к продукту целиком — пользователь должен увидеть продукт целиком. Сейчас память говорит «rule_unresolved = default-deny», но фактически нет канона для «product-grant без tariff_id».

План решения готов:

 `— формируется в` useActiveTrainingContentRule `из` entitlement`, где` meta.tariff_i `отсутствует **и**` meta.scope_resolution_mod `отсутствует (т.е. это не bonus, а полный ручной доступ).\\n\\n### Технические детали\\n\\nФайлы:\\n-` src/hooks/useTrainingContentRules.t`\\n  -` useActiveTrainingContentRule`: собрать` productsWithManualEn `(ent.meta пустой по` tariff_i `и` scope_resolution_mod`), вернуть в общем объекте.\\n  -` resolveTrainingContentFilte`: принять` productsWithManualEn`; вставить новый блок между P4 и P5; включить в diag-лог` admin_grant_full_fallbac`.\\n-` src/hooks/useTrainingModules.ts`,` src/hooks/useSidebarModules.t`,` src/hooks/useContainerLessons.t `— пробросить новый параметр в вызовы` resolveTrainingContentFilte`.\\n- Migration: апдейт ent + audit row.\\n- Memory update: добавить пункт в` mem://architecture/access-control/training-content-resolver-rule `про P4.5 admin-grant fallback и канон «product-grant без tariff_id ⇒ full».\\n\\n### DoD\\n\\n1. У` [finassist.by@gmail.co](mailto:finassist.by@gmail.com) `карточка «Ценный бухгалтер | 1 ступень 2.0» появляется в «Моя библиотека», содержит модули согласно тарифу 9bc81736 (28 модулей), модули открываются.\\n2. Регрессия: пользователь с partial-bonus (`scope_resolution_mod`) по-прежнему видит только bonus-модули (P3 синтетика приоритетнее P4.5).\\n3. Регрессия: пользователь без entitlement и без подписки — не получает доступ (P4.5 не срабатывает без ent).\\n4. Регрессия: пользователь с tariff-подпиской на cb20 — продолжает идти через P1.\\n5. Аудит-запись` admin_grant_full_fallbac `появляется в` audit_log`/diag-логе при срабатывании fallback.\\n6. Память обновлена.\\n\\n### Verify\\n\\n- SQL:` SELECT meta FROM entitlements WHERE id='155ed99b… `показывает` tariff_id='9bc81736…`.\\n- UI runtime у клиента: карточка видна, модули открываются.\\n-` localStorage.setItem('[debug.training](http://debug.training)_content','1' `→ лог` rule_source=db_tarif `(после data-fix) ИЛИ` rule_source=admin_grant_full_fallback` (если data-fix откатить — system-фикс).\\n\"}">

&nbsp;

План: Видимость продукта для admin/business grants без tariff_id

### Diagnose (готово)

Кейс: Екатерина Иванченко (`a832c11e…`), продукт «Ценный бухгалтер | 1 ступень 2.0» (cb20, `7101ed3c…`).

- В админке «Доступы»: ent активен, выдан 31.03.26 через BUSINESS, `meta.tariff_id = NULL`.
- В кабинете «Обучение → Моя библиотека» (11 карточек) карточки cb20 нет.
- Причина: `access_rules` для cb20 существуют только tariff-scoped (3 шт.). У ent нет `meta.tariff_id`, нет совпадающей подписки → резолвер уходит в P5 `rule_unresolved` → `partial` c пустым allowlist → root прячется.

Это системная дыра: любой ручной/business-grant продукта без `meta.tariff_id` для продукта с tariff-only правилами → пользователь не видит продукт.

### Решение (двухшаговое)

**Шаг 1. Точечный data-fix для Екатерины (немедленно).**

Проставить `meta.tariff_id` в её cb20 entitlement, чтобы резолвер ушёл в P1 `db_tariff`. Канонический «полный» тариф 1 ступени 2.0 — `9bc81736-e7e5-48db-9925-b866427a98e1` (правило открывает 28 модулей; максимально полный набор). Это согласуется с памятью «entitlement.meta.tariff_id = first-class match».

Migration:

```sql
UPDATE entitlements
SET meta = COALESCE(meta,'{}'::jsonb)
       || jsonb_build_object('tariff_id','9bc81736-e7e5-48db-9925-b866427a98e1',
                             'tariff_id_source','admin_business_grant_repair_2026_05')
WHERE id='155ed99b-829b-4118-9136-1e08f0527896';
```

- запись в `audit_logs` (action `entitlement.meta.tariff_id_repair`, actor=system, reason=`business_grant_missing_tariff_id`).

**Шаг 2. Системный фикс в резолвере (canonical).**

В `resolveTrainingContentFilter` (src/hooks/useTrainingContentRules.ts) перед P5 добавить **P4.5 «admin/business product-grant fallback»**:

Условие срабатывания:

- DB rules для продукта существуют, но ни одно tariff-rule не матчит,
- product-level rule отсутствует,
- у пользователя есть **активная entitlement для этого продукта без `meta.tariff_id**` (= признак ручного/business grant), 
- продукт **не имеет** активной recurring-подписки пользователя на этот продукт (чтобы не маскировать рассинхрон оплаты).

Поведение: вернуть `mode: "full"` + audit `rule_source = "admin_grant_full_fallback"`. Это закрывает дыру для всех будущих manual grants без необходимости каждый раз чинить данные руками.

Чтобы помечать «admin/business grant» точно, ввести в резолвер новый параметр `productsWithManualEnt: Set<string>` — формируется в `useActiveTrainingContentRules` из `entitlements`, где `meta.tariff_id` отсутствует **и** `meta.scope_resolution_mode` отсутствует (т.е. это не bonus, а полный ручной доступ).

### Технические детали

Файлы:

- `src/hooks/useTrainingContentRules.ts`
  - `useActiveTrainingContentRules`: собрать `productsWithManualEnt` (ent.meta пустой по `tariff_id` и `scope_resolution_mode`), вернуть в общем объекте.
  - `resolveTrainingContentFilter`: принять `productsWithManualEnt`; вставить новый блок между P4 и P5; включить в diag-лог `admin_grant_full_fallback`.
- `src/hooks/useTrainingModules.tsx`, `src/hooks/useSidebarModules.ts`, `src/hooks/useContainerLessons.ts` — пробросить новый параметр в вызовы `resolveTrainingContentFilter`.
- Migration: апдейт ent + audit row.
- Memory update: добавить пункт в `mem://architecture/access-control/training-content-resolver-rules` про P4.5 admin-grant fallback и канон «product-grant без tariff_id ⇒ full».

### DoD

1. У `finassist.by@gmail.com` карточка «Ценный бухгалтер | 1 ступень 2.0» появляется в «Моя библиотека», содержит модули согласно тарифу 9bc81736 (28 модулей), модули открываются.
2. Регрессия: пользователь с partial-bonus (`scope_resolution_mode`) по-прежнему видит только bonus-модули (P3 синтетика приоритетнее P4.5).
3. Регрессия: пользователь без entitlement и без подписки — не получает доступ (P4.5 не срабатывает без ent).
4. Регрессия: пользователь с tariff-подпиской на cb20 — продолжает идти через P1.
5. Аудит-запись `admin_grant_full_fallback` появляется в `audit_logs`/diag-логе при срабатывании fallback.
6. Память обновлена.

### Verify

- SQL: `SELECT meta FROM entitlements WHERE id='155ed99b…'` показывает `tariff_id='9bc81736…'`.
- UI runtime у клиента: карточка видна, модули открываются.
- `localStorage.setItem('debug.training_content','1')` → лог `rule_source=db_tariff` (после data-fix) ИЛИ `rule_source=admin_grant_full_fallback` (если data-fix откатить — system-фикс).