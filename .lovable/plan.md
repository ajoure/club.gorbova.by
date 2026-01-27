
# План: Комплексное исправление мастера контента и навигации

## Обнаруженные проблемы (по коду)

### 1. Неправильные маршруты "Назад" (вызывают 404)

**Файл:** `src/pages/admin/AdminLessonBlockEditor.tsx` (строка 82, 109)
```tsx
// ТЕКУЩИЙ КОД (неправильно):
navigate(`/admin/training-lessons/${moduleId}`)

// НУЖНО:
navigate(`/admin/training-modules/${moduleId}/lessons`)
```

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx` (строки 352, 359)
```tsx
// handleEditLesson - правильно: /admin/training-lessons/${moduleId}/edit/${lessonId}

// handleAddAnotherLesson - НЕПРАВИЛЬНО:
navigate(`/admin/training-lessons/${createdModuleId}`)
// НУЖНО:
navigate(`/admin/training-modules/${createdModuleId}/lessons`)
```

### 2. "Назад к приложению" ведёт на лендинг вместо кабинета

**Файл:** `src/components/layout/AdminSidebar.tsx` (строка 310)
```tsx
// ТЕКУЩИЙ КОД:
<NavLink to="/" ...>

// НУЖНО:
<NavLink to="/dashboard" ...>
```

### 3. "Админ-панель" вместо "Панель управления" в меню пользователя

**Файл:** `src/components/layout/AppSidebar.tsx` (строки 271-274)
```tsx
// ТЕКУЩИЙ КОД:
tooltip={collapsed ? "Админ-панель" : undefined}
{!collapsed && <span>Админ-панель</span>}

// НУЖНО:
tooltip={collapsed ? "Панель управления" : undefined}
{!collapsed && <span>Панель управления</span>}
```

### 4. Форма урока содержит лишние поля (video_url, content, audio_url)

**Файл:** `src/pages/admin/AdminTrainingLessons.tsx` (строки 88-220)
- Компонент `LessonFormContent` содержит:
  - Тип контента (content_type) — не нужен
  - URL видео (video_url) — не нужен (контент в блоках)
  - URL аудио (audio_url) — не нужен
  - HTML контент (content) — не нужен
  - Длительность — можно оставить

**Решение:** Упростить `LessonFormContent` до:
- Название, Slug, Описание, Активен

### 5. Генерация обложки не работает (функция не развёрнута)

**Файл:** `supabase/functions/generate-cover/index.ts`
- Код есть и правильный
- Конфиг в `config.toml` есть (строка 297-298)
- Логов нет → функция не развёрнута

**Решение:** Развернуть функцию принудительно

### 6. DomainHomePage не редиректит залогиненного пользователя

**Файл:** `src/components/layout/DomainRouter.tsx` (строки 43-46)
```tsx
// ТЕКУЩИЙ КОД:
if (isMainDomain) {
  return <Landing />;  // ← Всегда лендинг, даже если залогинен!
}

// НУЖНО:
// Добавить проверку авторизации и редирект на /dashboard
```

---

## План изменений

### Этап 1: Исправить все маршруты "Назад"

**Файл:** `src/pages/admin/AdminLessonBlockEditor.tsx`
- Строка 82: `navigate(/admin/training-modules/${moduleId}/lessons)`
- Строка 109: `navigate(/admin/training-modules/${moduleId}/lessons)`

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx`
- Строка 359: `navigate(/admin/training-modules/${createdModuleId}/lessons)`

### Этап 2: Исправить "Назад к приложению"

**Файл:** `src/components/layout/AdminSidebar.tsx`
- Строка 310: Изменить `to="/"` на `to="/dashboard"`

### Этап 3: Переименовать "Админ-панель" → "Панель управления"

**Файл:** `src/components/layout/AppSidebar.tsx`
- Строка 271: tooltip → "Панель управления"
- Строка 274: `<span>Панель управления</span>`
- Строка 266: Группа label → "Управление" (вместо "Администрирование")

### Этап 4: Упростить форму урока

**Файл:** `src/pages/admin/AdminTrainingLessons.tsx`

