import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BookOpen,
  Users,
  CreditCard,
  Send,
  Shield,
  Settings,
  Target,
  LayoutGrid,
  FileText,
  HelpCircle,
} from "lucide-react";

const sections = [
  {
    id: "getting-started",
    title: "Начало работы",
    icon: BookOpen,
    content: [
      {
        title: "Регистрация и вход",
        text: `Для начала работы с платформой необходимо зарегистрироваться или войти в существующий аккаунт.

1. Перейдите на страницу авторизации
2. Введите email и пароль или используйте быструю регистрацию
3. Подтвердите email (если требуется)
4. После входа вы попадёте на главную панель (Dashboard)`,
      },
      {
        title: "Привязка Telegram",
        text: `Для получения доступа к закрытым чатам и каналам клуба необходимо привязать Telegram:

1. На главной панели нажмите кнопку "Привязать Telegram"
2. Перейдите по ссылке в Telegram-бот
3. Нажмите "Начать" или отправьте команду /start
4. Бот автоматически свяжет ваш аккаунт

После привязки вы будете получать уведомления и доступ к закрытым материалам.`,
      },
      {
        title: "Оформление подписки",
        text: `Для получения полного доступа к материалам клуба:

1. Перейдите в раздел "Тарифы" (Pricing)
2. Выберите подходящий тарифный план
3. Заполните данные для оплаты
4. После успешной оплаты доступ предоставляется автоматически

Если Telegram привязан — вы получите уведомление и ссылки для входа в чат/канал.`,
      },
    ],
  },
  {
    id: "tools",
    title: "Инструменты",
    icon: Target,
    content: [
      {
        title: "Матрица Эйзенхауэра",
        text: `Инструмент для приоритизации задач по важности и срочности.

Задачи делятся на 4 квадранта:
• Важно и срочно — делать немедленно
• Важно, но не срочно — планировать
• Срочно, но не важно — делегировать
• Не важно и не срочно — исключить

Как использовать:
1. Перейдите в "Инструменты лидера" → "Матрица продуктивности"
2. Добавляйте задачи в соответствующие квадранты
3. Устанавливайте дедлайны и категории
4. Отмечайте выполненные задачи`,
      },
      {
        title: "Колесо баланса",
        text: `Инструмент стратегического планирования через оценку 8 сфер жизни.

Сферы колеса баланса:
• Карьера / Финансы
• Здоровье / Энергия
• Отношения / Семья
• Личностный рост
• Отдых / Хобби
• Окружение / Среда
• Духовность / Ценности
• Вклад / Социум

Как использовать:
1. Оцените каждую сферу от 1 до 10
2. Добавьте заметки и цели по каждой сфере
3. Создавайте задачи для улучшения показателей
4. Периодически пересматривайте оценки`,
      },
    ],
  },
  {
    id: "subscription",
    title: "Подписка и оплата",
    icon: CreditCard,
    content: [
      {
        title: "Тарифные планы",
        text: `Доступные тарифы:

• Базовый — доступ к основным материалам
• Премиум — полный доступ + Telegram-клуб
• VIP — всё включено + персональная поддержка

Подписка активируется сразу после оплаты. Доступ предоставляется на 30 дней.`,
      },
      {
        title: "Продление подписки",
        text: `За 3 дня до окончания подписки вы получите уведомление в Telegram.

Для продления:
1. Перейдите в раздел "Тарифы"
2. Выберите тот же или другой тариф
3. Оплатите подписку

Доступ продлится автоматически. Если не продлить — доступ к Telegram будет приостановлен.`,
      },
      {
        title: "История покупок",
        text: `Все ваши покупки сохраняются в разделе "Мои покупки":

• Дата и время оплаты
• Название продукта
• Сумма и статус
• Срок действия подписки`,
      },
    ],
  },
  {
    id: "telegram",
    title: "Telegram-клуб",
    icon: Send,
    content: [
      {
        title: "Как получить доступ",
        text: `После оплаты подписки и привязки Telegram:

1. Бот автоматически добавит вас в чат и канал
2. Или пришлёт одноразовые ссылки для входа
3. Ссылки действительны ограниченное время

Если возникли проблемы — обратитесь к администратору.`,
      },
      {
        title: "Правила клуба",
        text: `В Telegram-клубе действуют правила:

• Уважительное общение
• Запрет спама и рекламы
• Конструктивная критика
• Помощь участникам

Нарушение правил может привести к ограничению доступа.`,
      },
      {
        title: "Уведомления",
        text: `Бот отправляет уведомления:

• Приветствие после привязки
• Подтверждение доступа
• Напоминание за 3 дня до окончания
• Уведомление об истечении подписки
• Важные объявления от администрации`,
      },
    ],
  },
];

