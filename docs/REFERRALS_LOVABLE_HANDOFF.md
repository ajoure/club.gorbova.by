# План: публикация Referrals 1.0 через Lovable

GitHub содержит подготовленный add-only пакет. До публикации production-флаги выключены.

## Что должен сделать Lovable

1. Сверить production catalogs проекта `hdjgkjceownmmnrqqtuz` с миграцией `20260721181043_referrals_v1_core.sql`.
2. Особо подтвердить `orders_v2`, `payments_v2`, `profiles`, `audit_logs`, `domain_events`, `admin_section`, `has_role_v2` и `update_updated_at_column`.
3. Применить миграцию в preview/branch окружении, не в production.
4. Сгенерировать свежие TypeScript types и заменить repository types отдельным коммитом.
5. Выполнить `supabase/tests/referrals_v1_contract.sql`, security/performance advisors и RLS-проверки owner/admin/foreign user.
6. Проверить Stripe, bePaid, RR и manual payment fixtures: отдельная покупка создаёт одну комиссию, rebill не создаёт комиссию.
7. Проверить partial/full refund, legacy negative refund rows и повтор одного provider event.
8. Открыть `/r/{partner_code}`, завершить новую регистрацию в течение 60 дней и подтвердить first-referrer-wins.
9. Подтвердить, что уже существующий профиль не может самопривязаться по ссылке (`existing_profile_requires_admin`).
10. Включить только `is_enabled`, `tracking_enabled`, `partner_portal_enabled`, оставив `shadow_mode=true` и `accrual_enabled=false`.
11. Выполнить `referral_reconcile_orders(...)` сервисной ролью и сверить покупки, совершённые после `enabled_at`, но до первой привязки/авторизации реферала.
12. После shadow reconciliation отдельно согласовать включение реальных начислений.

## Что Lovable не должен делать

- не создавать второй contact/order/payment/refund контур;
- не начислять за `payments_v2.is_recurring=true`;
- не включать реальные начисления сразу после миграции;
- не создавать production seed data;
- не переписывать или удалять ledger-записи;
- не выполнять выплаты автоматически;
- не добавлять правило 60/40 без отдельного решения владельца.

## Принятые бизнес-правила

- базовая валюта: `BYN`;
- комиссия: 10%;
- каждая новая отдельная покупка приглашённого учитывается;
- автоматические продления не учитываются;
- первый валидный реферер закрепляется постоянно;
- регистрационная ссылка действует 60 дней, а время её открытия передаётся в RPC и проверяется сервером;
- существующий контакт привязывается вручную администратором с причиной;
- баланс единый, без внутреннего/денежного разделения 60/40;
- выплата ручная, после неё администратор нажимает «Погасить» и указывает подтверждение.