Заменить `LessonFormContent` на упрощённую версию:
```tsx
const LessonFormContent = memo(function LessonFormContent({ 
  formData, 
  onFormDataChange,
  editingLesson 
}: LessonFormContentProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="lesson-title">Название *</Label>
          <Input
            id="lesson-title"
            value={formData.title}
            onChange={(e) => {
              const newTitle = e.target.value;
              onFormDataChange(prev => ({
                ...prev,
                title: newTitle,
                slug: editingLesson ? prev.slug : generateSlug(newTitle),
              }));
            }}
            placeholder="Введение в тему"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lesson-slug">URL-slug *</Label>
          <Input
            id="lesson-slug"
            value={formData.slug}
            onChange={(e) => onFormDataChange(prev => ({ ...prev, slug: e.target.value }))}
            placeholder="vvedenie-v-temu"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="lesson-description">Краткое описание</Label>
        <Textarea
          id="lesson-description"
          value={formData.description}
          onChange={(e) => onFormDataChange(prev => ({ ...prev, description: e.target.value }))}
          placeholder="О чём этот урок..."
          rows={2}
        />
      </div>

      <Alert className="border-primary/30 bg-primary/5">
        <Blocks className="h-4 w-4 text-primary" />
        <AlertDescription className="ml-2">
          Видео, текст и другой контент добавляются через кнопку «Контент» после создания урока
        </AlertDescription>
      </Alert>

      <div className="flex items-center space-x-2">
        <Switch
          id="lesson-is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) => onFormDataChange(prev => ({ ...prev, is_active: checked }))}
        />
        <Label htmlFor="lesson-is_active">Активен</Label>
      </div>
    </div>
  );
});
```

Также обновить `formData` state:
```tsx
const [formData, setFormData] = useState<TrainingLessonFormData>({
  module_id: moduleId || "",
  title: "",
  slug: "",
  description: "",
  content: "",
  content_type: "mixed",  // Всегда mixed
  video_url: "",
  audio_url: "",
  duration_minutes: undefined,
  is_active: true,
});
```

### Этап 5: Добавить редирект на /dashboard для залогиненных

**Файл:** `src/components/layout/DomainRouter.tsx`

```tsx
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

export function DomainHomePage() {
  const { user, loading } = useAuth();
  const hostname = window.location.hostname;
  
  const isMainDomain = hostname === "localhost" || 
                       hostname === "127.0.0.1" ||
                       hostname === "club.gorbova.by" ||
                       hostname === "gorbova.by" ||
                       hostname.includes(".lovable.app") ||
                       hostname.includes(".lovableproject.com");
  
  // ... остальные проверки доменов ...

  // Main domain: если залогинен → кабинет, иначе → лендинг
  if (isMainDomain) {
    if (loading) {
      return <Loader2 className="..." />;
    }
    if (user) {
      return <Navigate to="/dashboard" replace />;
    }
    return <Landing />;
  }
  
  // ... остальной код ...
}
```

### Этап 6: Развернуть edge function generate-cover

Принудительно развернуть функцию через deploy tool.

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/pages/admin/AdminLessonBlockEditor.tsx` | Исправить маршруты "Назад" (2 места) |
| `src/components/admin/trainings/ContentCreationWizard.tsx` | Исправить маршрут handleAddAnotherLesson |
| `src/components/layout/AdminSidebar.tsx` | "Назад к приложению" → `/dashboard` |
| `src/components/layout/AppSidebar.tsx` | "Админ-панель" → "Панель управления" |
| `src/pages/admin/AdminTrainingLessons.tsx` | Упростить форму урока (убрать video_url, content, audio_url) |
| `src/components/layout/DomainRouter.tsx` | Редирект залогиненных на /dashboard |

---

## Результат после выполнения

1. **Нет 404** — кнопка "Назад" из редактора контента ведёт на список уроков модуля
2. **"Назад к приложению"** ведёт в личный кабинет (`/dashboard`), а не на лендинг
3. **Нет ощущения "выброса"** — перезагрузка "/" при авторизации ведёт в кабинет
4. **"Панель управления"** — единое название в меню
5. **Простая форма урока** — только название, slug, описание (без дублирования редактора блоков)
6. **AI-обложка работает** — функция развёрнута и доступна

---

## Технические детали

### Проверка уникальности slug
Уже реализована в `ContentCreationWizard.tsx` через `ensureUniqueSlug()` — добавляет суффикс `-2`, `-3` если slug занят.

### LOVABLE_API_KEY
Секрет уже настроен в проекте — функция должна работать после развёртывания.

### React Query invalidation
При создании модулей/вкладок нужно инвалидировать:
- `["page-sections-tabs", pageKey]`
- `["sidebar-modules", userId]`

Это уже частично реализовано, но может потребовать дополнительных проверок в ContentSectionSelector.

---

## Порядок реализации

1. Исправить маршруты (AdminLessonBlockEditor, ContentCreationWizard)
2. Исправить "Назад к приложению" (AdminSidebar)
3. Переименовать "Админ-панель" (AppSidebar)
4. Упростить форму урока (AdminTrainingLessons)
5. Добавить редирект для залогиненных (DomainRouter)
6. Развернуть edge function generate-cover
