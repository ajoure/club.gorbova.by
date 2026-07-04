да, согласен, с учетом правок:

1. **Не внедрять новый email-shell слишком широко.**  
Новый `branded-email-shell.ts` использовать только для `canonical-document-send`. Auth-письма и другие отправки не трогать.
2. `displayTitle` **не брать слепо из** `file_name`**.**  
Нужно убрать `.pdf`, но также нормализовать:
  - лишние пробелы;
  - дефисы;
  - пустую дату `от.pdf`;
  - если дата не resolved — собрать title из `document_number + issued_at`.
3. **Fallback даты делать только для pre-payment invoice.**  
Не менять глобально `payment.paid_at` для всех документов. Условие:
4. **Не ломать старый** `invoice_number`**.**  
Верно: оставить `invoice_number = orderNumber`, добавить:
  - `document_number`;
  - `issued_at`;
  - `payment_purpose`.
5. **Payment purpose должен формироваться в одном месте.**  
UI, email и Telegram должны получать одну и ту же строку из backend-ответа, а не собирать каждый по-своему.
6. **Telegram error не должен ломать выпуск счёта.**  
Если Telegram не привязан/не отправился:
  - PDF и email считаются успешными;
  - в ответе вернуть warning;
  - в UI показать мягкое предупреждение, не ошибку всего процесса.
7. **HTML email обязательно экранировать.**  
Все значения из профиля, продукта, тарифа, назначения платежа, суммы — через `escapeHtml`.
8. **Проверить mail-client fallback.**  
`backdrop-filter` в письмах почти нигде не работает. Основной вид должен держаться на обычных inline `background/border/padding`.
9. **PDF proof обязателен.**  
В отчёте приложить скрин/текстовую проверку, что:
  - дата появилась рядом с «г. Минск»;
  - `file_name_warnings` больше не содержит `FLD-000263`.
10. **Добавить regression для старых документов.**  
Сгенерировать/отправить не только pre-payment invoice, но хотя бы один обычный документ или проверить, что fallback не меняет их даты.
11. **DoD дополнить проверкой копирования.**  
В UI проверить:

- кнопка «Копировать» копирует точную строку;
- кавычек нет;
- toast появляется.

12. **Отчёт Lovable строго на русском.**

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

