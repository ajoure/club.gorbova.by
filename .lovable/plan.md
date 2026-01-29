
# План: Исправления навигации, хлебных крошек и импорта KB

## Выявленные проблемы (из скриншотов и запроса)

| # | Проблема | Источник |
|---|----------|----------|
| 1 | На странице урока при клике на вопрос видео НЕ запускается автоматически — только переходит к таймкоду | `LibraryLesson.tsx` + `VideoBlock.tsx` |
| 2 | Из раздела "База знаний → Вопросы" кнопка "Смотреть видеоответ" открывает Kinescope вместо внутренней навигации | Код `Knowledge.tsx` не обновился — нужно перепроверить |
| 3 | Хлебные крошки: "Библиотека курсов" → "episode-100" вместо "База знаний" → "Выпуск №100" | `DashboardBreadcrumbs.tsx` строка 23, `LibraryLesson.tsx` строка 160 |
| 4 | Импорт: "100 выпусков, но с описаниями 74" — приоритет EPISODE_SUMMARIES над файлом | `AdminKbImport.tsx` строки 733-738 |
| 5 | Все тексты должны быть на русском языке — никаких "episode-100" | Slug хранится как `episode-100`, но title должен отображаться как "Выпуск №100" |

---

## Решения

### 1. Автозапуск видео при клике на вопрос (Play)

**Проблема**: При нажатии на Play около вопроса, видео переходит к таймкоду, но НЕ запускается автоматически.

**Файл: `src/components/admin/lesson-editor/blocks/VideoBlock.tsx`**

Добавить параметр `&autoplay=1` к URL embed для Kinescope при наличии таймкода:

```typescript
case 'kinescope': {
  const videoId = url.match(/kinescope\.io\/([a-zA-Z0-9]+)/)?.[1];
  let embedUrl = videoId ? `https://kinescope.io/embed/${videoId}` : url;
  if (timecode && timecode > 0) {
    embedUrl += `?t=${Math.floor(timecode)}&autoplay=1`;  // Добавить autoplay=1
  }
  return embedUrl;
}
```

**Файл: `src/pages/LibraryLesson.tsx`**

Также добавить key для принудительного ремаунта iframe при смене timecode:

```tsx
<LessonBlockRenderer 
  key={`blocks-${activeTimecode ?? 'init'}`}  // Ремаунт при смене таймкода
  blocks={blocks} 
  lessonId={currentLesson?.id} 
  activeTimecode={activeTimecode}
/>
```

### 2. Кнопка "Смотреть видеоответ" из Базы знаний

**Файл: `src/pages/Knowledge.tsx`**

Код уже использует `navigate()` внутрь платформы (строки 63-72). Проблема может быть в том, что `hasInternalLink` = false для некоторых вопросов.

Проверить условие — возможно lesson/module данные не загружаются корректно. Добавить fallback:

```tsx
// Если lesson данные не загружены, попробовать получить из другого источника
const hasInternalLink = question.lesson?.slug && question.lesson?.module?.slug;

// Убедиться что navigate работает только при наличии данных
if (!hasInternalLink) {
  console.warn(`Question ${question.id} missing lesson/module data`);
}
```

### 3. Хлебные крошки на русском языке

**Файл: `src/components/layout/DashboardBreadcrumbs.tsx`**

Изменить строку 23:
```typescript
"/library": "База знаний",  // БЫЛО: "Библиотека курсов"
```

**Файл: `src/pages/LibraryLesson.tsx`**

Хлебная крошка для урока (`currentLesson.title`) уже отображается корректно как "Выпуск №100" (если title в БД = "Выпуск №100").

Проблема: скриншот показывает `episode-100` — это slug, а не title!

Проверить строку 160:
```tsx
<span className="text-foreground">{currentLesson.title}</span>  // Должен быть title, не slug
```

Если проблема в том, что title = slug, нужно исправить импорт.

### 4. Описания из файла вместо EPISODE_SUMMARIES

**Файл: `src/pages/admin/AdminKbImport.tsx`**

Текущий приоритет (строки 733-738):
```typescript
description: EPISODE_SUMMARIES[ep.episodeNumber] || 
  ep.shortDescription || 
  getEpisodeSummary(...)
```

**Изменить приоритет — файл важнее справочника:**

```typescript
// Priority: file shortDescription > file fullDescription > EPISODE_SUMMARIES > fallback
description: ep.shortDescription || 
  ep.fullDescription ||
  EPISODE_SUMMARIES[ep.episodeNumber] || 
  getEpisodeSummary(ep.episodeNumber, ep.questions.map((q) => q.title)),
