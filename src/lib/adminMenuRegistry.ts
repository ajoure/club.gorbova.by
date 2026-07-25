/**
 * RBAC v3 — единый каталог секций/ресурсов админ-панели.
 *
 * Должен 1-в-1 соответствовать таблицам public.admin_section / public.admin_resource
 * (seed выполнен в миграции 20260625 — RBAC v3 Migration D).
 *
 * Используется:
 *   - AdminSidebar    → фильтр пунктов меню через useAdminAccess
 *   - AdminRouteGuard → deny-by-default: если path не маппится — запретить
 *   - sync_admin_menu_registry RPC → каталог можно ресинкнуть из этого источника
 */

export type AccessLevel = "manage" | "edit" | "view" | "none";

export interface AdminResourceDef {
  /** Уникальный код внутри секции (lower-kebab). */
  code: string;
  label: string;
  /** Полный путь (или путь с query) — для прямой проверки маршрута. */
  route: string;
}

export interface AdminSectionDef {
  /** Уникальный код секции (lower-kebab). Совпадает с item.id в DEFAULT_MENU. */
  code: string;
  label: string;
  group: "crm" | "service";
  /** Базовый префикс маршрута. Используется для prefix-match resolveAdminSectionForPath. */
  routePrefix: string;
  /** Дополнительные префиксы, попадающие в эту секцию (например, /admin/contacts/duplicates). */
  altPrefixes?: string[];
  resources?: AdminResourceDef[];
}

export const ADMIN_SECTIONS: readonly AdminSectionDef[] = [
  // ─────────── CRM ───────────
  {
    code: "communication",
    label: "Контакт-центр",
    group: "crm",
    routePrefix: "/admin/communication",
    altPrefixes: ["/admin/inbox", "/admin/broadcasts"],
    resources: [
      { code: "inbox",      label: "Входящие",     route: "/admin/communication" },
      { code: "broadcasts", label: "Рассылки",     route: "/admin/communication?tab=broadcasts" },
      { code: "email",      label: "Email",        route: "/admin/communication?tab=email" },
      { code: "support",    label: "Техподдержка", route: "/admin/communication?tab=support" },
      { code: "instagram",  label: "Instagram",    route: "/admin/communication?tab=instagram" },
    ],
  },
  {
    code: "calls",
    label: "Звонки и SMS",
    group: "crm",
    routePrefix: "/admin/calls",
  },
  {
    code: "deals",
    label: "Сделки",
    group: "crm",
    routePrefix: "/admin/deals",
  },


  {
    code: "contacts",
    label: "Контакты",
    group: "crm",
    routePrefix: "/admin/contacts",
  },
  {
    code: "referrals",
    label: "Реферальная программа",
    group: "crm",
    routePrefix: "/admin/referrals",
  },
  {
    code: "companies",
    label: "Компании",
    group: "crm",
    routePrefix: "/admin/companies",
  },
  {
    code: "payments",
    label: "Платежи",
    group: "crm",
    routePrefix: "/admin/payments",
    resources: [
      { code: "overview",             label: "Обзор",              route: "/admin/payments" },
      { code: "auto-renewals",        label: "Автопродления",      route: "/admin/payments/auto-renewals" },
      { code: "statement",            label: "Выписка",            route: "/admin/payments/statement" },
      { code: "links",                label: "Платёжные ссылки",   route: "/admin/payments/links" },
      { code: "bepaid-subscriptions", label: "bePaid подписки",    route: "/admin/payments/bepaid-subscriptions" },
      { code: "payment-issues",       label: "Проблемы платежей",  route: "/admin/payments/payment-issues" },
      { code: "diagnostics",          label: "Диагностика",        route: "/admin/payments/diagnostics" },
    ],
  },
  {
    code: "forms-hub",
    label: "Анкеты и данные",
    group: "crm",
    routePrefix: "/admin/forms",
  },

  // ─────────── Служебные ───────────
  { code: "documents",           label: "Документы",          group: "service", routePrefix: "/admin/documents" },
  {
    code: "integrations",
    label: "Интеграции",
    group: "service",
    routePrefix: "/admin/integrations",
    resources: [
      { code: "crm",      label: "CRM",      route: "/admin/integrations/crm" },
      { code: "payments", label: "Платежи",  route: "/admin/integrations/payments" },
      { code: "email",    label: "Email",    route: "/admin/integrations/email" },
      { code: "telegram", label: "Telegram", route: "/admin/integrations/telegram" },
      { code: "socials",  label: "Соцсети",  route: "/admin/integrations/socials" },
      { code: "other",    label: "Прочие",   route: "/admin/integrations/other" },
    ],
  },
  { code: "sites",                label: "Конструктор сайтов",   group: "service", routePrefix: "/admin/sites" },
  { code: "marketing",            label: "Маркетинг-инсайты",    group: "service", routePrefix: "/admin/marketing" },
  { code: "ai",                   label: "Нейросеть",            group: "service", routePrefix: "/admin/ai" },
  { code: "products",             label: "Продукты",             group: "service", routePrefix: "/admin/products-v2", altPrefixes: ["/admin/products"] },
  { code: "sections",             label: "Разделы платформы",    group: "service", routePrefix: "/admin/sections" },
  { code: "editorial",            label: "Редакция",             group: "service", routePrefix: "/admin/editorial", altPrefixes: ["/admin/news"] },
  { code: "consents",             label: "Согласия",             group: "service", routePrefix: "/admin/consents" },
  { code: "roles",                label: "Сотрудники и роли",    group: "service", routePrefix: "/admin/roles" },
  { code: "training",             label: "Тренинги",             group: "service", routePrefix: "/admin/training-modules", altPrefixes: ["/admin/training"] },
  { code: "club-members",         label: "Участники клуба",      group: "service", routePrefix: "/admin/integrations/telegram" },
  { code: "live-events",          label: "Эфиры",                group: "service", routePrefix: "/admin/live-events" },
  { code: "legislation",          label: "Законодательство",     group: "service", routePrefix: "/admin/legislation" },
  { code: "telegram-invite-audit",label: "Telegram invite audit",group: "service", routePrefix: "/admin/telegram/invite-audit" },
  { code: "support",              label: "Поддержка",            group: "service", routePrefix: "/admin/support" },
] as const;

