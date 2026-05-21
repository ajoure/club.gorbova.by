---
name: Cabinet Documents Canonical SOT
description: «Мои покупки» в личном кабинете — единый источник документов = canonical pipeline (ai_generated_documents) + bePaid receipt_url. Legacy generate-invoice-act/send-invoice/generated_documents — deprecated в UI.
type: feature
---

## Источники истины

| Сущность               | SOT                                                                 |
|------------------------|----------------------------------------------------------------------|
| Сгенерированный документ (счёт-акт, акт) | `ai_generated_documents` (writer: `canonical-document-generate-strict`). Фильтр по заказу: `context_type='order' AND context_id=order_id`. |
| Чек платежа (фискальный) | `payments_v2.receipt_url` или `provider_response.transaction.receipt_url` (от bePaid). Только для `status='succeeded'`/`failed`. |
| Файл PDF              | `ai_generated_documents.storage_bucket` + `file_path`. Скачивание ТОЛЬКО через edge `document-download` (blob, не *.supabase.co URL в UI). |

Legacy `generated_documents` НЕ показывается пользователю в `/purchases`; используется только для admin-аудита Sprint 12.

## Каноническая отправка

`canonical-document-send` (idempotent):
- Вход: `{ document_id, send_email?, send_telegram? }` (JWT-only, document_id-only).
- Email: `send-email` с PDF attachment (multipart/mixed).
- Telegram: `sendDocument` через Bot API (PDF файлом). НИКОГДА `sendMessage` для документов.
- НЕ создаёт новый документ и НЕ расходует номер. Если файла нет → 404, клиент должен сначала позвать `canonical-document-generate-strict`.
- Payment-guard: если `context_type='order'`, проверяет наличие `orders_v2.status='paid'` + `payments_v2.status='succeeded'`. Иначе 422 + audit `document.send_blocked_no_payment`.
- Owner-check: либо `profile.user_id = caller`, либо elevated (`super_admin/admin/accountant`).
- Audit: `document.sent.email`, `document.sent.telegram`, `document.send_failed`, `document.send_blocked_no_payment`.

## UI правила в `/purchases`

1. **Авто-генерация при открытии страницы запрещена.** Если документа нет — рендерится кнопка «Сформировать документ» (одноразовый вызов `canonical-document-generate-strict` с idempotency_key).
2. **Preview не расходует номер.** Превью = скачивание уже существующего PDF. Если документа ещё нет — показывается кнопка «Сформировать», а не превью.
3. **Кнопка «Документы» только при реальной оплате** (`order.status='paid'` + `payments_v2.length>0`). Виртуальные/manual сделки → секция документов скрыта.
4. **bePaid-чек** — отдельная кнопка/ссылка, только при наличии `receipt_url`.
5. **Виртуальная квитанция** (`receiptGenerator.ts`) — скрыта если есть `receipt_url` (это эквайринг). Видна только для безналичных/рассрочечных сценариев без эквайринга.
6. **Telegram-отправка** — всегда PDF файлом, не текст. Если у юзера нет `telegram_user_id` → ошибка `telegram_not_linked`.

## Deprecated edge functions (UI больше не вызывает)

- `generate-invoice-act`
- `send-invoice`
- `generate-document-pdf`

Backlog на физическое удаление: `.lovable/backlog/remove_legacy_invoice_act_functions.md`.