План: Красивое письмо со счётом, правильные заголовки/номер, дата в PDF, копируемое назначение платежа, Telegram
```

## Диагноз (что нашёл в коде и данных)

1. **Заголовок письма и «шаблон.» в теле** — в `supabase/functions/canonical-document-send/index.ts:296-306` тема и H2 берутся из `doc.title`, а `doc.title` в БД сохранён как `Шаблон. Счёт-акт на услуги ЮЛ - Исполнитель — ORD-26-00254` (записывается в `canonical-document-generate-strict/index.ts:1313-1315`: `${tpl.name} — ${order.order_number}`). Правильное имя уже лежит рядом в `doc.file_name` (`Счет-акт- АЖУР инкам - АЖУР инкам № 0407-4 от.pdf`).
2. **Номер счёта в UI-диалоге** — `InvoiceCheckoutDialog.tsx:415/427` печатает `result.invoice_number`, а `invoice-checkout-issue/index.ts:184-185` присваивает `invoice_number = orderNumber` (= `ORD-26-00254`, это номер сделки). Реальный номер счёт-акта хранится в `ai_generated_documents.document_number` (`0407/4`).
3. **Нет даты в PDF** — `ai_generated_documents.meta.file_name_warnings=[file_name_placeholder_unresolved:FLD-000263]`. `FLD-000263 = payment.paid_at` (проверил `fields_registry`), а оплаты ещё нет → значение null → дата пропадает и в PDF, и в имени файла. Нужен fallback: если pre-payment invoice — использовать `orders_v2.created_at`.
4. **Кавычки «…» вокруг «Оплата по счёту»** — в UI (`InvoiceCheckoutDialog.tsx:427`), в email HTML (`canonical-document-send/index.ts:304`) и в Telegram-caption (`canonical-document-send/index.ts:371`) назначение платежа обёрнуто в `«…»`. Пользователь просит убрать кавычки и дать копирование.
5. **Дата в назначении платежа расходится между UI и письмом** — UI использует `formatToday()`, письмо — `orderCreatedAt`. Могут быть разные строки.
6. **Telegram** — по последнему счёту `sent_to_telegram=7766693832` фактически записан в meta; audit-логов ошибки нет. Проверим ещё раз после правки. Причина, если не пришло: `docProfile.telegram_user_id` не привязан у покупателя. Добавим явный `results.telegram_error='telegram_not_linked'` + подсказку в UI.
7. **Стиль письма** — существующие auth-письма (`supabase/functions/_shared/email-templates/recovery.tsx` и т.д.) — React-Email компоненты. `canonical-document-send` — plain Deno-функция без React runtime. Проще всего вынести общий HTML-каркас в `supabase/functions/_shared/branded-email-shell.ts` (чистая строковая функция), стили-инлайн, палитра из `src/index.css` (тёмный/светлый фон карточки, стеклянная подложка, primary-акцент). Тот же каркас позже можно применить к остальным письмам без ломки существующих.

## Что делаем

### 1. `supabase/functions/_shared/branded-email-shell.ts` (новый)

Экспортирует `renderBrandedEmail({ preheader, greetingName, sections, footerNote })`, возвращает готовый HTML-строкой с:

- инлайновыми стилями в фирменной палитре (белый Body, «стеклянная» карточка `background:rgba(255,255,255,0.7); backdrop-filter:blur(20px); border:1px solid rgba(15,23,42,0.06); border-radius:20px; box-shadow:0 20px 60px -20px rgba(15,23,42,0.15)`),
- шапкой с названием бренда (Gorbova Club),
- слотами: приветствие, произвольные секции (title/text/table/callout), CTA-кнопка (опционально), подпись.
- Fallback на `background:#ffffff` для клиентов без `backdrop-filter` (Outlook/Gmail).

### 2. `supabase/functions/canonical-document-send/index.ts`

- Заменить `docTitle` источником: `displayTitle = (doc.file_name || '').replace(/\.pdf$/i,'').trim() || (doc.document_number ? \`Счёт-акт № ${doc.document_number} : 'Счёт-акт')`.
- Тема письма = `displayTitle` (без слова «Шаблон»).
- Собрать тело через `renderBrandedEmail` с содержимым:
  - Приветствие: `Добрый день, {full_name}!` (fallback «Здравствуйте!»).
  - Абзац: `Направляем вам счёт на оплату услуг «{product_name}»{, тариф {tariff_name}}. Сумма к оплате: {amount} {currency}.` Для этого в `canonical-document-send` подтянуть `orders_v2.final_price`, `orders_v2.currency`, join `products_v2.public_title` и `tariff_id → tariffs.name` (только те, что уже используются в диалоге, чтобы данные совпадали).
  - Callout «При оплате в назначении платежа укажите» — БЕЗ кавычек, в виде selectable `<pre style="user-select:all;font-family:inherit;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:14px 16px;">Оплата по счёту №0407/4 от 04.07.2026</pre>` + подпись «Нажмите на текст, чтобы выделить и скопировать».
  - Подпись: «С уважением, команда Gorbova Club».
- `paymentPurposeText`: вернуть без внешних кавычек (уже так и генерируется, оставляем строку без обрамления).
- В Telegram-caption заменить `«{purpose}»` на просто `<code>{purpose}</code>` (в Telegram HTML `<code>` даёт длинное нажатие → копирование).
- Для Telegram: если `!chatId` — вернуть `results.telegram_error='telegram_not_linked'` и записать явный audit `document.send.telegram_skipped_no_link` (уже почти так). Убедиться, что фронт видит статус (передаём в ответе).

### 3. `supabase/functions/invoice-checkout-issue/index.ts`

