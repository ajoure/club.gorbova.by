/**
 * Централизованный словарь подсказок
 * Единый источник правды для всех текстов помощи
 * Подготовлен под мультиязычность
 */

export interface HelpText {
  short: string;
  full?: string;
  link?: string;
}

export const helpTexts: Record<string, HelpText> = {
  // === Клиенты ===
  "clients.search": {
    short: "Поиск клиентов",
    full: "Поиск осуществляется по e-mail, телефону и имени. Введите минимум 2 символа для поиска.",
    link: "/help#clients"
  },
  "clients.impersonate": {
    short: "Войти как пользователь",
    full: "Позволяет войти в систему от имени клиента для диагностики проблем. Все действия логируются.",
    link: "/help#admin-impersonate"
  },
  "clients.status": {
    short: "Статус клиента",
    full: "Active — активен, Inactive — неактивен. Статус обновляется на основе последней активности.",
    link: "/help#clients"
  },
  "clients.telegram": {
    short: "Telegram привязка",
    full: "Показывает, привязан ли Telegram-аккаунт клиента к платформе для получения уведомлений и доступа в клубы.",
    link: "/help#telegram"
  },

  // === Заказы ===
  "orders.status": {
    short: "Статус заказа",
    full: "pending — ожидает оплаты, paid — оплачен, failed — ошибка, refunded — возврат.",
    link: "/help#orders"
  },
  "orders.filters": {
    short: "Фильтрация заказов",
    full: "Фильтруйте по статусу, дате или способу оплаты. Сбросить фильтры можно кнопкой ✕.",
    link: "/help#orders"
  },
  "orders.duplicate": {
    short: "Возможный дубликат",
    full: "Система обнаружила похожий заказ. Проверьте, не является ли это повторной оплатой.",
    link: "/help#orders"
  },
  "orders.payment_method": {
    short: "Способ оплаты",
    full: "erip — ЕРИП, card — банковская карта. Определяется автоматически при оплате.",
    link: "/help#payments"
  },

  // === Подписки ===
  "subscription.tier": {
    short: "Уровень подписки",
    full: "free — бесплатный, pro — профессиональный, premium — премиум, webinar — участник вебинара.",
    link: "/help#subscriptions"
  },
  "subscription.expires": {
    short: "Срок действия",
    full: "Дата окончания активной подписки. После этой даты доступ к платным функциям будет ограничен.",
    link: "/help#subscriptions"
  },

  // === Дубликаты ===
  "duplicates.case": {
    short: "Кейс дубликатов",
    full: "Группа профилей с одинаковым номером телефона. Требует ручного объединения.",
    link: "/help#duplicates"
  },
  "duplicates.master": {
    short: "Основной профиль",
    full: "Профиль, в который будут объединены данные других дубликатов. Выбирается автоматически или вручную.",
    link: "/help#duplicates"
  },
  "duplicates.merge": {
    short: "Объединение профилей",
    full: "Перенос всех заказов, подписок и данных с дубликатов на основной профиль. Действие необратимо.",
    link: "/help#duplicates"
  },

  // === Интеграции ===
  "integrations.status": {
    short: "Статус подключения",
    full: "connected — работает, disconnected — отключена, error — ошибка. Проверяйте периодически.",
    link: "/help#integrations"
  },
  "integrations.sync": {
    short: "Синхронизация",
    full: "Обмен данными между платформой и внешней системой. Может быть односторонней или двусторонней.",
    link: "/help#integrations-sync"
  },
  "integrations.webhook": {
    short: "Webhook URL",
    full: "Адрес для приёма данных от внешней системы. Скопируйте и вставьте в настройки интеграции.",
    link: "/help#integrations"
  },
  "integrations.field_mapping": {
    short: "Соответствие полей",
    full: "Настройка связи между полями в CRM и полями в платформе. Ключевые поля обязательны.",
    link: "/help#integrations-mapping"
  },

  // === amoCRM ===
  "amocrm.subdomain": {
    short: "Поддомен amoCRM",
    full: "Часть адреса вашего аккаунта до .amocrm.ru. Например: mycompany из mycompany.amocrm.ru",
    link: "/help#amocrm"
  },
  "amocrm.pipeline": {
    short: "Воронка",
    full: "Выберите воронку продаж, с которой будет синхронизироваться интеграция.",
    link: "/help#amocrm"
  },

  // === GetCourse ===
  "getcourse.account": {
    short: "Аккаунт GetCourse",
    full: "Название вашего аккаунта в GetCourse без .getcourse.ru",
    link: "/help#getcourse"
  },
  "getcourse.secret_key": {
    short: "Секретный ключ",
    full: "API-ключ для подключения. Найдите его в GetCourse → Настройки → API.",
    link: "/help#getcourse"
  },

  // === Telegram ===
  "telegram.bot_token": {
    short: "Токен бота",
    full: "Получите у @BotFather в Telegram. Формат: 123456789:ABCdefGHI...",
    link: "/help#telegram-bots"
  },
  "telegram.club": {
    short: "Telegram-клуб",
    full: "Приватный чат/канал с автоматическим управлением доступом по подписке.",
    link: "/help#telegram-clubs"
  },
  "telegram.access_mode": {
    short: "Режим доступа",
    full: "AUTO — автоматическая выдача при оплате, MANUAL — только ручная выдача администратором.",
    link: "/help#telegram-clubs"
  },
  "telegram.revoke_mode": {
    short: "Режим отзыва",
    full: "KICK — удаление из чата, BAN — бан, KICK_ONLY — только удаление без бана.",
    link: "/help#telegram-clubs"
  },
  "telegram.mass_broadcast": {
    short: "Массовая рассылка",
    full: "Отправка сообщения всем пользователям с активной подпиской и привязанным Telegram.",
    link: "/help#telegram-notifications"
  },

  // === Email ===
  "email.smtp": {
    short: "SMTP-сервер",
    full: "Адрес сервера для отправки писем. Обычно: smtp.mail.ru, smtp.yandex.ru и т.д.",
    link: "/help#email"
  },
  "email.template": {
    short: "Шаблон письма",
    full: "HTML-шаблон с переменными. Используйте {{name}}, {{email}} для подстановки данных.",
    link: "/help#email-templates"
  },

  // === Платежи ===
  "payments.bepaid": {
    short: "bePaid",
    full: "Платёжная система для приёма оплат картами и через ЕРИП в Беларуси.",
    link: "/help#bepaid"
  },
  "payments.erip": {
    short: "ЕРИП",
    full: "Единое расчётное информационное пространство. Оплата через интернет-банк или инфокиоск.",
    link: "/help#payments"
  },

  // === Роли и права ===
  "roles.admin": {
    short: "Администратор",
    full: "Полный доступ к управлению системой, пользователями и настройками.",
    link: "/help#roles"
  },
  "roles.permission": {
    short: "Разрешение",
    full: "Конкретное право на действие. Например: users.view, orders.edit, roles.manage.",
    link: "/help#permissions"
  },

  // === Общие ===
  "general.export": {
    short: "Экспорт данных",
    full: "Скачивание данных в файл (CSV, Excel). Учитывает текущие фильтры.",
    link: "/help#export"
  },
  "general.pagination": {
    short: "Постраничный вывод",
    full: "Переключайтесь между страницами или измените количество записей на странице.",
  },
  "general.filters": {
    short: "Фильтры",
    full: "Сузьте результаты по нужным критериям. Активные фильтры отображаются рядом.",
  },

  // === Пользовательская часть ===
  "user.login": {
    short: "Вход в систему",
    full: "Используйте e-mail и пароль, указанные при регистрации. Забыли пароль — нажмите «Восстановить».",
    link: "/help#auth"
  },
  "user.register": {
    short: "Регистрация",
    full: "Создайте аккаунт, указав e-mail и пароль. Подтверждение по e-mail не требуется.",
    link: "/help#auth"
  },
  "user.subscription": {
    short: "Ваша подписка",
    full: "Текущий уровень доступа и дата окончания. Продлите подписку в разделе «Оплата».",
    link: "/help#subscriptions"
  },
  "user.telegram_link": {
    short: "Привязка Telegram",
    full: "Привяжите Telegram для получения уведомлений и доступа в закрытые чаты.",
    link: "/help#telegram"
  },

  // === Инструменты ===
  "tools.balance_wheel": {
    short: "Колесо баланса",
    full: "Инструмент для оценки удовлетворённости сферами жизни. Отмечайте от 1 до 10.",
    link: "/help#balance-wheel"
  },
  "tools.eisenhower": {
    short: "Матрица Эйзенхауэра",
    full: "Распределите задачи по важности и срочности для приоритизации.",
    link: "/help#eisenhower"
  },
  "tools.mns": {
    short: "Генератор ответов МНС",
    full: "Автоматическое формирование ответов на запросы налоговых органов.",
    link: "/help#mns"
  },
};

/**
 * Получить текст подсказки по ключу
 */
export function getHelpText(key: string): HelpText | undefined {
  return helpTexts[key];
}

/**
 * Получить короткий текст (для tooltip)
 */
export function getShortHelp(key: string): string {
  return helpTexts[key]?.short || key;
}

/**
 * Получить полный текст (для popover)
 */
export function getFullHelp(key: string): string | undefined {
  return helpTexts[key]?.full;
}

/**
 * Получить ссылку на раздел помощи
 */
export function getHelpLink(key: string): string | undefined {
  return helpTexts[key]?.link;
}
