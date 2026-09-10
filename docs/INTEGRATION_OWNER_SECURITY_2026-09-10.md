# Настройка интеграций: только super_admin

Статус: подготовлено частичное исправление кода; **не merge / не deploy** до
канонической Lovable plan-only ревизии и завершения защиты БД.

## Явное требование пользователя

Настройка подключений доступна только суперадминистратору. Сотрудники могут
работать с уже настроенными платежами, перепиской и участниками по собственным
разрешениям. Ключи, токены, изменение подключений им недоступны.

## Подготовлено

- Канонический useAdminAccess закрывает секцию и ресурсы integrations для
  всех, кроме super_admin, до admin/kill-switch bypass. Это применяется к меню
  и AdminRouteGuard. Отдельный маршрут участников клуба остаётся club-members.
- telegram-bot-actions: has_role_v2(super_admin) вместо entitlements.manage.
- integration-healthcheck: каноническая роль super_admin вместо legacy роли.
- email-test-connection: проверка super_admin до чтения настроек/пароля и
  сетевого обращения. Раньше функция ограничивалась проверкой аутентификации.
- Тесты: обычный сотрудник, admin, делегированные manage-права, выключенный
  общий section-gating, super_admin; неизменность operational маршрутов.

## Обязательно закончить перед выпуском

1. Read-only через Lovable: текущие pg_policies/grants/RPC и все endpoints
   настройки. Число super_admin и штатная идентичность владельца — без ПД.
2. Разделить configuration/secret tables и operational selectors:
   integration_instances, integration_credentials, email_accounts,
   telegram_bots, payment_settings, acquiring settings и остальные фактически
   используемые источники. Не переписывать общий entitlements.manage: это
   сломает легитимную работу с платежами и доступами.
3. Подготовить узкую managed миграцию: полный доступ к конфигурации только
   super_admin. Не просто добавить permissive policy: они складываются OR.
4. До запрета чтения исходных таблиц перевести operational selectors на
   существующий или проверенный безопасный read-model без секретов. Например,
   useAcquiringProfiles читает весь config, в то время как ему нужны только
   shop_id/test_mode; useTelegramClubs содержит join к telegram_bots.
   email_accounts_safe / telegram_bots_safe сейчас security_invoker — запрет
   исходной таблицы автоматически затронет и их. Не менять их на безусловные
   definer views ради обхода RLS.
5. Проверить все остальные server-side configuration actions. Ни UI-патч,
   ни три изменённых endpoint не закрывают весь периметр сами по себе.
6. Ролевая матрица БД: anon/staff payments-only/admin/super_admin; deny secrets
   и writes для первых трёх, корректная работа сотрудника с платежами и
   сообщениями, service-role backend без изменения механизма авторизации.
7. GitHub PR/checks, exact merged SHA, только названные migrations/functions
   через Lovable, read-back, security PASS, Publish, ПК+mobile на live.

## Блокер текущего исполнения

Встроенный браузер на продолжении задачи не предоставлен инструменту
(Browser is not available: iab). Чтение проекта Lovable работает; отправка
PLAN-ONLY через connector дважды отклонена INVALID_ARGUMENT. История
проверена: новое сообщение не принято. open_in_codex вернул queued, не факт
открытия. Сторонний Chrome не использовался. Прямой доступ к production
Supabase, новые сессии, ослабление прав/авторизации не применялись.

Этот PR не содержит миграций и не исправляет production RLS сам по себе.

## Локальные проверки

231 тестовый файл / 1546 тестов PASS; TypeScript и production build PASS.
Это локальные проверки, не проверка production RLS или опубликованного UI.
