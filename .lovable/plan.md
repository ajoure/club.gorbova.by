# да, согласен, с учетом правок:

&nbsp;

1. visibleSections и subTabs оформить через useMemo, чтобы не создавать новые массивы на каждый рендер и не провоцировать лишние срабатывания guard-effect.
2. Во втором guard-effect сначала проверяй, что subTabs.length > 0. Fallback:
  &nbsp;
  - сначала DEFAULT_SUB[activeSection], если он есть среди видимых,
  - иначе subTabs[0]?.id,
  - иначе ничего не делать.
    Не хардкодить лишний запасной id, кроме уже существующего безопасного fallback, если он реально нужен.
  &nbsp;
3. В первом guard-effect при смене недоступной секции не ставь activeSubTab вслепую в DEFAULT_SUB[fallback]. Сразу проверяй, что этот subtab видим для новой секции; иначе бери первый доступный subtab новой секции. Иначе возможен краткий пустой рендер.
4. В рендере и в логике держать один SoT:
  &nbsp;
  - visibleSections используется в UI,
  - subTabs считается только от уже актуальной activeSection,
  - никаких параллельных неотфильтрованных массивов в JSX.
  &nbsp;
5. В DoD добавь отдельную проверку:
  &nbsp;
  - если открыть /ai, когда в local state раньше была секция documents или subtab tutorials/prompts, страница автоматически восстанавливается на доступную вкладку без мигания пустого контента.
  &nbsp;
6. Этот патч ограничить только AiPageContent.tsx. Ни sidebar, ни layout, ни router здесь не трогать.

&nbsp;

&nbsp;

План: Скрыть admin-only вкладки на /ai по mode

## Что делаем

Единственный файл: `src/components/ai-chat/AiPageContent.tsx`. Никакие sidebar/layout файлы не трогаем.

## Изменения

### 1. Тип секций — добавить `adminOnly`

Строка 46-53: добавить `adminOnly?: boolean` в объекты SECTIONS, пометить `documents` как `adminOnly: true`.

### 2. Sub-tabs — пометить "Туториалы"

Строка 86-93: добавить `adminOnly: true` к sub-tab `tutorials`.

### 3. Фильтрация секций и sub-tabs строго по mode

Строка 449-450 — заменить текущую логику:

```ts
// Секции
const visibleSections = SECTIONS.filter(sec => !sec.adminOnly || mode === "admin");

// Sub-tabs (после определения allSubTabs)
const subTabs = allSubTabs.filter(tab => !tab.adminOnly || mode === "admin");
```

Убрать `|| isAdminUser` — на `/ai` даже admin/superadmin не видят admin-only UI.

### 4. Guard для активной секции/subtab после фильтрации

После вычисления `visibleSections` и `subTabs` добавить useEffect:

```ts
useEffect(() => {
  if (!visibleSections.some(s => s.id === activeSection)) {
    const fallback = visibleSections[0]?.id ?? "ai";
    setActiveSection(fallback);
    setActiveSubTab(DEFAULT_SUB[fallback]);
  }
}, [activeSection, visibleSections]);

useEffect(() => {
  if (!subTabs.some(t => t.id === activeSubTab)) {
    const defaultSub = DEFAULT_SUB[activeSection];
    const fallback = subTabs.find(t => t.id === defaultSub) ? defaultSub : subTabs[0]?.id ?? "chat";
    setActiveSubTab(fallback);
  }
}, [activeSubTab, subTabs, activeSection]);
```

### 5. Рендер секций — использовать visibleSections

Строка 475: заменить `SECTIONS.map(...)` на `visibleSections.map(...)`.

## Что НЕ меняется

- Tab ids, subtab ids, query keys, state names, обработчики
- AdminSidebar, AppSidebar, AdminLayout, useAdminMenuSettings, DashboardLayout
- `AI_CONTAINER_OFFSET`
- canManage*, canEdit*, mutation guards, disabled-state

## DoD

1. `/ai` показывает только "Gorbova AI" и "Реквизиты" (без "Документы")
2. Внутри "Gorbova AI" на `/ai` — только "Чат" и "История анализа" (без "Туториалы", "Промпты")
3. `/ai` у admin-пользователя тоже скрывает Документы, Туториалы, Промпты
4. `/admin/ai` показывает все секции и все sub-tabs
5. Прямой вход на ранее скрытую вкладку в `/ai` не даёт пустой экран (guard сбрасывает на доступную)
6. Переключение `/admin/ai` → `/ai` сбрасывает невидимую section/subtab на доступную автоматически