# Реферальная выдача продуктов: контракт и production-gate

Scope: созревание начислений и отображение обеих частей баланса; администраторская корзина продуктов/тарифов/сроков; добровольная cash-конвертация; подарок компании; независимые entitlement_sources; журнал и отмена; внешние проекции через outbox.

GitHub-first. Production принадлежит Lovable Cloud (796a93b9-74cc-403c-8ec5-cafdb2a5beaa). Аудит PLAN-ONLY и консолидированная ревизия выполнены в каноническом чате 02.10.2026. До execute дополнительно сверить контракт миграции с actual production DDL.

## Уточнение архитектуры

Вместо подписанного передаваемого клиентом JSON используем закрытую серверную таблицу quotes: криптографически случайный quote_id, привязка к actor, неизменяемый request/snapshot, TTL 10 минут, row lock и consumed_at. Клиент не может читать/изменять таблицу и commit принимает только ID. Расчёт не резервирует и не списывает средства. Это небольшая техническая запись, не финансовая операция. Commit заново строит snapshot каталога/баланса/доступов/резерваций/выплат/прав; любое изменение даёт quote_stale. Повтор commit возвращает ту же операцию.

Новые granular permissions не используют legacy section fallback. Выдаются admin/super_admin, делегируются существующим редактором role_permissions. Цена в копейках; recurring monthly = amount × календарные месяцы. Другие периоды требуют явной цены и override_catalog. Годового тарифа по умолчанию не создаём.

Денежные суммы заказа = 0, платежи не создаются. Стоимость, источник бонусов и подарок компании хранятся в журнале redemption. referral_process_order явно исключает financial_kind=referral_redemption. Pipeline/stage не задаются — purchase automations не запускаются. Уведомления клиентов не отправляются.

Reversal всегда отзывает только собственные sources и возвращает исходные internal/cash. Подарок не превращается в выводимый бонус. Если доступ начался — отдельное явное решение администратора об отмене использованного доступа, с причиной. Другие доступы и provider subscriptions сохраняются.

## Stop guards

- Точный merged SHA; ни одного создания кода/миграций/коммитов Lovable.
- Неподтверждённый DDL/enum/RLS, несогласованный scope, неожиданный rowcount или critical finding — STOP.
- Registered account required; legacy entitlement без независимого источника требует reconcile.
- Recurring marker показывается с явным подтверждением сохранения подписки; live provider status нельзя выдавать за подтверждённый по БД. Отмена подписки не входит в этот release.
- Реальные бонусы/доступы Глуховской не списывать/выдавать. Конвертация только с доказуемым согласием клиента.
- До запуска фонового созревания: SELECT dry-run количества due комиссий, remaining/split и refund/reversal; согласованный count manifest, batches и read-back. Никаких уведомлений.
- Миграция схемы сама не запускает созревание и не создаёт cron. Cron enable — отдельный exact-SHA managed шаг после тестов и dry-run.

## Приёмка

SQL runtime fixtures: insufficient funds, permissions, consent, provider warning, changed balance/catalog/access, replay, multi-item rollback, shared payout/reservation locking, finite/future access, expired sources, source-specific reversal and split recovery, no payment/commission/events.
Production: schema/RLS/grants read-back; безопасный quote read-back; функции 401/403 и dry-run; no mutation smoke на клиенте; cron dry-run/read-back; actual URLs/merged SHA; desktop/mobile proof без персональных данных; клиентское отображение происхождения.
