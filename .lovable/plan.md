Да, согласен, с учетом правок:

1. **Не использовать** `generated_documents` **как основной источник, пока не подтверждена таблица.**  
В проекте ранее канонические документы фиксировались в `ai_generated_documents`. Поэтому сначала сделать discovery:
  - где реально лежат документы после `canonical-document-generate-strict`;
  - `ai_generated_documents` или `generated_documents`;
  - какие поля там есть: `id`, `order_id/context_id`, `file_path`, `storage_bucket`, `file_mime`, `meta.docx_storage_path`, `status`, `deleted_at`.
  После discovery выбрать **одну SOT-таблицу**. Не писать код вслепую под `generated_documents`.
2. **Сначала read-only discovery по** `/purchases`**, потом execute.**  
Перед правками обязательно выдать proof:
  - какие компоненты реально используются в `/purchases`;
  - где сейчас вызываются `generate-invoice-act`, `send-invoice`, `generate-document-pdf`;
  - где уже есть canonical docs;
  - какие реальные `order_id`/`payment_id`/`receipt_url` доступны пользователю;
  - какие документы уже сгенерированы по этим заказам.
3. **Не генерировать документ на каждое открытие страницы.**  
В `/purchases`:
  - если canonical-документ уже есть — показывать его;
  - если документа нет, но есть правила генерации — показывать кнопку **«Сформировать документ»**;
  - автогенерация при открытии страницы запрещена, чтобы не плодить документы и номера.
4. **Не расходовать номер документа на preview.**  
Если пользователь нажимает «Просмотр PDF», а документ ещё не создан:
  - либо сначала показывать кнопку «Сформировать документ»;
  - либо preview должен быть без расхода canonical numbering.
  Нельзя, чтобы простой просмотр в личном кабинете создавал новый официальный номер без явного действия.
5. `canonical-document-send` **должен работать только с уже созданным canonical-документом или явно создавать его один раз idempotent.**  
Требование:
  - если document exists → отправить существующий PDF;
  - если не exists → вызвать canonical generate с устойчивым `idempotency_key`;
  - повторная отправка не должна создавать второй документ и новый номер.
6. **bePaid-чек — только для реальных платежей.**  
Показывать чек только если:
  - есть `payments_v2.status='succeeded'`;
  - есть `receipt_url` в `payments_v2.receipt_url` или `provider_response.transaction.receipt_url`;
  - это не virtual/manual/test-only без реального bePaid-чека.
  Для admin_test можно показывать бейдж «Тестовый платёж — чек bePaid отсутствует», но не создавать фейковый чек.
7. **Скрыть виртуальные квитанции для эквайринговых платежей.**  
`receiptGenerator.ts` оставить, но:
  - не показывать его, если есть реальный `payments_v2` с provider/bePaid receipt;
  - не смешивать «квитанцию платформы» и «чек bePaid».
8. **Telegram-отправка только PDF-файлом.**  
Для Telegram:
  - использовать `sendDocument`, не `sendMessage`;
  - файл должен быть PDF-вложением;
  - если у пользователя не привязан Telegram — показывать понятную ошибку/disabled state;
  - не отправлять ссылку на Supabase/storage.
9. **Email-отправка — PDF attachment.**  
Email должен содержать PDF как вложение, а не только ссылку.  
В письме можно дополнительно дать ссылку на скачивание через `gorbova.by/document-download/<id>`, но не через `*.supabase.co`.
10. **Права доступа обязательны.**  
В `canonical-document-send` и document download:

- пользователь видит только свои документы;
- admin/super_admin может видеть документы сделок;
- `file_path`/`bucket` нельзя принимать от клиента;
- документ ищется только по `document_id` из БД.

11. **Не удалять legacy edge-functions физически.**  
`generate-invoice-act`, `generate-document-pdf`, `send-invoice`:

- убрать из клиентского `/purchases`;
- пометить deprecated в proof/backlog;
- физически не удалять до отдельного discovery внешних вызовов.

12. **OrderDocuments.tsx нужно подключить к платежной строке.**  
Сейчас он есть, но не используется. Нужно решить:

- либо переиспользовать его как Sheet документов;
- либо удалить из нового UX и заменить единым компактным меню.

Не оставлять два разных UI-пути для документов.

13. **Для подписки использовать последний оплаченный order, но показать историю документов по всем списаниям.**  
В `SubscriptionDetailSheet`:

- основное действие — документы по последнему оплаченному order;
- в истории списаний — документы/чек по каждому `order_id`;
- не смешивать документы первого платежа и документов последующих rebill.

