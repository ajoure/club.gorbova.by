# Stage 5.0 — hotfixes (UI + data)

## 5.0.1 Archive UAT B5 (pf-000002)

Token-driven canonical check:
```sql
SELECT v.template_id, t.name
FROM document_template_versions v
JOIN document_templates t ON t.id = v.template_id
WHERE v.is_current = true AND v.detected_tokens::text ILIKE '%pf-000002%';
-- 0 rows
```
pf-000002 отсутствует во всех `is_current=true` версиях → безусловно orphan
по канону token-driven (assignments игнорируются). Историческое использование:
1 session-level value → не удаляем физически.

Migration: `UPDATE document_package_field_catalog SET is_active=false WHERE id=...`.
Эффект:
- orphan-блок «Идеологии» теряет это поле (caталог фильтрует `is_active=true`);
- session-level row остаётся в БД (audit/history);
- token aliases НЕ трогали (нет связи field_catalog_id → aliases);
- assignment-таблицу НЕ трогали (legacy, не SOT).

## 5.0.2 Document titles + "нет активной версии" badge

Root cause: `DocumentPackageQuestionnairesView.itemsQuery` селектил
`active_version_id` в `document_templates`, но реальная колонка —
`current_version_id`. PostgREST возвращал ошибку «column does not exist»,
из-за чего `tpls=[]`, и оба:
- `template_name` уходил в fallback `"—"`;
- `active_version_id` = `null` → постоянный бейдж «нет активной версии».

Fix: select `id, name, current_version_id`, map в `active_version_id`
(контракт `PackageDocumentCardItem` остаётся стабильным).

DB-проверка:
```
sort_order | template_name                                            | current_version_id
0          | Шаблон - Приказ об организации идеологической работы     | 53fb8ba7-… (8 tokens)
1          | Шаблон - Положение об организации идеологической работы  | a8f81009-… (4 tokens)
```
Имена + версии присутствовали, регрессия была чисто на клиенте.

## 5.0.3 Empty fields у документа #0

После 5.0.2 у обоих документов теперь:
- `active_version_id` ненулевой → save разблокирован;
- `detected_tokens` подтягиваются `usePackageDetectedFields` → секция
  «Поля документа» рендерится;
- если у конкретного шаблона нет pf-токенов — показывается inline empty-state
  «В этом документе нет дополнительных полей», а не пустой блок.

## 5.0.4 Visual redesign PackageDocumentCard

- Единый компонент для обоих пакетов, без ветвлений по UUID/name.
- Вложенные subcards для секций «Поля документа» / «Роли документа»
  с одинаковой геометрией.
- Бейджи в шапке:
  - `X/Y полей` (required-aware ✓);
  - `K/N обязательных ролей` (отдельный required-расчёт по
    `document_package_role_catalog.required`);
  - `+N доп.` для необязательных назначений;
  - постоянный indicator `Сохранено` / `Есть несохранённые изменения`
    (не смешивается со статусом полноты);
  - `Нет активной версии` warning.
- Status accent (левая полоска): `ready` (emerald) / `partial` (amber)
  / `empty` (border).
- Empty/error состояния:
  - нет активной версии → понятный CTA вместо пустой карточки;
  - нет pf-токенов в шаблоне → «В этом документе нет дополнительных полей»;
  - нет активных ролей в пакете → CTA для админа (InlineCreateRoleDialog).
- Required-роли в селекте помечены `(обяз.)`.
- Подсветка строки required-роли (border-primary/30).
- Кнопка сохранения:
  - tooltip-причина disabled (нет версии / нет изменений);
  - full-width на mobile;
  - footer с `safe-area-inset-bottom`.
- Дизайн-токены: `bg-card`, `border-border`, `text-foreground`,
  `text-muted-foreground`, `text-primary`, `bg-primary/[…]`,
  `border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5`.
  Никакого hex/rgb hardcode. Светлая и тёмная темы работают через
  существующие семантические токены.

## Files
- `supabase/migrations/<ts>_archive_pf_000002.sql`
- `src/components/ai-documents/packages/DocumentPackageQuestionnairesView.tsx`
- `src/components/ai-documents/packages/PackageDocumentCard.tsx`

## Status
- 5.0.1 — PASS (миграция применена)
- 5.0.2 — PASS (column fix)
- 5.0.3 — PASS (следствие 5.0.2 + token-driven empty-state)
- 5.0.4 — PASS (code-complete, ожидает runtime parity proof Stage 5)
