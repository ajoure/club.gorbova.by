
# План: Исправление системы доступа к обучающим модулям

## Обзор проблемы

Система доступа к контенту не работает корректно:
1. Пользователи с купленными тарифами (FULL/BUSINESS) не видят контент
2. Не показывается плашка о необходимости подписки для пользователей без доступа
3. В настройках модуля выбор тарифов отображается, но может не сохраняться/загружаться корректно

## Диагностика

Проверка базы данных показала, что данные корректны:
- Модуль "Уроки без модулей" привязан к тарифам FULL и BUSINESS в таблице `module_access`
- Есть пользователи с активными подписками на эти тарифы

Проблема в коде — логика определения `has_access` содержит ошибки.

---

## Обнаруженные баги

### Баг 1: Некорректное определение доступа в `useSidebarModules.ts`

**Файл:** `src/hooks/useSidebarModules.ts`, строки 75-88

**Проблема:** Сложный запрос с `NOT IN` для определения "бесплатных" модулей не работает надёжно из-за конструкции с вложенным await.

**Текущий код:**
```tsx
// Сложная конструкция с вложенным await внутри строки
.not("id", "in", `(${Array.from(
  new Set((await supabase.from("module_access").select("module_id")).data?.map(...))
).join(",") || "00000000-0000-0000-0000-000000000000"})`);
```

**Решение:** Переписать логику определения доступа:
1. Получить все записи module_access один раз
2. Модуль "бесплатный" если у него НЕТ записей в module_access
3. Модуль доступен если:
   - Пользователь админ
   - Модуль бесплатный (нет записей в module_access)
   - tariff_id пользователя есть в module_access для этого модуля

### Баг 2: Не передаются названия тарифов в плашку

**Файл:** `src/pages/Knowledge.tsx`, строка 334

**Проблема:** Передаётся пустой массив `accessibleTariffs={[]}`.

**Решение:** Собрать названия тарифов из ограниченных модулей и передать их в плашку.

### Баг 3: Плашка показывается только если ВСЁ ограничено

**Файл:** `src/pages/Knowledge.tsx`, строка 333

**Проблема:** Условие `hasRestrictedContent && !hasAccessibleContent` — плашка не показывается если есть хотя бы один доступный модуль.

**Решение:** Показывать плашку если `hasRestrictedContent` и пользователь не админ.

### Баг 4: Некорректная загрузка tariff_ids при редактировании модуля

**Файл:** `src/pages/admin/AdminTrainingModules.tsx`, строки 469-471

**Проблема:** Условие проверки `formData.tariff_ids?.length === 0` не срабатывает при повторном открытии диалога, так как массив не сбрасывается.

**Решение:** Использовать `useEffect` для загрузки tariff_ids вместо условия в теле компонента.

---

## План исправлений

### Шаг 1: Переписать логику доступа в `useSidebarModules.ts`

```tsx
export function useSidebarModules() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const isAdminUser = isAdmin();

  const { data, isLoading } = useQuery({
    queryKey: ["sidebar-modules", user?.id, isAdminUser],
    queryFn: async () => {
      // 1. Get all active modules
      const { data: modulesData, error } = await supabase
        .from("training_modules")
        .select("id, title, slug, menu_section_key, icon, sort_order, is_container")
        .eq("is_active", true)
        .order("sort_order");

      if (error) throw error;

      // 2. Get ALL module_access records
      const { data: allAccess } = await supabase
        .from("module_access")
        .select("module_id, tariff_id");

      // Group by module_id
      const accessByModule: Record<string, string[]> = {};
      allAccess?.forEach(a => {
        if (!accessByModule[a.module_id]) {
          accessByModule[a.module_id] = [];
        }
        accessByModule[a.module_id].push(a.tariff_id);
      });

      // 3. Get user's active tariffs if logged in
      let userTariffIds: string[] = [];
      if (user) {
        const { data: subs } = await supabase
          .from("subscriptions_v2")
          .select("tariff_id")
          .eq("user_id", user.id)
          .in("status", ["active", "trial"]);
        userTariffIds = subs?.map(s => s.tariff_id).filter(Boolean) || [];
      }

      // 4. Determine access for each module
      return modulesData?.map(m => {
        const moduleTariffs = accessByModule[m.id] || [];
        
        // Access logic:
        // - Admins always have access
        // - If no tariffs defined (empty array) → public module
        // - Otherwise check if user has any of the required tariffs
        const hasAccess = isAdminUser || 
          moduleTariffs.length === 0 || 
          moduleTariffs.some(tid => userTariffIds.includes(tid));

        return { ...m, has_access: hasAccess };
      }) || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // ... rest of hook
}
```

