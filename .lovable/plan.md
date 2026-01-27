
# План: Улучшение мастера добавления контента и исправление багов тренингов

## Выявленные проблемы

### 1. Размер диалога мастера слишком мал
- На скриншотах видно, что поля «Стиль отображения» обрезаются
- Нужно увеличить высоту и ширину диалога
- Шаги прогресса обрезаются справа

### 2. Ошибка «duplicate key value violates unique constraint»
- В консоли: `training_modules_slug_key` уже существует
- Модуль `baza-znanij` уже есть в БД (id: `300bffb2-...`)
- Нужно проверять уникальность slug перед созданием и предлагать альтернативу

### 3. Нет возможности удалять созданные вкладки
- Сейчас `ContentSectionSelector` умеет только создавать вкладки
- Нужно добавить кнопку удаления для вкладок (только созданных пользователем)

### 4. Шаг урока избыточен
- video_url из формы не используется в редакторе контента
- Редактор блоков — единственное место для добавления видео
- Нужно упростить шаг урока до названия + описание (без типа контента и URL)

### 5. Режим «Просмотр» показывает пустую страницу
- Блок видео создан (id: `92a3bf6d-...`), в нём есть контент
- Проблема: `useLessonBlocks` в режиме preview не обновляет данные
- Кнопка «Просмотр» показывает «Нет блоков для отображения»

### 6. Хлебные крошки ведут на /library вместо /knowledge
- Модули созданы с `menu_section_key: products-library`
- Хлебные крошки показывают «База знаний» → `/library`
- Нужно корректно маппировать на `/knowledge` для knowledge-секций

### 7. Нет кнопки генерации обложки AI
- Пользователь хочет кнопку «Сгенерировать обложку» рядом с загрузкой
- Использовать Lovable AI (`google/gemini-2.5-flash-image`)

---

## План исправлений

### Этап A: Увеличение диалога мастера

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx`

Изменения:
1. Увеличить `max-w-2xl` до `max-w-3xl`
2. Добавить минимальную высоту `min-h-[600px]`
3. Улучшить отступы контента

**Файл:** `src/components/admin/trainings/WizardStepIndicator.tsx`

Изменения:
- Сделать шаги более компактными для мобильных
- Добавить горизонтальный скролл на узких экранах

---

### Этап B: Проверка уникальности slug

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx`

Логика:
1. Перед созданием модуля проверять существование slug в БД:
```typescript
const checkSlugExists = async (slug: string): Promise<boolean> => {
  const { data } = await supabase
    .from("training_modules")
    .select("id")
    .eq("slug", slug)
    .limit(1);
  return data && data.length > 0;
};
```
2. Если slug занят — добавить суффикс `-2`, `-3` и т.д.
3. Показать предупреждение пользователю

---

### Этап C: Удаление созданных вкладок

**Файл:** `src/components/admin/trainings/ContentSectionSelector.tsx`

Изменения:
1. Добавить кнопку удаления рядом с каждой вкладкой в правой колонке
2. Удалять можно только вкладки с `kind: 'tab'` (не страницы)
3. Запретить удаление если есть связанные модули
4. Добавить диалог подтверждения

```tsx
const handleDeleteSection = async (key: string) => {
  // Проверить наличие модулей с этой секцией
  const { data: modules } = await supabase
    .from("training_modules")
    .select("id")
    .eq("menu_section_key", key)
    .limit(1);

  if (modules && modules.length > 0) {
    toast.error("Нельзя удалить: есть привязанные модули");
    return;
  }

  await supabase.from("user_menu_sections").delete().eq("key", key);
};
```

---

### Этап D: Упрощение шага урока

**Файл:** `src/components/admin/trainings/LessonFormFields.tsx`

Изменения:
1. Убрать поля: `content_type`, `video_url`, `audio_url`, `duration_minutes`
2. Оставить только: `title`, `slug`, `description`
3. Добавить подсказку: «Контент урока добавляется в редакторе блоков после создания»

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx`

Изменения:
1. При создании урока устанавливать `content_type: 'mixed'` по умолчанию
2. Убрать условные поля для video/audio

---

### Этап E: Исправление режима «Просмотр»

**Файл:** `src/pages/admin/AdminLessonBlockEditor.tsx`

Проблема: `useLessonBlocks` вызывается с `lessonId`, но `blocks` пустой при первом рендере.

Решение:
1. Добавить `refetch()` при переключении режима
2. Использовать `blocks` из хука напрямую:

```tsx
const { blocks, refetch } = useLessonBlocks(lessonId);

