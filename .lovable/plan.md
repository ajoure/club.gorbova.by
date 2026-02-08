## Что вижу по расследованию (почему "снова не работает видео")

По скриншоту это **kquest-урок** `/library/buhgalteriya-kak-biznes/test-v-kakoj-roli-vy-nahodites-sejchas`, шаг "Видео", блок типа **`video_unskippable`**.

Я проверил данные блока в базе:
- `lesson_id`: `96c970e6-d530-473c-84ab-06b176d1c98a`
- `block_type`: `video_unskippable`
- `url`: `https://kinescope.io/56dt29aFG1S6pFKicF8j9f`
- `provider`: `kinescope`
- `threshold_percent`: `95`
- `duration_seconds`: `600`

### Главная причина (P0)
В `VideoUnskippableBlock.tsx` для Kinescope в режиме ученика включается **IframePlayer API режим** (`useKinescopePlayer`) и рисуется **пустой div-контейнер** под плеер:

```tsx
{shouldUseKinescopeHook ? (
  <div id="kinescope-unskippable-..." />
) : (
  <iframe ... />
)}
```

Но если IframePlayer API **не смог инициализироваться** (скрипт не загрузился, create() упал, блокировщик/сеть/временный сбой), то:
- контейнер остаётся пустым → пользователь видит **чёрный прямоугольник**
- и важное: **fallback-логика (кнопка "Начать просмотр" + таймер на 600с)** сейчас показывается *только* для `iframe`-режима, а для `shouldUseKinescopeHook=true` она не включается  
→ в итоге пользователь застревает и не может пройти шаг.

Это объясняет симптом "видео чёрное / не работает", при этом прогресс 0% и подтверждение недоступно.

### Второй риск (усиливает "снова")
В `useKinescopePlayer.ts` загрузка SDK кэшируется глобальной `scriptLoadPromise`.
Если загрузка однажды завершилась ошибкой, промис может остаться "сломленным" и повторные попытки в рамках SPA-сессии не перезапустят загрузку корректно (нет безопасного retry).

---

## Цель патча
Сделать видео "неубиваемым":
1) Если Kinescope IframePlayer API не поднялся — **автоматически откатиться на iframe embed** (и включить существующий fallback-таймер на 600 сек).
2) Добавить **retry/устойчивость** в `useKinescopePlayer` для временных ошибок и/или альтернативного URL формата.

---

## План исправления (точечные правки, без рефакторинга лишнего)

### A) PATCH-V1 (P0): VideoUnskippableBlock — добавить fallback с IframePlayer → iframe
**Файл:** `src/components/admin/lesson-editor/blocks/VideoUnskippableBlock.tsx`

1) Добавить локальный флаг режима:
- `const [kinescopeApiEnabled, setKinescopeApiEnabled] = useState(true);`

2) Уточнить условие `shouldUseKinescopeHook`:
- было: `... && !isEditing && !isCompleted`
- станет: `... && !isEditing && !isCompleted && kinescopeApiEnabled`

3) В `onError` у `useKinescopePlayer`:
- при ошибке: `setKinescopeApiEnabled(false)`
- (опционально) лог + мягкий toast "Переключили плеер на резервный режим"

4) Рендер:
- если `kinescopeApiEnabled=false` → показывать `iframe` (embedUrl) вместо пустого div
- тем самым включается существующая логика:
  - postMessage listener (для событий)
  - автодетекция API (3 сек)
  - кнопка "Начать просмотр"
  - fallback-таймер на `duration_seconds` (600)

5) Улучшить построение embedUrl для Kinescope:
- вместо `url.split('/').pop()` использовать `extractKinescopeVideoId(url)` (чтобы не ломаться на `?t=...` и др.)
- embedUrl формировать так: `https://kinescope.io/embed/${videoId}?autoplay=0`

**Guardrails соблюдаем:**
- не трогаем Input/onBlur, Slider/onValueCommit, addRow/deleteRow, init effect rows→setLocalRows — это про другие блоки
- меняем только поведение Kinescope-плеера в `video_unskippable` (минимальный diff)

---

### B) PATCH-V2 (P1): useKinescopePlayer — устойчивость загрузки SDK + retry URL
**Файл:** `src/hooks/useKinescopePlayer.ts`

1) Если загрузка SDK (script.onerror) завершилась ошибкой:
- сбросить `scriptLoadPromise = null`, чтобы следующее открытие урока могло повторить попытку

2) При ошибке `IframePlayer.create`:
- попробовать второй формат URL:
  - попытка 1: `https://kinescope.io/${videoId}`
  - попытка 2 (fallback): `https://kinescope.io/embed/${videoId}`
- если обе неудачны — вызвать `onError` (чтобы `VideoUnskippableBlock` переключился на iframe)

Это add-only/guarded поведение: не меняем внешние API хука, только добавляем устойчивость.

---

## Проверка и доказательства (DoD)

### 1) UI-пруфы (обязательно, на проде, под админом Сергея 7500084@gmail.com)
На уроке: **"Тест: В какой роли вы находитесь сейчас"** → шаг "Видео":

A. Нормальный сценарий:
- Плеер виден (не чёрный экран), есть интерфейс/видео
- Прогресс просмотра начинает расти
- Скрин №1: видео отображается + видно "Просмотрено: X% из 95%"

B. Резервный сценарий (если API сломан/блокируется):
- Появляется кнопка "Начать просмотр"
- Запускается таймер (из 600 секунд)
- Скрин №2: виден fallback UI (кнопка/таймер) и прогресс

### 2) Функционально
- После достижения порога/таймера кнопка "Я просмотрел(а) видео" становится активной
- Переход к следующему шагу работает

### 3) Технические пруфы
- В консоли (если API падает): лог о переключении в iframe fallback (без красных бесконечных ошибок)
- Diff-summary: изменены только 2 файла:
  - `VideoUnskippableBlock.tsx` (fallback режим)
  - `useKinescopePlayer.ts` (retry)

---

## Важное про публикацию
Я также вижу, что последний деплой падал с ошибкой **Cloudflare R2 429** (лимит на загрузку объектов). Это инфраструктурная/временная проблема: даже после фикса кода нужно будет убедиться, что публикация действительно прошла (и при необходимости повторить publish позже, когда лимит отпустит), иначе прод останется на старой версии.
