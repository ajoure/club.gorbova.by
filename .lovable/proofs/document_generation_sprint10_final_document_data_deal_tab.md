# Sprint 10 — Финальный proof: snapshot document_data + вкладка «Документы» в сделке

Дата: 2026-05-08
Статус: реализовано (без включения авто-генерации, без email/Telegram).

---

## 1. Snapshot `orders_v2.meta.document_data`

### 1.1. Где живёт код
- `supabase/functions/_shared/document-data-snapshot.ts` — новый shared-модуль.
- Экспортирует `snapshotOrderDocumentData(supabase, orderId)`.
- Idempotent: если `meta.document_data` уже есть → `skipped_exists` + audit
  `document_data.snapshot_skipped_exists`.

### 1.2. Когда вызывается
Из `canonical-document-payment-hook` — он уже fire-and-forget вызывается из
`grant-access-for-order` после успешной выдачи доступа.
Snapshot выполняется **до** проверки feature-флагов
`documents_canonical_generation_enabled` и
`documents_service_act_auto_generation_enabled`. То есть фиксация данных не
зависит от того, включена ли авто-генерация документа.

### 1.3. Источники (приоритет сборки)
1. `tariff_offers.meta.document_defaults`
2. `product_tariffs.meta.document_defaults`
3. `products_v2.meta.document_defaults`
4. `orders_v2` live: `final_price`, `currency`, `paid_at`, `created_at`,
   `product_id`, `tariff_id`, `offer_id`.
5. Computed: `amount_words`, `currency_major/minor`,
   `service_period_from/to` (из `months_count`), `unit_price = amount / quantity`.

### 1.4. Структура snapshot
```json
{
  "snapshot_version": "1.0",
  "snapshotted_at": "2026-05-08T...",
  "source": { "product_id": "...", "tariff_id": "...", "offer_id": "...", "order_id": "..." },
  "template_id": "...",
  "executor_id": "...",
  "service_name": "...",
  "service_description": "...",
  "unit": "услуга",
  "quantity": 1,
  "unit_price": 100,
  "amount": 100,
  "amount_words": "Сто белорусских рублей 00 копеек",
  "currency": "BYN",
  "currency_major": "рублей",
  "currency_minor": "копеек",
  "payment_due_days": 3,
  "execution_days": 30,
  "service_period_from": "2026-05-08",
  "service_period_to": "2026-06-08",
  "months_count": 1,
  "prepayment_percent": 0,
  "prepayment_amount": 0,
  "discount_amount": 0,
  "first_payment": 100,
  "bank_credit_price": 100,
  "final_payment": 0,
  "comment": null,
  "_provenance": {
    "offer_defaults_present": true,
    "tariff_defaults_present": false,
    "product_defaults_present": false,
    "order_paid_at": "...",
    "order_currency": "BYN"
  }
}
```

### 1.5. Audit
- `document_data.snapshot_created` — успешный snapshot.
- `document_data.snapshot_skipped_exists` — повторный вызов на том же заказе.
- `document_data.snapshot_failed` — ошибка чтения/записи (никогда не throw).
- `document_data.snapshot_refreshed_manually` — UI-кнопка «Обновить из продукта».

### 1.6. Не перетирает вручную
- При наличии `meta.document_data` → `skipped_exists`.
- Перезапись только через UI-кнопку «Обновить из продукта/кнопки оплаты»
  с confirm-диалогом (DealDocumentsCard).

---

## 2. Resolver priority (`_shared/document-render.ts`)

Приоритет сборки токенов при генерации документа по заказу:
1. `orders_v2.meta.document_data` (snapshot) — SOT.
2. `input.overrides` — ручные ad-hoc значения (наивысший приоритет, поверх snapshot).
3. live `tariff_offers` / `product_tariffs` / `products_v2` — fallback.
4. live `orders_v2` (final_price/currency/etc) — fallback.
5. Computed (`numberToWordsRu`, format даты) — последний рубеж.

Маппинг snapshot → `deal.*` токены добавлен после блока `resolverValues`
(см. секцию `// 7b. Sprint 10 — overlay orders_v2.meta.document_data snapshot`).

### 2.1. Warnings
Если для context_type='order' snapshot отсутствует:
- `document_data_snapshot_missing`
- `document_data_live_fallback_used`

Эти warnings попадают в `payload.warnings` и сохраняются в
`ai_generated_documents.warnings_snapshot` при генерации, что видно в UI
карточки документа.

