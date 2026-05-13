## План: реквизиты, плейсхолдеры, шаблоны документов

Работа разбита на 4 пункта по запросу пользователя.

---

### 1. Типы плательщика: добавить ИП как отдельную сущность

**Проблема:** в карточке сделки и в селекторе «Тип плательщика» сейчас только два значения — `individual` (Физлицо) и `legal_entity` (Юрлицо). ИП (`entrepreneur`) подписывает как ФЛ, хотя у нас уже есть отдельная форма реквизитов ИП (`EntrepreneurDetailsForm`, поля `ent_*`) и demo-набор `DEMO_ENTREPRENEUR`. Резолвер сценариев документа (`resolveDocumentScenario.ts`) знает только `'individual' | 'legal_entity'`.

**Действия:**
- Расширить `PayerType` → `'individual' | 'entrepreneur' | 'legal_entity'`.
- Добавить `entrepreneur` в:
  - селектор `DealPayerDocumentsCard.tsx` (новый `SelectItem` «ИП»),
  - группировку карточек реквизитов в picker (отдельная секция «ИП»),
  - `LegalDetailsPickerDialog.tsx` (label `entrepreneur: "ИП"`),
  - `resolveDocumentScenario.ts` (matching по `entrepreneur`),
  - `orders_v2.payer_type` миграция: добавить значение в check/enum (если есть).
- Документ-сценарии (`tariff_offers.meta.document_scenarios[]`): ничего ломать не нужно — формат уже массив, добавим возможность `payer_type='entrepreneur'`. Если сценария для ИП нет — fallback на `individual` (через priority в резолвере).
- В админке «Реквизиты сделки» при выборе типа «ИП» подгружаем карточку из `legal_details` со scope ИП (по `org_form='entrepreneur'` или флагу `is_entrepreneur`).

---

### 2. Нормализация полей реквизитов и плейсхолдеров (FLD-каталог)

**Проблема:** в `fields_registry` бардак — есть дубли и неоднозначные названия:
- `customer.director` / `customer.director_short` / `customer.director_full_name` / `customer.director_position` / `customer.basis` / `customer.acts_on_basis` — дублирующие пары.
- Нет явного указания «ФЛ» / «ЮЛ» / «ИП» в label у части полей.
- Краткое и полное наименование ИП/ЮЛ не имеют разведения вида «ИП Иванов И.И.» vs «Индивидуальный предприниматель Иванов Иван Иванович».
- Отсутствует поле «организационно-правовая форма» (ООО, ЗАО, УП).

**Каноническая схема label** (для `executor` и `customer`):
```
{Сторона} {ФЛ|ЮЛ|ИП}: {суть поля}
```
Примеры:
- `Заказчик ФЛ: ФИО полностью` (Иванов Иван Иванович)
- `Заказчик ФЛ: ФИО кратко` (Иванов И.И.)
- `Заказчик ФЛ: фамилия`, `…имя`, `…отчество`
- `Заказчик ЮЛ: наименование полное` (ООО «Альфа Консалтинг»)
- `Заказчик ЮЛ: наименование краткое` (ООО «Альфа»)
- `Заказчик ЮЛ: организационно-правовая форма` (ООО)
- `Заказчик ЮЛ: директор ФИО полностью`
- `Заказчик ЮЛ: директор ФИО кратко`
- `Заказчик ЮЛ: должность руководителя`
- `Заказчик ИП: наименование полное` (Индивидуальный предприниматель Иванов Иван Иванович)
- `Заказчик ИП: наименование краткое` (ИП Иванов И.И.)
- `Заказчик ИП: ФИО полностью`, `…ФИО кратко`
- Общие (для ЮЛ/ИП): `…УНП`, `…юридический адрес`, `…банк`, `…БИК`, `…счёт`, `…действует на основании`.

**Действия:**
- Миграция: переименовать существующие `label` к канону, добавить недостающие поля (`org_form`, `name_full`, `name_short`, `director_full_name`, `director_short_name`, дубликаты пометить `archived_at` с маппингом на канонический ключ).
- Аналогично для `entity_type='executor'`.
- Добавить ИП-вариант полей (`customer.entrepreneur.*`, `executor.entrepreneur.*`).
- В resolver снапшота (`document-field-resolver-v2-snapshot`) — маппинг новых полей из `legal_details`.

---

### 3. Шаблоны: удаление и кеш

**Проблема:** при удалении шаблона и загрузке нового с тем же названием — `Создать документ` всё равно генерирует по старому. Источник: вероятно
- кеш `current_version_id` в `document_templates` не обновляется при удалении/перезаливе,
- либо `template_path` (storage) не перезаписывается, и edge `ai-generate-document` берёт DOCX по старому пути,
- либо в `orders_v2.meta.document_data` снапшотится старый `template_id`.

**Действия:**
- Аудит таблицы `document_templates`: нет колонки `deleted_at`. Удаление сейчас — только hard-delete или флаг `is_active=false`. Добавить `deleted_at TIMESTAMPTZ`.
- В `ai-generate-document/index.ts` (и `canonical-document-generate*`) добавить guard:
  - `template.deleted_at IS NULL`,
  - `template.is_active = true`,
  - чтение DOCX строго по `current_version_id` → `document_template_versions.storage_path`, не по «имени».
