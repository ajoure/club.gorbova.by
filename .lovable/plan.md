да, согласен, с учетом правок:

1. **Не менять Phase E**
  - Не оставлять root-карточку видимой при rule_unresolved с пустым списком уроков.
  - Если rule_unresolved — это default-deny, карточка может быть скрыта.
  - Для Татьяны цель не обходить Phase E, а добиться корректного db_tariff match на 18 модулей.
2. **Fix делать точечно в resolver**
  - entitlement.meta.tariff_id должен участвовать в tariff-rule matching наравне с subscriptions_v2.tariff_id.
  - Entitlement с meta.tariff_id нельзя относить к legacyEnts.
  - synthetic-legacy-safe не должен создаваться для entitlement, у которого есть meta.tariff_id.
3. **Synthetic legacy не отключать глобально по product_id**
  - Если у продукта есть DB rules, но entitlement вообще без tariff_id и без scope — не открывать full access.
  - Такой случай должен идти в rule_unresolved / safe-deny, а не в full access.
  - Нельзя ломать bonus/module_scope_only сценарии.
4. **Сначала подтвердить runtime**
  - Под debug flag показать для Татьяны:
    - product_id=7101ed3c;
    - entitlement_tariff_id=543940b1;
    - subscription_tariff_id=543940b1;
    - выбранный rule_id;
    - rule_source;
    - количество allowed_module_ids.
  - Без ФИО/email.
5. **Диагностическую панель не делать**
  - Достаточно debug-лога под localStorage.getItem('[debug.training](http://debug.training)_content') === '1'.
  - Новую UI-панель не добавлять.
6. **SQL-аудит обязателен**
  - До фикса: список пользователей, где entitlement.meta.tariff_id совпадает с tariff-level DB rule, но карточка может схлопываться.
  - После фикса: подтвердить, что такие пользователи получают db_tariff, а не synthetic_legacy.
7. **Проверить cb20-маппинг**
  - Реальные условия в runtime не должны зависеть от строки 'cb20', если можно использовать product_id.
  - Комментарии и справочники названий не трогать.
8. **Writers не трогать**  

  - grant-access-for-order;
  - subscriptions_v2;
  - entitlements;
  - payments;
  - Telegram  
  не изменять.
9. **DoD уточнить**
  - Татьяна видит Ценный бухгалтер | 1 ступень 2.0.
  - Доступно ровно 18 модулей по tariff-rule 543940b1.
  - rule_source=db_tariff.
  - synthetic-legacy-safe не выбран.
  - module_scope_only не получает лишний доступ.
  - rule_unresolved не открывает full access.
  - Debug-лог выключен по умолчанию.
  - Memory rule добавлен.

&nbsp;

Можно выполнять build mode.

&nbsp;

## План: фикс training_content resolver + аудит cb20 хардкодов

### Diagnose (read-only факты)

Татьяна `4870dfc5-6609-4e0c-96a9-20fbd2d05928`:

- entitlement cb20: `393fe515`, product_id=`7101ed3c…`, `meta.tariff_id=543940b1…`
- subscription cb20: tariff_id=`543940b1…`, status=active, access_end_at=2026-05-08
- DB rules training_content для cb20: 3 шт., tariff-level (`543940b1`/18 mod, `adbe94e8`/25, `9bc81736`/28), все is_active=true, target_ref=root `c9f7e9b8`
- параллельно у неё есть 2 entitlement на business-продукты (`c153c811`, `11c9f1b8`) — без meta.scope_resolution_mode → попадают в `legacyEnts`. Сам cb20-entitlement тоже legacyEnt (нет scope_resolution_mode).

**Ожидаемый путь резолвера** (`resolveTrainingContentFilter`):
P1 tariff-DB rule матчится по `effectiveTariffIds = userTariffIds ∪ entitlementTariffsByProduct[7101ed3c]` → должен дать 18 модулей и НЕ доходить до P4.

**Гипотеза root cause:**

1. `synthetic-legacy-safe-7101ed3c` всё-таки создаётся для cb20-ent (нет `scope_resolution_mode`) — он живёт в массиве и при любом срыве P1 (например: rules ещё не приехали, race на refresh, partial cache, фильтрация по product_id уронила DB-rule, или DB-rules грузятся пустыми из-за RLS) → P4 даёт `allowed_module_ids=[]` → корень с 18 детьми → 0 видимых → root убирается (Phase E STOP-guard в `useTrainingModules`).
2. В `useSidebarModules` filter применяется только когда `tcData.rules.length>0`, но в `useTrainingModules` фильтр применяется всегда при `tcRules.length>0` → расхождение поведения.

Подтверждение root cause требует runtime — это первый шаг build-mode (см. ниже), без логирования PII.

---

### Изменения (build mode)

**A. `src/hooks/useTrainingContentRules.ts` — устранить опасный fallback**

