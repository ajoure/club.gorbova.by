да, согласен, с учетом правок:

&nbsp;

1. Исправь UUID продукта в плане и в proof-блоке.  
У тебя в SQL proof в одном месте указан 7101ed3c-0725-4de2-81c0-504cab63f727, а раньше и по кейсу Людмилы фигурировал другой UUID родительского cb20.  
Перед execute подрядчик обязан явно зафиксировать:  

  - product_id родительского курса для Демко Людмилы
  - tariff_id тарифа «Бухгалтер»
  - target_ref root training module  
  И использовать одни и те же ID во всём патче.
2. &nbsp;
3. В кодовом фрагменте нельзя использовать Record без generic-параметров.  
Нужно сразу писать:

&nbsp;

const entitlementTariffsByProduct: Record<string, string[]> = {};

&nbsp;

2. И в сигнатуре:

&nbsp;

entitlementTariffsByProduct: Record<string, string[]> = {}

&nbsp;

2.   

3. Нужна валидация meta.tariff_id как UUID до добавления в map.  
Не просто typeof tid === "string", а:  

  - строка
  - не пустая
  - валидный UUID  
  Иначе можно занести мусор в entitlement-scope и потом не понять, почему rule матчится/не матчится.
4. &nbsp;
5. Нужна дедупликация не только в конце массива, а сразу в map.  
Лучше хранить временно Set, либо после сборки привести:

&nbsp;

entitlementTariffsByProduct[pid] = [...new Set(entitlementTariffsByProduct[pid])]

&nbsp;

4. Иначе один и тот же entitlement/re-fetch может плодить повторы.
5. Явно зафиксируй, что product-scoped tariffs берутся только из active entitlements, уже прошедших текущий predicate.  
Это важно не как идея, а как proof в плане:  

  - status = active
  - product_id не null
  - meta.tariff_id валиден
  - entitlement не revoked/expired/cancelled  
  Чтобы подрядчик не начал тащить tariff_id из любых historical/legacy записей.
6. &nbsp;
7. В resolveTrainingContentFilter() не смешивай глобальные и product-scoped tariffIds без комментария о приоритете.  
Нужна явная формулировка:  

  - userTariffIds из subscriptions_v2 остаются как есть
  - entitlementTariffsByProduct[productId] — только дополнительный source для entitlement-only сценария
  - итоговый effectiveTariffIds используется только внутри проверки правил этого productId  
  Это надо написать прямо в плане, чтобы подрядчик не сделал “global merge once and reuse everywhere”.
8. &nbsp;
9. Добавь обязательный negative-proof после фикса.  
Не только Демко Людмила, но и:  

  - пользователь с active entitlement без meta.tariff_id
  - обычный subscription-based пользователь
  - другой продукт, у которого есть свой tariff-level rule  
  Нужно доказать, что новый map не открыл лишние модули и не изменил старое поведение.
10. &nbsp;
11. DoD нужно усилить конкретным proof для Людмилы.  
Не просто “курс снова виден”, а:  

  - root Ценный бухгалтер | 1 ступень 2.0 виден
  - visible module ids = пересечение active tree и 25 allowed_module_ids
  - 881d514f-... отсутствует в visible set
  - synthetic-legacy-safe больше не побеждает tariff-rule для этого продукта
12. &nbsp;
13. Добавь отдельный proof, что resolveTrainingContentFilter() выбрал именно DB tariff-level rule, а не synthetic fallback.  
Иначе можно визуально увидеть курс, но не доказать, что починен именно root cause.  
Нужен логический/SQL/code proof:  

  - matched rule id = ecb37704-...
  - match source = tariff-level DB rule
  - fallback rule не применился.
14. &nbsp;
15. Формулировку про “Подоходный налог ИП” оставь как отдельный config-case и не смешивай с execute.  
Это у тебя правильно, но закрепи жёстче:

&nbsp;

&nbsp;

&nbsp;

- этим патчем не менять access_rules
- не добавлять 881d514f в allowed_module_ids
- не считать отсутствие модуля багом после runtime-fix, если он реально не входит в правило

&nbsp;

&nbsp;

Итого: направление верное. После исправления UUID-несостыковки, добавления UUID-validation, dedupe и negative-proof план можно считать готовым к реализации.

&nbsp;

# План: Product-scoped tariff matching для entitlement-only доступа

## Scope

Это **отдельный PATCH** на баг пропавшего cb20 у Демко Людмилы. Не закрывает ранее открытые замечания по dynamic progress table, feedback badges, anti-N+1, legacy fallback.

## Диагностика (SQL proof)


| Факт                                    | Значение                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Демко Людмила user_id                   | `eb39c79d-2588-4ab6-b831-7cd2d5a1641d`                                                             |
| Entitlement cb20                        | product_id: `7101ed3c-7839-4a74-ad95-aa0660369b22`, status: active, meta.tariff_id: `adbe94e8-...` |
| Tariff «Бухгалтер»                      | id: `adbe94e8-171d-4b49-8338-66c554bb1f0b`, product_id: `7101ed3c-...` (тот же cb20)               |
| DB rule ecb37704 для tariff «Бухгалтер» | active, partial, 25 allowed_module_ids                                                             |
| Подоходный налог ИП (881d514f)          | **НЕ входит** в allowed_module_ids правила — config case, не баг кода                              |
| subscriptions_v2 на cb20                | **НЕТ** у Демко — поэтому tariffIds пуст для cb20                                                  |


