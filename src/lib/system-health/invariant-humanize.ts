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
  "INV-EDGE-P0-MISSING": {
    code: "INV-EDGE-P0-MISSING", problemType: "critical_fix", recommendedAction: "fix_via_lovable",
    ownerTitle: "Критичная серверная функция недоступна",
    ownerSummary: "Подтверждённая недоступность сохраняется до свежей успешной проверки",
    whatHappened: "Проверка получила ответ о неразвёрнутой функции P0. Неполный новый обход не отменяет этот результат.",
    whyItMatters: "Может быть недоступен один из основных сценариев платформы.",
    whyNotAutofixed: "Нельзя разворачивать функции или повторять бизнес-запросы без проверки исходников.",
    consequenceOfInaction: "Критичная функция останется недоступна.",
    suggestedFix: "Проверьте развёртывание и логи функции, затем выполните свежую безопасную проверку OPTIONS.",
  },
  "INV-EDGE-AVAILABILITY": {
    code: "INV-EDGE-AVAILABILITY",
    problemType: "critical_fix",
    recommendedAction: "fix_via_lovable",
    ownerTitle: "Не все серверные функции прошли проверку",
    ownerSummary: "Есть ошибки OPTIONS, CORS или соединения",
    whatHappened: "Одна или несколько проверок доступности завершились ошибкой. Это не успешная проверка бизнес-сценария.",
    whyItMatters: "Функция может быть недоступна из браузера или не отвечать. Нельзя считать такой результат исправной системой.",
    whyNotAutofixed: "Автоматический повтор бизнес-запросов может изменить данные. Проверка использует только OPTIONS.",
    consequenceOfInaction: "Причина недоступности останется без разбора.",
    suggestedFix: "Сверьте ошибки в результатах проверки и логи названных функций; исправьте причину и повторите безопасную проверку.",
  },
  "INV-P0-1-R": {
    code: "INV-P0-1-R",
    problemType: "manual_review",
    recommendedAction: "check_manually",
    ownerTitle: "Проверьте платежи и состояние подписок",
    ownerSummary: "bePaid отклонил платёж или активная подписка расходится с локальным состоянием",
    whatHappened: "Свежий ответ bePaid подтвердил отказ по платежу либо действующую подписку, которая у нас не продлевается. Это отдельно от пропущенного автосписания.",
    whyItMatters: "Нужно сверить оплату, доступ и историю отмены. Успешная оплата не должна потеряться, а после отмены не должно быть новых списаний.",
    suggestedFix: "Откройте автопродления, сверяйте последнюю транзакцию bePaid, оплаченный период и историю подписки. Не повторяйте списание и не отменяйте подписку без разбора.",
    relatedRoute: "/admin/payments/auto-renewals",
    relatedRouteLabel: "Автопродления",
  },
  "INV-P0-1": {
    code: "INV-P0-1",
    problemType: "critical_fix",
    recommendedAction: "fix_via_lovable",
    ownerTitle: "Есть просроченные автопродления bePaid",
    ownerSummary: "Списание просрочено более чем на 24 часа",
    whatHappened: "Провайдерская подписка остаётся активной, но запланированное списание не подтверждено после безопасного 24-часового окна.",
    whyItMatters: "Клиент может не получить продление вовремя, а доступ и выручка начнут расходиться с данными bePaid.",
    whyNotAutofixed: "Повторное списание без сверки с bePaid может создать дубль. Сначала нужно проверить последнюю транзакцию провайдера.",
    consequenceOfInaction: "Просроченная подписка останется без подтверждённого продления и потребует ручного разбора.",
    suggestedFix: "Проверьте последнюю транзакцию подписки в bePaid и выполните только идемпотентную синхронизацию без нового списания.",
    relatedRoute: "/admin/payments",
    relatedRouteLabel: "Платежи",
  },
  "INV-P0-4": {
    code: "INV-P0-4",
    problemType: "critical_fix",
    recommendedAction: "fix_via_lovable",
    ownerTitle: "Фоновые задания (cron) остановились",
    ownerSummary: "Нет ни прямого, ни резервного подтверждения cron",
    whatHappened: "Проверка не нашла успешных запусков ни через pg_cron RPC, ни по служебному аудиту cron.",
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
