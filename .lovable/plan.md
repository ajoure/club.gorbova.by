

# План: Финальные исправления импорта видеоответов

## Диагностика корневых проблем

### Проблема 1: Таймкод открывает последнюю секунду видео
На скриншоте видно URL: `kinescope.io/kkD3FMZcEeyWEmDvsinCDJ?t=16620`

- `16620` секунд = 4 часа 37 минут
- Видео длится ~1:06:45 (4005 секунд)
- Таймкод превышает длительность → Kinescope прыгает в конец

**Причина**: Excel хранит таймкоды вроде `04:37:00` (4 минуты 37 секунд) как Date объект. Текущий `parseTimecode` извлекает время через `getUTCHours()`, получая `4 * 3600 + 37 * 60 = 16620` секунд. Но реальный таймкод — это **4:37** (4 минуты 37 секунд = 277 секунд).

**Решение**: Добавить эвристику — если полученные секунды превышают разумную длительность видео (~3 часов = 10800 сек), и "часы" < 60 — скорее всего это MM:SS, не HH:MM:SS. Тогда пересчитываем: `h * 60 + m` секунд.

### Проблема 2: Дата в формате YYYY-MM-DD
На скриншоте `2024-01-08` вместо `08.01.2024`.

**Причина**: В `LibraryLesson.tsx` строка 344 нет форматирования даты:
```tsx
<div className="mb-4 text-sm text-muted-foreground">{episode.answerDate}</div>
```

**Решение**: Использовать `format(parseISO(date), "dd.MM.yyyy")` как в других местах.

### Проблема 3: AI-обложки не генерируются
На скриншоте карточка выпуска без обложки (пустой placeholder).

**Причина**: При импорте урока `thumbnail_url` не заполняется. Edge Function `generate-cover` не вызывается.

**Решение**: При создании нового урока вызывать `generate-cover` или ставить дефолтную обложку.

### Проблема 4: Клик по вопросу открывает внешнюю вкладку
Пользователь хочет, чтобы видео на странице выпуска перематывалось по клику на вопрос, без ухода на kinescope.io.

**Причина**: В `LibraryLesson.tsx` строки 341-344:
```tsx
onClick={() => {
  const url = buildKinescopeUrlWithTimecode(q.kinescope_url, q.timecode_seconds);
  if (url !== "#") window.open(url, "_blank");
}}
```

**Решение**: Вместо `window.open` — обновлять URL embed-плеера на странице, добавляя `?t=seconds` или используя postMessage API Kinescope.

### Проблема 5: Описание урока обрезается
На скриншоте видно, что описание выпуска обрезается ("Самозанятый и закупка товаров собственного производства, налог на недвижимость по зарядкам для электромобилей, шины из командировки в учете, курсовые разницы по стройке.").

**Причина**: CSS ограничивает высоту или применяется `line-clamp`.

**Решение**: Убрать ограничение высоты для описания на странице урока.

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/hooks/useKbQuestions.ts` | PATCH: parseTimecode — автокоррекция MM:SS при больших значениях |
| `src/pages/LibraryLesson.tsx` | PATCH: формат даты DD.MM.YYYY, внутренний seek вместо external link, убрать clamp описания |
| `src/pages/admin/AdminKbImport.tsx` | PATCH: генерация AI-обложки при импорте |
| `src/components/admin/lesson-editor/blocks/VideoBlock.tsx` | PATCH: поддержка изменения URL с таймкодом для seek |

---

## Технические детали реализации

### PATCH A: Автокоррекция таймкодов MM:SS

**Файл**: `src/hooks/useKbQuestions.ts` → `parseTimecode`

Добавить эвристику после извлечения времени из Date:

```typescript
// После: const total = h * 3600 + m * 60 + s;

