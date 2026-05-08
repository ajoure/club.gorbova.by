# Sprint 10 part 2 — каталог плейсхолдеров и данные кнопки оплаты

Дата: 2026-05-08
Тип: UI + конфиг (без миграций схемы, без авторассылки).

## 1. Каталог токенов в БД

Таблица: `public.document_token_registry` (`archived_at IS NULL`).

```
SELECT category, COUNT(*) FROM document_token_registry
WHERE archived_at IS NULL GROUP BY category ORDER BY category;
```

| category          | count |
|-------------------|-------|
| contact           | 6     |
| customer          | 14    |
| customer.signer   | 4     |
| deal              | 18    |
| document          | 30    |
| executor          | 15    |
| legal_details     | 47    |
| offer             | 7     |
| product           | 4     |
| system            | 6     |
| tariff            | 6     |
| **итого**         | **157** |

Группы (11) → отображаются в указанном порядке в каталоге и в `documents:act` picker’е
(см. `src/lib/tokens/tokenRegistry.ts → ACT_GROUP_ORDER`).

## 2. Вкладка «Плейсхолдеры»

Файл: `src/components/ai-documents/PlaceholdersCatalogTab.tsx`.
Точка входа: `/admin/ai → Документы → Плейсхолдеры`
(`AiPageContent.tsx → DOC_SUB_TABS.id = "placeholders"`).

UI:

- Поиск по `ui_label / token_key / description / category`.
- Группировка по 11 группам с заголовками 1..11 (порядок согласно ТЗ).
- Карточка токена: человекочитаемое название, бейдж типа данных,
  бейдж «обяз.», `{{token_key}}` мелким моно, описание, пример значения,
  кнопка копирования.
- Тогл «Показать технические данные» открывает `field_id`,
  `resolver_key`, `source_type` (моно-шрифт).

## 3. Копирование токена

Кнопка `Copy` копирует строку `{{<token_key>}}` через `navigator.clipboard`,
toast `Скопировано: {{...}}`.

Пример: для строки реестра
`token_key = document.service_name` копируется ровно
`{{document.service_name}}`.

## 4. `documents:act` в шаблонах документов

- `src/lib/tokens/tokenRegistry.ts` уже содержит `documents:act`
  (Sprint 10 part 1) и подгружает 11 групп из `document_token_registry`.
- `src/components/ai-documents/AiDocumentTemplatesManager.tsx`:
  `TokenizedRichInput` инструкций к шаблону переключён с
  `documents:annual_meeting` → `documents:act`.
- Контекст `documents:annual_meeting` сохранён в registry для legacy-шаблонов
  собраний; рассылки и контакт-центр (`messages`) не затронуты.

## 5. Продукт: вкладка «Документы»

Файл: `src/pages/admin/AdminProductDetailV2.tsx` —
`TabsTrigger value="custom_fields"` переименована: `Доп. поля` → `Документы`.
Сам компонент `ProductCustomFields` дополнен пояснительной шапкой
«Поля для документов» с подсказкой об их использовании и ссылкой на
каталог плейсхолдеров. Логика хранения (`entity_custom_fields`) и
существующие поля продуктов **не тронуты**.

## 6. Кнопка оплаты: «Данные для документов»

Файлы:

- `src/hooks/useTariffOffers.tsx` — добавлен интерфейс
  `OfferDocumentDefaults` (≈22 поля) и поле `document_defaults?` в
  `OfferMetaConfig`. Хранится в `tariff_offers.meta.document_defaults`
  (jsonb). Схема таблицы НЕ менялась.
- `src/components/admin/product/OfferDocumentDefaultsCard.tsx` — новая
  карточка в диалоге кнопки оплаты, вынесена отдельно.
- `src/pages/admin/AdminProductDetailV2.tsx` — карточка добавлена в
  `Collapsible` блок настроек оффера сразу после `OfferCrmRoutingSection`.

Поля:
`generate_act, template_id, service_name, service_description, unit,
quantity, unit_price, amount, currency, payment_due_days, execution_days,
service_period_from, service_period_to, months_count, prepayment_percent,
prepayment_amount, discount_amount, first_payment, bank_credit_price,
final_payment, executor_id, comment`.

Сохранение: `handleSaveOffer` инициализирует `metaToSave` через
`{ ...offerForm.meta }` — `document_defaults` проходит насквозь,
существующие `recurring/installment/preregistration/welcome_message/crm_routing`
не затрагиваются. Старые офферы без `meta.document_defaults` корректно
открываются с пустыми значениями.

## 7. Копирование кнопки оплаты

Файлы:

- `src/components/admin/product/OfferRowCompact.tsx` — добавлена
  опциональная кнопка `Copy` (lucide) с подсказкой «Копировать кнопку».
- `src/pages/admin/AdminProductDetailV2.tsx` — `handleCopyOffer`:
  - Копирует все функциональные поля + `meta` (включая `document_defaults`).
  - Принудительно `is_active = false`, `is_primary = false`.
  - `getcourse_offer_id = null` (не копируем provider-side ID, чтобы не
    создавать конфликт активной ссылки).
  - Меняет `button_label` → `"<original> (копия)"`.
  - Лог: `audit_logs.action = "offer.copied"`,
    `actor_type = "admin"`, `meta = { source_offer_id, tariff_id,
    copied_document_defaults }`.

## 8. Что НЕ делалось

- Email не отправлялся; шаблоны и edge-функции рассылок не трогались.
- Telegram не отправлялся; queue не затронут.
- Auto-generation документов остаётся выключенной
  (`documents_canonical_generation_enabled = false`).
- Production auto-generation (по оплате) не включалась.
- Legacy `generated_documents` не трогалась.
- Схема БД не менялась (только UI/типы); миграций в этой части не было.

## 9. Что осталось на следующий этап (Sprint 10 part 3)

- Snapshot `orders_v2.meta.document_data` при оплате
  (`grant-access-for-order`).
- Вкладка «Документы» в карточке сделки (history + snapshot).
- Resolver priority: `orders_v2.meta.document_data` → live data в
  `_shared/document-render.ts`.
