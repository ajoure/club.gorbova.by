import { Link, useLocation } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Home } from "lucide-react";

const routeLabels: Record<string, string> = {
  // Main pages
  "/dashboard": "Обзор",
  "/products": "Продукты",
  "/purchases": "Мои покупки",
  "/accountant": "Бухгалтер",
  "/business": "Бизнес",
  "/library": "База знаний",
  "/audits": "Проверки",
  "/audits/mns-response": "Сервис ответов МНС",
  "/audits/mns-history": "История документов",
  "/self-development": "Саморазвитие",
  "/library/buh-business": "Бухгалтерия как бизнес",
  "/docs": "Документация",
  "/help": "Помощь",
  "/money": "Деньги",
  "/ai": "Искусственный интеллект",
  "/knowledge": "База знаний",
  "/learning": "Обучение",
  "/support": "Поддержка",
  "/consultation": "Консультация",
  "/business-training": "Бухгалтерия как бизнес",
  
  // Tools
  "/tools": "Инструменты",
  "/tools/eisenhower": "Матрица продуктивности",
  "/tools/balance-wheel": "Колесо баланса",
  
  // Settings
  "/settings": "Настройки",
  "/settings/profile": "Профиль",
  "/settings/payment-methods": "Оплата и карты",
  "/settings/legal-details": "Реквизиты",
  "/settings/consents": "Согласия",
  
  // Admin - CRM
  "/admin": "Администрирование",
  "/admin/inbox": "Входящие",
  "/admin/broadcasts": "Рассылки",
  "/admin/contacts": "Контакты",
  "/admin/contacts/duplicates": "Дубликаты",
  "/admin/deals": "Сделки",
  "/admin/communication": "Коммуникации",
  
  // Admin - Service
  "/admin/roles": "Роли",
  "/admin/audit": "Аудит",
  "/admin/content": "Контент",
  "/admin/consents": "Согласия",
  "/admin/entitlements": "Подписки",
  "/admin/preregistrations": "Предзаписи",
  "/admin/support": "Поддержка",
  "/admin/news": "Новости",
  
  // Admin - Integrations
  "/admin/integrations": "Интеграции",
  "/admin/integrations/crm": "CRM",
  "/admin/integrations/payments": "Платежи",
  "/admin/integrations/email": "Электронная почта",
  "/admin/integrations/telegram": "Telegram",
  "/admin/integrations/telegram/invites": "Приглашения",
  "/admin/integrations/telegram/product-mappings": "Связь продуктов",
  "/admin/integrations/telegram/analytics": "Аналитика чатов",
  "/admin/fields": "Реестр полей",
  "/admin/system/audit": "Системный аудит",
  
  // Admin - V2 modules
  "/admin/products-v2": "Продукты",
  "/admin/orders-v2": "Заказы",
  "/admin/payments": "Платежи",
  "/admin/subscriptions-v2": "Подписки",
  "/admin/installments": "Рассрочки",
  "/admin/refunds-v2": "Возвраты",
  "/admin/executors": "Исполнители",
  "/admin/document-templates": "Шаблоны документов",
  "/admin/training-modules": "Учебные модули",
  "/admin/editorial": "Редакция",
  "/admin/ilex": "ILEX",
  "/admin/marketing": "Маркетинг",
  "/admin/bepaid-archive-import": "Импорт архива bePaid",
};

// Check if a string is a UUID
const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

// Readable fallback for UUID segments
const getReadableLabel = (segment: string, parentPath: string) => {
  if (isUUID(segment)) {
    // Try to infer from parent path
    if (parentPath.includes("products-v2")) return "Карточка продукта";
    if (parentPath.includes("orders-v2")) return "Детали заказа";
    if (parentPath.includes("training-modules")) return "Модуль";
    if (parentPath.includes("support")) return "Обращение";
    return "Детали";
  }
  return segment;
};

export function DashboardBreadcrumbs() {
  const location = useLocation();
  const pathSegments = location.pathname.split("/").filter(Boolean);
  
  // Build breadcrumb items
  const breadcrumbItems: { path: string; label: string; isLast: boolean }[] = [];
  let currentPath = "";
  
  pathSegments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const isLast = index === pathSegments.length - 1;
    
    // Get label from route labels or generate readable fallback
    let label = routeLabels[currentPath];
    if (!label) {
      label = getReadableLabel(segment, currentPath);
    }
    
    // Skip intermediate segments that don't have labels (like "tools" without full path)
    // But always include last segment and UUID segments (with readable label)
    if (routeLabels[currentPath] || isLast || isUUID(segment)) {
      breadcrumbItems.push({ path: currentPath, label, isLast });
    }
  });

  if (breadcrumbItems.length === 0) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/dashboard" className="flex items-center gap-1">
              <Home className="h-4 w-4" />
              <span className="sr-only">Главная</span>
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        
        {breadcrumbItems.map((item, index) => (
          <span key={item.path} className="flex items-center gap-1.5">
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {item.isLast ? (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={item.path}>{item.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </span>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