// Эвристика: если total > 10800 (3 часа) и h < 60 
// — вероятно, формат MM:SS, а не HH:MM:SS
if (total > 10800 && h < 60 && s === 0) {
  // Интерпретируем как MM:SS
  const corrected = h * 60 + m;
  return corrected > 0 ? corrected : null;
}
```

Логика:
- `04:37:00` → Date → h=4, m=37, s=0
- total = 4*3600 + 37*60 = 16620 (больше 3 часов)
- h=4 < 60, s=0 → это MM:SS
- Возвращаем 4*60 + 37 = 277 секунд

### PATCH B: Формат даты на странице урока

**Файл**: `src/pages/LibraryLesson.tsx`

1. Импортировать:
```typescript
import { format, parseISO } from "date-fns";
```

2. В блоке video content (где отображается дата эпизода), форматировать:
```tsx
{currentLesson.published_at && (
  <div className="text-sm text-muted-foreground mb-4">
    {format(parseISO(currentLesson.published_at), "dd.MM.yyyy")}
  </div>
)}
```

### PATCH C: Внутренний seek по таймкоду

**Файл**: `src/pages/LibraryLesson.tsx`

Вместо `window.open` — перезагружать iframe с новым URL:

1. Добавить state для текущего URL видео:
```typescript
const [videoUrl, setVideoUrl] = useState<string | null>(null);
```

2. Инициализировать из blocks:
```typescript
useEffect(() => {
  const videoBlock = blocks.find(b => b.block_type === 'video');
  if (videoBlock) {
    const content = videoBlock.content as { url?: string };
    if (content.url) setVideoUrl(content.url);
  }
}, [blocks]);
```

3. При клике на вопрос — обновлять URL:
```tsx
onClick={() => {
  if (q.timecode_seconds && videoUrl) {
    const newUrl = buildKinescopeUrlWithTimecode(videoUrl, q.timecode_seconds);
    setVideoUrl(newUrl);
    // Scroll to video
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}}
```

4. Передать `videoUrl` в VideoBlock или использовать key для перезагрузки iframe:
```tsx
<VideoBlock 
  key={videoUrl} // Force re-render on URL change
  content={{ url: videoUrl || '', provider: 'kinescope' }} 
  onChange={() => {}} 
  isEditing={false} 
/>
```

### PATCH D: Генерация AI-обложки при импорте

**Файл**: `src/pages/admin/AdminKbImport.tsx` → `importEpisode()`

После создания нового урока (когда `!existing`):

```typescript
if (!existing) {
  // ... создание урока
  
  // Генерация AI-обложки
  try {
    const { data: coverData, error: coverError } = await supabase.functions.invoke("generate-cover", {
      body: { 
        title, 
        description: description || `Выпуск ${episode.episodeNumber}`, 
        moduleId 
      },
    });
    
    if (coverData?.url && !coverError) {
      await supabase
        .from("training_lessons")
        .update({ thumbnail_url: coverData.url })
        .eq("id", lessonId);
    }
  } catch (err) {
    console.warn("Cover generation failed:", err);
    // Не блокируем импорт при ошибке генерации обложки
  }
}
```

### PATCH E: Убрать ограничение описания

**Файл**: `src/pages/LibraryLesson.tsx`

В секции описания урока (строка ~182):
```tsx
{currentLesson.description && (
  <p className="text-muted-foreground mt-2">
    {currentLesson.description}
  </p>
)}
```

Убедиться, что нет `line-clamp-*` или `truncate` классов.

---

## DoD (Definition of Done)

1. **Таймкоды корректные**: `04:37:00` → 277 секунд (4 мин 37 сек)
2. **Видео стартует с правильного места**: не с конца
3. **Дата**: `08.01.2024` (не `2024-01-08`)
4. **Клик по вопросу**: video на странице перематывается, не открывается внешняя вкладка
5. **AI-обложки**: генерируются при импорте новых выпусков
6. **Описание**: не обрезается, отображается полностью

### SQL-пруфы после фикса:
```sql
SELECT episode_number, timecode_seconds 
FROM kb_questions 
WHERE episode_number = 74 
ORDER BY timecode_seconds 
LIMIT 5;
-- Ожидание: значения < 10000 секунд (< 3 часов)
```

### Визуальная проверка:
- Страница выпуска №74: дата `08.01.2024`
- Клик по вопросу: видео перематывается, страница не уходит
- Обложки выпусков не пустые

