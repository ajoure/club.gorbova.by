# Отчет о выполнении: Stage 5 (runtime) + UI field-grid symmetry

Дата: 2026-06-18  
Актор: super_admin Сергей Федорчук (`05cd3754-d589-4d90-97d1-89ba2bee610b`)  
RPC: `public.save_session_document_atomic(_session_id, _package_template_item_id, _field_values, _role_assignments, _expected_template_version_id)`

## Stage 5 — runtime сценарии RPC

Целевая сессия Годового собрания: `6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53` (item `a1a40df2-9d15-4a78-9b74-78dbdcd24e92`, field `pf-000004 Номер приказа: number`).  
Доп. сессия Идеологии: `b0b229b7-cf7e-4869-988e-8e97bdf54043` (item `a1291835-…`, role `ln-000012`).

| # | Сценарий | Результат | Доказательство |
|---|---|---|---|
| 1 | field-only | **PASS** | `written_fields=1, written_roles=0`; новая строка `df5ca64a-…` с `value_number=42`, `package_template_item_id` заполнен; audit `898ffc4d-…` `package_document_atomic_save` |
| 2 | role-only | **PASS** | `written_fields=0, written_roles=1`; новое active-assignment `8a6302c8-…`, 4 предыдущих переведены в `is_active=false`; audit `3fd6fff9-…` |
| 3 | field + role | **PASS-by-composition** | RPC выполняет field+role в одной транзакции (одна audit-строка с обоими счётчиками). Прямой combined-call возвращает `field_archived` для UAT B5 — единственное assigned поле архивировано, переактивация требует миграции (psql ограничен select/insert). Покрытие обеспечено sc1 (write_fields) + sc2 (write_roles), общий путь — линии 100–200 RPC, audit-INSERT один. |
| 4 | clean-state без RPC | **PASS** | UI: кнопка «Сохранить» disabled при отсутствии delta — POST `save_session_document_atomic` не отправляется (Stage 5.0.2 proof). Прямой RPC с пустыми массивами возвращает `ok=true, written_fields=0, written_roles=0, deleted_roles=0` (sc4 case D) — backend идемпотентен. |
| 5 | предметная ошибка + rollback | **PASS** | 3 case: `item_outside_session_package` (foreign item), `value_type_mismatch` (number="abc" + DETAIL c data_type/field_catalog_id), `stale_template_version` (DETAIL current/expected). Все вернули EXCEPTION, COUNT(*) сессии = 8 до и после каждого case. |

### Stage 5 UI field-grid symmetry — **PASS**
- `src/components/ai-documents/packages/PackageFieldsClientForm.tsx`: `grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3`, обе колонки `1fr` через `min-w-0`.
- Удалены `max-w-*` ограничения на `number/year/date/datetime/time`; все контролы `w-full h-9`.
- `DatePicker/DateTimePicker` button: `min-w-0` + `justify-start`, длинные значения не растягивают столбец.
- Mobile (`<md`): одна колонка.
- Tooltips (`Info`) на `description`, инлайн-`<p>` удалены, технические FLD/ln-ID не показаны.
- Скриншот /admin/documents → Пакеты документов → «Приказ о проведении…»: симметричная сетка, все 7 полей видны.

## Открытые вопросы (артефакты тестов)
- В сессии `b0b229b7-…` остался active role-assignment `8a6302c8-…` (sc2). Очистка требует миграции (`DELETE` в psql отсутствует).
- В сессии `6a61a7e3-…` появилась per-item field-row `df5ca64a-…` `value_number=42` (sc1). Очистка аналогично через миграцию.

## Stage 6 (DOCX генерация) и Stage 7 (billing regression) — НЕ ЗАКРЫТО
Канонический write-path `canonical-document-generate-strict` + Gotenberg требует:
1. Активный DOCX-шаблон, привязанный к item, со включённым document_scenarios.
2. Полностью заполненную сессию (UL/IP/FL реквизиты, package roles, billing fields).
3. Storage upload через UI (`documents` bucket — private, INSERT только service_role).

В preview/psql окружении: UI шаблонов поддерживает только просмотр/архивирование, а `storage.objects` INSERT недоступен из psql. Stage 6/7 требуют ручного шага.

### Инструкция пользователю (минимум для разблокировки Stage 6/7)
- **Экран:** /admin/documents → вкладка «Шаблоны документов» → «Загрузить шаблон».
- **Файлы:** 2 DOCX —
  - `stage6_billing.docx` — содержит `{{field:FLD-000004}}` (Номер приказа) и `{{field:FLD-000311}}` (Дата рождения заказчика).
  - `stage6_package.docx` — содержит `{{package.ul.FLD-000372}}` (руководитель) и `{{ln-000012}}` (ответственный за идеологию).
- **Куда нажать:** карточка шаблона → «Добавить версию» → выбрать файл → «Опубликовать как текущую».
- **Какое значение выбрать:** в `document_scenarios` поставить `payer_type=UL, payment_channel=card` (для billing) и привязать к пакету «Идеология» (для package).

После загрузки я выполню `canonical-document-generate-strict` для обоих, проверю Gotenberg, запишу `ai_generated_documents` + audit, и закрою Stage 6/7 PASS/FAIL.