**Цепочка сбоя:**

```text
useActiveTrainingContentRules() → userTariffIds = [из subscriptions_v2 only]
  → adbe94e8 НЕ в списке (нет подписки на cb20)
  → resolveTrainingContentFilter() Priority 1: ПРОМАХ
  → Priority 4: synthetic-legacy-safe → allowed_module_ids: [] → ВСЁ СКРЫТО
```

## Что делаем

### Файл: `src/hooks/useTrainingContentRules.ts`

**1. Собрать product-scoped tariff map из entitlements.meta**

В `useActiveTrainingContentRules()`, после сбора `tariffIds` из subscriptions_v2 (строка 185), построить map `product_id → tariff_id[]` из entitlements:

```typescript
// Product-scoped tariff IDs from entitlement.meta (для entitlement-only доступа)
const entitlementTariffsByProduct: Record<string, string[]> = {};
(ents || []).forEach(e => {
  if (!e.product_id) return;
  const meta = (e.meta || {}) as Record<string, any>;
  const tid = meta.tariff_id;
  if (tid && typeof tid === 'string') {
    if (!entitlementTariffsByProduct[e.product_id]) {
      entitlementTariffsByProduct[e.product_id] = [];
    }
    entitlementTariffsByProduct[e.product_id].push(tid);
  }
});
```

Return value дополнить: `entitlementTariffsByProduct`.

**2. Использовать product-scoped tariffs в `resolveTrainingContentFilter()**`

Добавить параметр `entitlementTariffsByProduct` (default `{}`). В Priority 1 (tariff-level DB rule matching), помимо `userTariffIds`, проверять `entitlementTariffsByProduct[productId]`:

```typescript
export function resolveTrainingContentFilter(
  rules: TrainingContentRule[],
  trainingModuleId: string,
  productId: string | null,
  userTariffIds: string[],
  entitlementTariffsByProduct: Record<string, string[]> = {},
): TrainingContentFilter | null {
  // ...
  // Priority 1: tariff-level DB rules
  const effectiveTariffIds = [
    ...userTariffIds,
    ...(productId ? (entitlementTariffsByProduct[productId] || []) : []),
  ];

  for (const rule of dbRules) {
    if (rule.tariff_id && effectiveTariffIds.includes(rule.tariff_id)) {
      bestRule = rule;
      break;
    }
  }
```

**3. Обновить все 3 вызова resolveTrainingContentFilter**

Передать `tcData.entitlementTariffsByProduct`:

- `useSidebarModules.ts` строка 183
- `useTrainingModules.tsx` строка 255
- `useContainerLessons.ts` строка 220

### Почему product-scoped, а не global

Если собрать все meta.tariff_id в один глобальный массив, tariff_id одного продукта может случайно отматчить правило другого продукта. Product-scoped matching использует `entitlementTariffsByProduct[productId]` **только** при проверке правил для того же продукта.

### Допустимый источник meta.tariff_id

- Только active entitlements (status = 'active')
- Только валидный UUID в meta.tariff_id
- Без revoked/expired/cancelled
- Без fallback по названию, slug, product_code

## Файлы


| Файл                                   | Изменение                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/hooks/useTrainingContentRules.ts` | Собрать `entitlementTariffsByProduct`, добавить параметр в `resolveTrainingContentFilter`, product-scoped matching |
| `src/hooks/useSidebarModules.ts`       | Передать `entitlementTariffsByProduct`                                                                             |
| `src/hooks/useTrainingModules.tsx`     | Передать `entitlementTariffsByProduct`                                                                             |
| `src/hooks/useContainerLessons.ts`     | Передать `entitlementTariffsByProduct`                                                                             |


## DoD

1. У Демко Людмилы снова виден root-курс «Ценный бухгалтер | 1 ступень 2.0»
2. Видимые модули cb20 строго соответствуют 25 allowed_module_ids правила tariff «Бухгалтер» (ecb37704)
3. «Подоходный налог ИП» (881d514f) остаётся скрытым — не входит в allowed_module_ids, это config case
4. Нет overgrant: entitlement.meta.tariff_id используется только для matching правил того же product_id
5. Legacy entitlement без meta.tariff_id — поведение не изменилось (synthetic-legacy-safe default)
6. Subscription-based пользователи не затронуты

## Вне scope / Follow-up

- Добавление 881d514f в allowed_module_ids правила — решение администратора, не баг кода
- Нормализация legacy entitlements (tariff-context из meta → канонический вид) — отдельная задача
- Ранее открытые замечания по dynamic progress table, feedback, anti-N+1 — не затрагиваются этим патчем