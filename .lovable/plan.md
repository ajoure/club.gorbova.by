Да, согласен, с учетом правок:

&nbsp;

1. Не формулируй root cause как окончательно закрытый только по code-reading.  
Пиши так: «подтверждён основной root cause по коду; требуется runtime-proof на hard refresh».  
Иначе подрядчик потом скажет, что это была только гипотеза.
2. Добавь отдельный обязательный блок «Почему выживает только базовый продукт»:  

  - Бухгалтерия как бизнес остаётся, потому что это direct subscription / base product access;
  - исчезают secondary sources: entitlement-only, rule-based, module-based, mixed;
  - подрядчик обязан доказать это на конкретных продуктах пользователя.
3. &nbsp;
4. В useTrainingModules.tsx не делать gate по tcData === null.  
Это важно. null может быть валидным итогом.  
Gate только по tcLoading, иначе можно сломать пользователей без training rules.
5. В deps для fetchModules лучше требовать не просто tcData, а стабильную зависимость:  

  - либо tcData,
  - либо memoized fingerprint (rules.length, userTariffIds.join(','), version key),  
  чтобы не получить лишние рефетчи/циклы, если объект пересоздаётся.
6. &nbsp;
7. Добавь ещё один обязательный guard:  
при refresh нельзя очищать текущий список тренингов до завершения нового расчёта, если уже был последний валидный state.  
Иначе останется визуальный flicker/flash, даже если stale closure исправлен.
8. Проверять нужно не только useTrainingModules.tsx, но весь путь:  

  - useTrainingModules.tsx
  - useSidebarModules.ts
  - useContainerLessons.ts
  - где формируется финальный merge продуктов/уроков в клиентском кабинете  
  Подрядчик обязан показать, что во всех трёх местах одинаковая логика ожидания tcLoading.
9. &nbsp;
10. Добавь обязательный runtime-proof в 3 режимах:  

  - hard refresh страницы кабинета;
  - прямой вход по URL в тренинги;
  - обычная SPA-навигация без refresh.  
  Во всех трёх случаях список должен совпадать.
11. &nbsp;
12. В proof-таблице добавь ещё две колонки:  

  - render_source_before_fix
  - render_source_after_fix  
  Чтобы было видно, где продукт теряется: на fetch, на tc-filter, на sidebar filter или на final render.
13. &nbsp;
14. Добавь STOP-guard:  

  - нельзя чинить через хардкод product_id;
  - нельзя чинить через исключение для Бухгалтерия как бизнес;
  - нельзя чинить через отключение training_content фильтрации целиком.
15. &nbsp;
16. В DoD добавь отдельный критерий:  
после reload вторичные доступы не только видны в списке тренингов, но и реально открывают дерево модулей/уроков без пустого контейнера.

&nbsp;

&nbsp;

Копируемый блок для вставки в план:

Дополнительные обязательные правки к плану:

&nbsp;

1. Не считать root cause полностью закрытым только по code-reading. Формулировка: “подтверждён основной root cause по коду; требуется runtime-proof на hard refresh”.

&nbsp;

2. Отдельно проверить и доказать гипотезу:

   “Бухгалтерия как бизнес” остаётся после refresh как базовый direct subscription/direct product access,

   а пропадают именно secondary access sources:

   - entitlement-only

   - rule-based

   - module-based

   - mixed access

&nbsp;

3. Gate делать только по tcLoading, а НЕ по tcData === null.

   Null может быть легитимным состоянием пользователя без training rules.

&nbsp;

4. В зависимостях fetchModules использовать безопасную/stable зависимость от training-content данных

   (tcData или memoized fingerprint), чтобы не получить лишние циклы/рефетчи.

&nbsp;

5. Добавить защиту от визуального коллапса:

   если уже есть последний валидный modules state, не очищать его до завершения нового корректного расчёта после refresh.

&nbsp;

6. Проверить и синхронизировать одинаковую логику ожидания tcLoading в:

   - useTrainingModules.tsx

   - useSidebarModules.ts

   - useContainerLessons.ts

&nbsp;

7. Обязательный runtime-proof в 3 сценариях:

   - hard refresh

   - прямой вход по URL

   - SPA navigation без refresh

&nbsp;

8. В proof-таблицу добавить колонки:

   - render_source_before_fix

   - render_source_after_fix

&nbsp;

9. STOP-guards:

   - без хардкода product_id

   - без special-case только для “Бухгалтерия как бизнес”

   - без отключения training_content фильтрации целиком

&nbsp;

10. DoD:

   после reload вторичные доступы не только видны в списке тренингов, но и реально открывают модули/уроки без пустого контейнера.

&nbsp;

## План: Fix — тренинги исчезают после refresh (stale closure + race condition)

---

