Настройки интеграций доступны только super_admin. Ранее право сотрудника на управление платежами открывало конфигурацию почты, Telegram и других подключений через общее entitlements.manage. Теперь интерфейс, таблицы конфигурации и серверные действия используют отдельную проверку владельца; рабочие платежи, переписка, участники и видео сохраняют предметные права.

Изменения:
- Канонический useAdminAccess закрывает integrations до admin/kill-switch bypass.
- Managed migration 20260910181807_integration_owner_boundary.sql: restrictive owner policies на 9 таблиц конфигурации (включая integrations для VOCHI/WebSMS), запрет non-owner writes в telegram_clubs, отзыв anon/PUBLIC и authenticated TRUNCATE. Обычный SELECT клубов сохранён. Глобальный entitlements.manage не меняется.
- Четыре authenticated RPC возвращают фиксированные operational поля: боты без токена/ошибки, почтовые отправители без SMTP реквизитов, подключение bePaid с allowlist полей карточки, Stripe с валютами, Kinescope только с идентификатором/статусом. Нет raw config/config_secrets/secrets. Соответствующие рабочие UI переведены на RPC; интерфейсы настройки владельца сохраняют доступ к исходным таблицам.
- Owner guards: telegram-bot-actions, integration-healthcheck, email-test-connection, hosterby-api, instagram-webhook-test, manychat-discover-pages, telegram-bot-rights-check; configuration path kinescope-api. Integration/getcourse/amocrm sync допускают owner или существующий exact internal service credential. Email fetch сохраняет серверный worker и сотрудников с communication/contacts edit; test-only требует owner/internal.

Проверки подготовки: TypeScript и production build PASS; полная серия 1558 тестов PASS и 28 целевых тестов авторизации/контрактов после их расширения. Изолированный PostgreSQL: 340 assertions PASS, точная миграция применена дважды, anon/user/staff/admin не читают и не меняют конфигурацию, owner/service CRUD работает, проекции не возвращают синтетические секреты. Это не production-проверка и не проверка реального устройства.

Повторяемая SQL-проверка: scripts/verify-integration-owner-boundary.mjs принимает путь к @electric-sql/pglite@0.5.8/dist/index.js. Зависимость установлена только во временном каталоге проверки, зависимости приложения не менялись.

Lovable plan-only и консолидированная ревизия выполнены 10.09.2026. Подтверждены canonical main a604f886, Lovable Cloud, 2 назначения super_admin; safe views security_invoker, acquiring secret getter service-only, vault mutation RPC owner-only. Отсутствие draft SHA в main ожидаемо. Исторические права на membership/переписку остаются отдельными от конфигурации.

До завершения: GitHub checks, exact merged SHA, применение только указанной миграции и deploy только перечисленных изменённых функций через Lovable, read-back grants/policies/функций и неизменности 2 super_admin, безопасный runtime owner/staff/anon, повтор security scan. Publish только после PASS. После Publish — проверки рабочего UI на ПК и 390×844 с привязкой к URL/версии. Никакие реальные письма, платежи, возвраты, отмены или создания пользователей не являются smoke-тестом. Миграция не изменяет строки клиентов, платежей или доступов.

На момент подготовки production migration/deploy/Publish не выполнялись.