1. **Запретить synthetic-legacy перебивать DB-rule.** В `resolveBonusScopeRules`: если для `productId` уже есть **хоть одна активная DB tariff/product-level rule** (передать `dbRules` параметром), НЕ генерировать `synthetic-legacy-safe-{productId}`.
2. `**entitlement.meta.tariff_id` — first-class источник matching.** Уже учитывается через `entitlementTariffsByProduct` в P1. Дополнительно: если у entitlement есть `meta.tariff_id` И этот tariff совпадает с каким-то `dbRules[].tariff_id` → ни в коем случае не уходить в P4 даже если subscription по этому продукту нет.
3. **No-fallback в full access.** Не менять P3/P4 на full. Если ни один DB-rule не матчится И есть entitlement.meta.tariff_id, который НЕ совпадает с DB rules → вернуть **diagnostic bucket**: `mode='partial', allowed_module_ids=[], rule_purpose='rule_unresolved'`. Это сохраняет default-deny (никакого расширения доступа).
4. **Убрать synthetic-legacy для product-linked entitlement, у которого есть `meta.tariff_id`.** Такие entitlement НЕ legacy — ими должен заниматься tariff-DB-path.

**B. `src/hooks/useTrainingModules.tsx` + `src/hooks/useSidebarModules.ts` — выровнять поведение**

- Вынести единое условие применения tc-фильтра: применять только когда `tcLoading=false` И `tcData!==null`. Не применять при `rules.length===0` (текущий sidebar так делает; library — нет → выровнять).
- Не вызывать Phase E STOP-guard (скрытие root с visibleRecursive=0), если выбранный фильтр — `rule_purpose='rule_unresolved'`. Вместо этого оставить root видимым с пустым списком уроков и логом diagnostic bucket. Альтернатива: оставить как есть, но фильтр `rule_unresolved` гарантирует, что это сработает только в реально кривом состоянии данных, не у Татьяны.

**C. Диагностический логгер (под flag)**

- Новый util `src/lib/trainingContentDiag.ts`. Лог только при `localStorage.getItem('debug.training_content')==='1'`.
- Поля: `user_id`, `product_id`, `entitlement_tariff_id`, `subscription_tariff_id`, `matched_rule_id`, `rule_source` (`db_tariff|db_product|synthetic_bonus|synthetic_legacy|rule_unresolved`), `fallback_reason`. Без ФИО/email.
- Вызов в `resolveTrainingContentFilter` (вернуть meta вместе с filter, вызвать в hook).

**D. SQL-аудит когорты (read-only, перед фиксом)**

Найти всех users, у которых:

- есть active entitlement по продукту с tariff-level training_content rules;
- entitlement.meta.tariff_id есть и совпадает с rule.tariff_id;
- subscription отсутствует ИЛИ subscription.tariff_id не совпадает.

Ожидание: эти users были бы схлопнуты synthetic-legacy. После фикса они увидят корректный scope.

**E. Аудит «cb20» как код vs id продукта**

Хардкоды найдены:

- `supabase/functions/admin-entitlement-backfill-v23/index.ts` — резолвит cb20 через `.eq('code','cb20')`, далее использует `cb20Product.id`. ОК, не править (один-разовый backfill).
- `supabase/functions/_shared/entitlement-sync.ts` — комментарий упоминает cb20 в mode_filter; проверить, нет ли реального условия `product_code==='cb20'` в логике, и если есть — переключить на product_id константу.
- `supabase/functions/course-prereg-notify/index.ts` — отображение названия по product_code. ОК (UI-строка).
- `src/hooks/useSidebarModules.ts` — только в комментарии. ОК.
- `src/hooks/useTrainingContentRules.ts` — только в комментарии. ОК.
- `src/lib/product-names.ts` — справочник кодов→названий. ОК.
- `supabase/functions/repair-cb20-entitlements/index.ts` — название функции, внутри universal по product_id. ОК.

Реальный фикс нужен только если в `entitlement-sync.ts` есть рантайм-сравнение по строке. Прочитаю и при необходимости заменю на product_id-resolve.

**Writers НЕ трогать**: `grant-access-for-order`, `subscriptions_v2`, `entitlements`, payment, telegram.

---

### Verify (после фикса, build mode)

1. **Татьяна** видит cb20 в библиотеке с 18 модулями (tariff `543940b1` → 18 allowed).
2. Diagnostic-лог под flag показывает: `matched_rule_id=63fbef2a…`, `rule_source=db_tariff`, без PII.
3. SQL-когорта (audit) — no-regression: все, кто был «схлопнут», теперь имеют корректный root + scope.
4. Регрессии:
  - `module_scope_only` (синтетика bonus) — НЕ получает full access, scope соблюдён.
  - `no_scope`/`manual_review` — заблокированы как раньше.
  - Бонусные/no-meta entitlement БЕЗ DB-rules — поведение прежнее (synthetic-legacy продолжает работать как safe-default).
  - Root карточка не исчезает, если хотя бы один child разрешён.
5. Memory rule обновить (см. ниже).

---

### Memory rule (apply after Verify)

Файл `mem://architecture/access-control/training-content-resolver-rules` (новый):

- `entitlement.meta.tariff_id` — допустимый источник tariff matching;
- synthetic-legacy не создаётся, если по `product_id` есть активные DB training_content rules;
- при отсутствии matching — diagnostic bucket `rule_unresolved` (default-deny), НЕ full access;
- diagnostic-лог только под flag, без PII.

---

### DoD

- Татьяна видит cb20/18 модулей.
- SQL-когорта пуста после фикса (нет users с rule_unresolved при наличии валидного match).
- Регрессии 4 сценариев — green.
- Writers не изменены.
- Memory rule добавлен.
- Diag-логгер выключен по умолчанию (нет шума в проде).