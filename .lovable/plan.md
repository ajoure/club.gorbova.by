
# План: Исправление навигации, хлебных крошек, авторизации и AI-генерации

## Выявленные проблемы

### 1. Выбрасывает на страницу логина при пересборке превью в Lovable
**Причина:** При HMR (Hot Module Replacement) или пересборке приложения в превью Lovable теряется React-состояние (включая AuthContext), и на долю секунды `user === null`. В `ProtectedRoute.tsx` и `DomainRouter.tsx` это мгновенно триггерит редирект на `/auth`.

**Также:** Уже исправленный код в `DomainRouter.tsx` перенаправляет авторизованных пользователей на `/dashboard`, но при HMR `authLoading` может быть `false` раньше, чем сессия восстановится из localStorage.

### 2. Хлебные крошки непонятные
На скриншоте `image-699.png` видно:
- Пользователь на `/knowledge` 
- Хлебная крошка: 🏠 > База знаний
- Модули с `menu_section_key: knowledge-videos` **не отображаются** (страница пустая: "Материалы пока не добавлены")

**Проблема в коде:**
- В `Knowledge.tsx` модули берутся из `useSidebarModules()` и группируются по `modulesBySection[tab.key]`
- Табы берутся из `usePageSections("knowledge")` — возвращает вкладки типа "Видеоответы" с `key: knowledge-videos`
- Но модули создаются с `menu_section_key: knowledge-videos`, а в `useSidebarModules` нет фильтрации по knowledge-* — возвращаются ВСЕ модули

**Но главная проблема:** Модули **созданы**, но не **появляются** в UI — потому что после создания не инвалидируется `["sidebar-modules", userId]` и `["page-sections-tabs", "knowledge"]`.

### 3. AI генерация обложки не работает
**Проверка:**
- Функция `generate-cover` существует в `supabase/functions/generate-cover/index.ts`
- Конфиг есть в `config.toml` (строка 297-298)
- **НО:** Логов функции нет → функция не развёрнута или недоступна
- Секрет `LOVABLE_API_KEY` присутствует ✓

**Необходимо:** Принудительно развернуть функцию и протестировать.

---

## План исправлений

### Этап 1: Устранение ложного logout при HMR в превью

**Файл:** `src/components/layout/ProtectedRoute.tsx`

Добавить более "терпеливое" ожидание восстановления сессии:

```typescript
import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  // Дополнительная задержка для HMR — даём время Supabase восстановить сессию
  const [isInitializing, setIsInitializing] = useState(true);
  
  useEffect(() => {
    // Ждём 500ms перед тем как считать, что пользователь точно не авторизован
    const timer = setTimeout(() => setIsInitializing(false), 500);
    return () => clearTimeout(timer);
  }, []);

  // Показываем loader пока loading ИЛИ пока идёт инициализация
  if (loading || isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?redirectTo=${redirectTo}`} replace />;
  }

  return <>{children}</>;
}
```

**Файл:** `src/components/layout/DomainRouter.tsx`

Такая же логика для `DomainHomePage`:

```typescript
// Добавить useState для isInitializing и useEffect с 500ms задержкой
// Показывать Loader2 пока authLoading ИЛИ isInitializing
```

### Этап 2: Инвалидация кэша после создания модулей/вкладок

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx`

После создания модуля (строка ~244) добавить:

```typescript
import { useQueryClient } from "@tanstack/react-query";

// В компоненте:
const queryClient = useQueryClient();

// После успешного создания модуля:
queryClient.invalidateQueries({ queryKey: ["sidebar-modules"] });
queryClient.invalidateQueries({ queryKey: ["page-sections-tabs", "knowledge"] });
queryClient.invalidateQueries({ queryKey: ["training-modules"] });
```

**Файл:** `src/components/admin/trainings/ContentSectionSelector.tsx`

После создания/удаления вкладки:

```typescript
// Исправить существующий код инвалидации:
// БЫЛО:
queryClient.invalidateQueries({ queryKey: ["page-sections-tabs"] });

// СТАНЕТ:
queryClient.invalidateQueries({ queryKey: ["page-sections-tabs"] }); // общий ключ
queryClient.invalidateQueries({ queryKey: ["page-sections-tabs", parent.page_key] }); // конкретный
queryClient.invalidateQueries({ queryKey: ["page-sections-tree"] });
```

### Этап 3: Исправление отображения модулей в /knowledge

**Файл:** `src/pages/Knowledge.tsx`

Проблема: `modulesBySection[tab.key]` возвращает пустой массив, потому что `useSidebarModules` группирует по `menu_section_key`, но на странице отображается:

