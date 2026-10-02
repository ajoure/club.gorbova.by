# Реферальная выдача продуктов: контракт и production-gate

Scope: созревание начислений и отображение обеих частей баланса; администраторская корзина продуктов/тарифов/сроков; добровольная cash-конвертация; подарок компании; независимые entitlement_sources; журнал и отмена; внешние проекции Telegram через outbox. GetCourse в этом сценарии не выдаётся: его API сделки не гарантирует произвольный конечный срок; интерфейс явно сообщает «доступ в нашем приложении». Обычный GC-grant для REF-заказов возвращает skipped.

GitHub-first. Production принадлежит Lovable Cloud (796a93b9-74cc-403c-8ec5-cafdb2a5beaa). Аудит PLAN-ONLY и консолидированная ревизия выполнены в каноническом чате 02.10.2026. До execute дополнительно сверить контракт миграции с actual production DDL.

## Уточнение архитектуры

Вместо подписанного передаваемого клиентом JSON используем закрытую серверную таблицу quotes: криптографически случайный quote_id, привязка к actor, неизменяемый request/snapshot, TTL 10 минут, row lock и consumed_at. Клиент не может читать/изменять таблицу и commit принимает только ID. Расчёт не резервирует и не списывает средства. Это небольшая техническая запись, не финансовая операция. Commit заново строит snapshot каталога/баланса/доступов/резерваций/выплат/прав; изменение снимка даёт quote_stale; каталог блокируется FOR SHARE во время commit, все ledger writers используют общий partner lock. Повтор commit возвращает ту же операцию.

Новые granular permissions не используют legacy section fallback. Выдаются admin/super_admin, делегируются существующим редактором role_permissions. Цена в копейках; recurring monthly = amount × календарные месяцы. Другие периоды требуют явной цены и override_catalog. Годового тарифа по умолчанию не создаём.

Денежные суммы заказа = 0, платежи не создаются. Стоимость, источник бонусов и подарок компании хранятся в журнале redemption. referral_process_order явно исключает financial_kind=referral_redemption. Pipeline/stage не задаются; production preflight подтвердил, что соответствующие триггеры пропускают NULL. Обычный grant-access-for-order отклоняет REF-заказ, notify-order-purchased пропускает его. Проверки prior_purchase не считают нулевую REF-запись оплатой. Уведомления клиентов не отправляются.

Reversal всегда отзывает только собственные sources и возвращает исходные internal/cash. Подарок не превращается в выводимый бонус. Если доступ начался — отдельное явное решение администратора об отмене использованного доступа, с причиной. Другие доступы и provider subscriptions сохраняются. Вторичные продукты и finite Club grants представлены собственными sources, ограниченными родительским сроком; scope исторических модулей переносится в runtime aggregate. Отмена/expiry отзывает эти sources атомарно. Outbox последовательно обрабатывает события одной позиции и проверяет lease attempt перед завершением.

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

## Scheduler и exact-SHA deploy manifest

20261002121046_referral_redemption_scheduler.sql создаёт только выделенный Vault secret, защищённые verify/invoke wrappers и **выключенный** cron `referral-redemption-every-minute`. Ни секрет, ни service key не попадают в cron.job.command. Worker по умолчанию dry_run; cron после явного enable выполняет batches по 20: безопасное maturity, tick, outbox. Созревание не создаёт referral events/уведомления, сверяет pending-проводки с original rule_snapshot и проверяет отражение уже записанных возвратов в reversed_minor. Аномальные/paused записи остаются в manifest.

Read-only preflight 02.10.2026: 3 due записи, cash 125800 minor, internal 188700 minor; 0 возвратов/аномалий. Перед исполнением повторить SELECT/manifest; изменившийся count/split — STOP и новый dry-run.

Deploy после merge — перечисленные функции из точного SHA (изменение shared helpers требует пересборки зависимых функций):
- `access-rules-nightly-reconcile`
- `bepaid-get-subscription-details`
- `cancel-trial`
- `getcourse-grant-access`
- `grant-access-for-order`
- `live-event-notifications-cron`
- `live-resolve`
- `live-token-validate`
- `notify-order-purchased`
- `public-product`
- `public-product-by-slug`
- `referral-redemption-worker`
- `rules-retroapply`
- `sales-runtime-control`
- `sales-runtime-worker`
- `subscription-admin-actions`
- `subscription-charge`
- `subscription-grace-reminders`
- `subscriptions-reconcile`
- `telegram-check-expired`
- `telegram-club-members`
- `telegram-cron-sync`
- `telegram-grant-access`
- `telegram-kick-violators`
- `telegram-process-access-queue`
- `telegram-reinvite-ghosts`
- `telegram-revoke-access`
- `telegram-webhook`

Применить обе named migrations. Затем schema/grants read-back, SQL runtime transaction-rollback smoke без реальных денежных операций, worker unauthorized + dry_run и expected manifest. Бounded maturity только при совпадении manifest; read-back buckets/transactions и repeat=0. После этого enable существующего cron, проверить command без secret, job run и 0 ошибок. Publish только при всех PASS; screenshots desktop/mobile по опубликованному URL без PII. Реальную клиентскую выдачу не использовать для smoke.
