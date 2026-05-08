# Backlog: полноценный DOCX-редактор внутри платформы

**Статус:** future sprint, НЕ часть C5-D.

## Цель
Дать админам возможность полноценно редактировать DOCX-шаблоны прямо в платформе:
текст, таблицы, отступы, форматирование, нумерация — без выгрузки в Word и обратно.
Текущий `TemplateMarkupDialog` остаётся только режимом разметки (замена placeholders → FLD).

## Почему текущая mammoth-схема не годится для редактирования
- `mammoth.convertToHtml` — однонаправленный конвертер DOCX → HTML, без обратной операции.
- Стили, нумерация, секции, поля Word, колонтитулы, table layout, рамки — не сохраняются в HTML.
- `contentEditable` поверх mammoth-HTML не может корректно записать изменения обратно в OOXML.
- Любое сохранение «отредактированного HTML как DOCX» через docx-js приведёт к потере исходного форматирования.

Поэтому для разметки FLD-полей нужен один UX (текущий C5-D), а для полноценного редактирования —
отдельный встроенный office-редактор.

## Кандидаты
| Решение | Лицензия | Self-host | DOCX fidelity | Интеграция |
|---|---|---|---|---|
| OnlyOffice Document Server | community AGPL / commercial | yes (Docker) | очень высокая | iframe + JWT + callback |
| Collabora Online (LibreOffice) | MPL/AGPL | yes | высокая (LO-движок) | iframe + WOPI |
| Microsoft Office for the web | commercial | no | эталонная | требует Microsoft 365 |
| TinyMCE / CKEditor + DOCX import-export plugin | commercial | partial | низкая для сложных DOCX | UX похож на Word, но fidelity слабый |

Рекомендация: **OnlyOffice Document Server (self-hosted, community)**.

## Архитектура (черновая)
1. DOCX-шаблон лежит в Supabase Storage (уже так).
2. Edge function `template-editor-session` выдаёт временный signed URL + JWT для OnlyOffice.
3. Iframe OnlyOffice загружает DOCX по signed URL.
4. По save OnlyOffice вызывает callback edge function `template-editor-callback` → скачивает обновлённый DOCX → создаёт новую `document_template_versions` через тот же canonical write-path, что и при upload.
5. Внутри OnlyOffice — кастомный плагин «Вставить FLD-поле» (через JS API), который вставляет `{{field:FLD-…}}` прямо в OOXML run.

## Объём работ (примерно)
- DevOps: развернуть OnlyOffice DS, JWT secret, healthcheck.
- Backend: 2 edge functions (session/callback), миграции для editor_sessions.
- Frontend: новый `TemplateEditorDialog` (отдельно от `TemplateMarkupDialog`), маршрут, фича-флаг.
- Плагин OnlyOffice для FLD-полей (отдельная JS-сборка).
- QA: проверка fidelity на 5+ реальных шаблонах (счёт-акт, договор, акт, доверенность, инвойс).

## Зависимости
- Не блокирует C5-D (текущий режим разметки).
- Требует решения по хостингу (OnlyOffice Docker → стоимость инфраструктуры).
- Требует ревизии `canonical-template-apply-markup`: возможно, разметка сохраняется уже внутри редактора, а не отдельным шагом.

## Acceptance (когда возьмём в работу)
- Админ открывает шаблон → видит DOCX как в Word, может редактировать любой контент.
- Может вставить FLD-поле через плагин редактора.
- Сохранение создаёт новую `document_template_versions` с валидным DOCX.
- Никакой потери форматирования относительно исходника.
- Маркап и редактирование живут в одном окне.