14. **Разделить понятия в UI:**

- **Чек bePaid** — внешний фискальный/платёжный чек от провайдера.
- **Счёт-акт / акт** — документ, сгенерированный нашей платформой.
- **Квитанция платформы** — legacy/virtual, скрыта для эквайринга.

15. **Нужен empty-state.**  
Если по оплате есть реальный платёж, но нет правил документов:

- не показывать ошибку;
- показать текст: «Документы по этой оплате не настроены».

Если платежа нет:

- секцию документов скрыть или показать «Платёж отсутствует».

16. **Proof должен быть на реальных заказах.**  
Verify минимум по 4 кейсам:

- реальная/тестовая успешная оплата с canonical-документом;
- оплата без сгенерированного документа, но с правилами → кнопка «Сформировать»;
- оплата с bePaid receipt_url → чек показывается;
- виртуальная сделка без `payments_v2` → документы/чек скрыты.

17. **Финальный отчёт должен включать точные файлы и grep-proof.**  
В отчёте:

- где удалены вызовы legacy-functions;
- какой SOT выбран для canonical documents;
- grep по `generate-invoice-act`, `send-invoice`, `generate-document-pdf` в клиентском `/purchases`;
- proof, что `*.supabase.co` не открывается в UI;
- proof отправки PDF email/Telegram;
- proof receipt_url bePaid.

Скопируй Lovable как дополнение:

```text
Дополни план следующей информацией:

1. Перед execute сделать read-only discovery и подтвердить SOT-таблицу canonical documents: ai_generated_documents или generated_documents. Не писать код под generated_documents вслепую.

2. В /purchases запрещена автогенерация документов при открытии страницы. Если документа нет, но есть правила генерации — показывать кнопку «Сформировать документ». Preview не должен расходовать номер документа.

3. canonical-document-send должен быть idempotent: если документ уже есть — отправляет существующий PDF; если нет — создаёт один раз через canonical-document-generate-strict с устойчивым idempotency_key. Повторная отправка не создаёт новый номер.

4. bePaid-чек показывать только для реального succeeded payments_v2 с receipt_url / provider_response.transaction.receipt_url. Для virtual/manual/test-only не создавать фейковый bePaid-чек.

5. receiptGenerator.ts оставить, но скрыть виртуальную квитанцию для эквайринговых платежей, где есть реальный payments_v2 / bePaid receipt.

6. Telegram отправка — только PDF-вложением через sendDocument, не текстом и не ссылкой. Email — PDF attachment. Никаких Supabase/storage URL в пользовательском UI и письмах.

7. Права доступа: document_id-only, file_path/bucket не принимать от клиента. Пользователь видит только свои документы, admin/super_admin — документы сделок.

8. Legacy functions generate-invoice-act / generate-document-pdf / send-invoice убрать из клиентского /purchases, но физически не удалять до отдельного discovery внешних вызовов.

9. Для подписок: основной документ — по последнему оплаченному order_id, но в истории списаний показывать чек/документы по каждому платежу отдельно.

10. Разделить UI-понятия:
- Чек bePaid — реальный чек провайдера.
- Счёт-акт / акт — canonical document нашей платформы.
- Квитанция платформы — legacy/virtual, скрыта для эквайринга.

11. Verify минимум на 4 кейсах:
- successful payment + existing canonical document;
- successful payment + no document yet but rules exist → «Сформировать документ»;
- payment with receipt_url → bePaid чек доступен;
- virtual order without payments_v2 → документы/чек скрыты.

12. Финальный proof:
- grep, что в /purchases нет legacy invoke generate-invoice-act/send-invoice/generate-document-pdf;
- proof canonical document download через document-download/blob;
- proof email/Telegram PDF attachment;
- proof bePaid receipt_url;
- proof, что *.supabase.co не открывается в UI.

План: «Мои покупки» — единый канонический пайплайн документов
```

# Цель

В личном кабинете пользователя (`/purchases`) на каждую реальную (эквайринговую) оплату клиент должен видеть и получать:

1. **Сгенерированные документы** (счёт-акт / акт выполненных работ) — строго из канонического пайплайна (`canonical-document-generate-strict`), тот же, что работает у тарифа CHAT.
2. **Чек bePaid** — реальная ссылка из платежа (`payments_v2.receipt_url` / `provider_response.transaction.receipt_url`).
3. Возможность просмотра PDF, скачивания PDF, отправки на Email, в Telegram (как PDF-вложение, не текстом), «отправить везде».

Виртуальные сделки (без `payments_v2`/без реального эквайринга) — кнопка «Документы» скрыта, чек bePaid не показывается.