/**
 * Маршруты, открытые любому залогиненному админу/супер-админу
 * (системные утилиты, не закреплённые ни за одной секцией).
 * Эти пути НЕ участвуют в section-gating.
 *
 * ВАЖНО: "/admin" умышленно НЕ входит сюда — иначе любой /admin/* путь
 * матчился бы как open и обходил RBAC v3 (frontend gating bug 2026-06-25).
 * Root /admin резолвится отдельной веткой ниже (exact match).
 */
const ADMIN_OPEN_PATHS: readonly string[] = [
  "/admin/audit",
  "/admin/system",                     // /admin/system/audit и т.д.
  "/admin/system-health",
  "/admin/docs",
  "/admin/help",
  "/admin/tenants",
  "/admin/content",                    // legacy
  "/admin/entitlements",               // legacy
  "/admin/duplicates",                 // legacy
  "/admin/fields",
  "/admin/email",                      // legacy, до миграции в communication
  "/admin/refunds-v2",
  "/admin/orders",
  "/admin/orders-v2",
  "/admin/subscriptions-v2",
  "/admin/users",
];

export interface ResolvedAdminRoute {
  kind: "section" | "open" | "unknown";
  sectionCode?: string;
  resourceCode?: string;
}

/** Возвращает секцию для пути; deny-by-default — если ничего не подошло, kind='unknown'. */
export function resolveAdminSectionForPath(pathname: string): ResolvedAdminRoute {
  if (!pathname.startsWith("/admin")) {
    return { kind: "unknown" };
  }

  // Root /admin — open (редирект на первую доступную секцию делает AdminRouteGuard).
  if (pathname === "/admin" || pathname === "/admin/") {
    return { kind: "open" };
  }

  // Точные совпадения / системные открытые пути
  for (const p of ADMIN_OPEN_PATHS) {
    if (pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?")) {
      return { kind: "open" };
    }
  }


  // longest-prefix match по секциям (учитывая altPrefixes)
  let best: { section: AdminSectionDef; prefix: string } | null = null;
  for (const s of ADMIN_SECTIONS) {
    const candidates = [s.routePrefix, ...(s.altPrefixes ?? [])];
    for (const pref of candidates) {
      if (pathname === pref || pathname.startsWith(pref + "/") || pathname.startsWith(pref + "?")) {
        if (!best || pref.length > best.prefix.length) {
          best = { section: s, prefix: pref };
        }
      }
    }
  }
  if (!best) return { kind: "unknown" };

  // resource match
  let resourceCode: string | undefined;
  if (best.section.resources) {
    let bestRes: { res: AdminResourceDef; len: number } | null = null;
    for (const r of best.section.resources) {
      const base = r.route.split("?")[0];
      if (pathname === base || pathname.startsWith(base + "/")) {
        if (!bestRes || base.length > bestRes.len) {
          bestRes = { res: r, len: base.length };
        }
      }
    }
    if (bestRes) resourceCode = bestRes.res.code;
  }

  return { kind: "section", sectionCode: best.section.code, resourceCode };
}

/** Payload для public.sync_admin_menu_registry(jsonb) — формируется из этого же реестра. */
export function buildSyncRegistryPayload() {
  return ADMIN_SECTIONS.map((s, idx) => ({
    code: s.code,
    label: s.label,
    route_prefix: s.routePrefix,
    group_code: s.group,
    sort_order: idx,
    resources: (s.resources ?? []).map((r, ri) => ({
      code: r.code,
      label: r.label,
      route: r.route,
      sort_order: ri,
    })),
  }));
}
