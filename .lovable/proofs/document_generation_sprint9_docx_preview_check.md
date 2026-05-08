# Sprint 9 — Preview и проверка DOCX

## Цель
Дать админу понять, что документ собран корректно ещё до скачивания: добавить
post-render check, UI карточку проверки и preview-действие в истории.

## Что сделано

### 1. Backend — post-render DOCX check
Файл: `supabase/functions/_shared/document-render.ts`

После рендера и ДО загрузки в storage происходит проверка docBuffer:
- `file_size` (байты);
- `min_size_ok` — `>= 1024 байт`;
- `mime` — фиксированный `application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
- скан `word/document.xml` + headers/footers на регулярку `\{\{...\}\}` после
  стрипа XML-тегов (учитывает разрывы run'ов);
- `unresolved_tokens[]` + `unresolved_count`;
- `ok = min_size_ok && unresolved_count === 0`;
- `checked_at` — ISO timestamp.

Результат проверки кладётся в:
- `ai_generated_documents.meta.docx_check`;
- `ai_generated_documents.warnings_snapshot` (добавляются строки
  `docx_check:unresolved_tokens:...` и `docx_check:file_too_small:...`);
- возвращается клиенту в поле `docx_check` ответа `canonical-document-generate`.

Audit logs (best-effort, не валит генерацию):
- `document.generated_docx_checked` — всегда;
- `document.generated_docx_has_unresolved_tokens` — только если `unresolved_count > 0`.

**Гарантия безопасности**: проверка не может сломать генерацию — ошибки в
сканере молча выставляют `docx_check.ok = false`, файл всё равно сохраняется и
доступен для скачивания.

### 2. UI — карточка результата
Файл: `src/components/ai-documents/CanonicalActGenerator.tsx`

После генерации показывается расширенная карточка:
- статус-бейдж: «Проверка пройдена» (emerald) или «Есть предупреждения» (amber);
- имя файла + индикатор reused;
- кнопки:
  - **Скачать DOCX** (download attribute);
  - **Открыть предпросмотр** — signed URL в новой вкладке (безопасный MVP);
  - **Скрыть**.
- блок «Проверка документа»:
  - ✅ Файл создан, размер X КБ;
  - ✅/⚠️ Размер в норме / слишком маленький;
  - ✅/⚠️ Все плейсхолдеры заменены / Незаменённые плейсхолдеры: N;
  - при unresolved — amber-блок со списком токенов и подсказкой
    «Проверьте связи плейсхолдеров или заполните недостающие данные».

При unresolved дополнительно показывается `toast.warning`.

Не реализовано (по требованию): ONLYOFFICE, Google Docs, внешние viewer'ы,
server-side DOCX→PDF конверсия (deferred).

### 3. История генерации
Файл: `src/components/ai-documents/AiDocumentsHistoryView.tsx`

- `handleDownload` теперь использует `<a download>`-trigger вместо `window.open`.
- Добавлен `handlePreview` — открывает signed URL в новой вкладке.
- В колонке имени документа — компактный badge:
  - ✅ **OK** (emerald) если `docx_check.unresolved_count === 0`;
  - ⚠️ **Проверка** (amber) если есть unresolved (с tooltip списком токенов).
- В actions добавлена кнопка «Открыть предпросмотр» (`Eye`) рядом со «Скачать DOCX».
- Условие показа кнопок расширено на `status === 'success'` (canonical pipeline).
- Технические поля по-прежнему скрыты под «Показать технические данные».

## Snapshot / meta — структура

```json
"meta": {
  "canonical": true,
  "docx_check": {
    "file_size": 24180,
    "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "min_size_ok": true,
    "unresolved_tokens": [],
    "unresolved_count": 0,
    "checked_at": "2026-05-08T13:42:11.123Z",
    "ok": true
  }
}
```

## Audit_logs — структура

```text
action:     document.generated_docx_checked
entity_id:  <ai_generated_documents.id>
meta:       { file_size, mime, unresolved_count, ok }

action:     document.generated_docx_has_unresolved_tokens   -- только если unresolved_count > 0
entity_id:  <ai_generated_documents.id>
meta:       { unresolved_tokens: [...] }
```

## Деплой
- `canonical-document-generate` — deployed (Sprint 9).
- `canonical-document-regenerate` — deployed (наследует docx_check через
  shared `generateCanonicalDocument`).

## Что НЕ делалось
- **Email** — не отправлялся.
- **Telegram** — не отправлялся.
- **Auto-send** — нет.
- **Массовая генерация** — нет (оставлено на Sprint 10+).
- **Production auto-generation по оплате** — флаг
  `documents_service_act_auto_generation_enabled` остался `false`, hook не
  вызывался.
- **Канонический флаг** `documents_canonical_generation_enabled` не менялся
  этим спринтом — статус определяет user.
- **Server-side DOCX→PDF preview** — deferred (см. Sprint 10).
- **ONLYOFFICE / Google Docs / внешние viewer'ы** — не подключались.

## Legacy не тронуто
- Edge function `document-auto-generate` — без изменений.
- Edge function `ai-generate-document` — без изменений.
- Таблица `generated_documents` — записей не добавлялось/удалялось этим спринтом.
- RLS политики — не менялись.

## Проверка вручную (после следующего ручного теста)
SQL для проверки:
```sql
SELECT id, file_name, (meta->'docx_check') AS docx_check, warnings_snapshot
FROM ai_generated_documents
WHERE meta ? 'docx_check'
ORDER BY created_at DESC LIMIT 5;

SELECT action, entity_id, meta, created_at
FROM audit_logs
WHERE action IN ('document.generated_docx_checked','document.generated_docx_has_unresolved_tokens')
ORDER BY created_at DESC LIMIT 10;
```

## Deferred на Sprint 10
- Server-side DOCX→PDF preview (отдельный edge job, `preview_file_path`).
- Контролируемый первый запуск авто-генерации по оплате под отдельным флагом.
- Batch-генерация по фильтрам заказов.
- Доставка готовых документов в личный кабинет (без email/Telegram).
