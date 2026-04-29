// Human-readable mapping for invariant codes used by the owner-view of /admin/system-health.
// Built from real report_json data (see mem://ui/admin/system-health-owner-view.md).

export type ProblemType = "critical_fix" | "manual_review" | "observe" | "tech_info";
export type RecommendedAction = "fix_via_lovable" | "check_manually" | "observe";

export interface InvariantDescriptor {
  code: string;
  problemType: ProblemType;
  recommendedAction: RecommendedAction;
  ownerTitle: string;
  ownerSummary: string; // одна строка для верхушки карточки
  whatHappened: string;
  whyItMatters: string;
  whyNotAutofixed?: string;     // обязателен для critical_fix
  consequenceOfInaction?: string; // обязателен для critical_fix
  suggestedFix: string;
  relatedRoute?: string; // только если действительно помогает расследовать
  relatedRouteLabel?: string;
}

export const INVARIANT_HUMANIZE: Record<string, InvariantDescriptor> = {
  "INV-P0-1": {
    code: "INV-P0-1",
    problemType: "critical_fix",
    recommendedAction: "fix_via_lovable",
    ownerTitle: "Автопродления подписок не выполняются",
    ownerSummary: "За сутки не было ни одного автосписания",
    whatHappened: "За последние 24 часа в системе не зафиксировано ни одного автоматического списания по активным подпискам.",
    whyItMatters: "Это означает, что подписки не продлеваются и клиенты могут потерять доступ. Деньги не списываются — выручка падает.",
    whyNotAutofixed: "Причина может быть в нескольких местах сразу (cron, webhook bePaid, бизнес-правила), и автоматическое восстановление без диагностики может списать дубликаты.",
    consequenceOfInaction: "Каждый день простоя — отток клиентов и потеря MRR. Если оставить как есть, клиенты сами заметят отсутствие списаний и могут отписаться.",
    suggestedFix: "Передайте PATCH ниже в Lovable — он проверит cron-расписание автопродления, очередь bePaid и последние webhook-вызовы, и восстановит регулярные списания.",
    relatedRoute: "/admin/payments",
    relatedRouteLabel: "Платежи",
  },
  "INV-P0-4": {
    code: "INV-P0-4",
    problemType: "critical_fix",
    recommendedAction: "fix_via_lovable",
    ownerTitle: "Фоновые задания (cron) остановились",
    ownerSummary: "За сутки не выполнились фоновые задания",
    whatHappened: "За последние 24 часа ни одна регулярная фоновая задача не отработала.",
    whyItMatters: "Останавливаются автопродления, рассылки, синхронизация доступов и закрытие просрочек. Внешне сайт работает, но внутри ничего не происходит.",
    whyNotAutofixed: "Перезапуск cron вслепую может выполнить задачи задним числом и наделать дубликатов писем / списаний. Нужна выверка состояния перед рестартом.",
    consequenceOfInaction: "Каждый час без cron — растущий долг непродлённых подписок, неотправленных уведомлений и невыданных доступов. Восстанавливать ручную задержку очень дорого.",
    suggestedFix: "Передайте PATCH ниже в Lovable — он проверит pg_cron, последние логи задач и восстановит расписание без двойного запуска.",
  },
  "INV-P0-2": {
    code: "INV-P0-2",
    problemType: "tech_info",
    recommendedAction: "observe",
    ownerTitle: "Новые заказы продления за 24ч",
    ownerSummary: "Метрика для технической проверки",
    whatHappened: "Счётчик renewal-заказов за последние сутки.",
    whyItMatters: "Информационная метрика. Сама по себе не требует действий.",
    suggestedFix: "Действие не требуется.",
  },
  "INV-P0-3": {
    code: "INV-P0-3",
    problemType: "tech_info",
    recommendedAction: "observe",
    ownerTitle: "Очередь Telegram",
    ownerSummary: "Метрика для технической проверки",
    whatHappened: "Размер очереди задач Telegram-интеграции.",
    whyItMatters: "Сам по себе ненулевой размер очереди — норма.",
    suggestedFix: "Действие не требуется.",
  },
  "INV-P0-5": {
    code: "INV-P0-5",
    problemType: "tech_info",
    recommendedAction: "observe",
    ownerTitle: "Успешные платежи за 24ч",
    ownerSummary: "Метрика для технической проверки",
    whatHappened: "Счётчик успешных платежей за последние сутки.",
    whyItMatters: "Информационная метрика выручки.",
    suggestedFix: "Действие не требуется.",
  },
  "INV-22": {
    code: "INV-22",
    problemType: "critical_fix",
    recommendedAction: "fix_via_lovable",
    ownerTitle: "Подписки рассинхронизированы с bePaid",
    ownerSummary: "Локально active+auto_renew, у провайдера expired/redirecting",
    whatHappened: "Подписки числятся активными и продлеваемыми у нас, но bePaid их уже не считает живыми (expired или застряли на 3DS).",
    whyItMatters: "Кабинет показывает пользователю «активна, продлится автоматически», но провайдер не спишет — клиент потеряет доступ без предупреждения.",
    whyNotAutofixed: "Затрагивает живые карты пользователей и видимость в кабинете — нужна явная кнопка владельца с dry-run и подтверждением.",
    consequenceOfInaction: "Накопление зомби-подписок: ложная статистика выручки, обманутые ожидания клиентов, риск негатива при истечении доступа.",
    suggestedFix: "Откройте Платежи → Автопродления → блок «INV-22 — рассинхрон подписок» сверху страницы. Сначала «Загрузить план», затем «Разобрать» — выполнит dry-run и закроет локально только тех, кого bePaid тоже считает мёртвыми. Доступ не отзывается.",
    relatedRoute: "/admin/payments/auto-renewals",
    relatedRouteLabel: "Автопродления",
  },
};

export function humanizeInvariant(code: string): InvariantDescriptor {
  return (
    INVARIANT_HUMANIZE[code] ?? {
      code,
      problemType: "tech_info",
      recommendedAction: "observe",
      ownerTitle: code,
      ownerSummary: "Неизвестный инвариант",
      whatHappened: "Нет описания для этого кода. Передайте код в Lovable для классификации.",
      whyItMatters: "Неизвестно.",
      suggestedFix: "Передайте код в Lovable.",
    }
  );
}
