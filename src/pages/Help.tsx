import { Link } from 'react-router-dom';
import { 
  UserPlus, 
  CreditCard, 
  LayoutDashboard, 
  FileText, 
  Link2, 
  ShieldCheck,
  Users,
  RefreshCw,
  Copy,
  Mail,
  Send,
  HelpCircle,
  Wallet,
  Target,
  Grid3X3,
  BookOpen
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Separator } from '@/components/ui/separator';

const quickStartCards = [
  {
    icon: UserPlus,
    title: 'Регистрация и вход',
    description: 'Создайте аккаунт и войдите в систему',
    anchor: '#auth'
  },
  {
    icon: CreditCard,
    title: 'Оплата и подписка',
    description: 'Оплатите доступ к платным функциям',
    anchor: '#payments'
  },
  {
    icon: LayoutDashboard,
    title: 'Личный кабинет',
    description: 'Ваш профиль и настройки',
    anchor: '#dashboard'
  },
  {
    icon: FileText,
    title: 'Документы',
    description: 'Работа с документами и генераторами',
    anchor: '#documents'
  },
  {
    icon: Link2,
    title: 'Интеграции',
    description: 'Подключение внешних сервисов',
    anchor: '#integrations'
  },
  {
    icon: ShieldCheck,
    title: 'Админ-панель',
    description: 'Управление системой',
    anchor: '#admin'
  }
];

const sections = [
  {
    id: 'auth',
    title: 'Регистрация и вход',
    icon: UserPlus,
    content: `
**Регистрация**
1. Нажмите «Регистрация» на главной странице
2. Введите e-mail и придумайте пароль
3. Подтверждение по e-mail не требуется — вы сразу получите доступ

**Вход**
- Используйте e-mail и пароль, указанные при регистрации
- Если забыли пароль — нажмите «Восстановить пароль»

**Безопасность**
- Не передавайте свой пароль третьим лицам
- Выходите из аккаунта на чужих устройствах
    `
  },
  {
    id: 'dashboard',
    title: 'Личный кабинет',
    icon: LayoutDashboard,
    content: `
**Главная панель**
- Обзор вашей подписки и доступных функций
- Быстрый доступ к инструментам

**Профиль**
- Ваши персональные данные
- Привязка Telegram для уведомлений

**История заказов**
- Список всех ваших покупок
- Статусы оплаты и чеки
    `
  },
  {
    id: 'subscriptions',
    title: 'Подписки',
    icon: Wallet,
    content: `
**Уровни подписки**
- **Free** — базовый бесплатный доступ
- **Pro** — профессиональные инструменты
- **Premium** — полный доступ ко всем функциям
- **Webinar** — доступ участника вебинара

**Срок действия**
- Подписка активна до указанной даты
- За 3 дня до окончания вы получите напоминание в Telegram
- Продлить подписку можно в любой момент
    `
  },
  {
    id: 'payments',
    title: 'Платежи',
    icon: CreditCard,
    content: `
**Способы оплаты**
- **Банковская карта** — Visa, Mastercard, Белкарт
- **ЕРИП** — через интернет-банк или инфокиоск

**Процесс оплаты**
1. Выберите тариф
2. Нажмите «Оплатить»
3. Следуйте инструкциям платёжной системы
4. После оплаты подписка активируется автоматически

**Проблемы с оплатой**
- Если платёж не прошёл — попробуйте другой способ
- Свяжитесь с поддержкой, если проблема повторяется
    `
  },
  {
    id: 'documents',
    title: 'Документы',
    icon: FileText,
    content: `
**Генератор ответов МНС**
- Загрузите запрос от налоговой
- Система автоматически сформирует ответ
- Скачайте готовый документ в Word

**История документов**
- Все созданные документы сохраняются
- Вы можете скачать их повторно
    `
  },
  {
    id: 'telegram',
    title: 'Telegram-интеграция',
    icon: Send,
    content: `
**Привязка аккаунта**
1. Нажмите «Привязать Telegram» в личном кабинете
2. Перейдите к боту и нажмите Start
3. Введите код привязки

**Уведомления**
- Напоминания об окончании подписки
- Важные системные сообщения

**Telegram-клубы**
- Приватные чаты для подписчиков
- Доступ выдаётся автоматически при оплате
- При окончании подписки доступ отзывается
    `
  },
  {
    id: 'tools',
    title: 'Инструменты',
    icon: Target,
    content: `
**Колесо баланса**
- Оцените удовлетворённость 8 сферами жизни
- Визуализация покажет зоны для развития
- Ставьте цели и задачи по каждой сфере

**Матрица Эйзенхауэра**
- Распределяйте задачи по важности и срочности
- 4 квадранта: делать, планировать, делегировать, удалить
- Интеграция с задачами из Колеса баланса
    `
  }
];

