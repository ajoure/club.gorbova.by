# Sprint 4 Proof — payment hook, aliases, backfill, regenerate

## 1. SQL proof

- `app_settings`:
  - `documents_canonical_generation_enabled` = **false**
  - `documents_service_act_auto_generation_enabled` = **false**
- `document_token_aliases` — таблица создана, RLS admin-write / employee-read.
- `document_template_versions`: 1 реальная версия (`8d7a683d-…`, template `96da608b-…`, v1).
  - `detected_tokens` = 30, `token_manifest` len = 30, `validation_status` = `valid_with_warnings`, `validation_checked_at` set.
- `ai_generated_documents` = 18 (без изменений).
- `generated_documents` (legacy) = 216 (без изменений).
- `audit_logs` за последние 30 минут:
  - `document.template_backfill_dry_run` ×2
  - `document.template_backfill_executed` ×1

## 2. Edge tests

- POST `/canonical-document-payment-hook` `{order_id:"00…0", dry_run:true}` → `200 {status:"noop", reason:"flag:documents_canonical_generation_enabled=false"}` ✅
- POST `/canonical-template-backfill-validation` `{dry_run:true,force:true}` → `total_to_process:1, would_update:1, missing_files:0, total_unmapped:30` ✅
- POST `/canonical-template-backfill-validation` `{dry_run:false,force:true}` → версия `8d7a683d` обновлена (detected:30, status:`valid_with_warnings`) ✅
- `canonical-document-regenerate` deployed; preview/execute контракт описан в коде; idempotency обходится переключением `context_type='manual'`.

## 3. UI proof

- Вкладка `/admin/ai → Документы → Алиасы токенов` отображает таблицу, фильтры (alias/canonical/scope/template), создание через `TokenMappingDialog`, удаление через `AlertDialog` с audit `document.token_alias_deleted`.
- В `CanonicalTemplateVersionsPanel` — кнопка `Сопоставить` для каждого unmapped-токена и `Dry-run / Перепроверить все версии`.

## 4. Safety proof

- В `canonical-document-payment-hook` нет ни одного вызова Resend/Telegram. Поля `auto_send_email`/`auto_send_telegram` явно записываются как `false` в audit.
- `document-auto-generate`, `ai-generate-document*`, `generate-from-template`, `generate-invoice-act`, `generate-document-pdf`, `send-invoice` — не редактировались.
- `generated_documents` count: 216 → 216 (intact).
- В `grant-access-for-order` hook вызывается **fire-and-forget** (`fetch().catch()`), внутри `try/catch`, и сам hook всегда возвращает HTTP 200 — payment/access flow защищён.

## 5. Integration point

- Файл: `supabase/functions/grant-access-for-order/index.ts`, прямо перед финальным `return Response(success:true)`.
- Почему безопасно: это уже **canonical write-path SOT** для всех paid-успешных заказов (bePaid webhook, link orders, manual grants — все приходят сюда). Один универсальный hook покрывает все точки оплаты без правки `bepaid-webhook`.
- Контракт: `fetch(...).catch(warn)` без `await` → ошибка не пробьёт вверх; двойной флаг внутри hook'а → no-op в продакшне.
