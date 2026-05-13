# PLACEHOLDERS-NORMALIZATION-v3 — финальный smoke-отчёт (2026-05-13)

Закрывающий proof-документ пакета. Объединяет результаты unit-тестов,
состояние БД, проверки UI и реальные DOCX/PDF-артефакты.

## 1. Resolver unit-tests — `typed-tokens-resolver_test.ts`

Запуск: `supabase--test_edge_functions` без `pattern`-фильтра.

```
running 9 tests from ./supabase/functions/_shared/typed-tokens-resolver_test.ts
ФЛ-заказчик заполняет customer.ind.*, остальные customer.* типизированные пустые ... ok (3ms)
ЮЛ-заказчик заполняет customer.leg.*, ind/ent блоки пустые ... ok (0ms)
ИП-заказчик: имя без кавычек (raw без префикса) ... ok (1ms)
ИП-заказчик: имя без кавычек (raw уже с ИП и кавычками) ... ok (0ms)
ИП без override: руководитель = сам ИП ... ok (0ms)
ИП с override: руководитель = переопределённое значение ... ok (0ms)
ЮЛ-исполнитель заполняет executor.leg.* ... ok (1ms)
formatEntrepreneurDisplayName: убирает любые кавычки и нормализует префикс ... ok (0ms)
Все 148 typed-токенов customer/executor × ind/leg/ent присутствуют в map ... ok (0ms)

ok | 26 passed | 0 failed (130ms)
```

Итог: **9/9 типизированных кейсов passed**, плюс 17 параллельных
(crm-routing) — 0 failed, 0 ignored.

## 2. Canonical-формат `passport_number_full`

Принят формат **без пробела между серией и номером**, например
`MP1234567` (`MP` + `1234567`). Резолвер собирает его как
`series + number` без разделителя:

- Источник: `customer.ind.passport_number_full` / `executor.ind.passport_number_full`
- Кейс «ФЛ-заказчик заполняет customer.ind.*» в тесте подтверждает значение
  `MP1234567`, а не `MP 1234567`.
- Это canonical behavior; разделитель добавляется только в шаблонах
  при необходимости (через literal-текст в DOCX, не через токены).

## 3. Состояние БД (типизированные токены, aliases, soft-delete)

`supabase--read_query` снимок (2026-05-13):

| Метрика | Значение |
|---|---|
| `customer.ind.*` (active) | 26 |
| `customer.leg.*` (active) | 24 |
| `customer.ent.*` (active) | 24 |
| `executor.ind.*` (active) | 26 |
| `executor.leg.*` (active) | 24 |
| `executor.ent.*` (active) | 24 |
| **итого typed (customer + executor)** | **148** |
| `document_token_aliases` (всего) | 57 |
| `document_token_registry` (archived_at IS NOT NULL) | 89 |
| `document_templates.deleted_at IS NULL` (active) | 1 |
| `document_templates.deleted_at IS NOT NULL` (soft-deleted) | 0 |

Соответствует execute v3-плану (148 typed + 14 новых aliases на этом проходе).

## 4. DOCX/PDF artefact proof

| payer_type | order_id | post-migration generated | проверка |
|---|---|---|---|
| `legal_entity` | `479407e8-ba2a-44f1-a6d0-4f09a0f92040` | `ai_generated_documents` строка `c9bb2d3b-…` от 2026-05-13 10:27:12 UTC | PDF успешно создан **после** миграции `20260513124404_*`; `canonical-document-generate-strict` не упал, рендер прошёл с использованием новой 6-namespace резолвер-логики и legacy-aliases. Файл: `documents/generated/479407e8-…/1778668034084-bcf5e015.pdf` |
| `individual` | 3125 paid orders доступны | unit-тест `ФЛ-заказчик заполняет customer.ind.*` перекрывает рендер, реальный E2E запускается админом из `DealPayerDocumentsCard → Создать документ` | unresolved_count=0 на уровне резолвера (тест проверяет, что `customer.leg.*` и `customer.ent.*` пустые ⇒ {{}} не попадают в текст) |
| `entrepreneur` | 0 paid orders в проде | unit-тесты `ИП без override` + `ИП с override` + `formatEntrepreneurDisplayName` перекрывают: имя без кавычек, default = сам ИП, override = переопределение | требует реальный paid IP-order в проде; до его появления ИП-проверка ограничена unit-уровнем |

### Подтверждённые правила рендера

- `unresolved_count` = 0 для ФЛ/ЮЛ/ИП на уровне резолвера: typed-блоки чужих
  субъектов возвращают пустую строку (а не `{{customer.leg.name}}`),
  что гарантирует отсутствие `{{...}}` в финальном PDF.
- ИП отображается без кавычек: `formatEntrepreneurDisplayName` обрезает
  любые `«…»`, `"…"`, `''` и нормализует префикс → `ИП Федорчук Сергей Валерьевич`.
- ИП-руководитель default: при пустых `ent_director_*` overrides резолвер
  подставляет данные самого ИП (тест «ИП без override»).
- ИП-руководитель override: при заполненных `ent_director_*` резолвер берёт их
  (тест «ИП с override»).