const adminSections = [
  {
    id: 'admin',
    title: 'Общие сведения',
    icon: ShieldCheck,
    content: `
**Доступ к админ-панели**
- Требуется роль администратора
- Вход через /admin

**Разделы админки**
- Клиенты — управление пользователями
- Заказы — просмотр и управление платежами
- Продукты — тарифы и подписки
- Интеграции — внешние сервисы
- Роли — управление правами доступа
    `
  },
  {
    id: 'admin-impersonate',
    title: 'Вход как пользователь',
    icon: Users,
    content: `
**Зачем нужно**
- Диагностика проблем пользователя
- Проверка отображения данных

**Как использовать**
1. Найдите пользователя в разделе «Клиенты»
2. Нажмите ⋮ → «Войти как пользователь»
3. Вы увидите систему глазами клиента
4. Для выхода нажмите «Вернуться к админке»

**Важно**: все действия логируются
    `
  },
  {
    id: 'orders',
    title: 'Управление заказами',
    icon: CreditCard,
    content: `
**Статусы заказов**
- **pending** — ожидает оплаты
- **paid** — оплачен успешно
- **failed** — ошибка оплаты
- **refunded** — возврат средств

**Фильтрация**
- По статусу, дате, способу оплаты
- Поиск по e-mail клиента

**Дубликаты**
- Система отмечает возможные повторные оплаты
- Проверяйте перед обработкой
    `
  },
  {
    id: 'duplicates',
    title: 'Дубликаты клиентов',
    icon: Copy,
    content: `
**Как появляются**
- Клиент регистрируется с разных e-mail
- Но использует один телефон

**Что делать**
1. Откройте раздел «Дубликаты»
2. Просмотрите кейс — группу похожих профилей
3. Выберите основной профиль
4. Нажмите «Объединить»

**Результат**
- Все заказы и подписки переносятся на основной профиль
- Дубликаты архивируются
    `
  },
  {
    id: 'integrations',
    title: 'Интеграции',
    icon: Link2,
    content: `
**Доступные интеграции**
- **amoCRM** — синхронизация клиентов
- **GetCourse** — вебхуки заказов
- **bePaid** — приём платежей
- **Email** — отправка писем
- **Telegram** — боты и клубы

**Статусы**
- ✓ connected — работает
- ✗ disconnected — отключена
- ⚠ error — требует внимания
    `
  },
  {
    id: 'integrations-sync',
    title: 'Синхронизация данных',
    icon: RefreshCw,
    content: `
**Направления**
- **Import** — данные приходят из внешней системы
- **Export** — данные уходят во внешнюю систему
- **Bidirectional** — двусторонний обмен

**Настройки**
- Фильтры — какие данные синхронизировать
- Стратегия конфликтов — что делать при расхождениях
- Расписание — автоматическая или ручная синхронизация
    `
  },
  {
    id: 'integrations-mapping',
    title: 'Соответствие полей',
    icon: Grid3X3,
    content: `
**Зачем нужно**
- Связывает поля в CRM с полями в платформе
- Например: «Телефон» в amoCRM → «phone» в профиле

**Настройка**
1. Откройте интеграцию
2. Перейдите в «Настройки синхронизации»
3. Укажите соответствия полей

**Ключевые поля**
- Обязательны для идентификации записей
- Обычно это e-mail или телефон
    `
  },
  {
    id: 'telegram-bots',
    title: 'Telegram-боты',
    icon: Send,
    content: `
**Добавление бота**
1. Создайте бота у @BotFather
2. Скопируйте токен
3. Добавьте в раздел «Telegram → Боты»

**Настройка webhook**
- Нажмите «Установить webhook»
- Бот начнёт получать сообщения

**Проверка связи**
- Нажмите «Проверить» для теста подключения
    `
  },
  {
    id: 'telegram-clubs',
    title: 'Telegram-клубы',
    icon: Users,
    content: `
**Создание клуба**
1. Добавьте бота в чат/канал как администратора
2. Создайте клуб в админке
3. Укажите ID чата и настройки

**Режимы доступа**
- **AUTO** — автоматическая выдача при оплате
- **MANUAL** — только ручная выдача

**Режимы отзыва**
- **KICK** — удаление из чата
- **BAN** — бан пользователя
    `
  },
  {
    id: 'telegram-notifications',
    title: 'Уведомления',
    icon: Mail,
    content: `
**Автоматические**
- Напоминание за 3 дня до окончания подписки
- Отправляются ежедневно в 10:00

**Ручные**
- Отправка конкретному пользователю из карточки клиента
- Массовая рассылка всем с активной подпиской

**Типы сообщений**
- Напоминание о подписке
- Приветствие
- Произвольный текст
    `
  },
  {
    id: 'roles',
    title: 'Роли и права',
    icon: ShieldCheck,
    content: `
**Системные роли**
- **user** — обычный пользователь
- **admin** — администратор
- **superadmin** — полный доступ

**Права (permissions)**
- users.view — просмотр клиентов
- users.update — редактирование
- orders.view — просмотр заказов
- entitlements.manage — управление подписками

**Назначение ролей**
- Через раздел «Роли» в админке
- Или при приглашении пользователя
    `
  },
  {
    id: 'amocrm',
    title: 'amoCRM',
    icon: Link2,
    content: `
**Подключение**
1. Укажите поддомен (часть до .amocrm.ru)
2. Авторизуйтесь через OAuth
3. Выберите воронку для синхронизации

**Что синхронизируется**
- Контакты и сделки
- Статусы и поля

**Webhook**
- Скопируйте URL из настроек интеграции
- Вставьте в amoCRM → Настройки → API → Webhooks
    `
  },
  {
    id: 'getcourse',
    title: 'GetCourse',
    icon: Link2,
    content: `
**Подключение**
1. Укажите название аккаунта GetCourse
2. Введите секретный ключ API

**Webhook для заказов**
- Скопируйте URL из настроек
- Добавьте в GetCourse при создании процесса

**Что приходит**
- Информация о заказах и оплатах
- Данные клиентов
    `
  },
  {
    id: 'bepaid',
    title: 'bePaid',
    icon: Wallet,
    content: `
**Настройка**
- ID магазина и секретный ключ — в настройках bePaid
- URL для webhook — укажите в личном кабинете bePaid

**Способы оплаты**
- Банковские карты
- ЕРИП (QR-код и номер плательщика)

**Статусы**
- Обрабатываются автоматически через webhook
    `
  },
  {
    id: 'email',
    title: 'Email-рассылки',
    icon: Mail,
    content: `
**Настройка SMTP**
- Укажите сервер, порт, логин и пароль
- Проверьте подключение

**Шаблоны писем**
- Создавайте HTML-шаблоны с переменными
- {{name}}, {{email}}, {{amount}} — подставляются автоматически

**Отправка**
- Автоматическая по триггерам
- Ручная из карточки клиента
    `
  }
];

