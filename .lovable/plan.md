# Placewash — расширенная санитизированная диагностика идентичности (PLAN-ONLY, READ-ONLY)

## Итог: NOT_FOUND по всем слоям (0 реальных совпадений). Изменений не вносилось.

## Что искалось
Регистронезависимо, с нормализацией разделителей и транслитерации:
`placewash`, `place wash`, `place-wash`, `place_wash` (покрыто маской `%place%wash%`),
кириллица `плейс*` / `вош*` (покрыто масками `%плейс%`, `%вош%`).
Поиск шёл по всей строке (`row::text`), то есть включая все текстовые поля, `jsonb`/`json`
(metadata, meta, config, conditions, deletion_context), внешние/провайдерские идентификаторы,
source/label поля и импортные журналы — а не только по «имени».

## Слои и результат

| Слой | Проверенные объекты | Результат |
|---|---|---|
| Код / конфиг / документация | весь репозиторий (rg, включая скрытые файлы, docs, supabase/functions, миграции) | NOT_FOUND (0 совпадений по `place…wash`) |
| Продукты и тарифы | products, products_v2, tariffs, tariff_offers | NOT_FOUND |
| Заказы и сделки | orders, orders_v2 | NOT_FOUND |
| Платежи | payments_v2, payments_legacy_archive, payment_links | NOT_FOUND |
| Подписки | subscriptions, subscriptions_v2 | NOT_FOUND |
| Компании и контакты | companies, company_external_ids, company_contacts, company_notes, profiles | NOT_FOUND |
| Доступы | entitlements, entitlement_sources, access_rules | NOT_FOUND |
| Telegram | telegram_bots, telegram_clubs, telegram_messages | NOT_FOUND |
| Интеграции / настройки | integrations, integration_instances, app_settings, import_jobs | NOT_FOUND |
| CRM / контент / сайт | crm_activity_log, content, app_sections, site_pages, site_form_submissions | NOT_FOUND |
| Аудит | audit_logs | NOT_FOUND |

## Ложные срабатывания (для полноты, не Placewash)
- `companies`, masked id `744615f9…`, поле `full_name`: содержит подстроку «…плейс» в составе другого слова.
- `tariff_offers`, masked id `0fb61b3b…`, поле `meta`: значение «Маркетплейсы».
- `site_pages`, masked id `64684f09…`, поле `blocks`: подстрока `wash` внутри случайной base64-строки.

Ни одно из трёх не является сущностью Placewash; различающий признак — отсутствие пары
`place`+`wash` как отдельного токена и отсутствие связанных product/tariff/order/payment записей.

## Вывод об идентичности
Placewash не является ни сущностью данных, ни интеграцией, ни source/provider-меткой,
ни компонентом кода в каноническом production. Это внешнее по отношению к системе имя
(вероятно название организации/проекта заказчика, ещё не заведённое, либо имя из другого контура).

## Минимальный недостающий идентификатор
Без одного из перечисленного дальнейший поиск невозможен (нужен ровно один):
1. УНП/регистрационный номер компании, либо
2. точное юридическое наименование в том написании, в каком оно заведено (кириллица), либо
3. номер заказа / номер платежа (ORD-…/INV-…), либо
4. дата+сумма+валюта платежа (окно ±2 дня), либо
5. внешний id из внешней системы (amoCRM/GetCourse/провайдер эквайринга).

## Как безопасно проверить цепочку payment → order/deal → contact/company → entitlement → Telegram
Без реального платежа, реального пользователя и без отправки сообщений:
1. Только чтение по идентификатору из списка выше: `payments_v2` → `orders_v2` (по `order_id`)
   → `company_order_links`/`profiles` → `entitlements` + `entitlement_sources`
   → `telegram_access_grants` / `telegram_access_audit`. Каждый шаг — SELECT, счётчики и статусы.
2. Компонент, отвечающий за цепочку: Edge Function `grant-access-for-order` → `telegram-grant-access`
   (канонический единственный путь выдачи), зеркало в `telegram_messages` только для UI админа.
3. Для проверки конфигурации без денег: dry-run котировки оффера (`quote`) и чтение
   `payment_reconcile_queue` в режиме dry-run — оба не создают заказ, платёж и доступ.
4. Синтетика при необходимости: скрытый тариф `is_public=false` и QA-контакт, с обязательным
   удалением после проверки; реальные списания и Telegram-сообщения не используются как smoke.

## Блокеры
Нет технических блокеров; блокирует только отсутствие идентификатора (см. раздел выше).
