# Sprint 3S v2 — Discovery: partial access pattern

## access_rules schema (актуально)
- `grant_target_type text NOT NULL` CHECK IN ('entitlement','club','email','product_access','training_content','section_access')
- `target_ref text NOT NULL` — sentinel-строка либо UUID
- `conditions jsonb` — основной носитель партиал-настроек
- UNIQUE (product_id, tariff_id, grant_target_type, target_ref)

## training_content partial-access (SOT)
`conditions` для `grant_target_type='training_content'`:
- `access_mode: 'full' | 'partial'`
- `allowed_module_ids: uuid[]`
- `allowed_lesson_ids: uuid[]`
- `auto_include_new_modules: boolean`
UI: ProductAccessRulesTab.tsx (tc_* поля), resolver: access-resolver.ts P1-P5.

## Решение для документов
- Новый `grant_target_type = 'document_generation'` (расширение CHECK).
- `target_ref = 'document_generation'` — sentinel-строка домена (НЕ имя/код пакета). Колонка NOT NULL, поэтому NULL не используем.
- `conditions.access_mode: 'full' | 'partial'`
- `conditions.allowed_package_ids: uuid[]` — ТОЛЬКО UUID `document_package_templates.id`.

## Текущие глобальные пакеты
- `06068dcf-...-cfd2` "Идеология" (legacy `code='ideology'` — display only, в новой логике не используется).

## Бэкап-совместимость
Старые правила `grant_target_type='section_access' AND target_ref='document_generation'` = full-access — продолжают работать.
