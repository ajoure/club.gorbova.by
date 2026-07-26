# Discovery: карта системы перед добавлением сущности «Компания»

Дата: 2026-07-23. Автор: инженерный агент. Режим: read-only.

## 0. TL;DR

Сущность «Компания» **уже реализована в БД и частично в UI**. Отдельно создавать таблицы `companies` / `company_contacts` / поле `orders_v2.company_id` **не нужно** — они существуют и покрыты RLS, RPC и триггерами. Спринт сводится к:

1. UI-надстройке: `CompanyDetailSheet`, вкладка «Компании» в `ContactDetailSheet`, поле «Компания» в `DealDetailSheet`, пункт в сайдбаре.
2. Достройке автопривязки: `client_legal_details` → `companies` уже есть RPC `crm_company_upsert_from_billing` + backfill, но **DB-триггера INSERT/UPDATE на `client_legal_details` нет** — привязка идёт через явные RPC (см. §5).
3. Достройке связи «сделка ↔ компания»: `orders_v2.company_id` заполнен для 388/4275 заказов; таблица `company_order_links` существует, но **пуста (0 строк)** — не используется. Нужно решение: остаться на `orders_v2.company_id` или начать писать в `company_order_links`.

Продукт «Сделки» в системе — это `orders_v2` + `crm_pipelines` / `crm_pipeline_stages` / `crm_pipeline_product_bindings`. Отдельной таблицы `crm_deals` **нет** (её упоминание в задаче — устаревший термин).

## 1. Существующие таблицы (public)

Все с RLS enabled.

### 1.1 companies (6151 строк)
Ключевые колонки: `id`, `public_id`, `workspace_id`, `company_kind`, `country`, `unp_normalized`, `full_name`, `short_name`, `legal_form`, `legal_address` (+ `legal_address_structured` jsonb), `email`, `phone`, `director_name`, `director_position`, `acts_on_basis`, `bank_account`, `bank_name`, `bank_code`, `status`, `merged_into_company_id`, `archived_at`, `grp_*` (снимок из ЕГР), `metadata` jsonb, стандартные `created_at/updated_at/created_by/updated_by`.

Политики: `companies_read_rbac / insert_rbac / update_rbac / delete_rbac`.

### 1.2 company_contacts (19 строк) — M2M компания↔профиль
`id, company_id, profile_id, external_full_name, external_email, external_phone, relationship_type, is_billing_contact, is_primary, source, source_client_legal_details_map_id, metadata, …`.
Политики `*_rbac` на все CRUD.

### 1.3 company_order_links (0 строк) — M2M компания↔заказ
`id, workspace_id, company_id, order_id, relationship_role, source, source_client_legal_details_id, metadata, unlinked_at, unlinked_by, unlink_reason, …`.
Policy: только SELECT для CRM staff. Таблица подготовлена, но writer'ы её не наполняют.

### 1.4 client_legal_details_company_map (19 строк)
`id, client_legal_details_id, company_id, linked_at, linked_by, metadata, …`. Полный RBAC.

### 1.5 Вспомогательные (все с RLS)
- `company_external_ids` — интеграционные ID (amoCRM/1C/…).
- `company_sync_queue` (service-only ALL) — очередь фоновой синхронизации.
- `company_contact_persons` / `company_contact_person_links` — контактные лица без profile_id.
- `company_files`, `company_notes`, `company_relationships`.
- `company_import_batches`, `company_import_ledger` — импорт из Google Sheets.

### 1.6 orders_v2 (4275 строк, 388 c company_id)
Уже есть `company_id uuid` (nullable). Также `payer_type` и связь на `profile_id`. Отдельная таблица `crm_deals` **не существует** — «сделка» = запись в `orders_v2`, стадия воронки хранится в `pipeline_id` / `pipeline_stage_id` (см. `crm_pipelines`, `crm_pipeline_stages`, `crm_pipeline_product_bindings`).

### 1.7 client_legal_details (50 строк)
Ключевые поля для юрлица: `leg_name`, `leg_unp`, `leg_address` (+ structured), `leg_org_form`, `leg_director_*`, `leg_acts_on_basis`, `bank_account/name/code`, `grp_*` (снимок ЕГР), `phone`, `email`, `status`, `purpose`, `validation_*`. `profile_id` — обязательный, `client_type ∈ {individual, ent, legal}`.

## 2. RPC / функции (public.crm_company_*)

