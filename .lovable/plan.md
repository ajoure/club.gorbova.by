

# План: Реорганизация страницы "Тренинги" и перенос "Импорт КБ"

## Обзор задач

1. Удалить кнопки "Excel" и "GetCourse" полностью (и их сущности — диалоги)
2. Добавить кнопку "Импорт" → ссылка на `/admin/kb-import`
3. Добавить вкладку "Прогресс" для перехода к `/admin/training-lessons/:moduleId/progress/:lessonId`
4. Унифицировать стиль и размер всех кнопок сверху

## Текущее состояние

На скриншоте видно:
- Вкладки: "Модули", "Настройки" (слева в стиле pills)
- Кнопки справа: "Excel" (outline), "GetCourse" (outline), "Мастер" (primary, фиолетовый), "Добавить" (outline)

Проблемы:
- Кнопки разных стилей и размеров
- "Excel" и "GetCourse" больше не нужны
- Нет быстрого доступа к "Прогресс учеников" с этой страницы

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/pages/admin/AdminTrainingModules.tsx` | Удалить импорты диалогов, удалить state для них, удалить кнопки Excel/GetCourse, добавить кнопку "Импорт", унифицировать стили |
| `src/components/admin/ExcelTrainingImportDialog.tsx` | **УДАЛИТЬ ФАЙЛ** — больше не используется |
| `src/components/admin/GetCourseContentImportDialog.tsx` | **УДАЛИТЬ ФАЙЛ** — больше не используется |

## Детальные изменения

### 1. AdminTrainingModules.tsx

**Удалить импорты (строки 62-63):**
```tsx
// УДАЛИТЬ:
import { GetCourseContentImportDialog } from "@/components/admin/GetCourseContentImportDialog";
import { ExcelTrainingImportDialog } from "@/components/admin/ExcelTrainingImportDialog";
```

**Удалить state переменные (строки 364-365):**
```tsx
// УДАЛИТЬ:
const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
const [isExcelImportOpen, setIsExcelImportOpen] = useState(false);
```

**Добавить новую вкладку "Прогресс" в tab-bar:**

Текущие вкладки: "Модули" | "Настройки"
Новые вкладки: "Модули" | "Прогресс" | "Настройки"

Вкладка "Прогресс" будет открывать селектор модуля/урока для просмотра прогресса (или показывать список последних активных уроков).

**Упростить панель кнопок (строки 541-558):**

```tsx
{/* Desktop actions - унифицированный стиль */}
<div className="hidden md:flex items-center gap-2">
  <Button 
    variant="outline" 
    size="sm" 
    onClick={() => navigate("/admin/kb-import")}
  >
    <Upload className="mr-1.5 h-4 w-4" />
    Импорт
  </Button>
  <Button 
    variant="outline" 
    size="sm" 
    onClick={() => setIsWizardOpen(true)}
  >
    <Wand2 className="mr-1.5 h-4 w-4" />
    Мастер
  </Button>
  <Button 
    variant="default" 
    size="sm" 
    onClick={openCreateDialog}
  >
    <Plus className="mr-1.5 h-4 w-4" />
    Добавить
  </Button>
</div>
```

Примечание: "Мастер" меняется на `outline`, "Добавить" становится `default` (primary) — это единственная акцентная кнопка.

**Обновить мобильное меню (строки 560-587):**

```tsx
<DropdownMenuContent align="end">
  <DropdownMenuItem onClick={openCreateDialog}>
    <Plus className="h-4 w-4 mr-2" />
    Добавить модуль
  </DropdownMenuItem>
  <DropdownMenuItem onClick={() => setIsWizardOpen(true)}>
    <Wand2 className="h-4 w-4 mr-2" />
    Мастер добавления
  </DropdownMenuItem>
  <DropdownMenuItem onClick={() => navigate("/admin/kb-import")}>
    <Upload className="h-4 w-4 mr-2" />
    Импорт КБ
  </DropdownMenuItem>
</DropdownMenuContent>
```

**Удалить диалоги из рендера (строки 733-742):**
```tsx
// УДАЛИТЬ:
<GetCourseContentImportDialog ... />
<ExcelTrainingImportDialog ... />
```

### 2. Новая вкладка "Прогресс"

Добавить третью вкладку между "Модули" и "Настройки":

```tsx
<button
  onClick={() => setActiveTab("progress")}
  className={cn(
    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200",
    activeTab === "progress"
      ? "bg-background text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground"
  )}
>
  <Users className="h-3.5 w-3.5" />
  <span>Прогресс</span>
</button>
```

Для содержимого вкладки "Прогресс" — показать список квест-уроков с кнопками перехода:

```tsx
{activeTab === "progress" && (
  <ProgressTabContent modules={modules} />
)}
```

Где `ProgressTabContent` — отдельный компонент, который:
1. Получает список модулей
2. Для каждого модуля получает уроки с `completion_mode = 'kvest'`
3. Показывает их в виде списка с кнопкой "Прогресс" → `/admin/training-lessons/:moduleId/progress/:lessonId`

### 3. Удаление файлов

Полностью удалить:
- `src/components/admin/ExcelTrainingImportDialog.tsx` (712 строк)
- `src/components/admin/GetCourseContentImportDialog.tsx` (759 строк)

Эти компоненты больше не используются нигде в проекте.

## Визуальный результат

**Было (на скриншоте):**
```
[Модули] [Настройки]          [Excel] [GetCourse] [Мастер*] [+ Добавить]
```
(* — фиолетовый акцент)

**Станет:**
```
[Модули] [Прогресс] [Настройки]          [Импорт] [Мастер] [+ Добавить*]
```
(* — primary/default акцент только на "Добавить")

Все кнопки:
- `size="sm"` — одинаковый размер
- "Импорт" и "Мастер" — `variant="outline"`
- "Добавить" — `variant="default"` (акцент)

## Содержимое вкладки "Прогресс"

Показывает карточки или список квест-уроков:

| Модуль | Урок | Учеников | Завершено | Действие |
|--------|------|----------|-----------|----------|
| Бухгалтерия как бизнес | Урок 1 | 5 | 2 | [Открыть →] |

Клик → переход на `/admin/training-lessons/:moduleId/progress/:lessonId`

## DoD (Definition of Done)

| Проверка | Ожидаемый результат |
|----------|---------------------|
| Кнопки "Excel" и "GetCourse" | Полностью удалены |
| Кнопка "Импорт" | Ведёт на `/admin/kb-import` |
| Вкладка "Прогресс" | Отображает список квест-уроков |
| Все кнопки справа | Одинаковый размер (`sm`) и стиль |
| Мобильное меню | Обновлено без Excel/GetCourse |
| Файлы диалогов | Удалены из проекта |

