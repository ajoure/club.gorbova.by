# Backlog: Stripe Dunning — Email Template (PATCH after Phase 3.4)

## Контекст
Phase 3.4 Stage D зафиксировал: канонической Lovable-инфраструктуры app emails (`send-transactional-email`, `enqueue_email`, `_shared/transactional-email-templates/`) в проекте нет. Реализация Phase 3.4 пишет audit-only `stripe.dunning.notification_skipped_no_email` вместо отправки письма.

## Объём отдельного PATCH
1. Проверить статус email-домена (`email_domain--check_email_domain_status`).
2. Если домен не настроен — `<presentation-open-email-setup>`.
3. Вызвать `email_domain--setup_email_infra` (создаёт pgmq, RPC, `process-email-queue`, vault).
4. Вызвать `email_domain--scaffold_transactional_email` (создаёт `send-transactional-email`, `handle-email-unsubscribe`, `handle-email-suppression`, шаблоны и registry).
5. Создать шаблон `supabase/functions/_shared/transactional-email-templates/stripe-payment-failed.tsx`:
   - тема: «Платёж по подписке не прошёл — обновите карту»;
   - preview: «Доступ пока сохранён. Обновите карту, чтобы продолжить.»;
   - тело (только русский): объяснение, дата следующей попытки (`next_payment_attempt`), CTA-кнопка «Обновить карту в Stripe» → ссылка на Customer Portal;
   - запрещены: своя форма карты, сбор PAN, любые упоминания «Portal», «Dunning», «Past Due», «Recovery» в видимом тексте.
6. Зарегистрировать в `_shared/transactional-email-templates/registry.ts`.
7. В `onInvoicePaymentFailed` (резолвер) при первой неудаче (`prev.last_failed_invoice_id !== invoice_id`) вызывать:
   ```
   supabase.functions.invoke('send-transactional-email', {
     body: {
       templateName: 'stripe-payment-failed',
       recipientEmail: ...,
       idempotencyKey: `stripe-dunning-${invoice_id}`,
       templateData: { next_payment_attempt, portal_link_token, ... },
     },
   });
   ```
8. Любая ошибка отправки — audit `stripe.dunning.notification_send_failed` с причиной, webhook возвращает 200 как сейчас (failure email НЕ должен ронять `provider_events.processing_status`).

## Acceptance
- G34 PASS: уведомление отправлено, `email_send_log` содержит строку с `template='stripe-payment-failed'`;
- replay того же event_id → дубля нет (idempotencyKey);
- видимый текст письма — только русский, без английских терминов;
- ссылка ведёт ТОЛЬКО в Stripe Customer Portal, своих форм карты нет.