Готовый набор: `crm_company_get_or_create`, `crm_company_create_from_billing`, `crm_company_upsert_from_billing`, `crm_company_update`, `crm_company_archive`, `crm_company_restore`, `crm_company_merge`, `crm_company_link_contact`, `crm_company_link_order`, `crm_company_unlink_order`, `crm_company_relationship_upsert / list`, `crm_company_contact_person_upsert / link / list`, `crm_company_external_id_upsert / list`, `crm_company_external_reconcile_preview`, `crm_company_grp_refetch`, `crm_company_sheet_import_batch_start / apply`, `crm_company_sync_worker_claim / complete`, `crm_company_sync_admin_retry / dismiss`, `crm_company_sync_enqueue`, `crm_company_sync_health`, `crm_company_backfill_billing_cld`, `crm_company_quality_summary`, `crm_company_invariants_report`, `search_companies`, `company_feed_list`, `company_note_create/delete`, `resolve_generated_document_company`, `crm_order_resolve_company`.

Триггерные хелперы: `_crm_company_emit_domain_event`, `_crm_company_order_activity`, `_crm_company_resolve_or_create_internal`, `crm_companies_normalize_phone_tg`, `crm_normalize_company_phone`, `crm_company_relationship_guard`, `crm_company_parse_callback_at`, `set_companies_public_id`.

Вывод: логика создания/обновления/поиска/слияния/связей полностью покрыта — UI должен вызывать существующие RPC и **не писать напрямую** в таблицы.

## 3. Существующий UI

- Роут `/admin/companies` → `src/pages/admin/AdminCompanies.tsx` (2084 строки). Уже подключён в `src/App.tsx:293` и в маппинге заголовков сайдбара `AdminLayout.tsx:26`. **Пункта в самом меню сайдбара — нет** (только title/permission mapping); нужен видимый item «Компании» между «Контакты» и «Сделки» (проверить блок с элементами меню — не найдено в первом экране, добавить).
- `src/components/admin/CompanySheetImportDialog.tsx` — импорт из Google Sheets (готов).
- `src/components/admin/CompanySyncQueuePanel.tsx` — панель admin-мониторинга очереди синхронизации (готова).
- `CompanyDetailSheet` / карточка компании (Sheet/Drawer) — **отсутствует**. `ContactDetailSheet` не имеет вкладки «Компании». `DealDetailSheet` не имеет поля «Компания».

## 4. Reusable компоненты

- `ContactDetailSheet` (`src/components/admin/ContactDetailSheet.tsx`) — паттерн для нового `CompanyDetailSheet` (вкладки: Профиль, Реквизиты, Контакты, Сделки, Лента, Задачи, Документы).
- `DealDetailSheet` (`src/components/admin/DealDetailSheet.tsx`) — точка добавления поля «Компания».
- `ClickableContactName` — аналог для «ClickableCompanyName» (клик → открыть sheet поверх текущего).
- `CrmTasksSection`, `ContactFeedTab`, `DealDocumentsCard`, `ContactPaymentsTab` — переиспользовать, передавая `entity_type='company'`.

## 5. Автопривязка ЛК → Company: текущее состояние

- **DB-триггера INSERT/UPDATE на `client_legal_details` нет.** Проверено через `information_schema.triggers` — ни одного триггера на этой таблице.
- Есть RPC `crm_company_upsert_from_billing(client_legal_details_id)` и backfill `crm_company_backfill_billing_cld` — они выполняют upsert по UNP и создают запись в `client_legal_details_company_map`.
- В текущем flow эти RPC вызываются:
  - из фронта ЛК/админки при сохранении реквизитов (нужно валидировать в PR по интеграции),
  - из backfill/sheet-import,
  - НЕ вызываются автоматически из БД.
- `orders_v2.company_id` заполнен для 388 заказов — очевидно ручным/бэкграундным `crm_order_resolve_company`. `company_order_links` при этом пуст → второй канал не активирован.

**Решение для спринта**: не создавать новый триггер вслепую — сначала подтвердить, что все места записи `client_legal_details` (RPC/edge functions/фронт) вызывают `crm_company_upsert_from_billing`. Если да — оставить как есть; если нет — добавить AFTER INSERT OR UPDATE OF `leg_unp, leg_name, …` триггер, вызывающий `crm_company_upsert_from_billing(NEW.id)` внутри `SECURITY DEFINER` (риск: RLS/`workspace_id`, `created_by`; см. §7).

## 6. Пробелы к закрытию в спринте