### 2.2. payload.snapshot
В `payload.snapshot` добавлены:
- `document_data` — копия `meta.document_data` или `null`.
- `document_data_source: 'order_snapshot' | 'live_fallback'`.

---

## 3. Вкладка «Документы» в сделке

### 3.1. Где
`src/components/admin/DealDocumentsCard.tsx` — встроена в `DealDetailSheet.tsx`
между блоком «Подписка» и «История действий».

### 3.2. Структура
Внутри карточки `Tabs` с двумя табами:

#### Подвкладка «Поля»
- Источник: `orders_v2.meta.document_data`.
- Группы (как в Plan):
  - Шаблон и исполнитель
  - Услуга
  - Стоимость
  - Сроки
  - Расчёты
- Технические поля (`template_id`, `executor_id`) скрыты под toggle
  «Технические данные».
- Read-only MVP. Подпись «Редактирование полей будет добавлено позднее».
- Кнопка «Обновить из продукта» с confirm-диалогом
  (предупреждает о перезаписи и пишет audit).
- Если snapshot отсутствует — показывается CTA «Создать снимок».

#### Подвкладка «Документы»
- Источник: `ai_generated_documents` где
  `context_type='order' AND context_id=deal.id AND deleted_at IS NULL`.
- Колонки: дата, шаблон, статус проверки DOCX (ok/проверить),
  кнопка скачивания, кнопка «Перегенерировать».
- Warnings_snapshot отображаются inline под документом.
- Кнопка «Сформировать DOCX» — вызывает `canonical-document-generate`
  (gated по `documents_canonical_generation_enabled`).

### 3.3. Канонические компоненты
Используются стандартные UI-блоки: `Card`, `Tabs/TabsList/TabsTrigger`,
`Badge`, `Button`, `AlertDialog`, `Switch`, `Skeleton`. Новых паттернов нет.

---

## 4. Не включено (по плану)

- `documents_canonical_generation_enabled` — **остаётся как было** (не
  меняется этим спринтом).
- `documents_service_act_auto_generation_enabled` — **остаётся false**.
- Hook авто-генерации (`canonical-document-payment-hook`) сохраняет no-op
  ветку при выключенном `auto`-флаге (snapshot выполняется, документ — нет).
- Email/Telegram — не отправляются.
- Batch / массовая генерация — не реализована.
- Legacy `generated_documents` / `ai-generate-document` /
  `generate-from-template` / `document-auto-generate` — не модифицированы.
- Новых таблиц/колонок не создано (snapshot живёт строго в
  `orders_v2.meta.document_data`).

---

## 5. SQL-проверки (для dev/staging)

```sql
-- A. Базовые счётчики (legacy не должен расти)
SELECT count(*) FROM generated_documents;
SELECT count(*) FROM ai_generated_documents;
SELECT key, value FROM app_settings
WHERE key IN (
  'documents_canonical_generation_enabled',
  'documents_service_act_auto_generation_enabled'
);

-- B. Snapshot на тестовом заказе
SELECT id, order_number, meta->'document_data' AS document_data
FROM orders_v2 WHERE id = '<test_order_id>';

-- C. Audit нового snapshot
SELECT created_at, action, meta
FROM audit_logs
WHERE action LIKE 'document_data.%'
ORDER BY created_at DESC LIMIT 20;
```

Ожидаемое для (B): snapshot_version='1.0', template_id, executor_id,
amount, amount_words, currency, service_name, source.{product_id,tariff_id,offer_id,order_id}.

---

## 6. Resolver proof

Preview документа по заказу со snapshot:
- `snapshot.document_data` непустой, `document_data_source='order_snapshot'`.
- `warnings` не содержит `document_data_snapshot_missing`.
- `deal.amount`, `deal.amount_words`, `deal.currency`, `deal.service_name` и т.д.
  взяты из snapshot, а не из live-полей.

Preview документа по заказу без snapshot:
- `document_data_source='live_fallback'`.
- `warnings`: `document_data_snapshot_missing`, `document_data_live_fallback_used`.
- Документ всё ещё рендерится (graceful fallback на live `orders_v2` /
  product / tariff).

---

## 7. Файлы

### Создано
- `supabase/functions/_shared/document-data-snapshot.ts`
- `src/components/admin/DealDocumentsCard.tsx`
- `.lovable/proofs/document_generation_sprint10_final_document_data_deal_tab.md`

### Изменено
- `supabase/functions/canonical-document-payment-hook/index.ts` —
  вызов `snapshotOrderDocumentData` до проверки флагов.
