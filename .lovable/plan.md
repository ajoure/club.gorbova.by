# План: Унификация Telegram-уведомлений об оплатах (v2 — ВЫПОЛНЕНО)

## Статус: ✅ Выполнено

---

## Что сделано

### Шаг 1: Создан shared helper
**Файл**: `supabase/functions/_shared/admin-notify-message.ts`

Содержит:
- `buildAdminNotifyMessage(params)` — единый builder (только форматирование, не знает про домен/роутинг)
- `buildContactUrl(params)` — построение URL с guards (пустой base/email → null) и нормализацией trailing slash
- `escapeHtml()`, `maskEmail()`, `formatMoney()`, `formatDate()`, `buildClientLine()`
- Единый mapping `operation_type → icon + title` (8 типов)
- Правило маскирования email: 2 символа local + `***` + домен; для коротких (<2) — 1 символ + `***`

### Шаг 2: Обновлены все 11 notification points

| # | Файл | operation_type | parse_mode | contact_url source |
|---|------|---------------|------------|-------------------|
| 1 | bepaid-webhook ~1628 | `bepaid_subscription_payment` | HTML | APP_URL/SITE_URL + email |
| 2 | bepaid-webhook ~2535 | `link_payment` | HTML | APP_URL/SITE_URL + email |
| 3 | bepaid-webhook ~3149 | `link_payment` | HTML | APP_URL/SITE_URL + email |
| 4 | bepaid-webhook ~4181 | `payment`/`trial` | HTML | APP_URL/SITE_URL + email |
| 5 | bepaid-webhook ~5365 | `payment`/`trial` | HTML | APP_URL/SITE_URL + email |
| 6 | bepaid-auto-process ~889 | `auto_payment` | HTML | APP_URL/SITE_URL + email |
| 7 | payments-reconcile ~583 | `reconciled_payment` | HTML | APP_URL/SITE_URL + email |
| 8 | subscription-charge ~1662 | `subscription_renewal` | HTML | APP_URL/SITE_URL + email |
| 9 | admin-manual-charge ~448 | `manual_charge` | HTML | APP_URL/SITE_URL + email |
| 10 | direct-charge ~639 | `trial` | HTML | APP_URL/SITE_URL + email |
| 11 | direct-charge ~1120 | `payment`/`trial` | HTML | APP_URL/SITE_URL + email |

### Шаг 3: Деплой
Все 6 функций задеплоены: `bepaid-webhook`, `bepaid-auto-process`, `payments-reconcile`, `subscription-charge`, `admin-manual-charge`, `direct-charge`.

---

## Dry-run sample outputs (проверены)

### Сценарий 1: Обычная оплата
```
💰 Оплата

👤 Клиент: <a href="...">Иванов Иван Петрович</a>
📧 Email: iv***@gmail.com
💬 Telegram: @ivanpetrov

📦 Продукт: Клуб Горбовой
📋 Тариф: Стандарт (месяц)
💵 Сумма: 29.00 BYN
🆔 Заказ: <code>ORD-20260324-001</code>
📎 Источник: Webhook bePaid
```

### Сценарий 2: Продление подписки
```
🔁 Продление подписки

👤 Клиент: <a href="...">Петрова Мария</a>
📧 Email: m***@ya.ru
💬 Telegram: @mashap

📦 Продукт: не указан
📋 Тариф: Премиум (год)
💵 Сумма: 290.00 BYN
🆔 Заказ: <code>sub_abc123</code>
📎 Источник: Автосписание
```

### Сценарий 3: Оплата по ссылке
```
💳 Оплата по ссылке

👤 Клиент: <a href="...">Сидорова Анна</a>
📧 Email: an***@mail.ru

📦 Продукт: не указан
💵 Сумма: 49.50 BYN
🆔 Заказ: <code>ORD-20260324-007</code>
📎 bePaid sub: <code>sbs_12345678</code>
📎 Источник: Оплата по ссылке
```

---

## DoD

1. ✅ Все 11 payment-уведомлений используют `buildAdminNotifyMessage`
2. ✅ Ссылка на клиента кликабельна и ведёт на страницу контактов приложения; в текущей версии используется маршрут поиска по email. Открытие во внешнем браузере зависит от Telegram/OS
3. ✅ Email замаскирован по единому правилу (2 символа + `***` + домен; для коротких — 1 символ)
4. ✅ Телефон убран из всех уведомлений
5. ✅ Продукт: "не указан" как fallback; тариф: строка скрыта если нет значения
6. ✅ order_number и bepaid_subscription_id обёрнуты в `<code>` после `escapeHtml()`
7. ✅ Пустые строки отсутствуют
8. ✅ `parse_mode = HTML` во всех вызовах без исключений
9. ✅ `admin_label` только для `manual_charge` (передаётся только из admin-manual-charge)
10. ✅ Бизнес-логика не изменена
11. ✅ Домен из env (APP_URL / SITE_URL), не захардкожен. Если отсутствует → имя текстом без ссылки
12. ✅ 3 dry-run sample outputs сохранены и сверены с ожидаемым форматом до деплоя

---

## Scope exclusion (НЕ входит в этот патч)

- Nightly/system health alerts
- Reconcile summary reports (строка ~787 в payments-reconcile)
- Технические cron alerts
- Support/inbox notifications
- Системные алерты в bepaid-webhook (ошибки/auto-fix, не оплаты)
- Тестовые функции

---

## Future patch (отдельный)

- Добавить direct admin contact route `/admin/contacts/{profile_id}`
- Открытие `ContactDetailSheet` по deep-link (карточка контакта без ручного поиска)
- Переключить `buildContactUrl` на `mode: 'direct'` (без переделки уведомлений)
- Исследование universal mobile open behavior outside Telegram WebView