```

И в `importEpisode()` (строки 837-839):
```typescript
const description = episode.shortDescription || 
  episode.fullDescription ||
  (state.usePredefinedSummaries ? EPISODE_SUMMARIES[episode.episodeNumber] : null) ||
  episode.description;
```

### 5. Счётчик "с описаниями" в UI

**Файл: `src/pages/admin/AdminKbImport.tsx`**

Текущий счётчик (строка 1137):
```typescript
const predefinedCount = state.episodes.filter((e) => EPISODE_SUMMARIES[e.episodeNumber]).length;
```

Изменить на:
```typescript
const withDescriptionCount = state.episodes.filter(
  (e) => e.shortDescription || e.fullDescription || EPISODE_SUMMARIES[e.episodeNumber]
).length;
```

И обновить UI для отображения:
```tsx
{withDescriptionCount} из {stats.totalEpisodes} выпусков с описаниями
```

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/components/admin/lesson-editor/blocks/VideoBlock.tsx` | Добавить `&autoplay=1` к Kinescope embed URL |
| `src/pages/LibraryLesson.tsx` | Убедиться что отображается title, не slug |
| `src/components/layout/DashboardBreadcrumbs.tsx` | `/library` → "База знаний" |
| `src/pages/admin/AdminKbImport.tsx` | Приоритет описаний: файл > справочник; счётчик "с описаниями" |
| `src/pages/Knowledge.tsx` | Убедиться что внутренняя навигация работает |

---

## Технические детали

### VideoBlock.tsx — автозапуск видео

```typescript
// Строки 42-48 — функция getEmbedUrl
case 'kinescope': {
  const videoId = url.match(/kinescope\.io\/([a-zA-Z0-9]+)/)?.[1];
  let embedUrl = videoId ? `https://kinescope.io/embed/${videoId}` : url;
  if (timecode && timecode > 0) {
    // Добавить autoplay=1 для автозапуска при наличии таймкода
    embedUrl += `?t=${Math.floor(timecode)}&autoplay=1`;
  }
  return embedUrl;
}
```

### DashboardBreadcrumbs.tsx — русские названия

```typescript
// Строка 23
"/library": "База знаний",  // БЫЛО: "Библиотека курсов"
```

### AdminKbImport.tsx — приоритет описаний

```typescript
// Строки 733-738 — при парсинге
.map((ep) => ({
  ...ep,
  // NEW Priority: file > справочник > fallback
  description: ep.shortDescription || 
    ep.fullDescription ||
    EPISODE_SUMMARIES[ep.episodeNumber] || 
    getEpisodeSummary(ep.episodeNumber, ep.questions.map((q) => q.title)),
  errors: ep.questions.flatMap((q) => q.errors),
}));

// Строки 837-839 — при импорте
const description = episode.shortDescription || 
  episode.fullDescription ||
  (state.usePredefinedSummaries ? EPISODE_SUMMARIES[episode.episodeNumber] : null) ||
  episode.description;
```

### AdminKbImport.tsx — счётчик описаний

```typescript
// Строка 1137 — изменить predefinedCount на withDescriptionCount
const withDescriptionCount = state.episodes.filter(
  (e) => e.shortDescription || e.fullDescription || EPISODE_SUMMARIES[e.episodeNumber]
).length;

// И в UI (около строки 1203):
{withDescriptionCount} из {stats.totalEpisodes} выпусков с описаниями
```

---

## Ожидаемый результат

1. При клике на Play у вопроса — видео автоматически переходит к таймкоду И запускается
2. Кнопка "Смотреть видеоответ" ведёт внутрь платформы (не на Kinescope)
3. Хлебные крошки: "База знаний" → "Выпуск №100" (всё на русском)
4. Импорт показывает "100 выпусков с описаниями" (берёт из файла)
5. Никаких английских названий типа "episode-100" в UI

---

## DoD (обязательно)

1. Открыть страницу урока, нажать Play на вопросе — видео запустится автоматически
2. Открыть "База знаний → Вопросы", нажать "Смотреть видеоответ" — остаться внутри платформы
3. Проверить хлебные крошки: "База знаний > Выпуск №100"
4. Открыть `/admin/kb-import`, загрузить файл — видеть "100 из 100 выпусков с описаниями"
5. Скриншоты: хлебные крошки, автозапуск видео, страница импорта
