

# План: Тренинги / База знаний — Навигация, Доступ, Единый визуал, Редактор контента

## Обзор текущего состояния

На основе анализа кодовой базы выявлены следующие проблемы:

### Проблема 1: Некликабельные карточки тренингов
- Карточка «Встреча Клуб» отображается, но при `has_access = false` она некликабельна
- Условие в `ModuleCard.tsx:21-27` и `Library.tsx:24-28` блокирует клик
- Кнопка «Просмотр» (глаз) ведёт на `/library/{slug}/{lesson.slug}` — корректный пользовательский маршрут

### Проблема 2: Хлебные крошки
- В `LibraryModule.tsx:103-109` и `LibraryLesson.tsx:114-124` хлебные крошки жёстко ссылаются на `/library` → «База знаний»
- Не учитывается `menu_section_key` модуля для правильной навигации

### Проблема 3: Администратор не имеет доступа к контенту
- В `useTrainingModules.tsx:112-113` доступ определяется ТОЛЬКО по тарифам:
  ```tsx
  const hasAccess = moduleAccess.length === 0 || 
    moduleAccess.some(a => userTariffIds.includes(a.tariff_id));
  ```
- Нет проверки на admin/super_admin роль
- Администратор вынужден покупать продукт или назначать себе доступ

### Проблема 4: Отсутствие единого визуала
- Карточки в разных разделах имеют разные стили
- Нет централизованной системы layout/density для контента

### Проблема 5: Редактор контента — блок «Изображение»
- В `ImageBlock.tsx` только URL-ввод, нет загрузки файла
- Поле «Alt текст» непонятно для неспециалистов
- Нет предпросмотра готового результата в режиме просмотра

### Проблема 6: Английские слова в UI
- «Callout», «Embed», «Hotspot» и другие термины требуют русификации

---

## План исправлений

### Этап 1: Доступ администратора (КРИТИЧНО)

**Файл:** `src/hooks/useTrainingModules.tsx`

Изменить логику `hasAccess` (строка 112-113):

```tsx
// Добавить проверку роли администратора
const isAdminOrSuperAdmin = async () => {
  if (!user) return false;
  const { data: isSuperAdmin } = await supabase.rpc('is_super_admin', { _user_id: user.id });
  const { data: userRole } = await supabase.rpc('get_user_role', { _user_id: user.id });
  return !!isSuperAdmin || userRole === 'admin' || userRole === 'superadmin';
};

// В enrichedModules:
const hasAccess = moduleAccess.length === 0 || 
  moduleAccess.some(a => userTariffIds.includes(a.tariff_id)) ||
  isAdminUser; // <- добавить проверку
```

Альтернатива — использовать хук `usePermissions`:
```tsx
import { usePermissions } from "@/hooks/usePermissions";

// В хуке:
const { isAdmin } = usePermissions();

// При расчёте hasAccess:
const hasAccess = isAdmin() || moduleAccess.length === 0 || 
  moduleAccess.some(a => userTariffIds.includes(a.tariff_id));
```

**Файл:** `src/hooks/useTrainingLessons.tsx`

Аналогичная логика для доступа к урокам — администратор видит всё.

---

### Этап 2: Кликабельность карточек

**Файл:** `src/components/training/ModuleCard.tsx`

Изменить `handleClick` (строка 23-27):
```tsx
const handleClick = () => {
  // Всегда позволять клик, просто навигировать
  navigate(`/library/${module.slug}`);
};
```

Убрать `cursor-not-allowed` для карточек без доступа — вместо этого показывать информативное сообщение на странице модуля.

**Файл:** `src/pages/Library.tsx`

Изменить `handleModuleClick` (строка 24-28):
```tsx
const handleModuleClick = (module: typeof modules[0]) => {
  navigate(`/library/${module.slug}`);
};
```

На странице `LibraryModule.tsx` добавить проверку доступа и показ сообщения «Нет доступа» с информацией о тарифах.

---

### Этап 3: Хлебные крошки

**Файл:** `src/pages/LibraryModule.tsx`

Заменить жёстко закодированные хлебные крошки (строка 103-109):
```tsx
<div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
  <Link 
    to={getMenuSectionPath(module.menu_section_key)} 
    className="hover:text-foreground transition-colors"
  >
    {getMenuSectionLabel(module.menu_section_key)}
  </Link>
  <ChevronRight className="h-4 w-4" />
  <span className="text-foreground">{module.title}</span>
</div>
```

Добавить хелпер-функции:
```tsx
const menuSectionMap = {
  'knowledge-videos': { path: '/knowledge', label: 'База знаний' },
  'knowledge-questions': { path: '/knowledge', label: 'База знаний' },
  'products-library': { path: '/library', label: 'Библиотека' },
  'products': { path: '/products', label: 'Продукты' },
  // ...другие секции
};

const getMenuSectionPath = (key: string | null) => 
  menuSectionMap[key || 'products-library']?.path || '/library';

const getMenuSectionLabel = (key: string | null) => 
  menuSectionMap[key || 'products-library']?.label || 'Библиотека';
```

**Файл:** `src/pages/LibraryLesson.tsx`

Аналогичные изменения для трёхуровневых хлебных крошек.

---

### Этап 4: Блок «Изображение» — загрузка файлов

**Файл:** `src/components/admin/lesson-editor/blocks/ImageBlock.tsx`

Добавить функционал загрузки:

