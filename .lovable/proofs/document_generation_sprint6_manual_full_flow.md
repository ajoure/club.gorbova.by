# Sprint 6 Proof — manual full flow генерации документов

## 1. SQL counts

| Метрика | Значение |
|---|---|
| `ai_generated_documents` (active) | **18** (без изменений) |
| `generated_documents` (legacy) | **216** (без изменений) |
| `document_template_versions` | **2** (+1 тестовая) |
| `document_token_aliases` | **6** (+6 для шаблона `96da608b…`) |
| flag `documents_canonical_generation_enabled` | **false** |
| flag `documents_service_act_auto_generation_enabled` | **false** |

## 2. Тестовый шаблон «Акт выполненных работ TEST»

- DOCX сгенерирован через docx-js, загружен в `documents-templates/templates/act_test_sprint6.docx` (8.8 KB).
- `document_templates.id = 11111111-1111-1111-1111-111111111111`, `code = act_test_sprint6`.
- Версия v1 = `7ca3c870-8f9e-4422-ae9a-d80fe243725f`.

### canonical-template-validate result
- detected_count = **12**
- mapped_count = **12**
- unmapped_count = **0**
- validation_status = **valid**
- Токены (все mapped к registry):
  `executor.name`, `executor.unp`, `executor.address`,
  `customer.name`, `customer.unp`, `customer.address`,
  `deal.product_name`, `deal.amount`, `deal.amount_words`, `deal.currency`,
  `document.number`, `document.date`.

## 3. Реальный шаблон `96da608b…`: маппинг unmapped → canonical

Сопоставлено 6 unmapped плейсхолдеров (template-scope aliases):

| alias_token (как в DOCX) | canonical_token_key |
|---|---|
| `cn-phone-121577` | `customer.phone` |
| `cn-email-121579` | `customer.email` |
| `cn-name-$-full_name_to_initial` | `customer.short_name` |
| `cn-first_name-$` | `customer.name` |
| `ld-i_naimenovanie_(kratko)-707199` | `executor.short_name` |
| `ld-i_unp-707203` | `executor.unp` |

### Backfill validation (после aliases)
- detected_count = **30** (без изменений)
- mapped_count: **0 → 6** (через `via_alias`, scope=`template`)
- unmapped_count: **30 → 24**
- validation_status = `valid_with_warnings`
- В `token_manifest` появилось поле `via_alias = { canonical_token_key, scope }` для каждого замапленного через alias токена.

## 4. История генерации (UI)

`AiDocumentsHistoryView` теперь показывает:
- колонки: Дата, Документ (со значком ✨ для canonical), Шаблон, Источник, Статус, Действия;
- фильтры: поиск, переключатель «Только новый генератор»;
- переключатель «Показать технические данные» — раскрывает Версия / ID источника / Кто создал;
- действия: 👁 «Слепок данных и источники», 🔁 «Перегенерировать» (только для canonical), ⬇ «Скачать DOCX», 🗑 «Удалить».

### DocumentSnapshotDialog
- Tabs: Данные / Источники подстановки / Сырой JSON (только в техрежиме).
- Данные сгруппированы по секциям (Исполнитель/Заказчик/Сделка/Документ).
- Источники: токен → человекочитаемая метка → бейдж статуса (Найдено/Нет данных/Не сопоставлено).
- В техрежиме показываются `resolver_key` / `field_id` и сырые JSON блоки + копирование.

### RegenerateDocumentDialog
- Mode `preview` → дифф «было/стало» по полям snapshot.
- Кнопка «Создать новую версию документа» → `mode=execute, confirm=true`.
- Старая запись не модифицируется; новая создаётся с `regenerated_from_document_id` и audit `document.regenerated`.
- Кнопка disabled при `missing_tokens > 0`.

## 5. Тестовая генерация по реальному заказу

**STOP-guard сработал:** `documents_canonical_generation_enabled = false`.
- Edge function `canonical-document-generate` (mode=execute) при выключенном флаге возвращает `feature_disabled` без сайд-эффектов.
- В этом спринте production-генерация по конкретному заказу **намеренно не запускалась** — требуется отдельное подтверждение пользователя на временное включение флага только для тестового заказа.
- Тестовый шаблон `act_test_sprint6` валидирован 12/12 mapped и **готов к генерации в момент включения флага**.

## 6. Безопасность / legacy

- `generated_documents` count: **216 → 216** (intact).
- `ai_generated_documents` count: **18 → 18** (никаких новых записей в Sprint 6, т.к. флаг false и реальная генерация не запускалась).
- Edge functions `ai-generate-document`, `generate-from-template`, `document-auto-generate`, `generate-invoice-act`, `generate-document-pdf`, `send-invoice` — **не редактировались**.
- В `canonical-document-payment-hook` и `canonical-document-regenerate` нет вызовов Resend / Telegram. Email/Telegram рассылка не выполнялась.
- В `grant-access-for-order` integration остаётся fire-and-forget с двойным флагом — без изменений.

## 7. Изменённые файлы Sprint 6

- `src/components/ai-documents/AiDocumentsHistoryView.tsx` — переписана история.
- `src/components/ai-documents/DocumentSnapshotDialog.tsx` — новый.
- `src/components/ai-documents/RegenerateDocumentDialog.tsx` — новый.
- `src/hooks/useAiDocuments.ts` — расширен тип `AiGeneratedDocument` (canonical-поля).
- `supabase/functions/canonical-template-validate/index.ts` — alias-aware validation, добавлено поле `via_alias` в `token_manifest`.

## 8. Не делалось (по требованиям)

- ❌ email-рассылка
- ❌ Telegram-рассылка
- ❌ массовая генерация
- ❌ production auto-generation (флаг `documents_service_act_auto_generation_enabled` = false)
- ❌ запись в реальный production-заказ (флаг `documents_canonical_generation_enabled` = false)

## 9. Что требует подтверждения

- Временное включение `documents_canonical_generation_enabled = true` на одном тестовом заказе для smoke-генерации DOCX по реальному order_id (затем выключение).