### Шаг 2: Исправить плашку в `Knowledge.tsx`

```tsx
{/* Показывать плашку если есть ограниченный контент */}
{hasRestrictedContent && (
  <RestrictedAccessBanner 
    accessibleTariffs={restrictedModules
      .flatMap((m: any) => m.accessible_tariffs || [])
      .filter((v, i, a) => v && a.indexOf(v) === i)
    } 
  />
)}
```

### Шаг 3: Исправить загрузку tariff_ids в `AdminTrainingModules.tsx`

Заменить проблемный код:
```tsx
// УДАЛИТЬ (строки 469-471):
if (moduleAccess && editingModule && formData.tariff_ids?.length === 0 && moduleAccess.length > 0) {
  setFormData(prev => ({ ...prev, tariff_ids: moduleAccess }));
}
```

На `useEffect`:
```tsx
// В функцию openEditDialog добавить reset tariff_ids:
const openEditDialog = useCallback((module: TrainingModule) => {
  setEditingModule(module);
  setFormData({
    // ... other fields
    tariff_ids: [], // Reset - будет загружено из moduleAccess
  });
}, []);

// Добавить useEffect для синхронизации
useEffect(() => {
  if (moduleAccess && editingModule) {
    setFormData(prev => ({ ...prev, tariff_ids: moduleAccess }));
  }
}, [moduleAccess, editingModule?.id]);
```

### Шаг 4: Добавить accessible_tariffs в useSidebarModules

Дополнить возвращаемые данные названиями тарифов:

```tsx
// В query добавить загрузку названий тарифов
const { data: tariffsData } = await supabase
  .from("tariffs")
  .select("id, name");

const tariffNames: Record<string, string> = {};
tariffsData?.forEach(t => {
  tariffNames[t.id] = t.name;
});

// В маппинге модулей добавить:
return {
  ...m,
  has_access: hasAccess,
  accessible_tariffs: moduleTariffs.map(tid => tariffNames[tid]).filter(Boolean),
};
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/hooks/useSidebarModules.ts` | Переписать логику определения доступа, добавить accessible_tariffs |
| `src/pages/Knowledge.tsx` | Исправить показ плашки и передачу тарифов |
| `src/pages/admin/AdminTrainingModules.tsx` | Исправить загрузку tariff_ids при редактировании |

---

## Техническая справка

### Логика доступа (приоритет)

```text
1. Администраторы (super_admin, admin) → ПОЛНЫЙ ДОСТУП
2. Модуль без записей в module_access → ПУБЛИЧНЫЙ (доступ всем)
3. Модуль с записями в module_access → проверка tariff_id пользователя
```

### Структура данных

```text
training_modules ←→ module_access ←→ tariffs
                     (m:n связь)

subscriptions_v2 → tariff_id → проверка доступа
```

---

## Ожидаемый результат

После исправлений:
- ✅ Пользователи с FULL/BUSINESS тарифами видят контент
- ✅ Пользователи с CHAT тарифом видят плашку с CTA
- ✅ В плашке отображаются названия требуемых тарифов
- ✅ Админы видят весь контент
- ✅ Настройки доступа в карточке модуля работают корректно