```tsx
// Строка 286:
const modules = modulesBySection[tab.key] || [];
```

**Проверка:** Убедиться, что `useSidebarModules` возвращает модули с правильным `menu_section_key: knowledge-videos`.

Если модули не появляются — нужно проверить:
1. Реальные данные в БД (`training_modules.menu_section_key`)
2. Фильтрацию в `useSidebarModules.ts` (строка 42: `.eq("is_active", true)`)

**Добавить отладочный вывод** (временно, для диагностики):

```tsx
// В Knowledge.tsx, после получения данных:
console.log("[Knowledge] tabs:", tabs);
console.log("[Knowledge] modulesBySection:", modulesBySection);
console.log("[Knowledge] effectiveActiveTab:", effectiveActiveTab);
```

### Этап 4: Развёртывание AI функции generate-cover

**Действие:** Принудительно развернуть edge function через deploy tool.

После развёртывания протестировать вызов:
- Метод: POST
- Path: `/generate-cover`
- Body: `{ "title": "Тестовый модуль", "description": "Описание" }`

### Этап 5: Улучшение обработки ошибок в UI генерации

**Файл:** `src/components/admin/trainings/ModuleFormFields.tsx`

Улучшить `handleGenerateCover` (строки 125-163):

```typescript
const handleGenerateCover = async () => {
  if (!formData.title) {
    toast.error("Введите название модуля для генерации обложки");
    return;
  }

  setGenerating(true);
  const toastId = toast.loading("Генерация обложки AI... (~15 сек)");
  
  try {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.access_token) {
      toast.error("Необходимо авторизоваться", { id: toastId });
      return;
    }

    const response = await supabase.functions.invoke("generate-cover", {
      body: {
        title: formData.title,
        description: formData.description,
        moduleId: moduleId || "new",
      },
    });

    if (response.error) {
      console.error("Generate cover error:", response.error);
      
      // Детализированные ошибки
      if (response.error.message?.includes("404")) {
        toast.error("Функция генерации недоступна. Обратитесь в поддержку.", { id: toastId });
      } else if (response.error.message?.includes("429")) {
        toast.error("Превышен лимит запросов. Попробуйте позже.", { id: toastId });
      } else {
        toast.error(`Ошибка: ${response.error.message}`, { id: toastId });
      }
      return;
    }

    if (response.data?.url) {
      onChange({ ...formData, cover_image: response.data.url });
      toast.success("Обложка сгенерирована!", { id: toastId });
    } else {
      toast.error("Не удалось получить URL обложки", { id: toastId });
    }
  } catch (error: any) {
    console.error("Generation error:", error);
    toast.error(`Ошибка генерации: ${error.message}`, { id: toastId });
  } finally {
    setGenerating(false);
  }
};
```

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/components/layout/ProtectedRoute.tsx` | Добавить 500ms задержку перед редиректом на логин |
| `src/components/layout/DomainRouter.tsx` | Аналогичная задержка для главной страницы |
| `src/components/admin/trainings/ContentCreationWizard.tsx` | Инвалидировать кэш после создания модуля |
| `src/components/admin/trainings/ContentSectionSelector.tsx` | Исправить инвалидацию при создании/удалении вкладок |
| `src/pages/Knowledge.tsx` | Добавить диагностику (временно) |
| `src/components/admin/trainings/ModuleFormFields.tsx` | Улучшить обработку ошибок генерации |
| Edge function `generate-cover` | Развернуть |

---

## Технические детали

### Почему 500ms задержка?

При HMR в Lovable:
1. Vite пересобирает модуль
2. React-дерево полностью перемонтируется
3. AuthContext инициализируется заново с `user: null, loading: true`
4. `supabase.auth.getSession()` вызывается асинхронно
5. **Между шагами 3 и 4** проходит 100-300ms, и если ProtectedRoute рендерится в этот момент — происходит ложный редирект

500ms — безопасный запас для восстановления сессии из localStorage.

### Проверка после исправлений

1. **Превью Lovable:** Отправить сообщение → страница обновится → остаться залогиненным
2. **База знаний:** Создать модуль → он появится в `/knowledge` без перезагрузки
3. **AI обложка:** Нажать кнопку AI → получить сгенерированную картинку

---

## Результат

1. **Нет ложных logout** при обновлении превью в Lovable
2. **Модули появляются мгновенно** в /knowledge после создания
3. **AI генерация работает** с понятными сообщениями об ошибках
4. **Хлебные крошки** корректно указывают на /knowledge для knowledge-* модулей
