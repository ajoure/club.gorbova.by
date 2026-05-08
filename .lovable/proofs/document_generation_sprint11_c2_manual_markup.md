# Sprint 11 — C2: ручная разметка DOCX, auto-suggest, apply

Дата: 2026-05-08. Коммит C2 из 3.

## 0. Закрытые риски C1

| Риск C1 | Решение в C2 |
|---|---|
| Активация версии client-only | Оставлена client-side с TODO. **RLS proof:** policy `doc_tpl_versions_admin_all` (USING+CHECK = `has_role_v2(uid,'admin') OR has_role_v2(uid,'super_admin')`) и `Admins can update document templates` блокируют не-админам UPDATE → невозможно «активировать» чужой шаблон. Перенос в edge `canonical-template-activate-version` запланирован в C3. |
| Upload/preview/validation без audit | Добавлены server-side audit-события через новую edge `canonical-template-audit` (JWT + admin-role enforced; `actor_user_id` берётся из JWT, никогда из body). |

Список новых audit-событий:

- `document_template.uploaded`
- `document_template.preview_opened`
- `document_template.validation_passed`
- `document_template.validation_failed`
- `document_template.markup_started`
- `document_template.markup_applied` ← пишется уже самой apply-функцией
- `document_template.version_activated` (пока инициируется client → edge audit)
- `document_template.deleted` (зарезервировано в whitelist)

## 1. Миграция

`document_template_versions`:

- расширён CHECK `validation_status`: добавлены `pending`, `invalid`;
- добавлена колонка `markup_status` (`unmarked` | `in_progress` | `marked`), default `unmarked`.

## 2. Новые edge functions

### `canonical-template-audit`

- JWT обязателен; роль ∈ {admin, super_admin, owner}; whitelist событий.
- Меta всегда обогащается `template_id` / `template_version_id` из body, но `actor_user_id` — только из JWT.

### `canonical-template-apply-markup`

Вход:

```json
{
  "template_version_id": "uuid",
  "replacements": [
    { "original_text": "250 рублей", "field_public_id": "FLD-000125", "status": "accepted" }
  ]
}
```

Логика:

1. JWT + admin-role guard.
2. Валидация: каждый `field_public_id` соответствует `^FLD-\d+$` и существует в `fields_registry` (active).
3. Скачивание исходного DOCX из storage, PizZip распаковка.
4. Замены применяются в двух проходах:
   - **A**: внутри отдельных `<w:t>` тегов;
   - **B**: paragraph-level merge — для текстов, разбитых на runs внутри одного `<w:p>`. Поддерживает многорангу: первый run получает placeholder + хвост, промежуточные обнуляются, последний — оставшийся хвост.
   - На вход и выход добавляется `xml:space="preserve"`.
5. Сохранение DOCX как новой версии (`version_number = max+1`) в том же bucket.
6. Re-extract токенов через shared `extractDocxTokensWithLocations` + strict validation:
   - `^field:FLD-\d+$` → recognized;
   - всё остальное → `legacy_placeholder_format_detected`;
   - неизвестный FLD → `unknown_field_public_id`;
   - 0 токенов → `no_placeholders_in_template`.
7. Запись новой строки `document_template_versions` c `markup_status='marked'`, `validation_status` из проверки, `token_manifest = [{ field_public_id }]` (НИКАКИХ token_key/alias/legacy_cf).
8. `audit_logs.action = 'document_template.markup_applied'` с метриками applied/missed/skipped/validation.

Ответ: `{ new_version_id, applied_count, missed[], validation, token_manifest }`.

**Известное ограничение:** замены не покрывают text-boxes/SmartArt — они хранятся в нестандартных частях DOCX. Для MVP админ дочищает такие места заранее.

## 3. Auto-suggest (`src/utils/templateAutoSuggest.ts`)

- Источник истинности — `document_token_registry` JOIN `fields_registry.public_id`. Если `field_id` отсутствует, токен не показывается.
- Якорные метки (`Сумма:`, `Заказчик:`, `Исполнитель:`, `Услуга:`, `Тариф:`, `Срок:`, `Дата:`, `№:`, `Валюта:`) → `confidence='high'`.
- Регексы (сумма+валюта, дата, email, УНП) → `confidence='medium'`.
- Дедуп по перекрывающимся диапазонам (ранг high>medium>low).
- **Никаких автоматических замен**: каждый suggestion со статусом `suggested`, превращается в `accepted`/`changed`/`skipped` только по явному действию админа.

## 4. UI (`TemplateMarkupDialog.tsx`)

- Левая панель: plain-text DOCX через `mammoth.extractRawText`, подсвеченные диапазоны (suggested = amber, accepted/changed = emerald, skipped = strikethrough).
- Правая панель: таблица suggestions с колонками **Найденный текст / Поле / Confidence / Действия**.
- Field picker — единственный путь выбора FLD; поиск по `FLD-…`, token_key, label; отдаёт **только** `field_public_id`.
- Кнопка «Применить разметку» → `canonical-template-apply-markup`. Toast показывает new_version_number, applied/missed/validation status.
- Перед открытием диалога фронт зовёт `canonical-template-audit` с `markup_started`.

## 5. DoD сверка

| Требование | Статус |
|---|---|
| `field_id` / `fields_registry.public_id` — основной идентификатор разметки | ✅ |
| В DOCX primary формат `{{field:FLD-XXXXXX}}` | ✅ — apply-markup пишет только этот формат |
| `token_manifest` содержит **только** `field_public_id` | ✅ — `Set<string>` → `[{field_public_id}]` |
| Никаких alias/legacy_cf в новой pipeline | ✅ — grep по `{{document.|customer.|executor.|cf.|deal.}}` в C2-файлах = пусто |
| Auto-suggest не делает автозамен | ✅ — все suggestions начинают со статуса `suggested` |
| Picker полей FLD-only | ✅ — value = `FLD-XXXXXX`, выводится `{{field:FLD-...}}` |
| Apply создаёт новую версию (immutable history) | ✅ — `version_number = max+1`, новый storage_path |
| Validation пере-запускается после apply | ✅ — server-side strict validation поверх записанного DOCX |
| Audit upload/preview/validation/markup | ✅ — server-side через `canonical-template-audit` + автоматический audit внутри apply |
| RLS не даёт не-админу активировать | ✅ — policy `doc_tpl_versions_admin_all` + `Admins can update document templates` |
| Активация client-side помечена TODO | ✅ — комментарий в `activateVersion` |
| Email/Telegram/auto-generation flag не трогались | ✅ |

## 6. Файлы

- migration: `document_template_versions.validation_status` extended + `markup_status`
- created: `supabase/functions/canonical-template-audit/index.ts`
- created: `supabase/functions/canonical-template-apply-markup/index.ts`
- created: `src/utils/templateAutoSuggest.ts`
- created: `src/components/ai-documents/TemplateMarkupDialog.tsx`
- edited: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx` (audit calls, markup launch button, dialog wiring)
- edited: `supabase/functions.registry.txt` (+2 functions)

## 7. Что осталось на C3

- `canonical-template-activate-version` server-side (перенос активации из UI).
- Генерация документа из сделки (`canonical-document-generate` уже есть — будет переписана под FLD-only вход).
- Edit полей сделки + audit field-value changes.
- Физическое удаление dead-code legacy файлов и legacy edge functions (`ai-generate-*`, `generate-from-template`, `generate-invoice-act`, `generate-document-pdf`, `document-auto-generate`).
- `_shared/document-render.ts` — переписать под единственный strict резолвер `{{field:FLD-XXXXXX}}` без legacy-веток.
