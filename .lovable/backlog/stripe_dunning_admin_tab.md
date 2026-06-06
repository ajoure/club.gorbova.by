# Backlog: Stripe Dunning — Админ-вкладка «Проблема с оплатой»

## Контекст
Phase 3.4 Stage E. Отдельной админ-вкладки для Stripe-подписок в проекте нет (есть `BepaidSubscriptionsTabContent`, `AutoRenewalsTabContent`, но без Stripe-фильтра). Создание полноценной таблицы выходит за scope Phase 3.4 (риск дублирования с `AutoRenewalsTabContent`).

В Phase 3.4 минимум выполнен: `subscriptions_v2.meta.stripe.dunning_status` пишется резолвером — когорта `past_due_grace` доступна через JSON-фильтр для любого admin-инструмента.

## Объём отдельного PATCH
1. Расширить `AutoRenewalsTabContent` (или создать `StripeSubscriptionsTabContent`) фильтром «Проблема с оплатой»:
   - условие: `provider='stripe'` AND `subscriptions_v2.meta->stripe->>dunning_status = 'past_due_grace'`;
   - бейдж «Проблема с оплатой» (только русский, без «past_due» / «dunning» в UI);
   - колонки: клиент, продукт, тариф, сумма, валюта, `invoice_id`, `attempt_count`, дата следующей попытки, причина (читабельный перевод `last_failure_reason`).
2. Кнопка «Открыть подписку» → существующий `SubscriptionDetailSheet` (admin режим).
3. Кнопка «Отправить клиенту письмо для обновления карты»:
   - вызывает тот же шаблон, что и автоматический dunning (см. `stripe_dunning_email_template.md`);
   - требует, чтобы email-инфраструктура была настроена;
   - audit `stripe.dunning.notification_resent_manual` (actor = JWT админа).
4. Кнопка «Открыть управление подпиской» — Portal-link от лица админа:
   - текущий `stripe-create-customer-portal-session` проверяет `subscription.user_id = auth.uid()` → ownership guard;
   - НЕ обходить guard;
   - либо добавить отдельную ветку `admin_for_user: true` с проверкой `has_role('super_admin')` и audit `stripe.portal.admin_session_for_user`, либо оставить только саму ссылку клиенту через письмо.

## Acceptance
- G36 PASS: фильтр виден, корректно отдаёт когорту;
- бейдж и все строки UI на русском, без английских терминов;
- ownership guard не обойдён;
- proof перечисляет все добавленные строки UI.