1. **UI: `CompanyDetailSheet`** (карточка компании как Sheet поверх). Использует RPC `crm_company_*` + `company_feed_list` + `company_notes` + `crm_company_contact_persons_list` + звонки/SMS/email существующими секциями.
2. **UI: пункт «Компании» в сайдбаре** между «Контакты» и «Сделки». Роут и permission уже настроены.
3. **UI: вкладка «Компании» в `ContactDetailSheet`** — список из `company_contacts` по `profile_id`, кнопка «Привязать к компании» (поиск через `search_companies` RPC по названию/УНП, привязка через `crm_company_link_contact`).
4. **UI: поле «Компания» в `DealDetailSheet`** — чтение `orders_v2.company_id`, поиск через `search_companies`, установка/снятие через `crm_company_link_order` / `crm_company_unlink_order`. Клик по названию открывает `CompanyDetailSheet` поверх.
5. **Автопривязка ЛК → Company при создании сделки ЮЛ**: подтвердить, что `invoice-checkout-issue` (edge function) и создание сделки с `payer_type=legal_entity` вызывают `crm_order_resolve_company`/`crm_company_link_order`. Если нет — вызвать в конце flow, идемпотентно.
6. **Опционально**: включить запись в `company_order_links` параллельно `orders_v2.company_id` (двойная запись до депрекации `company_id`), либо явно оставить `orders_v2.company_id` как источник истины и не трогать `company_order_links`. **Рекомендация**: оставить `orders_v2.company_id` источником истины (уже 388 строк, RLS, все writer'ы знают о нём), `company_order_links` использовать только для M2M-ролей (плательщик/получатель), если продуктовый кейс появится.

## 7. Риски

- **workspace_id / RBAC**: `companies`, `company_order_links` имеют `workspace_id` — новые вставки должны его заполнять корректно, иначе `*_rbac` policy отфильтрует.
- **RLS на `client_legal_details`**: любой новый триггер, upsert'ящий `companies`, должен быть `SECURITY DEFINER` с явным `search_path=public`, иначе fail из-за политик на companies.
- **Дублирование по UNP**: `companies.unp_normalized` — ключ для upsert; при пустом `leg_unp` (ИП без УНП, физлицо) upsert должен не выполняться, иначе получим фантомные пустые компании (сейчас 6151 запись — возможно, среди них уже есть шум, проверить `crm_company_quality_summary`).
- **CRM-роутинг сделок**: не должен ломаться от появления/непоявления `company_id` — сейчас 3887/4275 заказов без `company_id` работают нормально. Правило pipeline routing использует `product_id/tariff_id`, не `company_id`.
- **UI-подрыв**: `AdminCompanies.tsx` (2084 строки) уже существует — новый пункт меню откроет реальный, но, возможно, тяжёлый экран. Проверить его текущее состояние отдельно перед релизом.
- **`crm_deals` не существует** — задачи, упоминающие `crm_deals`, интерпретировать как `orders_v2` + `crm_pipelines*`.

## 8. Итоговое действие для последующих задач спринта

- Задачу «Схема БД и backend сущности Компания» (307db7ab) — **урезать**: не создавать `companies` / `company_contacts` / `orders_v2.company_id` (уже есть). Скоуп сводится к:
  - опциональному триггеру `AFTER INSERT OR UPDATE` на `client_legal_details` → `crm_company_upsert_from_billing`, если аудит покажет пропуски;
  - проверке заполнения `workspace_id` в новых вставках через UI-RPC.
- Задачи 128f5da9, 91bb7937, 4886fffb — **чисто UI + подключение существующих RPC**, миграции не требуются (или минимальные).

## 9. Что было проверено (read-only)

- `information_schema.tables/columns` — все companies-таблицы и их колонки.
- `pg_policies` + `pg_tables.rowsecurity` — RLS/policies перечислены.
- `information_schema.triggers` — триггеров на `client_legal_details` / `companies` / `orders_v2` для company-логики **не найдено** (только эмиссия domain events).
- `pg_proc` — 40+ `crm_company_*` функций.
- Счётчики: `companies=6151`, `company_contacts=19`, `company_order_links=0`, `client_legal_details_company_map=19`, `client_legal_details=50`, `orders_v2=4275` (388 с `company_id`).
- Фронт: `src/App.tsx` (роут), `src/components/layout/AdminLayout.tsx` (title/permission), `src/pages/admin/AdminCompanies.tsx` (существует, 2084 строки), `CompanySheetImportDialog`, `CompanySyncQueuePanel`. `CompanyDetailSheet` — отсутствует.

Данные и код не изменялись.