- `supabase/functions/_shared/document-render.ts` —
  overlay snapshot → token resolver, snapshot → payload.
- `src/components/admin/DealDetailSheet.tsx` —
  карточка «Документы» в правую колонку.

### НЕ изменено (verified)
- `generated_documents` (legacy) — не трогалась.
- `ai-generate-document`, `generate-from-template`,
  `generate-invoice-act`, `generate-document-pdf`,
  `document-auto-generate` — не модифицировались.
- Email/Telegram edge functions — не вызываются hook'ом.
- Auto-generation feature flags — оставлены как было (false по умолчанию).

---

## 8. Что осталось на будущие спринты

- Полноценное редактирование `document_data` из UI с валидацией.
- Включение `documents_service_act_auto_generation_enabled` после dry-run на стейдже.
- Авто-рассылка сгенерированных документов клиенту (email/Telegram/cabinet).
- Batch-генерация по фильтру заказов.
- Drift-detection: предупреждение, если live-данные сильно разошлись со snapshot.

---

## Sprint 11 — UI BLOCKERS (PATCH UI-BLOCKER-1, UI-BLOCKER-2)

### PATCH UI-BLOCKER-1 — выбор шаблона и исполнителя

**Проблема (root cause):** В `OfferDocumentDefaultsCard.tsx` массивы `templates` и `executors` объявлялись через `useState([])`, но никогда не загружались — отсутствовал `useEffect` с запросом к Supabase. Поэтому select всегда показывал «Нет активных…».

**Фикс:** Добавлен `useEffect` (см. PATCH UI-BLOCKER-1), который параллельно читает:
- `document_templates` где `is_active=true` + join на `document_template_versions` через `current_version_id` (с fallback без версии, если relation недоступен) — тот же источник, что и `/admin/ai → Документы → Шаблоны документов`.
- `executors` где `is_active=true`, отсортированы `is_default DESC, short_name ASC` — тот же источник, что и `/admin/ai → Документы → Исполнители`.

**SelectItem:**
- Шаблон: `{name} · {code} · v{version}`. Если `current_version_id IS NULL` → пункт `disabled` + пометка `· нет активной версии`.
- Исполнитель: `{short_name|full_name}` + `· по умолчанию` для `is_default`.
- Empty state: понятное сообщение со ссылкой на нужный раздел.

**Технические ID** (UUID `template_id`/`executor_id`) показаны только под toggle «Показывать технические ID» — ручной ввод UUID отсутствует.

**SQL proof:**
```
SELECT id, name, code, is_active, current_version_id FROM document_templates WHERE is_active=true LIMIT 5;
SELECT id, short_name, full_name, is_default, is_active FROM executors WHERE is_active=true ORDER BY is_default DESC;
-- → executor d0c7fe75-1192-40a9-bbae-b652b69e6882 ЗАО "АЖУР инкам" (default) виден
-- → template 11111111-... act_test_sprint6 (active) виден
```

### PATCH UI-BLOCKER-2 — фиксированный размер окна кнопки оплаты

**Проблема:** `DialogContent` оборачивал весь контент (header + tabs + footer) в один скроллящийся `<div>`, поэтому при переключении вкладок высота окна менялась, header/footer прыгали.

**Фикс:** Перестроена структура `Dialog` на оплату (`AdminProductDetailV2.tsx`):
```
DialogContent  (h-[86vh] max-w-5xl, flex flex-col, overflow-hidden)
├── DialogHeader        shrink-0, border-b
├── Tabs                flex-1 flex flex-col min-h-0
│   ├── div TabsList    shrink-0
│   └── div             flex-1 overflow-y-auto min-h-0   ← единственная scroll-area
│       └── TabsContent main/payment/renewal/documents/extra
└── DialogFooter        shrink-0, border-t
```

Теперь header (TabsList) и footer (Отмена/Сохранить) фиксированы; скроллится только содержимое активной вкладки. Высота окна `86vh` → не меняется при переключении табов.

### Не сделано в этом проходе (отложено на следующий шаг Sprint 11)
- PATCH DRIFT-1 (бейдж drift snapshot vs live в карточке сделки → Документы → Поля).
- Полный e2e-тест регенерации DOCX из сделки.

### Безопасность
- Флаги `documents_canonical_generation_enabled` и `documents_service_act_auto_generation_enabled` не трогали — остаются `false`.
- Email/Telegram/auto-send/batch — не трогали.
- Новых таблиц/колонок не
 создавали.
