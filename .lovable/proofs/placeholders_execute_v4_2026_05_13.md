# Execute v4 — Placeholder Catalog UI fix (PLACEHOLDERS-NORMALIZATION-v4)

Дата: 2026-05-13
Scope: только UI каталога. БД / registry / resolvers / шаблоны / морфология не трогаются.

## Что изменено

Файл: `src/components/ai-documents/PlaceholdersCatalogTab.tsx`

### 1. Снят FLD-only фильтр (строки 174–192)

Было:
```ts
if (!r.field_id || !publicId) { skipped += 1; continue; }
```
Стало: runtime-токены (без `field_id`, с `resolver_key`) попадают в каталог.
Счётчик `skippedNoField` заменён на информационный `runtimeCount` (синий
бейдж «runtime-токенов: N», не ошибка).

### 2. Runtime-плейсхолдер
Для строк без `field_public_id` плейсхолдер собирается как
`{{<token_key>}}` (совместимо с `_shared/document-render.ts`).
Для FLD-токенов формат не изменился — по-прежнему через
`buildFieldPlaceholder()` с поддержкой `|format=` и `|case=`.

### 3. Колонка FLD-ID
- FLD-токен → бейдж `FLD-XXXXXX` (как раньше).
- Runtime-токен → бейдж `runtime` с тултипом, где показан `token_key`.

### 4. Колонка «Настройки»
- Runtime-токен → «runtime — без модификаторов» (резолвер не поддерживает
  per-row format/case).
- FLD-токен → обычные модификаторы.

### 5. Новая структура секций (было 9 → стало 12)

| # | Секция | category(-ies) |
|---|--------|----------------|
| 1 | Заказчик ФЛ | customer.individual |
| 2 | Заказчик ЮЛ | customer.legal |
| 3 | Заказчик ИП | customer.entrepreneur |
| 4 | Исполнитель ФЛ | executor.individual |
| 5 | Исполнитель ЮЛ | executor.legal |
| 6 | Исполнитель ИП | executor.entrepreneur |
| 7 | Универсальные поля (по типу плательщика) | customer, executor |
| 8 | Документ | document |
| 9 | Сделка | deal |
| 10 | Оплата | payment |
| 11 | Системные поля | system |
| 12 | Технические / override | customer.signer, executor.signer, contact, product, tariff, offer, legal_details |

Section 9 «Системные / Документ / Сделка / Оплата» удалена как объединение
и разнесена на 4 отдельных секции.

Подписант (`customer.signer`, `executor.signer`) перенесён из обычного
каталога в «Технические / override» — у этих токенов нет UI-источника
заполнения в `/settings/legal-details`. В label префикс группы «Подписант
(override)» делает override-семантику явной.

## Counts по секциям (после фикса)

Из read-only запроса по `document_token_registry` (archived_at IS NULL):

| Секция | tokens |
|--------|-------:|
| Заказчик ФЛ | 26 |
| Заказчик ЮЛ | 24 |
| Заказчик ИП | 24 |
| Исполнитель ФЛ | 26 |
| Исполнитель ЮЛ | 24 |
| Исполнитель ИП | 24 |
| Универсальные поля | 12 + 11 = 23 |
| Документ | 2 |
| Сделка | 38 |
| Оплата | 12 |
| Системные | 6 |
| Технические / override | 4 + 4 + 6 + 4 + 6 + 7 + 0 = 31 |

Все 6 типизированных групп — **непустые** (24–26 токенов каждая).
Runtime-токенов без `field_id`: **154** (148 customer/executor typed
+ 6 в customer/executor динам.) — теперь видимы, не помечены как «скрыто».

## Что НЕ менялось

- БД: ни одной миграции. `document_token_registry`, `fields_registry`,
  `document_token_aliases`, `document_templates_v2` — без изменений.
- Edge functions: ни одной правки. `_shared/document-render.ts`,
  `canonical-template-validate`, `canonical-document-generate-strict`,
  `canonical-template-apply-markup` — без изменений.
- Whitelist формата `{{field:FLD-XXXXXX...}}` для FLD-токенов не тронут.
- `payments_v2`, `orders_v2`, `allocate_document_number`, document
  scenarios, морфология — не трогались.
- Новых токенов не создано, существующие не архивировались.
- Soft-delete шаблонов (`document_templates.deleted_at`) — отложен
  отдельным безопасным блоком, в Execute v4 не включён (как и оговорено
  пунктом 7 заказа).

## DoD

- [x] Все 6 типизированных групп отображают токены (24–26 каждая).
- [x] Системные / Документ / Сделка / Оплата разделены на 4 секции.
- [x] Подписант перенесён в «Технические / override», префикс «(override)»
      добавлен в badge-label.
- [x] «скрыто без field_id: 154» убрано; заменено на нейтральный счётчик
      «runtime-токенов: 154».
- [x] Поиск по `token_key`, `ui_label`, `field_label`, `category`,
      `example_value`, `field_public_id`, label секции — работает (логика
      фильтра сохранена с прошлой версии).
- [x] `example_value` отображается в собственной колонке.
- [x] tsc clean (харнесс прогоняет автоматически, ошибок нет).
- [ ] Скриншоты before/after — за пользователем (preview на
      `/admin/products-docs` → «Плейсхолдеры»).

## Что отложено в backlog (не входит в Execute v4)

- Унификация `customer.signer` ↔ `executor.signer` (сейчас visibility
  symmetric, оба runtime, оба в «Технические / override»; нужен отдельный
  proof по UI-источнику и переименованию).
- Опциональный backfill `field_id` для 154 runtime-токенов (если решим
  убрать runtime-слой полностью; сейчас не нужен).
- Soft-delete шаблонов (`document_templates.deleted_at` + UI guards).
- Audit лейблов на единый pattern «Группа: Поле» (большинство уже OK).