- После успешного strict-вызова прочитать `ai_generated_documents.document_number` по `documentId` и вернуть его в ответе как поле `document_number` (наряду с `invoice_number = orderNumber`, чтобы не ломать legacy-потребителей).
- Не менять существующее поле `invoice_number`, но добавить `document_number` и `issued_at = order.created_at`.

### 4. `src/components/payment/InvoiceCheckoutDialog.tsx`

- Расширить тип `InvoiceResult` полями `document_number: string | null` и `issued_at: string | null`.
- В экране «success» заменить строку заголовка на `Счёт № {result.document_number ?? result.invoice_number} сформирован`.
- Форматировать дату из `result.issued_at` (fallback `formatToday()`), чтобы совпадала с PDF и письмом.
- Убрать кавычки `«…»` вокруг «Оплата по счёту №…». Разместить строку в блоке с кнопкой «Копировать» (иконка `Copy` из lucide, `navigator.clipboard.writeText`, toast «Скопировано»). Сам текст сделать `select-all`.
- Оставить кнопку «Скачать PDF» и «Готово» без изменений.

### 5. Fallback даты счёта в PDF/имени файла

- В резолвере `FLD-000263` (payment.paid_at) в `canonical-document-generate-strict` (найти в `document-data-snapshot.ts`/`typed-tokens-resolver.ts` — где именно, определим на месте) добавить fallback: если значение null И `pre_payment_invoice=true` (или `order.status='draft'` и нет `payments_v2.status='paid'`) — вернуть `order.created_at`. Формат — как для остальных дат (DD.MM.YYYY).
- Проверить, что после правки `meta.file_name_warnings` больше не содержит `FLD-000263`, а в PDF рядом с «г. Минск» появляется дата справа.

### 6. Верификация

- Сгенерировать тестовый счёт через preview (авторизация паролем `123456`), скачать PDF, открыть письмо в тестовом ящике и убедиться:
  - Тема письма = `Счет-акт: АЖУР инкам - АЖУР инкам № 0407/5 от 04.07.2026`.
  - В теле нет «Шаблон.» и повторного заголовка.
  - Callout копируется, кавычек нет.
  - В PDF рядом с «г. Минск» — дата.
  - В UI-диалоге номер = `0407/5`, не `ORD-26-…`.
  - Telegram: если чат привязан — приходит подпись без кавычек, purpose в `<code>`; если не привязан — фронт показывает `telegram_error`.
- Скриншоты положить в `.lovable/proofs/invoice_email_polish_2026_07_04.md`.

### 7. Роадмап

Создать одну задачу «Красивое письмо-счёт: заголовок, номер 0407/x, дата в PDF, копируемое назначение, Telegram, HTML-стиль бренда», взять в `in_progress`, по завершении — `done` с логом.

## Технические детали

Файлы, которые правим:

- `supabase/functions/_shared/branded-email-shell.ts` — новый.
- `supabase/functions/canonical-document-send/index.ts` — subject/HTML/telegram caption, подтяжка order+product+tariff, использование shell.
- `supabase/functions/invoice-checkout-issue/index.ts` — вернуть `document_number` и `issued_at`.
- `supabase/functions/canonical-document-generate-strict/index.ts` (или shared token resolver) — fallback `FLD-000263 → order.created_at` для pre-payment invoice.
- `src/components/payment/InvoiceCheckoutDialog.tsx` — типы, отображение номера/даты, кнопка «Копировать», убранные кавычки.

Обязательные проверки:

- Grants/RLS не меняем (используем service role в edge-функциях).
- Существующие потребители `invoice_number` не ломаются (поле остаётся).
- Auth-письма (`_shared/email-templates/*.tsx`) не трогаем.
- Telegram HTML-parse_mode: экранируем текст `escapeHtml`, оборачиваем purpose в `<code>...</code>`.

Ограничения:

- Переименовывать сам шаблон в `canonical_templates` не будем — правим только отображение при отправке.
- Названия продукта/тарифа для письма берём из уже существующих таблиц; если каких-то полей нет — деградируем к тому, что есть, без падения.