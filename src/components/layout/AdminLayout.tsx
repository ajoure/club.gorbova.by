import { ReactNode, useMemo } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useRbac } from "@/hooks/useRbac";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { PullToRefresh } from "./PullToRefresh";
import { Loader2, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { PushNotificationToggle } from "@/components/admin/PushNotificationToggle";
import { useIncomingMessageAlert } from "@/hooks/useIncomingMessageAlert";

interface AdminLayoutProps {
  children: ReactNode;
  fullHeight?: boolean;
}

// Map admin routes to page titles
const routeToTitle: Record<string, string> = {
  '/admin/communication': 'Контакт-центр',
  '/admin/contacts': 'Контакты',
  '/admin/deals': 'Сделки',
  '/admin/orders': 'Заказы',
  '/admin/orders-v2': 'Заказы',
  '/admin/payments': 'Платежи',
  '/admin/products': 'Продукты',
  '/admin/products-v2': 'Продукты',
  '/admin/payments/auto-renewals': 'Автопродления',
  '/admin/users': 'Пользователи',
  '/admin/roles': 'Роли',
  '/admin/integrations': 'Интеграции',
  '/admin/audit': 'Аудит',
  '/admin/duplicates': 'Дубликаты',
  '/admin/entitlements': 'Доступы',
  '/admin/telegram/bots': 'Telegram боты',
  '/admin/telegram/clubs': 'Telegram клубы',
  '/admin/email': 'Email',
  '/admin/content': 'Контент',
  '/admin/fields': 'Поля',
  '/admin/ai': 'Нейросеть',
  '/admin/live-events': 'Эфиры',
  '/admin/docs': 'Документация системы',
};

// Map admin routes to help section anchors
const routeToHelpAnchor: Record<string, string> = {
  '/admin/users': 'admin-impersonate',
  '/admin/deals': 'orders',
  '/admin/contacts': 'admin',
  '/admin/orders': 'orders',
  '/admin/orders-v2': 'orders',
  '/admin/payments': 'orders',
  '/admin/payments/diagnostics': 'payment-diagnostics',
  '/admin/products': 'admin',
  '/admin/products-v2': 'admin',
  '/admin/payments/auto-renewals': 'subscriptions',
  '/admin/entitlements': 'admin',
  '/admin/duplicates': 'duplicates',
  '/admin/integrations': 'integrations',
  '/admin/amocrm': 'amocrm',
  '/admin/telegram/bots': 'telegram-bots',
  '/admin/telegram/clubs': 'telegram-clubs',
  '/admin/telegram/invites': 'telegram-notifications',
  '/admin/telegram/members': 'telegram-clubs',
  '/admin/telegram/logs': 'telegram-bots',
  '/admin/telegram/mtproto': 'telegram-bots',
  '/admin/email': 'email',
  '/admin/content': 'admin',
  '/admin/roles': 'roles',
  '/admin/fields': 'integrations-mapping',
  '/admin/audit': 'admin',
  '/admin/ai': 'admin',
  '/admin/live-events': 'admin',
};

export function AdminLayout({ children, fullHeight }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasAdminAccess, loading } = useRbac();
  
  // Global sound alert for incoming messages on any admin page
  useIncomingMessageAlert();

  // Get the page title for the current route
  const pageTitle = useMemo(() => {
    const path = location.pathname;
    if (routeToTitle[path]) {
      return routeToTitle[path];
    }
    for (const [route, title] of Object.entries(routeToTitle)) {
      if (path.startsWith(route)) {
        return title;
      }
    }
    return null;
  }, [location.pathname]);

  // Get the help anchor for the current route
  const helpAnchor = useMemo(() => {
    const path = location.pathname;
    // Check for exact match first
    if (routeToHelpAnchor[path]) {
      return routeToHelpAnchor[path];
    }
    // Check for prefix match (for nested routes)
    for (const [route, anchor] of Object.entries(routeToHelpAnchor)) {
      if (path.startsWith(route)) {
        return anchor;
      }
    }
    return 'admin';
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!hasAdminAccess) {
    navigate("/");
    return null;
  }

  return (
    <SidebarProvider>
      <div className="flex w-full overflow-hidden" style={{ height: 'var(--app-height)' }}>
        <AdminSidebar />
        <main className={`flex-1 h-full flex flex-col min-w-0 min-h-0 overflow-x-hidden ${fullHeight ? "overflow-hidden" : "overflow-y-auto"}`}>
          <header 
            className="border-b border-border/30 flex items-center justify-between px-3 md:px-4 bg-background/60 backdrop-blur-xl sticky top-0 z-10"
            style={{ 
              paddingTop: 'env(safe-area-inset-top, 0px)',
              minHeight: 'calc(2.5rem + env(safe-area-inset-top, 0px))'
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <SidebarTrigger className="shrink-0" />
              {pageTitle && (
                <h1 className="text-xs font-medium text-foreground/80 truncate">
                  {pageTitle}
                </h1>
              )}
            </div>
            <div className="flex items-center gap-1">
              <PushNotificationToggle />
              {/* Contextual help link */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link 
                      to={`/help#${helpAnchor}`}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>
                    Помощь по текущему разделу
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </header>
          <PullToRefresh>
            <div 
              className={`flex-1 min-h-0 flex flex-col ${fullHeight ? "overflow-hidden" : ""}`}
              style={{
                paddingLeft: 'max(1rem, env(safe-area-inset-left, 0px))',
                paddingRight: 'max(1rem, env(safe-area-inset-right, 0px))',
                ...(fullHeight ? {} : { paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' })
              }}
            >
              {children}
            </div>
          </PullToRefresh>
        </main>
      </div>
    </SidebarProvider>
  );
}