# Diagnose (текущее состояние)

- `src/pages/Purchases.tsx` — есть Активные подписки + История (Платежи / Подписки / Предзаписи). Использует:
  - `OrderListItem` → дропдаун «Документы» вызывает **legacy** edge-function `generate-invoice-act` (Просмотр, Отправить на почту/Telegram/везде). Это и есть «старый шаблон», который мешает.
  - `SubscriptionDetailSheet` → кнопка «Скачать квитанцию» → `receiptGenerator.ts` (виртуальная PDF, юридически невалидная). **Сохраняем код, но скрываем из UI для эквайринговых платежей.**
  - `OrderDocuments.tsx` (Sheet) есть, но не открывается из платежной строки (`documentsOrderId` не сетится).
- Канонический путь уже работает: `canonical-document-generate-strict` + `document-download` (blob, PDF). Документы лежат в `generated_documents` (FK на `order_id`, `template_id`).
- Legacy для удаления из клиента: `generate-invoice-act`, `generate-document-pdf`, `send-invoice` (используются только в `OrderListItem` и `ConsultationPaymentDialog`).
- bePaid чек уже есть как иконка справа от строки (`receipt_url`) — нужно унифицировать визуально внутрь общего меню «Документы».

# План (Plan → Dry run → Execute → Verify)

## Шаг 1. Бэкенд: унифицировать send/preview на канонический пайплайн

1.1. **Refactor `OrderListItem.tsx**`:

- Убрать вызовы `generate-invoice-act` (preview и send).
- Использовать новый общий хук `useOrderCanonicalDocuments(orderId)`, который читает `generated_documents` по `order_id` (только `status='generated'`, `deleted_at is null`).
- Preview/Download: через `downloadDocumentBlob(doc.id, 'pdf')` — уже канонично.
- Send Email/Telegram: новый тонкий edge function `**canonical-document-send**` (см. шаг 2), который принимает `document_id` + флаги `send_email`/`send_telegram`, отдаёт уже сгенерированный PDF из storage как attachment (НЕ текст). Если документа ещё нет — внутри вызывает `canonical-document-generate-strict` (`mode=generate`).

1.2. **Удалить из клиента** импорты и вызовы:

- `supabase.functions.invoke("generate-invoice-act", ...)` — везде в `src/`
- `supabase.functions.invoke("send-invoice", ...)` — в `ConsultationPaymentDialog`
- Сами edge-функции `generate-invoice-act`, `send-invoice`, `generate-document-pdf` — пометить depreated в `.lovable/backlog/`, но физически НЕ удалять в этом спринте (могут быть внешние вызовы / webhooks). Удаление — отдельный backlog-таск.

1.3. `receiptGenerator.ts` и `generateOrderReceipt` / `generateSubscriptionReceipt` — **оставить как есть**, но в UI скрыть для эквайринговых платежей (по умолчанию). Использование останется только для будущих безналичных/рассрочечных сценариев (где `payments_v2` нет).

## Шаг 2. Новый edge function `canonical-document-send`

Тонкая обёртка:

- Вход: `{ document_id, send_email?: boolean, send_telegram?: boolean }`
- Логика:
  1. Загружает `generated_documents` (проверка владельца по JWT).
  2. Если `file_path` нет или просрочен — вызывает `canonical-document-generate-strict` (`mode=generate`, тот же template_id/order_id).
  3. Скачивает PDF из storage (service role).
  4. Email: отправляет через Resend с PDF-attachment (используем существующий шаблон письма, что и в почте, что приходит сейчас).
  5. Telegram: `sendDocument` через connector gateway (НЕ `sendMessage`) — отправит реальный PDF в чат пользователя.
- Audit: пишет в `audit_logs` события `document.sent.email` / `document.sent.telegram` с `document_id`, `user_id`.

## Шаг 3. UX «Мои покупки»

### 3.1. История → Платежи (`OrderListItem`)

Заменить текущий дропдаун «Документы» на компактный блок с действиями:

```
[ Чек bePaid ↗ ]   [ 📄 Счёт-акт № СА-26-00026 ▾ ]
                        ├─ Просмотр PDF
                        ├─ Скачать PDF
                        ├─ Отправить на почту
                        ├─ Отправить в Telegram
                        └─ Отправить везде
```