- В UI `useDocumentTemplates` инвалидировать react-query кеш `['document-templates']` при upload/delete.
- При создании документа в `DealPayerDocumentsCard`/`DealDocumentsPanel`:
  - не сохранять `template_id` в `orders_v2.meta.document_data` намертво — резолвить актуальный шаблон в момент генерации,
  - если в snapshot записан несуществующий/удалённый `template_id` — fallback на актуальный по `(document_type, payer_type, payment_channel)` + лог в `audit_logs`.
- Версионирование: каждый upload → новая запись в `document_template_versions`, `current_version_id` обновляется атомарно. Старые версии помечаем `superseded_at`.

---

### 4. Превью-колонка в каталоге плейсхолдеров

**Проблема:** в `/admin/ai` (вкладка «Плейсхолдеры») трудно понять, что подставится в документ.

**Действия:**
- В таблицу `Плейсхолдеры для Word` (`AdminProductsDocs.tsx` / соответствующий компонент) добавить колонку **«Пример»** между «Настройки» и «Плейсхолдер».
- Источник примеров — расширить `templateEditorTestData.ts`: `EDITOR_TEST_DATA_BY_FIELD_ID` (Record<FLD-ID, string>). Покрыть все 120 полей реалистичными значениями (Иванов Иван Иванович, ООО «Альфа», 192345678 и т.д.).
- На UI значение рендерим в `<code>` с tooltip «Пример отображения».
- Бонус: при наведении на ячейку «Плейсхолдер» — popover с примером в составе мини-предложения («…действует на основании Устава…»).

---

### Технические детали (для разработчика)

| Слой | Файлы |
|---|---|
| Типы | `src/utils/resolveDocumentScenario.ts`, `src/components/admin/DealPayerDocumentsCard.tsx`, `src/components/ai-documents/LegalDetailsPickerDialog.tsx` |
| Реквизиты ИП | `src/components/legal-details/EntrepreneurDetailsForm.tsx` (уже есть), `src/constants/demoLegalDetails.ts` |
| Каталог полей | миграция `fields_registry`: rename labels, add ИП-секция, archive дубликаты |
| Шаблоны | миграция `document_templates ADD COLUMN deleted_at`, `supabase/functions/ai-generate-document/index.ts`, `canonical-document-generate*`, `src/hooks/useDocumentTemplates.tsx` |
| UI плейсхолдеров | страница каталога (`AdminProductsDocs.tsx` или `/admin/ai` placeholders tab) + `templateEditorTestData.ts` (расширить до Record<field_id, string>) |
| Резолвер снапшота | `supabase/functions/document-field-resolver-v2-snapshot` — маппинг новых полей |

### Порядок выполнения (Diagnose → Plan → Dry run → Execute → Verify)

1. **Dry run каталога полей** — выгрузить текущие 120 FLD, составить маппинг old→new (CSV в `.lovable/proofs/fields_registry_normalize_2026_05_13.md`), показать пользователю до миграции.
2. Миграция `fields_registry` (rename + add + archive дубликатов).
3. Расширение `PayerType` (типы + UI + резолвер).
4. Шаблоны: `deleted_at` + guard в edge + инвалидация кеша + fallback в snapshot.
5. Превью-колонка + расширение test-data.
6. Verify: создать тест-сделку с ИП, прогнать генерацию документа на новом шаблоне, проверить что удалённый шаблон не используется.

### DoD

- В селекторе «Тип плательщика» три значения: ФЛ / ИП / ЮЛ.
- Все плейсхолдеры в каталоге имеют формат `{Сторона} {ФЛ|ЮЛ|ИП}: {суть}`, без дублей.
- Поле «организационно-правовая форма» добавлено для ЮЛ.
- Удалённый/перезалитый шаблон больше не используется при «Создать документ».
- В каталоге плейсхолдеров есть колонка «Пример» с реалистичным значением для каждого FLD.
- Proof-файлы: маппинг полей, лог удаления шаблона, скриншот новой колонки.

### Открытые вопросы (нужно подтверждение перед стартом)

1. **Старые шаблоны и сделки**: переименование labels поломает уже привязанные плейсхолдеры в DOCX? Канонический формат токена — `{{field:FLD-XXXXXX}}` (по ID, не по label) — переименование label безопасно. Подтверждаешь?
2. **Архивация дубликатов** (`customer.director` vs `customer.director_full_name`): сливаем в один канонический ключ или оставляем оба и просто чистим labels? Предлагаю слить с redirect на канонический FLD-ID.
3. **Удаление шаблона**: переходим на soft-delete (`deleted_at`) — старые сделки с этим `template_id` будут показывать «Шаблон удалён, выберите новый», или автоматически подставлять актуальный по сценарию? Предлагаю **автофолбэк** + бейдж «Шаблон обновлён».
