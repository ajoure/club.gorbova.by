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
  "/dashboard": "Обзор",
  "/accountant": "Бухгалтер",
  "/business": "Бизнес",
  "/audits": "Проверки",
  "/audits/mns-response": "Сервис ответов МНС",
  "/audits/mns-history": "История документов",
  "/self-development": "Саморазвитие",
  "/tools": "Инструменты",
  "/tools/eisenhower": "Матрица продуктивности",
  "/tools/balance-wheel": "Колесо баланса",
  "/admin": "Администрирование",
  "/admin/users": "Пользователи",
  "/admin/roles": "Роли",
  "/admin/audit": "Аудит",
  "/admin/entitlements": "Подписки",
  "/admin/content": "Контент",
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
