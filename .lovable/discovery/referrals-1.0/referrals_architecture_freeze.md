# План: архитектурная заморозка Referrals 1.0

Статус: **реализовано локально, production publish заблокирован до Lovable review**. Диагностика и GitHub-реализация выполнены от commit `9d158fa7599d0982657530819bdfa2f4bfcd5b13`, ветка `codex/referrals-diagnose`, GitHub `ajoure/club.gorbova.by`, Supabase ref `hdjgkjceownmmnrqqtuz`.

## Подтверждено кодом

- Контакт: `profiles.id`; `profiles.user_id` nullable, поэтому импортный профиль может не иметь кабинета.
- Коммерция: `products_v2`, `tariffs`, `tariff_offers`, `orders_v2`, `payments_v2`.
- Заказ уже содержит `profile_id`, `product_id`, `tariff_id`, `offer_id`, `final_price`, `paid_amount`, `currency`, `purchase_snapshot`, `meta`.
- Платёж уже содержит `order_id`, `profile_id`, `amount`, `currency`, `paid_at`, `is_recurring`, `refunded_amount`, `refunds`, provider IDs.
- Split-child распознаётся по `orders_v2.meta.split_from_order_id`; rebill — по `payments_v2.is_recurring` и renewal-контексту.
- События: `domain_events`; исполнения: `domain_executions`; аудит: `audit_logs`.
- RBAC: `useRbac()`, `useAdminAccess()`, каталог `ADMIN_SECTIONS`, таблица `role_admin_section_access`.
- Карточка контакта уже модульно подключает связанные вкладки; Referrals должен быть отдельным компонентом.

## Предварительно замороженная модель

`profiles` → `referral_partners` → `referral_relationships` → `referral_sale_attributions` → append-only `partner_point_transactions` + `partner_point_entries`.

Источник начисления — только серверная обработка подтверждённой коммерческой оплаты. React не рассчитывает комиссию и не пишет ledger. Возврат создаёт компенсационную проводку; исходная проводка не изменяется. Денежная выплата остаётся ручной, администратор только фиксирует её завершение.

## Неподтверждённые обязательные контракты

1. Фактические production catalogs, policies, grants, функции и список применённых миграций: Supabase MCP вернул `You do not have permission to perform this action`.
2. Единый canonical payment-success signal для всех writers: в коде есть несколько путей.
3. Единый canonical refund SoT: Stripe использует `record_refund_atomic`, bePaid также поддерживает `payments_v2.refunds`, отрицательные строки и reconcile queue.
4. Tenant scope: в generated types у основных сущностей scope-column не виден, но это требуется подтвердить production SQL.
5. Общий backend event/outbox writer с claim/retry/lease: текущий UI `DomainEventService` синхронный и не подходит для финансовой атомарности.
6. Generic notification delivery ledger для событий без заказа.
7. Фактический Lovable project ID отсутствует в README (`REPLACE_WITH_PROJECT_ID`).

## Бизнес-решения, требующие фиксации

- Рекомендуемый MVP: первый валидный referrer закрепляется при новой регистрации; существующий контакт автоматически не перепривязывается, но администратор может привязать его вручную с причиной.
- В устном запросе звучит «все последующие покупки», а master-ТЗ исключает rebill и допускает `first_commercial_payment_only`. До реализации надо выбрать: (A) комиссия за каждую новую отдельную покупку продукта, кроме rebill — рекомендовано; либо (B) только первая покупка приглашённого вообще.
- Устно заявлены рубли и 10%; master-ТЗ вводит points и обязательное разделение 60/40. Для простой версии рекомендовано показывать денежный эквивалент в RUB, но хранить неизменяемый ledger в minor units; 60/40 включать только если это действительно бизнес-правило.

## Граница публикации

Add-only DDL, RPC и UI подготовлены в GitHub с выключенными feature flags. Их нельзя применять в production до проверки Lovable Cloud: фактическая схема, payment/refund writers, migration dry-run, RLS и shadow reconciliation. Политика повторных покупок зафиксирована: каждая новая отдельная покупка учитывается, автоматическое продление — нет.
