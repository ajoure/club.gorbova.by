# Placeholders Catalog — section hints + universal-fields help

Дата: 2026-05-13
Scope: UI-only. Изменён один файл: `src/components/ai-documents/PlaceholdersCatalogTab.tsx`.

## Что сделано

1. Добавлен словарь `SECTION_COPY` (hint + опциональные helpTitle/helpBullets) рядом с `SECTION_DEFINITIONS`. Структура группировки и счётчики не изменены.
2. Заголовок каждой секции в таблице теперь двухстрочный:
   - строка 1 — название секции + счётчик + (если задан helpBullets) иконка `HelpCircle` с Popover-подсказкой;
   - строка 2 — короткий `hint` серым, normal-case, без uppercase.
3. Верхний инструктивный баннер переписан: теперь объясняет, что секции = разные источники данных, и зачем нужны универсальные поля.
4. Popover-подсказки добавлены для секций: 1–6 (типизированные группы Заказчик/Исполнитель ФЛ/ЮЛ/ИП), 7 (универсальные поля) и 12 (технические/override).

## Что НЕ менялось

- `document_token_registry`, `fields_registry`, `document_token_aliases` — без изменений.
- Резолверы (`_shared/document-render.ts`, `canonical-template-validate`, `canonical-document-generate-strict`) — без изменений.
- `SECTION_DEFINITIONS.categories`, `CATEGORY_TO_SECTION`, фильтры, счётчики, формат плейсхолдеров и runtime-бейджи — без изменений.

## DoD

- [x] Каждая секция показывает hint серым.
- [x] У секций 1–7 и 12 рядом с заголовком — кликабельная иконка `?` с Popover.
- [x] Sticky-заголовок таблицы и счётчики работают как раньше.
- [x] Фильтры по секциям 1–6 продолжают показывать runtime-токены (visibility-fix v4 не затронут).
- [x] Поиск по `customer.address` и русскому label работает (поисковая логика не менялась).