const adminSections = [
  {
    id: "admin-users",
    title: "Управление клиентами",
    icon: Users,
    content: [
      {
        title: "Список клиентов",
        text: `В разделе "Клиенты" доступны:

• Просмотр всех зарегистрированных пользователей
• Фильтрация по статусу (активные, заблокированные, удалённые)
• Фильтрация по роли
• Поиск по имени и email

Действия с клиентами:
• Заблокировать/разблокировать
• Сбросить пароль
• Принудительный выход
• Назначить роль
• Войти от имени пользователя`,
      },
      {
        title: "Дубликаты",
        text: `Система автоматически определяет потенциальные дубликаты по номеру телефона.

В разделе "Дубли" можно:
• Просмотреть группы дубликатов
• Объединить профили
• Отклонить ложные срабатывания`,
      },
      {
        title: "Отправка уведомлений",
        text: `Администратор может отправить уведомление в Telegram:

1. Откройте меню действий с клиентом
2. Выберите "Отправить уведомление"
3. Выберите тип сообщения или напишите своё
4. Подтвердите отправку

Типы уведомлений:
• Напоминание о подписке
• Приветствие
• Подтверждение доступа
• Произвольное сообщение`,
      },
    ],
  },
  {
    id: "admin-telegram",
    title: "Telegram-интеграция",
    icon: Send,
    content: [
      {
        title: "Настройка бота",
        text: `Для работы Telegram-интеграции необходимо:

1. Создать бота через @BotFather
2. Получить токен бота
3. Добавить бота в админке (Интеграции → Telegram → Боты)
4. Проверить подключение
5. Установить Webhook

Бот должен быть администратором в чате и канале.`,
      },
      {
        title: "Настройка клуба",
        text: `Клуб объединяет чат и канал:

1. Создайте клуб в разделе "Клубы"
2. Укажите инвайт-ссылки на чат и канал
3. Выберите бота для управления
4. Настройте режим доступа

Режимы доступа:
• AUTO_ADD — бот добавляет пользователей сам
• INVITE_ONLY — только через ссылки
• AUTO_WITH_FALLBACK — автоматически или ссылкой`,
      },
      {
        title: "Логи и мониторинг",
        text: `Все действия Telegram-интеграции логируются:

• Выдача доступа
• Отзыв доступа
• Отправка уведомлений
• Ошибки API

Логи помогают отслеживать проблемы и анализировать работу системы.`,
      },
    ],
  },
  {
    id: "admin-roles",
    title: "Роли и права",
    icon: Shield,
    content: [
      {
        title: "Система ролей",
        text: `Иерархия ролей:

• Супер-администратор — полный доступ
• Администратор — управление пользователями и контентом
• Редактор — работа с контентом
• Поддержка — ограниченный доступ к клиентам
• Сотрудник — базовый доступ
• Пользователь — обычный клиент`,
      },
      {
        title: "Назначение ролей",
        text: `Только супер-администратор может назначать роли администраторов.

Для назначения роли:
1. Найдите пользователя в списке клиентов
2. Откройте меню действий
3. Выберите "Назначить роль"
4. Выберите роль из списка`,
      },
    ],
  },
  {
    id: "admin-integrations",
    title: "Интеграции",
    icon: Settings,
    content: [
      {
        title: "CRM (amoCRM, GetCourse)",
        text: `Интеграции с CRM позволяют:

• Автоматически создавать контакты при оплате
• Создавать сделки
• Синхронизировать данные клиентов

Настройка:
1. Перейдите в Интеграции → CRM
2. Добавьте подключение
3. Укажите учётные данные
4. Проверьте подключение`,
      },
      {
        title: "Платёжные системы",
        text: `Подключение bePaid:

1. Получите данные магазина в личном кабинете bePaid
2. Добавьте интеграцию в разделе "Платежи"
3. Укажите ID магазина и секретный ключ
4. Настройте URL возврата`,
      },
      {
        title: "Email (SMTP)",
        text: `Настройка отправки email:

1. Получите пароль приложения у почтового провайдера
2. Добавьте интеграцию в разделе "Почта"
3. Укажите email и пароль
4. Система автоматически определит SMTP-настройки`,
      },
    ],
  },
];

export default function Documentation() {
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Документация
          </h1>
          <p className="text-muted-foreground">
            Полное руководство по использованию платформы
          </p>
        </div>

        <Tabs defaultValue="user" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="user" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Для пользователей
            </TabsTrigger>
            <TabsTrigger value="admin" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Для администраторов
            </TabsTrigger>
          </TabsList>

          <TabsContent value="user" className="mt-6">
            <div className="grid gap-6">
              {sections.map((section) => (
                <GlassCard key={section.id}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <section.icon className="h-5 w-5 text-primary" />
                    </div>
                    <h2 className="text-xl font-semibold">{section.title}</h2>
                  </div>
                  <Accordion type="single" collapsible className="w-full">
                    {section.content.map((item, index) => (
                      <AccordionItem key={index} value={`${section.id}-${index}`}>
                        <AccordionTrigger className="text-left">
                          {item.title}
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="text-muted-foreground whitespace-pre-line">
                            {item.text}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </GlassCard>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="admin" className="mt-6">
            <div className="grid gap-6">
              {adminSections.map((section) => (
                <GlassCard key={section.id}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                      <section.icon className="h-5 w-5 text-destructive" />
                    </div>
                    <h2 className="text-xl font-semibold">{section.title}</h2>
                  </div>
                  <Accordion type="single" collapsible className="w-full">
                    {section.content.map((item, index) => (
                      <AccordionItem key={index} value={`${section.id}-${index}`}>
                        <AccordionTrigger className="text-left">
                          {item.title}
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="text-muted-foreground whitespace-pre-line">
                            {item.text}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </GlassCard>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
