# PATCH-TEMPLATE-UPLOAD-VERSIONING-2026-05 — execute

## Изменения (frontend-only)
Файл: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`

### 1. `handleUpload` — авто-версионирование
- Перед INSERT в `document_templates` ищем существующий шаблон по `lower(trim(name))`.
- Если найден: `template_id` переиспользуется, версия вставляется с `version_number = max+1`, `document_templates` НЕ изменяется (имя, статус, current_version_id, code, template_path остаются прежними).
- Если не найден: как раньше — INSERT template + v1.
- Toast различает оба сценария.
- Аудит: `document_template.version_uploaded` (reused) / `document_template.uploaded` (new), с `version_number`, `reused_template`.

### 2. Авто-активация
После авто-валидации (`openPreview`) перечитываем версию; если `validation_status='valid'` и `markup_status ∈ {null,'marked'}` и `!is_current` — invoke `canonical-template-activate-version`. Ошибки активации не блокируют UI (fallback: ручная активация).

### 3. Per-version «Сделать активной»
В таблице версий, в правой колонке: кнопка появляется для версии, которая `valid` + `marked` + не `is_current`. Клик → `activateVersion` → backend `canonical-template-activate-version` (атомарно переключает `is_current` и `current_version_id`).

### 4. UX подсказка в форме загрузки
Под полем «Имя шаблона»:
- если имя совпало с существующим → «Будет добавлена версия vN. Настройки кнопок оплаты не изменятся.» (зелёным)
- иначе при непустом имени → «Будет создан новый шаблон (v1).»

## Совместимость с payment-кнопками
`tariff_offers.meta.document_scenarios[].template_id` ссылается на `document_templates.id`. При добавлении версии этот id не меняется → конфигурация офферов сохраняется автоматически. Подтверждено `OfferDocumentScenariosCard.tsx` (хранит только `template_id`).

## Что НЕ менялось
- Backend / RLS / миграции / edge functions
- `document_templates.code`, `template_path`, `template_status`, `current_version_id` при добавлении версии
- Soft-delete и markup flow

## DoD
1. ✅ Повторная загрузка `.docx` с тем же именем → v+1 у того же template_id (дублей нет)
2. ✅ Новое имя → новый шаблон + v1
3. ✅ Auto-activate при valid+marked
4. ✅ Per-version rollback через «Сделать активной»
5. ✅ Подсказка в форме видна
6. ✅ Аудит-события отправляются
7. ✅ payment-кнопки не ломаются (template_id стабилен)

## Rollback
git revert изменений в `StrictDocumentTemplatesManager.tsx`.