### Root cause (подтверждён по коду)

**Файл:** `src/hooks/useTrainingModules.tsx`, строки 63-64, 212-213, 318

`fetchModules` создаётся через `useCallback` с зависимостями `[user?.id, isAdminUser]`, но **использует `tcData` из замыкания** (строки 212-213) без включения в массив зависимостей (строка 318).

**Механизм:**

1. **После refresh:** React Query кэш пуст → `tcData = null` → `fetchModules` запускается с `tcData=null` → модули вычисляются **без training_content правил**
2. Когда `tcData` загружается позже, `fetchModules` **не пересоздаётся** (нет в deps) → результат застаревший
3. Synthetic `legacy-safe` правила (из `resolveBonusScopeRules`) для entitlements без `scope_resolution_mode` генерируют partial-фильтр с **пустым** `allowed_module_ids` → при повторном рендере через `useSidebarModules.filteredModules` эти модули скрываются

**Почему «Бухгалтерия как бизнес» выживает:**
Это прямой базовый продукт/подписка (direct subscription product). Его entitlement либо имеет `scope_resolution_mode` (исключающий его из synthetic-legacy генерации), либо имеет DB-правило `training_content` приоритета 1-2. Все исчезающие тренинги — это secondary access sources: entitlement-only, rule-based, module-based.

**Рассинхрон sidebar vs page:** `useSidebarModules` использует React Query (пересчитывает при загрузке tcData через `useMemo`), а `useTrainingModules` использует ручной `useState` + `useCallback` (не пересчитывает).

---

### Обязательная гипотеза (discovery)

Проверить, что после refresh:

- остаются ТОЛЬКО продукты с direct subscription/direct product access
- исчезают ВСЕ продукты с entitlement-only / rule-based / module-based / mixed access
- причина — fetchModules при `tcData=null` применяет synthetic legacy-safe partial filter с пустым allowlist, что убивает доступ к secondary products

Proof-таблица по каждому тренингу: product | visible before refresh | visible after refresh | access source | should survive reload | actual result

---

### Phase 1: Основной fix — `useTrainingModules.tsx`

**Изменение 1:** Добавить `tcData` в зависимости `useCallback` (строка 318):

```typescript
}, [user?.id, isAdminUser, tcData]);
```

**Изменение 2:** Race condition guard через `useRef`:

```typescript
const fetchIdRef = useRef(0);
// В начале fetchModules:
const fetchId = ++fetchIdRef.current;
// Перед setModules/setLoading:
if (fetchId !== fetchIdRef.current) return;
```

**Изменение 3:** Не запускать fetch пока tcData не загружен (для non-admin):

```typescript
const { data: tcRawData, isLoading: tcLoading } = useActiveTrainingContentRules();
// В useEffect:
useEffect(() => {
  if (!isAdminUser && tcLoading) return;
  fetchModules();
}, [fetchModules, isAdminUser, tcLoading]);
```

### Phase 2: Консистентность sidebar — `useSidebarModules.ts`

Добавить `tcLoading` guard в `filteredModules`:

```typescript
const { data: tcRawData, isLoading: tcLoading } = useActiveTrainingContentRules();
const filteredModules = useMemo(() => {
  if (isAdminUser || tcLoading || !tcData || !tcData.rules.length) return modules;
  // ...existing filtering...
}, [modules, isAdminUser, tcData, tcLoading]);
```

### Phase 3: Аналогичная защита — `useContainerLessons.ts`

Добавить `tcLoading` guard в секции PATCH B фильтрации (строка ~155), чтобы не применять tc-filter пока rules загружаются.

---

### Что НЕ делается

- Не меняются данные в БД (0 изменений)
- Не хардкодятся product_id, user_id, списки тренингов
- Не меняется логика доступа (entitlements, rules, subscriptions)
- Только fix stale closure и race condition в UI-хуках

### Файлы для изменения


| Файл                               | Изменение                                 |
| ---------------------------------- | ----------------------------------------- |
| `src/hooks/useTrainingModules.tsx` | tcData в deps, race guard, tcLoading gate |
| `src/hooks/useSidebarModules.ts`   | tcLoading guard в filteredModules         |
| `src/hooks/useContainerLessons.ts` | tcLoading guard в PATCH B секции          |


### DoD

1. После refresh список тренингов совпадает с реальными доступами
2. fetchModules пересчитывается при загрузке tcData
3. Нет race condition между параллельными fetchModules
4. Sidebar и библиотека показывают консистентную картину
5. Secondary access sources (entitlement-only, rule-based, module-based) не исчезают после reload
6. «Бухгалтерия как бизнес» не остаётся единственным продуктом
7. 0 изменений данных в БД
8. Proof-таблица: product | before | after | access_source | should_survive | actual