```tsx
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, ImageIcon, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ImageBlock({ content, onChange, isEditing = true }: ImageBlockProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Валидация
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите файл изображения");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Максимальный размер: 10 МБ");
      return;
    }

    try {
      setUploading(true);
      const fileExt = file.name.split(".").pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `lesson-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("training-assets")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("training-assets")
        .getPublicUrl(filePath);

      onChange({ ...content, url: urlData.publicUrl });
      toast.success("Изображение загружено");
    } catch (error) {
      toast.error("Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  };

  // Drag & Drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const input = fileInputRef.current;
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        handleFileUpload({ target: input } as any);
      }
    }
  };

  return (
    <div className="space-y-3">
      {/* Зона загрузки с Drag & Drop */}
      <div 
        className="border-2 border-dashed rounded-lg p-4 text-center hover:border-primary/50 transition-colors"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        <Button
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Upload className="h-4 w-4 mr-2" />
          )}
          Загрузить изображение
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          или перетащите файл сюда • до 10 МБ
        </p>
      </div>

      {/* URL ввод */}
      <div className="space-y-1.5">
        <Label>Или укажите ссылку на изображение</Label>
        <Input
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onBlur={handleUrlBlur}
          placeholder="https://..."
        />
      </div>
      
      {/* Alt текст с подсказкой */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label>Описание для доступности (alt)</Label>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              Используется для программ чтения с экрана и SEO.
              Не отображается пользователю напрямую.
            </TooltipContent>
          </Tooltip>
        </div>
        <Input
          value={localAlt}
          onChange={(e) => setLocalAlt(e.target.value)}
          onBlur={handleAltBlur}
          placeholder="Краткое описание изображения"
        />
      </div>

      {/* Ширина */}
      <div className="space-y-1.5">
        <Label>Ширина: {content.width || 100}%</Label>
        <Slider ... />
      </div>

      {/* Предпросмотр */}
      {content.url && (
        <div className="flex justify-center p-4 bg-muted/30 rounded-lg">
          <img ... />
        </div>
      )}
    </div>
  );
}
```

---

### Этап 5: Русификация блоков редактора

**Файл:** `src/components/admin/lesson-editor/LessonBlockEditor.tsx`

Обновить `blockTypeConfig` (строка 112-157):

| Английский | Русский |
|------------|---------|
| Callout | Выноска |
| Embed | Встраивание |
| Timeline | Хронология |
| Steps | Шаги |
| Hotspot | Точка на изображении |

```tsx
callout: { icon: AlertCircle, label: "Выноска", color: "...", category: 'text' },
embed: { icon: Code, label: "Встраивание", color: "...", category: 'interactive' },
quiz_hotspot: { icon: Image, label: "Точка на изображении", color: "...", category: 'quiz' },
```

---

### Этап 6: Режим просмотра урока

**Файл:** `src/pages/admin/AdminLessonBlockEditor.tsx`

Добавить кнопку «Просмотр результата» и режим preview:

```tsx
const [previewMode, setPreviewMode] = useState(false);

// В header:
<Button 
  variant={previewMode ? "default" : "outline"}
  onClick={() => setPreviewMode(!previewMode)}
>
  <Eye className="mr-2 h-4 w-4" />
  {previewMode ? "Редактирование" : "Просмотр"}
</Button>

// В content:
{previewMode ? (
  <LessonBlockRenderer blocks={blocks} lessonId={lessonId} />
) : (
  <LessonBlockEditor lessonId={lessonId} />
)}
```

---

### Этап 7: Подсказки ко всем настройкам

Добавить `Tooltip` с иконкой `ℹ️` ко всем полям настроек:

- URL видео → «Поддерживаются YouTube, Vimeo, Kinescope или прямые ссылки»
- Кнопки → «Кнопки отображаются в одну строку под контентом»
- Тип контента → «Влияет на иконку и фильтрацию в каталоге»

---

## Список файлов для изменения

| Файл | Изменение |
|------|-----------|
| `src/hooks/useTrainingModules.tsx` | Добавить bypass доступа для admin/super_admin |
| `src/hooks/useTrainingLessons.tsx` | Аналогично |
| `src/components/training/ModuleCard.tsx` | Убрать блокировку клика |
| `src/pages/Library.tsx` | Убрать проверку has_access для клика |
| `src/pages/LibraryModule.tsx` | Динамические хлебные крошки + проверка доступа |
| `src/pages/LibraryLesson.tsx` | Динамические хлебные крошки |
| `src/components/admin/lesson-editor/blocks/ImageBlock.tsx` | Загрузка файлов, drag&drop, подсказки |
| `src/components/admin/lesson-editor/LessonBlockEditor.tsx` | Русификация labels |
| `src/pages/admin/AdminLessonBlockEditor.tsx` | Режим просмотра |

---

## Дополнительные улучшения (UI-only)

1. **Единый визуальный стандарт карточек**
   - Использовать `ModuleCard` везде, где отображаются модули/тренинги
   - Параметр `variant: 'grid' | 'list' | 'compact'` для разных layout

2. **Информативное сообщение при отсутствии доступа**
   - На странице модуля показывать: «Для доступа требуется тариф: {список тарифов}»
   - Кнопка «Подробнее о тарифах»

3. **Страница «Где мой контент»**
   - В админке добавить поиск по всем созданным модулям/урокам
   - Показывать путь: Раздел меню → Модуль → Урок

---

## Проверка готовности (DoD)

- [ ] Администратор видит любой контент без покупок
- [ ] Карточка тренинга кликабельна для всех
- [ ] Хлебные крошки ведут в правильный раздел меню
- [ ] Можно загрузить изображение с устройства
- [ ] Alt текст имеет понятную подпись и подсказку
- [ ] Есть режим «Просмотр результата» в редакторе
- [ ] Весь UI на русском языке
- [ ] Кнопка «Просмотр» (глаз) ведёт на реальную страницу урока

