# Sprint 10 — Discovery existing placeholder system

## TL;DR

Второй placeholder picker для документов **не нужен**. Уже есть готовая инфраструктура из контакт-центра / рассылок:

- **UI-компонент:** `src/components/admin/TokenizedRichInput.tsx` — TipTap-редактор. Триггер `[`, выпадающий список, поиск, чипы, человеческие лейблы, копирование `{{token}}` в буфер.
- **Реестр токенов (UI-слой):** `src/lib/tokens/tokenRegistry.ts` — единый registry с группами `contact`, `datetime`, `product`, `legal_details`, `person`, `entity_person`, `entity`, `document`, `meeting`, `package_*`, `agenda`, `decision`. API: `loadTokensForContext(context)` + `getTokenGroupsForContext(context)`.
- **Реестр токенов (DB):** таблица `public.fields_registry` (динамические поля по `entity_type`) + таблица `public.document_token_registry` (документ-специфичные токены, привязанные к `category` + опциональный `field_id`).
- **Aliases:** таблица `public.document_token_aliases` — нормализация исторических плейсхолдеров шаблонов в canonical `token_key`.

## Inventory компонентов

`TokenizedRichInput` уже используется в:

| Файл | Контекст | Назначение |
|------|----------|------------|
| `src/components/admin/communication/BroadcastTemplateDialog.tsx` | `messages` | Шаблоны рассылок |
| `src/components/admin/communication/BroadcastsTabContent.tsx` | `messages` | Текст рассылки |
| `src/components/admin/communication/CommunicationSettingsTabContent.tsx` | `messages` | Шаблоны автоответов |
| `src/components/telegram/MassBroadcastDialog.tsx` | `messages` | Telegram mass broadcast |
| `src/pages/admin/AdminEmail.tsx` | `messages` | Email-кампании |
| `src/components/ai-documents/AiDocumentTemplatesManager.tsx` | `documents` | Шаблоны документов (уже подключено!) |

Тот же скриншот контакт-центра, который показал пользователь («квадратная скобка → выпадающий список с группами `Контакт / Профиль`, `Дата / Время`, `URL кнопки`») — это и есть `TokenizedRichInput` с контекстом `"messages"`.

## Inventory таблиц (по факту БД)

### `fields_registry` (динамические custom fields)

| entity_type   | count |
|---------------|-------|
| legal_details | 47    |
| meeting       | 15    |
| person        | 12    |
| package       | 8     |
| entity        | 6     |
| entity_person | 6     |
| document      | 3     |
| product       | 3     |
| agenda        | 1     |
| decision      | 1     |

### `document_token_registry` (токены под документы)

| category       | count |
|----------------|-------|
| customer       | 9     |
| executor       | 10    |
| deal           | 8     |
| document       | 3     |
| legal_details  | 47    |
| system         | 2     |
| **итого**      | **79** |

## Что уже работает 1:1

1. Lever pickup: `{{full_name}}`, `{{email}}`, `{{phone}}`, `{{today}}`, `{{year}}` — резолвятся через `_shared/systemTokens.ts` и `resolveContactTokens`.
2. `{{cf.legal_details.FLD-XXXXXX}}` — Class A токены реквизитов (47 шт).
3. Шаблоны документов уже подключены к `TokenizedRichInput` с контекстом `"documents"` и видят `legal_details`, `entity`, `person`, `entity_person`, `document`, `meeting`.
4. Резолвер в `supabase/functions/_shared/document-render.ts` уже умеет читать `meta.document_data` из заказа, если оно есть.

## Что НЕ работает / требует Sprint 10

1. В вкладке «Доступные плейсхолдеры» (Generator UI) показывается урезанный список — реестр `document_token_registry` не отдаёт полный набор.
2. Контекста `"documents:act"` нет — поэтому в picker'е шаблона акта нет групп `executor.*`, `customer.signer.*`, `order.*`, `offer.*`, `document.service_*`, `document.payment_due_days` и т.д.
3. `document_token_registry` не содержит токенов `order.*`, `offer.*`, `product.*`, `tariff.*`, расширенных `document.*` (всё, что про услугу, сроки, расчёты, валюту прописью).
4. У продукта вкладка называется «Доп. поля» — её надо переименовать в «Документы» и переиспользовать тот же `ProductCustomFields`-движок.
5. У `tariff_offers` нет UI-секции «Данные для документов» (хотя `meta` jsonb уже есть и принимает любые ключи).
6. У сделки нет вкладки «Документы» с подвкладками «Поля» + «Документы».
7. Нет действия «Копировать кнопку оплаты» на уровне offer'а.
8. Snapshot `orders_v2.meta.document_data` пишется не из новой цепочки (offer → tariff → product), а только текущим резолвером по запросу.

## Решение

- Расширить **существующий** `tokenRegistry.ts`: добавить `TokenContext = "documents:act"` и адаптер, который грузит группы напрямую из `document_token_registry` (сгруппированные по `category`, с человеческими `ui_label` и техническим `token_key` под капотом).
- Заполнить `document_token_registry` полным набором (миграция-backfill, идемпотентная по `token_key`).
- Переключить `AiDocumentTemplatesManager` и `CanonicalActGenerator` на `tokenContext="documents:act"`.
- Добавить вкладку «Плейсхолдеры» в `/admin/ai → Документы`, которая рендерит весь каталог из `document_token_registry`.
- Постепенно навешивать UI-секции document_defaults на product / tariff / offer и snapshot-логику в `grant-access-for-order`.

## Гарантии legacy

- Контекст `"messages"` и `"documents"` остаются без изменений — все текущие шаблоны рассылок и документов работают как раньше.
- `generated_documents` (legacy) и `document-auto-generate` не трогаются.
- Все feature-флаги автогенерации документов остаются `false`.
- Email/Telegram/auto-send/массовая генерация в Sprint 10 не запускаются.