- Список документов = реальные строки из `generated_documents` для этого order_id.
- Если документ ещё не сгенерирован, но `tariff_offer` имеет привязанные правила генерации → показывать одну кнопку **«Сформировать документы»** (вызывает `canonical-document-generate-strict` per rule, потом подтянет в список).
- Если у заказа нет ни одного правила/документа и нет успешного `payments_v2` → не показывать секцию документов вообще.
- Бейдж «Платёж отсутствует» — для строк-заказов без `payments_v2` (на случай ручных/виртуальных сделок, попавших в выдачу).

### 3.2. Активные подписки (`SubscriptionListItem` / `SubscriptionDetailSheet`)

- В правом нижнем углу карточки/в Sheet — те же действия, привязанные к **последнему оплаченному `order_id**` этой подписки (берём `subscriptions_v2.orders_v2.payments_v2`).
- Кнопку «Скачать квитанцию» (виртуальный receipt) **скрыть**, если у подписки есть `order.payments_v2[*].receipt_url` (т.е. это эквайринг). Оставляем её видимой только для подписок без эквайрингового платежа (future-proof).
- Добавить ссылку «Все документы по подписке» → открывает существующий `OrderDocuments` Sheet, заполненный `documentsOrderId = последний order_id`.

### 3.3. Визуальная полировка

- Шапка карточки Активные подписки: добавить столбец «Документы» (иконка PDF + счётчик).
- Tabs «Платежи / Прошлые подписки / Предзаписи» — оставить как сейчас, но добавить пустые-стейты с понятным текстом «Документы появятся после успешной оплаты».
- Иконки/бейджи — без новых цветов, использовать существующие семантические токены.

## Шаг 4. Гарантия «документ только при оплате»

В UI и в `canonical-document-send` enforce:

- Документы доступны только если `order.status='paid'` И есть `payments_v2` с `status='succeeded'`.
- Иначе UI показывает плашку «Документы недоступны: отсутствует подтверждённый платёж. Обратитесь в поддержку.»
- Никаких генераций по виртуальным/manual сделкам без оплаты — серверный guard в `canonical-document-send` (HTTP 422 + audit `document.send_blocked_no_payment`).

## Шаг 5. Verify (DoD)

1. На preview под `club.gorbova.by/purchases` (логин dev `123456`):
  - Реальный платёж CHAT 100 BYN → дропдаун «Документы» → «Просмотр» открывает канонический PDF (тот же, что в админке).
  - «Отправить в Telegram» → в TG прилетает **PDF-файл вложением**, не текст.
  - «Отправить на почту» → email с актуальным шаблоном (как сейчас в админ-генерации), PDF приложен.
  - Чек bePaid открывается отдельной кнопкой.
2. Подписка «Подоходный налог ИП — 2 этапа» (Active) → видны документы последнего платёжа + кнопка «Все документы».
3. У ошибочного платежа (`Ошибка`) — нет кнопки «Документы», есть только «Чек ошибки bePaid».
4. Виртуальная сделка без `payments_v2` → нет кнопки «Документы», есть плашка «Платёж отсутствует».
5. `receiptGenerator.ts` остаётся в репо, но в эквайринговых сценариях не вызывается (поиск usages — пусто, кроме fallback-ветки для безнала).
6. `audit_logs`: новые события `document.sent.email/.telegram`, `document.send_blocked_no_payment` пишутся.
7. Memory update: `mem://commercial-logic/documents/cabinet-documents-canonical-sot` — фиксируем «Мои покупки = canonical pipeline + bePaid receipt; legacy generate-invoice-act/send-invoice — deprecated».

# Технические заметки

- Новые/изменённые файлы:
  - `supabase/functions/canonical-document-send/index.ts` *(new)*
  - `supabase/functions/canonical-document-send/index.ts` + запись в `supabase/functions.registry.txt`
  - `src/hooks/useOrderCanonicalDocuments.ts` *(new)* — обёртка над `generated_documents` по `order_id`
  - `src/components/purchases/OrderListItem.tsx` — переписать дропдаун
  - `src/components/purchases/SubscriptionListItem.tsx` + `SubscriptionDetailSheet.tsx` — добавить блок документов / скрыть legacy receipt
  - `src/pages/Purchases.tsx` — пробросить `documentsOrderId` из новых кнопок
  - `src/components/payment/ConsultationPaymentDialog.tsx` — перевести на canonical-document-send (или убрать вызов, если он не нужен в момент чекаута)
- `.lovable/backlog/remove_legacy_invoice_act_functions.md` — backlog на удаление 3 deprecated edge-функций после двух недель без вызовов.
- Файлы НЕ трогаем: `src/integrations/supabase/client.ts`, `types.ts`, `.env`, `canonical-document-generate-strict/*`, `document-download/*`.

Жду подтверждения, и иду в Execute.