const faq = [
  {
    question: 'Как сменить e-mail аккаунта?',
    answer: 'Напишите в поддержку с текущего и нового e-mail. После проверки мы изменим адрес.'
  },
  {
    question: 'Подписка не активировалась после оплаты',
    answer: 'Обычно активация занимает до 5 минут. Если подписка не появилась — проверьте статус заказа в истории или напишите в поддержку.'
  },
  {
    question: 'Как отвязать Telegram?',
    answer: 'Напишите в поддержку. Самостоятельно отвязать нельзя из соображений безопасности.'
  },
  {
    question: 'Можно ли вернуть деньги?',
    answer: 'Возврат возможен в течение 14 дней, если услуга не была использована. Напишите в поддержку.'
  },
  {
    question: 'Забыл пароль, что делать?',
    answer: 'Нажмите «Восстановить пароль» на странице входа. Ссылка придёт на ваш e-mail.'
  },
  {
    question: 'Как связаться с поддержкой?',
    answer: 'Напишите на support@example.com или через форму обратной связи на странице контактов.'
  }
];

export default function Help() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="border-b bg-muted/30">
        <div className="container py-12 md:py-16">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-3xl md:text-4xl font-bold">Как пользоваться платформой</h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-2xl">
            Руководство по всем функциям системы. Выберите раздел или найдите ответ в FAQ.
          </p>
        </div>
      </div>

      <div className="container py-8 md:py-12">
        {/* Быстрый старт */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-6">Быстрый старт</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {quickStartCards.map((card) => (
              <a key={card.anchor} href={card.anchor}>
                <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer group">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                        <card.icon className="h-5 w-5 text-primary" />
                      </div>
                      <CardTitle className="text-base">{card.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <CardDescription>{card.description}</CardDescription>
                  </CardContent>
                </Card>
              </a>
            ))}
          </div>
        </section>

        <Separator className="my-8" />

        {/* Пользовательские разделы */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-6">Для пользователей</h2>
          <div className="space-y-4">
            {sections.map((section) => (
              <Card key={section.id} id={section.id} className="scroll-mt-20">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <section.icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-lg">{section.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {section.content.split('\n').map((line, i) => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return <h4 key={i} className="font-semibold mt-4 mb-2 first:mt-0">{line.replace(/\*\*/g, '')}</h4>;
                      }
                      if (line.startsWith('- ')) {
                        return <li key={i} className="text-muted-foreground ml-4">{line.slice(2)}</li>;
                      }
                      if (line.match(/^\d+\./)) {
                        return <li key={i} className="text-muted-foreground ml-4 list-decimal">{line.slice(3)}</li>;
                      }
                      if (line.trim()) {
                        return <p key={i} className="text-muted-foreground">{line}</p>;
                      }
                      return null;
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator className="my-8" />

        {/* Админ-разделы */}
        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-6">Для администраторов</h2>
          <div className="space-y-4">
            {adminSections.map((section) => (
              <Card key={section.id} id={section.id} className="scroll-mt-20">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <section.icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-lg">{section.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {section.content.split('\n').map((line, i) => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return <h4 key={i} className="font-semibold mt-4 mb-2 first:mt-0">{line.replace(/\*\*/g, '')}</h4>;
                      }
                      if (line.startsWith('- ')) {
                        return <li key={i} className="text-muted-foreground ml-4">{line.slice(2)}</li>;
                      }
                      if (line.match(/^\d+\./)) {
                        return <li key={i} className="text-muted-foreground ml-4 list-decimal">{line.slice(3)}</li>;
                      }
                      if (line.trim()) {
                        return <p key={i} className="text-muted-foreground">{line}</p>;
                      }
                      return null;
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator className="my-8" />

        {/* FAQ */}
        <section className="mb-12" id="faq">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            Частые вопросы
          </h2>
          <Card>
            <CardContent className="pt-6">
              <Accordion type="single" collapsible className="w-full">
                {faq.map((item, index) => (
                  <AccordionItem key={index} value={`faq-${index}`}>
                    <AccordionTrigger className="text-left">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </section>

        {/* Контакты */}
        <section id="contacts">
          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle>Нужна помощь?</CardTitle>
              <CardDescription>
                Если не нашли ответ на свой вопрос — свяжитесь с поддержкой
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4">
              <Link 
                to="/contacts" 
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                <Mail className="h-4 w-4" />
                Написать в поддержку
              </Link>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
