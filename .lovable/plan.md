# P1 Patch — ВЫПОЛНЕН

## Что сделано

### PATCH 1: SheetJS Excel parser (`src/utils/fileExtractor.ts`)
- Заменён XML-regex парсер на SheetJS (`XLSX.read` + `sheet_to_csv`)
- Поддержка `.xls` и `.xlsx`
- Нормализация CSV: trim, удаление пустых строк и строк из разделителей, пропуск пустых листов
- Экспортирован `getFileType` для использования в UI
- Добавлен fallback по расширению файла для пустых MIME-типов

### PATCH 2: Unified extraction pipeline (`src/pages/AI.tsx`)
- `handleScenarioSubmit` полностью переведён на `extractAllFilesContent`
- **Proof**: `file.text()` больше не используется в scenario path (grep подтверждён)
- Adapter: `getFileType` + `fileToBase64` → `extractAllFilesContent` → `sendMessage`

### PATCH 3: Soft quality gate (`supabase/functions/gorbova-ai-chat/index.ts`)
- `quality === "low"` больше не блокирует — только `"empty"`
- Для `low` в file_analysis/document_review: `partial_analysis_mode: true` + structured instruction
- Обновлён `ANTI_HALLUCINATION_SUFFIX`: поддержка частичного анализа + запрет на выдумывание
- Edge function задеплоена

### PATCH 4: Seed balance_analysis
- Обновлены: `title`, `description`, `prompt_text`, `type`, `input_hint`, `launcher_title`, `launcher_description`
- НЕ затронуты: `sort_order`, `launcher_order`, `is_active`, `is_archived`, `is_visible_in_chat`
- Новый `prompt_text` требует структурированный ответ с extraction summary

## Proof
- `file.text()` в `src/pages/AI.tsx` scenario path: **0 совпадений** ✓
- `quality === 'low'` в shouldBlock: **отсутствует** ✓
- `partial_analysis_mode` пишется в metadata при `low` ✓

## DoD (ожидает тест на реальных файлах)
1. ✅ Пустой `.xlsx` → safe blocked response
2. ⏳ Баланс 5П 092016.xlsx → extraction + analysis
3. ⏳ Баланс 2011.XLS → extraction + analysis
4. ✅ `quality === "low"` → partial analysis mode
5. ✅ Нет `file.text()` в scenario path
6. ✅ Image-only → не блокируется
