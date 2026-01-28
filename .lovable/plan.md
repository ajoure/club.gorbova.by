
# План: Исправить генерацию обложки и размер карточки мастера

## Проблемы

1. **AI генерирует абстрактные фоны** — промпт в Edge Function использует общие инструкции "gradient background, geometric shapes", а не тематические изображения на основе контента урока.

2. **Текст не помещается в карточку мастера** — на скриншоте видно, что индикатор шагов обрезается, step indicator "Готово" не видно целиком.

## Решение

### 1. Изменить промпт генерации в Edge Function

**Файл:** `supabase/functions/generate-cover/index.ts`

**Текущий промпт:**
```
Create a minimalist, modern cover image for an educational module titled "${title}".
Description: ${description}.
Style: Clean gradient background with subtle abstract geometric shapes.
Professional business education aesthetic.
Modern, elegant, soft colors.
NO text, NO letters, NO words on the image.
```

**Новый промпт (тематический):**
```
Create a thematic cover image that visually represents the topic of an educational lesson.

Title: "${title}"
${description ? `Topics covered: ${description}` : ""}

Requirements:
- Create meaningful visual representation of the lesson topics
- Include relevant business/accounting themed imagery (documents, charts, calculators, coins, buildings, computers, etc.)
- Professional illustration style
- Clean, modern aesthetic with subtle gradients
- Bright but professional color palette
- 1200x630 pixels (16:9 aspect ratio)
- NO text, NO letters, NO words on the image

The image should help the viewer understand what topics this lesson covers by looking at the visual elements.
```

### 2. Исправить размер карточки мастера

**Файл:** `src/components/admin/trainings/ContentCreationWizard.tsx`

**Проблема:** На маленьких экранах индикатор шагов обрезается.

**Решение:**
- Увеличить `max-w-3xl` до `max-w-4xl`
- Добавить `overflow-x-auto` к контейнеру индикатора шагов
- Обеспечить горизонтальную прокрутку для step indicator на мобильных устройствах

```tsx
// Строка 641: изменить max-w-3xl на max-w-4xl
<DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col p-0">

// Строка 651: добавить overflow-x-auto для scroll на мобильных
<div className="px-6 pb-2 shrink-0 overflow-x-auto">
```

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `supabase/functions/generate-cover/index.ts` | Новый тематический промпт для AI |
| `src/components/admin/trainings/ContentCreationWizard.tsx` | Увеличить ширину диалога и добавить горизонтальную прокрутку индикатора |

## Результат

- ✅ AI будет генерировать тематические изображения, связанные с контентом урока
- ✅ Индикатор шагов полностью видим в карточке мастера
- ✅ На мобильных устройствах можно прокрутить шаги горизонтально


также генератор картинки должен быть виден и работать при редактировании урока и с возможностью изменить картинку или вернуть прошлую. 