const handleTogglePreview = () => {
  setPreviewMode(!previewMode);
  if (!previewMode) {
    refetch(); // Обновить блоки перед показом preview
  }
};
```

---

### Этап F: Исправление хлебных крошек

**Файл:** `src/pages/LibraryModule.tsx` и `src/pages/LibraryLesson.tsx`

Текущий маппинг:
```typescript
'knowledge-videos': { path: '/library', label: 'База знаний' },
```

Нужно:
```typescript
'knowledge-videos': { path: '/knowledge', label: 'База знаний' },
'knowledge-questions': { path: '/knowledge', label: 'База знаний' },
'products-library': { path: '/products?tab=library', label: 'Моя библиотека' },
```

---

### Этап G: Генерация обложки AI

**Файл:** `src/components/admin/trainings/ModuleFormFields.tsx`

Новые элементы:
1. Кнопка «Сгенерировать обложку» рядом с полем URL
2. При нажатии вызывать edge function

**Файл:** `supabase/functions/generate-cover/index.ts` (новый)

Логика:
1. Получить название модуля и описание
2. Вызвать Lovable AI с моделью `google/gemini-2.5-flash-image`
3. Загрузить результат в storage `training-assets`
4. Вернуть URL

```typescript
const prompt = `Создай минималистичную обложку для обучающего модуля "${title}". 
Стиль: современный, чистый, градиентный фон с абстрактными формами. 
Формат: 1200x630px, без текста.`;

const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "google/gemini-2.5-flash-image",
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
  }),
});
```

---

### Этап H: Мобильная адаптация

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx`

Изменения:
1. На мобильных — fullscreen диалог (уже есть в базовом Dialog)
2. Компактные лейблы шагов
3. Вертикальный скролл для форм

**Файл:** `src/components/admin/trainings/ModuleFormFields.tsx`

Изменения:
1. `DisplayLayoutSelector` — горизонтальный скролл на мобильных
2. Уменьшить padding для compact режима

---

## Файлы для создания/изменения

| Файл | Действие |
|------|----------|
| `src/components/admin/trainings/ContentCreationWizard.tsx` | Увеличить диалог, проверка slug, упростить логику |
| `src/components/admin/trainings/WizardStepIndicator.tsx` | Адаптивные шаги |
| `src/components/admin/trainings/ContentSectionSelector.tsx` | Добавить удаление вкладок |
| `src/components/admin/trainings/LessonFormFields.tsx` | Упростить форму урока |
| `src/components/admin/trainings/ModuleFormFields.tsx` | Добавить кнопку генерации AI |
| `src/pages/admin/AdminLessonBlockEditor.tsx` | Исправить preview |
| `src/pages/LibraryModule.tsx` | Исправить хлебные крошки |
| `src/pages/LibraryLesson.tsx` | Исправить хлебные крошки |
| `supabase/functions/generate-cover/index.ts` | Создать edge function для AI |
| `supabase/config.toml` | Добавить конфиг для новой функции |

---

## Технические детали

### Проверка уникальности slug
```typescript
const ensureUniqueSlug = async (baseSlug: string): Promise<string> => {
  let slug = baseSlug;
  let suffix = 2;
  
  while (await checkSlugExists(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  
  return slug;
};
```

### Условие удаления вкладки
- Только если `kind === 'tab'`
- Только если нет модулей с этим `menu_section_key`
- С диалогом подтверждения

### AI генерация обложки
- Модель: `google/gemini-2.5-flash-image`
- Формат ответа: base64 изображение
- Сохранение в storage: `training-assets/ai-covers/{moduleId}.png`
- UI: индикатор загрузки, кнопка «Перегенерировать»

---

## Проверка готовности (DoD)

- [ ] Диалог мастера помещает все поля без обрезки
- [ ] Шаги прогресса видны полностью
- [ ] Slug проверяется на уникальность перед созданием
- [ ] Созданные вкладки можно удалять (с защитой)
- [ ] Форма урока упрощена (только название + описание)
- [ ] Режим «Просмотр» показывает созданные блоки
- [ ] Хлебные крошки ведут на правильные страницы
- [ ] Кнопка «Сгенерировать обложку» работает
- [ ] Мобильная версия не ломается
- [ ] Весь UI на русском языке
