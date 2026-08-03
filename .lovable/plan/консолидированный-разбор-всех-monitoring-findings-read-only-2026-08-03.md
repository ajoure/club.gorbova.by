# Консолидированный разбор всех monitoring findings (read-only, ничего не изменено)

Всего pending findings: 15 (10 из логов ошибок + 5 QA). Ниже — классификация по фактическому состоянию production и текущего кода на HEAD `22cc0df76`.

## Ключевой факт проверки свежести

За последние 168 часов в логах Postgres нет ни одного вхождения `uuid ~* unknown`, `jsonb ~~*`, `permission denied for function has_*`, `payment_type does not exist`. За 72 часа единственная 5xx на edge — `vochi-calls-poll` (502, вне scope этих findings). Cron `telegram-check-expired` (каждые 15 мин, 192 запуска за 48 ч) и `subscription-renewal-reminders` — все `succeeded`, ошибок `Revoke error` в логах нет.

## STALE — исправлено и подтверждено фактическим состоянием (7)

| Finding | Первопричина | Текущее состояние |
|---|---|---|
| training-assets-delete `jsonb ~~*` (09:38–09:43) | PostgREST `.or(...ilike...)` по jsonb | Код переписан (PR #261), функция задеплоена, dry_run без ошибок, новых логов нет |
| charge-reminders `subscriptions_v2.payment_type` | несуществующая колонка в select | В `_shared/run-charge-reminders.ts` `payment_type` отсутствует; cron 17 отрабатывает `succeeded` |
| FK `referral_partners_created_by_fkey` | FK без ON DELETE | В БД `confdeltype = SET NULL` (миграция 20260728181500) |
| FK `payment_reconcile_queue_matched_profile_id_fkey` | FK без ON DELETE | В БД `confdeltype = SET NULL` (миграция 20260729074915) |
| `permission denied for function has_permission/has_role` | отсутствовали EXECUTE-гранты | Гранты `authenticated`/`service_role` подтверждены, PUBLIC/anon без прав; новых ошибок нет |
| `uuid ~* unknown` при инвойсе / canonical-document-generate-strict | регексное сравнение uuid в объекте БД | На `ai_generated_documents` сейчас нет ни политики, ни триггера, ни check-констрейнта с `~*`; в логах чисто |
| Lead-кнопки на custom-domain (QA) | безусловная блокировка CTA в `HtmlIframePreview.tsx` | Исправление присутствует в опубликованном коде |

## EXCLUDED (1)

- amoCRM webhook `secret_not_configured` — интеграция не используется, исключена по решению владельца. Ничего не менять, finding не трогать.

## НЕ ПОДТВЕРЖДЁН, требует наблюдения (2)

- **telegram-revoke-access non-2xx** (8× 09:45–11:00 в старом окне). Cron-родитель отрабатывает `succeeded`, за 7 дней ни одной строки `Revoke error`. Скорее всего исчерпан вместе с исправлениями RBAC-грантов, но прямого прогона с реальными истёкшими подписками в окне не было.
- **external-document-form HTTP 502** (17× 26–27.07). За 7 дней у функции нет ни одного вызова, поэтому 502 не воспроизводится и не опровергается.

## Оставшиеся QA findings (3)

Bank-transfer invoice routing, отмена подписки для не-bePaid/Stripe, сохранение legacy payment-кнопки — исправления присутствуют в текущем опубликованном коде, новых событий после релиза нет. Классифицирую как stale-to-verify: закрывать только после ручного прохода соответствующих экранов.

## Предлагаемые действия (минимальный объём)

Кодовых патчей не требуется: ни один actionable дефект в текущем `main` не подтверждён. Предлагается только верификация без изменений.

1. **external-document-form** — безопасный синтетический smoke: один вызов действия `read` с заведомо несуществующим токеном. Ожидание: структурированный 4xx JSON, не 502. Реальные ссылки, отправки форм и вложения не трогаются.
2. **telegram-revoke-access** — read-only проверка логов после ближайших нескольких запусков cron `telegram-check-expired` (без ручного вызова revoke, без реальных банов).
3. **QA-тройка** — визуальная проверка desktop + mobile на опубликованном URL по соответствующим сценариям, без сохранения платёжных настроек и без создания заявок.
4. По результатам — пометить подтверждённые findings как `fixed`/`stale`, amoCRM оставить исключённым.

Если п.1 или п.2 покажет реальную ошибку — отдельный GitHub-first патч в новой ветке `codex/<scope>`, тест, деплой только затронутой функции; миграции не предполагаются.

## STOP-условия

- Любое расхождение HEAD/опубликованного SHA — остановка.
- Появление в логах `502` у `external-document-form` или `Revoke error` — остановка, отчёт, отдельный PLAN.
- Любое действие, затрагивающее реальные документы клиентов, реальные баны Telegram, платежи, возвраты, рассылки, роли или amoCRM — запрещено.
- Никаких миграций, Publish и правок данных в рамках этой верификации.
