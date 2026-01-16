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
  "/audits": "Проверки",
  "/audits/mns-response": "Сервис ответов МНС",
  "/audits/mns-history": "История документов",
  "/self-development": "Саморазвитие",
  "/library": "База знаний",
  "/docs": "Документация",
  "/help": "Помощь",
  
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
  
  // Admin - Service
  "/admin/roles": "Роли",
  "/admin/audit": "Аудит",
  "/admin/content": "Контент",
  "/admin/consents": "Согласия",
  "/admin/entitlements": "Подписки",
  "/admin/preregistrations": "Предзаписи",
  
  // Admin - Integrations
  "/admin/integrations": "Интеграции",
  "/admin/integrations/crm": "CRM",
  "/admin/integrations/payments": "Платежи",
  "/admin/integrations/email": "Email",
  "/admin/integrations/telegram": "Telegram",
  "/admin/integrations/telegram/invites": "Приглашения",
  "/admin/integrations/telegram/product-mappings": "Связь продуктов",
  "/admin/integrations/telegram/analytics": "Аналитика чатов",
  "/admin/fields": "Реестр полей",
  "/admin/system/audit": "Системный аудит",
  
  // Admin - V2 modules
  "/admin/products-v2": "Продукты",
  "/admin/orders-v2": "Заказы",
  "/admin/payments-v2": "Платежи",
  "/admin/payments": "Платежи",
  "/admin/subscriptions-v2": "Подписки",
  "/admin/installments": "Рассрочки",
  "/admin/refunds-v2": "Возвраты",
  "/admin/executors": "Исполнители",
  "/admin/document-templates": "Шаблоны документов",
  "/admin/training-modules": "Учебные модули",
};

export function DashboardBreadcrumbs() {
  const location = useLocation();
  const pathSegments = location.pathname.split("/").filter(Boolean);
  
  // Build breadcrumb items
  const breadcrumbItems: { path: string; label: string; isLast: boolean }[] = [];
  let currentPath = "";
  
  pathSegments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const label = routeLabels[currentPath] || segment;
    const isLast = index === pathSegments.length - 1;
    
    // Skip intermediate segments that don't have labels (like "tools" without full path)
    if (routeLabels[currentPath] || isLast) {
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
