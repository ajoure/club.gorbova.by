export type CrmAutomationTriggerAvailability = "available" | "planned";

export interface CrmAutomationTriggerDefinition {
  id: string;
  category: "deal" | "field" | "payment" | "communication" | "calendar" | "system";
  title: string;
  description: string;
  availability: CrmAutomationTriggerAvailability;
  requiresSchedule?: boolean;
}

/**
 * Single source of truth for the pipeline trigger picker.
 * A trigger becomes selectable only together with its database event contract
 * and worker support; planned entries remain explanatory, never inert config.
 */
export const CRM_AUTOMATION_TRIGGER_CATALOG: CrmAutomationTriggerDefinition[] = [
  {
    id: "deal_entered_stage",
    category: "deal",
    title: "Сделка вошла в стадию",
    description: "Запускает правило после перехода сделки в выбранную стадию воронки.",
    availability: "available",
  },
  {
    id: "deal_left_stage",
    category: "deal",
    title: "Сделка покинула стадию",
    description: "Реагирует на выход из выбранной стадии, например для отмены ожидания.",
    availability: "planned",
  },
  {
    id: "deal_created",
    category: "deal",
    title: "Создана сделка",
    description: "Срабатывает один раз при появлении новой сделки в воронке.",
    availability: "planned",
  },
  {
    id: "deal_field_changed",
    category: "field",
    title: "Изменилось поле сделки",
    description: "Реагирует на смену ответственного, суммы, продукта, тарифа или другого выбранного поля.",
    availability: "planned",
  },
  {
    id: "payment_received",
    category: "payment",
    title: "Получена оплата",
    description: "Запускается после подтверждённой оплаты, привязанной к сделке.",
    availability: "planned",
  },
  {
    id: "payment_overdue",
    category: "payment",
    title: "Платёж просрочен",
    description: "Срабатывает, когда ожидаемый платёж не получен к заданному сроку.",
    availability: "planned",
  },
  {
    id: "email_opened",
    category: "communication",
    title: "Открыто письмо",
    description: "Реагирует на событие трекинга Email, если оно доступно у канала отправки.",
    availability: "planned",
  },
  {
    id: "email_clicked",
    category: "communication",
    title: "Клик по ссылке в письме",
    description: "Запускается после зафиксированного перехода по ссылке из письма.",
    availability: "planned",
  },
  {
    id: "telegram_reply",
    category: "communication",
    title: "Ответ в Telegram",
    description: "Реагирует на новое входящее сообщение клиента, связанное со сделкой.",
    availability: "planned",
  },
  {
    id: "at_datetime",
    category: "calendar",
    title: "В конкретную дату и время",
    description: "Однократный запуск по выбранным дате, времени и часовому поясу.",
    availability: "available",
    requiresSchedule: true,
  },
  {
    id: "after_event",
    category: "calendar",
    title: "Через период после события",
    description: "Запуск через минуты, часы, дни или недели после входа в стадию либо другого события.",
    availability: "planned",
    requiresSchedule: true,
  },
  {
    id: "weekday",
    category: "calendar",
    title: "В день недели",
    description: "Повторяет запуск в выбранные дни недели в часовом поясе правила.",
    availability: "planned",
    requiresSchedule: true,
  },
  {
    id: "month_day",
    category: "calendar",
    title: "В день месяца",
    description: "Например, первого числа каждого месяца или в заданный день месяца.",
    availability: "planned",
    requiresSchedule: true,
  },
  {
    id: "business_day",
    category: "calendar",
    title: "В рабочий день",
    description: "Первый, последний или N-й рабочий день месяца после подключения календаря праздников организации.",
    availability: "planned",
    requiresSchedule: true,
  },
  {
    id: "manual_or_api",
    category: "system",
    title: "Вручную или по API",
    description: "Позволит сотруднику или защищённой интеграции запустить опубликованное правило явно.",
    availability: "planned",
  },
];

export const CRM_AUTOMATION_TRIGGER_CATEGORY_LABELS = {
  deal: "Сделка",
  field: "Поля",
  payment: "Оплата",
  communication: "Коммуникации",
  calendar: "Время и календарь",
  system: "Система",
} as const;