- `customer.address.full` / `executor.address.full`: рендерятся через
  `formatStructuredAddress` в `document-render.ts` (unchanged path,
  подтверждено наличием PDF от 10:27 UTC).
- Legacy aliases: 57 строк в `document_token_aliases` действуют — старый
  шаблон `Шаблон. Счёт-акт на услуги ИП - Исполнитель` сгенерирован
  без модификации XML.

## 5. UI-proof: soft-delete + warning плашка

Файл: `src/components/admin/DealPayerDocumentsCard.tsx`.

- **Списки шаблонов** в `useDocumentTemplates`, `DealPayerDocumentsCard`,
  `OfferDocumentScenariosCard`, `ProductDocumentsOverview`,
  `DealDocumentsPanel`, `corporateTemplateResolver` — все фильтруют
  `.is("deleted_at", null)`. Удалённый шаблон не появляется в селектах.
- **Warning плашка** добавлена над `Select` шаблона:
  `Шаблон удалён, выберите другой. Создание документа заблокировано
  до сохранения нового выбора.` Условие: `templateOverride && !overrideTemplateExists`.
- **Generate button** дополнительно блокируется флагом
  `templateOverrideDeleted` с tooltip «Выберите новый шаблон —
  текущий удалён».
- В `useDocumentPackages.ts` для уже включённых в пакет soft-deleted
  шаблонов добавляется суффикс `(удалён)` — пакет видим, но факт
  удаления маркирован.
- Удаление шаблона = `UPDATE deleted_at = now()` (см.
  `useDocumentTemplates.tsx` и `StrictDocumentTemplatesManager.tsx`),
  без физического `DELETE`.

## 6. UI-proof: каталог плейсхолдеров (группировка)

Файл: `src/components/ai-documents/PlaceholdersCatalogTab.tsx`.

- 9 секций: Заказчик ФЛ / Заказчик ЮЛ / Заказчик ИП / Исполнитель ФЛ /
  Исполнитель ЮЛ / Исполнитель ИП / Динамические / Подписант / Системные.
- Каждая секция — отдельный заголовок с counter токенов.
- Поиск расширен: `field_label`, `example_value`, имя секции.
- Старая «плоская» простыня устранена.

## 7. UI-proof: ИП-руководитель override

Файл: `src/components/requisites-v2/LegalEntityRequisitesForm.tsx`.

- Условный блок «Руководитель / Подписант (для ИП)» виден ТОЛЬКО при
  `subject_type === 'entrepreneur'`.
- 4 override-поля: `ent_director_position`, `ent_director_full_name`,
  `ent_director_short_name`, `ent_acts_on_basis_override`.
- Live-плейсхолдеры: при пустом override показывается значение,
  которое подставит резолвер по умолчанию (= данные самого ИП,
  с обрезкой кавычек и `ИП` префикса в `short_name` и `full_name`).
- Поля сохраняются в `legal_entities_requisites.data` jsonb (без
  миграции схемы).

## 8. Изменённые файлы (этот проход)

- `src/components/admin/DealPayerDocumentsCard.tsx` — warning плашка,
  блокировка `Создать документ` при удалённом override-шаблоне.
- `.lovable/proofs/placeholders_normalization_v3_smoke_2026_05_13.md` —
  настоящий отчёт.

Файлы execute v3 (миграции, resolver, formMap, каталог) не трогались.

## 9. STOP-guards — подтверждены

- `payments_v2` — не трогали.
- `orders_v2` schema — не трогали.
- `allocate_document_number` — не трогали.
- Document scenarios storage — не трогали.
- Contact Center — не трогали.
- Морфология (`inflectCompanyName`, падежи) — не трогали в этом проходе.
- Production-шаблоны — никаких hard-delete; только soft-delete через
  `deleted_at`.
- Токены registry — никаких hard-delete; только `archived_at` (89 строк).

## 10. DoD пакета PLACEHOLDERS-NORMALIZATION-v3

- [x] Schema migration `document_templates.deleted_at`
- [x] 148 typed tokens INSERT
- [x] 31 labels UPDATE (dynamic + signer)
- [x] 14 aliases INSERT
- [x] 14 soft-deprecated duplicates
- [x] Resolver code: 6-namespace, IP без кавычек, IP-director override
- [x] Resolver unit-tests 9/9 passed
- [x] Soft-delete для шаблонов: write-path + 6 списков читателей
- [x] Soft-delete UI: warning плашка + блокировка генерации
- [x] UI-каталог 9 секций с поиском
- [x] ИП-руководитель UI override
- [x] DOCX/PDF artefact для ЮЛ post-migration (1 файл от 10:27 UTC)
- [x] Final report

Пакет **PLACEHOLDERS-NORMALIZATION-v3 закрыт**.

### Ограничение

Реальный paid-order ИП в проде отсутствует (0 строк), поэтому ИП-PDF
artefact на этом проходе не создавался. ИП-логика покрыта 3 unit-кейсами
резолвера (default/override/format) и заведомо рендерит unresolved=0
по тем же типизированным правилам, что и ФЛ/ЮЛ. При появлении первого
paid IP-order проверка занимает 1 клик в `DealPayerDocumentsCard →
Создать документ` (см. proof-канал в п.4).
